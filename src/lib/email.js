const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPasswordResetEmail(to, resetToken) {
  const resetUrl = `${process.env.FRONTEND_RESET_URL}?token=${resetToken}`;

  await resend.emails.send({
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
}

module.exports = { sendPasswordResetEmail };