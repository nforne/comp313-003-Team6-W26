// src/validators/user.validator.js
const Joi = require('joi');

const emailObj = Joi.object({
  value: Joi.string().email().required(),
  primary: Joi.boolean().default(false)
});

const registerSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().allow('', null),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid('service_seeker','service_provider').default('service_seeker')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const profileUpdateSchema = Joi.object({
  firstName: Joi.string().min(1).max(100),
  lastName: Joi.string().allow('', null),
  avatarUrl: Joi.string().uri(),
  phones: Joi.array().items(Joi.object({ value: Joi.string().required(), type: Joi.string().valid('mobile','home','work','other') })),
  selfIntro: Joi.object({ text: Joi.string().allow('', null), images: Joi.array().items(Joi.string().uri()) })
});

const roleChangeSchema = Joi.object({
  role: Joi.string().valid('service_seeker','service_provider','administrator').required()
});

module.exports = {
  registerSchema,
  loginSchema,
  profileUpdateSchema,
  roleChangeSchema
};
