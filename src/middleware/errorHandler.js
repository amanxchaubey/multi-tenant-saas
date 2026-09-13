const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    logger.error({ err, path: req.path, orgId: req.orgId }, 'Unhandled server error');
  } else {
    logger.warn({ path: req.path, message: err.message }, 'Request error');
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
};

module.exports = errorHandler;