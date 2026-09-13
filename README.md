# Multi-Tenant B2B SaaS Backend

A production-style multi-tenant backend built with **Node.js, Express, and PostgreSQL**, where multiple organizations (tenants) share the same infrastructure and database while remaining fully isolated from one another — enforced at the **database layer**, not just in application code.

## Why this project exists

Most "multi-tenant" demo projects add a `tenant_id` column and filter every query with `WHERE tenant_id = ?`. That approach is fragile: one missed filter anywhere in a large codebase silently leaks one customer's data to another.

This project instead uses **PostgreSQL Row-Level Security (RLS)**. Every tenant-scoped table has a security policy that Postgres itself enforces on every single query — so even a bug in application code (a forgotten `WHERE` clause, a wrong join) cannot return another tenant's data. The database, not the application, is the source of truth for isolation.

## Architecture

```
Client
  │
  ▼
Express API
  │
  ├─ Global routes (no tenant context needed)
  │    /auth/signup, /auth/login, /organizations (create)
  │
  ├─ Tenant-resolution middleware
  │    resolves org from X-Org-Slug header (or subdomain)
  │
  ├─ Auth middleware
  │    verifies JWT, cross-checks token's org against resolved org
  │
  ├─ RBAC middleware
  │    restricts specific routes to OWNER / ADMIN roles
  │
  ▼
PostgreSQL (Row-Level Security enforced on every tenant-owned table)
  │
  ├─ Standard connection (app_user, RLS enforced) — used for all normal
  │    request handling
  │
  └─ Admin connection (app_admin, BYPASSRLS) — used only for the narrow
       set of legitimate cross-tenant lookups (e.g. "list every
       organization this user belongs to")
```

## Data model

- **Users are global.** A user account (`email` + `password`) is not tied to any single organization.
- **Organizations are tenants.** Each organization has its own projects, tasks, and members.
- **Memberships link the two**, many-to-many: one user can belong to multiple organizations, each with its own role (`OWNER`, `ADMIN`, `MEMBER`) — the same pattern used by Slack, Notion, Linear, and GitHub organizations.

```
users ──< memberships >── organizations ──< projects ──< tasks
```

## Auth flow

Because a user can belong to multiple organizations, authentication happens in two steps:

1. **`POST /auth/login`** → verifies credentials, returns an **identity token** (proves *who* you are) plus the list of organizations you belong to.
2. **`POST /auth/select-organization`** → exchanges the identity token for an **access token** scoped to one specific organization (proves *who you are, in which org, with what role*).

All subsequent requests use the access token, which `authMiddleware` cross-checks against the organization resolved from the request (via the `X-Org-Slug` header) — a token issued for Organization A is rejected outright if used against Organization B, even if it's otherwise valid and unexpired.

## Tenant isolation: how it actually works

Every request that touches tenant-owned data (`memberships`, `projects`, `tasks`, `audit_logs`) runs inside a Postgres transaction that first sets a session variable:

```sql
SET LOCAL app.org_id = '<the resolved organization's UUID>';
```

Every RLS policy on those tables checks this variable:

```sql
CREATE POLICY tenant_isolation_projects ON projects
  USING (organization_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.org_id', true)::uuid);
```

This means a query like `SELECT * FROM projects` — with **no `WHERE` clause at all** — will still only ever return rows belonging to the current tenant. The isolation guarantee doesn't depend on every developer remembering to filter correctly; Postgres enforces it unconditionally.

### The one deliberate exception

A small number of operations are *inherently* cross-tenant by design — most notably, "list every organization this user belongs to" (used at login and in `/organizations/mine`). These can't be scoped to a single `app.org_id`, because the whole point is to look across all of them.

For exactly these cases, the app uses a **separate**, explicitly named database role (`app_admin`) with Postgres's `BYPASSRLS` privilege. This role is used *only* for these specific, narrow, read-only-by-convention lookups — never for regular request handling, which always goes through the standard RLS-enforced `app_user` role. This is the same pattern real multi-tenant systems use: RLS as the default-deny baseline, with narrow, explicit, auditable exceptions rather than a blanket bypass.

## Tech stack

- Node.js + Express
- PostgreSQL (`pg`) with Row-Level Security
- Redis — caches organization slug → id lookups
- RabbitMQ — wired in for future async/event-driven work
- JWT (`jsonwebtoken`) for auth, `bcryptjs` for password hashing
- Jest + Supertest for automated integration tests
- Docker Compose for local Postgres/Redis/RabbitMQ

## Getting started

**Prerequisites:** Node.js 20+, Docker Desktop (or native Postgres/Redis/RabbitMQ installs).

```bash
git clone <your-repo-url>
cd multi-tenant-saas
npm install
docker compose up -d
```

Copy `.env.example` to `.env` and fill in your values (see below for what each one does).

Run the database migrations against your Postgres instance:
```bash
# using the Docker container:
docker exec -i <your-postgres-container-name> psql -U postgres -d multitenant < database/migrations/001_initial.sql
docker exec -i <your-postgres-container-name> psql -U postgres -d multitenant < database/migrations/002_tasks_and_rls.sql
```

Create the two application database roles (see "Database roles" below), then start the server:
```bash
npm run dev
```

## Database roles

RLS only works correctly if the application does **not** connect as a Postgres superuser or table owner — both bypass RLS entirely, regardless of what policies exist. This project uses two distinct, least-privilege roles:

```sql
-- Standard role: used for all normal request handling. RLS is fully enforced.
CREATE ROLE app_user WITH LOGIN PASSWORD '<choose a password>';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- Admin role: used only for the narrow set of legitimate cross-tenant
-- lookups (e.g. listing every org a user belongs to). BYPASSRLS means
-- this role sees across all tenants — use deliberately, never by default.
CREATE ROLE app_admin WITH LOGIN PASSWORD '<choose a different password>' BYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin;
```

## Environment variables

```
PORT=5000
DATABASE_URL=postgresql://app_user:<password>@localhost:5433/multitenant
ADMIN_DATABASE_URL=postgresql://app_admin:<password>@localhost:5433/multitenant
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost
JWT_ACCESS_SECRET=<random secret>
JWT_REFRESH_SECRET=<random secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

## API overview

| Method | Route | Auth required | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | Creates a global user account |
| POST | `/auth/login` | — | Returns identity token + list of orgs the user belongs to |
| POST | `/auth/select-organization` | Identity token | Returns an org-scoped access token |
| POST | `/organizations` | Identity token | Creates a new org; caller becomes its OWNER |
| GET | `/organizations/mine` | Identity token | Lists every org the caller belongs to |
| GET | `/organizations/me` | Access token | Details of the currently selected org |
| POST | `/organizations/members` | Access token, OWNER/ADMIN | Invites an existing user into the org |
| GET | `/projects` | Access token | Lists projects in the current org |
| POST | `/projects` | Access token, OWNER/ADMIN | Creates a project |
| GET | `/tasks?projectId=` | Access token | Lists tasks for a project |
| POST | `/tasks` | Access token | Creates a task |
| PATCH | `/tasks/:id/status` | Access token | Updates a task's status |

All org-scoped routes require an `X-Org-Slug` header identifying the target organization.

## Testing

```bash
npm test
```

Includes automated integration tests that directly prove the two core guarantees of this project:

- **Tenant isolation** (`test/tenant-isolation.test.js`) — creates two independent organizations, has one create data, and asserts the other cannot see it through the same API — even with a fully valid token for its own org. Also asserts a token issued for one org is rejected outright when used against another.
- **RBAC** (`test/rbac.test.js`) — asserts a MEMBER is blocked from privileged writes (403) while still able to read, and that an OWNER can perform both.

These run as real integration tests against a live Postgres database (not mocked), so they exercise the actual RLS policies, not a simulation of them.

## Known limitations / next steps

- Tests currently run against the dev database rather than an isolated test database; each run creates new (randomly-suffixed) test data rather than cleaning up after itself.
- No refresh-token rotation/revocation yet — access tokens simply expire.
- `audit_logs` table exists in the schema but isn't wired up to any code yet.
- No billing/subscription integration yet (schema has a `plan` column on organizations, ready for it).
- No rate limiting on auth endpoints yet.

## What I learned building this

The most valuable part of this project wasn't writing the RLS policies — it was **verifying they actually worked**. Early on, cross-tenant reads were silently succeeding despite correct-looking policies, because the application was connecting to Postgres as a superuser, which bypasses RLS unconditionally. Fixing that surfaced a second, more subtle bug: with RLS properly enforced, the app could no longer check "is this user a member of the organization they're trying to select" during login, because that very check is itself a cross-tenant read that RLS was (correctly) blocking. The fix was a deliberate, narrowly-scoped bypass role (`app_admin` with `BYPASSRLS`) used only for that handful of legitimately cross-tenant operations — everything else stays fully enforced. Debugging this end to end, with direct SQL introspection rather than guesswork, was a genuinely useful lesson in how RLS interacts with connection roles and query design in a way that isn't obvious from Postgres's documentation alone.