// src/validators/request.validator.js
const Joi = require('joi');

const whenSchema = Joi.object({
  from: Joi.number().integer().required(),
  to: Joi.number().integer().greater(Joi.ref('from')).required()
});

const createRequestSchema = Joi.object({
  title: Joi.string().min(3).max(200).required(),
  description: Joi.string().allow('', null),
  services: Joi.array().items(Joi.string()).default([]),
  categories: Joi.array().items(Joi.string()).default([]),
  locations: Joi.array().items(Joi.string()).default([]),
  geo: Joi.object({ type: Joi.string().valid('Point').default('Point'), coordinates: Joi.array().items(Joi.number()).length(2) }).optional(),
  when: whenSchema.required(),
  isPrivate: Joi.boolean().default(false),
  allowedProviders: Joi.array().items(Joi.string()).default([])
});

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
