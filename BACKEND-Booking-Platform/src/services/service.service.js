// src/services/service.service.js
const { generateServiceId } = require('../utils/id.generator');
const serviceRepo = require('../repositories/service.repo');
const auditService = require('./audit.service');

/**
 * Attempt to generate a unique serviceId (svc_{12digits})
 */
async function ensureUniqueServiceId() {
  for (let i = 0; i < 5; i++) {
    const candidate = generateServiceId();
    const existing = await serviceRepo.findByServiceId(candidate);
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique serviceId');
}

/**
 * Create a new service.
 * Signature: createService(payload, actor = {}, correlationId = null)
 */
async function createService(payload, actor = {}, correlationId = null) {
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
 */
async function getService(serviceId, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };
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
 */
async function updateService(serviceId, patch, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

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
    details: { updatedFields: Object.keys(patch) }
  });

  return updated;
}

/**
 * Remove a service.
 * Enforces ownership unless actor is administrator.
 * Signature: removeService(serviceId, actor = {}, correlationId = null)
 */
async function removeService(serviceId, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

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

module.exports = {
  createService,
  getService,
  updateService,
  removeService,
  search
};
