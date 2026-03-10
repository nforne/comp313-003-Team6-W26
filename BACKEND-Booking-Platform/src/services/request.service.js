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
const serviceRepo = require('../repositories/service.repo'); // used to resolve serviceId -> providerId
const { notifyProviders } = require('../utils/notification.stub');//dev env
const auditService = require('./audit.service');

// message persistence and delivery
const messageRepo = require('../repositories/message.repo');
const comms = require('../comms-js');

function isServiceId(token) {
  return typeof token === 'string' && token.startsWith('svc_');
}

function dedupeArray(arr = []) {
  return Array.from(new Set(arr.filter(Boolean)));
}

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
        console.warn('[request.service] error resolving serviceId', entry, e && e.message);
        unresolvedServiceIds.push(entry);
      }
    } else {
      providerIds.push(entry);
    }
  }

  return { providerIds: dedupeArray(providerIds), unresolvedServiceIds };
}

/**
 * In-memory timers map for request expirations.
 * Key: request._id.toString()
 * Value: { timer: Timeout, runAt: epochMs }
 */
const expiryTimers = new Map();

/**
 * Schedule an expiration timeout for a request.
 * - If a timer already exists for the request, it will be cleared and replaced.
 * - If runAtEpochMs is in the past, mark expired immediately (async).
 *
 * @param {Object} requestDoc - mongoose document or plain object with _id, status, expiresAt
 * @param {String|null} correlationId
 */
async function scheduleExpiryForRequest(requestDoc, correlationId = null) {
  if (!requestDoc || !requestDoc._id) return;

  const id = requestDoc._id.toString();
  // Clear any existing timer first
  clearExpiryForRequestId(id);

  const expiresAt = Number(requestDoc.expiresAt || 0);
  if (!expiresAt || isNaN(expiresAt)) return;

  // Only schedule if request is active
  if (requestDoc.status !== 'active') return;

  const now = Date.now();
  const delay = Math.max(0, expiresAt - now);

  // If already past expiry, mark expired immediately (defer to next tick)
  if (delay === 0 && expiresAt <= now) {
    // mark expired asynchronously
    process.nextTick(() => markRequestExpired(id, correlationId).catch(err => {
      console.error('[request.service] immediate expire failed', id, err && err.message);
    }));
    return;
  }

  // Create timer
  const timer = setTimeout(async () => {
    try {
      await markRequestExpired(id, correlationId);
    } catch (e) {
      console.error('[request.service] scheduled expire failed for', id, e && e.message);
      await auditService.logEvent({
        eventType: 'request.expire.failed',
        actor: { userId: null, role: 'system' },
        target: { type: 'Request', id },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: e && e.message }
      });
    } finally {
      // cleanup timer entry
      expiryTimers.delete(id);
    }
  }, delay);

  expiryTimers.set(id, { timer, runAt: expiresAt });

  await auditService.logEvent({
    eventType: 'request.expire.scheduled',
    actor: { userId: null, role: 'system' },
    target: { type: 'Request', id },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { scheduledFor: expiresAt, delayMs: delay }
  });
}

/**
 * Clear scheduled expiry for a request id (if any).
 * @param {String} requestId
 */
function clearExpiryForRequestId(requestId) {
  if (!requestId) return false;
  const entry = expiryTimers.get(requestId.toString());
  if (entry && entry.timer) {
    try {
      clearTimeout(entry.timer);
    } catch (e) {
      // ignore
    }
    expiryTimers.delete(requestId.toString());
    return true;
  }
  return false;
}

/**
 * Mark a request as expired (idempotent).
 * - Loads the latest request document and if status === 'active' and expiresAt <= now, sets status='expired'.
 * - Emits audit event and notifies creator/providers as appropriate.
 *
 * @param {String} requestId
 * @param {String|null} correlationId
 */
async function markRequestExpired(requestId, correlationId = null) {
  if (!requestId) return null;
  const req = await requestRepo.findById(requestId);
  if (!req) {
    await auditService.logEvent({
      eventType: 'request.expire.failed.not_found',
      actor: { userId: null, role: 'system' },
      target: { type: 'Request', id: requestId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: {}
    });
    return null;
  }

  // Only expire if still active and expiresAt <= now
  const now = Date.now();
  if (req.status !== 'active') {
    await auditService.logEvent({
      eventType: 'request.expire.skipped',
      actor: { userId: null, role: 'system' },
      target: { type: 'Request', id: requestId },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { currentStatus: req.status }
    });
    return req;
  }
  if (!req.expiresAt || Number(req.expiresAt) > now) {
    // Not yet expired
    await auditService.logEvent({
      eventType: 'request.expire.skipped.not_due',
      actor: { userId: null, role: 'system' },
      target: { type: 'Request', id: requestId },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { expiresAt: req.expiresAt, now }
    });
    return req;
  }

  // Perform update
  const updated = await requestRepo.updateById(requestId, { status: 'expired' });

  await auditService.logEvent({
    eventType: 'request.expired',
    actor: { userId: null, role: 'system' },
    target: { type: 'Request', id: requestId },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { expiredAt: now }
  });

  //TODO Notify creator and optionally providers
  // notifyProviders is a stub. 
  // we will use comms-js index deliverMessage
  // we will craft and submit said message here and then send the notification using comms-js index deliverMessage.
  //---------------------------------------
  try {
    // Build recipients list:
    // - If private (allowedProviders present and non-empty) notify all parties involved (allowedProviders + seeker)
    // - If public, notify only the seeker (createdBy)
    const seekerId = updated && updated.createdBy ? String(updated.createdBy) : null;
    const allowed = Array.isArray(updated && updated.allowedProviders) ? updated.allowedProviders.map(String) : [];
    let recipients = [];

    if (allowed && allowed.length > 0) {
      recipients = dedupeArray([seekerId, ...allowed]);
    } else if (seekerId) {
      recipients = [seekerId];
    }

    if (recipients.length > 0) {
      // Persist a notification message via messageRepo (handles idempotency)
      const recipientObjectIds = recipients
        .filter(Boolean)
        .map(r => (mongoose.Types.ObjectId.isValid(r) ? mongoose.Types.ObjectId(r) : r));

      const messageDoc = {
        type: 'notification',
        recipientsAll: false,
        recipients: recipientObjectIds,
        userId: updated.createdBy || null,
        subject: `Request expired: ${updated.title}`,
        details: `Request "${updated.title}" (id: ${updated._id}) has expired.`,
        idempotencyKey: `request-expire-${updated._id.toString()}`,
        status: 'submitted',
        metadata: { requestId: updated._id.toString(), status: 'expired' }
      };

      let persisted;
      try {
        persisted = await messageRepo.createMessage(messageDoc);
      } catch (e) {
        // log but continue to attempt delivery
        console.error('[request.service] persist notification message failed', e && e.message);
        await auditService.logEvent({
          eventType: 'request.expire.notify_persist_failed',
          actor: { userId: null, role: 'system' },
          target: { type: 'Request', id: requestId },
          outcome: 'partial',
          severity: 'warning',
          correlationId,
          details: { error: e && e.message }
        });
      }

      // Deliver via comms-js if persisted
      if (persisted && persisted._id) {
        try {
          await comms.deliverMessage(persisted._id, { actor: { userId: null, role: 'system' }, correlationId, asyncBroadcast: true });
        } catch (e) {
          console.error('[request.service] comms.deliverMessage failed on expire', e && e.message);
          await auditService.logEvent({
            eventType: 'request.expire.notify_failed',
            actor: { userId: null, role: 'system' },
            target: { type: 'Request', id: requestId },
            outcome: 'partial',
            severity: 'warning',
            correlationId,
            details: { error: e && e.message }
          });
        }
      } else {
        // Fallback: attempt external notifyProviders stub (best-effort)
        try {
          await notifyProviders({
            providerIds: recipients,
            message: `Request "${updated.title}" has expired.`,
            metadata: { requestId: updated._id.toString(), status: 'expired' }
          });
        } catch (e) {
          console.error('[request.service] notifyProviders fallback failed on expire', e && e.message);
          await auditService.logEvent({
            eventType: 'request.expire.notify_failed',
            actor: { userId: null, role: 'system' },
            target: { type: 'Request', id: requestId },
            outcome: 'partial',
            severity: 'warning',
            correlationId,
            details: { error: e && e.message }
          });
        }
      }
    }
  } catch (e) {
    console.error('[request.service] notify on expire failed', e && e.message);
    await auditService.logEvent({
      eventType: 'request.expire.notify_failed',
      actor: { userId: null, role: 'system' },
      target: { type: 'Request', id: requestId },
      outcome: 'partial',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
  }
 //---------------------------------------

  return updated;
}

/**
 * Create a request.
 * - If created request is active and has expiresAt, schedule expiry countdown.
 *
 * Validation added:
 * - when.from and when.to must not be in the past (when.to must be > now; when.from must be >= now).
 * - when.to must be >= when.from.
 * - If expiresAt is provided, it must not be after when.to.
 */
async function createRequest(payload, actor, correlationId = null) {
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

  // --- Validation: when.from / when.to and expiresAt ---
  const now = Date.now();

  if (!obj.when || typeof obj.when !== 'object') {
    const err = new Error('Invalid or missing "when" window');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'request.create.failed.invalid_when',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when }
    });
    throw err;
  }

  const from = Number(obj.when.from || 0);
  const to = Number(obj.when.to || 0);

  if (!from || !to || isNaN(from) || isNaN(to)) {
    const err = new Error('"when.from" and "when.to" must be valid epoch millisecond numbers');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'request.create.failed.invalid_when_values',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when }
    });
    throw err;
  }

  // Ensure to is in the future
  if (to <= now) {
    const err = new Error('"when.to" must be in the future');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'request.create.failed.when_to_in_past',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when, now }
    });
    throw err;
  }

  // Ensure from is not in the past (must be >= now)
  if (from < now) {
    const err = new Error('"when.from" must be now or in the future');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'request.create.failed.when_from_in_past',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when, now }
    });
    throw err;
  }

  // Ensure to >= from
  if (to < from) {
    const err = new Error('"when.to" must be greater than or equal to "when.from"');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'request.create.failed.when_to_before_from',
      actor: auditCtx.actor,
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { when: obj.when }
    });
    throw err;
  }

  // If expiresAt provided, ensure it is not after when.to
  if (obj.expiresAt !== undefined && obj.expiresAt !== null) {
    const expiresAtNum = Number(obj.expiresAt);
    if (isNaN(expiresAtNum)) {
      const err = new Error('"expiresAt" must be a valid epoch millisecond number');
      err.status = 400;
      await auditService.logEvent({
        eventType: 'request.create.failed.invalid_expiresAt',
        actor: auditCtx.actor,
        target: { type: 'Request', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { expiresAt: obj.expiresAt }
      });
      throw err;
    }
    if (expiresAtNum > to) {
      const err = new Error('"expiresAt" must not be after the request "when.to"');
      err.status = 400;
      await auditService.logEvent({
        eventType: 'request.create.failed.expiresAt_after_to',
        actor: auditCtx.actor,
        target: { type: 'Request', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { expiresAt: expiresAtNum, whenTo: to }
      });
      throw err;
    }
  }

  // --- End validation ---

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

  // Schedule expiry if applicable
  try {
    if (created.status === 'active' && created.expiresAt) {
      await scheduleExpiryForRequest(created, correlationId);
    }
  } catch (e) {
    console.error('[request.service] scheduleExpiryForRequest failed on create', e && e.message);
  }

  //TODO Notify creator and optionally providers
  // notifyProviders is a stub. 
  // we will use comms-js index deliverMessage
  // we will craft and submit said message here and then send the notification using comms-js index deliverMessage.
  //---------------------------------------
  try {
    // Build recipients list:
    // - If private (allowedProviders present and non-empty) notify all parties involved (allowedProviders + seeker)
    // - If public, notify only the seeker (createdBy)
    const seekerId = created && created.createdBy ? String(created.createdBy) : null;
    const allowed = Array.isArray(created && created.allowedProviders) ? created.allowedProviders.map(String) : [];
    let recipients = [];

    if (allowed && allowed.length > 0) {
      recipients = dedupeArray([seekerId, ...allowed]);
    } else if (seekerId) {
      recipients = [seekerId];
    }

    if (recipients.length > 0) {
      // Persist a notification message via messageRepo (handles idempotency)
      const recipientObjectIds = recipients
        .filter(Boolean)
        .map(r => (mongoose.Types.ObjectId.isValid(r) ? mongoose.Types.ObjectId(r) : r));

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
        console.error('[request.service] persist notification message failed', e && e.message);
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
          await comms.deliverMessage(persisted._id, { actor: auditCtx.actor, correlationId, asyncBroadcast: true });
        } catch (e) {
          console.error('[request.service] comms.deliverMessage failed on create', e && e.message);
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
      } else {
        // Fallback: attempt external notifyProviders stub (best-effort)
        try {
          await notifyProviders({
            providerIds: recipients,
            message: created.isPrivate ? `New private request: ${created.title}` : `New request: ${created.title}`,
            metadata: { requestId: created._id.toString(), createdBy: created.createdBy }
          });
        } catch (e) {
          console.error('[request.service] notifyProviders fallback failed on create', e && e.message);
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
  //---------------------------------------

  return created;
}

/**
 * Get a request by id with visibility enforcement.
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

  // Determine scheduling behavior before applying patch
  const willBecomeActive = (patch.status && patch.status === 'active') || (!patch.status && req.status === 'active');
  const willLeaveActive = (patch.status && patch.status !== 'active' && req.status === 'active');

  // If expiresAt is being changed in the patch, we will reschedule accordingly after update
  const expiresAtChanged = ('expiresAt' in patch) && (Number(patch.expiresAt || 0) !== Number(req.expiresAt || 0));

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

  // Scheduling logic after update:
  try {
    // If request left active, clear timer
    if (willLeaveActive) {
      clearExpiryForRequestId(id);
      await auditService.logEvent({
        eventType: 'request.expire.cleared',
        actor: auditCtx.actor,
        target: { type: 'Request', id },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'status_changed' }
      });
    }

    // If expiresAt changed while active, reschedule
    if (expiresAtChanged && updated.status === 'active') {
      clearExpiryForRequestId(id);
      await scheduleExpiryForRequest(updated, correlationId);
    }

    // If status changed to active and expiresAt present, schedule
    if (patch.status === 'active' && updated.expiresAt) {
      await scheduleExpiryForRequest(updated, correlationId);
    }
  } catch (e) {
    console.error('[request.service] scheduling post-update failed', e && e.message);
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

/**
 * Hard delete a request.
 * - Clears any scheduled expiry timer for the request.
 */
async function hardDeleteRequest(id, actor, correlationId = null) {
  const auditCtx = { actor: actor || {}, correlationId };

  const req = await requestRepo.findById(id);
  if (!req) {
    await auditService.logEvent({
      eventType: 'request.hard_delete.failed.not_found',
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

  if (req.status !== 'draft') {
    await auditService.logEvent({
      eventType: 'request.hard_delete.failed.invalid_status',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { currentStatus: req.status }
    });
    const err = new Error('Request can only be hard deleted while in draft status');
    err.status = 400;
    throw err;
  }

  const isOwner = actor && actor.userId && actor.userId === req.createdBy;
  const isAdmin = actor && actor.role === 'administrator';
  if (!isOwner && !isAdmin) {
    await auditService.logEvent({
      eventType: 'request.hard_delete.forbidden',
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
    eventType: 'request.hard_delete.attempt',
    actor: auditCtx.actor,
    target: { type: 'Request', id },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: {}
  });

  try {
    // Clear any scheduled expiry
    clearExpiryForRequestId(id);

    const deleted = await requestRepo.hardDeleteById(id);
    if (!deleted) {
      await auditService.logEvent({
        eventType: 'request.hard_delete.failed.not_found_after_fetch',
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

    await auditService.logEvent({
      eventType: 'request.hard_delete',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { deletedId: id }
    });

    return deleted;
  } catch (e) {
    await auditService.logEvent({
      eventType: 'request.hard_delete.failed.db_error',
      actor: auditCtx.actor,
      target: { type: 'Request', id },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message }
    });
    throw e;
  }
}

/**
 * Expose functions and timer utilities for testing and process lifecycle management.
 */
module.exports = {
  createRequest,
  getRequest,
  searchOpenRequests,
  updateRequest,
  resolveProvidersFromServices,
  hardDeleteRequest,

  // timer utilities (useful for tests and graceful shutdown)
  _scheduleExpiryForRequest: scheduleExpiryForRequest,
  _clearExpiryForRequestId: clearExpiryForRequestId,
  _markRequestExpired: markRequestExpired,
  _expiryTimersMap: expiryTimers
};
