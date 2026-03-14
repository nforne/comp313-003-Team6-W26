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
// - Non-disruptive: service.search now performs two independent searches (services and public providers),
//   merges the two result sets into a single collection, and returns a paginated combined response.
//   Provider visibility is respected by relying on the repository/model public search which only returns
//   providers who opted in (IsPublicSearchable).

const { generateServiceId } = require('../utils/id.generator');
const serviceRepo = require('../repositories/service.repo');
const userRepo = require('../repositories/user.repo');
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
 * Public API (create/get/update/remove unchanged)
 * ------------------------- */

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

/* -------------------------
 * Search: services + providers combined
 * ------------------------- */

/**
 * Search services and providers, return a single combined collection.
 * - Performs serviceRepo.searchServices(params) to get service results.
 * - Performs userRepo.publicSearch(q, opts) to get provider profiles (public opt-in).
 * - Merges both result sets into one collection and applies combined pagination.
 * - Provider visibility is respected by userRepo.publicSearch (only opted-in providers returned).
 *
 * Return shape:
 *   {
 *     results: [ ...paged combined items... ],
 *     total: <total combined items>,
 *     page: <page>,
 *     pageSize: <limit>
 *   }
 */
async function search(params = {}, actor = {}, correlationId = null) {
  const auditCtx = { actor, correlationId };

  await auditService.logEvent({
    eventType: 'service.search.attempt',
    actor: auditCtx.actor,
    target: { type: 'Service', id: null },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { params }
  });

  // Normalize pagination for combined results
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 20, 1), 100);

  // 1) Service search (repo-level). Keep original service repo behavior.
  let svcSearchResult = { results: [], total: 0, page: 1, pageSize: 0 };
  try {
    svcSearchResult = await serviceRepo.searchServices(params);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'service.search.services_failed',
      actor: auditCtx.actor,
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message }
    });
    // propagate error: service search failing is likely a system issue
    throw e;
  }
  const svcResults = Array.isArray(svcSearchResult.results) ? svcSearchResult.results : [];

  // 2) Provider search (public profiles). Use free-text q if provided.
  const q = params.q || params.query || null;
  const providerSearchOpts = {
    limit: typeof params.providerLimit !== 'undefined' ? Math.min(Math.max(Number(params.providerLimit) || 0, 0), 200) : 100,
    skip: 0,
    sort: params.providerSort || undefined,
    filters: params.providerFilters || {}
  };

  let providerSearchResult = { total: 0, results: [] };
  try {
    if (typeof userRepo.publicSearch === 'function') {
      providerSearchResult = await userRepo.publicSearch(q, providerSearchOpts);
    }
  } catch (e) {
    // best-effort: log and continue with empty provider results
    await auditService.logEvent({
      eventType: 'service.search.provider_fetch_failed',
      actor: auditCtx.actor,
      target: { type: 'User', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
    providerSearchResult = { total: 0, results: [] };
  }
  const providerProfiles = Array.isArray(providerSearchResult.results) ? providerSearchResult.results : [];

  // 3) Build combined collection
  // Service items: include providerId reference but do not fetch additional provider profiles here.
  const serviceItems = svcResults.map(svc => ({
    type: 'service',
    service: svc
  }));

  // Provider items: each provider profile returned by provider search becomes an item
  const providerItems = providerProfiles.map(p => ({
    type: 'provider',
    profile: p
  }));

  // Combined collection: services first, then providers (caller can reorder if desired)
  const combined = serviceItems.concat(providerItems);

  // 4) Apply pagination to combined collection
  const totalCombined = combined.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const paged = combined.slice(start, end);

  await auditService.logEvent({
    eventType: 'service.search.result',
    actor: auditCtx.actor,
    target: { type: 'Service', id: null },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: {
      returned: paged.length,
      totalCombined,
      serviceCount: serviceItems.length,
      providerCount: providerItems.length,
      page,
      pageSize: limit
    }
  });

  return {
    results: paged,
    total: totalCombined,
    page,
    pageSize: limit
  };
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
