const express = require('express');
const identityAuthMiddleware = require('../../middleware/identityAuth');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/select-organization', identityAuthMiddleware, authController.selectOrganization);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;