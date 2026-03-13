// src/validators/request.validator.js
const Joi = require('joi');

/**
 * whenSlotSchema
 * - Represents a single time slot.
 * - from and to are epoch ms integers.
 * - to must be greater than from.
 * - isBusinessHours is optional and coerced to boolean.
 */
const whenSlotSchema = Joi.object({
  from: Joi.number().integer().required(),
  to: Joi.number().integer().greater(Joi.ref('from')).required(),
  isBusinessHours: Joi.boolean().optional()
});

/**
 * geoSchema
 * - GeoJSON Point with coordinates [lng, lat].
 * - Enforces longitude/latitude ranges and exact length 2.
 */
const geoSchema = Joi.object({
  type: Joi.string().valid('Point').default('Point'),
  coordinates: Joi.array()
    .ordered(
      Joi.number().min(-180).max(180).required(), // lng
      Joi.number().min(-90).max(90).required()   // lat
    )
    .length(2)
}).optional();

/**
 * createRequestSchema
 * - when is now an array of slots (one or more).
 * - preserves previous fields and defaults.
 */
const createRequestSchema = Joi.object({
  title: Joi.string().min(3).max(200).required(),
  description: Joi.string().allow('', null),
  services: Joi.array().items(Joi.string()).default([]),
  categories: Joi.array().items(Joi.string()).default([]),
  locations: Joi.array().items(Joi.string()).default([]),
  geo: geoSchema,
  when: Joi.array().items(whenSlotSchema).min(1).required(),
  isPrivate: Joi.boolean().default(false),
  allowedProviders: Joi.array().items(Joi.string()).default([]),
  expiresAt: Joi.number().integer().optional().allow(null)
});

/**
 * searchSchema
 * - Keeps existing search params; nearLng/nearLat remain optional.
 */
const searchSchema = Joi.object({
  categories: Joi.array().items(Joi.string()).default([]),
  location: Joi.string().allow('', null),
  nearLng: Joi.number().optional(),
  nearLat: Joi.number().optional(),
  radiusMeters: Joi.number().integer().min(100).default(50000),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = { createRequestSchema, searchSchema };
