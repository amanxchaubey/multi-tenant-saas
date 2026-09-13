const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

/**
 * Strict limiter for auth endpoints specifically — these are the most
 * brute-forceable surface in the app (login especially). 10 requests
 * per 15 minutes per IP is generous for a real user, punishing for a
 * credential-stuffing attempt.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded on auth endpoint');
    res.status(429).json({
      success: false,
      message: 'Too many attempts. Please try again in a few minutes.',
    });
  },
});

/**
 * A looser, general-purpose limiter for everything else — mainly a
 * baseline defense against runaway scripts/scraping, not meant to be
 * restrictive for normal use.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, generalLimiter };