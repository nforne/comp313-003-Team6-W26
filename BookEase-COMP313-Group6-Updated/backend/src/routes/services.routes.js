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
} = require('../controllers/services.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { serviceRules, bidRules, validate } = require('../utils/validators');

router.get('/', getServices);
router.get('/my/requests', protect, getMyServices);
router.get('/open/requests', protect, authorize('provider'), getOpenRequests);
router.get('/:id', getService);


router.post('/', protect, authorize('customer'), serviceRules, validate, createService);
router.put('/:id', protect, updateService);
router.delete('/:id', protect, deleteService);

router.post('/:id/bids', protect, authorize('provider'), bidRules, validate, submitBid);
router.put('/:id/bids/:bidId', protect, authorize('provider'), updateBid);

module.exports = router;
