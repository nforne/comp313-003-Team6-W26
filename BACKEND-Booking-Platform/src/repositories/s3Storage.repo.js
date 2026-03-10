// src/repositories/s3Storage.repo.js
//
// Low-level S3 primitives and presign helpers used by s3Storage service/controller.
// - Uses credential-aware client from src/utils/s3.client.factory.js
// - Reuses utility helpers from src/utils/s3.helper.js for presigns and object ops
// - Idempotent, returns normalized keys and consistent shapes for callers

const { getS3Client } = require('../utils/s3.client.factory');
const {
  getPresignedUrl,
  headObject,
  deleteObject,
  listObjects,
  copyObject,
  normalizeKey
} = require('../utils/s3.helper');

const DEFAULT_BUCKET = process.env.STORAGE_BUCKET || 'comp313-booking-platform';
const DEFAULT_PUT_EXPIRES = parseInt(process.env.PRESIGN_PUT_EXPIRES || '900', 10); // seconds
const DEFAULT_GET_EXPIRES = parseInt(process.env.PRESIGN_GET_EXPIRES || '300', 10); // seconds

function _client(region, opts = {}) {
  return getS3Client({ region, profile: opts.profile, logger: opts.logger, forceEnvCreds: !!opts.forceEnvCreds });
}

/**
 * generatePresignedPutUrl
 * @param {string} key
 * @param {Object} opts { bucket, region, contentType, expiresIn, metadata, logger }
 * @returns {Promise<{ ok: true, url: string, key: string, bucket: string }>}
 */
async function generatePresignedPutUrl(key, opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const expiresIn = typeof opts.expiresIn === 'number' ? opts.expiresIn : DEFAULT_PUT_EXPIRES;
  const logger = opts.logger || console;
  const normalizedKey = normalizeKey(key);

  const s3 = _client(opts.region, opts);
  try {
    const res = await getPresignedUrl(s3, bucket, normalizedKey, 'putObject', expiresIn, {
      contentType: opts.contentType,
      metadata: opts.metadata,
      logger
    });
    logger.info && logger.info({ event: 's3.repo.presign_put', bucket, key: normalizedKey, expiresIn });
    return { ok: true, url: res.url, key: normalizedKey, bucket };
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.presign_put.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * generatePresignedGetUrl
 * @param {string} key
 * @param {Object} opts { bucket, region, expiresIn, logger }
 * @returns {Promise<{ ok: true, url: string, key: string, bucket: string }>}
 */
async function generatePresignedGetUrl(key, opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const expiresIn = typeof opts.expiresIn === 'number' ? opts.expiresIn : DEFAULT_GET_EXPIRES;
  const logger = opts.logger || console;
  const normalizedKey = normalizeKey(key);

  const s3 = _client(opts.region, opts);
  try {
    const res = await getPresignedUrl(s3, bucket, normalizedKey, 'getObject', expiresIn, { logger });
    logger.info && logger.info({ event: 's3.repo.presign_get', bucket, key: normalizedKey, expiresIn });
    return { ok: true, url: res.url, key: normalizedKey, bucket };
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.presign_get.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * headObjectMeta
 * @param {string} key
 * @param {Object} opts { bucket, region, logger }
 * @returns {Promise<{ ok: boolean, notFound?: boolean, contentLength?: number, contentType?: string, metadata?: Object }>}
 */
async function headObjectMeta(key, opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const logger = opts.logger || console;
  const normalizedKey = normalizeKey(key);
  const s3 = _client(opts.region, opts);

  try {
    const res = await headObject(s3, bucket, normalizedKey, { logger });
    logger.info && logger.info({ event: 's3.repo.head', bucket, key: normalizedKey, found: !!res.ok });
    return res;
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.head.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * deleteObjectByKey
 * @param {string} key
 * @param {Object} opts { bucket, region, logger }
 * @returns {Promise<{ ok: true, bucket, key }>}
 */
async function deleteObjectByKey(key, opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const logger = opts.logger || console;
  const normalizedKey = normalizeKey(key);
  const s3 = _client(opts.region, opts);

  try {
    const res = await deleteObject(s3, bucket, normalizedKey, { logger });
    logger.info && logger.info({ event: 's3.repo.delete', bucket, key: normalizedKey });
    return res;
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.delete.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * listObjectsByPrefix
 * @param {string} prefix
 * @param {Object} opts { bucket, region, maxKeys, continuationToken, logger }
 * @returns {Promise<{ ok: true, contents: Array, isTruncated: boolean, nextContinuationToken?: string }>}
 */
async function listObjectsByPrefix(prefix = '', opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const logger = opts.logger || console;
  const s3 = _client(opts.region, opts);
  const normalizedPrefix = prefix ? normalizeKey(prefix) : '';

  try {
    const res = await listObjects(s3, bucket, { prefix: normalizedPrefix, maxKeys: opts.maxKeys, continuationToken: opts.continuationToken, logger });
    logger.info && logger.info({ event: 's3.repo.list', bucket, prefix: normalizedPrefix, count: (res.contents || []).length });
    return res;
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.list.error', bucket, prefix: normalizedPrefix, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * copyObjectWithinBucket
 * @param {string} sourceKey
 * @param {string} destKey
 * @param {Object} opts { bucket, region, metadataDirective, metadata, storageClass, logger }
 * @returns {Promise<{ ok: true, result: Object }>}
 */
async function copyObjectWithinBucket(sourceKey, destKey, opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const logger = opts.logger || console;
  const s3 = _client(opts.region, opts);
  const src = normalizeKey(sourceKey);
  const dst = normalizeKey(destKey);

  try {
    const res = await copyObject(s3, bucket, src, bucket, dst, {
      metadataDirective: opts.metadataDirective,
      metadata: opts.metadata,
      storageClass: opts.storageClass,
      logger
    });
    logger.info && logger.info({ event: 's3.repo.copy', bucket, from: src, to: dst });
    return res;
  } catch (err) {
    logger.error && logger.error({ event: 's3.repo.copy.error', bucket, from: src, to: dst, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * ensureBucket
 * - Convenience wrapper: returns { ok: true, bucket }.
 * - Uses getS3Client to validate access by attempting a head/list operation.
 */
async function ensureBucket(bucketName = DEFAULT_BUCKET, opts = {}) {
  const logger = opts.logger || console;
  const s3 = _client(opts.region, opts);
  const bucket = bucketName;

  try {
    // quick check: list zero objects to validate access
    await listObjects(s3, bucket, { prefix: '', maxKeys: 0, logger });
    logger.info && logger.info({ event: 's3.repo.ensureBucket.exists', bucket });
    return { ok: true, bucket, existed: true };
  } catch (err) {
    // If listing failed, surface the error so caller can decide to create via separate script
    logger.warn && logger.warn({ event: 's3.repo.ensureBucket.access_failed', bucket, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  generatePresignedPutUrl,
  generatePresignedGetUrl,
  headObjectMeta,
  deleteObjectByKey,
  listObjectsByPrefix,
  copyObjectWithinBucket,
  ensureBucket
};
