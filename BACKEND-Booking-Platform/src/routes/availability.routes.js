// src/routes/availability.routes.js
const express = require('express');
const router = express.Router();
const availabilityController = require('../controllers/availability.controller');
const verifyToken = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');

router.get('/:serviceId', availabilityController.getForService);
router.post('/:serviceId', verifyToken, requireRole('provider','admin'), availabilityController.createOrUpdate);

module.exports = router;
