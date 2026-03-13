// src/services/request.service.js
/**
 * Request service (updated)
 *
 * - Adds in-process setTimeout-based expiration handling:
 *   * When a request becomes `active` and has `expiresAt` set, a countdown is scheduled.
 *   * If the request status changes away from `active` or expiresAt is cleared/changed, the timeout is cleared and rescheduled as appropriate.
 *   * When the timeout fires, the request is marked `expired` (if still `active`) and audit/notification are emitted.
 *
 * Notes:
 * - This uses in-memory timers (setTimeout). Timers do NOT survive process restarts.
 * - For production, add a persistent scheduler (Agenda, Bull, or DB-backed reconciliation) to guarantee delivery across restarts.
 * - The implementation keeps a Map of timers keyed by request._id.toString().
 */

const mongoose = require('mongoose');
const requestRepo = require('../repositories/request.repo');
const serviceRepo = require('../repositories/service.repo');
const auditService = require('./audit.service');
const worker = require('../jobs/request.service.worker'); // scheduleExpiryForRequest, clearExpiryForRequestId, markRequestExpired, validateWhenSlots

// message persistence and delivery (kept as direct requires to preserve behavior)
let messageRepo;
try { messageRepo = require('../repositories/message.repo'); } catch (e) { messageRepo = null; }
let comms;
try { comms = require('../comms-js'); } catch (e) { comms = null; }

// dev stub (optional)
let notifyProviders;
try { notifyProviders = require('../utils/notification.stub').notifyProviders; } catch (e) { notifyProviders = null; }

function isServiceId(token) { return typeof token === 'string' && token.startsWith('svc_'); }
function dedupeArray(arr = []) { return Array.from(new Set((arr || []).filter(Boolean))); }

/**
 * Resolve provider ids from a mixed services array (serviceId or providerId).
 * Returns { providerIds: [...], unresolvedServiceIds: [...] }
 */
async function resolveProvidersFromServices(services = []) {
  const providerIds = [];
  const unresolvedServiceIds = [];

  for (const entry of services || []) {
    if (!entry) continue;
    if (isServiceId(entry)) {
      try {
        if (serviceRepo && typeof serviceRepo.findByServiceId === 'function') {
          const svc = await serviceRepo.findByServiceId(entry);
          if (svc && svc.providerId) providerIds.push(String(svc.providerId));
          else unresolvedServiceIds.push(entry);
        } else {
          unresolvedServiceIds.push(entry);
        }
      } catch (e) {
        console.warn('[request.service] error resolving serviceId', entry, e && e.message);
        unresolvedServiceIds.push(entry);
      }
    } else {
      providerIds.push(String(entry));
    }
  }

  return { providerIds: dedupeArray(providerIds), unresolvedServiceIds };
}

/**
 * Delegate to worker for consistent expiry behavior.
 */
async function markRequestExpired(requestId, correlationId = null) {
  return worker.markRequestExpired(requestId, correlationId);
}

/* -------------------------
 * Public service API
 * ------------------------- */

/**
 * Create a request.
 * - Validates `when` via worker.validateWhenSlots (service logs validation failures).
 * - Resolves allowedProviders for private requests.
 * - Schedules expiry via worker if created.status === 'active' and expiresAt present.
 */
async function createRequest(payload = {}, actor = {}, correlationId = null) {
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

  const obj = Object.assign({}, payload, { createdBy: actor.userId });

  // Validate `when` slots using worker helper (returns structured result)
  const validation = worker.validateWhenSlots(obj.when);
  if (!validation.valid) {
    // service-level logging of all failing slots
    await auditService.logEvent({
      eventType: 'request.create.failed.invalid_when',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when, errors: validation.errors }
    });
    const msg = validation.errors
      .map(e => (e.index === null ? `${e.message}` : `slot[${e.index}] ${e.message}`))
      .join('; ');
    const err = new Error(`Invalid when slots: ${msg}`);
    err.status = 400;
    throw err;
  }
  const maxTo = validation.maxTo;

  // If expiresAt provided, ensure it is a valid number and not after maxTo
  if (obj.expiresAt !== undefined && obj.expiresAt !== null) {
    const expiresAtNum = Number(obj.expiresAt);
    if (Number.isNaN(expiresAtNum)) {
      await auditService.logEvent({
        eventType: 'request.create.failed.invalid_expiresAt',
        actor: auditCtx.actor,
        target: { type: 'Request', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { expiresAt: obj.expiresAt }
      });
      const err = new Error('"expiresAt" must be a valid epoch millisecond number');
      err.status = 400;
      throw err;
    }
    if (expiresAtNum > maxTo) {
      await auditService.logEvent({
        eventType: 'request.create.failed.expiresAt_after_to',
        actor: auditCtx.actor,
        target: { type: 'Request', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { expiresAt: expiresAtNum, maxTo }
      });
      const err = new Error('"expiresAt" must not be after the latest "when.to" across slots');
      err.status = 400;
      throw err;
    }
    obj.expiresAt = expiresAtNum;
  }

  // Resolve allowedProviders for private requests
  if (obj.isPrivate) {
    const servicesList = Array.isArray(obj.services) ? obj.services : [];
    const clientAllowed = Array.isArray(obj.allowedProviders) ? obj.allowedProviders : [];

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

    await auditService.logEvent({
      eventType: 'request.resolve_providers.result',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: unresolvedServiceIds.length ? 'partial' : 'success',
      severity: unresolvedServiceIds.length ? 'warning' : 'info',
      correlationId,
      details: { resolvedFromServices, unresolvedServiceIds }
    });

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
  } else {
    obj.allowedProviders = [];
  }

  // create via repo
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

  await auditService.logEvent({
    eventType: 'request.create',
    actor: auditCtx.actor,
    target: { type: 'Request', id: created._id ? created._id.toString() : null },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { isPrivate: created.isPrivate, allowedProviders: created.allowedProviders, services: created.services }
  });

  // schedule expiry if active and expiresAt present (worker handles timers)
  try {
    if (created.status === 'active' && created.expiresAt) {
      await worker.scheduleExpiryForRequest(created, correlationId);
    }
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.expire.schedule_failed',
      actor: auditCtx.actor,
      target: { type: 'Request', id: created._id ? created._id.toString() : null },
      outcome: 'partial',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
  }

  // minimal notification behavior preserved (best-effort)
  try {
    const seekerId = created && created.createdBy ? String(created.createdBy) : null;
    const allowed = Array.isArray(created && created.allowedProviders) ? created.allowedProviders.map(String) : [];
    let recipients = [];

    if (allowed && allowed.length > 0) recipients = dedupeArray([seekerId, ...allowed]);
    else if (seekerId) recipients = [seekerId];

    if (recipients.length > 0 && messageRepo && typeof messageRepo.createMessage === 'function') {
      const recipientObjectIds = recipients.filter(Boolean).map(r => (mongoose.Types.ObjectId.isValid(r) ? mongoose.Types.ObjectId(r) : r));

      const messageDoc = {
        type: 'notification',
        recipientsAll: false,
        recipients: recipientObjectIds,
        userId: created.createdBy || null,
        subject: created.isPrivate ? `New private request: ${created.title}` : `New request created: ${created.title}`,
        details: created.isPrivate
          ? `A private request "${created.title}" has been created and targets specific providers.`
          : `A new request "${created.title}" has been created.`,
        idempotencyKey: `request-create-${created._id.toString()}`,
        status: 'submitted',
        metadata: { requestId: created._id.toString(), createdBy: created.createdBy }
      };

      let persisted;
      try {
        persisted = await messageRepo.createMessage(messageDoc);
      } catch (e) {
        await auditService.logEvent({
          eventType: 'request.notify.persist_failed',
          actor: auditCtx.actor,
          target: { type: 'Request', id: created._id.toString() },
          outcome: 'partial',
          severity: 'warning',
          correlationId,
          details: { error: e && e.message }
        });
      }

      if (persisted && persisted._id) {
        try {
          if (comms && typeof comms.deliverMessage === 'function') {
            await comms.deliverMessage(persisted._id, { actor: auditCtx.actor, correlationId, asyncBroadcast: true });
          }
        } catch (e) {
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
      } else if ((!persisted || !persisted._id) && notifyProviders) {
        try {
          await notifyProviders({
            providerIds: recipients,
            message: created.isPrivate ? `New private request: ${created.title}` : `New request: ${created.title}`,
            metadata: { requestId: created._id.toString(), createdBy: created.createdBy }
          });
        } catch (e) {
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
      }
    }
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.notify.failed',
      actor: auditCtx.actor,
      target: { type: 'Request', id: created._id ? created._id.toString() : null },
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
 */
async function getRequest(id, actor = {}, correlationId = null) {
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

  if (actor && actor.role === 'service_provider') {
    results.results = results.results.filter(r => {
      if (!r.isPrivate) return true;
      return Array.isArray(r.allowedProviders) && r.allowedProviders.includes(actor.userId);
    });
  } else {
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
 * - If status transitions to 'active' and expiresAt is set, schedule expiry.
 * - If status transitions away from 'active' or expiresAt is cleared/changed, clear existing timer.
 */
async function updateRequest(id, patch = {}, actor = {}, correlationId = null) {
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
      patch.allowedProviders = [];
    }
  }

  // If when is provided, validate windows using worker helper and log here
  if (patch.when !== undefined) {
    const validation = worker.validateWhenSlots(patch.when);
    if (!validation.valid) {
      await auditService.logEvent({
        eventType: 'request.update.failed.invalid_when',
        actor: auditCtx.actor,
        target: { type: 'Request', id },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { when: patch.when, errors: validation.errors }
      });
      const msg = validation.errors
        .map(e => (e.index === null ? `${e.message}` : `slot[${e.index}] ${e.message}`))
        .join('; ');
      const err = new Error(`Invalid when slots: ${msg}`);
      err.status = 400;
      throw err;
    }
    // if expiresAt present in patch, ensure not after latest slot.to
    if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt') && patch.expiresAt !== null && patch.expiresAt !== undefined) {
      const expiresAtNum = Number(patch.expiresAt);
      if (Number.isNaN(expiresAtNum)) {
        const err = new Error('"expiresAt" must be a valid epoch millisecond number');
        err.status = 400;
        throw err;
      }
      if (expiresAtNum > validation.maxTo) {
        const err = new Error('"expiresAt" must not be after the latest "when.to" across slots');
        err.status = 400;
        throw err;
      }
    }
  }

  // Determine scheduling behavior before applying patch
  const willBecomeActive = (patch.status && patch.status === 'active') || (!patch.status && req.status === 'active');
  const willLeaveActive = (patch.status && patch.status !== 'active' && req.status === 'active');
  const expiresAtChanged = Object.prototype.hasOwnProperty.call(patch, 'expiresAt');

  const updated = await requestRepo.updateById(id, patch);
  await auditService.logEvent({
    eventType: 'request.update',
    actor: auditCtx.actor,
    target: { type: 'Request', id },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { updatedFields: Object.keys(patch || {}) }
  });

  try {
    if (willLeaveActive) worker.clearExpiryForRequestId(id);
    if (expiresAtChanged) {
      if (updated.status === 'active' && updated.expiresAt) await worker.scheduleExpiryForRequest(updated, correlationId);
      else worker.clearExpiryForRequestId(id);
    }
    if (willBecomeActive && updated.status === 'active' && updated.expiresAt) await worker.scheduleExpiryForRequest(updated, correlationId);
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.expire.schedule_failed',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'partial',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
  }

  return updated;
}

/**
 * Hard delete a request.
 * - Clears any scheduled expiry timer for the request.
 * - Returns the deleted document (populated) or null.
 */
async function hardDeleteRequest(id, actor = {}, correlationId = null) {
  try { worker.clearExpiryForRequestId(id); } catch (e) { /* ignore */ }
  const doc = await requestRepo.hardDeleteById(id);
  await auditService.logEvent({
    eventType: 'request.hard_delete',
    actor: actor || {},
    target: { type: 'Request', id },
    outcome: doc ? 'success' : 'failure',
    severity: doc ? 'info' : 'warning',
    correlationId,
    details: {}
  });
  return doc;
}

module.exports = {
  createRequest,
  getRequest,
  searchOpenRequests,
  updateRequest,
  resolveProvidersFromServices,
  hardDeleteRequest,

  // timer utilities (useful for tests and graceful shutdown)
  _scheduleExpiryForRequest: worker.scheduleExpiryForRequest,
  _clearExpiryForRequestId: worker.clearExpiryForRequestId,
  _markRequestExpired: worker.markRequestExpired,
  _expiryTimersMap: worker.expiryTimers
};
