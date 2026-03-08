// src/comms-js/workers/batch.worker.js
//
// Batch worker for comms-js delivery engine.
// - Processes a single batch of recipients for a given message.
// - Sends per-recipient via configured providers (email, in_app).
// - Retries transient failures with exponential backoff.
// - Persists per-recipient delivery metadata to the Message record via messageRepo.
// - Emits audit/log events via provided logger/auditService (best-effort).
//
// Expected batchPayload:
// {
//   messageId: '...',                 // string
//   recipientIds: ['u1','u2',...],    // array of userId strings
//   channels: ['email','in_app'],     // channels to attempt
//   attempt: 1,                        // current batch attempt (for batch-level retry tracking)
//   metadata: { correlationId, actor } // optional
// }

const messageRepo = require('../../repositories/message.repo');
const userRepo = require('../../repositories/user.repo');
const emailProvider = require('../providers/email.provider');
const notificationProvider = require('../providers/notification.provider');
const backoff = require('../utils/backoff');
const config = require('../config');
const auditService = require('../../services/audit.service'); // optional

const DEFAULT_MAX_RETRIES = config.maxRetries || 3;
const DEFAULT_BACKOFF_MS = config.backoffBaseMs || 500;

/**
 * processBatch
 * @param {Object} batchPayload
 * @returns {Promise<{ results: Array<{ userId, ok, channelResults: { [channel]: { ok, attempts, providerId?, error? } } }> }>}
 */
async function processBatch(batchPayload = {}) {
  const {
    messageId,
    recipientIds = [],
    channels = ['in_app'],
    attempt = 1,
    metadata = {}
  } = batchPayload;

  const logger = (metadata && metadata.logger) || console;
  const correlationId = (metadata && metadata.correlationId) || null;
  const actor = (metadata && metadata.actor) || null;

  if (!messageId) {
    const e = new Error('batch_missing_messageId');
    e.status = 400;
    throw e;
  }

  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return { results: [] };
  }

  logger.info && logger.info({ event: 'batch.process.start', messageId, batchSize: recipientIds.length, attempt, correlationId });

  // Load message once for context (subject/body/attachments/metadata)
  const message = await messageRepo.findById(messageId, { visibleOnly: false });
  if (!message) {
    const err = new Error('message_not_found');
    err.status = 404;
    throw err;
  }

  // Prepare content for providers (rendering assumed done earlier; use message.subject/details)
  const subject = message.subject || '';
  const body = message.details || '';
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  // Helper: persist per-recipient/channel delivery metadata into message.metadata.deliveryInfo
  async function persistDeliveryInfo(userId, channel, info = {}) {
    try {
      const key = `metadata.deliveryInfo.${userId}.${channel}`;
      const update = {};
      update[key] = Object.assign({}, info);
      await messageRepo.updateMessage(messageId, update);
    } catch (err) {
      logger.error && logger.error({ event: 'batch.persist_delivery_info_failed', messageId, userId, channel, error: err && err.message ? err.message : String(err), correlationId });
    }
  }

  // Helper: send to a single recipient for a single channel with retries
  async function sendWithRetries(user, userId, channel) {
    let attempts = 0;
    let lastError = null;
    let providerId = null;

    const maxAttempts = DEFAULT_MAX_RETRIES;

    // function that attempts a single send
    async function attemptSend() {
      attempts += 1;
      if (channel === 'email') {
        // Ensure we have an email address
        const email = (user && user.emails && user.emails[0] && user.emails[0].value) ? user.emails[0].value : null;
        if (!email) {
          throw new Error('no_email_for_user');
        }
        const res = await emailProvider.sendEmail({ to: email, subject, body, attachments, messageId, userId, correlationId });
        if (!res || !res.ok) {
          const errMsg = (res && res.error) ? res.error : 'email_send_failed';
          const err = new Error(errMsg);
          err.providerId = res && res.providerId ? res.providerId : null;
          throw err;
        }
        providerId = res.providerId || null;
        return { ok: true, providerId };
      }

      if (channel === 'in_app' || channel === 'notification' || channel === 'ws') {
        const res = await notificationProvider.publishNotification(userId, {
          messageId,
          subject,
          body,
          attachments,
          metadata: message.metadata || {}
        }, { correlationId });
        if (!res || !res.ok) {
          const errMsg = (res && res.error) ? res.error : 'notification_send_failed';
          const err = new Error(errMsg);
          err.providerId = res && res.providerId ? res.providerId : null;
          throw err;
        }
        providerId = res.providerId || null;
        return { ok: true, providerId };
      }

      // Unknown channel
      throw new Error(`unsupported_channel:${channel}`);
    }

    // Retry loop with exponential backoff
    try {
      const result = await backoff.retry(async () => {
        return attemptSend();
      }, { attempts: maxAttempts, backoffMs: DEFAULT_BACKOFF_MS, logger });
      // persist success info
      await persistDeliveryInfo(userId, channel, { ok: true, attempts, providerId, lastAttemptAt: new Date() });
      return { ok: true, attempts, providerId };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      // persist failure info
      await persistDeliveryInfo(userId, channel, { ok: false, attempts, error: lastError, lastAttemptAt: new Date() });
      return { ok: false, attempts, error: lastError, providerId: err && err.providerId ? err.providerId : null };
    }
  }

  // Process recipients. We'll run per-recipient sends in parallel but limit concurrency to avoid spikes.
  const concurrency = Math.max(1, config.batchConcurrency || 5);
  const results = [];
  let idx = 0;

  async function workerLoop() {
    while (true) {
      let i;
      // simple atomic index increment
      i = idx;
      idx += 1;
      if (i >= recipientIds.length) return;
      const userId = recipientIds[i];
      try {
        // fetch user public info
        const user = await userRepo.findPublicById(userId);
        if (!user) {
          // persist missing user as failure for each channel
          for (const ch of channels) {
            await persistDeliveryInfo(userId, ch, { ok: false, attempts: 0, error: 'user_not_found', lastAttemptAt: new Date() });
          }
          results.push({ userId, ok: false, channelResults: channels.reduce((acc, ch) => (acc[ch] = { ok: false, attempts: 0, error: 'user_not_found' }, acc), {}) });
          // emit audit event
          try {
            await auditService.logEvent({
              eventType: 'message.delivery.user_not_found',
              actor,
              target: { type: 'Message', id: messageId },
              outcome: 'failure',
              severity: 'warning',
              correlationId,
              details: { userId }
            });
          } catch (_) {}
          continue;
        }

        const channelResults = {};
        // For each channel, attempt send (sequential per user to preserve ordering and reduce provider concurrency)
        for (const ch of channels) {
          const res = await sendWithRetries(user, userId, ch);
          channelResults[ch] = res;
          // emit per-channel attempt events
          try {
            await auditService.logEvent({
              eventType: res.ok ? 'message.delivery.attempt.success' : 'message.delivery.attempt.failed',
              actor,
              target: { type: 'Message', id: messageId },
              outcome: res.ok ? 'success' : 'failure',
              severity: res.ok ? 'info' : 'warning',
              correlationId,
              details: { userId, channel: ch, attempts: res.attempts, providerId: res.providerId || null, error: res.error || null }
            });
          } catch (_) {}
        }

        const ok = Object.values(channelResults).every(r => r && r.ok);
        results.push({ userId, ok, channelResults });
      } catch (err) {
        // unexpected error for this recipient
        const errMsg = err && err.message ? err.message : String(err);
        for (const ch of channels) {
          await persistDeliveryInfo(recipientIds[i], ch, { ok: false, attempts: 0, error: errMsg, lastAttemptAt: new Date() });
        }
        results.push({ userId: recipientIds[i], ok: false, channelResults: channels.reduce((acc, ch) => (acc[ch] = { ok: false, attempts: 0, error: errMsg }, acc), {}) });
        logger.error && logger.error({ event: 'batch.recipient_unexpected_error', messageId, userId: recipientIds[i], error: errMsg, correlationId });
        try {
          await auditService.logEvent({
            eventType: 'message.delivery.recipient_error',
            actor,
            target: { type: 'Message', id: messageId },
            outcome: 'failure',
            severity: 'error',
            correlationId,
            details: { userId: recipientIds[i], error: errMsg }
          });
        } catch (_) {}
      }
    }
  }

  // spawn worker loops
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, recipientIds.length); w++) {
    workers.push(workerLoop());
  }
  await Promise.all(workers);

  // After processing batch, update message-level metadata summary for this batch
  try {
    const summary = {
      batchSize: recipientIds.length,
      processedAt: new Date(),
      resultsSummary: {
        total: results.length,
        successful: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length
      }
    };
    // append to message.metadata.batchHistory array
    const key = 'metadata.batchHistory';
    const update = {};
    update[key] = (message.metadata && Array.isArray(message.metadata.batchHistory) ? message.metadata.batchHistory.concat([summary]) : [summary]);
    await messageRepo.updateMessage(messageId, update);
  } catch (err) {
    logger.error && logger.error({ event: 'batch.update_message_summary_failed', messageId, error: err && err.message ? err.message : String(err), correlationId });
  }

  logger.info && logger.info({ event: 'batch.process.completed', messageId, batchSize: recipientIds.length, successful: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, correlationId });

  return { results };
}

module.exports = { processBatch };
