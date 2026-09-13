const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Separate pool using a BYPASSRLS role, for the narrow set of legitimate
// cross-tenant operations (e.g. "list every org this user belongs to").
// Never use this for regular tenant-scoped request handling.
const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});
adminPool.on('error', (err) => {
  console.error('Unexpected admin PG pool error', err);
});

function query(text, params) {
  return pool.query(text, params);
}

function queryAsAdmin(text, params) {
  return adminPool.query(text, params);
}

async function withTenant(orgId, callback) {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    throw new Error('Invalid orgId');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.org_id = '${orgId}'`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { pool, adminPool, query, queryAsAdmin, withTenant };