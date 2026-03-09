// src/routes/s3Storage.routes.js
//
// Mounts the s3Storage controller router.
// The controller already defines individual routes and applies requireAuth where needed.
// This file keeps a single place to attach any top-level middleware (rate limiting, path prefix).

const express = require('express');
const router = express.Router();

// Controller exports an Express router (see src/controllers/s3Storage.controller.js)
const storageController = require('../controllers/s3Storage.controller');

// Optional top-level middleware (replace with your implementations)
const rateLimit = require('../middleware/rateLimit.middleware') || ((key) => (req, res, next) => next());
// If you want to apply a global auth guard for all storage routes, requireAuth can be used here.
// const { requireAuth } = require('../middleware/auth.middleware');

// Example: apply rate limiting to all storage routes (adjust key/strategy as needed)
router.use(rateLimit('storage:global'));

// Mount controller router at root of this router.
// If your app mounts this file at '/storage', controller routes will be available at that path.
// e.g., app.use('/storage', require('./routes/s3Storage.routes'));
router.use('/', storageController);

module.exports = router;
