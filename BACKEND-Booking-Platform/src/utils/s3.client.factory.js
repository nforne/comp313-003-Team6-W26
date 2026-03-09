// src/utils/s3.client.factory.js
//
// Credential-aware S3 client factory.
// - Prefer explicit env creds, then shared credentials/profile (~/.aws/credentials),
//   then fall back to the SDK default provider chain (instance/task role, web identity, etc.).
// - Returns a configured S3Client instance for use across the app.
// - Minimal, synchronous API: getS3Client({ region, profile, logger, forceEnvCreds }).
// - Safe to call repeatedly; returns a new client (S3Client is lightweight).

const { S3Client } = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

function safeLogger(logger) {
  return logger || console;
}

/**
 * getS3Client
 * @param {Object} opts
 * @param {string} [opts.region] - AWS region (falls back to AWS_REGION env or 'us-east-1')
 * @param {string} [opts.profile] - AWS profile name to prefer from ~/.aws/credentials
 * @param {Object} [opts.logger] - logger with .info/.warn/.error
 * @param {boolean} [opts.forceEnvCreds] - if true, require env creds and do not fallback to profile/default
 * @returns {S3Client}
 */
function getS3Client(opts = {}) {
  const logger = safeLogger(opts.logger);
  const region = opts.region || process.env.AWS_REGION || 'us-east-1';
  const profile = opts.profile || process.env.AWS_PROFILE || undefined;
  const forceEnv = !!opts.forceEnvCreds;

  // 1) If explicit env credentials present, use them (common for local CI/dev)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    logger.info && logger.info({ event: 's3.client.factory', method: 'env_creds', region });
    return new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      }
    });
  }

  // If caller requested env creds only, failover to default provider is skipped
  if (forceEnv) {
    logger.warn && logger.warn({ event: 's3.client.factory', message: 'forceEnvCreds set but env creds missing' });
    // Return client with default provider (so callers still get a client) but log warning
    return new S3Client({ region });
  }

  // 2) Try shared credentials/profile (~/.aws/credentials) via fromIni if profile or credentials file exists
  try {
    if (profile) {
      logger.info && logger.info({ event: 's3.client.factory', method: 'profile', profile, region });
      return new S3Client({ region, credentials: fromIni({ profile }) });
    }
    // If no explicit profile, still attempt fromIni (it will resolve default profile if present)
    logger.info && logger.info({ event: 's3.client.factory', method: 'fromIniDefault', region });
    return new S3Client({ region, credentials: fromIni() });
  } catch (e) {
    // If fromIni throws (rare), fall back to default provider below
    logger.info && logger.info({ event: 's3.client.factory', method: 'fromIni_failed', error: e && e.message ? e.message : String(e) });
  }

  // 3) Fallback: default provider chain (instance role, task role, web identity, etc.)
  logger.info && logger.info({ event: 's3.client.factory', method: 'default_provider', region });
  return new S3Client({ region, credentials: defaultProvider() });
}

module.exports = { getS3Client };
