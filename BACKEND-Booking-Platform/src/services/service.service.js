// src/services/service.service.js
//
// Business logic for Service entities.
// - Responsibilities: create, read, update, delete and search services.
// - Enforces ownership and RBAC rules (administrator vs provider).
// - Emits structured audit events for observability and troubleshooting.
// - Uses repository layer for persistence and keeps service-level validation/guards.
//
// Notes:
// - `actor` is expected to be an object like { userId, role } and is used for authorization and audit context.
// - `correlationId` is optional and propagated to audit events for traceability.

const { generateServiceId } = require('../utils/id.generator');
const serviceRepo = require('../repositories/service.repo');
const auditService = require('./audit.service');

const MAX_ID_ATTEMPTS = 5;

/* -------------------------
 * Helpers
 * ------------------------- */

/**
 * Attempt to generate a unique serviceId.
 * Tries up to MAX_ID_ATTEMPTS times before throwing.
 *
 * @returns {Promise<string>}
 */
async function ensureUniqueServiceId() {
  for (let i = 0; i < MAX_ID_ATTEMPTS; i++) {
    const candidate = generateServiceId();
    const existing = await serviceRepo.findByServiceId(candidate);
    if (!existing) return candidate;
  }
  const err = new Error('Failed to generate unique serviceId');
  err.status = 500;
  throw err;
}

/* -------------------------
 * Public API
 * ------------------------- */

/**
 * Create a new service.
 * Signature: createService(payload, actor = {}, correlationId = null)
 *
 * @param {Object} payload - service payload (must include providerId and name)
 * @param {Object} actor - { userId, role }
 * @param {string|null} correlationId
 * @returns {Promise<Document>} created service document
 */
async function createService(payload = {}, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

  await auditService.logEvent({
    eventType: 'service.create.attempt',
    actor: auditCtx.actor,
    target: { type: 'Service', id: null },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { payload }
  });

  if (!payload || !payload.providerId || !payload.name) {
    const err = new Error('providerId and name are required');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'service.create.failed.validation',
      actor: auditCtx.actor,
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { reason: 'missing providerId or name' }
    });
    throw err;
  }

  // ensure provider doesn't already have a service with same name
  const existing = await serviceRepo.findByProviderAndName(payload.providerId, payload.name);
  if (existing) {
    await auditService.logEvent({
      eventType: 'service.create.failed.duplicate_name',
      actor: auditCtx.actor,
      target: { type: 'Service', id: existing.serviceId || null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { providerId: payload.providerId, name: payload.name }
    });
    const err = new Error('Service name already exists for this provider');
    err.status = 409;
    throw err;
  }

  const serviceId = await ensureUniqueServiceId();
  const obj = Object.assign({}, payload, { serviceId });

  let created;
  try {
    created = await serviceRepo.createService(obj);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'service.create.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message, payload: obj }
    });
    throw e;
  }

  await auditService.logEvent({
    eventType: 'service.create',
    actor: auditCtx.actor,
    target: { type: 'Service', id: created.serviceId },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { providerId: created.providerId, name: created.name }
  });

  return created;
}

/**
 * Get a service by serviceId.
 * Signature: getService(serviceId, actor = {}, correlationId = null)
 *
 * @param {string} serviceId
 * @param {Object} actor
 * @param {string|null} correlationId
 * @returns {Promise<Document>}
 */
async function getService(serviceId, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

  if (!serviceId) {
    const err = new Error('serviceId is required');
    err.status = 400;
    throw err;
  }

  const svc = await serviceRepo.findByServiceId(serviceId);
  if (!svc) {
    await auditService.logEvent({
      eventType: 'service.get.failed.not_found',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  await auditService.logEvent({
    eventType: 'service.get',
    actor: auditCtx.actor,
    target: { type: 'Service', id: serviceId },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: {}
  });

  return svc;
}

/**
 * Update a service.
 * Enforces ownership unless actor is administrator.
 * Signature: updateService(serviceId, patch, actor = {}, correlationId = null)
 *
 * @param {string} serviceId
 * @param {Object} patch
 * @param {Object} actor
 * @param {string|null} correlationId
 * @returns {Promise<Document>}
 */
async function updateService(serviceId, patch = {}, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

  if (!serviceId) {
    const err = new Error('serviceId is required');
    err.status = 400;
    throw err;
  }

  const svc = await serviceRepo.findByServiceId(serviceId);
  if (!svc) {
    await auditService.logEvent({
      eventType: 'service.update.failed.not_found',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  // Authorization: admin or provider owner
  if (actor.role !== 'administrator' && actor.userId !== svc.providerId) {
    await auditService.logEvent({
      eventType: 'service.update.forbidden',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  await auditService.logEvent({
    eventType: 'service.update.attempt',
    actor: auditCtx.actor,
    target: { type: 'Service', id: serviceId },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { patch }
  });

  // if name change, ensure uniqueness per provider
  if (patch.name && patch.name !== svc.name) {
    const dup = await serviceRepo.findByProviderAndName(svc.providerId, patch.name);
    if (dup) {
      await auditService.logEvent({
        eventType: 'service.update.failed.duplicate_name',
        actor: auditCtx.actor,
        target: { type: 'Service', id: serviceId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { attemptedName: patch.name }
      });
      const err = new Error('Service name already exists for this provider');
      err.status = 409;
      throw err;
    }
  }

  let updated;
  try {
    updated = await serviceRepo.updateByServiceId(serviceId, patch);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'service.update.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message, patch }
    });
    throw e;
  }

  await auditService.logEvent({
    eventType: 'service.update',
    actor: auditCtx.actor,
    target: { type: 'Service', id: serviceId },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { updatedFields: Object.keys(patch || {}) }
  });

  return updated;
}

/**
 * Remove a service.
 * Enforces ownership unless actor is administrator.
 * Signature: removeService(serviceId, actor = {}, correlationId = null)
 *
 * @param {string} serviceId
 * @param {Object} actor
 * @param {string|null} correlationId
 * @returns {Promise<Document>} deleted document
 */
async function removeService(serviceId, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

  if (!serviceId) {
    const err = new Error('serviceId is required');
    err.status = 400;
    throw err;
  }

  const svc = await serviceRepo.findByServiceId(serviceId);
  if (!svc) {
    await auditService.logEvent({
      eventType: 'service.delete.failed.not_found',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  if (actor.role !== 'administrator' && actor.userId !== svc.providerId) {
    await auditService.logEvent({
      eventType: 'service.delete.forbidden',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  try {
    const deleted = await serviceRepo.deleteByServiceId(serviceId);
    await auditService.logEvent({
      eventType: 'service.delete',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { providerId: svc.providerId, name: svc.name }
    });
    return deleted;
  } catch (e) {
    await auditService.logEvent({
      eventType: 'service.delete.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message }
    });
    throw e;
  }
}

/**
 * Search services (pass-through to repo).
 * Signature: search(params, actor = {}, correlationId = null)
 *
 * @param {Object} params
 * @param {Object} actor
 * @param {string|null} correlationId
 * @returns {Promise<{results: Document[], total: number, page: number, pageSize: number}>}
 */
async function search(params = {}, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };
  await auditService.logEvent({
    eventType: 'service.search',
    actor: auditCtx.actor,
    target: { type: 'Service', id: null },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { params }
  });

  const results = await serviceRepo.searchServices(params);

  await auditService.logEvent({
    eventType: 'service.search.result',
    actor: auditCtx.actor,
    target: { type: 'Service', id: null },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { returned: results.results.length, total: results.total }
  });

  return results;
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createService,
  getService,
  updateService,
  removeService,
  search
};
