// src/validators/s3Storage.validators.js
//
// Joi validation schemas and Express middleware for S3 storage endpoints.
// - Exports schemas: requestUpload, confirmUpload, presignDownload, replaceFile, deleteFile
// - Exports middleware factory `validate(schema, part)` which attaches `req.validated`
// - Keeps conservative defaults (maxSize 50MB) and safe filename rules to avoid path traversal.

const Joi = require('joi');

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const FILENAME_RE = /^[^\/\\\0]{1,255}$/; // no slashes, no null bytes, max 255 chars
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/* -------------------------
 * Schemas
 * ------------------------- */

/**
 * requestUpload
 * Body: { filename, contentType, size, purpose?, ownerId?, idempotencyKey? }
 */
const requestUpload = Joi.object({
  filename: Joi.string().pattern(FILENAME_RE).required()
    .description('Client filename; must not contain path separators'),
  contentType: Joi.string().max(255).required().description('MIME content type'),
  size: Joi.number().integer().min(0).max(DEFAULT_MAX_SIZE).optional().description('Expected size in bytes'),
  purpose: Joi.string().max(100).optional(),
  ownerId: Joi.string().pattern(OBJECT_ID_RE).optional().description('Owner user id (if different from actor)'),
  idempotencyKey: Joi.string().max(255).optional()
});

/**
 * confirmUpload
 * Body: { fileId, key, expectedSize?, expectedContentType? }
 */
const confirmUpload = Joi.object({
  fileId: Joi.string().pattern(OBJECT_ID_RE).required(),
  key: Joi.string().required().description('Canonical S3 object key returned from request-upload'),
  expectedSize: Joi.number().integer().min(0).optional(),
  expectedContentType: Joi.string().max(255).optional()
});

/**
 * presignDownload
 * Query: { key? , fileId? , expiresIn? }
 */
const presignDownload = Joi.object({
  key: Joi.string().optional(),
  fileId: Joi.string().pattern(OBJECT_ID_RE).optional(),
  expiresIn: Joi.number().integer().min(60).max(3600).optional().description('Seconds; between 60 and 3600')
}).or('key', 'fileId'); // require at least one

/**
 * replaceFile
 * Body: { fileId, newFilename, purpose? }
 */
const replaceFile = Joi.object({
  fileId: Joi.string().pattern(OBJECT_ID_RE).required(),
  newFilename: Joi.string().pattern(FILENAME_RE).required(),
  purpose: Joi.string().max(100).optional()
});

/**
 * deleteFile
 * Params/Query: either fileId (path param) or key (query)
 */
const deleteFile = Joi.object({
  fileId: Joi.string().pattern(OBJECT_ID_RE).optional(),
  key: Joi.string().optional()
}).or('fileId', 'key');

/* -------------------------
 * Middleware factory
 * ------------------------- */

/**
 * validate(schema, part)
 * - schema: Joi schema
 * - part: 'body' | 'query' | 'params' (default 'body')
 * - Attaches validated values to req.validated = { body?, query?, params? }
 */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const source = (part === 'body') ? req.body : (part === 'query') ? req.query : req.params;
    const { value, error } = schema.validate(source, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) {
      const details = error.details.map(d => ({ path: d.path.join('.'), message: d.message }));
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details } });
    }
    req.validated = req.validated || {};
    req.validated[part] = value;
    return next();
  };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  schemas: {
    requestUpload,
    confirmUpload,
    presignDownload,
    replaceFile,
    deleteFile
  },
  validate
};
