// src/routes/services.routes.js
const express = require('express');
const router = express.Router();
const servicesController = require('../controllers/services.controller');
const verifyToken = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');

// Public list
router.get('/', servicesController.list);

// Provider-only create/update/delete
router.post('/', verifyToken, requireRole('provider','admin'), servicesController.create);
router.put('/:id', verifyToken, requireRole('provider','admin'), servicesController.update);
router.delete('/:id', verifyToken, requireRole('provider','admin'), servicesController.remove);

module.exports = router;
