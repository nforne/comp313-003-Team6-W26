// src/controllers/service.controller.js
//
// HTTP controllers for Service endpoints.
// - Responsibilities: validate request payloads, enforce basic controller-level authorization,
//   delegate domain logic to service layer, emit controller-level audit events, and return
//   consistent JSON responses.
// - Endpoints:
//    POST   /svcs         -> createService
//    GET    /svcs/:id     -> getService
//    PATCH  /svcs/:id     -> updateService
//    DELETE /svcs/:id     -> deleteService
//    GET    /svcs         -> searchServices
//
// Notes:
// - `req.user` may be undefined for unauthenticated requests; controller performs short-circuit checks
//   (e.g., providerId must match authenticated user unless admin) but the service layer is authoritative
//   for domain-level authorization and logging.
// - Validators are used to validate and sanitize input; controller returns 400 on validation failures.

const serviceService = require('../services/service.service');
const auditService = require('../services/audit.service');
const { createServiceSchema, updateServiceSchema, searchSchema } = require('../validators/service.validator');

/**
 * Helper: build actor object from req.user for audit events
 */
function actorFromReq(req) {
  return { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null };
}

/**
 * POST /svcs
 */
async function createService(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = createServiceSchema.validate(req.body, { stripUnknown: true });

  if (error) {
    await auditService.logEvent({
      eventType: 'service.create.failed.validation',
      actor: actorFromReq(req),
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  try {
    const actor = req.user || {};

    // Controller-level guard: providerId must match authenticated user unless admin
    if (actor.role !== 'administrator' && actor.userId !== value.providerId) {
      await auditService.logEvent({
        eventType: 'service.create.forbidden',
        actor: actorFromReq(req),
        target: { type: 'Service', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { attemptedProviderId: value.providerId }
      });
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    const created = await serviceService.createService(value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.create.success',
      actor: actorFromReq(req),
      target: { type: 'Service', id: created.serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { providerId: created.providerId, name: created.name }
    });

    return res.status(201).json({ ok: true, service: created });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.create.failed',
      actor: actorFromReq(req),
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * GET /svcs/:id
 */
async function getService(req, res) {
  const correlationId = req.correlationId || null;
  const serviceId = req.params.id;

  try {
    const actor = req.user || {};
    const svc = await serviceService.getService(serviceId, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.get.success',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return res.json({ ok: true, service: svc });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.get.failed',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * PATCH /svcs/:id
 */
async function updateService(req, res) {
  const correlationId = req.correlationId || null;
  const serviceId = req.params.id;
  const { error, value } = updateServiceSchema.validate(req.body, { stripUnknown: true });

  if (error) {
    await auditService.logEvent({
      eventType: 'service.update.failed.validation',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  try {
    const actor = req.user || {};
    const updated = await serviceService.updateService(serviceId, value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.update.success',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(value || {}) }
    });

    return res.json({ ok: true, service: updated });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.update.failed',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * DELETE /svcs/:id
 */
async function deleteService(req, res) {
  const correlationId = req.correlationId || null;
  const serviceId = req.params.id;

  try {
    const actor = req.user || {};
    await serviceService.removeService(serviceId, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.delete.success',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    // No content on successful deletion
    return res.status(204).send();
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.delete.failed',
      actor: actorFromReq(req),
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/**
 * GET /svcs
 */
async function searchServices(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = searchSchema.validate(req.query, { stripUnknown: true });

  if (error) {
    await auditService.logEvent({
      eventType: 'service.search.failed.validation',
      actor: actorFromReq(req),
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  try {
    const actor = req.user || {};
    const results = await serviceService.search(value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.search.success',
      actor: actorFromReq(req),
      target: { type: 'Service', id: null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, total: results.total }
    });

    return res.json({ ok: true, ...results });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.search.failed',
      actor: actorFromReq(req),
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createService,
  getService,
  updateService,
  deleteService,
  searchServices
};
