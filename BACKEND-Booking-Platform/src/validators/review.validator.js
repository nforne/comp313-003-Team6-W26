// src/validators/review.validator.js
//
// Validation middleware for Review endpoints.
// - Uses Joi for schema validation and returns consistent error responses.
// - Exports: validateCreate, validateUpdate, validateList, validateIdParam, validateMessagesPagination.
// - Attach to routes as middleware before controller handlers.

const Joi = require('joi');

/* -------------------------
 * Schemas
 * ------------------------- */

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('must be a valid ObjectId');

const createSchema = Joi.object({
  reviewee_id: objectId.required(),
  review_points: Joi.number().integer().min(1).max(5).required(),
  message: Joi.string().max(5000).allow('', null),
  message_subject: Joi.string().max(255).allow('', null),
  attachments: Joi.array().items(
    Joi.object({
      filename: Joi.string().max(255).required(),
      mimeType: Joi.string().max(255).allow('', null),
      size: Joi.number().min(0).optional(),
      storageRef: Joi.string().max(1024).optional()
    })
  ).optional(),
  idempotencyKey: Joi.string().max(255).optional().allow(null, ''),
  metadata: Joi.object().optional()
}).required();

const updateSchema = Joi.object({
  review_points: Joi.number().integer().min(1).max(5).optional(),
  metadata: Joi.object().optional(),
  message_update: Joi.object({
    details: Joi.string().max(5000).optional().allow('', null),
    subject: Joi.string().max(255).optional().allow('', null),
    attachments: Joi.array().items(
      Joi.object({
        filename: Joi.string().max(255).required(),
        mimeType: Joi.string().max(255).allow('', null),
        size: Joi.number().min(0).optional(),
        storageRef: Joi.string().max(1024).optional()
      })
    ).optional(),
    status: Joi.string().valid('draft', 'submitted', 'archived').optional()
  }).optional()
}).min(1);

const listSchema = Joi.object({
  reviewee_id: objectId.required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  include_hidden: Joi.boolean().default(false)
});

const messagesPaginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

/* -------------------------
 * Helper middleware
 * ------------------------- */

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'params' ? req.params : (source === 'query' ? req.query : req.body);
    const { value, error } = schema.validate(data, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map(d => ({ message: d.message, path: d.path.join('.') }));
      return res.status(400).json({ ok: false, error: 'validation_error', details });
    }
    // attach validated value back to request for downstream handlers
    if (source === 'params') req.params = Object.assign(req.params, value);
    else if (source === 'query') req.query = Object.assign(req.query, value);
    else req.body = Object.assign(req.body, value);
    return next();
  };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  validateCreate: validate(createSchema, 'body'),
  validateUpdate: validate(updateSchema, 'body'),
  validateList: validate(listSchema, 'query'),
  validateIdParam: validate(Joi.object({ id: objectId.required() }), 'params'),
  validateMessagesPagination: validate(messagesPaginationSchema, 'query')
};
