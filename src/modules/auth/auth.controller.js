const authService = require('./auth.service');

async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email, and password are required' });
    }

    const { user, identityToken } = await authService.signup({ name, email, password });
    res.status(201).json({ success: true, user, identityToken });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, memberships, identityToken } = await authService.login({ email, password });
    res.json({ success: true, user, memberships, identityToken });
  } catch (err) {
    next(err);
  }
}

async function selectOrganization(req, res, next) {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ success: false, message: 'orgId is required' });

    const { accessToken, refreshToken, role } = await authService.selectOrganization(req.userId, orgId);
    res.json({ success: true, accessToken, refreshToken, role });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'refreshToken is required' });

    const result = await authService.refreshAccessToken(refreshToken);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await authService.logout(refreshToken);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'email is required' });

    await authService.requestPasswordReset(email);

    // Always the same response, whether or not the email exists.
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'token and newPassword are required' });
    }

    await authService.resetPassword(token, newPassword);
    res.json({ success: true, message: 'Password has been reset. Please log in again.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login, selectOrganization, refresh, logout, forgotPassword, resetPassword };