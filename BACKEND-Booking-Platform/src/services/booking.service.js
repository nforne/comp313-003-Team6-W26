/**
 * src/services/booking.service.js
 *
 * Booking service - production-ready (polished, non-disruptive)
 *
 * - createBookingTransactional: atomic booking creation using MongoDB session
 * - updateBooking: controlled updates with RBAC for status transitions and slot changes
 * - cancelBooking: cancel booking, remove future calendar entries, notify parties
 *
 * Notes:
 * - calendarService is optional; when present it may be session-aware (calendarService.requiresSession).
 * - messageRepo / comms-js are optional; delivery is best-effort and audited.
 * - All messages created here are persisted and transitioned to status "submitted" before delivery.
 */

const mongoose = require('mongoose');
const bookingRepo = require('../repositories/booking.repo');
const requestRepo = require('../repositories/request.repo');
const bidRepo = require('../repositories/bid.repo');
const auditService = require('./audit.service');

// Scheduler utilities (Agenda wrapper)
const { scheduleHonorJob, cancelHonorJob } = require('../jobs/bookingScheduler');

// Optional integrations (defensive requires)
let calendarService;
try { calendarService = require('./calendar.service'); } catch (e) { calendarService = null; }

let messageRepo;
try { messageRepo = require('../repositories/message.repo'); } catch (e) { messageRepo = null; }

let MessageModel;
try { MessageModel = require('../models/message.model'); } catch (e) { MessageModel = null; }

let commsJs;
try { commsJs = require('../comms-js'); } catch (e) { commsJs = null; }

/* -------------------------
 * Helpers
 * ------------------------- */

function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.map(s => ({ from: Number(s.from), to: Number(s.to) }));
}

function actorContext(actor) {
  return { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null };
}

function buildRecipientsFromBooking(booking) {
  const recipients = [];
  if (booking.seeker_id) recipients.push(booking.seeker_id);
  if (booking.provider_id && booking.provider_id !== booking.seeker_id) recipients.push(booking.provider_id);
  return recipients;
}

async function persistAndSubmitMessage(payload, actorCtx, correlationId = null) {
  // Persist message (idempotent when repo supports idempotency) and ensure status is 'submitted'
  let messageDoc = null;

  if (messageRepo && typeof messageRepo.createMessage === 'function') {
    try {
      messageDoc = await messageRepo.createMessage(payload);
      // If repo returned a plain object (lean), try to load instance to call helper
      if (messageDoc && typeof messageDoc.markSubmitted !== 'function' && messageDoc._id) {
        try {
          const Message = require('../models/message.model');
          messageDoc = await Message.findById(messageDoc._id).exec();
        } catch (_) { /* ignore */ }
      }
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else {
        // fallback: ensure persisted status via repo update
        try {
          if (messageDoc && messageDoc._id && typeof messageRepo.updateMessage === 'function') {
            await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() });
          }
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      await auditService.logEvent({
        eventType: 'booking.message.create_failed',
        actor: actorCtx,
        target: { type: 'Message', id: payload && payload.metadata && payload.metadata.bookingId ? payload.metadata.bookingId : null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: err && err.message }
      });
      messageDoc = null;
    }
  }

  if (!messageDoc && MessageModel && typeof MessageModel.buildDraft === 'function') {
    try {
      const draft = MessageModel.buildDraft(Object.assign({}, payload, { status: 'draft' }));
      messageDoc = await draft.save();
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else {
        // fallback: update via repo if available
        if (messageDoc && messageDoc._id && messageRepo && typeof messageRepo.updateMessage === 'function') {
          try { await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() }); } catch (_) { /* ignore */ }
        }
      }
    } catch (err) {
      await auditService.logEvent({
        eventType: 'booking.message.model_failed',
        actor: actorCtx,
        target: { type: 'Message', id: payload && payload.metadata && payload.metadata.bookingId ? payload.metadata.bookingId : null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: err && err.message }
      });
      messageDoc = null;
    }
  }

  return messageDoc;
}

/* -------------------------
 * createBookingTransactional
 * ------------------------- */

async function createBookingTransactional(actor, payload, correlationId = null) {
  const actorCtx = actorContext(actor);

  // Basic validation
  if (!payload || !payload.requestId || !payload.providerId || !payload.seekerId || !Array.isArray(payload.slots) || payload.slots.length === 0) {
    const err = new Error('Missing booking payload fields or slots');
    err.status = 400;
    throw err;
  }

  payload.slots = normalizeSlots(payload.slots);

  // Load request and ensure it's active
  const request = await requestRepo.findById(payload.requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  if (!['active', 'pending_action'].includes(request.status)) {
    const err = new Error('Request not open for booking');
    err.status = 409;
    throw err;
  }

  // Determine calendar targets
  const serviceIds = Array.isArray(payload.services) ? payload.services.filter(Boolean) : [];
  const calendarTargets = serviceIds.length > 0
    ? serviceIds.map(sid => ({ type: 'service', id: sid }))
    : [{ type: 'provider', id: payload.providerId }];

  // Pre-check availability (best-effort) when calendarService exists and is non-session
  if (calendarService && typeof calendarService.checkRangeAvailability === 'function' && !calendarService.requiresSession) {
    for (const target of calendarTargets) {
      const ownerId = target.type === 'provider' ? target.id : null;
      const serviceId = target.type === 'service' ? target.id : null;
      for (const s of payload.slots) {
        const avail = await calendarService.checkRangeAvailability({ ownerId, serviceId, fromEpoch: s.from, toEpoch: s.to, capacityNeeded: s.capacityNeeded || payload.capacityNeeded || 1 });
        if (!avail || !avail.ok) {
          const err = new Error('Requested slots are not available on the calendar');
          err.status = 409;
          await auditService.logEvent({
            eventType: 'booking.create.failed.calendar_conflict',
            actor: actorCtx,
            target: { type: target.type, id: target.id },
            outcome: 'failure',
            severity: 'warning',
            correlationId,
            details: { conflicts: avail && avail.conflicts }
          });
          throw err;
        }
      }
    }
  }

  const session = await mongoose.startSession();
  let booking;
  const reservations = [];

  try {
    session.startTransaction();

    // If calendarService supports session-aware tentative reservations, reserve them now
    if (calendarService && typeof calendarService.reserveTentativeSlots === 'function' && calendarService.requiresSession) {
      for (const target of calendarTargets) {
        const res = await calendarService.reserveTentativeSlots({
          type: target.type,
          id: target.id,
          slots: payload.slots,
          metadata: { requestId: payload.requestId, bidId: payload.bidId || null }
        }, { session });
        reservations.push(res);
      }
    }

    // Create booking record inside transaction
    const bookingObj = {
      request_id: payload.requestId,
      seeker_id: payload.seekerId,
      provider_id: payload.providerId,
      bid_id: payload.bidId || null,
      quote_amount: payload.quoteAmount,
      currency: payload.currency || 'CAD',
      services: payload.services || [],
      slots: payload.slots || [],
      description: payload.notes || payload.description || '',
      status: 'active',
      metadata: payload.metadata || {}
    };

    booking = await bookingRepo.createWithSession(bookingObj, session);

    // Update request status inside transaction
    if (typeof requestRepo.updateByIdWithSession === 'function') {
      await requestRepo.updateByIdWithSession(request._id, { status: 'booked' }, session);
    } else {
      await requestRepo.updateById(request._id, { status: 'booked', updatedAt: Date.now() });
    }

    // Update bid(s)
    if (payload.bidId) {
      if (typeof bidRepo.updateByIdWithSession === 'function') {
        await bidRepo.updateByIdWithSession(payload.bidId, { status: 'accepted' }, session);
      } else {
        await bidRepo.updateById(payload.bidId, { status: 'accepted' });
      }

      const rejectFilter = { request_id: payload.requestId, status: 'submitted', archived: false, _id: { $ne: payload.bidId } };
      if (typeof bidRepo.updateMany === 'function') {
        if (typeof bidRepo.updateManyWithSession === 'function') {
          await bidRepo.updateManyWithSession(rejectFilter, { status: 'rejected' }, session);
        } else {
          await bidRepo.updateMany(rejectFilter, { status: 'rejected' }, session);
        }
      }
      // remove draft bids
      await mongoose.model('Bid').deleteMany({ request_id: payload.requestId, status: 'draft' }).session(session).exec();
    } else {
      // no bid provided: reject submitted and remove drafts
      const rejectFilter = { request_id: payload.requestId, status: 'submitted', archived: false };
      if (typeof bidRepo.updateManyWithSession === 'function') {
        await bidRepo.updateManyWithSession(rejectFilter, { status: 'rejected' }, session);
      } else {
        await bidRepo.updateMany(rejectFilter, { status: 'rejected' }, session);
      }
      await mongoose.model('Bid').deleteMany({ request_id: payload.requestId, status: 'draft' }).session(session).exec();
    }

    // Confirm calendar slots inside transaction if calendarService supports it
    if (calendarService && typeof calendarService.confirmSlots === 'function' && calendarService.requiresSession) {
      for (const r of reservations) {
        await calendarService.confirmSlots({ reservationToken: r.token, bookingId: booking._id.toString() }, { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Post-commit: confirm slots for non-session calendarService (best-effort)
    if (calendarService && typeof calendarService.confirmSlots === 'function' && !calendarService.requiresSession) {
      try {
        for (const target of calendarTargets) {
          await calendarService.confirmSlots({ type: target.type, id: target.id, bookingId: booking._id.toString(), slots: booking.slots });
        }
      } catch (confirmErr) {
        await auditService.logEvent({
          eventType: 'booking.calendar.confirm_failed',
          actor: actorCtx,
          target: { type: 'Booking', id: booking._id.toString() },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: confirmErr && confirmErr.message }
        });
      }
    }

    // Schedule honor job
    try {
      const endEpoch = (booking.slots && booking.slots.length) ? Math.max(...booking.slots.map(s => s.to)) : Date.now();
      const BUFFER_MS = 60 * 1000;
      const runAt = endEpoch + BUFFER_MS;
      await scheduleHonorJob(booking._id.toString(), runAt, correlationId);
      await auditService.logEvent({
        eventType: 'booking.honor.scheduled',
        actor: { userId: null, role: 'system' },
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { runAt }
      });
    } catch (schedErr) {
      await auditService.logEvent({
        eventType: 'booking.honor.schedule_failed',
        actor: { userId: null, role: 'system' },
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: schedErr && schedErr.message }
      });
    }

    // Post-commit: audit
    await auditService.logEvent({
      eventType: 'booking.create',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { requestId: payload.requestId, providerId: payload.providerId, calendarTargets }
    });

    // Create and deliver message to involved parties (best-effort) and request email channel
    try {
      const subject = `Booking ${booking.booking_id || booking._id.toString()} confirmed`;
      const details = `Booking ${booking.booking_id || booking._id.toString()} has been created. Provider: ${booking.provider_id}, Seeker: ${booking.seeker_id}.`;

      const recipients = buildRecipientsFromBooking(booking);

      const msgPayload = {
        type: 'booking',
        recipientsAll: false,
        recipients,
        userId: actor && actor.userId ? actor.userId : null,
        serviceId: (Array.isArray(booking.services) && booking.services.length) ? booking.services[0] : null,
        subject,
        details,
        attachments: [],
        idempotencyKey: `booking_create_${booking._id.toString()}`,
        metadata: Object.assign({}, booking.metadata || {}, { bookingId: booking._id.toString(), channels: ['email', 'in_app'] })
      };

      const messageDoc = await persistAndSubmitMessage(msgPayload, actorCtx, correlationId);

      if (commsJs && typeof commsJs.deliverMessage === 'function' && messageDoc && messageDoc._id) {
        try {
          await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true });
          await auditService.logEvent({
            eventType: 'booking.message.delivered',
            actor: actorCtx,
            target: { type: 'Message', id: messageDoc._id.toString() },
            outcome: 'success',
            severity: 'info',
            correlationId,
            details: { bookingId: booking._id.toString() }
          });
        } catch (deliverErr) {
          await auditService.logEvent({
            eventType: 'booking.message.deliver_failed',
            actor: actorCtx,
            target: { type: 'Message', id: messageDoc._id ? messageDoc._id.toString() : null },
            outcome: 'failure',
            severity: 'warning',
            correlationId,
            details: { error: deliverErr && deliverErr.message ? deliverErr.message : String(deliverErr) }
          });
        }
      } else {
        await auditService.logEvent({
          eventType: 'booking.message.deliver_skipped',
          actor: actorCtx,
          target: { type: 'Booking', id: booking._id.toString() },
          outcome: 'info',
          severity: 'info',
          correlationId,
          details: { reason: 'comms-js or message not available' }
        });
      }
    } catch (err) {
      await auditService.logEvent({
        eventType: 'booking.notification.error',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: err && err.message }
      });
    }

    return booking;
  } catch (e) {
    try { await session.abortTransaction(); } catch (_) { /* ignore */ }
    session.endSession();

    // Release tentative reservations if any
    if (calendarService && typeof calendarService.releaseTentativeSlots === 'function' && reservations && reservations.length) {
      try {
        for (const r of reservations) {
          await calendarService.releaseTentativeSlots({ reservationToken: r.token });
        }
      } catch (releaseErr) {
        await auditService.logEvent({
          eventType: 'booking.calendar.release_failed',
          actor: actorCtx,
          target: { type: 'Request', id: payload.requestId },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: releaseErr && releaseErr.message }
        });
      }
    }

    await auditService.logEvent({
      eventType: 'booking.create.failed',
      actor: actorCtx,
      target: { type: 'Request', id: payload.requestId },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { error: e && e.message }
    });

    throw e;
  }
}

/* -------------------------
 * cancelBooking
 * ------------------------- */

async function cancelBooking(actor, bookingId, reason = '', correlationId = null) {
  const actorCtx = actorContext(actor);
  const booking = await bookingRepo.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const isSeeker = actor && actor.userId === booking.seeker_id;
  const isProvider = actor && actor.userId === booking.provider_id;
  const isAdmin = actor && actor.role === 'administrator';
  if (!isSeeker && !isProvider && !isAdmin) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  // If already cancelled/suspended, return as-is
  if (['seeker_cancelled', 'provider_cancelled', 'suspended'].includes(booking.status)) {
    return booking;
  }

  const newStatus = isSeeker ? 'seeker_cancelled' : (isProvider ? 'provider_cancelled' : 'suspended');

  // Append cancellation metadata while preserving existing metadata
  const cancellationMeta = Object.assign({}, booking.metadata || {});
  cancellationMeta.lastCancellation = {
    at: Date.now(),
    by: actor && actor.userId ? actor.userId : null,
    role: actor && actor.role ? actor.role : null,
    reason: reason || null
  };

  // Persist status change (applies whether booking is past or future)
  const updated = await bookingRepo.updateById(booking._id || bookingId, {
    status: newStatus,
    metadata: cancellationMeta,
    updatedAt: Date.now()
  });

  // Cancel scheduled honor job (best-effort)
  try {
    await cancelHonorJob(booking._id.toString());
    await auditService.logEvent({
      eventType: 'booking.honor.cancelled',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });
  } catch (e) {
    await auditService.logEvent({
      eventType: 'booking.honor.cancel_failed',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: e && e.message }
    });
  }

  // If booking end is in the future, remove booking from calendars (best-effort).
  try {
    const lastSlotTo = (booking.slots && booking.slots.length) ? Math.max(...booking.slots.map(s => s.to)) : null;
    const now = Date.now();
    if (lastSlotTo && lastSlotTo > now) {
      const targets = (Array.isArray(booking.services) && booking.services.length > 0)
        ? booking.services.map(sid => ({ type: 'service', id: sid }))
        : [{ type: 'provider', id: booking.provider_id }];

      for (const t of targets) {
        if (calendarService && typeof calendarService.removeBooking === 'function') {
          try {
            await calendarService.removeBooking({ type: t.type, id: t.id, bookingId: booking._id.toString(), slots: booking.slots });
            await auditService.logEvent({
              eventType: 'booking.calendar.removed',
              actor: actorCtx,
              target: { type: t.type, id: t.id },
              outcome: 'success',
              severity: 'info',
              correlationId,
              details: { bookingId: booking._id.toString() }
            });
          } catch (err) {
            await auditService.logEvent({
              eventType: 'booking.calendar.remove_failed',
              actor: actorCtx,
              target: { type: t.type, id: t.id },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { error: err && err.message }
            });
          }
        } else if (calendarService && typeof calendarService.releaseTentativeSlots === 'function') {
          try {
            await calendarService.releaseTentativeSlots({ reservationToken: booking._id.toString() });
            await auditService.logEvent({
              eventType: 'booking.calendar.released',
              actor: actorCtx,
              target: { type: t.type, id: t.id },
              outcome: 'success',
              severity: 'info',
              correlationId,
              details: { bookingId: booking._id.toString() }
            });
          } catch (err) {
            await auditService.logEvent({
              eventType: 'booking.calendar.release_failed',
              actor: actorCtx,
              target: { type: t.type, id: t.id },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { error: err && err.message }
            });
          }
        } else {
          await auditService.logEvent({
            eventType: 'booking.calendar.noop',
            actor: actorCtx,
            target: { type: t.type, id: t.id },
            outcome: 'info',
            severity: 'info',
            correlationId,
            details: { message: 'No calendar API available to remove booking' }
          });
        }
      }
    }
  } catch (err) {
    await auditService.logEvent({
      eventType: 'booking.calendar.cleanup_error',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: err && err.message }
    });
  }

  // Create and deliver message to involved parties (best-effort)
  try {
    const subject = `Booking ${booking.booking_id || booking._id.toString()} cancelled`;
    const details = `Booking ${booking.booking_id || booking._id.toString()} has been cancelled by ${actor && actor.userId ? actor.userId : 'system'}. Reason: ${reason || 'not provided'}.`;

    const recipients = buildRecipientsFromBooking(booking);

    const msgPayload = {
      type: 'booking',
      recipientsAll: false,
      recipients,
      userId: actor && actor.userId ? actor.userId : null,
      serviceId: (Array.isArray(booking.services) && booking.services.length) ? booking.services[0] : null,
      subject,
      details,
      attachments: [],
      idempotencyKey: `booking_cancel_${booking._id.toString()}`,
      metadata: Object.assign({}, booking.metadata || {}, { bookingId: booking._id.toString(), cancelledBy: actor && actor.userId ? actor.userId : null, channels: ['email', 'in_app'] })
    };

    const messageDoc = await persistAndSubmitMessage(msgPayload, actorCtx, correlationId);

    if (commsJs && typeof commsJs.deliverMessage === 'function' && messageDoc && messageDoc._id) {
      try {
        await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true });
        await auditService.logEvent({
          eventType: 'booking.message.delivered',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id.toString() },
          outcome: 'success',
          severity: 'info',
          correlationId,
          details: { bookingId: booking._id.toString() }
        });
      } catch (deliverErr) {
        await auditService.logEvent({
          eventType: 'booking.message.deliver_failed',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id ? messageDoc._id.toString() : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: deliverErr && deliverErr.message ? deliverErr.message : String(deliverErr) }
        });
      }
    } else {
      await auditService.logEvent({
        eventType: 'booking.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'comms-js or message not available' }
      });
    }
  } catch (err) {
    await auditService.logEvent({
      eventType: 'booking.notification.error',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: err && err.message }
    });
  }

  await auditService.logEvent({
    eventType: 'booking.cancel',
    actor: actorCtx,
    target: { type: 'Booking', id: booking._id.toString() },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { reason }
  });

  return updated;
}

/* -------------------------
 * updateBooking
 * - Handles calendarService.checkRangeAvailability/reserveTentativeSlots and session-aware flow.
 * - Non-disruptive: preserves RBAC and existing behavior; only adds guarded calendar checks/reservations.
 * - Also creates and delivers a message to involved parties (best-effort) when update succeeds.
 * ------------------------- */

async function updateBooking(actor, bookingId, patch = {}, correlationId = null) {
  const actorCtx = actorContext(actor);
  const booking = await bookingRepo.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const allowedFields = ['what', 'where', 'slots', 'services', 'quote_amount', 'currency', 'description', 'status', 'metadata'];
  const update = {};
  allowedFields.forEach(k => { if (k in patch) update[k] = patch[k]; });

  if (Object.keys(update).length === 0) return booking;

  // Status transition checks
  if ('status' in update) {
    const newStatus = update.status;
    const ALLOWED_STATUSES = ['active', 'honored', 'seeker_cancelled', 'provider_cancelled', 'suspended'];
    if (!ALLOWED_STATUSES.includes(newStatus)) {
      const err = new Error('Invalid booking status');
      err.status = 400;
      throw err;
    }

    const isSeeker = actor && actor.userId === booking.seeker_id;
    const isProvider = actor && actor.userId === booking.provider_id;
    const isAdmin = actor && actor.role === 'administrator';

    if (newStatus === 'seeker_cancelled' && !isSeeker && !isAdmin) {
      const err = new Error('Only the seeker or admin may cancel as seeker');
      err.status = 403;
      throw err;
    }
    if (newStatus === 'provider_cancelled' && !isProvider && !isAdmin) {
      const err = new Error('Only the provider or admin may cancel as provider');
      err.status = 403;
      throw err;
    }
    if (newStatus === 'honored' && !isAdmin) {
      const err = new Error('Only administrators may manually mark booking honored');
      err.status = 403;
      throw err;
    }
    if (newStatus === 'suspended' && !isAdmin) {
      const err = new Error('Only administrators may suspend bookings');
      err.status = 403;
      throw err;
    }
  }

  // If slots are being changed, handle calendar checks/reservations (session-aware when possible)
  let tentativeReservations = [];
  let reservationTokens = [];
  let session = null;
  let usedSession = false;

  if ('slots' in update) {
    update.slots = normalizeSlots(update.slots);

    // Determine calendar targets for this booking (services preferred)
    const targets = (Array.isArray(update.services) && update.services.length > 0)
      ? update.services.map(sid => ({ type: 'service', id: sid }))
      : (Array.isArray(booking.services) && booking.services.length > 0)
        ? booking.services.map(sid => ({ type: 'service', id: sid }))
        : [{ type: 'provider', id: booking.provider_id }];

    try {
      // If calendarService supports session-aware reservations, perform transaction
      if (calendarService && typeof calendarService.reserveTentativeSlots === 'function' && calendarService.requiresSession) {
        session = await mongoose.startSession();
        usedSession = true;
        session.startTransaction();

        // Reserve tentative slots for each target within session
        for (const t of targets) {
          const res = await calendarService.reserveTentativeSlots({
            type: t.type,
            id: t.id,
            slots: update.slots,
            metadata: { bookingId: booking._id.toString(), updatedBy: actorCtx.userId || null }
          }, { session });
          tentativeReservations.push(res);
        }

        // Apply booking update inside same session (use session-aware repo if available)
        if (typeof bookingRepo.updateByIdWithSession === 'function') {
          await bookingRepo.updateByIdWithSession(booking._id || bookingId, update, session);
        } else {
          await mongoose.model('Booking').findByIdAndUpdate(booking._id || bookingId, { $set: update }, { new: true, session }).exec();
        }

        // Confirm tentative reservations inside session
        if (calendarService && typeof calendarService.confirmSlots === 'function') {
          for (const r of tentativeReservations) {
            await calendarService.confirmSlots({ reservationToken: r.token, bookingId: booking._id.toString() }, { session });
          }
        }

        await session.commitTransaction();
        session.endSession();
        usedSession = false;
      } else if (calendarService && typeof calendarService.checkRangeAvailability === 'function') {
        // Non-transactional flow: pre-check availability per target and reserve tentative slots (no session)
        for (const t of targets) {
          const ownerId = t.type === 'provider' ? t.id : null;
          const serviceId = t.type === 'service' ? t.id : null;

          // check each slot individually
          for (const s of update.slots) {
            const avail = await calendarService.checkRangeAvailability({ ownerId, serviceId, fromEpoch: s.from, toEpoch: s.to, capacityNeeded: 1 });
            if (!avail || !avail.ok) {
              const err = new Error('Requested slots are not available on the calendar');
              err.status = 409;
              await auditService.logEvent({
                eventType: 'booking.update.failed.calendar_conflict',
                actor: actorCtx,
                target: { type: t.type, id: t.id },
                outcome: 'failure',
                severity: 'warning',
                correlationId,
                details: { conflicts: avail && avail.conflicts }
              });
              throw err;
            }
          }

          // reserve tentative slots (best-effort)
          try {
            const res = await calendarService.reserveTentativeSlots({
              type: t.type,
              id: t.id,
              slots: update.slots,
              metadata: { bookingId: booking._id.toString(), updatedBy: actorCtx.userId || null }
            }, {});
            tentativeReservations.push(res);
            if (res && res.token) reservationTokens.push(res.token);
          } catch (err) {
            // rollback any previously created tentative reservations
            try {
              for (const tok of reservationTokens) {
                if (calendarService && typeof calendarService.releaseTentativeSlots === 'function') {
                  await calendarService.releaseTentativeSlots({ reservationToken: tok });
                }
              }
            } catch (_) { /* ignore */ }
            throw err;
          }
        }

        // Persist booking update (non-transactional)
        await bookingRepo.updateById(booking._id || bookingId, update);

        // Confirm tentative reservations (best-effort)
        for (const r of tentativeReservations) {
          try {
            if (calendarService && typeof calendarService.confirmSlots === 'function') {
              await calendarService.confirmSlots({ reservationToken: r.token, bookingId: booking._id.toString() }, {});
            }
          } catch (confirmErr) {
            await auditService.logEvent({
              eventType: 'booking.calendar.confirm_failed',
              actor: actorCtx,
              target: { type: 'Booking', id: booking._id.toString() },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { error: confirmErr && confirmErr.message }
            });
            // do not throw; leave reconciliation to outbox
          }
        }
      } else {
        // No calendarService available: proceed with update (no checks)
        await bookingRepo.updateById(booking._id || bookingId, update);
      }
    } catch (err) {
      // rollback session if used
      if (usedSession && session) {
        try { await session.abortTransaction(); } catch (_) { /* ignore */ }
        session.endSession();
      }
      // release tentative reservations if any (best-effort)
      try {
        for (const r of tentativeReservations) {
          if (r && r.token && calendarService && typeof calendarService.releaseTentativeSlots === 'function') {
            await calendarService.releaseTentativeSlots({ reservationToken: r.token });
          }
        }
      } catch (_) { /* ignore */ }

      await auditService.logEvent({
        eventType: 'booking.update.failed.calendar',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: err && err.message }
      });

      throw err;
    }
  }

  // If slots were not changed (or after successful slot handling), ensure we have the latest booking
  const updated = await bookingRepo.findById(booking._id || bookingId);

  // If status changed away from active, cancel honor job
  if ('status' in update && update.status !== 'active') {
    try {
      await cancelHonorJob(booking._id.toString());
    } catch (e) {
      await auditService.logEvent({
        eventType: 'booking.honor.cancel_failed',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: e && e.message }
      });
    }
  }

  // If slots changed and booking remains active, reschedule honor job
  if ('slots' in update && updated && updated.status === 'active') {
    try {
      await cancelHonorJob(booking._id.toString());
      const endEpoch = (updated.slots && updated.slots.length) ? Math.max(...updated.slots.map(s => s.to)) : Date.now();
      const BUFFER_MS = 60 * 1000;
      const runAt = endEpoch + BUFFER_MS;
      await scheduleHonorJob(booking._id.toString(), runAt, correlationId);
    } catch (schedErr) {
      await auditService.logEvent({
        eventType: 'booking.honor.reschedule_failed',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: schedErr && schedErr.message }
      });
    }
  }

  // Create and deliver message to involved parties (best-effort)
  try {
    const subject = `Booking ${booking.booking_id || booking._id.toString()} updated`;
    const details = `Booking ${booking.booking_id || booking._id.toString()} has been updated. Updated fields: ${Object.keys(update).join(', ')}`;

    const recipients = buildRecipientsFromBooking(updated || booking);

    const msgPayload = {
      type: 'booking',
      recipientsAll: false,
      recipients,
      userId: actor && actor.userId ? actor.userId : null,
      serviceId: (Array.isArray(updated && updated.services) && updated.services.length) ? updated.services[0] : ((Array.isArray(booking.services) && booking.services.length) ? booking.services[0] : null),
      subject,
      details,
      attachments: [],
      idempotencyKey: `booking_update_${booking._id.toString()}_${Date.now()}`,
      metadata: Object.assign({}, (updated && updated.metadata) || booking.metadata || {}, { bookingId: booking._id.toString(), channels: ['email', 'in_app'] })
    };

    const messageDoc = await persistAndSubmitMessage(msgPayload, actorCtx, correlationId);

    if (commsJs && typeof commsJs.deliverMessage === 'function' && messageDoc && messageDoc._id) {
      try {
        await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true });
        await auditService.logEvent({
          eventType: 'booking.message.delivered',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id.toString() },
          outcome: 'success',
          severity: 'info',
          correlationId,
          details: { bookingId: booking._id.toString() }
        });
      } catch (deliverErr) {
        await auditService.logEvent({
          eventType: 'booking.message.deliver_failed',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id ? messageDoc._id.toString() : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: deliverErr && deliverErr.message ? deliverErr.message : String(deliverErr) }
        });
      }
    } else {
      await auditService.logEvent({
        eventType: 'booking.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Booking', id: booking._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'comms-js or message not available' }
      });
    }
  } catch (err) {
    await auditService.logEvent({
      eventType: 'booking.notification.error',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: err && err.message }
    });
  }

  await auditService.logEvent({
    eventType: 'booking.update',
    actor: actorCtx,
    target: { type: 'Booking', id: booking._id.toString() },
    outcome: 'success',
    severity: 'info',
    correlationId,
    details: { updatedFields: Object.keys(update) }
  });

  return updated;
}

module.exports = {
  createBookingTransactional,
  cancelBooking,
  updateBooking
};
