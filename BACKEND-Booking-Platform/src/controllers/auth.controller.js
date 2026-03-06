// src/controllers/auth.controller.js
const userService = require('../services/user.service');
const auditService = require('../services/audit.service');
const { registerSchema, loginSchema } = require('../validators/user.validator');

/**
 * POST /auth/register
 */
async function register(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = registerSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'auth.register.failed.validation',
      actor: { userId: null, role: null },
      target: { type: 'User', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const created = await userService.register(value, correlationId);
    await auditService.logEvent({
      eventType: 'auth.register.success',
      actor: { userId: created.userId, role: created.role },
      target: { type: 'User', id: created.userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { email: (value.email || '').toLowerCase() }
    });
    return res.status(201).json({ user: created.toPublicJSON() });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'auth.register.failed',
      actor: { userId: null, role: null },
      target: { type: 'User', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * POST /auth/login
 */
async function login(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'auth.login.failed.validation',
      actor: { userId: null, role: null },
      target: { type: 'User', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const { user, accessToken, refreshToken } = await userService.authenticate(value, correlationId);

    // set refresh token as httpOnly cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: parseInt(process.env.REFRESH_COOKIE_MAX_AGE_MS || String(7 * 24 * 60 * 60 * 1000), 10)
    };
    res.cookie('refreshToken', refreshToken, cookieOptions);

    await auditService.logEvent({
      eventType: 'auth.login.success',
      actor: { userId: user.userId, role: user.role },
      target: { type: 'User', id: user.userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return res.status(200).json({ accessToken, user: user.toPublicJSON() });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'auth.login.failed',
      actor: { userId: null, role: null },
      target: { type: 'User', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * POST /auth/logout
 * Requires authentication middleware to populate req.user (optional).
 */
async function logout(req, res) {
  const correlationId = req.correlationId || null;
  try {
    const refreshToken = req.cookies && req.cookies.refreshToken;
    const userId = req.user && req.user.userId;

    if (userId && refreshToken) {
      await userService.logout(userId, refreshToken, correlationId);
      await auditService.logEvent({
        eventType: 'auth.logout.success',
        actor: { userId, role: req.user.role || null },
        target: { type: 'User', id: userId },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: {}
      });
    } else {
      await auditService.logEvent({
        eventType: 'auth.logout.attempt',
        actor: { userId: userId || null, role: req.user && req.user.role },
        target: { type: 'User', id: userId || null },
        outcome: 'partial',
        severity: 'info',
        correlationId,
        details: { hasRefreshToken: Boolean(refreshToken) }
      });
    }

    res.clearCookie('refreshToken');
    return res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'auth.logout.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: req.user && req.user.userId || null },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { message: err.message }
    });
    return res.status(500).json({ message: 'Logout failed' });
  }
}

module.exports = { register, login, logout };
