// src/comms-js/config.js
//
// Centralized configuration for comms-js.
// - Values may be overridden via environment variables.
// - Keep defaults conservative for safety in production.

const toInt = (v, fallback) => {
  if (typeof v === 'undefined' || v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

const toBool = (v, fallback = false) => {
  if (typeof v === 'undefined' || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(s);
};

const config = {
  // Batching
  broadcastBatchSize: toInt(process.env.COMMS_BROADCAST_BATCH_SIZE, 10),
  limitedBatchSize: toInt(process.env.COMMS_LIMITED_BATCH_SIZE, 5),

  // Concurrency and worker tuning
  batchConcurrency: toInt(process.env.COMMS_BATCH_CONCURRENCY, 5), // per-batch parallelism for recipients
  maxParallelBatches: toInt(process.env.COMMS_MAX_PARALLEL_BATCHES, 3), // if orchestrating parallel batch dispatch

  // Retry / backoff
  maxRetries: toInt(process.env.COMMS_MAX_RETRIES, 3),
  backoffBaseMs: toInt(process.env.COMMS_BACKOFF_BASE_MS, 500),
  backoffMaxMs: toInt(process.env.COMMS_BACKOFF_MAX_MS, 30000),
  backoffJitter: toBool(process.env.COMMS_BACKOFF_JITTER, true),
  backoffJitterFactor: parseFloat(process.env.COMMS_BACKOFF_JITTER_FACTOR || '0.5'),

  // Timeouts
  providerTimeoutMs: toInt(process.env.COMMS_PROVIDER_TIMEOUT_MS, 15000),

  // Email provider defaults
  emailFrom: process.env.COMMS_EMAIL_FROM || process.env.EMAIL_FROM || 'no-reply@example.com',
  useSES: toBool(process.env.COMMS_USE_SES, !!process.env.AWS_REGION),
  sesRegion: process.env.AWS_REGION || process.env.COMMS_SES_REGION || null,
  sesEndpoint: process.env.COMMS_SES_ENDPOINT || null,

  // SMTP fallback (nodemailer)
  smtp: {
    host: process.env.COMMS_SMTP_HOST || process.env.SMTP_HOST || null,
    port: toInt(process.env.COMMS_SMTP_PORT || process.env.SMTP_PORT, 587),
    secure: toBool(process.env.COMMS_SMTP_SECURE, false),
    auth: process.env.COMMS_SMTP_USER ? {
      user: process.env.COMMS_SMTP_USER,
      pass: process.env.COMMS_SMTP_PASS
    } : undefined,
    tls: undefined
  },

  // Provider toggles
  enableEmail: toBool(process.env.COMMS_ENABLE_EMAIL, true),
  enableInApp: toBool(process.env.COMMS_ENABLE_IN_APP, true),

  // Limits and safety
  maxRecipientsPerMessage: toInt(process.env.COMMS_MAX_RECIPIENTS_PER_MESSAGE, 10000), // guardrail
  maxAttachmentSizeBytes: toInt(process.env.COMMS_MAX_ATTACHMENT_SIZE_BYTES, 10 * 1024 * 1024), // 10 MB

  // Logging / instrumentation
  emitAuditEvents: toBool(process.env.COMMS_EMIT_AUDIT_EVENTS, true),

  // Misc
  defaultLocale: process.env.COMMS_DEFAULT_LOCALE || 'en-US'
};

module.exports = config;
