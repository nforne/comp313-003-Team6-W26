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
// - This script uses AWS SDK v3 and the credential-aware getS3Client from src/utils/s3.client.factory.
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

const DEFAULT_BUCKET = 'comp313-booking-platform';

const { getS3Client } = require('../utils/s3.client.factory');

/**
 * Resolve region value
 * - Accepts a string or a function (sync or async) and returns a string region.
 */
async function resolveRegion(maybeRegion) {
  if (!maybeRegion) return undefined;
  try {
    if (typeof maybeRegion === 'function') {
      const r = maybeRegion();
      return (r && typeof r.then === 'function') ? await r : r;
    }
    return maybeRegion;
  } catch (e) {
    return undefined;
  }
}

/**
 * s3Ensure
 * @param {Object} opts
 * @param {string} [opts.bucket=DEFAULT_BUCKET] - bucket name to ensure
 * @param {string|Function} [opts.region] - AWS region override or provider function
 * @param {Object} [opts.logger] - logger with .info/.warn/.error
 * @param {boolean} [opts.enableCors=false] - whether to apply a permissive CORS rule (adjust for prod)
 * @param {string[]} [opts.corsAllowedOrigins] - origins allowed for CORS (defaults to ['*'] when enableCors true)
 */
async function s3Ensure(opts = {}) {
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const providedRegion = await resolveRegion(opts.region || process.env.AWS_REGION);
  const logger = (opts.logger && typeof opts.logger === 'object') ? opts.logger : console;
  const enableCors = !!opts.enableCors;
  const corsAllowedOrigins = Array.isArray(opts.corsAllowedOrigins) && opts.corsAllowedOrigins.length
    ? opts.corsAllowedOrigins
    : ['*'];

  // Create S3 client with resolved region so client and create params align
  const s3 = getS3Client({ region: providedRegion });

  // Determine effective client region (s3.config.region may be a provider)
  const clientRegionRaw = s3 && s3.config && s3.config.region ? s3.config.region : providedRegion;
  const clientRegion = await resolveRegion(clientRegionRaw) || providedRegion || process.env.AWS_REGION || 'us-east-1';

  logger.info && logger.info({ event: 's3.ensure.start', bucket, region: clientRegion });

  // Helper to run a command and swallow NotFound-like errors for "get" calls
  async function safeSend(cmd) {
    try {
      return await s3.send(cmd);
    } catch (err) {
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
    const code = err && (err.name || (err.$metadata && err.$metadata.httpStatusCode));
    logger.info && logger.info({ event: 's3.ensure.headBucket.failed', bucket, code, message: err && err.message ? err.message : String(err) });
    bucketExists = false;
  }

  // 2) Create bucket if missing
  if (!bucketExists) {
    try {
      const createParams = { Bucket: bucket };
      // For non-us-east-1, include CreateBucketConfiguration
      if (clientRegion && clientRegion !== 'us-east-1') {
        createParams.CreateBucketConfiguration = { LocationConstraint: clientRegion };
      }
      try {
        await s3.send(new CreateBucketCommand(createParams));
        logger.info && logger.info({ event: 's3.ensure.bucket.created', bucket, region: clientRegion });
        bucketExists = true;
      } catch (createErr) {
        // If AWS complains about LocationConstraint, retry without it (handles us-east-1 and provider quirks)
        const msg = createErr && createErr.message ? String(createErr.message).toLowerCase() : '';
        if (createErr && (createErr.name === 'InvalidLocationConstraint' || /location-constraint/i.test(msg))) {
          logger.warn && logger.warn({ event: 's3.ensure.bucket.create.locationConstraint', bucket, region: clientRegion, message: createErr.message });
          try {
            await s3.send(new CreateBucketCommand({ Bucket: bucket }));
            logger.info && logger.info({ event: 's3.ensure.bucket.created.fallback', bucket });
            bucketExists = true;
          } catch (fallbackErr) {
            logger.error && logger.error({ event: 's3.ensure.bucket.create.error', bucket, error: fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr) });
            throw fallbackErr;
          }
        } else {
          logger.error && logger.error({ event: 's3.ensure.bucket.create.error', bucket, error: createErr && createErr.message ? createErr.message : String(createErr) });
          throw createErr;
        }
      }
    } catch (err) {
      throw err;
    }
  }

  if (!bucketExists) {
    const err = new Error(`bucket ${bucket} not available`);
    logger.error && logger.error({ event: 's3.ensure.failed', bucket, error: err.message });
    throw err;
  }

  // 3) Apply PublicAccessBlock (block public ACLs and policies) - idempotent
  try {
    try {
      await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      logger.info && logger.info({ event: 's3.ensure.publicAccessBlock.exists', bucket });
    } catch (_) {
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
    let needPutLifecycle = false;
    try {
      const existing = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
      logger.info && logger.info({ event: 's3.ensure.lifecycle.exists', bucket, rules: (existing && existing.Rules && existing.Rules.length) || 0 });
    } catch (getErr) {
      needPutLifecycle = true;
    }

    if (needPutLifecycle) {
      const lifecycle = {
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-noncurrent-versions-365',
              Status: 'Enabled',
              NoncurrentVersionExpiration: { NoncurrentDays: 365 },
              Filter: {}
            },
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
