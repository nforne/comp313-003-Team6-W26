// src/routes/review.routes.js
//
// Mountable router for review endpoints.
// Pattern follows src/routes/requests.routes.js: controllers expose handler functions.
// Validation and auth middleware applied per-route.

const express = require('express');
const router = express.Router();

const reviewCtrl = require('../controllers/review.controller'); // controller exports an express.Router in previous iterations
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const {
  validateCreate,
  validateUpdate,
  validateList,
  validateIdParam,
  validateMessagesPagination
} = require('../validators/review.validator');

// Create review (authenticated users: seeker or provider may create a review if business rules allow)
router.post(
  '/',
  requireAuth,
  validateCreate,
  reviewCtrl.createReview
);

// Read review (public)
router.get(
  '/:id',
  validateIdParam,
  reviewCtrl.getReview
);

// List reviews for a reviewee or service (public)
// Query: ?reviewee_id=... | ?service_id=... & page & limit
router.get(
  '/',
  validateList,
  reviewCtrl.searchReviews
);

// List reviews for a booking (customer and provider reviews) - public
// GET /reviews/booking/:booking_id
router.get(
  '/booking/:booking_id',
  reviewCtrl.getReviewsByBooking
);

// Paginate messages for a review (public)
router.get(
  '/:id/messages',
  validateIdParam,
  validateMessagesPagination,
  reviewCtrl.getMessagesForReview
);

// Update review (owner or admin) - permission enforced in service/controller
router.patch(
  '/:id',
  requireAuth,
  validateIdParam,
  validateUpdate,
  reviewCtrl.updateReview
);

// Delete review (soft) - authenticated
router.delete(
  '/:id',
  requireAuth,
  validateIdParam,
  reviewCtrl.deleteReview
);

// Hard delete (admin only) - route-level RBAC can be applied here if desired
router.delete(
  '/:id/hard',
  requireAuth,
  requireRole('administrator'),
  validateIdParam,
  reviewCtrl.hardDeleteReview
);

module.exports = router;
