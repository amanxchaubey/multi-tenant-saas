const { Resend } = require('resend');
const logger = require('../config/logger');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendPasswordResetEmail(to, resetToken) {
  if (!resend) {
    logger.warn({ to }, 'RESEND_API_KEY not set — skipping password reset email (dev/CI mode)');
    return null;
  }

  const resetUrl = `${process.env.FRONTEND_RESET_URL}?token=${resetToken}`;

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: 'Reset your password',
    html: `
      <p>Someone requested a password reset for your account.</p>
      <p>If this was you, use this token to reset your password (via the API, or the link below):</p>
      <p><strong>Token:</strong> ${resetToken}</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This token expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    `,
  });

  if (error) {
    logger.error({ error, to }, 'Failed to send password reset email via Resend');
    throw new Error(`Failed to send email: ${error.message || JSON.stringify(error)}`);
  }

  logger.info({ emailId: data?.id, to }, 'Password reset email sent');
  return data;
}

async function sendVerificationEmail(to, verificationToken) {
  if (!resend) {
    logger.warn({ to }, 'RESEND_API_KEY not set — skipping verification email (dev/CI mode)');
    return null;
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: 'Verify your email',
    html: `
      <p>Welcome! Please verify your email address to finish setting up your account.</p>
      <p><strong>Verification token:</strong> ${verificationToken}</p>
      <p>This token expires in 24 hours.</p>
    `,
  });

  if (error) {
    logger.error({ error, to }, 'Failed to send verification email via Resend');
    throw new Error(`Failed to send email: ${error.message || JSON.stringify(error)}`);
  }

  logger.info({ emailId: data?.id, to }, 'Verification email sent');
  return data;
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };