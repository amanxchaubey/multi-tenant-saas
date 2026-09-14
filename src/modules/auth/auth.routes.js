const express = require('express');
const identityAuthMiddleware = require('../../middleware/identityAuth');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/select-organization', identityAuthMiddleware, authController.selectOrganization);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);

module.exports = router;