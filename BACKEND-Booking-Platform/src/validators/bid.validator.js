/**
 * src/validators/bid.validator.js
 *
 * Joi validation schemas for create and update payloads.
 * Keep validation strict and return helpful messages to callers.
 */

const Joi = require('joi');

const createBidSchema = Joi.object({
  quote_amount: Joi.number().positive().required()
    .messages({ 'number.base': 'quote_amount must be a number', 'number.positive': 'quote_amount must be > 0' }),
  currency: Joi.string().length(3).required().uppercase()
    .messages({ 'string.length': 'currency must be a 3-letter ISO 4217 code' }),
  services: Joi.array().items(Joi.string()).optional(),
  message: Joi.string().max(2000).allow('', null),
  status: Joi.string().valid('draft', 'submitted').default('submitted')
});

const updateBidSchema = Joi.object({
  quote_amount: Joi.number().positive().optional(),
  currency: Joi.string().length(3).optional().uppercase(),
  services: Joi.array().items(Joi.string()).optional(),
  message: Joi.string().max(2000).optional(),
  status: Joi.string().valid('draft','submitted','withdrawn','accepted','rejected','cancelled').optional()
}).min(1).messages({ 'object.min': 'At least one field must be provided to update' });

module.exports = { createBidSchema, updateBidSchema };
