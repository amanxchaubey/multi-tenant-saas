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
    return rows[0];
  });
}

module.exports = { findAll, create };