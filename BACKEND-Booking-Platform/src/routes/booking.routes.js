// src/routes/bookings.routes.js
/**
 * Booking routes
 *
 * Routes:
 * - POST   /bkns/confirm           -> confirmBooking (auth required)
 * - POST   /bkns/:id/cancel        -> cancelBooking (auth required)
 * - PATCH  /bkns/:id               -> updateBooking (admin only)
 * - GET    /bkns/:id               -> getBooking (optional auth)
 * - GET    /bkns/provider/:providerId? -> listBookingsForProvider (optional auth)
 * - GET    /bkns/seeker/:seekerId?     -> listBookingsForSeeker (optional auth)
 */

const express = require('express');
const router = express.Router();
const bookingCtrl = require('../controllers/booking.controller');
const auth = require('../middleware/auth'); // { requireAuth, optionalAuth }
const rbac = require('../middleware/rbac'); // { requireRole }

/* Create booking (confirm) */
router.post('/bkns/confirm', auth.requireAuth, bookingCtrl.confirmBooking);

/* Cancel booking (seeker/provider/admin) */
router.post('/bkns/:id/cancel', auth.requireAuth, bookingCtrl.cancelBooking);

/* Update booking - admin only */
router.patch('/bkns/:id', auth.requireAuth, rbac.requireRole('administrator'), bookingCtrl.updateBooking);

/* Get booking (public read allowed; optional auth for richer context) */
router.get('/bkns/:id', auth.optionalAuth, bookingCtrl.getBooking);

/* List bookings for provider (providerId optional; defaults to authenticated user) */
router.get('/bkns/provider/:providerId?', auth.optionalAuth, bookingCtrl.listBookingsForProvider);

/* List bookings for seeker (seekerId optional; defaults to authenticated user) */
router.get('/bkns/seeker/:seekerId?', auth.optionalAuth, bookingCtrl.listBookingsForSeeker);

module.exports = router;
