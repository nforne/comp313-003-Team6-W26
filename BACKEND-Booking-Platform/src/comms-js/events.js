// src/comms-js/events.js
//
// Centralized event and audit helpers for comms-js.
// - Wraps logger and auditService.logEvent with consistent payloads (correlationId, actor, target).
// - Best-effort: failures to audit are logged but do not throw.
// - Exports small helpers used across engine and workers.

const auditService = require('../services/audit.service'); // optional; safe if missing
const DEFAULT_SEVERITY = {
  attempt: 'info',
  success: 'info',
  failure: 'warning',
  error: 'error'
};

/**
 * safeAudit
 * - Best-effort wrapper around auditService.logEvent to avoid bubbling audit failures.
 */
async function safeAudit(event, logger) {
  if (!auditService || typeof auditService.logEvent !== 'function') return;
  try {
    await auditService.logEvent(event);
  } catch (err) {
    // swallow but log locally
    try {
      logger && logger.warn && logger.warn({ event: 'events.audit_failed', auditEvent: event.eventType, error: err && err.message ? err.message : String(err) });
    } catch (_) {}
  }
}

/**
 * emitAttempt
 * - Log and audit a delivery attempt for a single recipient/channel.
 *
 * @param {Object} params
 *  { messageId, userId, channel, attempt, providerId, error, actor, correlationId, logger }
 */
async function emitAttempt(params = {}) {
  const {
    messageId, userId, channel, attempt = 1, providerId = null, error = null,
    actor = null, correlationId = null, logger = console
  } = params;

  const eventType = error ? 'message.delivery.attempt.failed' : 'message.delivery.attempt';
  const outcome = error ? 'failure' : 'success';
  const severity = error ? DEFAULT_SEVERITY.failure : DEFAULT_SEVERITY.attempt;

  // structured log
  logger && logger.info && logger.info({
    event: 'message.delivery.attempt',
    messageId: String(messageId),
    userId,
    channel,
    attempt,
    providerId,
    error: error ? (error.message || error) : null,
    correlationId
  });

  // audit event
  const auditEvent = {
    eventType,
    actor,
    target: { type: 'Message', id: messageId ? String(messageId) : null },
    outcome,
    severity,
    correlationId,
    details: { userId, channel, attempt, providerId, error: error ? (error.message || String(error)) : null }
  };

  await safeAudit(auditEvent, logger);
}

/**
 * emitSuccess
 * - High-level success event for a message or batch.
 *
 * @param {Object} params
 *  { messageId, userId, channel, providerId, actor, correlationId, logger, details }
 */
async function emitSuccess(params = {}) {
  const { messageId, userId = null, channel = null, providerId = null, actor = null, correlationId = null, logger = console, details = {} } = params;

  logger && logger.info && logger.info({
    event: 'message.delivery.success',
    messageId: String(messageId),
    userId,
    channel,
    providerId,
    correlationId,
    details
  });

  const auditEvent = {
    eventType: 'message.delivery.success',
    actor,
    target: { type: 'Message', id: messageId ? String(messageId) : null },
    outcome: 'success',
    severity: DEFAULT_SEVERITY.success,
    correlationId,
    details: Object.assign({ userId, channel, providerId }, details)
  };

  await safeAudit(auditEvent, logger);
}

/**
 * emitFailure
 * - High-level failure event for a message, batch, or recipient after retries exhausted.
 *
 * @param {Object} params
 *  { messageId, userId, channel, error, actor, correlationId, logger, details }
 */
async function emitFailure(params = {}) {
  const { messageId, userId = null, channel = null, error = null, actor = null, correlationId = null, logger = console, details = {} } = params;

  logger && logger.error && logger.error({
    event: 'message.delivery.failure',
    messageId: String(messageId),
    userId,
    channel,
    error: error ? (error.message || String(error)) : null,
    correlationId,
    details
  });

  const auditEvent = {
    eventType: 'message.delivery.failed',
    actor,
    target: { type: 'Message', id: messageId ? String(messageId) : null },
    outcome: 'failure',
    severity: DEFAULT_SEVERITY.error,
    correlationId,
    details: Object.assign({ userId, channel, error: error ? (error.message || String(error)) : null }, details)
  };

  await safeAudit(auditEvent, logger);
}

/**
 * emitEnqueued
 * - Emit when broadcast batches are enqueued for async processing.
 *
 * @param {Object} params
 *  { messageId, batchCount, actor, correlationId, logger }
 */
async function emitEnqueued(params = {}) {
  const { messageId, batchCount = 0, actor = null, correlationId = null, logger = console } = params;

  logger && logger.info && logger.info({
    event: 'message.delivery.enqueued',
    messageId: String(messageId),
    batchCount,
    correlationId
  });

  const auditEvent = {
    eventType: 'message.delivery.enqueued',
    actor,
    target: { type: 'Message', id: messageId ? String(messageId) : null },
    outcome: 'info',
    severity: 'info',
    correlationId,
    details: { batchCount }
  };

  await safeAudit(auditEvent, logger);
}

/**
 * emitBatchSummary
 * - Emit a summary for a processed batch (used by batch.worker).
 *
 * @param {Object} params
 *  { messageId, batchSize, successful, failed, actor, correlationId, logger }
 */
async function emitBatchSummary(params = {}) {
  const { messageId, batchSize = 0, successful = 0, failed = 0, actor = null, correlationId = null, logger = console } = params;

  logger && logger.info && logger.info({
    event: 'message.delivery.batch_summary',
    messageId: String(messageId),
    batchSize,
    successful,
    failed,
    correlationId
  });

  const auditEvent = {
    eventType: 'message.delivery.batch_summary',
    actor,
    target: { type: 'Message', id: messageId ? String(messageId) : null },
    outcome: failed > 0 ? 'partial' : 'success',
    severity: failed > 0 ? DEFAULT_SEVERITY.failure : DEFAULT_SEVERITY.success,
    correlationId,
    details: { batchSize, successful, failed }
  };

  await safeAudit(auditEvent, logger);
}

module.exports = {
  emitAttempt,
  emitSuccess,
  emitFailure,
  emitEnqueued,
  emitBatchSummary
};
