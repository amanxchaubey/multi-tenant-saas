const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryAsAdmin, withTenant } = require('../../config/db');
const AppError = require('../../lib/AppError');

function signIdentityToken(user) {
  return jwt.sign({ sub: user.id, type: 'identity' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '1h',
  });
}

function signAccessToken({ userId, orgId, role }) {
  return jwt.sign(
    { sub: userId, orgId, role, type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' },
  );
}

async function signup({ name, email, password }) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) {
    throw new AppError('An account with that email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, name, email`,
    [name, email, passwordHash],
  );
  const user = rows[0];

  return { user, identityToken: signIdentityToken(user) };
}

async function login({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  if (!user) throw new AppError('Invalid email or password', 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Invalid email or password', 401);

  // Deliberately uses the BYPASSRLS admin connection: listing every org a
  // user belongs to is inherently cross-tenant and can't be scoped to a
  // single app.org_id, since we don't know which org they want yet.
  const { rows: memberships } = await queryAsAdmin(
    `SELECT o.id, o.name, o.slug, m.role
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1`,
    [user.id],
  );

  return {
    user: { id: user.id, name: user.name, email: user.email },
    memberships,
    identityToken: signIdentityToken(user),
  };
}

async function selectOrganization(userId, orgId) {
  const membership = await withTenant(orgId, async (client) => {
    const { rows } = await client.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [userId, orgId],
    );
    return rows[0];
  });

  if (!membership) {
    throw new AppError('You are not a member of that organization', 403);
  }

  const accessToken = signAccessToken({ userId, orgId, role: membership.role });
  return { accessToken, role: membership.role };
}

module.exports = { signup, login, selectOrganization };