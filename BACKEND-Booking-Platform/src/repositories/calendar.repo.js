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
const BSON = require('bson');
const { Calendar, mondayStartEpoch, sundayEndEpoch } = require('../models/calendar.model');

const DEFAULT_MIN_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

// BSON sizing guard
const MONGO_MAX_BSON_BYTES = 16 * 1024 * 1024; // 16,777,216
const SAFE_MARGIN_BYTES = 100 * 1024; // 100 KB
const SAFE_BYTES = MONGO_MAX_BSON_BYTES - SAFE_MARGIN_BYTES;

const repo = {};

/* -------------------------
 * Read helpers (merged logical calendar)
 * ------------------------- */

async function loadMergedCalendar(headId) {
  if (!headId) return null;
  const docs = [];
  let cur = await Calendar.findById(headId).lean().exec();
  if (!cur) return null;
  docs.push(cur);

  while (cur && cur.overflowCalendar) {
    try {
      cur = await Calendar.findById(cur.overflowCalendar).lean().exec();
      if (!cur) break;
      docs.push(cur);
    } catch (e) {
      break;
    }
  }

  const head = docs[0];
  const merged = {
    _id: head._id,
    ownerId: head.ownerId,
    serviceId: head.serviceId,
    timezone: head.timezone,
    capacity: head.capacity,
    datesBracket: head.datesBracket,
    offLimitsSlots: head.offLimitsSlots || [],
    bookingsSlots: [],
    overflowChain: docs.slice(1).map(d => ({ id: d._id, docSizeBytes: d.docSizeBytes || 0 })),
    docSizeBytes: head.docSizeBytes || 0,
    metadata: head.metadata || {},
    createdAtEpoch: head.createdAtEpoch,
    updatedAtEpoch: head.updatedAtEpoch
  };

  for (const d of docs) {
    if (Array.isArray(d.bookingsSlots) && d.bookingsSlots.length > 0) {
      merged.bookingsSlots.push(...d.bookingsSlots);
    }
  }

  return merged;
}

/**
 * getLatestByService(serviceId, weekStartEpoch = null)
 * - If weekStartEpoch provided, returns the merged calendar for that specific week (head + overflow).
 * - If omitted, returns the latest head calendar for the service (merged).
 * - Returns null when not found.
 */
repo.getLatestByService = async function (serviceId, weekStartEpoch = null) {
  if (!serviceId) return null;

  const query = { serviceId, isOverflow: false };
  if (typeof weekStartEpoch === 'number') query['datesBracket.startEpoch'] = weekStartEpoch;

  const head = await Calendar.findOne(query).sort({ 'datesBracket.startEpoch': -1 }).exec();
  if (!head) return null;
  return loadMergedCalendar(head._id);
};

/**
 * getLatestByUser(ownerId, weekStartEpoch = null)
 * - If weekStartEpoch provided, returns the merged calendar for that specific week (head + overflow).
 * - If omitted, returns the latest head user-level calendar (merged).
 * - Returns null when not found.
 */
repo.getLatestByUser = async function (ownerId, weekStartEpoch = null) {
  if (!ownerId) return null;

  const query = { ownerId, serviceId: { $in: [null, undefined] }, isOverflow: false };
  if (typeof weekStartEpoch === 'number') query['datesBracket.startEpoch'] = weekStartEpoch;

  const head = await Calendar.findOne(query).sort({ 'datesBracket.startEpoch': -1 }).exec();
  if (!head) return null;
  return loadMergedCalendar(head._id);
};

/* -------------------------
 * Materialize / default view
 * ------------------------- */

/**
 * findOrCreateWeeklyCalendar
 * - Acquire calendar lock for the week to queue concurrent materialization requests.
 * - Delegates to model.findOrCreateWeeklyCalendar while holding the lock.
 * - Releases lock before returning.
 */
repo.findOrCreateWeeklyCalendar = async function (ownerId, serviceId = null, dateEpoch = Date.now(), opts = {}) {
  const monday = mondayStartEpoch(dateEpoch);
  const lockEpoch = Date.now();
  const got = await Calendar.acquireCalendarLock(ownerId, monday, lockEpoch);
  if (!got) {
    // simple retry: wait briefly and try to read existing calendar (non-blocking)
    await new Promise(r => setTimeout(r, 50));
    const existing = await Calendar.findOne({ ownerId, 'datesBracket.startEpoch': monday, serviceId: serviceId || { $in: [null, undefined] } }).exec();
    if (existing) return existing;
    // try again to acquire lock
    const got2 = await Calendar.acquireCalendarLock(ownerId, monday, Date.now());
    if (!got2) {
      // fallback: call model without lock (race handled by unique index)
      return Calendar.findOrCreateWeeklyCalendar(ownerId, serviceId, dateEpoch, opts);
    }
  }

  try {
    const doc = await Calendar.findOrCreateWeeklyCalendar(ownerId, serviceId, dateEpoch, opts);
    return doc;
  } finally {
    try { await Calendar.releaseCalendarLock(ownerId, monday, lockEpoch); } catch (e) { /* ignore */ }
  }
};

repo.getDefaultWeeklyView = function ({ ownerId, serviceId = null, dateEpoch = Date.now(), timezone = 'UTC', capacity = 1 }) {
  const monday = mondayStartEpoch(dateEpoch);
  const sunday = sundayEndEpoch(monday);
  return {
    ownerId,
    serviceId,
    timezone,
    capacity,
    datesBracket: { startEpoch: monday, endEpoch: sunday },
    offLimitsSlots: [],
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
  const query = { ownerId, 'datesBracket.startEpoch': monday, isOverflow: false };
  if (serviceId) query.serviceId = serviceId;
  else query.serviceId = { $in: [null, undefined] };

  const head = await Calendar.findOne(query).exec();
  if (!head) {
    return { ok: false, code: 'NO_CALENDAR', message: 'no materialized calendar for week; treat as default or materialize' };
  }

  const merged = await loadMergedCalendar(head._id);
  if (!merged) return { ok: false, code: 'NO_CALENDAR', message: 'no materialized calendar for week' };

  if (fromEpoch < merged.datesBracket.startEpoch || toEpoch > merged.datesBracket.endEpoch) {
    return { ok: false, code: 'OUT_OF_RANGE', message: 'slot outside this calendar week' };
  }

  for (const o of merged.offLimitsSlots || []) {
    if (o.fromEpoch < toEpoch && o.toEpoch > fromEpoch) {
      return { ok: false, code: 'OUT_OF_BUSINESS_HOURS', message: 'CANNOT book out of business hours' };
    }
  }

  let used = 0;
  for (const s of merged.bookingsSlots || []) {
    if (s.status === 'cancelled') continue;
    if (s.fromEpoch < toEpoch && s.toEpoch > fromEpoch) {
      used += (s.capacityUsed || 1);
      if (used >= merged.capacity) break;
    }
  }
  if (used + capacityNeeded > merged.capacity) {
    return { ok: false, code: 'CAPACITY_EXCEEDED', message: 'capacity exceeded for requested slot' };
  }
  return { ok: true };
};

/* -------------------------
 * Overflow helpers
 * ------------------------- */

async function createOverflowCalendarAndInsert(session, headDoc, slotObj) {
  const payload = {
    ownerId: headDoc.ownerId,
    serviceId: headDoc.serviceId || undefined,
    timezone: headDoc.timezone || 'UTC',
    capacity: headDoc.capacity || 1,
    datesBracket: { startEpoch: headDoc.datesBracket.startEpoch, endEpoch: headDoc.datesBracket.endEpoch },
    offLimitsSlots: [],
    bookingsSlots: [slotObj],
    overflowCalendar: null,
    isOverflow: true,
    docSizeBytes: 0,
    metadata: headDoc.metadata || {},
    createdAtEpoch: Date.now(),
    updatedAtEpoch: Date.now()
  };

  const createdArr = await Calendar.create([payload], { session });
  const newCal = createdArr[0];

  await Calendar.updateOne(
    { _id: headDoc._id, overflowCalendar: headDoc.overflowCalendar || null },
    { $set: { overflowCalendar: newCal._id, updatedAtEpoch: Date.now() } },
    { session }
  ).exec();

  try {
    const plainNew = newCal.toObject({ depopulate: true, versionKey: false, transform: false });
    const newSize = BSON.calculateObjectSize(plainNew);
    await Calendar.updateOne({ _id: newCal._id }, { $set: { docSizeBytes: newSize } }, { session }).exec();
  } catch (e) {
    // non-fatal
  }

  return newCal;
}

/* -------------------------
 * Atomic reservation (head + overflow chain) with locking
 * ------------------------- */

repo.reserveSlotAtomic = async function ({
  ownerId,
  serviceId = null,
  bookingId,
  fromEpoch,
  toEpoch,
  capacityUsed = 1,
  session = null,
  tentative = true,
  metadata = {}
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

  // calendar-level lock params
  const monday = mondayStartEpoch(fromEpoch);
  const lockEpoch = Date.now();
  let locked = false;
  let slotLocked = false;

  try {
    // acquire calendar lock (queue materialization/reservations)
    locked = await Calendar.acquireCalendarLock(ownerId, monday, lockEpoch);
    if (!locked) {
      // brief retry
      await new Promise(r => setTimeout(r, 50));
      locked = await Calendar.acquireCalendarLock(ownerId, monday, Date.now());
      if (!locked) {
        return { ok: false, code: 'LOCKED', message: 'calendar busy; try again' };
      }
    }

    session.startTransaction();

    const query = { ownerId, 'datesBracket.startEpoch': monday, isOverflow: false };
    if (serviceId) query.serviceId = serviceId;
    else query.serviceId = { $in: [null, undefined] };

    let head = await Calendar.findOne(query).session(session).exec();

    if (!head) {
      // materialize outside tx then reload inside session to keep tx short
      const created = await Calendar.findOrCreateWeeklyCalendar(ownerId, serviceId, fromEpoch, {});
      head = await Calendar.findById(created._id).session(session).exec();
      if (!head) {
        await session.abortTransaction();
        return { ok: false, code: 'CREATE_FAILED', message: 'failed to create weekly calendar' };
      }
    }

    // slot-level lock: atomically add bookingId to metadata.lockedSlots
    const lockRes = await Calendar.updateOne(
      { _id: head._id, $or: [{ 'metadata.lockedSlots': { $exists: false } }, { 'metadata.lockedSlots': { $nin: [bookingId] } }] },
      { $addToSet: { 'metadata.lockedSlots': bookingId }, $set: { updatedAtEpoch: Date.now() } },
      { session }
    ).exec();

    if (!lockRes || lockRes.nModified === 0) {
      await session.abortTransaction();
      return { ok: false, code: 'SLOT_LOCKED', message: 'slot is currently being processed' };
    }
    slotLocked = true;

    // validate range within week
    if (fromEpoch < head.datesBracket.startEpoch || toEpoch > head.datesBracket.endEpoch) {
      await session.abortTransaction();
      return { ok: false, code: 'OUT_OF_RANGE', message: 'slot outside calendar week' };
    }

    // check IsMultipleBusinessDays metadata on incoming request
    const isMultiBusiness = !!(metadata && metadata.IsMultipleBusinessDays);

    // if spans multiple days and not allowed, check off-limits and reject if conflicts
    const spansMultipleDays = (new Date(fromEpoch).getUTCDate() !== new Date(toEpoch - 1).getUTCDate()) ||
                              (Math.floor((toEpoch - fromEpoch) / (24 * 60 * 60 * 1000)) >= 1);

    if (spansMultipleDays && !isMultiBusiness) {
      // use merged offLimits to decide
      const mergedForCheck = await loadMergedCalendar(head._id);
      for (const o of mergedForCheck.offLimitsSlots || []) {
        if (o.fromEpoch < toEpoch && o.toEpoch > fromEpoch) {
          await session.abortTransaction();
          return { ok: false, code: 'MULTI_DAY_OFF_LIMIT', message: 'slot spans off-limits; set IsMultipleBusinessDays to allow multi-business-day booking' };
        }
      }
    }

    // capacity check across merged chain
    const merged = await loadMergedCalendar(head._id);
    let used = 0;
    for (const s of merged.bookingsSlots || []) {
      if (s.status === 'cancelled') continue;
      if (s.fromEpoch < toEpoch && s.toEpoch > fromEpoch) {
        used += (s.capacityUsed || 1);
        if (used >= merged.capacity) break;
      }
    }
    if (used + capacityUsed > merged.capacity) {
      await session.abortTransaction();
      return { ok: false, code: 'CAPACITY_EXCEEDED', message: 'capacity exceeded for requested slot' };
    }

    const slotObj = {
      bookingId,
      fromEpoch,
      toEpoch,
      status: tentative ? 'tentative' : 'confirmed',
      capacityUsed
    };

    // routing by docSizeBytes / SAFE_BYTES (head -> overflow chain)
    if (typeof head.docSizeBytes === 'number' && head.docSizeBytes >= SAFE_BYTES) {
      // find tail
      let tail = null;
      if (head.overflowCalendar) {
        tail = await Calendar.findById(head.overflowCalendar).session(session).exec();
        while (tail && tail.overflowCalendar) {
          tail = await Calendar.findById(tail.overflowCalendar).session(session).exec();
        }
      }

      if (!tail) {
        const newCal = await createOverflowCalendarAndInsert(session, head, slotObj);
        await session.commitTransaction();
        return { ok: true, calendar: await loadMergedCalendar(head._id) };
      } else {
        try {
          const slotBytes = BSON.calculateObjectSize(slotObj);
          const tailSize = typeof tail.docSizeBytes === 'number' && tail.docSizeBytes > 0
            ? tail.docSizeBytes
            : BSON.calculateObjectSize(tail.toObject({ depopulate: true, versionKey: false }));

          if (tailSize + slotBytes > SAFE_BYTES) {
            const newCal = await createOverflowCalendarAndInsert(session, head, slotObj);
            await session.commitTransaction();
            return { ok: true, calendar: await loadMergedCalendar(head._id) };
          } else {
            const now = Date.now();
            const newTailSize = tailSize + slotBytes;
            await Calendar.updateOne(
              { _id: tail._id },
              { $push: { bookingsSlots: slotObj }, $set: { updatedAtEpoch: now, docSizeBytes: newTailSize } },
              { session }
            ).exec();
            await session.commitTransaction();
            return { ok: true, calendar: await loadMergedCalendar(head._id) };
          }
        } catch (e) {
          const newCal = await createOverflowCalendarAndInsert(session, head, slotObj);
          await session.commitTransaction();
          return { ok: true, calendar: await loadMergedCalendar(head._id) };
        }
      }
    }

    // head not marked full — compute sizes
    let slotBytes = null;
    try { slotBytes = BSON.calculateObjectSize(slotObj); } catch (e) { /* leave null */ }

    let currentDocBytes = (typeof head.docSizeBytes === 'number' && head.docSizeBytes > 0) ? head.docSizeBytes : null;
    if (currentDocBytes === null) {
      try {
        const plain = head.toObject ? head.toObject({ depopulate: true, versionKey: false, transform: false }) : head;
        currentDocBytes = BSON.calculateObjectSize(plain);
      } catch (e) {
        currentDocBytes = 0;
      }
    }

    if (slotBytes !== null && currentDocBytes + slotBytes > SAFE_BYTES) {
      const newCal = await createOverflowCalendarAndInsert(session, head, slotObj);
      await session.commitTransaction();
      return { ok: true, calendar: await loadMergedCalendar(head._id) };
    }

    // append to head and update docSizeBytes
    const now = Date.now();
    const newHeadSize = (currentDocBytes || 0) + (slotBytes || 0);
    await Calendar.updateOne(
      { _id: head._id },
      { $push: { bookingsSlots: slotObj }, $set: { updatedAtEpoch: now, docSizeBytes: newHeadSize } },
      { session }
    ).exec();

    await session.commitTransaction();
    return { ok: true, calendar: await loadMergedCalendar(head._id) };
  } catch (err) {
    try { await session.abortTransaction(); } catch (e) { /* ignore */ }
    return { ok: false, code: 'ERROR', message: err.message || String(err) };
  } finally {
    // always remove slot lock and release calendar lock
    try {
      if (slotLocked) {
        await Calendar.updateOne({ ownerId, 'datesBracket.startEpoch': monday }, { $pull: { 'metadata.lockedSlots': bookingId }, $set: { updatedAtEpoch: Date.now() } }).exec();
      }
    } catch (e) { /* ignore */ }

    try {
      if (locked) await Calendar.releaseCalendarLock(ownerId, monday, lockEpoch);
    } catch (e) { /* ignore */ }

    if (ownSession) session.endSession();
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

  // also ensure any lingering slot locks are removed
  await Calendar.updateMany({ ownerId }, { $pull: { 'metadata.lockedSlots': bookingId }, $set: { updatedAtEpoch: Date.now() } }).exec();

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
