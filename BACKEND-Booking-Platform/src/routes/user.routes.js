// src/routes/users.routes.js
const express = require('express');
const router = express.Router();
const usersCtrl = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

router.get('/:id', usersCtrl.getProfile);
router.patch('/:id', requireAuth, usersCtrl.updateProfile);
router.patch('/:id/role', requireAuth, requireRole('administrator'), usersCtrl.changeRole);

module.exports = router;
