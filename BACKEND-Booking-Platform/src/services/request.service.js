// src/services/request.service.js
const requestRepo = require('../repositories/request.repo');
const serviceRepo = require('../repositories/service.repo'); // used to resolve serviceId -> providerId
const { notifyProviders } = require('../utils/notification.stub');
const auditService = require('./audit.service');

/**
 * Helper: detect if a string looks like a serviceId (svc_123...) or a provider userId.
 * Adjust pattern as needed for your id formats.
 */
function isServiceId(token) {
  return typeof token === 'string' && token.startsWith('svc_');
}

function dedupeArray(arr = []) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Resolve provider userIds from the provided services array.
 * - service entries that are serviceIds (svc_...) are resolved to their providerId via Service repo.
 * - entries that look like userIds are treated as providerIds directly.
 * Returns { providerIds: [...], unresolvedServiceIds: [...] }
 */
async function resolveProvidersFromServices(services = []) {
  const providerIds = [];
  const unresolvedServiceIds = [];

  for (const entry of services || []) {
    if (!entry) continue;
    if (isServiceId(entry)) {
      try {
        const svc = await serviceRepo.findByServiceId(entry);
        if (svc && svc.providerId) {
          providerIds.push(svc.providerId);
        } else {
          unresolvedServiceIds.push(entry);
        }
      } catch (e) {
        // log and mark unresolved
        console.warn('[request.service] error resolving serviceId', entry, e && e.message);
        unresolvedServiceIds.push(entry);
      }
    } else {
      // treat as provider userId (no strict validation here)
      providerIds.push(entry);
    }
  }

  return { providerIds: dedupeArray(providerIds), unresolvedServiceIds };
}

/**
 * Create a request.
 * - Any authenticated user may create a request.
 * - If isPrivate === true, services[] entries are resolved to providerIds and merged with allowedProviders.
 * - Final allowedProviders contains only provider userIds (no serviceIds) and is deduplicated.
 * - If private and no providerIds resolved, throw 400.
 *
 * New signature: createRequest(payload, actor, correlationId = null)
 */
async function createRequest(payload, actor, correlationId = null) {
  // audit context helper
  const auditCtx = { actor: actor || {}, correlationId };

  if (!actor || !actor.userId) {
    await auditService.logEvent({
      eventType: 'request.create.failed.unauthenticated',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { reason: 'authentication_required' }
    });
    const err = new Error('Authentication required to create request');
    err.status = 401;
    throw err;
  }

  // Build base object
  const obj = Object.assign({}, payload, { createdBy: actor.userId });

  // If private, resolve providerIds from services and merge with allowedProviders
  if (obj.isPrivate) {
    const servicesList = Array.isArray(obj.services) ? obj.services : [];
    const clientAllowed = Array.isArray(obj.allowedProviders) ? obj.allowedProviders : [];

    // Log attempt to resolve providers
    await auditService.logEvent({
      eventType: 'request.resolve_providers.attempt',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { servicesList, clientAllowed }
    });

    const { providerIds: resolvedFromServices, unresolvedServiceIds } = await resolveProvidersFromServices(servicesList);

    // Log resolution result
    await auditService.logEvent({
      eventType: 'request.resolve_providers.result',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: unresolvedServiceIds.length ? 'partial' : 'success',
      severity: unresolvedServiceIds.length ? 'warning' : 'info',
      correlationId,
      details: { resolvedFromServices, unresolvedServiceIds }
    });

    // Merge resolved providerIds with any client-provided allowedProviders
    const mergedProviders = dedupeArray([...(clientAllowed || []), ...resolvedFromServices]);

    if (mergedProviders.length === 0) {
      await auditService.logEvent({
        eventType: 'request.create.failed.no_providers',
        actor: auditCtx.actor,
        target: { type: 'Request', id: null },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { unresolvedServiceIds }
      });
      const err = new Error('Private request must target at least one provider (via serviceId or providerId). Unresolved serviceIds: ' + (unresolvedServiceIds.join(', ') || 'none'));
      err.status = 400;
      throw err;
    }

    obj.allowedProviders = mergedProviders;
    // Note: keep services[] as originally provided for traceability.
  } else {
    // public request: ensure allowedProviders is empty (server-side) to avoid accidental exposure
    obj.allowedProviders = [];
  }

  // Persist request
  let created;
  try {
    created = await requestRepo.createRequest(obj);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.create.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message, payload: obj }
    });
    throw e;
  }

  // Audit successful creation
  await auditService.logEvent({
    eventType: 'request.create',
    actor: auditCtx.actor,
    target: { type: 'Request', id: created._id ? created._id.toString() : null },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { isPrivate: created.isPrivate, allowedProviders: created.allowedProviders, services: created.services }
  });

  // Send notifications to provider accounts (only provider userIds)
  try {
    if (created.isPrivate) {
      await notifyProviders({
        providerIds: created.allowedProviders,
        message: `New private request: ${created.title}`,
        metadata: { requestId: created._id, createdBy: created.createdBy }
      });

      await auditService.logEvent({
        eventType: 'request.notify.providers',
        actor: auditCtx.actor,
        target: { type: 'Request', id: created._id.toString() },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { notifiedProviders: created.allowedProviders }
      });
    } else {
      // For public requests, we currently do not target specific providers.
      await notifyProviders({
        providerIds: [],
        message: `New public request: ${created.title}`,
        metadata: { requestId: created._id, createdBy: created.createdBy }
      });

      await auditService.logEvent({
        eventType: 'request.notify.providers.public',
        actor: auditCtx.actor,
        target: { type: 'Request', id: created._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: {}
      });
    }
  } catch (e) {
    // Do not fail creation if notification fails; log for debugging
    console.error('[request.service] notification error', e && e.message);
    await auditService.logEvent({
      eventType: 'request.notify.failed',
      actor: auditCtx.actor,
      target: { type: 'Request', id: created._id.toString() },
      outcome: 'partial',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
  }

  return created;
}

/**
 * Get a request by id with visibility enforcement.
 * - Private requests: only owner, admins, or provider in allowedProviders can access.
 *
 * New signature: getRequest(id, actor, correlationId = null)
 */
async function getRequest(id, actor, correlationId = null) {
  const auditCtx = { actor: actor || {}, correlationId };

  const req = await requestRepo.findById(id);
  if (!req) {
    await auditService.logEvent({
      eventType: 'request.get.failed.not_found',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  if (req.isPrivate) {
    if (!actor || !actor.userId) {
      await auditService.logEvent({
        eventType: 'request.get.forbidden.unauthenticated',
        actor: auditCtx.actor,
        target: { type: 'Request', id },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: {}
      });
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
    const isOwner = actor.userId === req.createdBy;
    const isAdmin = actor.role === 'administrator';
    const isAllowedProvider = Array.isArray(req.allowedProviders) && req.allowedProviders.includes(actor.userId);
    if (!isOwner && !isAdmin && !isAllowedProvider) {
      await auditService.logEvent({
        eventType: 'request.get.forbidden',
        actor: auditCtx.actor,
        target: { type: 'Request', id },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: {}
      });
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
  }

  await auditService.logEvent({
    eventType: 'request.get',
    actor: auditCtx.actor,
    target: { type: 'Request', id },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: {}
  });

  return req;
}

/**
 * Search open requests.
 * - Providers see public requests + private requests where their userId is in allowedProviders.
 * - Non-authenticated users and customers see only public requests.
 *
 * New signature: searchOpenRequests(queryParams = {}, actor = null, correlationId = null)
 */
async function searchOpenRequests(queryParams = {}, actor = null, correlationId = null) {
  const auditCtx = { actor: actor || {}, correlationId };
  const { categories, location, near, radiusMeters = 50000, page = 1, pageSize = 20 } = queryParams;

  await auditService.logEvent({
    eventType: 'request.search.attempt',
    actor: auditCtx.actor,
    target: { type: 'Request', id: null },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { categories, location, near, page, pageSize }
  });

  const results = await requestRepo.searchOpenRequests({ categories, location, near, radiusMeters, page, pageSize });

  // Filter visibility
  if (actor && actor.role === 'service_provider') {
    results.results = results.results.filter(r => {
      if (!r.isPrivate) return true;
      return Array.isArray(r.allowedProviders) && r.allowedProviders.includes(actor.userId);
    });
  } else {
    // customers and unauthenticated users only see public requests
    results.results = results.results.filter(r => !r.isPrivate);
  }

  results.total = results.results.length;

  await auditService.logEvent({
    eventType: 'request.search.result',
    actor: auditCtx.actor,
    target: { type: 'Request', id: null },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { returned: results.results.length, total: results.total }
  });

  return results;
}

/**
 * Update request (owner or admin)
 *
 * New signature: updateRequest(id, patch, actor, correlationId = null)
 */
async function updateRequest(id, patch, actor, correlationId = null) {
  const auditCtx = { actor: actor || {}, correlationId };

  const req = await requestRepo.findById(id);
  if (!req) {
    await auditService.logEvent({
      eventType: 'request.update.failed.not_found',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  if (actor.role !== 'administrator' && actor.userId !== req.createdBy) {
    await auditService.logEvent({
      eventType: 'request.update.forbidden',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
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
    eventType: 'request.update.attempt',
    actor: auditCtx.actor,
    target: { type: 'Request', id },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { patch }
  });

  // If changing isPrivate or services on an existing request, re-run provider resolution logic
  if (patch.isPrivate !== undefined || (Array.isArray(patch.services) && patch.services.length > 0)) {
    const newIsPrivate = patch.isPrivate !== undefined ? patch.isPrivate : req.isPrivate;
    const servicesList = Array.isArray(patch.services) && patch.services.length ? patch.services : req.services;
    const clientAllowed = Array.isArray(patch.allowedProviders) ? patch.allowedProviders : req.allowedProviders || [];

    if (newIsPrivate) {
      const { providerIds: resolvedFromServices, unresolvedServiceIds } = await resolveProvidersFromServices(servicesList);
      const mergedProviders = dedupeArray([...(clientAllowed || []), ...resolvedFromServices]);
      if (mergedProviders.length === 0) {
        await auditService.logEvent({
          eventType: 'request.update.failed.no_providers',
          actor: auditCtx.actor,
          target: { type: 'Request', id },
          outcome: 'failure',
          severity: 'error',
          correlationId,
          details: { unresolvedServiceIds }
        });
        const err = new Error('Private request must target at least one provider (via serviceId or providerId). Unresolved serviceIds: ' + (unresolvedServiceIds.join(', ') || 'none'));
        err.status = 400;
        throw err;
      }
      patch.allowedProviders = mergedProviders;
    } else {
      // switching to public: clear allowedProviders
      patch.allowedProviders = [];
    }
  }

  let updated;
  try {
    updated = await requestRepo.updateById(id, patch);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.update.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message, patch }
    });
    throw e;
  }

  await auditService.logEvent({
    eventType: 'request.update',
    actor: auditCtx.actor,
    target: { type: 'Request', id },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { patch, updatedAt: updated.updatedAt }
  });

  return updated;
}

module.exports = {
  createRequest,
  getRequest,
  searchOpenRequests,
  updateRequest,
  resolveProvidersFromServices
};
