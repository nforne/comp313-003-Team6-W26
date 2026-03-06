// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);
router.post('/logout', requireAuth, authCtrl.logout);

module.exports = router;
