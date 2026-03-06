// src/validators/booking.validator.js
const Joi = require('joi');

/**
 * Slot DTO validator
 * - from / to are epoch milliseconds (Number)
 * - to must be greater than from
 */
const SlotSchema = Joi.object({
  from: Joi.number().integer().required().messages({
    'number.base': 'slot.from must be a number (epoch ms)',
    'any.required': 'slot.from is required'
  }),
  to: Joi.number().integer().greater(Joi.ref('from')).required().messages({
    'number.base': 'slot.to must be a number (epoch ms)',
    'number.greater': 'slot.to must be greater than slot.from',
    'any.required': 'slot.to is required'
  })
}).required();

/**
 * Create booking schema
 * Accepts both camelCase and snake_case for a few common fields (quoteAmount / quote_amount).
 */
const bookingCreateSchema = Joi.object({
  requestId: Joi.string().required(),
  request_id: Joi.string(), // allow either naming; controller/service should normalize
  bidId: Joi.string().optional().allow(null, ''),
  bid_id: Joi.string().optional().allow(null, ''),

  seekerId: Joi.string().required(),
  seeker_id: Joi.string().optional(),

  providerId: Joi.string().required(),
  provider_id: Joi.string().optional(),

  quoteAmount: Joi.number().positive().required(),
  quote_amount: Joi.number().positive().optional(),

  currency: Joi.string().length(3).uppercase().required(),

  services: Joi.array().items(Joi.string()).optional().default([]),

  // slots: array of SlotSchema
  slots: Joi.array().items(SlotSchema).min(1).required(),

  // optional textual fields
  notes: Joi.string().max(2000).optional().allow(''),
  description: Joi.string().max(2000).optional().allow(''),

  metadata: Joi.object().optional().default({}),

  // allow extra fields but strip unknown by default in controller if desired
}).custom((value, helpers) => {
  // Normalize: require at least one of requestId/request_id, seekerId/seeker_id, providerId/provider_id
  if (!value.requestId && !value.request_id) {
    return helpers.error('any.custom', { message: 'requestId is required' });
  }
  if (!value.seekerId && !value.seeker_id) {
    return helpers.error('any.custom', { message: 'seekerId is required' });
  }
  if (!value.providerId && !value.provider_id) {
    return helpers.error('any.custom', { message: 'providerId is required' });
  }
  return value;
});

/**
 * Update booking schema
 * - Admin-only in controller, but validator ensures shape and types.
 * - At least one field required.
 */
const bookingUpdateSchema = Joi.object({
  what: Joi.string().max(2000).optional(),
  where: Joi.string().max(2000).optional(),
  slots: Joi.array().items(SlotSchema).min(1).optional(),
  services: Joi.array().items(Joi.string()).optional(),
  quoteAmount: Joi.number().positive().optional(),
  quote_amount: Joi.number().positive().optional(),
  currency: Joi.string().length(3).uppercase().optional(),
  description: Joi.string().max(2000).optional(),
  metadata: Joi.object().optional(),
  status: Joi.string().valid('active', 'honored', 'seeker_cancelled', 'provider_cancelled', 'suspended').optional()
}).min(1);

/**
 * Cancel booking schema
 */
const bookingCancelSchema = Joi.object({
  reason: Joi.string().max(2000).optional().allow('')
}).optional();

/**
 * Export schemas
 */
module.exports = {
  SlotSchema,
  bookingCreateSchema,
  bookingUpdateSchema,
  bookingCancelSchema
};
