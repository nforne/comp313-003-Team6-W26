// src/routes/requests.routes.js
const express = require('express');
const router = express.Router();
const reqCtrl = require('../controllers/request.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

// Create request (customer only)
router.post('/', requireAuth, requireRole('service_seeker'), reqCtrl.createRequest);

// Read request (public read with private visibility enforced in service)
router.get('/:id', reqCtrl.getRequest);

// Search open requests (public; provider sees allowed private ones)
router.get('/', reqCtrl.searchRequests);

// Update request (owner or admin)
router.patch('/:id', requireAuth, reqCtrl.updateRequest);

module.exports = router;
