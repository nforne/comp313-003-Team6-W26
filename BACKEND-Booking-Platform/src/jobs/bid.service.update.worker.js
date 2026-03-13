// src/jobs/bid.service.update.worker.js
/**
 * Update-time bid worker (polished, non-disruptive)
 *
 * - Purpose: encapsulate updateBid flow (owner/provider/admin actions) as a reusable worker.
 * - API: updateBidWorker(actor, bidId, patch, deps = {}, correlationId = null)
 *   - Returns updated bid document (or throws on error).
 * - Behavior:
 *   - Preserves existing validation, audit events, notifications.
 *   - Accept flow: runs slot processing once (via processedBidSlots from utils), attaches slots to bookingPayload
 *     (does NOT persist slots on the Bid), delegates to bookingService.createBookingTransactional.
 *   - Off-limits conflict: abort accept with 409 and return structured conflict details.
 *   - Capacity conflict: archive the bid (update op), mark request pending_action (request update),
 *     notify stakeholders, and return 409.
 *
 * Minimal, targeted, non-disruptive changes only.
 */

'use strict';

async function safeRequire(path) {
  try { return require(path); } catch (e) { return null; }
}

function actorContext(actor) {
  return { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null };
}

/* Local defensive message helpers (fallbacks) kept minimal; prefer utils implementations */
async function defaultPersistAndSubmitMessage(payload, actorCtx, deps = {}, correlationId = null) {
  const { messageRepo, MessageModel, auditService } = deps || {};
  let messageDoc = null;

  if (messageRepo && typeof messageRepo.createMessage === 'function') {
    try {
      messageDoc = await messageRepo.createMessage(payload);
      if (messageDoc && messageDoc._id && MessageModel && typeof MessageModel.findById === 'function') {
        try { messageDoc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { /* ignore */ }
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
 * updateBidWorker
 * ------------------------- */

async function updateBidWorker(actor, bidId, patch = {}, deps = {}, correlationId = null) {
  const bidRepo = deps.bidRepo || await safeRequire('../repositories/bid.repo') || null;
  const requestRepo = deps.requestRepo || await safeRequire('../repositories/request.repo') || null;
  const auditService = deps.auditService || await safeRequire('../services/audit.service') || null;
  const bookingService = deps.bookingService || await safeRequire('../services/booking.service') || null;
  const calendarService = deps.calendarService || await safeRequire('../services/calendar.service') || null;
  const messageRepo = deps.messageRepo || await safeRequire('../repositories/message.repo') || null;
  const MessageModel = deps.MessageModel || await safeRequire('../models/message.model') || null;
  const commsJs = deps.commsJs || await safeRequire('../comms-js') || null;

  // Prefer utils module (renamed to utils+ file). Fallback to legacy worker if present.
  const utils = deps.utils || await safeRequire('../jobs/bid.service.utils+.worker') || await safeRequire('../jobs/bid.service.worker');
  const processedBidSlots = utils && typeof utils.processedBidSlots === 'function' ? utils.processedBidSlots : null;
  const persistAndSubmitMessageHelper = utils && typeof utils.persistAndSubmitMessage === 'function' ? utils.persistAndSubmitMessage : null;
  const deliverMessageHelper = utils && typeof utils.deliverMessageIfPossible === 'function' ? utils.deliverMessageIfPossible : null;

  const actorCtx = actorContext(actor);

  if (!bidRepo || !requestRepo) {
    const err = new Error('Missing repository dependencies');
    err.status = 500;
    throw err;
  }

  const bid = await bidRepo.findById(bidId);
  if (!bid) {
    const err = new Error('Bid not found');
    err.status = 404;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update.failed.not_found',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'failure',
        severity: 'warning',
        correlationId
      });
    }
    throw err;
  }

  const request = await requestRepo.findById(bid.request_id);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update.failed.request_not_found',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'failure',
        severity: 'warning',
        correlationId
      });
    }
    throw err;
  }

  // Block updates if request is booked/closed or bid already accepted
  if (request.status === 'booked' || request.status === 'closed' || request.status === 'archived' || bid.status === 'accepted' || bid.archived) {
    const err = new Error('Cannot update bid: request closed/booked or bid already accepted');
    err.status = 409;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update.failed.request_closed_or_bid_accepted',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { requestStatus: request.status, bidStatus: bid.status }
      });
    }
    throw err;
  }

  // Provider updates (owner)
  if (actor.userId === bid.provider_id && actor.role === 'service_provider') {
    const allowedStatus = ['draft', 'submitted', 'withdrawn'];
    if (patch.status && !allowedStatus.includes(patch.status)) {
      const err = new Error('Invalid status transition for provider');
      err.status = 400;
      throw err;
    }

    const allowed = {};
    ['message', 'quote_amount', 'currency', 'services', 'status', 'metadata'].forEach(k => {
      if (k in patch) allowed[k] = patch[k];
    });

    const updated = await bidRepo.updateById(bidId, allowed);
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { updatedFields: Object.keys(allowed) }
      });
    }

    // Notify request owner and provider about update (best-effort)
    try {
      const subject = `Bid updated for request ${bid.request_id}`;
      const details = `Bid ${bidId} was updated by provider ${actor.userId}. Updated fields: ${Object.keys(allowed).join(', ')}`;
      const recipients = [];
      if (request.createdBy) recipients.push(request.createdBy);
      if (bid.provider_id && bid.provider_id !== request.createdBy) recipients.push(bid.provider_id);

      const msgPayload = {
        type: 'bid',
        recipientsAll: false,
        recipients,
        userId: actor.userId || null,
        serviceId: Array.isArray(updated.services) && updated.services.length ? updated.services[0] : null,
        subject,
        details,
        attachments: [],
        idempotencyKey: `bid_update_${bidId}_${Date.now()}`,
        metadata: Object.assign({}, (updated && updated.metadata) || bid.metadata || {}, { bidId, requestId: bid.request_id, channels: ['in_app'] })
      };

      const messageDoc = await (persistAndSubmitMessageHelper
        ? persistAndSubmitMessageHelper(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
        : defaultPersistAndSubmitMessage(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId));

      await (deliverMessageHelper
        ? deliverMessageHelper(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId)
        : defaultDeliverMessageIfPossible(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId));
    } catch (msgErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
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
    }

    return updated;
  }

  // Owner/admin actions: accept/reject/cancel
  const isOwner = request && request.createdBy === actor.userId;
  const isAdmin = actor.role === 'administrator';
  if (!isOwner && !isAdmin) {
    const err = new Error('Forbidden');
    err.status = 403;
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update.forbidden',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'failure',
        severity: 'warning',
        correlationId
      });
    }
    throw err;
  }

  // Accept flow: process slots once, attach to bookingPayload, then delegate to bookingService
  if (patch.status === 'accepted') {
    if (!bookingService || typeof bookingService.createBookingTransactional !== 'function') {
      const err = new Error('Booking service not available to accept bid');
      err.status = 500;
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept.failed.no_booking_service',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'failure',
          severity: 'error',
          correlationId
        });
      }
      throw err;
    }

    if (!processedBidSlots || typeof processedBidSlots !== 'function') {
      const err = new Error('Slot processing helper not available');
      err.status = 500;
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept.failed.no_slot_processor',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'failure',
          severity: 'error',
          correlationId
        });
      }
      throw err;
    }

    // Prepare worker options so it can read calendars and check capacity
    const services = Array.isArray(bid.services) ? bid.services : [];
    const workerOptions = {
      ownerId: bid.provider_id,
      serviceId: (services && services.length) ? services[0] : null,
      getCalendar: async ({ ownerId, serviceId, weekStartEpoch }) => {
        try {
          if (serviceId && calendarService && typeof calendarService.getLatestByService === 'function') {
            return await calendarService.getLatestByService(serviceId, weekStartEpoch);
          }
          if (ownerId && calendarService && typeof calendarService.getLatestByUser === 'function') {
            return await calendarService.getLatestByUser(ownerId, weekStartEpoch);
          }
        } catch (e) { /* ignore */ }
        return null;
      },
      getBusinessHoursForDay: async ({ dayStartEpoch, calendar, options }) => {
        try {
          if (calendarService && typeof calendarService.getDefaultCalendarView === 'function') {
            return [{ from: dayStartEpoch + 9 * 3600000, to: dayStartEpoch + 17 * 3600000 }];
          }
        } catch (e) { /* ignore */ }
        return [{ from: dayStartEpoch + 9 * 3600000, to: dayStartEpoch + 17 * 3600000 }];
      },
      checkCapacity: async ({ from, to, capacityNeeded, calendar, ownerId, serviceId }) => {
        try {
          if (calendarService && typeof calendarService.isSlotAvailable === 'function') {
            const res = await calendarService.isSlotAvailable({ ownerId: ownerId || null, serviceId: serviceId || null, fromEpoch: from, toEpoch: to, capacityNeeded });
            return res && res.ok ? { ok: true } : { ok: false, code: res && res.code ? res.code : 'CAPACITY', message: res && res.message ? res.message : 'capacity unavailable', details: res };
          }
        } catch (e) {
          return { ok: false, code: 'CAPACITY_CHECK_ERROR', message: e && e.message ? e.message : 'capacity check failed' };
        }
        return { ok: true };
      }
    };

    // Process slots derived from the Request.when and bid.metadata (worker returns structured result)
    let slotResult;
    try {
      slotResult = await processedBidSlots(request.when || [], bid.metadata || {}, workerOptions);
    } catch (procErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept.failed.slot_processing_error',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'failure',
          severity: 'error',
          correlationId,
          details: { error: procErr && procErr.message }
        });
      }
      const err = new Error('Failed to process requested slots for booking');
      err.status = 500;
      throw err;
    }

    // Handle conflicts returned by worker
    if (!slotResult || slotResult.ok === false) {
      const code = slotResult && slotResult.code ? slotResult.code : 'SLOT_CONFLICT';
      const conflicts = slotResult && slotResult.conflicts ? slotResult.conflicts : [];

      // Off-limits conflict: abort accept and return 409 (owner must resolve)
      const hasOffLimits = conflicts.some(c => (c && c.reason && c.reason.startsWith('OFF_LIMITS')) || (c && c.type === 'offlimits'));
      if (hasOffLimits) {
        if (auditService && typeof auditService.logEvent === 'function') {
          await auditService.logEvent({
            eventType: 'bid.accept.failed.offlimits_conflict',
            actor: actorCtx,
            target: { type: 'Bid', id: bidId },
            outcome: 'failure',
            severity: 'warning',
            correlationId,
            details: { conflicts }
          });
        }
        const err = new Error('Requested slots conflict with provider/service off-limits; cannot accept bid.');
        err.status = 409;
        err.details = conflicts;
        throw err;
      }

      // Capacity conflict or other availability: archive bid and mark request metadata for owner action
      const hasCapacity = conflicts.some(c => c && (c.reason === 'CAPACITY' || c.reason === 'CAPACITY_CHECK_FAILED' || c.type === 'capacity'));
      if (hasCapacity) {
        try {
          await bidRepo.updateById(bidId, { archived: true, status: 'archived', updatedAt: Date.now() });
        } catch (_) { /* ignore */ }

        try {
          const newMeta = Object.assign({}, request.metadata || {}, { archivedBySystem: true, archivedReason: 'capacity_conflict', archivedAt: Date.now() });
          await requestRepo.updateById(request._id ? request._id.toString() : request._id, { metadata: newMeta, status: 'pending_action', updatedAt: Date.now() });
        } catch (_) { /* ignore */ }

        if (auditService && typeof auditService.logEvent === 'function') {
          await auditService.logEvent({
            eventType: 'bid.accept.failed.capacity_conflict',
            actor: actorCtx,
            target: { type: 'Bid', id: bidId },
            outcome: 'failure',
            severity: 'warning',
            correlationId,
            details: { conflicts }
          });
        }

        // notify provider and owner (best-effort)
        try {
          const providerMsg = {
            type: 'bid',
            recipientsAll: false,
            recipients: [bid.provider_id],
            userId: actor.userId || null,
            serviceId: services.length ? services[0] : null,
            subject: `Bid archived due to capacity conflict for request ${bid.request_id}`,
            details: `Your bid could not be accepted because you or your involved service is no longer available at the requested hours. The bid has been archived.`,
            attachments: [],
            idempotencyKey: `bid_capacity_archive_${bidId}_${Date.now()}`,
            metadata: { bidId, requestId: bid.request_id, channels: ['in_app'] }
          };

          const messageDoc = await (persistAndSubmitMessageHelper
            ? persistAndSubmitMessageHelper(providerMsg, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
            : defaultPersistAndSubmitMessage(providerMsg, actorCtx, { messageRepo, MessageModel, auditService }, correlationId));

          await (deliverMessageHelper
            ? deliverMessageHelper(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId)
            : defaultDeliverMessageIfPossible(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId));
        } catch (_) { /* ignore */ }

        try {
          const ownerRecipients = [];
          if (request.createdBy) ownerRecipients.push(request.createdBy);
          if (ownerRecipients.length) {
            const ownerMsg = {
              type: 'bid',
              recipientsAll: false,
              recipients: ownerRecipients,
              userId: actor.userId || null,
              serviceId: services.length ? services[0] : null,
              subject: `Bid archived for request ${bid.request_id} due to availability change`,
              details: `A bid was archived because the provider/service is no longer available at the requested hours. Please review the request.`,
              attachments: [],
              idempotencyKey: `bid_capacity_owner_${bidId}_${Date.now()}`,
              metadata: { bidId, requestId: bid.request_id, channels: ['in_app'], pendingAction: true }
            };

            const ownerMessageDoc = await (persistAndSubmitMessageHelper
              ? persistAndSubmitMessageHelper(ownerMsg, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
              : defaultPersistAndSubmitMessage(ownerMsg, actorCtx, { messageRepo, MessageModel, auditService }, correlationId));

            await (deliverMessageHelper
              ? deliverMessageHelper(ownerMessageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId)
              : defaultDeliverMessageIfPossible(ownerMessageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId));
          }
        } catch (_) { /* ignore */ }

        const err = new Error('Capacity conflict: provider/service no longer available at requested hours. Bid archived.');
        err.status = 409;
        err.details = conflicts;
        throw err;
      }

      // Generic conflict fallback
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept.failed.slot_conflict_generic',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { code, conflicts }
        });
      }
      const err = new Error('Requested slots conflict with availability; cannot accept bid.');
      err.status = 409;
      err.details = conflicts;
      throw err;
    }

    // Success: attach processed slots to bookingPayload (do not persist on Bid)
    const bookingPayload = {
      requestId: bid.request_id,
      seekerId: request.createdBy,
      providerId: bid.provider_id,
      bidId: bidId,
      quoteAmount: bid.quote_amount,
      currency: bid.currency,
      services: bid.services || [],
      slots: Array.isArray(slotResult.slots) ? slotResult.slots : (bid.slots || []),
      metadata: Object.assign({}, bid.metadata || {}, { originatingBid: bidId })
    };

    try {
      // bookingService will finalize booking, calendars, and update bid/request state
      await bookingService.createBookingTransactional({ userId: actor.userId, role: actor.role }, bookingPayload, correlationId);

      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'success',
          severity: 'info',
          correlationId,
          details: { request_id: bid.request_id }
        });
      }

      // Post-accept notifications (best-effort)
      try {
        const subject = `Bid accepted for request ${bid.request_id}`;
        const details = `Bid ${bidId} has been accepted and booking created.`;
        const recipients = [];
        if (request.createdBy) recipients.push(request.createdBy);
        if (bid.provider_id && bid.provider_id !== request.createdBy) recipients.push(bid.provider_id);

        const msgPayload = {
          type: 'bid',
          recipientsAll: false,
          recipients,
          userId: actor.userId || null,
          serviceId: Array.isArray(bid.services) && bid.services.length ? bid.services[0] : null,
          subject,
          details,
          attachments: [],
          idempotencyKey: `bid_accept_${bidId}`,
          metadata: Object.assign({}, bid.metadata || {}, { bidId, requestId: bid.request_id, channels: ['in_app'] })
        };

        const messageDoc = await (persistAndSubmitMessageHelper
          ? persistAndSubmitMessageHelper(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
          : defaultPersistAndSubmitMessage(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId));

        await (deliverMessageHelper
          ? deliverMessageHelper(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId)
          : defaultDeliverMessageIfPossible(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId));
      } catch (msgErr) {
        if (auditService && typeof auditService.logEvent === 'function') {
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
      }

      return await bidRepo.findById(bidId);
    } catch (e) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.accept.failed',
          actor: actorCtx,
          target: { type: 'Bid', id: bidId },
          outcome: 'failure',
          severity: 'error',
          correlationId,
          details: { error: e && e.message }
        });
      }
      throw e;
    }
  }

  // Reject or cancel
  if (['rejected', 'cancelled'].includes(patch.status)) {
    const updated = await bidRepo.updateById(bidId, { status: patch.status });

    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: `bid.${patch.status}`,
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'success',
        severity: 'info',
        correlationId
      });
    }

    // Notify request owner and bid creator (provider)
    try {
      const subject = `Bid ${patch.status} for request ${bid.request_id}`;
      const details = `Bid ${bidId} has been ${patch.status} by ${actor.userId || 'system'}.`;
      const recipients = [];
      if (request.createdBy) recipients.push(request.createdBy);
      if (bid.provider_id && bid.provider_id !== request.createdBy) recipients.push(bid.provider_id);

      const msgPayload = {
        type: 'bid',
        recipientsAll: false,
        recipients,
        userId: actor.userId || null,
        serviceId: Array.isArray(bid.services) && bid.services.length ? bid.services[0] : null,
        subject,
        details,
        attachments: [],
        idempotencyKey: `bid_${patch.status}_${bidId}_${Date.now()}`,
        metadata: Object.assign({}, bid.metadata || {}, { bidId, requestId: bid.request_id, channels: ['in_app'] })
      };

      const messageDoc = await (persistAndSubmitMessageHelper
        ? persistAndSubmitMessageHelper(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId)
        : defaultPersistAndSubmitMessage(msgPayload, actorCtx, { messageRepo, MessageModel, auditService }, correlationId));

      await (deliverMessageHelper
        ? deliverMessageHelper(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId)
        : defaultDeliverMessageIfPossible(messageDoc, actorCtx, { MessageModel, commsJs, auditService }, correlationId));
    } catch (msgErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
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
    }

    return updated;
  }

  // If no recognized action, apply generic patch (admin may update other fields)
  const allowedAdmin = {};
  ['message', 'quote_amount', 'currency', 'services', 'status', 'metadata', 'archived'].forEach(k => {
    if (k in patch) allowedAdmin[k] = patch[k];
  });

  if (Object.keys(allowedAdmin).length > 0) {
    const updated = await bidRepo.updateById(bidId, allowedAdmin);
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.update',
        actor: actorCtx,
        target: { type: 'Bid', id: bidId },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { updatedFields: Object.keys(allowedAdmin) }
      });
    }
    return updated;
  }

  // Nothing to do
  return bid;
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  updateBidWorker
};
