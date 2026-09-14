const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, queryAsAdmin, withTenant } = require('../../config/db');
const AppError = require('../../lib/AppError');
const { generateRefreshToken, hashToken } = require('../../lib/tokens');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../../lib/email');
const logger = require('../../config/logger');

const REFRESH_TOKEN_TTL_DAYS = 7;
const RESET_TOKEN_TTL_MINUTES = 30;
const VERIFICATION_TOKEN_TTL_HOURS = 24;

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

async function issueRefreshToken(userId, orgId) {
  const rawToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, organization_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, orgId, hashToken(rawToken), expiresAt],
  );

  return rawToken;
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

  // Fire the verification email, but don't let a delivery failure block
  // signup itself — the account should still exist even if the email
  // fails to send, and they can request a new one via resendVerificationEmail.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, tokenHash, expiresAt],
  );

  try {
    await sendVerificationEmail(email, rawToken);
  } catch (err) {
    logger.warn({ err: err.message, userId: user.id }, 'Signup succeeded but verification email failed to send');
  }

  return { user, identityToken: signIdentityToken(user) };
}

async function login({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  if (!user) throw new AppError('Invalid email or password', 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Invalid email or password', 401);

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
  const refreshToken = await issueRefreshToken(userId, orgId);

  return { accessToken, refreshToken, role: membership.role };
}

async function refreshAccessToken(rawToken) {
  const tokenHash = hashToken(rawToken);

  const { rows } = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  const record = rows[0];

  if (!record) {
    throw new AppError('Invalid refresh token', 401);
  }

  if (record.revoked_at) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [
      record.user_id,
    ]);
    throw new AppError('Refresh token reuse detected — all sessions have been revoked. Please log in again.', 401);
  }

  if (new Date(record.expires_at) < new Date()) {
    throw new AppError('Refresh token expired. Please log in again.', 401);
  }

  const membership = await withTenant(record.organization_id, async (client) => {
    const { rows } = await client.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [record.user_id, record.organization_id],
    );
    return rows[0];
  });

  if (!membership) {
    throw new AppError('You are no longer a member of that organization', 403);
  }

  const newRawToken = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { rows: newRows } = await query(
    `INSERT INTO refresh_tokens (user_id, organization_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [record.user_id, record.organization_id, hashToken(newRawToken), newExpiresAt],
  );

  await query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_id = $1 WHERE id = $2', [
    newRows[0].id,
    record.id,
  ]);

  const accessToken = signAccessToken({
    userId: record.user_id,
    orgId: record.organization_id,
    role: membership.role,
  });

  return { accessToken, refreshToken: newRawToken, role: membership.role };
}

async function logout(rawToken) {
  const tokenHash = hashToken(rawToken);
  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [
    tokenHash,
  ]);
}

async function requestPasswordReset(email) {
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  const user = rows[0];

  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, tokenHash, expiresAt],
  );

  await sendPasswordResetEmail(email, rawToken);
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);

  const { rows } = await query(
    'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
    [tokenHash],
  );
  const record = rows[0];

  if (!record) throw new AppError('Invalid or expired reset token', 400);
  if (record.used_at) throw new AppError('This reset token has already been used', 400);
  if (new Date(record.expires_at) < new Date()) throw new AppError('This reset token has expired', 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, record.user_id]);
  await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [record.id]);

  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [
    record.user_id,
  ]);
}

async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);

  const { rows } = await query('SELECT * FROM email_verification_tokens WHERE token_hash = $1', [tokenHash]);
  const record = rows[0];

  if (!record) throw new AppError('Invalid or expired verification token', 400);
  if (record.used_at) throw new AppError('This verification token has already been used', 400);
  if (new Date(record.expires_at) < new Date()) throw new AppError('This verification token has expired', 400);

  await query('UPDATE users SET email_verified = true WHERE id = $1', [record.user_id]);
  await query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [record.id]);
}

async function resendVerificationEmail(email) {
  const { rows } = await query('SELECT id, email_verified FROM users WHERE email = $1', [email]);
  const user = rows[0];

  if (!user || user.email_verified) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, tokenHash, expiresAt],
  );

  await sendVerificationEmail(email, rawToken);
}

module.exports = {
  signup,
  login,
  selectOrganization,
  refreshAccessToken,
  logout,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
};