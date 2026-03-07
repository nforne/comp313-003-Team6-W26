/**
 * src/routes/calendar.routes.js
 *
 * Mountable router for calendar endpoints.
 * - Applies auth / rbac middleware where appropriate and request validation.
 * - Exports the Express router (no register helper; app mounts it directly).
 *
 * Middleware used:
 *  - requireAuth(req, res, next)
 *  - requireRole(role)  // returns middleware
 *  - validate(schema, source) from src/validators/calendar.validator.js
 *
 * Route policy:
 *  - Public:  GET  /service/:serviceId/latest
 *             GET  /user/:ownerId/latest
 *             GET  /default
 *             POST /availability
 *  - Auth required: POST /reserve
 *  - Admin required: POST /cleanup, POST /cleanup/scheduler
 *
 * Note: this file wires validation middleware at the route level. The controller
 * is expected to read validated payload from req.validated (set by validate()) or
 * fall back to req.body / req.query when necessary.
 */

const express = require('express');
const calendarController = require('../controllers/calendar.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const {
  validate,
  availabilitySchema,
  reserveSchema,
  cleanupSchema,
  schedulerSchema,
  defaultQuerySchema
} = require('../validators/calendar.validator');

const router = express.Router();

/* -------------------------
 * Public routes
 * ------------------------- */

/**
 * GET /calendar/service/:serviceId/latest
 * Optional query: dateEpoch, timezone
 */
router.get(
  '/service/:serviceId/latest',
  validate(defaultQuerySchema, 'query'),
  (req, res, next) => {
    // make validated query available to controller in a familiar place
    if (req.validated && req.validated.query) req.query = Object.assign({}, req.query, req.validated.query);
    return next();
  },
  calendarController
);

/**
 * GET /calendar/user/:ownerId/latest
 * Optional query: dateEpoch, timezone
 */
router.get(
  '/user/:ownerId/latest',
  validate(defaultQuerySchema, 'query'),
  (req, res, next) => {
    if (req.validated && req.validated.query) req.query = Object.assign({}, req.query, req.validated.query);
    return next();
  },
  calendarController
);

/**
 * GET /calendar/default
 * Query: ownerId?, serviceId?, dateEpoch?, timezone?
 */
router.get(
  '/default',
  validate(defaultQuerySchema, 'query'),
  (req, res, next) => {
    if (req.validated && req.validated.query) req.query = Object.assign({}, req.query, req.validated.query);
    return next();
  },
  calendarController
);

/**
 * POST /calendar/availability
 * Body: { ownerId, serviceId?, fromEpoch, toEpoch, capacityNeeded?, timezone? }
 */
router.post(
  '/availability',
  validate(availabilitySchema, 'body'),
  (req, res, next) => {
    if (req.validated && req.validated.body) req.body = Object.assign({}, req.body, req.validated.body);
    return next();
  },
  calendarController
);

/* -------------------------
 * Authenticated routes
 * ------------------------- */

/**
 * POST /calendar/reserve
 * Requires authentication.
 * Body validated by reserveSchema.
 */
router.post(
  '/reserve',
  requireAuth,
  validate(reserveSchema, 'body'),
  (req, res, next) => {
    if (req.validated && req.validated.body) req.body = Object.assign({}, req.body, req.validated.body);
    return next();
  },
  calendarController
);

/* -------------------------
 * Admin routes
 * ------------------------- */

/**
 * POST /calendar/cleanup
 * Admin-only; body validated by cleanupSchema.
 */
router.post(
  '/cleanup',
  requireAuth,
  requireRole('administrator'),
  validate(cleanupSchema, 'body'),
  (req, res, next) => {
    if (req.validated && req.validated.body) req.body = Object.assign({}, req.body, req.validated.body);
    return next();
  },
  calendarController
);

/**
 * POST /calendar/cleanup/scheduler
 * Admin-only; body validated by schedulerSchema.
 */
router.post(
  '/cleanup/scheduler',
  requireAuth,
  requireRole('administrator'),
  validate(schedulerSchema, 'body'),
  (req, res, next) => {
    if (req.validated && req.validated.body) req.body = Object.assign({}, req.body, req.validated.body);
    return next();
  },
  calendarController
);

/* -------------------------
 * Delegate remaining routes to controller router
 *
 * The controller module exports an Express router that handles the actual
 * route implementations. We mount it last so the route-specific middleware
 * above runs first for the matching paths.
 * ------------------------- */

router.use('/', requireAuth, calendarController);

module.exports = router;
