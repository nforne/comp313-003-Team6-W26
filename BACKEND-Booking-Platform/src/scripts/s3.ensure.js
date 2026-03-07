// src/scripts/s3.ensure.js
//
// Ensure S3 bucket and baseline configuration on application startup.
// - Creates bucket `comp313-booking-platform` if missing.
// - Applies idempotent baseline configuration: PublicAccessBlock, ServerSideEncryption (AES256),
//   Versioning, Lifecycle (expire noncurrent versions & abort incomplete multipart), optional CORS.
// - Safe to call on every app start; operations are idempotent and best-effort.
// - Usage: call `await s3Ensure({ logger: app.get('logger') })` during app bootstrap.
//
// Notes:
// - This script uses AWS SDK v3 and the credential-aware createS3Client from src/utils/s3.helper.
// - It does not open the bucket to public access. Adjust policies/CORS to your needs before enabling public access.

const {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  GetPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  GetBucketEncryptionCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand
} = require('@aws-sdk/client-s3');

const { createS3Client } = require('../utils/s3.helper');

const DEFAULT_BUCKET = 'comp313-booking-platform';

/**
 * s3Ensure
 * @param {Object} opts
 * @param {string} [opts.bucket=DEFAULT_BUCKET] - bucket name to ensure
 * @param {string} [opts.region] - AWS region override
 * @param {Object} [opts.logger] - logger with .info/.warn/.error
 * @param {boolean} [opts.enableCors=false] - whether to apply a permissive CORS rule (adjust for prod)
 * @param {string[]} [opts.corsAllowedOrigins] - origins allowed for CORS (defaults to ['*'] when enableCors true)
 */
async function s3Ensure(opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const region = opts.region || process.env.AWS_REGION || undefined;
  const logger = (opts.logger && typeof opts.logger === 'object') ? opts.logger : console;
  const enableCors = !!opts.enableCors;
  const corsAllowedOrigins = Array.isArray(opts.corsAllowedOrigins) && opts.corsAllowedOrigins.length
    ? opts.corsAllowedOrigins
    : ['*'];

  const s3 = createS3Client(region ? { region } : {});

  logger.info && logger.info({ event: 's3.ensure.start', bucket, region });

  // Helper to run a command and swallow NotFound-like errors for "get" calls
  async function safeSend(cmd) {
    try {
      return await s3.send(cmd);
    } catch (err) {
      // propagate for create/put operations; for get operations caller will handle
      throw err;
    }
  }

  // 1) Check bucket existence via HeadBucket
  let bucketExists = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    bucketExists = true;
    logger.info && logger.info({ event: 's3.ensure.bucket.exists', bucket });
  } catch (err) {
    // If HeadBucket fails, assume bucket missing or inaccessible
    const code = err && (err.name || (err.$metadata && err.$metadata.httpStatusCode));
    logger.info && logger.info({ event: 's3.ensure.headBucket.failed', bucket, code, message: err && err.message ? err.message : String(err) });
    bucketExists = false;
  }

  // 2) Create bucket if missing
  if (!bucketExists) {
    try {
      const createParams = { Bucket: bucket };
      // For non-us-east-1, include CreateBucketConfiguration
      const clientRegion = s3.config && s3.config.region ? s3.config.region : process.env.AWS_REGION;
      if (clientRegion && clientRegion !== 'us-east-1') {
        createParams.CreateBucketConfiguration = { LocationConstraint: clientRegion };
      }
      await s3.send(new CreateBucketCommand(createParams));
      logger.info && logger.info({ event: 's3.ensure.bucket.created', bucket, region: clientRegion });
      bucketExists = true;
    } catch (err) {
      logger.error && logger.error({ event: 's3.ensure.bucket.create.error', bucket, error: err && err.message ? err.message : String(err) });
      throw err;
    }
  }

  // If still not exists or inaccessible, stop
  if (!bucketExists) {
    const err = new Error(`bucket ${bucket} not available`);
    logger.error && logger.error({ event: 's3.ensure.failed', bucket, error: err.message });
    throw err;
  }

  // 3) Apply PublicAccessBlock (block public ACLs and policies) - idempotent
  try {
    // Check existing public access block (best-effort)
    try {
      await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      logger.info && logger.info({ event: 's3.ensure.publicAccessBlock.exists', bucket });
    } catch (_) {
      // Put a conservative public access block
      await s3.send(new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true
        }
      }));
      logger.info && logger.info({ event: 's3.ensure.publicAccessBlock.set', bucket });
    }
  } catch (err) {
    logger.warn && logger.warn({ event: 's3.ensure.publicAccessBlock.error', bucket, error: err && err.message ? err.message : String(err) });
    // non-fatal: continue
  }

  // 4) Ensure default server-side encryption (SSE-S3 AES256)
  try {
    try {
      await s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
      logger.info && logger.info({ event: 's3.ensure.encryption.exists', bucket });
    } catch (_) {
      await s3.send(new PutBucketEncryptionCommand({
        Bucket: bucket,
        ServerSideEncryptionConfiguration: {
          Rules: [
            { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }
          ]
        }
      }));
      logger.info && logger.info({ event: 's3.ensure.encryption.set', bucket, algorithm: 'AES256' });
    }
  } catch (err) {
    logger.warn && logger.warn({ event: 's3.ensure.encryption.error', bucket, error: err && err.message ? err.message : String(err) });
  }

  // 5) Enable versioning (idempotent)
  try {
    const current = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (!current || current.Status !== 'Enabled') {
      await s3.send(new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' }
      }));
      logger.info && logger.info({ event: 's3.ensure.versioning.enabled', bucket });
    } else {
      logger.info && logger.info({ event: 's3.ensure.versioning.already', bucket });
    }
  } catch (err) {
    logger.warn && logger.warn({ event: 's3.ensure.versioning.error', bucket, error: err && err.message ? err.message : String(err) });
  }

  // 6) Ensure lifecycle policy (noncurrent version expiration + abort incomplete multipart)
  try {
    // Try to get existing lifecycle; if missing or different, put a conservative lifecycle
    let needPutLifecycle = false;
    try {
      const existing = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
      // If exists, assume acceptable; do not overwrite by default
      logger.info && logger.info({ event: 's3.ensure.lifecycle.exists', bucket, rules: (existing && existing.Rules && existing.Rules.length) || 0 });
    } catch (getErr) {
      // Not found -> create default lifecycle
      needPutLifecycle = true;
    }

    if (needPutLifecycle) {
      const lifecycle = {
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            // expire noncurrent versions after 365 days
            {
              ID: 'expire-noncurrent-versions-365',
              Status: 'Enabled',
              NoncurrentVersionExpiration: { NoncurrentDays: 365 },
              Filter: {}
            },
            // abort incomplete multipart uploads after 7 days
            {
              ID: 'abort-incomplete-multipart-7',
              Status: 'Enabled',
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
              Filter: {}
            }
          ]
        }
      };
      await s3.send(new PutBucketLifecycleConfigurationCommand(lifecycle));
      logger.info && logger.info({ event: 's3.ensure.lifecycle.set', bucket });
    }
  } catch (err) {
    logger.warn && logger.warn({ event: 's3.ensure.lifecycle.error', bucket, error: err && err.message ? err.message : String(err) });
  }

  // 7) Optional: CORS for browser uploads (only if explicitly enabled)
  if (enableCors) {
    try {
      // Check existing CORS
      try {
        await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
        logger.info && logger.info({ event: 's3.ensure.cors.exists', bucket });
      } catch (_) {
        const corsRules = [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
            AllowedOrigins: corsAllowedOrigins,
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 300
          }
        ];
        await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: corsRules } }));
        logger.info && logger.info({ event: 's3.ensure.cors.set', bucket, origins: corsAllowedOrigins });
      }
    } catch (err) {
      logger.warn && logger.warn({ event: 's3.ensure.cors.error', bucket, error: err && err.message ? err.message : String(err) });
    }
  }

  logger.info && logger.info({ event: 's3.ensure.complete', bucket });
  return { ok: true, bucket };
}

module.exports = { s3Ensure };
