// src/utils/s3.client.factory.js
//
// Credential-aware S3 client factory.
// - Precedence: environment credentials -> shared credentials/profile (~/.aws/credentials) -> SDK default provider chain.
// - Designed for local/dev (env or profile) and cloud deployments (instance/task role, web identity) without deployment changes.
// - Returns a configured S3Client instance. Credential resolution for provider functions is deferred until the client makes requests.
// - Safe to call repeatedly; S3Client is lightweight. Consider caching clients externally if you want reuse.
//
// Usage:
//   const { getS3Client } = require('./utils/s3.client.factory');
//   const s3 = getS3Client({ region: 'ca-central-1', profile: 'dev', logger, forceEnvCreds: false });
//
// Notes:
// - fromIni() and defaultProvider() return credential provider functions; actual credential retrieval happens later (on first request).
// - forceEnvCreds currently logs a warning when env creds are requested but missing and falls back to the default provider.
//   If you prefer strict behavior (throw on missing env creds), change the `forceEnvCreds` handling accordingly.

const { S3Client } = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

/**
 * Return a safe logger object with info/warn/error methods.
 * If a logger is not provided, fall back to console but keep method checks.
 *
 * @param {Object} logger
 * @returns {{info: Function, warn: Function, error: Function}}
 */
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

/**
 * getS3Client
 *
 * Create a configured S3Client using the following precedence:
 *  1. Environment credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY [+ AWS_SESSION_TOKEN])
 *  2. Shared credentials/profile via fromIni(profile) (reads ~/.aws/credentials or AWS config)
 *  3. SDK default provider chain (instance role, task role, web identity, etc.)
 *
 * Credential resolution for provider functions (fromIni/defaultProvider) is deferred until the client makes requests.
 *
 * @param {Object} opts
 * @param {string} [opts.region] - AWS region (falls back to AWS_REGION env or 'us-east-1')
 * @param {string} [opts.profile] - AWS profile name to prefer from ~/.aws/credentials
 * @param {Object} [opts.logger] - logger with .info/.warn/.error
 * @param {boolean} [opts.forceEnvCreds] - if true, prefer env creds and log a warning if missing (non-fatal)
 * @returns {S3Client}
 */
function getS3Client(opts = {}) {
  const logger = safeLogger(opts.logger);
  const region = opts.region || process.env.AWS_REGION || 'us-east-1';
  const profile = opts.profile || process.env.AWS_PROFILE || undefined;
  const forceEnv = !!opts.forceEnvCreds;

  // Validate partial env credentials and log a helpful message
  const hasAccessKey = !!process.env.AWS_ACCESS_KEY_ID;
  const hasSecretKey = !!process.env.AWS_SECRET_ACCESS_KEY;
  const hasSessionToken = !!process.env.AWS_SESSION_TOKEN;

  if (hasAccessKey && !hasSecretKey) {
    logger.warn({ event: 's3.client.factory', message: 'AWS_ACCESS_KEY_ID present but AWS_SECRET_ACCESS_KEY missing' });
  } else if (!hasAccessKey && hasSecretKey) {
    logger.warn({ event: 's3.client.factory', message: 'AWS_SECRET_ACCESS_KEY present but AWS_ACCESS_KEY_ID missing' });
  }

  // 1) Environment credentials (explicit)
  if (hasAccessKey && hasSecretKey) {
    logger.info({ event: 's3.client.factory', method: 'env_creds', region });
    return new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: hasSessionToken ? process.env.AWS_SESSION_TOKEN : undefined
      }
    });
  }

  // If caller requested env creds only, warn and continue to fallbacks (non-fatal)
  if (forceEnv) {
    logger.warn({ event: 's3.client.factory', message: 'forceEnvCreds set but env creds missing; falling back to profile/default provider', region });
    // Return a client using default provider (so callers still get a usable client)
    return new S3Client({ region, credentials: defaultProvider() });
  }

  // 2) Try shared credentials/profile via fromIni
  // fromIni returns a credential provider function; synchronous errors are rare but handled.
  try {
    if (profile) {
      logger.info({ event: 's3.client.factory', method: 'profile', profile, region });
      return new S3Client({ region, credentials: fromIni({ profile }) });
    }

    logger.info({ event: 's3.client.factory', method: 'fromIniDefault', region });
    return new S3Client({ region, credentials: fromIni() });
  } catch (e) {
    // fromIni rarely throws synchronously; log and fall through to default provider
    logger.info({ event: 's3.client.factory', method: 'fromIni_failed', error: e && e.message ? e.message : String(e), region });
  }

  // 3) Fallback: default provider chain (instance role, task role, web identity, etc.)
  logger.info({ event: 's3.client.factory', method: 'default_provider', region });
  return new S3Client({ region, credentials: defaultProvider() });
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = { getS3Client };
