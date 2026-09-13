const { withTenant } = require('../../config/db');

async function findAll(orgId, projectId) {
  return withTenant(orgId, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId],
    );
    return rows;
  });
}

async function create(orgId, { projectId, title }) {
  return withTenant(orgId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tasks (organization_id, project_id, title) VALUES ($1, $2, $3) RETURNING *`,
      [orgId, projectId, title],
    );
    return rows[0];
  });
}

async function markDone(orgId, taskId) {
  return withTenant(orgId, async (client) => {
    const { rows } = await client.query(
      `UPDATE tasks SET is_done = true WHERE id = $1 RETURNING *`,
      [taskId],
    );
    return rows[0];
  });
}

module.exports = { findAll, create, markDone };