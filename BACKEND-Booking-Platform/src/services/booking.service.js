/**
 * src/services/booking.service.js
 *
 * Booking service - production-ready implementation
 *
 * Responsibilities:
 * - createBookingTransactional: atomic booking creation using MongoDB session
 *   (booking record, request status update, bid transitions, calendar confirmation).
 * - updateBooking: controlled updates with RBAC for status transitions and slot changes.
 * - cancelBooking: cancel booking with proper status and calendar release.
 * - Integrates with a persistent scheduler to mark bookings honored after the booking window.
 *
 * Notes / TODOs:
 * - calendarService is referenced but not implemented here. Replace TODOs with real calendarService
 *   methods that support session-aware operations or implement an outbox/reconciliation pattern.
 * - requestRepo and bidRepo must expose session-aware update methods for full transactional safety.
 * - bookingScheduler (Agenda wrapper) must be initialized at app startup and exposes scheduleHonorJob/cancelHonorJob.
 */

const mongoose = require('mongoose');
const bookingRepo = require('../repositories/booking.repo');
const requestRepo = require('../repositories/request.repo');
const bidRepo = require('../repositories/bid.repo');
const auditService = require('./audit.service');

// Scheduler utilities (Agenda wrapper). Ensure init() is called at app startup.
const { scheduleHonorJob, cancelHonorJob } = require('../jobs/bookingScheduler');

// TODO: Implement calendarService with session-aware methods:
// - checkAvailability({ type, id, slots }, { session }) => { available: true/false, conflicts: [...] }
// - reserveTentativeSlots({ type, id, slots, metadata }, { session }) => { reservationToken }
// - confirmSlots({ reservationToken, bookingId }, { session })
// - releaseTentativeSlots({ reservationToken })
let calendarService;
try {
  // attempt to require; if not present, leave undefined and use TODO flow
  calendarService = require('./calendar.service');
} catch (e) {
  calendarService = null;
}

/**
 * Helper: normalize payload slots to array of {from:Number,to:Number}
 */
function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.map(s => ({ from: Number(s.from), to: Number(s.to) }));
}

/**
 * createBookingTransactional
 * - Validates payload
 * - Checks request status
 * - Checks calendar availability (service calendars first, then provider)
 * - Creates booking record inside a transaction
 * - Updates request.status to 'booked' inside the same transaction
 * - Updates bid statuses (accepted/rejected) inside the same transaction
 * - Confirms calendar slots (transactional if calendarService supports session)
 * - Commits transaction, schedules honor job post-commit, sends notifications (best-effort)
 *
 * @param {Object} actor - { userId, role }
 * @param {Object} payload - { requestId, bidId, seekerId, providerId, quoteAmount, currency, services, slots, notes, metadata }
 * @param {String|null} correlationId
 * @returns {Promise<Object>} booking document
 */
async function createBookingTransactional(actor, payload, correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };

  // Basic validation
  if (!payload || !payload.requestId || !payload.providerId || !payload.seekerId || !Array.isArray(payload.slots) || payload.slots.length === 0) {
    const err = new Error('Missing booking payload fields or slots');
    err.status = 400;
    throw err;
  }

  // Normalize slots
  payload.slots = normalizeSlots(payload.slots);

  // Load request and ensure it's active
  const request = await requestRepo.findById(payload.requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  if (request.status !== 'active') {
    const err = new Error('Request not open for booking');
    err.status = 409;
    throw err;
  }

  // Determine calendar targets: prefer service calendars if services provided, otherwise provider calendar
  const serviceIds = Array.isArray(payload.services) ? payload.services.filter(Boolean) : [];
  const calendarTargets = serviceIds.length > 0
    ? serviceIds.map(sid => ({ type: 'service', id: sid }))
    : [{ type: 'provider', id: payload.providerId }];

  // Pre-check calendar availability (best-effort) if calendarService exists and does not require session
  if (calendarService && typeof calendarService.checkAvailability === 'function' && !calendarService.requiresSession) {
    for (const target of calendarTargets) {
      const avail = await calendarService.checkAvailability({ type: target.type, id: target.id, slots: payload.slots });
      if (!avail || !avail.available) {
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

  const session = await mongoose.startSession();
  let booking;
  let reservations = [];
  try {
    session.startTransaction();

    // If calendarService supports session-aware tentative reservations, reserve them now
    if (calendarService && typeof calendarService.reserveTentativeSlots === 'function' && calendarService.requiresSession) {
      for (const target of calendarTargets) {
        const reservation = await calendarService.reserveTentativeSlots({
          type: target.type,
          id: target.id,
          slots: payload.slots,
          metadata: { requestId: payload.requestId, bidId: payload.bidId || null }
        }, { session });
        reservations.push(reservation);
      }
    }

    // Create booking record inside transaction
    const bookingObj = {
      request_id: payload.requestId,
      seeker_id: payload.seekerId,
      provider_id: payload.providerId,
      bid_id: payload.bidId || null,
      quote_amount: payload.quoteAmount,
      currency: payload.currency || 'USD',
      services: payload.services || [],
      slots: payload.slots || [],
      description: payload.notes || payload.description || '',
      status: 'active',
      metadata: payload.metadata || {}
    };

    booking = await bookingRepo.createWithSession(bookingObj, session);

    // Update request status to 'booked' inside transaction (session-aware if available)
    if (typeof requestRepo.updateByIdWithSession === 'function') {
      await requestRepo.updateByIdWithSession(request._id, { status: 'booked' }, session);
    } else {
      // fallback: non-session update (less safe for races)
      await requestRepo.updateById(request._id, { status: 'booked', updatedAt: Date.now() });
    }

    // Update accepted bid and other bids
    if (payload.bidId) {
      if (typeof bidRepo.updateByIdWithSession === 'function') {
        await bidRepo.updateByIdWithSession(payload.bidId, { status: 'accepted' }, session);
      } else {
        await bidRepo.updateById(payload.bidId, { status: 'accepted' });
      }

      // Reject other submitted bids for the same request (session-aware if repo supports it)
      if (typeof bidRepo.updateManyWithSession === 'function') {
        await bidRepo.updateManyWithSession({ request_id: payload.requestId, status: 'submitted', archived: false, _id: { $ne: payload.bidId } }, { status: 'rejected' }, session);
      } else {
        await bidRepo.updateMany({ request_id: payload.requestId, status: 'submitted', archived: false, _id: { $ne: payload.bidId } }, { status: 'rejected' }, session);
      }

      // Hard-delete draft bids for the request (session-aware)
      await mongoose.model('Bid').deleteMany({ request_id: payload.requestId, status: 'draft' }).session(session).exec();
    } else {
      // No bid provided: still reject submitted bids and remove drafts
      if (typeof bidRepo.updateManyWithSession === 'function') {
        await bidRepo.updateManyWithSession({ request_id: payload.requestId, status: 'submitted', archived: false }, { status: 'rejected' }, session);
      } else {
        await bidRepo.updateMany({ request_id: payload.requestId, status: 'submitted', archived: false }, { status: 'rejected' }, session);
      }
      await mongoose.model('Bid').deleteMany({ request_id: payload.requestId, status: 'draft' }).session(session).exec();
    }

    // Confirm calendar slots inside transaction if calendarService supports it
    if (calendarService && typeof calendarService.confirmSlots === 'function' && calendarService.requiresSession) {
      for (const reservation of reservations) {
        await calendarService.confirmSlots({ reservationToken: reservation.token, bookingId: booking._id.toString() }, { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Post-commit: if calendarService did not participate in transaction, confirm or reconcile now
    if (calendarService && typeof calendarService.confirmSlots === 'function' && !calendarService.requiresSession) {
      // Best-effort confirmation; if it fails, schedule reconciliation/outbox
      try {
        for (const target of calendarTargets) {
          await calendarService.confirmSlots({ type: target.type, id: target.id, bookingId: booking._id.toString(), slots: booking.slots });
        }
      } catch (confirmErr) {
        // Log and continue; reconciliation job should handle eventual consistency
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

    // Schedule honor job (post-commit)
    try {
      const endEpoch = (booking.slots && booking.slots.length) ? Math.max(...booking.slots.map(s => s.to)) : Date.now();
      const BUFFER_MS = 60 * 1000; // 1 minute buffer
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

    // Post-commit: audit and notifications (best-effort)
    await auditService.logEvent({
      eventType: 'booking.create',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { requestId: payload.requestId, providerId: payload.providerId, calendarTargets }
    });

    // TODO: notificationService.notifyUser for provider and seeker

    return booking;
  } catch (e) {
    try { await session.abortTransaction(); } catch (er) { /* ignore */ }
    session.endSession();

    // Release tentative reservations if any were created outside transaction or not confirmed
    if (calendarService && typeof calendarService.releaseTentativeSlots === 'function' && reservations && reservations.length) {
      try {
        for (const r of reservations) {
          await calendarService.releaseTentativeSlots({ reservationToken: r.token });
        }
      } catch (releaseErr) {
        // log and continue
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
      details: { error: e && e.message, calendarTargets }
    });

    throw e;
  }
}

/**
 * cancelBooking
 * - Permission: seeker, provider, or admin
 * - Updates booking status to seeker_cancelled or provider_cancelled (or suspended for admin)
 * - Cancels scheduled honor job
 * - Releases calendar slots (best-effort)
 *
 * @param {Object} actor
 * @param {String} bookingId
 * @param {String} reason
 * @param {String|null} correlationId
 */
async function cancelBooking(actor, bookingId, reason = '', correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };
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

  if (['seeker_cancelled', 'provider_cancelled', 'suspended'].includes(booking.status)) {
    return booking;
  }

  const newStatus = isSeeker ? 'seeker_cancelled' : (isProvider ? 'provider_cancelled' : 'suspended');
  const updated = await bookingRepo.updateById(booking._id || bookingId, { status: newStatus, metadata: Object.assign({}, booking.metadata || {}, { cancelledBy: actor.userId, reason }) });

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

  // Release calendar slots (best-effort)
  try {
    if (calendarService && typeof calendarService.releaseSlots === 'function') {
      await calendarService.releaseSlots({ providerId: booking.provider_id, bookingId: booking._id.toString(), slots: booking.slots });
    }
  } catch (releaseErr) {
    await auditService.logEvent({
      eventType: 'booking.calendar.release_failed',
      actor: actorCtx,
      target: { type: 'Booking', id: booking._id.toString() },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { error: releaseErr && releaseErr.message }
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

/**
 * updateBooking
 * - Controlled updates with RBAC for status transitions and slot changes.
 * - Admin may update arbitrary fields including suspend.
 * - Provider may mark honored (but honored is automated; provider can request manual override if business allows).
 * - If slots change, calendar availability must be checked (TODO).
 *
 * @param {Object} actor
 * @param {String} bookingId
 * @param {Object} patch
 * @param {String|null} correlationId
 */
async function updateBooking(actor, bookingId, patch = {}, correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };
  const booking = await bookingRepo.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  // Allowed fields to update
  const allowedFields = ['what', 'where', 'slots', 'services', 'quote_amount', 'currency', 'description', 'status', 'metadata'];
  const update = {};
  allowedFields.forEach(k => {
    if (k in patch) update[k] = patch[k];
  });

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
      // honored is automated; only admin may force it manually
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

  // If slots are being changed, check calendar availability (TODO)
  if ('slots' in update) {
    update.slots = normalizeSlots(update.slots);
    // TODO: call calendarService.checkAvailability/reserveTentativeSlots and handle session if needed.
    // If calendarService is not transactional, consider scheduling reconciliation and notifying stakeholders.
  }

  const updated = await bookingRepo.updateById(booking._id || bookingId, update);

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
