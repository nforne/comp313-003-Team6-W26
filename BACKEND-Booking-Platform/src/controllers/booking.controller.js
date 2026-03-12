// src/controllers/booking.controller.js
/**
 * Booking controller 
 *
 * - PATCH /bkns/:id is restricted to administrators only.
 * - Other handlers unchanged.
 */

const bookingService = require('../services/booking.service');
const auditService = require('../services/audit.service');
const bookingRepo = require('../repositories/booking.repo');
const {
  bookingCreateSchema,
  bookingCancelSchema,
  bookingUpdateSchema
} = require('../validators/booking.validator');

function getCorrelationId(req) {
  return req.correlationId || null;
}

/* POST /bkns/confirm */
async function confirmBooking(req, res) {
  const correlationId = getCorrelationId(req);
  const { error, value } = bookingCreateSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'booking.create.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: value && value.requestId || null },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const booking = await bookingService.createBookingTransactional(actor, value, correlationId);

    await auditService.logEvent({
      eventType: 'booking.create.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Booking', id: booking && booking._id ? booking._id.toString() : null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { requestId: value.requestId, providerId: value.providerId }
    });

    return res.status(201).json({ booking });
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.create.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Request', id: value && value.requestId || null },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* POST /bkns/:id/cancel */
async function cancelBooking(req, res) {
  const correlationId = getCorrelationId(req);
  const { error, value } = bookingCancelSchema.validate(req.body || {});
  if (error) {
    await auditService.logEvent({
      eventType: 'booking.cancel.failed.validation',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const actor = req.user || {};
    const updated = await bookingService.cancelBooking(actor, req.params.id, value.reason || '', correlationId);

    await auditService.logEvent({
      eventType: 'booking.cancel.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { reason: value.reason || '' }
    });

    return res.json({ booking: updated });
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.cancel.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* PATCH /bkns/:id
   Admin-only: reject non-admin requests immediately.
*/
async function updateBooking(req, res) {
  const correlationId = getCorrelationId(req);

  // Enforce admin-only
  const actor = req.user || {};
  if (!actor || actor.role !== 'administrator') {
    await auditService.logEvent({
      eventType: 'booking.update.forbidden',
      actor: { userId: actor && actor.userId || null, role: actor && actor.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { reason: 'admin_only' }
    });
    return res.status(403).json({ message: 'Only administrators may update bookings' });
  }

  const { error, value } = bookingUpdateSchema.validate(req.body);
  if (error) {
    await auditService.logEvent({
      eventType: 'booking.update.failed.validation',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: 'warning',
      correlationId,
      details: { validation: error.message }
    });
    return res.status(400).json({ message: error.message });
  }

  try {
    const updated = await bookingService.updateBooking(actor, req.params.id, value, correlationId);

    await auditService.logEvent({
      eventType: 'booking.update.success',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { updatedFields: Object.keys(value || {}) }
    });

    return res.json({ booking: updated });
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.update.failed',
      actor: { userId: actor.userId || null, role: actor.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* GET /bkns/:id */
async function getBooking(req, res) {
  const correlationId = getCorrelationId(req);
  try {
    const booking = await bookingRepo.findById(req.params.id);
    if (!booking) {
      await auditService.logEvent({
        eventType: 'booking.get.failed.not_found',
        actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
        target: { type: 'Booking', id: req.params.id },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: {}
      });
      return res.status(404).json({ message: 'Booking not found' });
    }

    await auditService.logEvent({
      eventType: 'booking.get.success',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: {}
    });

    return res.json({ booking });
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.get.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Booking', id: req.params.id },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* GET /bkns/provider/:providerId */
async function listBookingsForProvider(req, res) {
  const correlationId = getCorrelationId(req);
  try {
    const providerId = req.params.providerId || (req.user && req.user.userId);
    const { page = 1, pageSize = 20, status } = req.query;

    const results = await bookingRepo.listByProvider(providerId, {
      page: Number(page),
      pageSize: Number(pageSize),
      status
    });

    await auditService.logEvent({
      eventType: 'booking.list.provider',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Provider', id: providerId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, page: results.page, pageSize: results.pageSize }
    });

    return res.json(results);
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.list.provider.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Provider', id: req.params.providerId || null },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* GET /bkns/seeker/:seekerId */
async function listBookingsForSeeker(req, res) {
  const correlationId = getCorrelationId(req);
  try {
    const seekerId = req.params.seekerId || (req.user && req.user.userId);
    const { page = 1, pageSize = 20, status } = req.query;

    const results = await bookingRepo.listBySeeker(seekerId, {
      page: Number(page),
      pageSize: Number(pageSize),
      status
    });

    await auditService.logEvent({
      eventType: 'booking.list.seeker',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Seeker', id: seekerId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, page: results.page, pageSize: results.pageSize }
    });

    return res.json(results);
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.list.seeker.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Seeker', id: req.params.seekerId || null },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

/* GET /bkns/service/:serviceId */
async function listBookingsForService(req, res) {
  const correlationId = getCorrelationId(req);
  try {
    const serviceId = req.params.serviceId;
    const { page = 1, pageSize = 20, status } = req.query;

    const results = await bookingRepo.listByService(serviceId, {
      page: Number(page),
      pageSize: Number(pageSize),
      status
    });

    await auditService.logEvent({
      eventType: 'booking.list.service',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: serviceId },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { returned: results.results.length, page: results.page, pageSize: results.pageSize }
    });

    return res.json(results);
  } catch (err) {
    const status = err.status || 500;
    await auditService.logEvent({
      eventType: 'booking.list.service.failed',
      actor: { userId: req.user && req.user.userId || null, role: req.user && req.user.role || null },
      target: { type: 'Service', id: req.params.serviceId || null },
      outcome: 'failure',
      severity: status >= 500 ? 'error' : 'warning',
      correlationId,
      details: { message: err.message }
    });
    return res.status(status).json({ message: err.message });
  }
}

module.exports = {
  confirmBooking,
  cancelBooking,
  updateBooking,
  getBooking,
  listBookingsForProvider,
  listBookingsForSeeker,
  listBookingsForService
};
