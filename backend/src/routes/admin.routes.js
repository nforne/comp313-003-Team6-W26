/**
 * @module routes/admin
 * @description Admin routes.
 */

const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getUsers,
  updateUser,
  deleteUser,
  getAllBookings,
  getReviews,
  moderateReview,
  deleteReview,
  getProviders,
} = require('../controllers/admin.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// All admin routes require authentication and admin role
router.use(protect, authorize('admin'));

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/bookings', getAllBookings);
router.get('/reviews', getReviews);
router.put('/reviews/:id', moderateReview);
router.delete('/reviews/:id', deleteReview);
router.get('/providers', getProviders);

module.exports = router;
