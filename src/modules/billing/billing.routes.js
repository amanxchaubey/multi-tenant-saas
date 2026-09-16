const express = require('express');
const tenantMiddleware = require('../../middleware/tenant');
const authMiddleware = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const billingController = require('./billing.controller');

const router = express.Router();

router.post(
  '/checkout',
  tenantMiddleware,
  authMiddleware,
  authorize('OWNER', 'ADMIN'),
  billingController.createCheckout,
);

module.exports = router;