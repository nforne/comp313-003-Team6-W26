// src/validators/service.validator.js
const Joi = require('joi');

const addressSchema = Joi.object({
  label: Joi.string().allow('', null),
  line1: Joi.string().allow('', null),
  line2: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  province: Joi.string().allow('', null),
  postalCode: Joi.string().allow('', null),
  country: Joi.string().allow('', null)
});

const createServiceSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  providerId: Joi.string().required(),
  addresses: Joi.array().items(addressSchema).default([]),
  locations: Joi.array().items(Joi.string()).default([]),
  contacts: Joi.array().items(Joi.object({ use: Joi.string().valid('office','billing','support','other').default('office'), value: Joi.string().required() })).default([]),
  emails: Joi.array().items(Joi.string().email()).default([]),
  phones: Joi.array().items(Joi.string()).default([]),
  categories: Joi.array().items(Joi.string()).default([]),
  capacity: Joi.number().integer().min(1).default(1),
  descriptionCards: Joi.array().items(Joi.object({
    cardId: Joi.string(),
    cardName: Joi.string(),
    title: Joi.string(),
    images: Joi.array().items(Joi.string().uri()).default([]),
    descriptions: Joi.array().items(Joi.string()).default([])
  })).default([])
});

const updateServiceSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  addresses: Joi.array().items(addressSchema),
  locations: Joi.array().items(Joi.string()),
  contacts: Joi.array().items(Joi.object({ use: Joi.string().valid('office','billing','support','other'), value: Joi.string() })),
  emails: Joi.array().items(Joi.string().email()),
  phones: Joi.array().items(Joi.string()),
  categories: Joi.array().items(Joi.string()),
  capacity: Joi.number().integer().min(1),
  descriptionCards: Joi.array().items(Joi.object({
    cardId: Joi.string(),
    cardName: Joi.string(),
    title: Joi.string(),
    images: Joi.array().items(Joi.string().uri()).default([]),
    descriptions: Joi.array().items(Joi.string()).default([])
  })),
  status: Joi.string().valid('active','inactive','suspended','available','unavailable','out_of_service')
});

const searchSchema = Joi.object({
  q: Joi.string().allow('', null),
  categories: Joi.array().items(Joi.string()).default([]),
  location: Joi.string().allow('', null),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = { createServiceSchema, updateServiceSchema, searchSchema };
