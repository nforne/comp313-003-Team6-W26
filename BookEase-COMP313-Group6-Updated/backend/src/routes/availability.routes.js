/**
 * @module routes/availability
 * @description Provider availability routes.
 */

const express = require('express');
const router = express.Router();
const {
  getMyAvailability,
  getProviderAvailability,
  setAvailability,
  setBulkAvailability,
  blockDate,
  unblockDate,
} = require('../controllers/availability.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

router.get('/provider/:id', getProviderAvailability);


router.get('/', protect, authorize('provider'), getMyAvailability);
router.put('/', protect, authorize('provider'), setAvailability);
router.put('/bulk', protect, authorize('provider'), setBulkAvailability);
router.post('/block', protect, authorize('provider'), blockDate);
router.delete('/block/:id', protect, authorize('provider'), unblockDate);

module.exports = router;
