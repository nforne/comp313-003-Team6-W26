/**
 * src/validators/calendar.validator.js
 *
 * Joi-based validators and Express middleware for calendar endpoints.
 * - Exports reusable Joi schemas and a `validate(schema, source)` middleware factory.
 */

const Joi = require('joi');

// simple ObjectId-ish hex 24 validator (accepts string or hex)
const objectId = Joi.string().hex().length(24);

// common epoch ms validator
const epochMs = Joi.number().integer().min(0);

// Schemas

const availabilitySchema = Joi.object({
  ownerId: Joi.alternatives().try(objectId, Joi.string().allow(null)).required(),
  serviceId: Joi.alternatives().try(objectId, Joi.string().allow(null)).optional().allow(null),
  fromEpoch: epochMs.required(),
  toEpoch: epochMs.required(),
  capacityNeeded: Joi.number().integer().min(1).default(1),
  timezone: Joi.string().optional()
}).custom((value, helpers) => {
  if (value.fromEpoch >= value.toEpoch) return helpers.error('any.invalid', { message: 'fromEpoch must be < toEpoch' });
  return value;
}, 'range check');

const reserveSchema = Joi.object({
  ownerId: objectId.required(),
  serviceId: Joi.alternatives().try(objectId, Joi.string().allow(null)).optional().allow(null),
  bookingId: Joi.alternatives().try(objectId, Joi.string()).required(),
  fromEpoch: epochMs.required(),
  toEpoch: epochMs.required(),
  capacityUsed: Joi.number().integer().min(1).default(1),
  timezone: Joi.string().optional()
}).custom((value, helpers) => {
  if (value.fromEpoch >= value.toEpoch) return helpers.error('any.invalid', { message: 'fromEpoch must be < toEpoch' });
  return value;
}, 'range check');

const cleanupSchema = Joi.object({
  cutoffWeekStartEpoch: epochMs.required()
});

const schedulerSchema = Joi.object({
  action: Joi.string().valid('start', 'stop').required(),
  intervalMs: Joi.number().integer().min(1).optional(),
  initialDelayMs: Joi.number().integer().min(0).optional(),
  cutoffWeekStartEpoch: epochMs.optional()
});

const defaultQuerySchema = Joi.object({
  ownerId: Joi.alternatives().try(objectId, Joi.string().allow(null)).optional().allow(null),
  serviceId: Joi.alternatives().try(objectId, Joi.string().allow(null)).optional().allow(null),
  dateEpoch: epochMs.optional(),
  timezone: Joi.string().optional()
});

/* -------------------------
 * Middleware factory
 * ------------------------- */

/**
 * validate(schema, source)
 * - Returns Express middleware that validates req[source] against schema.
 * - source: 'body'|'query'|'params' (default 'body')
 * - On validation failure responds 400 with { ok:false, error: { code:'VALIDATION', message } }
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const payload = req[source] || {};
    const { error, value } = schema.validate(payload, { abortEarly: false, stripUnknown: true });
    if (error) {
      const message = error.details.map(d => d.message).join('; ');
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message } });
    }
    // attach validated value for downstream handlers
    req.validated = req.validated || {};
    req.validated[source] = value;
    return next();
  };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  // Joi schemas
  availabilitySchema,
  reserveSchema,
  cleanupSchema,
  schedulerSchema,
  defaultQuerySchema,
  // middleware
  validate
};
