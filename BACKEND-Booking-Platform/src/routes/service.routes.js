// src/routes/services.routes.js
const express = require('express');
const router = express.Router();
const svcCtrl = require('../controllers/service.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

// Public search and read
router.get('/', svcCtrl.searchServices);
router.get('/:id', svcCtrl.getService);

// Protected create/update/delete
router.post('/', requireAuth, requireRole('service_provider'), svcCtrl.createService);
router.patch('/:id', requireAuth, svcCtrl.updateService); // service ownership enforced in service layer
router.delete('/:id', requireAuth, svcCtrl.deleteService);

module.exports = router;
