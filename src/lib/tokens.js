const crypto = require('crypto');

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateRefreshToken, hashToken };