/**
 * src/repositories/calendar.repo.js
 *
 * Polished repository layer for Calendar operations.
 * - Uses the Calendar mongoose model (src/models/calendar.model.js).
 * - Provides safe helpers for reads, availability checks, and atomic reservation via MongoDB sessions.
 *
 * Notes
 * - All times are epoch ms UTC.
 * - findOrCreateWeeklyCalendar will materialize a week and copy-forward persisted offLimitsSlots when available.
 * - For very high concurrency or very large booking volumes consider moving bookingsSlots to a separate collection.
 */

const mongoose = require('mongoose');
const { Calendar, mondayStartEpoch, sundayEndEpoch } = require('../models/calendar.model');

const DEFAULT_MIN_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

const repo = {};

/* -------------------------
 * Read helpers
 * ------------------------- */

repo.getLatestByService = async function (serviceId) {
  if (!serviceId) return null;
  return Calendar.findOne({ serviceId }).sort({ 'datesBracket.startEpoch': -1 }).lean().exec();
};

repo.getLatestByUser = async function (ownerId) {
  if (!ownerId) return null;
  return Calendar.findOne({ ownerId, serviceId: { $in: [null, undefined] } })
    .sort({ 'datesBracket.startEpoch': -1 })
    .lean()
    .exec();
};

/**
 * Materialize or return existing weekly calendar document (full mongoose doc).
 * - Copies forward latest persisted offLimitsSlots for serviceId -> user fallback when creating.
 * - opts: { capacity, timezone }
 */
repo.findOrCreateWeeklyCalendar = async function (ownerId, serviceId = null, dateEpoch = Date.now(), opts = {}) {
  return Calendar.findOrCreateWeeklyCalendar(ownerId, serviceId, dateEpoch, opts);
};

/**
 * Return an in-memory default weekly view (not persisted).
 * Caller should convert local 09:00/17:00 to UTC using timezone when needed.
 */
repo.getDefaultWeeklyView = function ({ ownerId, serviceId = null, dateEpoch = Date.now(), timezone = 'UTC', capacity = 1 }) {
  const monday = mondayStartEpoch(dateEpoch);
  const sunday = sundayEndEpoch(monday);
  return {
    ownerId,
    serviceId,
    timezone,
    capacity,
    datesBracket: { startEpoch: monday, endEpoch: sunday },
    offLimitsSlots: [], // computed by service when needed
    bookingsSlots: [],
    meta: { source: 'default' }
  };
};

/* -------------------------
 * Availability
 * ------------------------- */

repo.isSlotAvailable = async function ({ ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1 }) {
  if (!ownerId || typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    throw new Error('ownerId and fromEpoch/toEpoch required');
  }
  if (fromEpoch >= toEpoch) return { ok: false, code: 'INVALID_RANGE', message: 'from must be < to' };

  const monday = mondayStartEpoch(fromEpoch);
  const query = { ownerId, 'datesBracket.startEpoch': monday };
  if (serviceId) query.serviceId = serviceId;
  else query.serviceId = { $in: [null, undefined] };

  const cal = await Calendar.findOne(query).exec();
  if (!cal) {
    return { ok: false, code: 'NO_CALENDAR', message: 'no materialized calendar for week; treat as default or materialize' };
  }

  return cal.isSlotAvailableLocal(fromEpoch, toEpoch, capacityNeeded);
};

/* -------------------------
 * Atomic reservation
 * ------------------------- */

/**
 * reserveSlotAtomic
 * - Attempts to reserve a slot in the weekly calendar atomically using a MongoDB session.
 * - If the week is not materialized it will create it (findOrCreateWeeklyCalendar) which copies forward offLimitsSlots.
 * - Returns { ok: true, calendar } or { ok: false, code, message }.
 */
repo.reserveSlotAtomic = async function ({
  ownerId,
  serviceId = null,
  bookingId,
  fromEpoch,
  toEpoch,
  capacityUsed = 1,
  session = null,
  tentative = true
}) {
  if (!ownerId || !bookingId || typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    throw new Error('ownerId, bookingId, fromEpoch and toEpoch required');
  }
  if (fromEpoch >= toEpoch) return { ok: false, code: 'INVALID_RANGE', message: 'from must be < to' };

  let ownSession = false;
  if (!session) {
    session = await mongoose.startSession();
    ownSession = true;
  }

  try {
    session.startTransaction();

    const monday = mondayStartEpoch(fromEpoch);
    const query = { ownerId, 'datesBracket.startEpoch': monday };
    if (serviceId) query.serviceId = serviceId;
    else query.serviceId = { $in: [null, undefined] };

    // load calendar in session
    let cal = await Calendar.findOne(query).session(session).exec();

    if (!cal) {
      // materialize week (this will copy-forward offLimits if available)
      const created = await Calendar.findOrCreateWeeklyCalendar(ownerId, serviceId, fromEpoch, {}).then(doc => Calendar.findById(doc._id).session(session));
      if (!created) {
        await session.abortTransaction();
        return { ok: false, code: 'CREATE_FAILED', message: 'failed to create weekly calendar' };
      }
      cal = await Calendar.findById(created._id).session(session).exec();
      if (!cal) {
        await session.abortTransaction();
        return { ok: false, code: 'CREATE_FAILED', message: 'failed to load created calendar' };
      }
    }

    // validate range within week
    if (fromEpoch < cal.datesBracket.startEpoch || toEpoch > cal.datesBracket.endEpoch) {
      await session.abortTransaction();
      return { ok: false, code: 'OUT_OF_RANGE', message: 'slot outside calendar week' };
    }

    // check persisted off-limits
    for (const o of cal.offLimitsSlots || []) {
      if (o.fromEpoch < toEpoch && o.toEpoch > fromEpoch) {
        await session.abortTransaction();
        return { ok: false, code: 'OUT_OF_BUSINESS_HOURS', message: 'CANNOT book out of business hours' };
      }
    }

    // compute used capacity for overlapping slots
    let used = 0;
    for (const s of cal.bookingsSlots || []) {
      if (s.status === 'cancelled') continue;
      if (s.fromEpoch < toEpoch && s.toEpoch > fromEpoch) {
        used += (s.capacityUsed || 1);
        if (used >= cal.capacity) break;
      }
    }

    if (used + capacityUsed > cal.capacity) {
      await session.abortTransaction();
      return { ok: false, code: 'CAPACITY_EXCEEDED', message: 'capacity exceeded for requested slot' };
    }

    // push the tentative/confirmed slot
    cal.bookingsSlots.push({
      bookingId,
      fromEpoch,
      toEpoch,
      status: tentative ? 'tentative' : 'confirmed',
      capacityUsed
    });

    cal.updatedAtEpoch = Date.now();
    await cal.save({ session });

    await session.commitTransaction();
    if (ownSession) session.endSession();

    return { ok: true, calendar: cal.toObject() };
  } catch (err) {
    try { await session.abortTransaction(); } catch (e) { /* ignore */ }
    if (ownSession) session.endSession();
    return { ok: false, code: 'ERROR', message: err.message || String(err) };
  }
};

/* -------------------------
 * Tentative release & locks
 * ------------------------- */

repo.releaseTentativeSlot = async function (ownerId, bookingId) {
  const res = await Calendar.updateMany(
    { ownerId, 'bookingsSlots.bookingId': bookingId },
    { $set: { 'bookingsSlots.$[s].status': 'cancelled', updatedAtEpoch: Date.now() } },
    { arrayFilters: [{ 's.bookingId': bookingId, 's.status': { $ne: 'cancelled' } }], multi: true }
  ).exec();

  return { ok: true, result: res };
};

repo.acquireCalendarLock = async function (ownerId, weekStartEpoch, lockTimeoutMs = 30 * 1000) {
  return Calendar.acquireCalendarLock(ownerId, weekStartEpoch, Date.now(), lockTimeoutMs);
};

repo.releaseCalendarLock = async function (ownerId, weekStartEpoch, lockEpoch) {
  return Calendar.releaseCalendarLock(ownerId, weekStartEpoch, lockEpoch);
};

/* -------------------------
 * Cleanup wrapper
 * ------------------------- */

repo.cleanupBlankCalendars = async function (cutoffWeekStartEpoch) {
  return Calendar.cleanupBlankCalendars(cutoffWeekStartEpoch);
};

/* -------------------------
 * Validators
 * ------------------------- */

repo.validateSlotDto = function (fromEpoch, toEpoch, opts = {}) {
  const minMs = opts.minMs || DEFAULT_MIN_DURATION_MS;
  const maxMs = opts.maxMs || DEFAULT_MAX_DURATION_MS;
  if (typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    return { ok: false, code: 'INVALID_INPUT', message: 'fromEpoch and toEpoch must be numbers' };
  }
  if (fromEpoch >= toEpoch) return { ok: false, code: 'INVALID_RANGE', message: 'from must be < to' };
  const dur = toEpoch - fromEpoch;
  if (dur < minMs) return { ok: false, code: 'DURATION_TOO_SHORT', message: `minimum duration is ${minMs}ms` };
  if (dur > maxMs) return { ok: false, code: 'DURATION_TOO_LONG', message: `maximum duration is ${maxMs}ms` };
  return { ok: true, durationMs: dur };
};

module.exports = repo;
