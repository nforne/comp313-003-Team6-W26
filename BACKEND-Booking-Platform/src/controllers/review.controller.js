// src/controllers/review.controller.js
//
// Express controller for Reviews.
// - Uses ReviewService to create/read/list/update/soft-delete/hard-delete reviews.
// - Exposes endpoints: POST /reviews, GET /reviews/:id, GET /reviews?reviewee_id=...|service_id=..., GET /reviews/:id/messages
// - Expects authentication middleware to set req.user { userId, role } for protected actions.
// - Returns normalized JSON DTOs and consistent error responses.

const ReviewService = require('../services/review.service');

/**
 * Helper: wrap async handlers to forward errors to Express error middleware.
 * @param {Function} fn async function (req, res, next)
 * @returns {Function} express handler
 */
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * POST /reviews
 * Body: { reviewee_id, review_points, booking_id?, message, message_subject?, attachments?, idempotencyKey?, metadata? }
 * Auth required.
 */
const createReview = asyncHandler(async (req, res) => {
  const logger = req.app && req.app.get('logger') ? req.app.get('logger') : console;
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
    const msg = err && err.message ? err.message : '';
    if (msg === 'review_already_exists_for_booking') {
      return res.status(409).json({ ok: false, error: 'review_already_exists_for_booking' });
    }
    if (msg === 'invalid_booking') {
      return res.status(400).json({ ok: false, error: 'invalid_booking' });
    }
    if (msg === 'not_allowed_to_review_booking') {
      return res.status(403).json({ ok: false, error: 'not_allowed_to_review_booking' });
    }
    if (msg === 'duplicate request') {
      return res.status(409).json({ ok: false, error: 'duplicate_request' });
    }

    logger.error && logger.error({ event: 'review.create.failed', error: msg || String(err) });
    return res.status(500).json({ ok: false, error: msg || 'internal_error' });
  }
});

/**
 * GET /reviews/:id
 */
const getReview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const review = await ReviewService.getReview(id);
  if (!review) return res.status(404).json({ ok: false, error: 'not_found' });
  return res.json({ ok: true, data: review });
});

/**
 * GET /reviews
 * Query: ?reviewee_id=... | ?service_id=... & page & limit
 * At least one of reviewee_id or service_id is required.
 */
const searchReviews = asyncHandler(async (req, res) => {
  const page = Number.parseInt(req.query.page, 10) || 1;
  const limit = Number.parseInt(req.query.limit, 10) || 20;
  const includeHidden = String(req.query.include_hidden) === 'true';

  const serviceId = req.query.service_id;
  const revieweeId = req.query.reviewee_id;

  if (!serviceId && !revieweeId) {
    return res.status(400).json({ ok: false, error: 'service_id or reviewee_id required' });
  }

  const targetId = serviceId || revieweeId;

  const result = await ReviewService.listReviewsForReviewee(targetId, { page, limit, includeHidden });
  return res.json({ ok: true, data: result });
});

/**
 * GET /reviews/:id/messages
 * Paginate messages for a review: ?page=1&limit=10
 */
const getMessagesForReview = asyncHandler(async (req, res) => {
  const reviewId = req.params.id;
  const page = Number.parseInt(req.query.page, 10) || 1;
  const limit = Number.parseInt(req.query.limit, 10) || 10;

  const messages = await ReviewService.loadMessages(reviewId, page, limit);
  return res.json({ ok: true, data: messages });
});

/**
 * GET /reviews/booking/:booking_id
 * Convenience endpoint to list reviews for a booking (customer and provider reviews).
 * Query: ?page=1&limit=20
 */
const getReviewsByBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.booking_id;
  const page = Number.parseInt(req.query.page, 10) || 1;
  const limit = Number.parseInt(req.query.limit, 10) || 20;
  const includeHidden = String(req.query.include_hidden) === 'true';

  const result = await ReviewService.listReviewsForBooking(bookingId, { page, limit, includeHidden });
  return res.json({ ok: true, data: result });
});

/**
 * PATCH /reviews/:id
 * Body: { review_points?, metadata?, message_update?: { details, subject, attachments, status } }
 * Auth required (owner or admin). Permission enforcement should be done in service layer.
 */
const updateReview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const updates = {
    reviewPoints: typeof req.body.review_points !== 'undefined' ? req.body.review_points : undefined,
    metadata: typeof req.body.metadata !== 'undefined' ? req.body.metadata : undefined,
    messageUpdate: req.body.message_update
  };

  try {
    const updated = await ReviewService.updateReview(id, updates, { actor: req.user, logger: req.app && req.app.get('logger') });
    if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err && err.message ? err.message : 'internal_error';
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * DELETE /reviews/:id
 * Soft-deletes by default. Query: ?alsoDeleteMessage=true
 * Auth required.
 */
const deleteReview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const alsoDeleteMessage = String(req.query.alsoDeleteMessage) === 'true';
  try {
    const result = await ReviewService.softDeleteReview(id, { actor: req.user, alsoDeleteMessage, logger: req.app && req.app.get('logger') });
    if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: result });
  } catch (err) {
    const msg = err && err.message ? err.message : 'internal_error';
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * DELETE /reviews/:id/hard
 * Hard delete (admin only). Caller must be admin.
 */
const hardDeleteReview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: 'unauthenticated' });

  const role = user.role || (user.roles && user.roles[0]) || null;
  if (role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });

  try {
    const result = await ReviewService.hardDeleteReview(id, { actor: req.user, alsoDeleteMessage: true, logger: req.app && req.app.get('logger') });
    if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, data: result });
  } catch (err) {
    const msg = err && err.message ? err.message : 'internal_error';
    return res.status(500).json({ ok: false, error: msg });
  }
});

module.exports = {
  createReview,
  getReview,
  searchReviews,
  getMessagesForReview,
  getReviewsByBooking,
  updateReview,
  deleteReview,
  hardDeleteReview
};
