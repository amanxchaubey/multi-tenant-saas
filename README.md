# Ledger — Multi-Tenant B2B SaaS Backend

A production-style backend where multiple companies (tenants) share the same
database, servers, and codebase — while remaining **completely isolated**
from one another, enforced at the database layer rather than trusted to
application code.

**Live API:** https://multi-tenant-saas-14lm.onrender.com/health
*(hosted on Render's free tier — the first request after ~15 minutes of
inactivity may take 30–60 seconds while it spins back up)*

---

## Why this project exists

Most "multi-tenant" demo projects add a `tenant_id` column and filter every
query with `WHERE tenant_id = ?`. That approach is fragile: one missed
filter, anywhere in a large codebase, silently leaks one customer's data to
another.

This project instead uses **PostgreSQL Row-Level Security (RLS)**. Every
tenant-owned table has a database-level policy that Postgres enforces on
*every* query automatically — so even a query with no `WHERE` clause at all
still only returns the current tenant's rows. The guarantee lives in the
database, not in the discipline of whoever writes the next query.

---

## Architecture

```
Client
  │
  ▼
Express API  ────────────────────────────────────────────┐
  │                                                        │
  ├─ Global routes (no tenant context needed)              │
  │    /auth/signup, /auth/login, /organizations (create)  │
  │                                                        │
  ├─ Tenant-resolution middleware                          │
  │    resolves org from X-Org-Slug header, cached in Redis│
  │                                                        │
  ├─ Auth middleware                                       │
  │    verifies JWT, cross-checks token's org vs resolved  │
  │                                                        │
  ├─ RBAC middleware                                        │
  │    restricts routes to specific roles (OWNER/ADMIN)     │
  │                                                        │
  ▼                                                        │
PostgreSQL (Neon, hosted)                                  │
  │                                                        │
  ├─ app_user connection (RLS fully enforced) ── all       │
  │    normal, tenant-scoped request handling               │
  │                                                        │
  └─ app_admin connection (BYPASSRLS) ── only for the       │
       narrow set of legitimately cross-tenant lookups      │
       (e.g. "list every org this user belongs to")         │
                                                             │
Redis ── caches org slug→id lookups; app degrades ──────────┘
          gracefully if unavailable (proven by test)
RabbitMQ ── wired in for future async/event work; also
             optional, app boots fine without it
Resend ── transactional email (verification, password reset)
Stripe ── subscription billing, checkout, webhooks
Sentry ── error tracking
```

---

## Tech stack, and why each piece is there

| Technology | Role | Why |
|---|---|---|
| **Node.js + Express** | HTTP server, routing, middleware | Simple, widely understood, sufficient for this scope |
| **PostgreSQL** | Primary database | Chosen specifically for native **Row-Level Security** support |
| **`pg` (node-postgres)** | Raw DB driver, no ORM | Full control over transactions and session variables — needed for RLS to work (`SET LOCAL app.org_id`) |
| **Neon** | Hosted Postgres | Serverless Postgres with a generous free tier; used for the live deployment |
| **Redis (`ioredis`)** | Caching layer | Caches the org-slug → org-id lookup that happens on nearly every request; **optional at runtime** — the app is tested to run correctly with Redis stopped entirely |
| **RabbitMQ (`amqplib`)** | Message broker | Wired in for future async work (e.g. background jobs); also optional — the app boots and serves traffic without it |
| **JWT (`jsonwebtoken`)** | Stateless auth tokens | No server-side session store needed; horizontally scalable by design |
| **bcryptjs** | Password hashing | One-way hashing with built-in salting |
| **Resend** | Transactional email | Sends verification and password-reset emails |
| **Stripe** | Billing | Subscription checkout, webhook-driven plan updates |
| **Sentry (`@sentry/node`)** | Error tracking | Captures unhandled exceptions in real time, separate from log files |
| **Pino / `pino-http`** | Structured logging | Every request logged with method, path, status, timing, and (once known) tenant/user id |
| **`express-rate-limit`** | Rate limiting | Protects auth endpoints from brute-force/credential-stuffing |
| **Jest + Supertest** | Testing | Real integration tests against a live Postgres with RLS actually active — not mocked |
| **Docker Compose** | Local dev environment | Runs Postgres/Redis/RabbitMQ as isolated containers |
| **GitHub Actions** | CI/CD | Runs the full migration history + test suite from a clean database on every push |
| **Render** | Application hosting | Deploys the live backend |

---

## The core mechanism: how tenant isolation actually works

Every tenant-scoped request runs inside a Postgres transaction that first
sets a session variable to the current organization's id:

```sql
SET LOCAL app.org_id = '<resolved organization UUID>';
```

Every RLS policy on a tenant-owned table (`memberships`, `projects`,
`tasks`, `audit_logs`) checks this variable:

```sql
CREATE POLICY tenant_isolation_projects ON projects
  USING (organization_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.org_id', true)::uuid);
```

The practical effect: a query like `SELECT * FROM projects` — with **no
`WHERE` clause at all** — still only ever returns the current tenant's rows.
The isolation guarantee doesn't depend on every developer remembering to
filter correctly; Postgres enforces it unconditionally, on every query,
regardless of how it's written.

### `SET LOCAL`, specifically, matters

`SET LOCAL` (not plain `SET`) scopes the session variable to just the
current transaction — it automatically resets when the transaction ends.
This matters because the app uses connection pooling, where the same
physical database connection is reused across many different, unrelated
requests over time. Using plain `SET` would risk one request's tenant
context leaking into a different request that later reuses the same
connection.

### The one deliberate exception: `app_admin`

A small number of operations are inherently cross-tenant by design — most
notably, "list every organization this user belongs to" (used at login and
in `/organizations/mine`). These can't be scoped to a single `app.org_id`,
because the whole point is to look across all of them.

For exactly these cases, and only these, the app uses a **second**,
separately credentialed database role — `app_admin` — with Postgres's
`BYPASSRLS` privilege. This is a narrow, explicit, auditable exception
rather than a blanket bypass: every other query in the app goes through
`app_user`, which has RLS fully enforced and no bypass privilege at all.

### A real bug this surfaced, and how it was fixed

Early on, cross-tenant reads were silently succeeding despite
correctly-written RLS policies. The cause: the application was connecting
to Postgres using a superuser role, and **Postgres superusers always bypass
RLS unconditionally**, regardless of what policies exist. The fix was
creating a dedicated, least-privilege `app_user` role for all normal
request handling.

That fix then surfaced a second, more subtle issue: with RLS properly
enforced, the login flow broke, because checking "is this user a member of
the organization they're trying to select" is itself a cross-tenant-style
read — and RLS was (correctly) blocking it, since no single tenant context
exists yet at that exact moment. The fix was the `app_admin` role described
above, scoped narrowly to that handful of legitimately cross-tenant
lookups.

---

## Authentication: why there are two token types

Because a user can belong to **multiple** organizations (the same pattern
as Slack workspaces or GitHub organizations), authentication happens in two
distinct steps:

1. **`POST /auth/login`** → verifies credentials, returns an **identity
   token** (proves *who* you are) plus the list of organizations you
   belong to.
2. **`POST /auth/select-organization`** → exchanges the identity token for
   an **access token** scoped to one specific organization (proves *who
   you are, in which org, with what role*).

All subsequent requests use the access token. `authMiddleware` cross-checks
the token's embedded organization id against the organization resolved
from the request's `X-Org-Slug` header — a token issued for Organization A
is rejected outright if used against Organization B, even if it's
otherwise valid and unexpired. This closes a specific attack: without this
check, a token legitimately issued for one org could be replayed against a
different org's endpoints.

### Refresh token rotation, with theft detection

Access tokens are short-lived (15 minutes). Refresh tokens (7 days) are
used to obtain new access tokens without re-authenticating, via
`POST /auth/refresh`.

Every refresh **rotates** the token: the old refresh token is immediately
revoked and a new one issued. If someone presents an already-revoked
refresh token, that's treated as a signal of token theft — **every** active
refresh token for that user is revoked immediately, forcing re-login
everywhere. This is the standard refresh-token-reuse-detection pattern used
by production auth systems, tested directly: rotating a token and then
attempting to reuse the original correctly triggers this response.

Password resets also revoke all of a user's refresh tokens — if a password
was compromised, any existing sessions shouldn't survive the reset.

---

## Role-Based Access Control (RBAC)

Roles are **per-organization**, not global — the same person can be an
`OWNER` of their own company and a plain `MEMBER` of a client's workspace
simultaneously. Three roles: `OWNER`, `ADMIN`, `MEMBER`.

Enforced via a reusable middleware rather than duplicated checks scattered
across controllers:

```js
router.post('/', authorize('OWNER', 'ADMIN'), projectController.create);
```

Tested directly: a `MEMBER` is confirmed blocked (403) from creating a
project while still able to read the project list; an `OWNER` is confirmed
able to do both.

---

## Billing (Stripe)

Organizations start on a `free` plan. Upgrading to `pro`:

1. `POST /billing/checkout` creates (or reuses) a Stripe customer for the
   organization and returns a Stripe-hosted Checkout session URL.
2. The user completes payment on Stripe's own page — card details never
   touch this backend directly.
3. Stripe sends **webhook events** to `/billing/webhook`, which:
   - Verifies the request genuinely came from Stripe via signature
     verification (`stripe.webhooks.constructEvent`), rejecting anything
     that fails.
   - Reacts to `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, and `invoice.payment_failed`.
   - Updates the organization's `plan`, `subscription_status`,
     `stripe_customer_id`, and `stripe_subscription_id` accordingly.

The webhook handler is written to be **idempotent** — safe to process the
same event more than once without side effects — since Stripe can and does
redeliver events. It also always responds `200` even if internal processing
hits an error, since a non-2xx response tells Stripe to keep retrying, and
retries won't fix a code bug on this end; errors are logged for manual
investigation instead.

The Stripe webhook route is registered with `express.raw()` **before**
`express.json()` runs globally, because signature verification requires
the untouched raw request body — a parsed JSON object would fail
verification.

Tested end-to-end in Stripe's test mode: checkout session creation →
completed test payment (via Stripe's `4242...` test card) → webhook
delivery confirmed via the Stripe CLI → database confirmed updated with
`plan: pro`, `subscription_status: active`, and real Stripe IDs.

---

## Observability

- **Structured logging (Pino):** every request logged with method, path,
  status code, response time, and — once resolved — the organization and
  user id. Errors are split into `warn` (expected, e.g. wrong password) vs
  `error` (genuine bugs) severity.
- **Error tracking (Sentry):** unhandled exceptions are captured with full
  stack traces, environment, and request context, independent of log
  files — tested directly via a deliberate thrown error, confirmed
  captured in Sentry's dashboard.
- **Rate limiting:** auth endpoints (`/auth/*`) are limited to 10 requests
  per 15 minutes per IP; general traffic is limited to 300 per 15 minutes.
  Tested directly: the 11th rapid login attempt correctly returns `429`.

---

## Resilience: graceful degradation

Redis and RabbitMQ are both treated as **optional infrastructure** — the
app is designed, and tested, to keep serving correct responses even if
either is completely unavailable:

- If Redis is down, `tenantMiddleware` catches the failure and falls
  straight through to a direct database query instead of hanging or
  crashing — proven by stopping the Redis container mid-session and
  confirming a normal request still succeeds.
- If RabbitMQ can't connect at startup, the server logs a warning and
  continues booting rather than crashing.
- If the Resend API key is missing (e.g., in CI), email-sending functions
  log a warning and return early instead of throwing — this is what allows
  the automated test suite to run in an environment with no email
  credentials configured at all.

This matters in practice: the production deployment on Render's free tier
does not run Redis or RabbitMQ at all, and the app works correctly without
them.

---

## Database schema

```
users ──< memberships >── organizations ──< projects ──< tasks
  │                              │
  │                              ├── stripe_customer_id
  │                              ├── stripe_subscription_id
  │                              ├── subscription_status
  │                              └── plan
  │
  ├── refresh_tokens (hashed, single-use rotation, theft detection)
  ├── password_reset_tokens (hashed, single-use, 30-min expiry)
  └── email_verification_tokens (hashed, single-use, 24-hour expiry)

organizations ──< audit_logs   (who did what, when, per tenant)
```

- **Users are global** — a user account isn't tied to any single
  organization.
- **Organizations are tenants** — each has its own projects, tasks,
  members, and billing state.
- **Memberships link the two**, many-to-many, each with a role.
- All token tables store a **hash** of the token, never the raw value —
  same principle as password hashing.

---

## API overview

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | Creates a global user account, sends verification email |
| POST | `/auth/login` | — | Returns identity token + list of orgs the user belongs to |
| POST | `/auth/select-organization` | Identity token | Returns an org-scoped access + refresh token |
| POST | `/auth/refresh` | Refresh token | Rotates to a new access + refresh token pair |
| POST | `/auth/logout` | — | Revokes a refresh token |
| POST | `/auth/forgot-password` | — | Sends a password reset email (always returns success, doesn't reveal if the email exists) |
| POST | `/auth/reset-password` | Reset token | Sets a new password, revokes all refresh tokens |
| POST | `/auth/verify-email` | Verification token | Marks the account's email as verified |
| POST | `/auth/resend-verification` | — | Re-sends the verification email |
| POST | `/organizations` | Identity token | Creates a new org; caller becomes its OWNER |
| GET | `/organizations/mine` | Identity token | Lists every org the caller belongs to |
| GET | `/organizations/me` | Access token | Details of the currently selected org |
| POST | `/organizations/members` | Access token, OWNER/ADMIN | Invites an existing user into the org |
| GET | `/projects` | Access token | Lists projects in the current org |
| POST | `/projects` | Access token, OWNER/ADMIN | Creates a project, writes an audit log entry |
| GET | `/tasks?projectId=` | Access token | Lists tasks for a project |
| POST | `/tasks` | Access token | Creates a task |
| PATCH | `/tasks/:id/status` | Access token | Updates a task's status |
| POST | `/billing/checkout` | Access token, OWNER/ADMIN | Creates a Stripe Checkout session |
| POST | `/billing/webhook` | Stripe signature | Receives and processes Stripe events |

All org-scoped routes require an `X-Org-Slug` header identifying the
target organization.

---

## Testing

```bash
npm test
```

Runs real integration tests (Jest + Supertest) against a live Postgres
database with RLS **actually active** — not mocked, because the entire
point of the isolation guarantee is that it's enforced by the database
itself. A mocked database test would prove nothing about whether isolation
genuinely works.

- **`test/tenant-isolation.test.js`** — creates two independent
  organizations, has one create data, and asserts the other cannot see it
  through the same API, using its own fully valid token. Also asserts a
  token issued for one org is rejected outright when used against another.
- **`test/rbac.test.js`** — asserts a MEMBER is blocked (403) from
  privileged writes while still able to read, and that an OWNER can do
  both.

Every test uses randomized emails/org slugs, so the suite can be run
repeatedly without hitting uniqueness conflicts.

## Continuous Integration

Every push to `main` triggers a GitHub Actions workflow that:
1. Spins up a fresh Postgres container
2. Runs all six migrations in order, from empty
3. Creates the `app_user` / `app_admin` roles with correct privileges
4. Runs the full test suite

This means a schema change or accidental policy removal would be caught
automatically, before it ever reaches production — not just tested by hand,
once, on one developer's machine.

---

## Getting started locally

**Prerequisites:** Node.js 20+, Docker Desktop (or native Postgres/Redis/RabbitMQ).

```bash
git clone <this-repo-url>
cd multi-tenant-saas
npm install
docker compose up -d
cp .env.example .env   # fill in real values
```

Run all six migrations against your database (see `database/migrations/`,
numbered `001` through `006`), creating `app_user` and `app_admin` roles as
described in `.env.example`'s comments.

```bash
npm run dev
```

## Deployment

- **Backend:** Render (free tier)
- **Database:** Neon (serverless Postgres, free tier)
- **Email:** Resend
- **Billing:** Stripe (test mode)
- **Error tracking:** Sentry

Production environment variables are set directly in Render's dashboard,
separate from local `.env`. The Stripe webhook endpoint for production is
registered independently in Stripe's dashboard (not via the CLI), since
the Stripe CLI's `stripe listen` webhook secret is local-development-only.

---

## Known limitations

Being upfront about what's intentionally out of scope for this project:

- Integration tests run against the same Neon database used for manual
  testing, rather than a fully isolated test database — each run creates
  fresh, randomly-suffixed data rather than resetting state.
- No frontend UI is included in this repository (a separate React demo
  frontend was built alongside this project, showcasing the isolation
  guarantee visually — see the companion "Ledger" frontend).
- Feature-gating based on `plan` (e.g., limiting free-tier orgs to N
  projects) is not yet implemented — the billing system correctly tracks
  and updates plan status, but nothing in the app currently *enforces*
  plan-based limits.
- Render's free tier has no persistent Redis/RabbitMQ; the app is
  specifically designed to degrade gracefully without them, but this means
  the production deployment doesn't currently exercise the caching or
  message-queue code paths.

## What I'd add with more time

- A dedicated, isolated test database, reset between CI runs
- Plan-based feature gating (the part billing currently doesn't enforce)
- Audit log viewing endpoint (the data is captured; there's no API to read it back yet)
- Prometheus metrics / a dashboard, beyond Sentry's error-level visibility

---

## What I learned

The most valuable part of this project wasn't writing the RLS policies —
it was **verifying they actually worked**. Early cross-tenant tests
revealed isolation was silently failing despite correct-looking policies,
traced back to a superuser database connection bypassing RLS entirely.
Fixing that surfaced a second, more subtle bug in the login flow, caused
by RLS correctly blocking a legitimately cross-tenant lookup that hadn't
been given an explicit, narrow exception yet. Debugging both with direct
SQL introspection — rather than guesswork — was a genuinely useful lesson
in how Postgres's Row-Level Security interacts with connection roles and
query design in ways that aren't obvious from documentation alone, and it
shaped how the rest of the system (refresh tokens, billing webhooks) was
built: verify the security-critical claim directly, with a real test, not
just a design that looks correct on paper.