// src/routes/users.routes.js
//
// Express router for user-facing endpoints.
// - Mount this router at a path such as `/users` in your main app: `app.use('/users', require('./routes/users.routes'))`.
// - Controller implements domain logic and auditing; this routes file wires auth and RBAC middleware.
// - Endpoints:
//    GET    /:id           -> public profile (no auth required)
//    PATCH  /:id           -> update profile (requires auth; self or admin)
//    PATCH  /:id/role      -> change role (requires auth; admin-only at controller level)
//
// Notes:
// - `requireAuth` should populate `req.user` with `{ userId, role }`.
// - `requireRole('administrator')` is an optional short-circuit; the controller also enforces domain rules and logs events.
// - Keep validation and rate-limiting at middleware layer where appropriate.

const express = require('express');
const router = express.Router();

const usersCtrl = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

// Public: fetch a user's public profile
// Example: GET /users/1234567890123456
router.get('/:id', usersCtrl.getProfile);

// Authenticated: update profile
// - Only the user themself or an administrator may update.
// - Validation is performed in the controller using validators.
router.patch('/:id', requireAuth, usersCtrl.updateProfile);

// Admin-only route at the route level (controller also enforces rules).
// - This route is intended for administrators to change roles.
// - Non-admins attempting to call this will be rejected by requireRole middleware.
router.patch('/:id/role', requireAuth, requireRole('administrator'), usersCtrl.changeRole);

module.exports = router;
