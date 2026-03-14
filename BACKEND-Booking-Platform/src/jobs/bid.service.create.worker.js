// src/jobs/bid.service.create.worker.js
/**
 * Create-time bid worker (polished, non-disruptive)
 *
 * - Purpose: encapsulate the createBid flow as a reusable worker.
 * - API: createBidWorker(actor, requestId, payload, deps = {}, correlationId = null)
 *   - Returns the created bid document (or throws on error).
 * - Behavior:
 *   - preserves existing validation, uniqueness, audit events, notifications.
 *   - does NOT process request.when slots (slot processing is performed at accept time).
 *   - uses shared utils for message persistence/delivery when available.
 *
 * Key rules implemented:
 *  - If submittedCount >= maxAllowed -> fail immediately (409) and set request.status = 'pending_action' (best-effort).
 *  - If submittedCount + 1 === maxAllowed -> allow creation (the last allowed) and set request.status = 'pending_action' after successful create.
 *  - Private requests: duplicate prevention is applied per provider+service pair only, allowing a provider to submit multiple bids when invited for multiple services.
 *  - Public requests: only one active submitted bid per provider per request is allowed.
 *
 * Minimal, targeted, non-disruptive changes only.
 */

'use strict';

const DEFAULT_MAX_ALLOWED = 10;

async function safeRequire(path) {
  try { return require(path); } catch (e) { return null; }
}

function makeActorCtx(actor) {
  return { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null };
}

function normalizeServices(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(Boolean)
    .map(s => (typeof s === 'string' ? s.trim() : String(s)))
    .filter(Boolean);
}

/**
 * createBidWorker(actor, requestId, payload, deps = {}, correlationId)
 *
 * deps (optional):
 *  - bidRepo, requestRepo, auditService, messageRepo, MessageModel, commsJs, utils
 *
 * Returns created bid document or throws.
 */
async function createBidWorker(actor, requestId, payload = {}, deps = {}, correlationId = null) {
  const bidRepo = deps.bidRepo || await safeRequire('../repositories/bid.repo') || null;
  const requestRepo = deps.requestRepo || await safeRequire('../repositories/request.repo') || null;
  const auditService = deps.auditService || await safeRequire('../services/audit.service') || null;
  const messageRepo = deps.messageRepo || await safeRequire('../repositories/message.repo') || null;
  const MessageModel = deps.MessageModel || await safeRequire('../models/message.model') || null;
  const commsJs = deps.commsJs || await safeRequire('../comms-js') || null;
  const utils = deps.utils || await safeRequire('../jobs/bid.service.utils+.worker') || null;

  const actorCtx = makeActorCtx(actor);

  if (!bidRepo || !requestRepo) {
    const err = new Error('Missing repository dependencies');
    err.status = 500;
    throw err;
  }

   // Load request
  const request = await requestRepo.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create.failed.request_not_found',
        actor: actorCtx,
        target: { type: 'Request', id: requestId },
        outcome: 'failure',
        severity: 'warning',
        correlationId
      });
    }
    throw err;
  }

  // Authorization
  if (!actor || (actor.role !== 'service_provider' && actor.role !== 'administrator') || actorCtx.userId == request.createdBy) {
    const err = new Error('Only service_provider or administrator may create bids and you cannot bid on your own request');
    err.status = 403;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create.forbidden',
        actor: actorCtx,
        target: { type: 'Request', id: requestId },
        outcome: 'failure',
        severity: 'warning',
        correlationId
      });
    }
    throw err;
  }

  if (request.status !== 'active') {
    const err = new Error('Bidding closed for this request');
    err.status = 409;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create.failed.request_not_open',
        actor: actorCtx,
        target: { type: 'Request', id: requestId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { requestStatus: request.status }
      });
    }
    throw err;
  }

  // Normalize services from payload (services the provider is bidding for)
  const services = normalizeServices(payload.services);

  // Existing submitted, non-archived bids for this request
  const existingBids = (await bidRepo.findByRequest(requestId, { status: 'submitted', archived: false })) || [];
  const maxAllowed = (request.metadata && request.metadata.maxAllowedBids) ? Number(request.metadata.maxAllowedBids) : DEFAULT_MAX_ALLOWED;
  const submittedCount = existingBids.filter(b => b && b.status === 'submitted').length;

  // If already at or above limit -> set pending_action and fail immediately
  if (submittedCount >= maxAllowed) {
    try {
      await requestRepo.updateById(request._id ? request._id.toString() : requestId, { status: 'pending_action', updatedAt: Date.now() });
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'request.pending_action.set',
          actor: actorCtx,
          target: { type: 'Request', id: requestId },
          outcome: 'info',
          severity: 'info',
          correlationId,
          details: { submittedCount, maxAllowed }
        });
      }
    } catch (setErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'request.pending_action.set_failed',
          actor: actorCtx,
          target: { type: 'Request', id: requestId },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: setErr && setErr.message }
        });
      }
    }

    const err = new Error('Bid limit reached for this request');
    err.status = 409;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create.failed.limit_reached',
        actor: actorCtx,
        target: { type: 'Request', id: requestId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { submittedCount, maxAllowed }
      });
    }
    throw err;
  }

  // Duplicate prevention
  // - For private requests: enforce uniqueness per provider+service pair only.
  //   This allows a provider to submit multiple bids when they are invited for multiple services.
  // - For public requests: only one active submitted bid per provider per request is allowed.
  try {
    if (request.isPrivate) {
      // If payload.services is empty, require provider to not already have any active submitted bid
      if (services.length === 0) {
        const anyConflict = existingBids.find(b => b.provider_id === actor.userId && !b.archived);
        if (anyConflict) {
          const err = new Error('Active bid already exists for this provider on this private request; specify service to create additional bids');
          err.status = 409;
          if (auditService && typeof auditService.logEvent === 'function') {
            await auditService.logEvent({
              eventType: 'bid.create.failed.duplicate',
              actor: actorCtx,
              target: { type: 'Request', id: requestId },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { existingId: anyConflict._id ? anyConflict._id.toString() : null }
            });
          }
          throw err;
        }
      } else {
        // Per-service check: block only when provider already has an active bid for the same service.
        for (const svc of services) {
          const conflict = existingBids.find(b =>
            b.provider_id === actor.userId &&
            Array.isArray(b.services) &&
            b.services.some(x => String(x) === String(svc)) &&
            !b.archived
          );
          if (conflict) {
            const err = new Error('Active bid for this provider and service already exists on this private request');
            err.status = 409;
            if (auditService && typeof auditService.logEvent === 'function') {
              await auditService.logEvent({
                eventType: 'bid.create.failed.duplicate',
                actor: actorCtx,
                target: { type: 'Request', id: requestId },
                outcome: 'failure',
                severity: 'warning',
                correlationId,
                details: { existingId: conflict._id ? conflict._id.toString() : null, service: svc }
              });
            }
            throw err;
          }
        }
      }
    } else {
      // Public request: single active submitted bid per provider per request
      const conflict = existingBids.find(b => b.provider_id === actor.userId && !b.archived);
      if (conflict) {
        const err = new Error('Active bid already exists for this provider and request');
        err.status = 409;
        if (auditService && typeof auditService.logEvent === 'function') {
          await auditService.logEvent({
            eventType: 'bid.create.failed.duplicate',
            actor: actorCtx,
            target: { type: 'Request', id: requestId },
            outcome: 'failure',
            severity: 'warning',
            correlationId,
            details: { existingId: conflict._id ? conflict._id.toString() : null }
          });
        }
        throw err;
      }
    }
  } catch (dupErr) {
    // rethrow duplicate or validation errors
    throw dupErr;
  }

  // Build bid object
  const obj = {
    request_id: requestId,
    provider_id: actor.userId,
    quote_amount: payload.quote_amount,
    currency: payload.currency,
    services,
    message: payload.message || null,
    status: payload.status || 'submitted',
    metadata: payload.metadata || {}
  };

  // Create bid
  try {
    const created = await bidRepo.create(obj);

    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create',
        actor: actorCtx,
        target: { type: 'Bid', id: created._id.toString() },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { request_id: requestId, provider_id: actor.userId, quote_amount: created.quote_amount }
      });
    }

    // Provider notification (best-effort) using utils if available
    try {
      const providerRecipients = [created.provider_id];
      const providerMsgPayload = {
        type: 'bid',
        recipientsAll: false,
        recipients: providerRecipients,
        userId: actor.userId || null,
        serviceId: services.length ? services[0] : null,
        subject: `Your bid submitted for request ${requestId}`,
        details: `Your bid has been submitted for request ${requestId}.`,
        attachments: [],
        idempotencyKey: `bid_create_provider_${created._id.toString()}`,
        metadata: Object.assign({}, created.metadata || {}, { bidId: created._id.toString(), requestId, channels: ['in_app'] })
      };

      const persist = (utils && typeof utils.persistAndSubmitMessage === 'function')
        ? utils.persistAndSubmitMessage
        : async (p, a, d, c) => defaultPersistAndSubmitMessage(p, a, d, c);

      const deliver = (utils && typeof utils.deliverMessageIfPossible === 'function')
        ? utils.deliverMessageIfPossible
        : async (m, a, d, c) => defaultDeliverMessageIfPossible(m, a, d, c);

      const messageDoc = await persist(providerMsgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId);
      await deliver(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId);
    } catch (msgErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.notification.error',
          actor: actorCtx,
          target: { type: 'Bid', id: created._id.toString() },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: msgErr && msgErr.message }
        });
      }
    }

    // Owner notification and pending_action handling:
    // If this bid brings the request to its configured maxAllowed (submittedCount + 1 === maxAllowed),
    // set request.status = 'pending_action' and notify owner with pendingAction flag.
    try {
      const ownerRecipients = [];
      if (request.createdBy) ownerRecipients.push(request.createdBy);

      const willReachLimit = (submittedCount + 1) === maxAllowed;
      if (willReachLimit) {
        try {
          await requestRepo.updateById(request._id ? request._id.toString() : requestId, { status: 'pending_action', updatedAt: Date.now() });
          if (auditService && typeof auditService.logEvent === 'function') {
            await auditService.logEvent({
              eventType: 'request.pending_action.set',
              actor: actorCtx,
              target: { type: 'Request', id: requestId },
              outcome: 'info',
              severity: 'info',
              correlationId,
              details: { submittedCount: submittedCount + 1, maxAllowed }
            });
          }
        } catch (setErr) {
          if (auditService && typeof auditService.logEvent === 'function') {
            await auditService.logEvent({
              eventType: 'request.pending_action.set_failed',
              actor: actorCtx,
              target: { type: 'Request', id: requestId },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { error: setErr && setErr.message }
            });
          }
        }
      }

      if (ownerRecipients.length > 0) {
        const ownerSubject = willReachLimit
          ? `Action required: bid limit reached for request ${requestId}`
          : `New bid for request ${requestId}`;

        const ownerDetails = willReachLimit
          ? `A new bid was submitted and the request has reached its configured bid limit (${maxAllowed}). Please review and take action.`
          : `A new bid has been submitted by provider ${actor.userId} for request ${requestId}.`;

        const ownerMsgPayload = {
          type: 'bid',
          recipientsAll: false,
          recipients: ownerRecipients,
          userId: actor.userId || null,
          serviceId: services.length ? services[0] : null,
          subject: ownerSubject,
          details: ownerDetails,
          attachments: [],
          idempotencyKey: `bid_create_owner_${created._id.toString()}`,
          metadata: Object.assign({}, created.metadata || {}, { bidId: created._id.toString(), requestId, channels: ['in_app'], pendingAction: willReachLimit })
        };

        const persist = (utils && typeof utils.persistAndSubmitMessage === 'function')
          ? utils.persistAndSubmitMessage
          : async (p, a, d, c) => defaultPersistAndSubmitMessage(p, a, d, c);

        const deliver = (utils && typeof utils.deliverMessageIfPossible === 'function')
          ? utils.deliverMessageIfPossible
          : async (m, a, d, c) => defaultDeliverMessageIfPossible(m, a, d, c);

        const ownerMessageDoc = await persist(ownerMsgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId);
        await deliver(ownerMessageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId);
      }
    } catch (ownerMsgErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.notification.error',
          actor: actorCtx,
          target: { type: 'Bid', id: created._id.toString() },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: ownerMsgErr && ownerMsgErr.message }
        });
      }
    }

    return created;
  } catch (err) {
    // Duplicate DB error handling
    if (err && err.code === 11000) {
      const conflict = new Error('Duplicate bid (db)');
      conflict.status = 409;
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.create.failed.duplicate_db',
          actor: actorCtx,
          target: { type: 'Request', id: requestId },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: err.message }
        });
      }
      throw conflict;
    }

    // Generic failure
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.create.failed',
        actor: actorCtx,
        target: { type: 'Request', id: requestId },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err && err.message ? err.message : String(err) }
      });
    }

    if (!err.status) err.status = 500;
    throw err;
  }
}

/* -------------------------
 * Local fallbacks (kept at bottom so utils can override)
 * ------------------------- */

async function defaultPersistAndSubmitMessage(payload, actorCtx, deps = {}, correlationId = null) {
  const { messageRepo, MessageModel, auditService } = deps || {};
  let messageDoc = null;

  if (messageRepo && typeof messageRepo.createMessage === 'function') {
    try {
      messageDoc = await messageRepo.createMessage(payload);
      if (messageDoc && messageDoc._id && MessageModel && typeof MessageModel.findById === 'function') {
        try { messageDoc = await MessageModel.findById(messageDoc._1d).exec(); } catch (_) { /* ignore */ }
      }
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else if (messageDoc && messageDoc._id && typeof messageRepo.updateMessage === 'function') {
        try { await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() }); } catch (_) { /* ignore */ }
      }
    } catch (err) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.create_failed',
          actor: actorCtx,
          target: { type: 'Request', id: payload && payload.metadata && payload.metadata.requestId ? payload.metadata.requestId : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: err && err.message }
        });
      }
      messageDoc = null;
    }
  }

  if (!messageDoc && MessageModel && typeof MessageModel.buildDraft === 'function') {
    try {
      const draft = MessageModel.buildDraft(Object.assign({}, payload, { status: 'draft' }));
      messageDoc = await draft.save();
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else if (messageRepo && typeof messageRepo.updateMessage === 'function') {
        try { await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() }); } catch (_) { /* ignore */ }
      }
    } catch (err) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.model_failed',
          actor: actorCtx,
          target: { type: 'Request', id: payload && payload.metadata && payload.metadata.requestId ? payload.metadata.requestId : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: err && err.message }
        });
      }
      messageDoc = null;
    }
  }

  return messageDoc;
}

async function defaultDeliverMessageIfPossible(messageDoc, actorCtx, deps = {}, correlationId = null) {
  const { MessageModel, commsJs, auditService } = deps || {};

  if (!messageDoc || !messageDoc._id) {
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Message', id: null },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'no_message' }
      });
    }
    return;
  }

  let doc = messageDoc;
  if (!doc.status && MessageModel && typeof MessageModel.findById === 'function') {
    try { doc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { doc = messageDoc; }
  }

  if (!doc || doc.status !== 'submitted') {
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Message', id: messageDoc._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'not_submitted', status: doc && doc.status }
      });
    }
    return;
  }

  if (commsJs && typeof commsJs.deliverMessage === 'function') {
    try {
      await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true });
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.delivered',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id.toString() },
          outcome: 'success',
          severity: 'info',
          correlationId
        });
      }
    } catch (deliverErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.deliver_failed',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id ? messageDoc._id.toString() : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: deliverErr && deliverErr.message ? deliverErr.message : String(deliverErr) }
        });
      }
    }
  } else if (auditService && typeof auditService.logEvent === 'function') {
    await auditService.logEvent({
      eventType: 'bid.message.deliver_skipped',
      actor: actorCtx,
      target: { type: 'Message', id: messageDoc._id.toString() },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { reason: 'comms-js not available' }
    });
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createBidWorker
};
