// src/comms-js/engine.js
//
// Orchestration layer for comms-js delivery engine.
// - Resolves recipients (broadcast vs explicit list).
// - Chooses batching strategy: broadcast => 10 per batch (async), limited list => realtime or 5-per-batch.
// - Dispatches batches to batch.worker (async for broadcast, sync/await for small lists).
// - Aggregates per-recipient results for synchronous flows and returns a delivery summary.
// - Emits audit/log events via auditService and uses provided logger.

const userRepo = require('../repositories/user.repo');
const messageRepo = require('../repositories/message.repo');
const batchWorker = require('./workers/batch.worker');
const auditService = require('../services/audit.service'); // optional
const { paginateArray } = require('./utils/recipients');
const config = require('./config');

const DEFAULT_BROADCAST_BATCH_SIZE = config.broadcastBatchSize || 10;
const DEFAULT_LIMITED_BATCH_SIZE = config.limitedBatchSize || 5;

/**
 * processMessage
 * @param {Object} messageDoc - Mongoose Message document (not lean)
 * @param {Object} opts - { actor, logger, correlationId, asyncBroadcast=true }
 *
 * Returns:
 *  - { ok: true, deliveryInfo } for synchronous completion
 *  - { ok: true, asyncEnqueued: true } when broadcast batches were enqueued for async processing
 *  - throws on fatal errors
 */
async function processMessage(messageDoc, opts = {}) {
  const logger = (opts && opts.logger) || console;
  const correlationId = opts.correlationId || null;
  const actor = opts.actor || null;
  const asyncBroadcast = typeof opts.asyncBroadcast === 'undefined' ? true : !!opts.asyncBroadcast;

  if (!messageDoc || !messageDoc._id) {
    const e = new Error('invalid_message_document');
    e.status = 400;
    throw e;
  }

  logger.info && logger.info({ event: 'engine.process.start', messageId: String(messageDoc._id), correlationId });

  // Determine recipients
  let recipientIds = [];
  try {
    if (messageDoc.recipientsAll) {
      // Broadcast: we will stream user ids and create batches later
      logger.info && logger.info({ event: 'engine.process.broadcast', messageId: String(messageDoc._id), correlationId });
      if (asyncBroadcast) {
        // Build and enqueue batches asynchronously (non-blocking)
        enqueueBroadcastBatches(messageDoc, { logger, correlationId, actor });
        return { ok: true, asyncEnqueued: true };
      } else {
        // synchronous broadcast: stream and build batches, process sequentially
        recipientIds = await collectAllUserIds();
      }
    } else {
      // Limited recipients: use explicit recipients array on message
      if (Array.isArray(messageDoc.recipients) && messageDoc.recipients.length) {
        recipientIds = messageDoc.recipients.map(r => String(r));
      } else {
        // No recipients: nothing to do
        logger.warn && logger.warn({ event: 'engine.process.no_recipients', messageId: String(messageDoc._id), correlationId });
        return { ok: true, deliveryInfo: { note: 'no_recipients' } };
      }
    }
  } catch (err) {
    logger.error && logger.error({ event: 'engine.process.resolve_recipients_failed', messageId: String(messageDoc._id), error: err && err.message ? err.message : String(err), correlationId });
    throw err;
  }

  // If limited list and small, send realtime (sequential) for low latency
  if (!messageDoc.recipientsAll) {
    if (recipientIds.length < DEFAULT_LIMITED_BATCH_SIZE) {
      // send sequentially, aggregating results
      const perRecipientResults = [];
      for (const uid of recipientIds) {
        try {
          const batchPayload = {
            messageId: String(messageDoc._id),
            recipientIds: [uid],
            channels: deriveChannelsFromMessage(messageDoc),
            attempt: 1,
            metadata: { correlationId, actor }
          };
          // processBatch returns per-recipient results
          const batchResult = await batchWorker.processBatch(batchPayload);
          perRecipientResults.push(...(batchResult.results || []));
        } catch (err) {
          // record failure for this recipient
          perRecipientResults.push({ userId: uid, ok: false, error: err && err.message ? err.message : String(err) });
        }
      }

      const summary = summarizeResults(perRecipientResults);
      logger.info && logger.info({ event: 'engine.process.completed', messageId: String(messageDoc._id), summary, correlationId });

      return { ok: summary.successful === summary.total, deliveryInfo: { perRecipient: perRecipientResults, summary } };
    }

    // limited list but >= threshold: paginate into batches of DEFAULT_LIMITED_BATCH_SIZE and process sequentially
    const batches = paginateArray(recipientIds, DEFAULT_LIMITED_BATCH_SIZE);
    const allResults = [];
    for (const batch of batches) {
      const batchPayload = {
        messageId: String(messageDoc._id),
        recipientIds: batch,
        channels: deriveChannelsFromMessage(messageDoc),
        attempt: 1,
        metadata: { correlationId, actor }
      };
      try {
        const batchResult = await batchWorker.processBatch(batchPayload);
        allResults.push(...(batchResult.results || []));
      } catch (err) {
        // mark each recipient in batch as failed
        batch.forEach(uid => allResults.push({ userId: uid, ok: false, error: err && err.message ? err.message : String(err) }));
      }
    }

    const summary = summarizeResults(allResults);
    logger.info && logger.info({ event: 'engine.process.completed', messageId: String(messageDoc._id), summary, correlationId });
    return { ok: summary.successful === summary.total, deliveryInfo: { perRecipient: allResults, summary } };
  }

  // If we reach here, it's a synchronous broadcast (asyncBroadcast was false)
  // recipientIds was populated by collectAllUserIds()
  if (messageDoc.recipientsAll) {
    const batches = paginateArray(recipientIds, DEFAULT_BROADCAST_BATCH_SIZE);
    const allResults = [];
    for (const batch of batches) {
      const batchPayload = {
        messageId: String(messageDoc._id),
        recipientIds: batch,
        channels: deriveChannelsFromMessage(messageDoc),
        attempt: 1,
        metadata: { correlationId, actor }
      };
      try {
        const batchResult = await batchWorker.processBatch(batchPayload);
        allResults.push(...(batchResult.results || []));
      } catch (err) {
        batch.forEach(uid => allResults.push({ userId: uid, ok: false, error: err && err.message ? err.message : String(err) }));
      }
    }

    const summary = summarizeResults(allResults);
    logger.info && logger.info({ event: 'engine.process.completed.broadcast', messageId: String(messageDoc._id), summary, correlationId });
    return { ok: summary.successful === summary.total, deliveryInfo: { perRecipient: allResults, summary } };
  }

  // Fallback: nothing processed
  return { ok: true, deliveryInfo: { note: 'no_action' } };
}

/* -------------------------
 * Helpers
 * ------------------------- */

/**
 * enqueueBroadcastBatches
 * - Streams all user ids and enqueues batchWorker.processBatch asynchronously for each batch.
 * - Non-blocking: does not await batch processing.
 */
function enqueueBroadcastBatches(messageDoc, { logger, correlationId, actor } = {}) {
  const batchSize = DEFAULT_BROADCAST_BATCH_SIZE;
  const cursor = userRepo.streamAllUserIds({}, { userId: 1, _id: 0 }, { batchSize: 1000 });

  // Build batches incrementally
  const batches = [];
  let currentBatch = [];

  // iterate cursor asynchronously without awaiting processing
  (async () => {
    try {
      for await (const doc of cursor) {
        currentBatch.push(String(doc.userId));
        if (currentBatch.length >= batchSize) {
          batches.push(currentBatch);
          // dispatch asynchronously
          dispatchBatchAsync(messageDoc, currentBatch, { logger, correlationId, actor });
          currentBatch = [];
        }
      }
      if (currentBatch.length) {
        batches.push(currentBatch);
        dispatchBatchAsync(messageDoc, currentBatch, { logger, correlationId, actor });
      }
      logger.info && logger.info({ event: 'engine.enqueue.broadcast_batches_done', messageId: String(messageDoc._id), batches: batches.length, correlationId });
    } catch (err) {
      logger.error && logger.error({ event: 'engine.enqueue.broadcast_failed', messageId: String(messageDoc._id), error: err && err.message ? err.message : String(err), correlationId });
      try {
        await auditService.logEvent({
          eventType: 'message.delivery.enqueue_failed',
          actor,
          target: { type: 'Message', id: messageDoc._id.toString() },
          outcome: 'failure',
          severity: 'error',
          correlationId,
          details: { error: err && err.message ? err.message : String(err) }
        });
      } catch (_) {}
    }
  })();
}

/**
 * dispatchBatchAsync
 * - Fire-and-forget dispatch of a batch to the batch worker.
 */
function dispatchBatchAsync(messageDoc, recipientIds, { logger, correlationId, actor } = {}) {
  const payload = {
    messageId: String(messageDoc._id),
    recipientIds,
    channels: deriveChannelsFromMessage(messageDoc),
    attempt: 1,
    metadata: { correlationId, actor }
  };

  // schedule on next tick to avoid blocking
  Promise.resolve().then(() => {
    batchWorker.processBatch(payload).catch(err => {
      logger.error && logger.error({ event: 'engine.batch.async_error', messageId: String(messageDoc._id), error: err && err.message ? err.message : String(err), correlationId, batchSize: recipientIds.length });
      // best-effort audit
      auditService.logEvent({
        eventType: 'message.delivery.batch_failed_async',
        actor,
        target: { type: 'Message', id: messageDoc._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { error: err && err.message ? err.message : String(err), batchSize: recipientIds.length }
      }).catch(() => {});
    });
  });
}

/**
 * collectAllUserIds
 * - Collects all userIds into an array (use with caution for small user bases or when asyncBroadcast=false).
 */
async function collectAllUserIds() {
  const ids = [];
  const cursor = userRepo.streamAllUserIds();
  for await (const doc of cursor) {
    ids.push(String(doc.userId));
  }
  return ids;
}

/**
 * deriveChannelsFromMessage
 * - Determine which channels to use based on message type and metadata.
 * - Default: in-app notification for most types; email if type === 'email' or metadata.channels includes 'email'.
 */
function deriveChannelsFromMessage(messageDoc) {
  const metaChannels = (messageDoc.metadata && messageDoc.metadata.channels) || null;
  if (Array.isArray(metaChannels) && metaChannels.length) return metaChannels;

  // Type-based defaults
  switch (messageDoc.type) {
    case 'email':
      return ['email'];
    case 'notification':
    case 'issue_wall':
    case 'booking':
    case 'review':
    default:
      // default to in-app; callers can request email via metadata
      return ['in_app'];
  }
}

/**
 * summarizeResults
 * - Aggregates per-recipient results into a small summary.
 */
function summarizeResults(perRecipientResults = []) {
  const total = perRecipientResults.length;
  const successful = perRecipientResults.filter(r => r && r.ok).length;
  const failed = total - successful;
  const failures = perRecipientResults.filter(r => !r || !r.ok).map(r => ({ userId: r.userId, error: r.error || 'unknown' }));
  return { total, successful, failed, failures };
}

module.exports = { processMessage };
