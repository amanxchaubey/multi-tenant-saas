const { query, queryAsAdmin, withTenant } = require('../../config/db');
const AppError = require('../../lib/AppError');

async function createOrganization({ name, slug, userId }) {
  const existing = await query('SELECT id FROM organizations WHERE slug = $1', [slug]);
  if (existing.rows[0]) {
    throw new AppError('That organization slug is already taken', 409);
  }

  const { rows } = await query(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug, plan, created_at`,
    [name, slug],
  );
  const organization = rows[0];

  await withTenant(organization.id, (client) =>
    client.query(
      `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'OWNER')`,
      [userId, organization.id],
    ),
  );

  return organization;
}

async function listMyOrganizations(userId) {
  // Uses the BYPASSRLS admin connection — listing every org a user
  // belongs to is inherently cross-tenant.
  const { rows } = await queryAsAdmin(
    `SELECT o.id, o.name, o.slug, o.plan, m.role
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1`,
    [userId],
  );
  return rows;
}

async function getOrganization(orgId) {
  const { rows } = await query(
    'SELECT id, name, slug, plan, created_at FROM organizations WHERE id = $1',
    [orgId],
  );
  return rows[0];
}

async function inviteMember(orgId, { email, role = 'MEMBER' }) {
  const { rows: userRows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  const user = userRows[0];

  if (!user) {
    throw new AppError('No account exists with that email. They need to sign up first.', 404);
  }

  return withTenant(orgId, async (client) => {
    const existing = await client.query(
      'SELECT id FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [user.id, orgId],
    );
    if (existing.rows[0]) {
      throw new AppError('That user is already a member of this organization', 409);
    }

    const { rows } = await client.query(
      `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3) RETURNING *`,
      [user.id, orgId, role],
    );
    return rows[0];
  });
}

module.exports = { createOrganization, listMyOrganizations, getOrganization, inviteMember };
