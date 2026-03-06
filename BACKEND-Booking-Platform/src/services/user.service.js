// src/services/user.service.js
const crypto = require('crypto');
const { generateNumericId } = require('../utils/id.generator');
const userRepo = require('../repositories/user.repo');
const { signAccess, signRefresh } = require('../utils/jwt.helper');
const bcrypt = require('bcrypt');
const auditService = require('./audit.service');

/**
 * Helper: attempt to generate a unique 16-digit userId
 */
async function ensureUniqueUserId() {
  for (let i = 0; i < 5; i++) {
    const candidate = generateNumericId(16);
    const existing = await userRepo.findByUserId(candidate);
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique userId');
}

/**
 * Register a new user.
 * Signature: register({ firstName, lastName, email, password, role }, correlationId = null)
 */
async function register({ firstName, lastName, email, password, role }, correlationId = null) {
  const actor = { userId: null, role: null };
  try {
    const existing = await userRepo.findByEmail(email);
    if (existing) {
      await auditService.logEvent({
        eventType: 'user.register.failed.duplicate_email',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { email }
      });
      const err = new Error('Email already in use');
      err.status = 409;
      throw err;
    }

    const userId = await ensureUniqueUserId();
    const userObj = {
      userId,
      firstName,
      lastName,
      emails: [{ value: email.toLowerCase(), primary: true }],
      passwordHash: password,
      role
    };

    const created = await userRepo.createUser(userObj);

    await auditService.logEvent({
      eventType: 'user.register',
      actor: { userId: created.userId, role: created.role },
      target: { type: 'User', id: created.userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { email: email.toLowerCase() }
    });

    return created;
  } catch (err) {
    // If error already has status, rethrow after logging DB error if applicable
    if (!err.status) {
      await auditService.logEvent({
        eventType: 'user.register.failed.error',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err.message }
      });
    }
    throw err;
  }
}

/**
 * Authenticate (login).
 * Signature: authenticate({ email, password }, correlationId = null)
 * Returns { user, accessToken, refreshToken }
 */
async function authenticate({ email, password }, correlationId = null) {
  const actor = { userId: null, role: null };
  try {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      await auditService.logEvent({
        eventType: 'user.login.failed.not_found',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { email }
      });
      const err = new Error('Invalid credentials');
      err.status = 401;
      throw err;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await auditService.logEvent({
        eventType: 'user.login.failed.invalid_password',
        actor: { userId: user.userId, role: user.role },
        target: { type: 'User', id: user.userId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { email }
      });
      const err = new Error('Invalid credentials');
      err.status = 401;
      throw err;
    }

    // generate tokens
    const payload = { userId: user.userId, role: user.role };
    const accessToken = signAccess(payload);
    const refreshToken = signRefresh({ userId: user.userId });

    // store hashed refresh token server-side
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await userRepo.addRefreshToken(user.userId, tokenHash);

    await auditService.logEvent({
      eventType: 'user.login.success',
      actor: { userId: user.userId, role: user.role },
      target: { type: 'User', id: user.userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return { user, accessToken, refreshToken };
  } catch (err) {
    // Already logged specific failure events above; log unexpected errors
    if (!err.status) {
      await auditService.logEvent({
        eventType: 'user.login.failed.error',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err.message }
      });
    }
    throw err;
  }
}

/**
 * Logout: remove refresh token from store.
 * Signature: logout(userId, refreshToken, correlationId = null)
 */
async function logout(userId, refreshToken, correlationId = null) {
  const actor = { userId, role: null };
  try {
    if (!refreshToken) {
      await auditService.logEvent({
        eventType: 'user.logout.attempt.no_token',
        actor,
        target: { type: 'User', id: userId },
        outcome: 'partial',
        severity: 'info',
        correlationId,
        details: {}
      });
      return;
    }
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await userRepo.removeRefreshToken(userId, tokenHash);

    await auditService.logEvent({
      eventType: 'user.logout',
      actor,
      target: { type: 'User', id: userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.logout.failed',
      actor,
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: err.message }
    });
    throw err;
  }
}

/**
 * Get public profile (no sensitive fields).
 * Signature: getPublicProfile(userId, correlationId = null)
 */
async function getPublicProfile(userId, correlationId = null) {
  try {
    const user = await userRepo.findPublicById(userId);
    if (!user) return null;

    await auditService.logEvent({
      eventType: 'user.profile.view',
      actor: { userId: null, role: null },
      target: { type: 'User', id: userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { publicView: true }
    });

    return user.toPublicJSON();
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.profile.view.failed',
      actor: { userId: null, role: null },
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: err.message }
    });
    throw err;
  }
}

/**
 * Update profile (self or admin).
 * Signature: updateProfile(userId, patch, correlationId = null)
 */
async function updateProfile(userId, patch, correlationId = null) {
  const actor = { userId, role: null };
  try {
    // prevent role/status changes here
    delete patch.role;
    delete patch.status;
    if (patch.password) {
      patch.passwordHash = patch.password;
      delete patch.password;
    }

    await auditService.logEvent({
      eventType: 'user.update.attempt',
      actor,
      target: { type: 'User', id: userId },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { patch }
    });

    const updated = await userRepo.updateByUserId(userId, patch);

    await auditService.logEvent({
      eventType: 'user.update',
      actor,
      target: { type: 'User', id: userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return updated;
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.update.failed',
      actor,
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: err.message }
    });
    throw err;
  }
}

/**
 * Change role (admin-only).
 * Signature: changeRole(adminUser, targetUserId, newRole, correlationId = null)
 */
async function changeRole(adminUser, targetUserId, newRole, correlationId = null) {
  const actor = { userId: adminUser.userId, role: adminUser.role };
  if (adminUser.role !== 'administrator') {
    await auditService.logEvent({
      eventType: 'user.changeRole.forbidden',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { attemptedRole: newRole }
    });
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  try {
    const updated = await userRepo.updateByUserId(targetUserId, { role: newRole });

    await auditService.logEvent({
      eventType: 'user.changeRole',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { newRole }
    });

    return updated;
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.changeRole.failed',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: err.message, newRole }
    });
    throw err;
  }
}

module.exports = {
  register,
  authenticate,
  logout,
  getPublicProfile,
  updateProfile,
  changeRole
};
