const jwt = require('jsonwebtoken');

function identityAuthMiddleware(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    if (payload.type !== 'identity') {
      return res.status(401).json({
        success: false,
        message: 'This endpoint requires an identity token, not an org-scoped access token',
      });
    }

    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = identityAuthMiddleware;