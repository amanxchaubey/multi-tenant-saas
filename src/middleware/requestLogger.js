const pinoHttp = require('pino-http');
const logger = require('../config/logger');

const requestLogger = pinoHttp({
  logger,
  customProps: (req) => ({
    orgId: req.orgId || null,
    userId: req.user?.id || null,
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode} (${err.message})`,
});

module.exports = requestLogger;