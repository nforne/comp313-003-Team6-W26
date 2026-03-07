// src/utils/s3.helper.js
//
// Polished S3 helper utilities using AWS SDK v3.
// - Credential-aware S3 client factory: prefers env creds, then shared profile, then falls back
//   to the SDK default provider chain (instance/task/Lambda role, web identity, etc.).
// - Safe, reusable CRUD operations and presigned URL helpers.
// - Uses @aws-sdk/client-s3, @aws-sdk/lib-storage, and @aws-sdk/s3-request-presigner.
// - Designed for server-side Node.js usage. Accepts an optional logger in options.

const fs = require('fs');
const os = require('os');
const path = require('path');
const mime = require('mime-types');

const {
  S3Client,
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
const { fromIni } = require('@aws-sdk/credential-providers');

/* -------------------------
 * Helpers
 * ------------------------- */

function safeLogger(logger) {
  return logger || console;
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
 * Client factory (credential-aware)
 * ------------------------- */

/**
 * createS3Client
 * - Prefer explicit env creds, then shared credentials/profile, then default provider chain.
 * - options passed through to S3Client (region, endpoint, etc.).
 */
function createS3Client(options = {}) {
  const region = options.region || process.env.AWS_REGION || 'us-east-1';
  // 1) Env credentials (CI/local)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      },
      ...options
    });
  }

  // 2) Shared credentials file / profile (~/.aws/credentials)
  const profile = process.env.AWS_PROFILE;
  const credsFile = path.join(os.homedir(), '.aws', 'credentials');
  if (profile || fs.existsSync(credsFile)) {
    const provider = fromIni({ profile });
    return new S3Client({ region, credentials: provider, ...options });
  }

  // 3) Fallback: let SDK resolve via default provider chain (instance/task role, web identity, etc.)
  return new S3Client({ region, ...options });
}

/* -------------------------
 * Uploads
 * ------------------------- */

/**
 * uploadBuffer
 * - Upload a Buffer/Uint8Array using lib-storage (handles multipart).
 * - options: { contentType, acl, metadata, storageClass, queueSize, partSize, logger }
 */
async function uploadBuffer(s3Client, bucket, key, buffer, options = {}) {
  const logger = safeLogger(options.logger);
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
      client: s3Client,
      params,
      queueSize: options.queueSize || 4,
      partSize: options.partSize || 5 * 1024 * 1024
    });
    const result = await upload.done();
    logger.info && logger.info({ event: 's3.uploadBuffer.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, etag: result.ETag, location: result.Location || null };
  } catch (err) {
    logger.error && logger.error({ event: 's3.uploadBuffer.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * uploadStream
 * - Upload a readable stream using lib-storage.
 * - options: same as uploadBuffer
 */
async function uploadStream(s3Client, bucket, key, readStream, options = {}) {
  if (!readStream || typeof readStream.pipe !== 'function') throw new Error('readStream must be a readable stream');
  const logger = safeLogger(options.logger);
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
      client: s3Client,
      params,
      queueSize: options.queueSize || 4,
      partSize: options.partSize || 5 * 1024 * 1024
    });
    const result = await upload.done();
    logger.info && logger.info({ event: 's3.uploadStream.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, etag: result.ETag, location: result.Location || null };
  } catch (err) {
    logger.error && logger.error({ event: 's3.uploadStream.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Downloads and streams
 * ------------------------- */

/**
 * downloadToBuffer
 * - Download object and return Buffer. options: { range, logger }
 */
async function downloadToBuffer(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const normalizedKey = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey, Range: options.range });
  try {
    const res = await s3Client.send(cmd);
    const bodyStream = res.Body;
    const chunks = [];
    for await (const chunk of bodyStream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    logger.info && logger.info({ event: 's3.downloadToBuffer.success', bucket, key: normalizedKey, length: buffer.length });
    return { ok: true, bucket, key: normalizedKey, buffer, contentType: res.ContentType, metadata: res.Metadata || {} };
  } catch (err) {
    logger.error && logger.error({ event: 's3.downloadToBuffer.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * getObjectStream
 * - Return readable stream and metadata. Caller consumes stream.
 */
async function getObjectStream(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const normalizedKey = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey });
  try {
    const res = await s3Client.send(cmd);
    logger.info && logger.info({ event: 's3.getObjectStream.success', bucket, key: normalizedKey });
    return { ok: true, stream: res.Body, contentType: res.ContentType, metadata: res.Metadata || {} };
  } catch (err) {
    logger.error && logger.error({ event: 's3.getObjectStream.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Presigned URLs
 * ------------------------- */

/**
 * getPresignedUrl
 * - method: 'getObject' | 'putObject'
 * - expiresIn: seconds (default 900)
 * - options.params: contentType, metadata, acl
 */
async function getPresignedUrl(s3Client, bucket, key, method = 'getObject', expiresIn = 900, options = {}) {
  const logger = safeLogger(options.logger);
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
    const url = await getSignedUrl(s3Client, cmd, { expiresIn });
    logger.info && logger.info({ event: 's3.getPresignedUrl.success', bucket, key: normalizedKey, method, expiresIn });
    return { ok: true, url };
  } catch (err) {
    logger.error && logger.error({ event: 's3.getPresignedUrl.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Object management
 * ------------------------- */

/**
 * deleteObject
 */
async function deleteObject(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const normalizedKey = normalizeKey(key);
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: normalizedKey });
  try {
    const res = await s3Client.send(cmd);
    logger.info && logger.info({ event: 's3.deleteObject.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, result: res };
  } catch (err) {
    logger.error && logger.error({ event: 's3.deleteObject.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * headObject
 * - Returns metadata and basic info. If not found, returns { ok: false, notFound: true }.
 */
async function headObject(s3Client, bucket, key, options = {}) {
  const logger = safeLogger(options.logger);
  const normalizedKey = normalizeKey(key);
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey });
  try {
    const res = await s3Client.send(cmd);
    logger.info && logger.info({ event: 's3.headObject.success', bucket, key: normalizedKey });
    return { ok: true, bucket, key: normalizedKey, metadata: res.Metadata || {}, contentLength: res.ContentLength, contentType: res.ContentType, lastModified: res.LastModified };
  } catch (err) {
    logger.error && logger.error({ event: 's3.headObject.error', bucket, key: normalizedKey, error: err && err.message ? err.message : String(err) });
    if (err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)) return { ok: false, notFound: true };
    throw err;
  }
}

/**
 * listObjects
 * - List objects under prefix with pagination.
 * - options: { prefix, maxKeys, continuationToken, logger }
 */
async function listObjects(s3Client, bucket, options = {}) {
  const logger = safeLogger(options.logger);
  const params = {
    Bucket: bucket,
    Prefix: options.prefix || '',
    MaxKeys: options.maxKeys || 1000,
    ContinuationToken: options.continuationToken
  };
  const cmd = new ListObjectsV2Command(params);
  try {
    const res = await s3Client.send(cmd);
    logger.info && logger.info({ event: 's3.listObjects.success', bucket, prefix: params.Prefix, count: (res.Contents || []).length });
    return { ok: true, contents: res.Contents || [], isTruncated: res.IsTruncated, nextContinuationToken: res.NextContinuationToken };
  } catch (err) {
    logger.error && logger.error({ event: 's3.listObjects.error', bucket, prefix: params.Prefix, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * copyObject
 * - Copy object within or across buckets.
 * - options: { metadataDirective, metadata, storageClass, acl, logger }
 */
async function copyObject(s3Client, sourceBucket, sourceKey, destBucket, destKey, options = {}) {
  const logger = safeLogger(options.logger);
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
    const res = await s3Client.send(cmd);
    logger.info && logger.info({ event: 's3.copyObject.success', from: copySource, to: `${destBucket}/${normalizedDestKey}` });
    return { ok: true, result: res };
  } catch (err) {
    logger.error && logger.error({ event: 's3.copyObject.error', from: copySource, to: `${destBucket}/${normalizedDestKey}`, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Bucket utilities
 * ------------------------- */

/**
 * ensureBucketExists
 * - Best-effort: checks existence and attempts to create if missing.
 * - Caller must ensure appropriate permissions.
 */
async function ensureBucketExists(s3Client, bucket, options = {}) {
  const logger = safeLogger(options.logger);
  try {
    // quick existence check by listing zero objects
    await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 0 }));
    logger.info && logger.info({ event: 's3.ensureBucketExists.exists', bucket });
    return { ok: true, existed: true };
  } catch (err) {
    logger.info && logger.info({ event: 's3.ensureBucketExists.createAttempt', bucket, error: err && err.message ? err.message : String(err) });
    try {
      const createParams = { Bucket: bucket };
      const region = s3Client.config && s3Client.config.region ? s3Client.config.region : process.env.AWS_REGION;
      if (region && region !== 'us-east-1') createParams.CreateBucketConfiguration = { LocationConstraint: region };
      await s3Client.send(new CreateBucketCommand(createParams));
      logger.info && logger.info({ event: 's3.ensureBucketExists.created', bucket });
      return { ok: true, existed: false };
    } catch (createErr) {
      logger.error && logger.error({ event: 's3.ensureBucketExists.error', bucket, error: createErr && createErr.message ? createErr.message : String(createErr) });
      throw createErr;
    }
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createS3Client,
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
