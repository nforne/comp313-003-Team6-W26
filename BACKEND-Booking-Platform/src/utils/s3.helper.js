// src/utils/s3.helper.js
//
// S3 helper utilities (AWS SDK v3) that reuse the credential-aware client factory.
// - Uses getS3Client(...) from src/utils/s3.client.factory to centralize credential/provider logic.
// - Provides safe upload/download, presigned URL, object and bucket helpers.
// - Accepts optional logger in options; logs structured events and redacts secrets.

const fs = require('fs');
const os = require('os');
const path = require('path');
const mime = require('mime-types');

const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateBucketCommand
} = require('@aws-sdk/client-s3');

const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { getS3Client } = require('./s3.client.factory'); // centralized factory

/* -------------------------
 * Helpers
 * ------------------------- */

function safeLogger(logger) {
  if (!logger) {
    return {
      info: (...args) => console.info && console.info(...args),
      warn: (...args) => console.warn && console.warn(...args),
      error: (...args) => console.error && console.error(...args)
    };
  }
  return {
    info: typeof logger.info === 'function' ? logger.info.bind(logger) : () => {},
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : () => {},
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : () => {}
  };
}

function normalizeKey(key) {
  if (!key) throw new Error('S3 key required');
  return String(key).replace(/^\/+/, '');
}

function detectContentType(filename, provided) {
  if (provided) return provided;
  if (!filename) return 'application/octet-stream';
  const ct = mime.lookup(filename);
  return ct || 'application/octet-stream';
}

/* -------------------------
 * Client accessor
 * ------------------------- */

/**
 * getClient
 * - Convenience wrapper around getS3Client factory.
 * - opts forwarded to factory (region, profile, logger, forceEnvCreds, endpoint, etc.)
 *
 * @param {Object} opts
 * @returns {S3Client}
 */
function getClient(opts = {}) {
  return getS3Client(opts);
}

/* -------------------------
 * Uploads
 * ------------------------- */

/**
 * uploadBuffer
 * - Upload a Buffer/Uint8Array using lib-storage (multipart when large).
 * - s3Client may be omitted; if omitted, a client is created via getClient(options.clientOptions).
 */
async function uploadBuffer(s3Client, bucket, key, buffer, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);

  const params = {
    Bucket: bucket,
    Key: normalizedKey,
    Body: buffer,
    ContentType: detectContentType(key, options.contentType),
    Metadata: options.metadata || {}
  };
  if (options.acl) params.ACL = options.acl;
  if (options.storageClass) params.StorageClass = options.storageClass;

  try {
    const upload = new Upload({
      client,
      params,
      queueSize: options.queueSize || 4,
      partSize: options.partSize || 5 * 1024 * 1024
    });
    const result = await upload.done();
    logger.info({ event: 's3.uploadBuffer.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, etag: result.ETag, location: result.Location || null };
  } catch (err) {
    logger.error({ event: 's3.uploadBuffer.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * uploadStream
 * - Upload a readable stream using lib-storage.
 */
async function uploadStream(s3Client, bucket, key, readStream, options = {}) {
  if (!readStream || typeof readStream.pipe !== 'function') throw new Error('readStream must be a readable stream');
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);

  const params = {
    Bucket: bucket,
    Key: normalizedKey,
    Body: readStream,
    ContentType: detectContentType(key, options.contentType),
    Metadata: options.metadata || {}
  };
  if (options.acl) params.ACL = options.acl;
  if (options.storageClass) params.StorageClass = options.storageClass;

  try {
    const upload = new Upload({
      client,
      params,
      queueSize: options.queueSize || 4,
      partSize: options.partSize || 5 * 1024 * 1024
    });
    const result = await upload.done();
    logger.info({ event: 's3.uploadStream.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, etag: result.ETag, location: result.Location || null };
  } catch (err) {
    logger.error({ event: 's3.uploadStream.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Downloads and streams
 * ------------------------- */

async function downloadToBuffer(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey, Range: options.range });

  try {
    const res = await client.send(cmd);
    const bodyStream = res.Body;
    const chunks = [];
    for await (const chunk of bodyStream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    logger.info({ event: 's3.downloadToBuffer.success', bucket, key: normalizedKey, length: buffer.length });
    return { ok: true, bucket, key: normalizedKey, buffer, contentType: res.ContentType, metadata: res.Metadata || {} };
  } catch (err) {
    logger.error({ event: 's3.downloadToBuffer.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

async function getObjectStream(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey });

  try {
    const res = await client.send(cmd);
    logger.info({ event: 's3.getObjectStream.success', bucket, key: normalizedKey });
    return { ok: true, stream: res.Body, contentType: res.ContentType, metadata: res.Metadata || {} };
  } catch (err) {
    logger.error({ event: 's3.getObjectStream.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Presigned URLs
 * ------------------------- */

async function getPresignedUrl(s3Client, bucket, key, method = 'getObject', expiresIn = 900, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);
  let cmd;

  if (method === 'getObject') {
    cmd = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey });
  } else if (method === 'putObject') {
    const params = {
      Bucket: bucket,
      Key: normalizedKey,
      ContentType: options.contentType || detectContentType(key, options.contentType),
      Metadata: options.metadata || {}
    };
    if (options.acl) params.ACL = options.acl;
    cmd = new PutObjectCommand(params);
  } else {
    throw new Error('unsupported method for presigned url');
  }

  try {
    const url = await getSignedUrl(client, cmd, { expiresIn });
    logger.info({ event: 's3.getPresignedUrl.success', bucket, key: normalizedKey, method, expiresIn });
    return { ok: true, url };
  } catch (err) {
    logger.error({ event: 's3.getPresignedUrl.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Object management
 * ------------------------- */

async function deleteObject(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: normalizedKey });

  try {
    const res = await client.send(cmd);
    logger.info({ event: 's3.deleteObject.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, result: res };
  } catch (err) {
    logger.error({ event: 's3.deleteObject.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

async function headObject(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedKey = normalizeKey(key);
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey });

  try {
    const res = await client.send(cmd);
    logger.info({ event: 's3.headObject.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, metadata: res.Metadata || {}, contentLength: res.ContentLength, contentType: res.ContentType, lastModified: res.LastModified };
  } catch (err) {
    logger.error({ event: 's3.headObject.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    if (err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)) return { ok: false, notFound: true };
    throw err;
  }
}

async function listObjects(s3Client, bucket, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const params = {
    Bucket: bucket,
    Prefix: options.prefix || '',
    MaxKeys: options.maxKeys || 1000,
    ContinuationToken: options.continuationToken
  };
  const cmd = new ListObjectsV2Command(params);

  try {
    const res = await client.send(cmd);
    logger.info({ event: 's3.listObjects.success', bucket, prefix: params.Prefix, count: (res.Contents || []).length });
    return { ok: true, contents: res.Contents || [], isTruncated: res.IsTruncated, nextContinuationToken: res.NextContinuationToken };
  } catch (err) {
    logger.error({ event: 's3.listObjects.error', bucket, prefix: params.Prefix, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

async function copyObject(s3Client, sourceBucket, sourceKey, destBucket, destKey, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});
  const normalizedSourceKey = normalizeKey(sourceKey);
  const normalizedDestKey = normalizeKey(destKey);
  const copySource = encodeURIComponent(`${sourceBucket}/${normalizedSourceKey}`);

  const params = {
    Bucket: destBucket,
    Key: normalizedDestKey,
    CopySource: copySource
  };
  if (options.metadataDirective) params.MetadataDirective = options.metadataDirective;
  if (options.metadata) params.Metadata = options.metadata;
  if (options.storageClass) params.StorageClass = options.storageClass;
  if (options.acl) params.ACL = options.acl;

  const cmd = new CopyObjectCommand(params);
  try {
    const res = await client.send(cmd);
    logger.info({ event: 's3.copyObject.success', from: copySource, to: `${destBucket}/${normalizedDestKey}` });
    return { ok: true, result: res };
  } catch (err) {
    logger.error({ event: 's3.copyObject.error', from: copySource, to: `${destBucket}/${normalizedDestKey}`, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Bucket utilities
 * ------------------------- */

async function ensureBucketExists(s3Client, bucket, options = {}) {
  const logger = safeLogger(options.logger);
  const client = s3Client || getClient(options.clientOptions || {});

  try {
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 0 }));
    logger.info({ event: 's3.ensureBucketExists.exists', bucket });
    return { ok: true, existed: true };
  } catch (err) {
    logger.info({ event: 's3.ensureBucketExists.createAttempt', bucket, error: err && err.message ? err.message : String(err) });
    try {
      const createParams = { Bucket: bucket };
      const region = client.config && client.config.region ? client.config.region : process.env.AWS_REGION;
      if (region && region !== 'us-east-1') createParams.CreateBucketConfiguration = { LocationConstraint: region };
      await client.send(new CreateBucketCommand(createParams));
      logger.info({ event: 's3.ensureBucketExists.created', bucket });
      return { ok: true, existed: false };
    } catch (createErr) {
      logger.error({ event: 's3.ensureBucketExists.error', bucket, error: createErr && createErr.message ? createErr.message : String(createErr) });
      throw createErr;
    }
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  getClient,
  uploadBuffer,
  uploadStream,
  downloadToBuffer,
  getObjectStream,
  getPresignedUrl,
  deleteObject,
  headObject,
  listObjects,
  copyObject,
  ensureBucketExists,
  normalizeKey,
  detectContentType
};
