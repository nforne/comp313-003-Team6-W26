// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Minimal routes so app mounts without errors
router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
