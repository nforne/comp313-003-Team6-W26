/**
 * @module routes/services
 * @description Service request routes.
 */

const express = require('express');
const router = express.Router();
const {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
  submitBid,
  updateBid,
  getMyServices,
  getOpenRequests,
  selectBid,
  getProviderActiveRequests,
} = require('../controllers/services.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { serviceRules, bidRules, validate } = require('../utils/validators');

// Public routes
router.get('/', getServices);
router.get('/my/requests', protect, getMyServices);
router.get('/open/requests', protect, authorize('provider'), getOpenRequests);

// Provider active bookings (accepted bids)
router.get('/provider/active', protect, authorize('provider'), getProviderActiveRequests);

router.get('/:id', getService);

// Customer routes
router.post('/', protect, authorize('customer'), serviceRules, validate, createService);
router.put('/:id', protect, updateService);
router.delete('/:id', protect, deleteService);

// Customer selects a bid
router.put('/:id/select-bid/:bidId', protect, authorize('customer'), selectBid);

// Provider bid routes
router.post('/:id/bids', protect, authorize('provider'), bidRules, validate, submitBid);
router.put('/:id/bids/:bidId', protect, authorize('provider'), updateBid);

module.exports = router;
