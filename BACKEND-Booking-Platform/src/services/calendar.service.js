/**
 * src/services/calendar.service.js
 *
 * Service layer for calendar operations, booking-slot orchestration, and weekly cleanup scheduling.
 * - Uses epoch ms everywhere.
 * - Converts local input <-> UTC using Luxon and calendar.timezone.
 * - Splits multi-day/week slots into week-aligned segments and attempts atomic reservation per segment.
 * - Schedules a single repeating weekly cleanup using setInterval (one scheduler per process).
 * - Attempts timezone detection from request IP using geoip-lite (optional dependency).
 *
 * Dependencies:
 *   npm i luxon
 *   npm i geoip-lite   // optional; fallback to 'UTC' if not installed
 *
 * Exposed functions:
 *  - getLatestCalendarByService(serviceId)
 *  - getLatestCalendarByUser(ownerId)
 *  - getDefaultCalendarView({ ownerId, serviceId, dateEpoch, timezone, capacity })
 *  - isSlotAvailable(params)
 *  - reserveSlotRange(params)
 *  - splitRangeByWeek(fromEpoch, toEpoch)
 *  - convertLocalToUtcEpoch(localDateTimeISO, ianaTz)
 *  - convertUtcEpochToLocal(epochMs, ianaTz)
 *  - computeDefaultOffLimitsForWeek(weekStartEpoch, ianaTz)
 *  - startWeeklyCleanupScheduler(opts)
 *  - stopWeeklyCleanupScheduler()
 */

const { DateTime } = require('luxon');
const repo = require('../repositories/calendar.repo');
const { mondayStartEpoch, sundayEndEpoch } = require('../models/calendar.model');

let geoip;
try {
  // optional dependency for IP -> timezone best-effort
  geoip = require('geoip-lite');
} catch (e) {
  geoip = null;
}

const DEFAULT_MIN_MS = 5 * 60 * 1000;
const DEFAULT_MAX_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const service = {};

/* -------------------------
 * Timezone helpers (Luxon)
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

/**
 * Best-effort timezone detection from IP.
 * - Uses geoip-lite if available to map IP -> country/region -> IANA tz via a simple mapping.
 * - This is a best-effort fallback; prefer explicit user timezone when available.
 */
service.detectTimezoneFromIp = function (ip) {
  try {
    if (!ip) return 'UTC';
    if (!geoip) return 'UTC';
    const geo = geoip.lookup(ip);
    if (!geo) return 'UTC';
    // geoip-lite returns country, region, city, ll, timezone may not be present.
    // Many deployments map country -> timezone; geoip-lite sometimes includes tz in geo.timezone.
    if (geo.timezone) return geo.timezone;
    // fallback: map country to a common timezone (very coarse)
    const country = (geo.country || '').toUpperCase();
    const countryTzMap = {
      CA: 'America/Toronto',
      US: 'America/New_York',
      GB: 'Europe/London',
      AU: 'Australia/Sydney'
      // extend as needed
    };
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
 * Availability & reservation
 * ------------------------- */

service.isSlotAvailable = async function ({ ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1, timezone = 'UTC' }) {
  const validation = service.validateSlotDto(fromEpoch, toEpoch);
  if (!validation.ok) return validation;

  const res = await repo.isSlotAvailable({ ownerId, serviceId, fromEpoch, toEpoch, capacityNeeded });
  if (res && res.code === 'NO_CALENDAR') {
    const defaultCal = service.getDefaultCalendarView({ ownerId, serviceId, dateEpoch: fromEpoch, timezone });
    for (const o of defaultCal.offLimitsSlots || []) {
      if (o.fromEpoch < toEpoch && o.toEpoch > fromEpoch) {
        return { ok: false, code: 'OUT_OF_BUSINESS_HOURS', message: 'CANNOT book out of business hours (default)' };
      }
    }
    return { ok: true, code: 'DEFAULT_CALENDAR', message: 'using default 09-17 M-F', defaultCalendar: defaultCal };
  }
  return res;
};

service.reserveSlotRange = async function ({ ownerId, serviceId = null, bookingId, fromEpoch, toEpoch, capacityUsed = 1, timezone = 'UTC' }) {
  if (!ownerId || !bookingId) throw new Error('ownerId and bookingId required');

  const validation = service.validateSlotDto(fromEpoch, toEpoch, { allowLong: true });
  if (!validation.ok) return { ok: false, results: [{ ok: false, code: validation.code, message: validation.message }], action: 'none' };

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
      tentative: true
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
          tentative: true
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
    try {
      await repo.releaseTentativeSlot(ownerId, bookingId);
    } catch (err) {
      return { ok: false, results, action: 'rolled_back', rollbackError: err.message || String(err) };
    }
    return { ok: false, results, action: 'rolled_back' };
  }

  return { ok: true, results, action: 'committed' };
};

/* -------------------------
 * Weekly cleanup scheduler
 * ------------------------- */

/**
 * Scheduler state (single scheduler per process)
 */
let _cleanupTimer = null;
let _cleanupIntervalMs = WEEK_MS;
let _logger = console;

/**
 * startWeeklyCleanupScheduler(opts)
 * - Starts a repeating cleanup job using setInterval if not already running.
 * - opts:
 *    { intervalMs = WEEK_MS, initialDelayMs = 0, cutoffWeekStartEpoch = null, logger = console }
 * - Behavior:
 *    * If already running, returns current scheduler info.
 *    * Runs cleanup once after initialDelayMs, then repeats every intervalMs.
 *    * Logs start/finish and errors via provided logger.
 */
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

  // schedule first run after initialDelayMs
  _cleanupTimer = setTimeout(() => {
    // run immediately (first invocation)
    runCleanup().catch(() => {});
    // then schedule repeating interval
    _cleanupTimer = setInterval(() => {
      runCleanup().catch(() => {});
    }, _cleanupIntervalMs);
  }, initialDelayMs);

  _logger.info && _logger.info({ event: 'cleanup.scheduler.started', initialDelayMs, intervalMs, cutoffWeekStartEpoch });
  return { running: true, intervalMs: _cleanupIntervalMs, scheduledAt: Date.now() + initialDelayMs };
};

/**
 * stopWeeklyCleanupScheduler()
 * - Stops the running scheduler (if any).
 */
service.stopWeeklyCleanupScheduler = function () {
  if (!_cleanupTimer) return { stopped: true, reason: 'not_running' };
  try {
    if (typeof _cleanupTimer === 'object' && _cleanupTimer.hasRef && _cleanupTimer.hasRef()) {
      // Node Timeout object for setInterval/setTimeout
    }
  } catch (e) {
    // ignore
  }
  try {
    clearInterval(_cleanupTimer);
    clearTimeout(_cleanupTimer);
  } catch (e) {
    // ignore
  }
  _cleanupTimer = null;
  _logger.info && _logger.info({ event: 'cleanup.scheduler.stopped', stoppedAt: Date.now() });
  return { stopped: true };
};

/* -------------------------
 * Export
 * ------------------------- */

module.exports = service;
