// src/routes/services.routes.js
//
// Express router for Service endpoints.
// - Mount at e.g. `app.use('/svcs', require('./routes/services.routes'))`
// - Public endpoints: search and read
// - Protected endpoints: create, update, delete
// - Controller enforces domain-level authorization (ownership/admin); route-level middleware provides quick short-circuits.
//
// Middleware expectations:
// - requireAuth should populate `req.user = { userId, role }`
// - requireRole(role) should short-circuit requests when the actor lacks the required role
// - Consider adding request validation and rate-limiting middleware at the route level for production

const express = require('express');
const router = express.Router();

const svcCtrl = require('../controllers/service.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

/**
 * Public
 */

// GET /svcs
// - Query params validated in controller (searchSchema).
// - Returns paginated search results.
router.get('/', svcCtrl.searchServices);

// GET /svcs/:id
// - Returns a single service by serviceId.
router.get('/:id', svcCtrl.getService);

/**
 * Protected
 */

// POST /svcs
// - Only authenticated users with role 'service_provider' may create services.
// - Controller also enforces that providerId in payload matches authenticated user unless admin.
router.post('/', requireAuth, requireRole('service_provider'), svcCtrl.createService);

// PATCH /svcs/:id
// - Requires authentication. Ownership checks are enforced in the service layer.
// - Consider adding a validator middleware to validate update payload before controller.
router.patch('/:id', requireAuth, svcCtrl.updateService);

// DELETE /svcs/:id
// - Requires authentication. Ownership/admin checks enforced in service layer.
router.delete('/:id', requireAuth, svcCtrl.deleteService);

module.exports = router;
