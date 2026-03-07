// src/routes/message.routes.js
//
// Route wiring for message endpoints.
// - Applies route-level validation and auth/rbac middleware.
// - Delegates to src/controllers/message.controller.js for handling.

const express = require('express');
const controller = require('../controllers/message.controller');
const { createMessageSchema, updateMessageSchema, listQuerySchema, idParamSchema, metadataQuerySchema } = require('../validators/message.validator');
const validate = require('../middleware/validate.middleware'); // validate(schema, source)
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

const router = express.Router();

/**
 * Public / authenticated message endpoints
 * - Most endpoints require authentication; some admin-only routes use requireRole('administrator').
 */

/* List messages for current user (or filtered by query for admins) */
router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  controller
);

/* Get single message */
router.get(
  '/:id',
  requireAuth,
  validate(idParamSchema, 'params'),
  controller
);

/* Create a draft message (persisted as draft). Auth required. */
router.post(
  '/',
  requireAuth,
  validate(createMessageSchema, 'body'),
  controller
);

/* Submit a draft (author or admin) */
router.post(
  '/:id/submit',
  requireAuth,
  validate(idParamSchema, 'params'),
  controller
);

/* Update message (author or admin) */
router.patch(
  '/:id',
  requireAuth,
  validate(idParamSchema, 'params'),
  validate(updateMessageSchema, 'body'),
  controller
);

/* Soft delete (author or admin) */
router.delete(
  '/:id',
  requireAuth,
  validate(idParamSchema, 'params'),
  controller
);

/* Hard delete (admin only) */
router.delete(
  '/:id/hard',
  requireAuth,
  requireRole('administrator'),
  validate(idParamSchema, 'params'),
  controller
);

/* List by type (admins can list all; non-admins get filtered results) */
router.get(
  '/type/:type',
  requireAuth,
  validate(listQuerySchema, 'query'),
  controller
);

/* List by metadata key/value (bookingId, reviewId, bidId, etc.) */
router.get(
  '/metadata',
  requireAuth,
  validate(metadataQuerySchema, 'query'),
  controller
);

/* Issue wall thread listing */
router.get(
  '/thread/issue_wall',
  requireAuth,
  validate(listQuerySchema, 'query'),
  controller
);

module.exports = router;
