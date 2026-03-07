// src/controllers/message.controller.js
//
// Polished Express controller for Message endpoints.
// - Thin HTTP layer: reads validated input (req.validated) when present, falls back to req.body/req.query.
// - Delegates business logic to src/services/message.service.js.
// - Uses request correlationId, app logger, and auditService for important events.
// - Responses use consistent JSON shape: { ok: boolean, data?, error?, results?, action? }.

const express = require('express');
const service = require('../services/message.service');
const auditService = require('../services/audit.service');

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

/* logger helper: prefer app logger if present */
function loggerFor(reqOrActor) {
  if (!reqOrActor) return console;
  const app = reqOrActor.app || (reqOrActor.req && reqOrActor.req.app) || null;
  return (app && app.get && app.get('logger')) || console;
}

/* audit helper (best-effort) */
async function auditLog(actorOrReq, eventType, outcome, severity = 'info', details = {}) {
  try {
    const actor = actorOrReq && actorOrReq.user ? actorOrReq.user : actorOrReq;
    await auditService.logEvent({
      eventType,
      actor: { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null },
      target: details.target || null,
      outcome,
      severity,
      correlationId: (actorOrReq && actorOrReq.correlationId) || (actor && actor.correlationId) || null,
      details
    });
  } catch (e) {
    const log = loggerFor(actorOrReq);
    log.error && log.error({ event: 'audit.error', error: e && e.message ? e.message : String(e), originalEvent: eventType });
  }
}

/* Admin guard middleware. Expects req.user.isAdmin boolean */
function adminOnly(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return jsonError(res, 403, 'FORBIDDEN', 'admin access required');
  }
  return next();
}

/* -------------------------
 * Controllers
 * ------------------------- */

/**
 * GET /messages
 * Query: page, limit, type, since, unreadOnly, recipientId, recipientsAll
 * Returns paginated messages for current user (or filtered by query if admin).
 */
router.get('/', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const q = validatedQuery(req);
    const actor = req.user || null;

    log.info && log.info({ event: 'message.list.request', query: q, actor: actor && actor.userId, correlationId });

    const data = await service.listForUser(actor, {
      userId: q.recipientId || (actor && actor.userId),
      page: q.page,
      limit: q.limit,
      type: q.type,
      since: q.since,
      unreadOnly: q.unreadOnly,
      readIds: q.readIds || []
    });

    await auditLog(req, 'message.list', 'success', 'info', { actor: actor && actor.userId, correlationId, query: q });
    return res.json({ ok: true, results: data.results, meta: { page: data.page, limit: data.limit, total: data.total } });
  } catch (err) {
    log.error && log.error({ event: 'message.list.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.list.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /messages/:id
 */
router.get('/:id', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { id } = req.params;
    if (!id) return jsonError(res, 400, 'MISSING_ID', 'id required');

    log.info && log.info({ event: 'message.get.request', id, correlationId, actor: req.user && req.user.userId });

    const msg = await service.getMessage(req.user, id);
    if (!msg) return jsonError(res, 404, 'NOT_FOUND', 'message not found');

    await auditLog(req, 'message.get', 'success', 'info', { messageId: id, correlationId });
    return res.json({ ok: true, data: msg });
  } catch (err) {
    log.error && log.error({ event: 'message.get.error', error: err.message || String(err), correlationId });
    const code = err.code === 'FORBIDDEN' ? 403 : (err.code === 'NOT_FOUND' ? 404 : 500);
    if (err.code === 'FORBIDDEN') {
      await auditLog(req, 'message.get.forbidden', 'failure', 'warning', { messageId: req.params.id, correlationId });
      return jsonError(res, 403, 'FORBIDDEN', 'access denied');
    }
    await auditLog(req, 'message.get.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, code, 'ERROR', err.message || 'internal error');
  }
});

/**
 * POST /messages
 * Create a draft message (persisted as draft). Use idempotencyKey to avoid duplicates.
 */
router.post('/', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const b = validatedBody(req);
    const actor = req.user || null;

    // server enforces sender userId if not provided
    if (!b.type) {
      return jsonError(res, 400, 'INVALID_INPUT', 'type is required');
    }

    const payload = Object.assign({}, b, { userId: b.userId || (actor && actor.userId) || null });
    const created = await service.createDraft(actor, payload);

    await auditLog(req, 'message.create.draft', 'success', 'info', { messageId: created._id, correlationId });
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    log.error && log.error({ event: 'message.create.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.create.failed', 'failure', 'error', { message: err.message, correlationId });
    // handle idempotency duplicate returns from repo/service
    if (err && err.code === 11000) {
      return jsonError(res, 409, 'DUPLICATE', 'duplicate message');
    }
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * POST /messages/:id/submit
 * Submit a draft (author or admin). Triggers delivery for email/notification types.
 */
router.post('/:id/submit', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { id } = req.params;
    if (!id) return jsonError(res, 400, 'MISSING_ID', 'id required');

    const actor = req.user || null;
    const submitted = await service.submitMessage(actor, id);

    await auditLog(req, 'message.submit', 'success', 'info', { messageId: id, correlationId });
    return res.json({ ok: true, data: submitted, action: 'submitted' });
  } catch (err) {
    log.error && log.error({ event: 'message.submit.error', error: err.message || String(err), correlationId });
    if (err.code === 'FORBIDDEN') {
      await auditLog(req, 'message.submit.forbidden', 'failure', 'warning', { messageId: req.params.id, correlationId });
      return jsonError(res, 403, 'FORBIDDEN', 'not allowed to submit');
    }
    await auditLog(req, 'message.submit.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 400, err.code || 'ERROR', err.message || 'internal error');
  }
});

/**
 * PATCH /messages/:id
 * Update allowed fields (author or admin).
 */
router.patch('/:id', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { id } = req.params;
    if (!id) return jsonError(res, 400, 'MISSING_ID', 'id required');

    const b = validatedBody(req);
    const actor = req.user || null;

    const updated = await service.updateMessage(actor, id, b);
    await auditLog(req, 'message.update', 'success', 'info', { messageId: id, correlationId, changes: Object.keys(b) });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    log.error && log.error({ event: 'message.update.error', error: err.message || String(err), correlationId });
    if (err.code === 'FORBIDDEN') {
      await auditLog(req, 'message.update.forbidden', 'failure', 'warning', { messageId: req.params.id, correlationId });
      return jsonError(res, 403, 'FORBIDDEN', 'not allowed to update');
    }
    await auditLog(req, 'message.update.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 400, err.code || 'ERROR', err.message || 'internal error');
  }
});

/**
 * DELETE /messages/:id
 * Soft-delete (author or admin).
 */
router.delete('/:id', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { id } = req.params;
    if (!id) return jsonError(res, 400, 'MISSING_ID', 'id required');

    const actor = req.user || null;
    const deleted = await service.softDelete(actor, id);

    await auditLog(req, 'message.softDelete', 'success', 'info', { messageId: id, correlationId });
    return res.json({ ok: true, data: deleted, action: 'soft_deleted' });
  } catch (err) {
    log.error && log.error({ event: 'message.softDelete.error', error: err.message || String(err), correlationId });
    if (err.code === 'FORBIDDEN') {
      await auditLog(req, 'message.softDelete.forbidden', 'failure', 'warning', { messageId: req.params.id, correlationId });
      return jsonError(res, 403, 'FORBIDDEN', 'not allowed to delete');
    }
    await auditLog(req, 'message.softDelete.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 400, err.code || 'ERROR', err.message || 'internal error');
  }
});

/**
 * DELETE /messages/:id/hard
 * Hard delete (admin only).
 */
router.delete('/:id/hard', adminOnly, async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { id } = req.params;
    if (!id) return jsonError(res, 400, 'MISSING_ID', 'id required');

    const actor = req.user || null;
    const removed = await service.hardDelete(actor, id);

    await auditLog(req, 'message.hardDelete', 'success', 'info', { messageId: id, correlationId });
    return res.json({ ok: true, data: removed, action: 'hard_deleted' });
  } catch (err) {
    log.error && log.error({ event: 'message.hardDelete.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.hardDelete.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /messages/type/:type
 * List messages by type (admin or filtered for user).
 */
router.get('/type/:type', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const { type } = req.params;
    if (!type) return jsonError(res, 400, 'MISSING_TYPE', 'type required');

    const q = validatedQuery(req);
    const actor = req.user || null;

    // admin can list all; non-admin will get filtered results via service.listByType
    const data = await service.listByType(actor, {
      type,
      page: q.page,
      limit: q.limit,
      since: q.since
    });

    await auditLog(req, 'message.listByType', 'success', 'info', { type, correlationId });
    return res.json({ ok: true, results: data.results, meta: { page: data.page, limit: data.limit, total: data.total } });
  } catch (err) {
    log.error && log.error({ event: 'message.listByType.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.listByType.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /messages/metadata
 * Query: key, value, page, limit
 * Generic listing by metadata key/value (bookingId, reviewId, bidId, etc.)
 */
router.get('/metadata', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const q = validatedQuery(req);
    if (!q.key || typeof q.value === 'undefined') return jsonError(res, 400, 'INVALID_INPUT', 'metadata key and value required');

    const actor = req.user || null;
    const data = await service.listByMetadata(q.key, q.value, { page: q.page, limit: q.limit });

    await auditLog(req, 'message.listByMetadata', 'success', 'info', { key: q.key, correlationId });
    return res.json({ ok: true, results: data.results, meta: { page: data.page, limit: data.limit, total: data.total } });
  } catch (err) {
    log.error && log.error({ event: 'message.listByMetadata.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.listByMetadata.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/**
 * GET /messages/thread (issue_wall)
 * Query: page, wallsPerPage, messagesPerWall
 */
router.get('/thread/issue_wall', async (req, res) => {
  const log = loggerFor(req);
  const correlationId = req.correlationId || null;
  try {
    const q = validatedQuery(req);
    const page = q.page || 1;
    const wallsPerPage = q.wallsPerPage || 3;
    const messagesPerWall = q.messagesPerWall || 20;

    const data = await service.listThread({ page, wallsPerPage, messagesPerWall });
    await auditLog(req, 'message.listThread', 'success', 'info', { correlationId, page });
    return res.json({ ok: true, results: data.results, meta: { page: data.page, wallsPerPage: data.wallsPerPage, totalWalls: data.totalWalls } });
  } catch (err) {
    log.error && log.error({ event: 'message.listThread.error', error: err.message || String(err), correlationId });
    await auditLog(req, 'message.listThread.failed', 'failure', 'error', { message: err.message, correlationId });
    return jsonError(res, 500, 'ERROR', err.message || 'internal error');
  }
});

/* -------------------------
 * Export router
 * ------------------------- */

module.exports = router;
