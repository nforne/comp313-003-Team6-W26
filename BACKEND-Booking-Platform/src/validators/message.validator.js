// src/validators/message.validator.js
//
// Joi validation schemas for Message APIs.
// - Designed to be used with route-level `validate(schema, source)` middleware.
// - Exports schemas for create, update, list queries, and common param checks.

const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const epochMs = Joi.number().integer().min(0);

const attachmentSchema = Joi.object({
  filename: Joi.string().max(255).required(),
  mimeType: Joi.string().max(255).required(),
  size: Joi.number().integer().min(0).required(),
  storageRef: Joi.string().max(1024).required()
});

const createMessageSchema = Joi.object({
  // required
  type: Joi.string().valid('issue_wall', 'email', 'notification', 'booking', 'review').required(),

  // recipients: either recipientsAll true (broadcast) or a short list of user ids
  recipientsAll: Joi.boolean().optional().default(false),
  recipients: Joi.array().items(objectId).max(100).optional()
    .when('recipientsAll', { is: true, then: Joi.forbidden(), otherwise: Joi.optional() }),

  // author/sender (optional; server may override with actor)
  userId: objectId.optional().allow(null),

  // optional domain links
  serviceId: objectId.optional().allow(null),
  // convenience fields
  subject: Joi.string().max(255).optional().allow(''),
  details: Joi.string().max(5000).optional().allow(''),

  attachments: Joi.array().items(attachmentSchema).max(10).optional().default([]),

  // threading
  replyTo: objectId.optional().allow(null),

  // idempotency
  idempotencyKey: Joi.string().max(255).optional(),

  // extensible metadata (bookingId, reviewId, etc.)
  metadata: Joi.object().optional().unknown(true),

  // lifecycle: when creating, messages are persisted as draft by default;
  // allow client to set status only if explicitly permitted by server policies (usually not)
  status: Joi.string().valid('draft', 'submitted', 'deleted', 'read', 'unread').optional()
});

const updateMessageSchema = Joi.object({
  subject: Joi.string().max(255).optional(),
  details: Joi.string().max(5000).optional().allow(''),
  attachments: Joi.array().items(attachmentSchema).max(10).optional(),
  recipientsAll: Joi.boolean().optional(),
  recipients: Joi.array().items(objectId).max(100).optional(),
  serviceId: objectId.optional().allow(null),
  replyTo: objectId.optional().allow(null),
  metadata: Joi.object().optional().unknown(true),
  // allow explicit status changes only for admin flows; controllers should enforce
  status: Joi.string().valid('draft', 'submitted', 'deleted', 'read', 'unread').optional()
}).min(1); // require at least one field to update

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  type: Joi.string().valid('issue_wall', 'email', 'notification', 'booking', 'review').optional(),
  since: epochMs.optional(),
  unreadOnly: Joi.boolean().optional().default(false),
  // filter by recipient id (user) or by recipientsAll flag
  recipientId: objectId.optional(),
  recipientsAll: Joi.boolean().optional(),
  // metadata filters (generic): allow a small set of keys to be passed as strings
  metadataKey: Joi.string().max(100).optional(),
  metadataValue: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).optional()
});

const idParamSchema = Joi.object({
  id: objectId.required()
});

const metadataQuerySchema = Joi.object({
  key: Joi.string().max(100).required(),
  value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = {
  createMessageSchema,
  updateMessageSchema,
  listQuerySchema,
  idParamSchema,
  metadataQuerySchema,
  attachmentSchema
};
