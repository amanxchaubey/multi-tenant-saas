const express = require('express');
const identityAuthMiddleware = require('../../middleware/identityAuth');
const tenantMiddleware = require('../../middleware/tenant');
const authMiddleware = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const organizationController = require('./organization.controller');

const router = express.Router();

router.post('/', identityAuthMiddleware, organizationController.create);
router.get('/mine', identityAuthMiddleware, organizationController.listMine);
router.get('/me', tenantMiddleware, authMiddleware, organizationController.getMine);
router.post(
  '/members',
  tenantMiddleware,
  authMiddleware,
  authorize('OWNER', 'ADMIN'),
  organizationController.inviteMember,
);

module.exports = router;