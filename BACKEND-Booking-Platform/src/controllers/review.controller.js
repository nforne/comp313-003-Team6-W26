// src/controllers/review.controller.js
//
// Express controller for Reviews.
// - Uses ReviewService to create/read/list/update/soft-delete/hard-delete reviews.
// - Exposes endpoints: POST /reviews, GET /reviews/:id, GET /reviews?reviewee_id=...|service_id=..., GET /reviews/:id/messages
// - Expects authentication middleware to set req.user { userId, role } for protected actions.
// - Returns normalized JSON DTOs and consistent error responses.

const express = require('express');
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ReviewService = require('../services/review.service');

const router = express.Router();

/**
 * POST /reviews
 * Body: { reviewee_id, review_points, booking_id?, message, message_subject?, attachments?, idempotencyKey?, metadata? }
 * Auth required.
 */
router.post('/', asyncHandler(async (req, res) => {
  const logger = req.app.get('logger') || console;
  const userId = req.user && req.user.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'unauthenticated' });

  const payload = {
    userId,
    revieweeId: req.body.reviewee_id,
    reviewPoints: req.body.review_points,
    bookingId: req.body.booking_id || null,
    messageText: req.body.message,
    messageSubject: req.body.message_subject,
    attachments: req.body.attachments,
    idempotencyKey: req.body.idempotencyKey || req.get('Idempotency-Key') || null,
    metadata: req.body.metadata || {}
  };

  const opts = {
    actor: req.user,
    logger,
    messageStatus: 'submitted',
    failOnDuplicate: false
  };

  try {
    const created = await ReviewService.createReview(payload, opts);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    // Map common business errors to HTTP responses
    if (err.message === 'review_already_exists_for_booking') {
      return res.status(409).json({ ok: false, error: 'review_already_exists_for_booking' });
    }
    if (err.message === 'invalid_booking') {
      return res.status(400).json({ ok: false, error: 'invalid_booking' });
    }
    if (err.message === 'not_allowed_to_review_booking') {
      return res.status(403).json({ ok: false, error: 'not_allowed_to_review_booking' });
    }
    if (err.message === 'duplicate request') {
      return res.status(409).json({ ok: false, error: 'duplicate_request' });
    }
    // fallback
    logger.error && logger.error({ event: 'review.create.failed', error: err && err.message ? err.message : String(err) });
    return res.status(500).json({ ok: false, error: err.message || 'internal_error' });
  }
}));

/**
 * GET /reviews/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const review = await ReviewService.getReview(id);
  if (!review) return res.status(404).json({ ok: false, error: 'not_found' });
  return res.json({ ok: true, data: review });
}));

/**
 * GET /reviews
 * Query: ?reviewee_id=... | ?service_id=... & page & limit
 * At least one of reviewee_id or service_id is required.
 */
router.get('/', asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const includeHidden = req.query.include_hidden === 'true';

  // support service_id (convenience) or reviewee_id
  const serviceId = req.query.service_id;
  const revieweeId = req.query.reviewee_id;

  if (!serviceId && !revieweeId) {
    return res.status(400).json({ ok: false, error: 'service_id or reviewee_id required' });
  }

  // If service_id provided, treat it as revieweeId for listing
  const targetId = serviceId || revieweeId;

  const result = await ReviewService.listReviewsForReviewee(targetId, { page, limit, includeHidden });
  return res.json({ ok: true, data: result });
}));

/**
 * GET /reviews/:id/messages
 * Paginate messages for a review: ?page=1&limit=10
 */
router.get('/:id/messages', asyncHandler(async (req, res) => {
  const reviewId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;

  const messages = await ReviewService.loadMessages(reviewId, page, limit);
  return res.json({ ok: true, data: messages });
}));

/**
 * GET /reviews/booking/:booking_id
 * Convenience endpoint to list reviews for a booking (customer and provider reviews).
 * Query: ?page=1&limit=20
 */
router.get('/booking/:booking_id', asyncHandler(async (req, res) => {
  const bookingId = req.params.booking_id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const includeHidden = req.query.include_hidden === 'true';

  const result = await ReviewService.listReviewsForBooking(bookingId, { page, limit, includeHidden });
  return res.json({ ok: true, data: result });
}));

/**
 * PATCH /reviews/:id
 * Body: { review_points?, metadata?, message_update?: { details, subject, attachments, status } }
 * Auth required (owner or admin). Permission enforcement should be done in service layer.
 */
router.patch('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const updates = {
    reviewPoints: typeof req.body.review_points !== 'undefined' ? req.body.review_points : undefined,
    metadata: typeof req.body.metadata !== 'undefined' ? req.body.metadata : undefined,
    messageUpdate: req.body.message_update
  };
  try {
    const updated = await ReviewService.updateReview(id, updates, { actor: req.user, logger: req.app.get('logger') });
    if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    // permission or other business errors can be mapped here if needed
    return res.status(500).json({ ok: false, error: err.message || 'internal_error' });
  }
}));

/**
 * DELETE /reviews/:id
 * Soft-deletes by default. Query: ?alsoDeleteMessage=true
 * Auth required.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const alsoDeleteMessage = req.query.alsoDeleteMessage === 'true';
  try {
    const result = await ReviewService.softDeleteReview(id, { actor: req.user, alsoDeleteMessage, logger: req.app.get('logger') });
    if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'internal_error' });
  }
}));

/**
 * DELETE /reviews/:id/hard
 * Hard delete (admin only). Caller must be admin.
 */
router.delete('/:id/hard', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: 'unauthenticated' });
  // enforce admin role here (routes may also protect this)
  const role = user.role || (user.roles && user.roles[0]) || null;
  if (role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });

  try {
    const result = await ReviewService.hardDeleteReview(id, { actor: req.user, alsoDeleteMessage: true, logger: req.app.get('logger') });
    if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'internal_error' });
  }
}));

module.exports = router;
