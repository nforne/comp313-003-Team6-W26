/**
 * src/services/calendar.service.js
 *
 * Service layer for calendar operations, booking-slot orchestration, and weekly cleanup scheduling.
 * - Uses epoch ms everywhere.
 * - Converts local input <-> UTC using Luxon and calendar.timezone.
 * - Splits multi-day/week slots into week-aligned segments and supports two-phase check+reserve.
 * - Schedules a single repeating weekly cleanup using setInterval (one scheduler per process).
 *
 * Non-disruptive: public function signatures preserved; added a small set of
 * transactional helpers used by booking flows:
 *  - checkRangeAvailability
 *  - reserveTentativeSlots / confirmSlots / releaseTentativeSlots
 *  - removeBooking (remove booking entries from calendars)
 *  - requiresSession flag (true when session-aware methods are supported)
 *
 * These additions are defensive and additive; existing callers continue to work.
 */

const { DateTime } = require('luxon');
const repo = require('../repositories/calendar.repo');
const { Calendar, mondayStartEpoch, sundayEndEpoch } = require('../models/calendar.model');

let geoip;
try { geoip = require('geoip-lite'); } catch (e) { geoip = null; }

const DEFAULT_MIN_MS = 5 * 60 * 1000;
const DEFAULT_MAX_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const service = {};

/* -------------------------
 * Expose whether calendar supports session-aware ops
 * - repo.reserveSlotAtomic accepts a session; expose a flag booking flows can check.
 * ------------------------- */
service.requiresSession = true;

/* -------------------------
 * Timezone helpers
 * ------------------------- */

service.convertLocalToUtcEpoch = function (localISO, ianaTz) {
  if (!localISO) throw new Error('localISO required');
  const dt = DateTime.fromISO(localISO, { zone: ianaTz || 'UTC' });
  if (!dt.isValid) throw new Error('invalid local datetime');
  return dt.toUTC().toMillis();
};

service.convertUtcEpochToLocal = function (epochMs, ianaTz) {
  return DateTime.fromMillis(epochMs, { zone: 'utc' }).setZone(ianaTz || 'UTC').toISO();
};

service.detectTimezoneFromIp = function (ip) {
  try {
    if (!ip) return 'UTC';
    if (!geoip) return 'UTC';
    const geo = geoip.lookup(ip);
    if (!geo) return 'UTC';
    if (geo.timezone) return geo.timezone;
    const country = (geo.country || '').toUpperCase();
    const countryTzMap = { CA: 'America/Toronto', US: 'America/New_York', GB: 'Europe/London', AU: 'Australia/Sydney' };
    return countryTzMap[country] || 'UTC';
  } catch (err) {
    return 'UTC';
  }
};

/* -------------------------
 * Default off-limits computation
 * ------------------------- */

service.computeDefaultOffLimitsForWeek = function (weekStartEpoch, ianaTz = 'UTC') {
  const slots = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const localMidnight = DateTime.fromMillis(weekStartEpoch, { zone: 'utc' })
      .setZone(ianaTz)
      .plus({ days: weekday - 1 })
      .startOf('day');

    if (weekday >= 1 && weekday <= 5) {
      const beforeStart = localMidnight.toUTC().toMillis();
      const beforeEnd = localMidnight.set({ hour: 9 }).toUTC().toMillis();
      if (beforeStart < beforeEnd) slots.push({ weekday, fromEpoch: beforeStart, toEpoch: beforeEnd, reason: 'before-business-hours' });

      const afterStart = localMidnight.set({ hour: 17 }).toUTC().toMillis();
      const afterEnd = localMidnight.plus({ days: 1 }).toUTC().toMillis();
      if (afterStart < afterEnd) slots.push({ weekday, fromEpoch: afterStart, toEpoch: afterEnd, reason: 'after-business-hours' });
    } else {
      const dayStart = localMidnight.toUTC().toMillis();
      const dayEnd = localMidnight.plus({ days: 1 }).toUTC().toMillis();
      slots.push({ weekday, fromEpoch: dayStart, toEpoch: dayEnd, reason: 'weekend' });
    }
  }
  return slots;
};

/* -------------------------
 * Simple getters & defaults
 * ------------------------- */

service.getLatestCalendarByService = async function (serviceId) {
  return repo.getLatestByService(serviceId);
};

service.getLatestCalendarByUser = async function (ownerId) {
  return repo.getLatestByUser(ownerId);
};

service.getDefaultCalendarView = function ({ ownerId, serviceId = null, dateEpoch = Date.now(), timezone = 'UTC', capacity = 1 }) {
  const base = repo.getDefaultWeeklyView({ ownerId, serviceId, dateEpoch, timezone, capacity });
  const weekStart = mondayStartEpoch(dateEpoch);
  base.offLimitsSlots = service.computeDefaultOffLimitsForWeek(weekStart, timezone);
  base.meta = base.meta || {};
  base.meta.source = 'default';
  return base;
};

/* -------------------------
 * Validation & splitting
 * ------------------------- */

service.validateSlotDto = function (fromEpoch, toEpoch, opts = {}) {
  if (typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    return { ok: false, code: 'INVALID_INPUT', message: 'fromEpoch and toEpoch must be numbers' };
  }
  if (fromEpoch >= toEpoch) return { ok: false, code: 'INVALID_RANGE', message: 'from must be < to' };
  const minMs = opts.minMs || DEFAULT_MIN_MS;
  const maxMs = opts.maxMs || DEFAULT_MAX_MS;
  const dur = toEpoch - fromEpoch;
  if (dur < minMs) return { ok: false, code: 'DURATION_TOO_SHORT', message: `minimum duration is ${minMs}ms` };
  if (dur > maxMs && !opts.allowLong) return { ok: false, code: 'DURATION_TOO_LONG', message: `maximum duration is ${maxMs}ms` };
  return { ok: true, durationMs: dur };
};

service.splitRangeByWeek = function (fromEpoch, toEpoch) {
  const segments = [];
  let cursor = fromEpoch;
  while (cursor < toEpoch) {
    const weekStart = mondayStartEpoch(cursor);
    const weekEndExclusive = sundayEndEpoch(weekStart) + 1;
    const segEnd = Math.min(weekEndExclusive, toEpoch);
    segments.push({ fromEpoch: cursor, toEpoch: segEnd, weekStartEpoch: weekStart });
    cursor = segEnd;
  }
  return segments;
};

/* -------------------------
 * Availability helpers
 * ------------------------- */

/**
 * checkRangeAvailability
 * - Splits the requested range into week-aligned segments and checks availability for each.
 * - Returns { ok:true } when all segments available, or { ok:false, conflicts: [ { segment, code, message } ] }.
 */
service.checkRangeAvailability = async function ({ ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1 }) {
  const validation = service.validateSlotDto(fromEpoch, toEpoch, { allowLong: true });
  if (!validation.ok) {
    return { ok: false, conflicts: [{ segment: { fromEpoch, toEpoch }, code: validation.code, message: validation.message }] };
  }

  const segments = service.splitRangeByWeek(fromEpoch, toEpoch);
  const conflicts = [];

  for (const seg of segments) {
    const res = await service.isSlotAvailable({ ownerId, serviceId, fromEpoch: seg.fromEpoch, toEpoch: seg.toEpoch, capacityNeeded });
    if (!res || !res.ok) {
      conflicts.push({ segment: seg, code: res && res.code ? res.code : 'UNAVAILABLE', message: res && res.message ? res.message : 'not available' });
    }
  }

  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true };
};

service.isSlotAvailable = async function ({ ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1 }) {
  return repo.isSlotAvailable({ ownerId, serviceId, fromEpoch, toEpoch, capacityNeeded });
};

/* -------------------------
 * Weeks calendar builder
 * ------------------------- */

service.getWeeksCalendar = async function ({ entity, startOfWeekEpoch, endOfWeekEpoch = null, timezone = 'UTC', requesterIsAdmin = false, requesterId = null }) {
  if (!entity || typeof entity !== 'string') return { ok: false, code: 'INVALID_INPUT', message: 'entity required' };

  const parts = entity.split(':');
  if (parts.length !== 2) return { ok: false, code: 'INVALID_ENTITY', message: 'entity must be user:<id> or service:<id>' };
  const [etype, eid] = parts;
  if (etype !== 'user' && etype !== 'service') return { ok: false, code: 'INVALID_ENTITY', message: 'entity type must be user or service' };
  if (etype === 'service' && !String(eid).startsWith('svc_')) return { ok: false, code: 'INVALID_SERVICE_ID', message: 'serviceId must start with svc_' };

  const weekStart = mondayStartEpoch(startOfWeekEpoch);
  let weekEnd = endOfWeekEpoch ? mondayStartEpoch(endOfWeekEpoch) : weekStart;
  if (weekEnd < weekStart) return { ok: false, code: 'INVALID_RANGE', message: 'endOfWeekEpoch must be >= startOfWeekEpoch' };

  const weeks = [];
  const now = Date.now();
  const currentWeekStart = mondayStartEpoch(now);

  for (let cursor = weekStart; cursor <= weekEnd; cursor += WEEK_MS) {
    const isPastWeek = cursor < currentWeekStart;
    let ownerId = null;
    let serviceId = null;
    if (etype === 'user') ownerId = eid;
    else serviceId = eid;

    // Access rule: past weeks (history) require owner (for user entity) or administrator.
    // Present and future weeks are allowed for any requester (subject to other app-level checks).
    const isRequesterOwner = requesterId && etype === 'user' && requesterId === ownerId;
    if (isPastWeek && !requesterIsAdmin && !isRequesterOwner) {
      return { ok: false, code: 'FORBIDDEN', message: 'past weeks require owner or administrator access' };
    }

    // try persisted head for this week (repo supports weekStartEpoch)
    let persisted = null;
    if (etype === 'service') persisted = await repo.getLatestByService(serviceId, cursor);
    else persisted = await repo.getLatestByUser(ownerId, cursor);

    if (persisted) {
      persisted.metadata = persisted.metadata || {};
      persisted.metadata.source = 'persisted';
      weeks.push(persisted);
      continue;
    }

    // construct non-persisted week view (copy-forward offLimits or default)
    let offLimits = [];
    try { offLimits = await Calendar.copyForwardOffLimits(ownerId, serviceId); } catch (e) { offLimits = []; }
    if (!offLimits || offLimits.length === 0) offLimits = service.computeDefaultOffLimitsForWeek(cursor, timezone);

    const constructed = {
      _id: null,
      ownerId,
      serviceId,
      timezone,
      capacity: 1,
      datesBracket: { startEpoch: cursor, endEpoch: sundayEndEpoch(cursor) },
      offLimitsSlots: offLimits,
      bookingsSlots: [],
      metadata: { source: 'constructed' }
    };

    weeks.push(constructed);
  }

  return { ok: true, weeks };
};

/* -------------------------
 * Reservation (two-phase: check then reserve)
 *
 * The booking flows require a lightweight tentative reservation mechanism:
 * - reserveTentativeSlots: create tentative slots using a generated reservation token
 *   (the token is used as the temporary bookingId in calendar entries).
 * - confirmSlots: replace reservation token with real bookingId and mark confirmed.
 * - releaseTentativeSlots: cancel tentative slots by reservation token.
 *
 * These operations are best-effort and support session when provided.
 * ------------------------- */

/**
 * Helper: generate a short reservation token
 */
function generateReservationToken() {
  return `res_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * reserveTentativeSlots
 * - params: { type: 'service'|'provider', id, slots: [{from,to}], metadata }
 * - opts: { session } optional session to participate in transaction
 * - Returns { token } on success or throws on error.
 *
 * Implementation:
 * - Uses repo.reserveSlotAtomic with bookingId set to reservation token.
 * - If multiple segments, reserves each segment; on any failure rolls back tentative reservations.
 */
service.reserveTentativeSlots = async function ({ type, id, slots = [], metadata = {} } = {}, { session = null } = {}) {
  if (!type || !id || !Array.isArray(slots) || slots.length === 0) {
    const err = new Error('type, id and slots required');
    err.status = 400;
    throw err;
  }

  // map type -> ownerId/serviceId
  const ownerId = (type === 'provider') ? id : null;
  const serviceId = (type === 'service') ? id : null;

  const token = generateReservationToken();
  const results = [];

  // Reserve each slot segment (segments expected to be simple non-week-split ranges)
  try {
    for (const s of slots) {
      const fromEpoch = Number(s.from);
      const toEpoch = Number(s.to);
      const attempt = await repo.reserveSlotAtomic({
        ownerId,
        serviceId,
        bookingId: token,
        fromEpoch,
        toEpoch,
        capacityUsed: s.capacityUsed || 1,
        session,
        tentative: true,
        metadata
      });

      if (!attempt || !attempt.ok) {
        // rollback any tentative reservations created for this token
        try { await repo.releaseTentativeSlotAcrossOwners(token); } catch (_) { /* ignore */ }
        const err = new Error(attempt && attempt.message ? attempt.message : 'reservation_failed');
        err.status = 409;
        throw err;
      }
      results.push(attempt);
    }

    return { token, results };
  } catch (err) {
    // ensure cleanup on error
    try { await repo.releaseTentativeSlotAcrossOwners(token); } catch (_) { /* ignore */ }
    throw err;
  }
};

/**
 * confirmSlots
 * - params: { reservationToken, bookingId }
 * - opts: { session } optional
 * - Replaces reservationToken used as temporary bookingId with the real bookingId and marks slots confirmed.
 */
service.confirmSlots = async function ({ reservationToken, bookingId } = {}, { session = null } = {}) {
  if (!reservationToken || !bookingId) {
    const err = new Error('reservationToken and bookingId required');
    err.status = 400;
    throw err;
  }

  // 1) Mark matching slots as confirmed and remove locks (fast path)
  await repo.confirmBookingSlots(null, null, reservationToken);

  // 2) Replace bookingId token with real bookingId across calendars
  // Use Calendar.updateMany with arrayFilters to update matching slot elements
  try {
    const now = Date.now();
    await Calendar.updateMany(
      { 'bookingsSlots.bookingId': reservationToken },
      {
        $set: { 'bookingsSlots.$[s].bookingId': bookingId, 'bookingsSlots.$[s].status': 'confirmed', updatedAtEpoch: now },
        $pull: { 'metadata.lockedSlots': reservationToken }
      },
      { arrayFilters: [{ 's.bookingId': reservationToken }], multi: true }
    ).exec();
    return { ok: true };
  } catch (err) {
    // If replacement fails, leave slots in confirmed state with reservationToken; caller can reconcile.
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
};

/**
 * releaseTentativeSlots
 * - params: { reservationToken }
 * - Marks any calendar slots with bookingId == reservationToken as cancelled.
 */
service.releaseTentativeSlots = async function ({ reservationToken } = {}) {
  if (!reservationToken) {
    const err = new Error('reservationToken required');
    err.status = 400;
    throw err;
  }
  return repo.releaseTentativeSlotAcrossOwners(reservationToken);
};

/* -------------------------
 * Calendar removal helpers used by booking cancel flows
 * ------------------------- */

/**
 * removeBooking
 * - params: { type: 'service'|'provider', id, bookingId, slots? }
 * - Attempts to remove/cancel booking entries from the calendar(s).
 * - If slots provided, attempts targeted removal; otherwise marks any entries with bookingId as cancelled.
 */
service.removeBooking = async function ({ type, id, bookingId, slots = null } = {}) {
  if (!type || !id || !bookingId) {
    const err = new Error('type, id and bookingId required');
    err.status = 400;
    throw err;
  }

  const ownerId = (type === 'provider') ? id : null;
  const serviceId = (type === 'service') ? id : null;

  // If slots provided, attempt targeted cancellation per owner/service/week
  if (Array.isArray(slots) && slots.length > 0) {
    // For each slot, compute week and call repo.removeBookingEntries for that owner/service
    const ops = [];
    for (const s of slots) {
      const weekStart = mondayStartEpoch(s.from);
      // repo.removeBookingEntries is not week-scoped; it will mark any matching bookingId entries
      ops.push(repo.removeBookingEntries(ownerId, serviceId, bookingId));
    }
    const results = await Promise.allSettled(ops);
    return { ok: true, results };
  }

  // Otherwise, remove across the specified owner/service
  return repo.removeBookingEntries(ownerId, serviceId, bookingId);
};

/* -------------------------
 * Weekly cleanup scheduler
 * ------------------------- */

let _cleanupTimer = null;
let _cleanupIntervalMs = WEEK_MS;
let _logger = console;

service.startWeeklyCleanupScheduler = function (opts = {}) {
  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0 ? opts.intervalMs : WEEK_MS;
  const initialDelayMs = typeof opts.initialDelayMs === 'number' && opts.initialDelayMs >= 0 ? opts.initialDelayMs : 0;
  const cutoffWeekStartEpoch = typeof opts.cutoffWeekStartEpoch === 'number' ? opts.cutoffWeekStartEpoch : mondayStartEpoch(Date.now());
  _logger = opts.logger || console;

  if (_cleanupTimer) {
    _logger.info && _logger.info('cleanup scheduler already running');
    return { running: true, intervalMs: _cleanupIntervalMs };
  }

  _cleanupIntervalMs = intervalMs;

  const runCleanup = async () => {
    const startedAt = Date.now();
    _logger.info && _logger.info({ event: 'cleanup.start', startedAt, cutoffWeekStartEpoch });
    try {
      const res = await repo.cleanupBlankCalendars(cutoffWeekStartEpoch);
      _logger.info && _logger.info({ event: 'cleanup.success', startedAt, finishedAt: Date.now(), result: res });
    } catch (err) {
      _logger.error && _logger.error({ event: 'cleanup.error', startedAt, error: err && err.message ? err.message : String(err) });
    }
  };

  _cleanupTimer = setTimeout(() => {
    runCleanup().catch(() => {});
    _cleanupTimer = setInterval(() => {
      runCleanup().catch(() => {});
    }, _cleanupIntervalMs);
  }, initialDelayMs);

  _logger.info && _logger.info({ event: 'cleanup.scheduler.started', initialDelayMs, intervalMs, cutoffWeekStartEpoch });
  return { running: true, intervalMs: _cleanupIntervalMs, scheduledAt: Date.now() + initialDelayMs };
};

service.stopWeeklyCleanupScheduler = function () {
  if (!_cleanupTimer) return { stopped: true, reason: 'not_running' };
  try { clearInterval(_cleanupTimer); clearTimeout(_cleanupTimer); } catch (e) { /* ignore */ }
  _cleanupTimer = null;
  _logger.info && _logger.info({ event: 'cleanup.scheduler.stopped', stoppedAt: Date.now() });
  return { stopped: true };
};

module.exports = service;
