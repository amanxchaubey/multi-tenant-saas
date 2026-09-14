const { Pool } = require('pg');

const useSSL = process.env.DATABASE_URL?.includes('sslmode=require');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
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