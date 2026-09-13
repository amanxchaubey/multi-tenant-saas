const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    if (payload.type !== 'access') {
      return res.status(401).json({
        success: false,
        message: 'This endpoint requires an org-scoped access token. Call /auth/select-organization first.',
      });
    }

    if (req.orgId && payload.orgId !== req.orgId) {
      return res.status(401).json({ success: false, message: 'Token does not belong to this organization' });
    }

    req.user = { id: payload.sub, orgId: payload.orgId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;