/**
 * src/services/calendar.service.js
 *
 * Service layer for calendar operations, booking-slot orchestration, and weekly cleanup scheduling.
 * - Uses epoch ms everywhere.
 * - Converts local input <-> UTC using Luxon and calendar.timezone.
 * - Splits multi-day/week slots into week-aligned segments and supports two-phase check+reserve.
 * - Schedules a single repeating weekly cleanup using setInterval (one scheduler per process).
 *
 * Non-disruptive: public function signatures preserved; added checkRangeAvailability,
 * getWeeksCalendar, and a checked fast-path for reserveSlotRange. Metadata is forwarded.
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

/* -------------------------
 * Weeks calendar builder
 * ------------------------- */

/**
 * getWeeksCalendar
 * - entity: 'user:<ownerId>' or 'service:<serviceId>' (serviceId must start with 'svc_')
 * - startOfWeekEpoch: Monday 00:00:00.000 UTC epoch ms (will be normalized)
 * - endOfWeekEpoch: optional; if omitted returns single week
 * - requesterIsAdmin: boolean
 * - requesterId: userId of requester (string) used to allow owner access
 *
 * Returns: { ok:true, weeks: [ { datesBracket, offLimitsSlots, bookingsSlots, metadata } ] } or { ok:false, code, message }
 */
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
 * ------------------------- */

/**
 * reserveSlotRange
 * - Two-phase: when checked === false (default) run checkRangeAvailability first.
 * - If checked === true skip availability checks (fast-path).
 * - After successful check, immediately reserve each segment.
 *
 * params: { ownerId, serviceId, bookingId, fromEpoch, toEpoch, capacityUsed, timezone, metadata, checked }
 */
service.reserveSlotRange = async function ({
  ownerId,
  serviceId = null,
  bookingId,
  fromEpoch,
  toEpoch,
  capacityUsed = 1,
  timezone = 'UTC',
  metadata = {},
  checked = false
}) {
  if (!ownerId || !bookingId) throw new Error('ownerId and bookingId required');

  const validation = service.validateSlotDto(fromEpoch, toEpoch, { allowLong: true });
  if (!validation.ok) return { ok: false, results: [{ ok: false, code: validation.code, message: validation.message }], action: 'none' };

  // 1) Pre-check all segments unless caller already did (checked === true)
  if (!checked) {
    const check = await service.checkRangeAvailability({ ownerId, serviceId, fromEpoch, toEpoch, capacityNeeded: capacityUsed });
    if (!check.ok) {
      // return conflict segments; do not attempt any reservation
      return { ok: false, results: check.conflicts.map(c => ({ segment: c.segment, ok: false, code: c.code, message: c.message })), action: 'none' };
    }
  }

  // 2) All segments available — proceed to reserve each segment immediately
  const segments = service.splitRangeByWeek(fromEpoch, toEpoch);
  const results = [];

  for (const seg of segments) {
    let attempt = await repo.reserveSlotAtomic({
      ownerId,
      serviceId,
      bookingId,
      fromEpoch: seg.fromEpoch,
      toEpoch: seg.toEpoch,
      capacityUsed,
      tentative: true,
      metadata
    });

    if (!attempt.ok && attempt.code === 'NO_CALENDAR') {
      try {
        await repo.findOrCreateWeeklyCalendar(ownerId, serviceId, seg.fromEpoch, { timezone });
        attempt = await repo.reserveSlotAtomic({
          ownerId,
          serviceId,
          bookingId,
          fromEpoch: seg.fromEpoch,
          toEpoch: seg.toEpoch,
          capacityUsed,
          tentative: true,
          metadata
        });
      } catch (err) {
        results.push({ segment: seg, ok: false, code: 'ERROR', message: err.message || String(err) });
        break;
      }
    }

    if (!attempt.ok) {
      results.push({ segment: seg, ok: false, code: attempt.code, message: attempt.message });
      break;
    }

    results.push({ segment: seg, ok: true, calendar: attempt.calendar });
  }

  const anyFailure = results.some(r => !r.ok);
  if (anyFailure) {
    try { await repo.releaseTentativeSlot(ownerId, bookingId); } catch (err) {
      return { ok: false, results, action: 'rolled_back', rollbackError: err.message || String(err) };
    }
    return { ok: false, results, action: 'rolled_back' };
  }

  return { ok: true, results, action: 'committed' };
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
