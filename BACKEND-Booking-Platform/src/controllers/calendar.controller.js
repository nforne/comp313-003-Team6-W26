/**
 * src/controllers/calendar.controller.js
 *
 * Polished Express controller for calendar endpoints.
 * - Thin HTTP layer: reads validated input (req.validated) when present, falls back to req.body/req.query.
 * - Detects timezone (header/query/body/ip) and prefers app logger when available.
 * - Delegates to service/repo and records best-effort audit events.
 * - Responses use a consistent JSON shape: { ok: boolean, data?, error?, results?, action? }.
 *
 * Routes handled here:
 *  GET  /calendar/service/:serviceId/latest
 *  GET  /calendar/user/:ownerId/latest
 *  GET  /calendar/default
 *  GET  /calendar/weekscalendar
 *  POST /calendar/availability
 *  POST /calendar/reserve
 *  POST /calendar/cleanup           (admin)
 *  POST /calendar/cleanup/scheduler  (admin)
 */

const express = require('express');
const service = require('../services/calendar.service');
const auditService = require('../services/audit.service');
const { requireAuth, optionalAuth } = require('../middleware/auth.middleware');
const { requireRole, requireAnyRole } = require('../middleware/rbac.middleware');

let adminOnly

const router = express.Router();

/* -------------------------
 * Helpers
 * ------------------------- */

function jsonError(res, status = 400, code = 'INVALID', message = 'invalid request') {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function validatedBody(req) {
  return (req.validated && req.validated.body) ? req.validated.body : (req.body || {});
}
function validatedQuery(req) {
  return (req.validated && req.validated.query) ? req.validated.query : (req.query || {});
}

function detectTimezone(req) {
  const explicit =
    req.headers['x-user-timezone'] ||
    (req.query && req.query.timezone) ||
    (req.body && req.body.timezone);
  if (explicit) return explicit;
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  try {
    return service.detectTimezoneFromIp(ip) || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

function loggerFor(req) {
  return (req.app && req.app.get && req.app.get('logger')) || console;
}

async function auditLog(req, eventType, outcome, severity = 'info', details = {}) {
  try {
    await auditService.logEvent({
      eventType,
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: details.target || null,
      outcome,
      severity,
      correlationId: req.correlationId || null,
      details
    });
  } catch (e) {
    const log = loggerFor(req);
    log.error && log.error({ event: 'audit.error', error: e && e.message ? e.message : String(e), originalEvent: eventType });
  }
}

/* -------------------------
 * Controllers
 * ------------------------- */

/**
 * GET /calendar/service/:serviceId/latest
 */
router.get('/service/:serviceId/latest', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { serviceId } = req.params;
    if (!serviceId) return jsonError(res, 400, 'MISSING_SERVICE', 'serviceId required');

    const q = validatedQuery(req);
    const dateEpoch = q.dateEpoch ? Number(q.dateEpoch) : Date.now();
    const tz = detectTimezone(req);

    log.info && log.info({ event: 'calendar.getLatestByService.request', serviceId, dateEpoch, tz, correlationId });

    const cal = await service.getLatestCalendarByService(serviceId);
    if (!cal) {
      const defaultCal = service.getDefaultCalendarView({ ownerId: null, serviceId, dateEpoch, timezone: tz });
      await auditLog(req, 'calendar.service.get.default', 'success', 'info', { serviceId, correlationId, source: 'default' });
      return res.json({ ok: true, data: defaultCal, meta: { source: 'default' } });
    }

    await auditLog(req, 'calendar.service.get', 'success', 'info', { serviceId, calendarId: cal._id, correlationId });
    return res.json({ ok: true, data: cal, meta: { source: 'persisted' } });
  } catch (err) {
    loggerFor(req).error && loggerFor(req).error({ event: 'calendar.getLatestByService.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.service.get.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /calendar/user/:ownerId/latest
 */
router.get('/user/:ownerId/latest', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { ownerId } = req.params;
    if (!ownerId) return jsonError(res, 400, 'MISSING_OWNER', 'ownerId required');

    const q = validatedQuery(req);
    const dateEpoch = q.dateEpoch ? Number(q.dateEpoch) : Date.now();
    const tz = detectTimezone(req);

    log.info && log.info({ event: 'calendar.getLatestByUser.request', ownerId, dateEpoch, tz, correlationId });

    const cal = await service.getLatestCalendarByUser(ownerId);
    if (!cal) {
      const defaultCal = service.getDefaultCalendarView({ ownerId, serviceId: null, dateEpoch, timezone: tz });
      await auditLog(req, 'calendar.user.get.default', 'success', 'info', { ownerId, correlationId, source: 'default' });
      return res.json({ ok: true, data: defaultCal, meta: { source: 'default' } });
    }

    await auditLog(req, 'calendar.user.get', 'success', 'info', { ownerId, calendarId: cal._id, correlationId });
    return res.json({ ok: true, data: cal, meta: { source: 'persisted' } });
  } catch (err) {
    loggerFor(req).error && loggerFor(req).error({ event: 'calendar.getLatestByUser.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.user.get.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /calendar/default
 */
router.get('/default', async (req, res) => {
  const log = loggerFor(req);
  try {
    const q = validatedQuery(req);
    const ownerId = q.ownerId || null;
    const serviceId = q.serviceId || null;
    const dateEpoch = q.dateEpoch ? Number(q.dateEpoch) : Date.now();
    const timezone = detectTimezone(req);

    log.info && log.info({ event: 'calendar.getDefault.request', ownerId, serviceId, dateEpoch, timezone, correlationId: req.correlationId || null });

    const defaultCal = service.getDefaultCalendarView({ ownerId, serviceId, dateEpoch, timezone });
    return res.json({ ok: true, data: defaultCal, meta: { source: 'default' } });
  } catch (err) {
    loggerFor(req).error && loggerFor(req).error({ event: 'calendar.getDefault.error', error: err.message || String(err) });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /calendar/weekscalendar
 * Query: { entity: 'user:<id>'|'service:<id>', startOfWeekEpoch, endOfWeekEpoch?, timezone? }
 *
 * Notes:
 * - requester must be authenticated (req.user) — controller is mounted under requireAuth in routes.
 * - service enforces owner/admin rules for past weeks; controller passes requester context.
 */
router.get('/weekscalendar', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const q = validatedQuery(req);
    const entity = q.entity;
    const startOfWeekEpoch = typeof q.startOfWeekEpoch === 'number' ? q.startOfWeekEpoch : (q.startOfWeekEpoch ? Number(q.startOfWeekEpoch) : null);
    const endOfWeekEpoch = typeof q.endOfWeekEpoch === 'number' ? q.endOfWeekEpoch : (q.endOfWeekEpoch ? Number(q.endOfWeekEpoch) : null);
    const timezone = q.timezone || detectTimezone(req);

    if (!entity || typeof startOfWeekEpoch !== 'number') {
      await auditLog(req, 'calendar.weekscalendar.failed.validation', 'failure', 'warning', { correlationId, details: { query: q } });
      return jsonError(res, 400, 'INVALID_INPUT', 'entity and startOfWeekEpoch are required');
    }

    const requesterIsAdmin = !!(req.user && req.user.role === 'administrator');
    const requesterId = req.user && req.user.userId ? req.user.userId : null;

    log.info && log.info({ event: 'calendar.weekscalendar.request', entity, startOfWeekEpoch, endOfWeekEpoch, timezone, requesterIsAdmin, requesterId, correlationId });

    const result = await service.getWeeksCalendar({
      entity,
      startOfWeekEpoch,
      endOfWeekEpoch,
      timezone,
      requesterIsAdmin,
      requesterId
    });

    if (!result || !result.ok) {
      await auditLog(req, 'calendar.weekscalendar.failed', 'failure', 'warning', { correlationId, details: { entity, startOfWeekEpoch, endOfWeekEpoch, reason: result && result.message } });
      return jsonError(res, 403, result && result.code ? result.code : 'FORBIDDEN', result && result.message ? result.message : 'forbidden');
    }

    await auditLog(req, 'calendar.weekscalendar.success', 'success', 'info', { entity, startOfWeekEpoch, weeks: result.weeks.length, correlationId });
    return res.json({ ok: true, data: result.weeks, meta: { source: 'constructed_or_persisted' } });
  } catch (err) {
    log.error && log.error({ event: 'calendar.weekscalendar.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.weekscalendar.error', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * POST /calendar/availability
 * Body: { ownerId, serviceId?, fromEpoch, toEpoch, capacityNeeded?, timezone? }
 */
router.post('/availability', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const b = validatedBody(req);
    const { ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1 } = b;
    const timezone = detectTimezone(req);

    if (!ownerId || typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
      await auditLog(req, 'calendar.availability.failed.validation', 'failure', 'warning', { correlationId, details: { body: b } });
      return jsonError(res, 400, 'INVALID_INPUT', 'ownerId, fromEpoch and toEpoch are required and must be numbers');
    }

    log.info && log.info({ event: 'calendar.availability.request', ownerId, serviceId, fromEpoch, toEpoch, capacityNeeded, timezone, correlationId });

    const result = await service.isSlotAvailable({ ownerId, serviceId, fromEpoch, toEpoch, capacityNeeded, timezone });
    if (result && result.ok) {
      await auditLog(req, 'calendar.availability.success', 'success', 'info', { ownerId, serviceId, correlationId });
      return res.json({ ok: true, data: result });
    }

    await auditLog(req, 'calendar.availability.unavailable', 'failure', 'info', { ownerId, serviceId, code: result.code, correlationId });
    return res.status(200).json({
      ok: false,
      error: { code: result.code || 'UNAVAILABLE', message: result.message || 'not available' },
      defaultCalendar: result.defaultCalendar
    });
  } catch (err) {
    log.error && log.error({ event: 'calendar.availability.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.availability.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * POST /calendar/reserve
 * Body: { ownerId, serviceId?, bookingId, fromEpoch, toEpoch, capacityUsed?, timezone?, metadata?, checked? }
 *
 * Notes:
 * - forwards optional metadata and checked flag to service.reserveSlotRange
 * - checked=true skips the pre-check (fast-path) — caller must ensure they previously checked availability
 */
router.post('/reserve', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const b = validatedBody(req);
    const {
      ownerId,
      serviceId = null,
      bookingId,
      fromEpoch,
      toEpoch,
      capacityUsed = 1,
      metadata = {},
      checked = false
    } = b;
    const timezone = detectTimezone(req);

    if (!ownerId || !bookingId || typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
      await auditLog(req, 'calendar.reserve.failed.validation', 'failure', 'warning', { correlationId, details: { body: b } });
      return jsonError(res, 400, 'INVALID_INPUT', 'ownerId, bookingId, fromEpoch and toEpoch are required');
    }

    log.info && log.info({ event: 'calendar.reserve.request', ownerId, serviceId, bookingId, fromEpoch, toEpoch, capacityUsed, timezone, checked, correlationId });

    const payload = { ownerId, serviceId, bookingId, fromEpoch, toEpoch, capacityUsed, timezone, metadata, checked };
    const result = await service.reserveSlotRange(payload);

    if (result.ok) {
      await auditLog(req, 'calendar.reserve.success', 'success', 'info', { ownerId, bookingId, segments: result.results.length, correlationId });
      log.info && log.info({ event: 'calendar.reserve.success', bookingId, ownerId, segments: result.results.length, correlationId });
      return res.json({ ok: true, results: result.results, action: result.action });
    }

    await auditLog(req, 'calendar.reserve.failed', 'failure', 'warning', { ownerId, bookingId, correlationId, details: { results: result.results } });
    log.warn && log.warn({ event: 'calendar.reserve.failed', bookingId, ownerId, reason: result.results || result, correlationId });
    return res.status(409).json({ ok: false, results: result.results, action: result.action, rollbackError: result.rollbackError });
  } catch (err) {
    log.error && log.error({ event: 'calendar.reserve.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.reserve.error', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/* -------------------------
 * Admin endpoints
 * ------------------------- */

/**
 * POST /calendar/cleanup
 * Body: { cutoffWeekStartEpoch }
 *
 * Note: route-level middleware should enforce admin; this is a defensive check.
 */
router.post('/cleanup', requireAuth, requireRole('administrator'), async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const b = validatedBody(req);
    const { cutoffWeekStartEpoch } = b;

    if (typeof cutoffWeekStartEpoch !== 'number') {
      await auditLog(req, 'calendar.cleanup.failed.validation', 'failure', 'warning', { correlationId, details: { body: b } });
      return jsonError(res, 400, 'INVALID_INPUT', 'cutoffWeekStartEpoch (epoch ms for Monday) required');
    }

    log.info && log.info({ event: 'calendar.cleanup.trigger', by: req.user && req.user.userId, cutoffWeekStartEpoch, correlationId });
    await auditLog(req, 'calendar.cleanup.trigger', 'success', 'info', { by: req.user && req.user.userId, cutoffWeekStartEpoch, correlationId });

    const result = await service.cleanupBlankCalendars(cutoffWeekStartEpoch);

    await auditLog(req, 'calendar.cleanup.result', 'success', 'info', { result, correlationId });
    log.info && log.info({ event: 'calendar.cleanup.result', result, correlationId });

    return res.json({ ok: true, data: result });
  } catch (err) {
    log.error && log.error({ event: 'calendar.cleanup.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.cleanup.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * POST /calendar/cleanup/scheduler
 * Body: { action: 'start'|'stop', intervalMs?, initialDelayMs?, cutoffWeekStartEpoch? }
 */
router.post('/cleanup/scheduler', requireAuth, requireRole('administrator'), async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const b = validatedBody(req);
    const { action, intervalMs, initialDelayMs, cutoffWeekStartEpoch } = b;

    if (!action || (action !== 'start' && action !== 'stop')) {
      await auditLog(req, 'calendar.cleanup.scheduler.invalid', 'failure', 'warning', { correlationId, details: { body: b } });
      return jsonError(res, 400, 'INVALID_INPUT', "action required and must be 'start' or 'stop'");
    }

    if (action === 'start') {
      const info = service.startWeeklyCleanupScheduler({
        intervalMs,
        initialDelayMs,
        cutoffWeekStartEpoch,
        logger: log
      });
      await auditLog(req, 'calendar.cleanup.scheduler.start', 'success', 'info', { by: req.user && req.user.userId, info, correlationId });
      log.info && log.info({ event: 'calendar.cleanup.scheduler.start', info, correlationId });
      return res.json({ ok: true, data: info });
    }

    const info = service.stopWeeklyCleanupScheduler();
    await auditLog(req, 'calendar.cleanup.scheduler.stop', 'success', 'info', { by: req.user && req.user.userId, info, correlationId });
    log.info && log.info({ event: 'calendar.cleanup.scheduler.stop', info, correlationId });
    return res.json({ ok: true, data: info });
  } catch (err) {
    log.error && log.error({ event: 'calendar.cleanup.scheduler.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'calendar.cleanup.scheduler.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/* -------------------------
 * Export router
 * ------------------------- */

module.exports = router;
