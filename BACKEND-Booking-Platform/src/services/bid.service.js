// src/services/bid.service.js
/**
 * Bid service (polished, non-disruptive)
 *
 * - Public API: createBid, updateBid, deleteDraftBid
 * - Delegates create/update flows to dedicated workers:
 *     - src/jobs/bid.service.create.worker.js -> createBidWorker
 *     - src/jobs/bid.service.update.worker.js -> updateBidWorker
 * - Uses utility helpers from src/jobs/bid.service.utils+.worker.js (formerly bid.service.worker.js)
 * - Preserves existing audit event names and semantics.
 *
 * Notes:
 * - createBid and updateBid are thin orchestration layers that:
 *     * build actor context and correlationId
 *     * call the appropriate worker with injected dependencies
 *     * rethrow worker errors after ensuring audit events are preserved
 * - deleteDraftBid remains local (simple, direct DB operation) to avoid changing semantics.
 */

'use strict';

const workerUtils = require('../jobs/bid.service.utils+.worker');
const createWorkerModule = require('../jobs/bid.service.create.worker');
const updateWorkerModule = require('../jobs/bid.service.update.worker');

const bidRepo = require('../repositories/bid.repo');
const requestRepo = require('../repositories/request.repo');
const auditService = require('./audit.service');

let messageRepo;
try { messageRepo = require('../repositories/message.repo'); } catch (e) { messageRepo = null; }

let MessageModel;
try { MessageModel = require('../models/message.model'); } catch (e) { MessageModel = null; }

let commsJs;
try { commsJs = require('../comms-js'); } catch (e) { commsJs = null; }

let bookingService;
try { bookingService = require('./booking.service'); } catch (e) { bookingService = null; }

let calendarService;
try { calendarService = require('./calendar.service'); } catch (e) { calendarService = null; }

/* -------------------------
 * Local wrappers / deps passed into workers
 * ------------------------- */

function actorContext(actor) {
  return workerUtils && typeof workerUtils.actorContext === 'function'
    ? workerUtils.actorContext(actor)
    : { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null };
}

const commonDeps = {
  bidRepo,
  requestRepo,
  auditService,
  messageRepo,
  MessageModel,
  commsJs,
  bookingService,
  calendarService,
  workerHelpers: workerUtils
};

/* -------------------------
 * createBid
 * - Delegates to createBidWorker
 * ------------------------- */

async function createBid(actor, request_id, payload = {}, correlationId = null) {
  const actorCtx = actorContext(actor);
  const createBidWorker = createWorkerModule && createWorkerModule.createBidWorker ? createWorkerModule.createBidWorker : null;

  if (!createBidWorker) {
    const err = new Error('Create bid worker not available');
    err.status = 500;
    await auditService.logEvent({
      eventType: 'bid.create.failed.no_worker',
      actor: actorCtx,
      target: { type: 'Request', id: request_id },
      outcome: 'failure',
      severity: 'error',
      correlationId
    });
    throw err;
  }

  try {
    // Worker will perform validations, create bid, audit events, and notifications.
    const created = await createBidWorker(actor, request_id, payload, commonDeps, correlationId);
    return created;
  } catch (err) {
    // Ensure we surface the same error semantics; worker already logs audit events.
    throw err;
  }
}

/* -------------------------
 * updateBid
 * - Delegates to updateBidWorker
 * ------------------------- */

async function updateBid(actor, bidId, patch = {}, correlationId = null) {
  const actorCtx = actorContext(actor);
  const updateBidWorker = updateWorkerModule && updateWorkerModule.updateBidWorker ? updateWorkerModule.updateBidWorker : null;

  if (!updateBidWorker) {
    const err = new Error('Update bid worker not available');
    err.status = 500;
    await auditService.logEvent({
      eventType: 'bid.update.failed.no_worker',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'failure',
      severity: 'error',
      correlationId
    });
    throw err;
  }

  try {
    // Worker handles provider updates, owner/admin accept/reject/cancel flows,
    // slot processing at accept time, bookingService delegation, audit events, and notifications.
    const updated = await updateBidWorker(actor, bidId, patch, commonDeps, correlationId);
    return updated;
  } catch (err) {
    // Worker is responsible for logging; rethrow to preserve original behavior.
    throw err;
  }
}

/* -------------------------
 * deleteDraftBid
 * - Kept local to preserve semantics and audit events
 * ------------------------- */

async function deleteDraftBid(actor, bidId, correlationId = null) {
  const actorCtx = actorContext(actor);
  const bid = await bidRepo.findById(bidId);
  if (!bid) {
    const err = new Error('Bid not found');
    err.status = 404;
    await auditService.logEvent({
      eventType: 'bid.hard_delete.failed.not_found',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'failure',
      severity: 'warning',
      correlationId
    });
    throw err;
  }

  if (bid.status !== 'draft') {
    const err = new Error('Only draft bids may be hard deleted');
    err.status = 400;
    await auditService.logEvent({
      eventType: 'bid.hard_delete.failed.invalid_status',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { currentStatus: bid.status }
    });
    throw err;
  }

  const isOwner = actor && actor.userId && actor.userId === bid.provider_id;
  const isAdmin = actor && actor.role === 'administrator';
  if (!isOwner && !isAdmin) {
    const err = new Error('Forbidden');
    err.status = 403;
    await auditService.logEvent({
      eventType: 'bid.hard_delete.forbidden',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'failure',
      severity: 'warning',
      correlationId
    });
    throw err;
  }

  await auditService.logEvent({
    eventType: 'bid.hard_delete.attempt',
    actor: actorCtx,
    target: { type: 'Bid', id: bidId },
    outcome: 'info',
    severity: 'info',
    correlationId
  });

  try {
    const res = await bidRepo.hardDeleteById(bidId);
    const deletedCount = res && typeof res.deletedCount !== 'undefined' ? res.deletedCount : (res && res.n ? res.n : null);

    await auditService.logEvent({
      eventType: 'bid.hard_delete',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { deletedCount }
    });

    // Notify request owner and provider about deletion (best-effort)
    try {
      const request = await requestRepo.findById(bid.request_id);
      const subject = `Draft bid deleted for request ${bid.request_id}`;
      const details = `Draft bid ${bidId} was deleted by ${actor.userId || 'system'}.`;
      const recipients = [];
      if (request && request.createdBy) recipients.push(request.createdBy);
      if (bid.provider_id && (!request || bid.provider_id !== request.createdBy)) recipients.push(bid.provider_id);

      const msgPayload = {
        type: 'bid',
        recipientsAll: false,
        recipients,
        userId: actor.userId || null,
        serviceId: Array.isArray(bid.services) && bid.services.length ? bid.services[0] : null,
        subject,
        details,
        attachments: [],
        idempotencyKey: `bid_delete_${bidId}_${Date.now()}`,
        metadata: Object.assign({}, bid.metadata || {}, { bidId, requestId: bid.request_id, channels: ['in_app'] })
      };

      // Use worker utils message helpers if available
      const messageDoc = await (workerUtils && typeof workerUtils.persistAndSubmitMessage === 'function'
        ? workerUtils.persistAndSubmitMessage(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
        : (messageRepo && typeof messageRepo.createMessage === 'function' ? messageRepo.createMessage(msgPayload) : null));

      if (messageDoc) {
        if (workerUtils && typeof workerUtils.deliverMessageIfPossible === 'function') {
          await workerUtils.deliverMessageIfPossible(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId);
        } else if (commsJs && typeof commsJs.deliverMessage === 'function') {
          try { await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true }); } catch (_) { /* ignore */ }
        }
      }
    } catch (msgErr) {
      await auditService.logEvent({
        eventType: 'bid.notification.error',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: msgErr && msgErr.message }
      });
    }

    return bid;
  } catch (e) {
    await auditService.logEvent({
      eventType: 'bid.hard_delete.failed.db_error',
      actor: actorCtx,
      target: { type: 'Bid', id: bidId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message }
    });
    throw e;
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createBid,
  updateBid,
  deleteDraftBid
};
