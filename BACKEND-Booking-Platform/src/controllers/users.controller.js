// src/controllers/users.controller.js
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
      return res.status(404).json({ message: 'Not found' });
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

    return res.json({ profile });
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
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * PATCH /users/:id
 * Only allow self-update unless admin.
 */
async function updateProfile(req, res) {
  const correlationId = req.correlationId || null;
  const userId = req.params.id;

  // Authorization check
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
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { error, value } = profileUpdateSchema.validate(req.body);
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
    return res.status(400).json({ message: error.message });
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

    return res.json({ user: updated.toPublicJSON() });
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
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * PATCH /users/:id/role
 * Controller: validate input and enforce basic auth checks.
 * Services are authoritative for domain logging and final authorization.
 */
async function changeRole(req, res) {
  const correlationId = req.correlationId || null;
  const targetUserId = req.params.id;

  // Validate payload
  const { error, value } = roleChangeSchema.validate(req.body);
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
    return res.status(400).json({ message: error.message });
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
    return res.status(401).json({ message: 'Authentication required' });
  }

  // Basic controller-level authorization short-circuits:
  // - Non-admins may only attempt to change their own role.
  // - Non-admins may not attempt to assign administrator role (service will also enforce).
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
    return res.status(403).json({ message: 'Forbidden' });
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
    return res.status(403).json({ message: 'Forbidden' });
  }

  // Delegate to service (service is authoritative and will perform final checks and logging)
  try {
    const updated = await userService.changeRole(actor, targetUserId, value.role, correlationId);
    return res.json({ user: updated.toPublicJSON() });
  } catch (err) {
    // Do not duplicate domain-level audit logs here; service already logs.
    return res.status(err.status || 500).json({ message: err.message });
  }
}


module.exports = { getProfile, updateProfile, changeRole };
