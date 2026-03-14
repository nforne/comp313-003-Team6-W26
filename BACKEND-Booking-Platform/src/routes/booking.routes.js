// src/routes/bookings.routes.js
/**
 * Booking routes
 *
 * Routes:
 * - POST   /bkns/confirm             -> confirmBooking (auth required)
 * - POST   /bkns/:id/cancel          -> cancelBooking (auth required)
 * - PATCH  /bkns/:id                 -> updateBooking (admin only)
 * - GET    /bkns/:id                 -> getBooking (optional auth)
 * - GET    /bkns/provider/:providerId? -> listBookingsForProvider (optional auth)
 * - GET    /bkns/seeker/:seekerId?     -> listBookingsForSeeker (optional auth)
 * - GET    /bkns/service/:serviceId?   -> listBookingsForService (optional auth)
 */

const express = require('express');
const router = express.Router();
const bookingCtrl = require('../controllers/booking.controller');
const auth = require('../middleware/auth.middleware'); // { requireAuth, optionalAuth }
const rbac = require('../middleware/rbac.middleware'); // { requireRole }

/* Create booking (confirm) */
router.post('/confirm', auth.requireAuth, bookingCtrl.confirmBooking);

/* Cancel booking (seeker/provider/admin) */
router.post('/:id/cancel', auth.requireAuth, bookingCtrl.cancelBooking);

/* Update booking - admin only */
router.patch('/:id', auth.requireAuth, rbac.requireRole('administrator'), bookingCtrl.updateBooking);

/* Get booking (public read allowed; optional auth for richer context) */
router.get('/:id', auth.requireAuth, bookingCtrl.getBooking);

/* List bookings for seeker (seekerId optional; defaults to authenticated user) */
router.get('/seeker', auth.requireAuth, bookingCtrl.listBookingsForSeeker);
router.get('/seeker/:seekerId', auth.requireAuth, bookingCtrl.listBookingsForSeeker);

/* List bookings for provider (providerId optional; defaults to authenticated user) */
router.get('/provider', auth.requireAuth, bookingCtrl.listBookingsForProvider);
router.get('/provider/:providerId', auth.requireAuth, bookingCtrl.listBookingsForProvider);

/* List bookings for service (serviceId optional; caller may pass serviceId) */
router.get('/service', auth.requireAuth, bookingCtrl.listBookingsForService);
router.get('/service/:serviceId', auth.requireAuth, bookingCtrl.listBookingsForService);

module.exports = router;
