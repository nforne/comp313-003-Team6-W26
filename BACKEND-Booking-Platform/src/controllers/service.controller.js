// src/controllers/service.controller.js
const serviceService = require('../services/service.service');
const auditService = require('../services/audit.service');
const { createServiceSchema, updateServiceSchema, searchSchema } = require('../validators/service.validator');

/**
 * POST /svcs
 */
async function createService(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = createServiceSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'service.create.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    // providerId must match authenticated user unless admin
    if (actor.role !== 'administrator' && actor.userId !== value.providerId) {
      await auditService.logEvent({
        eventType: 'service.create.forbidden',
        actor: { userId: actor.userId || null, role: actor.role || null },
        target: { type: 'Service', id: null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { attemptedProviderId: value.providerId }
      });
      return res.status(403).json({ message: 'Forbidden' });
    }

    const created = await serviceService.createService(value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.create.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Service', id: created.serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { providerId: created.providerId, name: created.name }
    });

    return res.status(201).json({ service: created });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.create.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
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
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });
    return res.json({ service: svc });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.get.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * PATCH /svcs/:id
 */
async function updateService(req, res) {
  const correlationId = req.correlationId || null;
  const serviceId = req.params.id;
  const { error, value } = updateServiceSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'service.update.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const updated = await serviceService.updateService(serviceId, value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.update.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(value || {}) }
    });

    return res.json({ service: updated });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.update.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
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
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return res.status(204).send();
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.delete.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * GET /svcs
 */
async function searchServices(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = searchSchema.validate(req.query);
  if (error) {
    await auditService.logEvent({
      eventType: 'service.search.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const results = await serviceService.search(value, actor, correlationId);

    await auditService.logEvent({
      eventType: 'service.search.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Service', id: null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, total: results.total }
    });

    return res.json(results);
  } catch (err) {
    await auditService.logEvent({
      eventType: 'service.search.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: null },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

module.exports = { createService, getService, updateService, deleteService, searchServices };
