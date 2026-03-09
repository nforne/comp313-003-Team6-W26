// src/controllers/users.controller.js
//
// HTTP controllers for user profile endpoints.
// - getProfile: GET /users/:id
// - updateProfile: PATCH /users/:id  (self or admin)
// - changeRole: PATCH /users/:id/role
//
// Controller responsibilities:
// - Validate request-level authorization and input shape (basic).
// - Delegate domain logic to userService (authoritative).
// - Emit controller-level audit events for observability and quick rejection reasons.
// - Return consistent HTTP status codes and JSON payloads.

const userService = require('../services/user.service');
const auditService = require('../services/audit.service');
const { profileUpdateSchema, roleChangeSchema } = require('../validators/user.validator');

/**
 * GET /users/:id
 */
async function getProfile(req, res) {
  const correlationId = req.correlationId || null;
  const userId = req.params.id;

  try {
    const profile = await userService.getPublicProfile(userId, correlationId);
    if (!profile) {
      await auditService.logEvent({
        eventType: 'user.profile.get.failed.not_found',
        actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
        target: { type: 'User', id: userId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: {}
      });
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    await auditService.logEvent({
      eventType: 'user.profile.get',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { publicView: true }
    });

    return res.json({ ok: true, profile });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.profile.get.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * PATCH /users/:id
 * Only allow self-update unless admin.
 */
async function updateProfile(req, res) {
  const correlationId = req.correlationId || null;
  const userId = req.params.id;

  // Authorization check: self or admin
  if (!req.user || (req.user.userId !== userId && req.user.role !== 'administrator')) {
    await auditService.logEvent({
      eventType: 'user.update.forbidden',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  // Validate input
  const { error, value } = profileUpdateSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    await auditService.logEvent({
      eventType: 'user.update.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  try {
    const updated = await userService.updateProfile(userId, value, correlationId);

    await auditService.logEvent({
      eventType: 'user.update.success',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(value || {}) }
    });

    // updated may be a Mongoose document; use toPublicJSON for safe projection
    return res.json({ ok: true, user: updated.toPublicJSON ? updated.toPublicJSON() : updated });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'user.update.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: userId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * PATCH /users/:id/role
 * Controller-level validation and short-circuit authorization.
 * Service enforces domain rules and performs authoritative logging.
 */
async function changeRole(req, res) {
  const correlationId = req.correlationId || null;
  const targetUserId = req.params.id;

  // Validate payload
  const { error, value } = roleChangeSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    await auditService.logEvent({
      eventType: 'user.changeRole.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  // Require authentication
  if (!req.user || !req.user.userId) {
    await auditService.logEvent({
      eventType: 'user.changeRole.forbidden.unauthenticated',
      actor: { userId: null, role: null },
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    return res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }

  // Controller-level short-circuits:
  const actor = req.user;
  const isAdmin = actor.role === 'administrator';
  const isSelf = actor.userId === targetUserId;

  if (!isAdmin && !isSelf) {
    await auditService.logEvent({
      eventType: 'user.changeRole.forbidden',
      actor: { userId: actor.userId, role: actor.role },
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { attemptedRole: value.role }
    });
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  if (!isAdmin && value.role === 'administrator') {
    await auditService.logEvent({
      eventType: 'user.changeRole.forbidden.assign_admin',
      actor: { userId: actor.userId, role: actor.role },
      target: { type: 'User', id: targetUserId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { attemptedRole: value.role }
    });
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  // Delegate to service (service performs final checks and logs)
  try {
    const updated = await userService.changeRole(actor, targetUserId, value.role, correlationId);
    return res.json({ ok: true, user: updated.toPublicJSON ? updated.toPublicJSON() : updated });
  } catch (err) {
    // Service already logs domain-level events; surface status and message
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

module.exports = { getProfile, updateProfile, changeRole };
