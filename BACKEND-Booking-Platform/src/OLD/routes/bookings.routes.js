// src/routes/bookings.routes.js
const express = require('express');
const router = express.Router();
const bookingsController = require('../controllers/bookings.controller');
const verifyToken = require('../middleware/auth.middleware');

router.post('/', verifyToken, bookingsController.create);
router.get('/', verifyToken, bookingsController.listForUser);
router.get('/:id', verifyToken, bookingsController.getById);
router.patch('/:id/cancel', verifyToken, bookingsController.cancel);

module.exports = router;
