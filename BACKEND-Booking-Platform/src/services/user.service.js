// src/services/user.service.js
//
// User service: business logic for user lifecycle and authentication.
// - Responsibilities: register, authenticate (login), logout, public profile retrieval,
//   profile updates, role changes with RBAC checks, and public directory search.
// - Integrates with user repository, JWT helpers, audit service and refresh-token storage.
// - All public functions accept an optional correlationId for tracing/audit.
//
// Important notes:
// - Inputs accept plain passwords; the User model pre-save hook hashes `passwordHash`.
// - Refresh tokens are stored server-side as SHA-256 hashes for revocation support.

const crypto = require('crypto');
const { generateNumericId } = require('../utils/id.generator');
const userRepo = require('../repositories/user.repo');
const { signAccess, signRefresh } = require('../utils/jwt.helper');
const bcrypt = require('bcrypt');
const auditService = require('./audit.service');

const MAX_USERID_ATTEMPTS = 5;

/* -------------------------
 * Helpers
 * ------------------------- */

/**
 * Attempt to generate a unique numeric userId.
 * Tries up to MAX_USERID_ATTEMPTS times before throwing.
 *
 * @returns {Promise<string>}
 */
async function ensureUniqueUserId() {
  for (let i = 0; i < MAX_USERID_ATTEMPTS; i++) {
    const candidate = generateNumericId(16);
    const existing = await userRepo.findByUserId(candidate);
    if (!existing) return candidate;
  }
  const err = new Error('Failed to generate unique userId');
  err.status = 500;
  throw err;
}

/* -------------------------
 * Public API
 * ------------------------- */

/**
 * Register a new user.
 * Signature: register({ firstName, lastName, email, password, role }, correlationId = null)
 *
 * @param {Object} params
 * @param {string} params.firstName
 * @param {string} [params.lastName]
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.role]
 * @param {string|null} correlationId
 * @returns {Promise<Document>} created user document
 */
async function register({ firstName, lastName, email, password, role }, correlationId = null) {
  const actor = { userId: null, role: null };
  if (!firstName || !email || !password) {
    const err = new Error('firstName, email and password are required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    const existing = await userRepo.findByEmail(normalizedEmail);
    if (existing) {
      await auditService.logEvent({
        eventType: 'user.register.failed.duplicate_email',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { email: normalizedEmail }
      });
      const err = new Error('Email already in use');
      err.status = 409;
      throw err;
    }

    const userId = await ensureUniqueUserId();
    const userObj = {
      userId,
      firstName: String(firstName).trim(),
      lastName: lastName ? String(lastName).trim() : '',
      emails: [{ value: normalizedEmail, primary: true }],
      passwordHash: password, // model pre-save will hash
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
      details: { email: normalizedEmail }
    });

    return created;
  } catch (err) {
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
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string|null} correlationId
 * @returns {Promise<{user: Document, accessToken: string, refreshToken: string}>}
 */
async function authenticate({ email, password }, correlationId = null) {
  const actor = { userId: null, role: null };
  if (!email || !password) {
    const err = new Error('email and password are required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    const user = await userRepo.findByEmail(normalizedEmail);
    if (!user) {
      await auditService.logEvent({
        eventType: 'user.login.failed.not_found',
        actor,
        target: { type: 'User', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { email: normalizedEmail }
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
        details: { email: normalizedEmail }
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
 *
 * @param {string} userId
 * @param {string|null} refreshToken
 * @param {string|null} correlationId
 * @returns {Promise<void>}
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
 *
 * @param {string} userId
 * @param {string|null} correlationId
 * @returns {Promise<Object|null>}
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
 * Public directory search for providers.
 * Signature: publicSearch(q = null, opts = {}, correlationId = null)
 *
 * - Delegates to repository publicSearch which wraps model-level text search and filters.
 * - Returns { total, results } where results are plain objects (lean).
 *
 * @param {string|null} q
 * @param {Object} opts
 * @param {string|null} correlationId
 * @returns {Promise<{total:number, results:Array<Object>}>}
 */
async function publicSearch(q = null, opts = {}, correlationId = null) {
  const actor = { userId: null, role: null };
  try {
    await auditService.logEvent({
      eventType: 'user.public_search.attempt',
      actor,
      target: { type: 'User', id: null },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { q: q ? String(q).slice(0, 200) : null, opts }
    });

    const res = await userRepo.publicSearch(q, opts);

    await auditService.logEvent({
      eventType: 'user.public_search.success',
      actor,
      target: { type: 'User', id: null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { total: res.total }
    });

    return res;
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.public_search.failed',
      actor,
      target: { type: 'User', id: null },
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
 *
 * @param {string} userId
 * @param {Object} patch
 * @param {string|null} correlationId
 * @returns {Promise<Document>}
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
 * Change role with RBAC rules.
 * Signature: changeRole(actorUser, targetUserId, newRole, correlationId = null)
 *
 * @param {Object} actorUser - { userId, role }
 * @param {string} targetUserId
 * @param {string} newRole
 * @param {string|null} correlationId
 * @returns {Promise<Document>}
 */
async function changeRole(actorUser, targetUserId, newRole, correlationId = null) {
  const actor = { userId: actorUser && actorUser.userId, role: actorUser && actorUser.role };
  const allowedRoles = ['service_seeker', 'service_provider', 'administrator'];

  if (!allowedRoles.includes(newRole)) {
    await auditService.logEvent({
      eventType: 'user.changeRole.failed.invalid_role',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { attemptedRole: newRole }
    });
    const err = new Error('Invalid role');
    err.status = 400;
    throw err;
  }

  const target = await userRepo.findByUserId(targetUserId);
  if (!target) {
    await auditService.logEvent({
      eventType: 'user.changeRole.failed.not_found',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const isAdmin = actor.role === 'administrator';
  const isSelf = actor.userId === targetUserId;

  if (!isAdmin) {
    if (newRole === 'administrator') {
      await auditService.logEvent({
        eventType: 'user.changeRole.forbidden.assign_admin',
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

    if (!isSelf || !['service_seeker', 'service_provider'].includes(newRole)) {
      await auditService.logEvent({
        eventType: 'user.changeRole.forbidden',
        actor,
        target: { type: 'User', id: targetUserId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { attemptedRole: newRole, isSelf, allowed: ['service_seeker', 'service_provider'] }
      });
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
  }

  if (target.role === newRole) {
    await auditService.logEvent({
      eventType: 'user.changeRole.noop',
      actor,
      target: { type: 'User', id: targetUserId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { currentRole: target.role }
    });
    return target;
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
      details: { previousRole: target.role, newRole }
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
      details: { error: err.message, attemptedRole: newRole }
    });
    throw err;
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  register,
  authenticate,
  logout,
  getPublicProfile,
  publicSearch,
  updateProfile,
  changeRole
};
