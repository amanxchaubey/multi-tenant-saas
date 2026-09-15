const { withTenant } = require('../../config/db');

async function findAll(orgId) {
  return withTenant(orgId, async (client) => {
    const { rows } = await client.query('SELECT * FROM projects ORDER BY created_at DESC');
    return rows;
  });
}

async function create(orgId, { name, description, createdBy }) {
  return withTenant(orgId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO projects (organization_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, name, description || null, createdBy],
    );

    await client.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, createdBy, 'project.created', 'project', rows[0].id],
    );

    return rows[0];
  });
}

module.exports = { findAll, create };

module.exports = { findAll, create };