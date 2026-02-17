// src/routes/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const verifyToken = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');

router.get('/stats', verifyToken, requireRole('admin'), adminController.stats);

module.exports = router;
