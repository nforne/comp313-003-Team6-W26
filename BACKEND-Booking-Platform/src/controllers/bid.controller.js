/**
 * src/controllers/bid.controller.js
 *
 * Express handlers for Bid endpoints.
 * - Controllers perform request validation and authentication checks.
 * - Controllers log transport/validation/auth failures via auditService.
 * - Domain events are logged in services.
 */

const bidService = require('../services/bid.service');
const bidRepo = require('../repositories/bid.repo');
const { createBidSchema, updateBidSchema } = require('../validators/bid.validator');
const auditService = require('../services/audit.service');

/**
 * POST /reqs/:request_id/bids
 */
async function createBid(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = createBidSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'bid.create.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.request_id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const created = await bidService.createBid(actor, req.params.request_id, value, correlationId);

    await auditService.logEvent({
      eventType: 'bid.create.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Bid', id: created._id ? created._id.toString() : null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { request_id: req.params.request_id, provider_id: actor.userId || null }
    });

    return res.status(201).json({ bid: created });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'bid.create.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.request_id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * GET /reqs/:request_id/bids
 * Public endpoint; service/repo enforces visibility rules.
 */
async function listBidsForRequest(req, res) {
  const correlationId = req.correlationId || null;
  try {
    const { page = 1, pageSize = 20, status } = req.query;
    const results = await bidRepo.listByRequest(req.params.request_id, {
      page: Number(page),
      pageSize: Number(pageSize),
      status
    });

    await auditService.logEvent({
      eventType: 'bid.list.success',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.request_id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, page: results.page, pageSize: results.pageSize }
    });

    return res.json(results);
  } catch (err) {
    await auditService.logEvent({
      eventType: 'bid.list.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: req.params.request_id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * PATCH /bids/:id
 */
async function updateBid(req, res) {
  const correlationId = req.correlationId || null;
  const { error, value } = updateBidSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'bid.update.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Bid', id: req.params.id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const updated = await bidService.updateBid(actor, req.params.id, value, correlationId);

    await auditService.logEvent({
      eventType: 'bid.update.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Bid', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(value || {}) }
    });

    return res.json({ bid: updated });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'bid.update.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Bid', id: req.params.id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

/**
 * DELETE /bids/:id
 * Hard-delete a draft bid. Service enforces draft-only and permission checks.
 */
async function deleteBid(req, res) {
  const correlationId = req.correlationId || null;
  try {
    const actor = req.user || {};
    const deleted = await bidService.deleteDraftBid(actor, req.params.id, correlationId);

    await auditService.logEvent({
      eventType: 'bid.delete.success',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Bid', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { deletedId: req.params.id }
    });

    return res.json({ bid: deleted });
  } catch (err) {
    await auditService.logEvent({
      eventType: 'bid.delete.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Bid', id: req.params.id },
      outcome: 'failure',
      severity: err.status && err.status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(err.status || 500).json({ message: err.message });
  }
}

module.exports = { createBid, listBidsForRequest, updateBid, deleteBid };
