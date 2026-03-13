// src/controllers/request.controller.js
/**
 * Request controller (polished, non-disruptive)
 *
 * - Thin HTTP layer that validates input, calls request.service, and emits audit events.
 * - Keeps original routes and semantics intact.
 * - Small polishing: consistent actor extraction, clearer validation/audit flows,
 *   safer numeric parsing for query params, and consistent response shapes.
 */

const requestService = require('../services/request.service');
const auditService = require('../services/audit.service');
const { createRequestSchema, searchSchema } = require('../validators/request.validator');

/**
 * POST /reqs
 */
async function createRequest(req, res) {
  const correlationId = req.correlationId || null;
  const actor = req.user || {};

  const { error, value } = createRequestSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'request.create.failed.validation',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const created = await requestService.createRequest(value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'request.create.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Request', id: created._id ? created._id.toString() : null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { isPrivate: created.isPrivate, allowedProviders: created.allowedProviders || [] }
    });

    return res.status(201).json({ request: created });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'request.create.failed',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * GET /reqs/:id
 */
async function getRequest(req, res) {
  const correlationId = req.correlationId || null;
  const actor = req.user || null;

  try {
    const r = await requestService.getRequest(req.params.id, actor, correlationId);

    await auditService.logEvent({
      eventType: 'request.get.success',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return res.json({ request: r });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'request.get.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * GET /reqs
 * Query params: categories[], location, nearLng, nearLat, radiusMeters, page, pageSize
 */
async function searchRequests(req, res) {
  const correlationId = req.correlationId || null;
  const actor = req.user || null;

  const { error, value } = searchSchema.validate(req.query);
  if (error) {
    await auditService.logEvent({
      eventType: 'request.search.failed.validation',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    // parse near coordinates if provided (prefer validated values from schema)
    const near = (typeof value.nearLng !== 'undefined' && typeof value.nearLat !== 'undefined')
      ? [Number(value.nearLng), Number(value.nearLat)]
      : null;

    // ensure numeric pagination values are safe
    const page = Number.isFinite(Number(value.page)) ? Math.max(1, Number(value.page)) : 1;
    const pageSize = Number.isFinite(Number(value.pageSize)) ? Math.max(1, Math.min(100, Number(value.pageSize))) : 20;
    const radiusMeters = Number.isFinite(Number(value.radiusMeters)) ? Number(value.radiusMeters) : 50000;

    const params = Object.assign({}, value, {
      near,
      page,
      pageSize,
      radiusMeters
    });

    const results = await requestService.searchOpenRequests(params, actor, correlationId);

    await auditService.logEvent({
      eventType: 'request.search.success',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Request', id: null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, page: results.page, pageSize: results.pageSize }
    });

    return res.json(results);
  } catch (err) {
    await auditService.logEvent({
      eventType: 'request.search.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * PATCH /reqs/:id
 */
async function updateRequest(req, res) {
  const correlationId = req.correlationId || null;
  const actor = req.user || {};

  try {
    const updated = await requestService.updateRequest(req.params.id, req.body, actor, correlationId);

    await auditService.logEvent({
      eventType: 'request.update.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(req.body || {}) }
    });

    return res.json({ request: updated });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'request.update.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * DELETE /reqs/:id
 * Hard delete a request. Allowed only when request.status === 'draft'.
 * Only the request owner or an administrator may perform the deletion.
 */
async function deleteRequest(req, res) {
  const correlationId = req.correlationId || null;
  const actor = req.user || {};

  try {
    const deleted = await requestService.hardDeleteRequest(req.params.id, actor, correlationId);

    await auditService.logEvent({
      eventType: 'request.delete.success',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { deletedId: req.params.id }
    });

    return res.json({ request: deleted });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'request.delete.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

module.exports = {  createRequest,  getRequest,  searchRequests,  updateRequest,  deleteRequest};
