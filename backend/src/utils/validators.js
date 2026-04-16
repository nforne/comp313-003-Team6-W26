/**
 * @module utils/validators
 * @description Input validation utilities using express-validator.
 * Provides reusable validation chains for API endpoints.
 */

const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');

/**
 * Middleware to check validation results.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

/**
 * Registration validation rules.
 */
const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('role')
    .optional()
    .isIn(['customer', 'provider'])
    .withMessage('Role must be customer or provider'),
];

/**
 * Login validation rules.
 */
const loginRules = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

/**
 * Service request creation validation rules.
 */
const serviceRules = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('serviceType').notEmpty().withMessage('Service type is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('preferredDate').isISO8601().withMessage('Valid date is required'),
  body('preferredTime').notEmpty().withMessage('Preferred time is required'),
];

/**
 * Bid submission validation rules.
 */
const bidRules = [
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('message').optional().isString(),
  body('estimatedDuration')
    .optional()
    .isInt({ min: 15 })
    .withMessage('Duration must be at least 15 minutes'),
];

/**
 * Booking validation rules.
 */
const bookingRules = [
  body('serviceId').notEmpty().withMessage('Service ID is required'),
  body('bidId').notEmpty().withMessage('Bid ID is required'),
];

/**
 * Rating validation rules.
 */
const ratingRules = [
  body('score')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment').optional().isString(),
];

/**
 * ObjectId parameter validation.
 */
const objectIdRule = [
  param('id').isMongoId().withMessage('Invalid ID format'),
];

module.exports = {
  validate,
  registerRules,
  loginRules,
  serviceRules,
  bidRules,
  bookingRules,
  ratingRules,
  objectIdRule,
};
