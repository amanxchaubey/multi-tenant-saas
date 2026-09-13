function authorize(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = authorize;