/**
 * @module routes/bookings
 * @description Booking routes.
 */

const express = require('express');
const router = express.Router();
const {
  createBooking,
  getMyBookings,
  getBooking,
  updateBookingStatus,
  submitRating,
  getProviderReviews,
} = require('../controllers/bookings.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { bookingRules, ratingRules, validate } = require('../utils/validators');


router.get('/reviews/:providerId', getProviderReviews);


router.post('/', protect, authorize('customer'), bookingRules, validate, createBooking);
router.get('/', protect, getMyBookings);
router.get('/:id', protect, getBooking);
router.put('/:id/status', protect, updateBookingStatus);
router.post('/:id/rating', protect, authorize('customer'), ratingRules, validate, submitRating);


module.exports = router;
