// src/comms-js/index.js
//
// Public entrypoint for the comms-js delivery engine.
// - Loads a persisted Message by id and kicks off delivery orchestration in src/comms-js/engine.js.
// - Performs basic validation, high-level audit/log events, and finalizes message status on success.
// - Integrates with existing repositories, logger, and auditService.

const messageRepo = require('../repositories/message.repo');
const Message = require('../models/message.model');
const engine = require('./engine');
const auditService = require('../services/audit.service'); // optional; safe if missing

/**
 * deliverMessage
 * - Entrypoint used by services after a Message has been persisted and marked 'submitted'.
 * - Loads the message, validates readiness, delegates to engine.processMessage, persists delivery metadata,
 *   and emits audit events.
 *
 * @param {String|ObjectId} messageId
 * @param {Object} opts
 *   { actor, logger, correlationId, asyncBroadcast = true }
 * @returns {Promise<Object>} { ok: true, message: <lean message>, deliveryInfo }
 * @throws {Error} with .status when appropriate
 */
async function deliverMessage(messageId, opts = {}) {
  const logger = opts.logger || console;
  const correlationId = opts.correlationId || null;
  const actor = opts.actor || null;
  const asyncBroadcast = typeof opts.asyncBroadcast === 'undefined' ? true : !!opts.asyncBroadcast;

  if (!messageId) {
    const e = new Error('messageId required');
    e.status = 400;
    throw e;
  }

  // Load message (allow non-visible if caller intends to deliver)
  const message = await messageRepo.findById(messageId, { visibleOnly: false });
  if (!message) {
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.failed.not_found',
        actor,
        target: { type: 'Message', id: messageId ? String(messageId) : null },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { reason: 'message_not_found' }
      });
    } catch (_) {}
    const err = new Error('message_not_found');
    err.status = 404;
    throw err;
  }

  // Only allow delivery for messages in 'submitted' status
  if (message.status !== 'submitted') {
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.failed.invalid_status',
        actor,
        target: { type: 'Message', id: message._id.toString() },
        outcome: 'failure',
        severity: 'warning',
        correlationId,
        details: { currentStatus: message.status }
      });
    } catch (_) {}
    const err = new Error('message_not_ready_for_delivery');
    err.status = 409;
    throw err;
  }

  logger.info && logger.info({ event: 'message.delivery.start', messageId: String(message._id), correlationId });

  // Delegate orchestration to engine
  let deliveryResult;
  try {
    deliveryResult = await engine.processMessage(message, { actor, logger, correlationId, asyncBroadcast });
  } catch (err) {
    logger.error && logger.error({ event: 'message.delivery.engine_error', messageId: String(message._id), error: err && err.message ? err.message : String(err), correlationId });
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.failed.engine_error',
        actor,
        target: { type: 'Message', id: message._id.toString() },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err && err.message ? err.message : String(err) }
      });
    } catch (_) {}
    throw err;
  }

  // If engine indicates async broadcast enqueued, return early with status
  if (deliveryResult && deliveryResult.asyncEnqueued) {
    logger.info && logger.info({ event: 'message.delivery.enqueued', messageId: String(message._id), correlationId });
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.enqueued',
        actor,
        target: { type: 'Message', id: message._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { note: 'broadcast_batches_enqueued' }
      });
    } catch (_) {}
    // Return current persisted message (lean)
    const fresh = await Message.findById(message._id).lean().exec();
    return { ok: true, message: fresh, deliveryInfo: { enqueued: true } };
  }

  // Normal synchronous delivery result handling
  if (deliveryResult && deliveryResult.ok) {
    const sentAt = new Date();
    const deliveryInfo = deliveryResult.deliveryInfo || {};

    // Persist delivery metadata and mark message as submitted/sent
    try {
      // Prefer instance helper if available
      if (typeof message.markSubmitted === 'function') {
        await message.markSubmitted({ sentAt, deliveryInfo });
      } else {
        await messageRepo.updateMessage(message._id, { status: 'sent', visible: true, metadata: Object.assign({}, message.metadata || {}, { deliveryInfo, sentAt }) });
      }
    } catch (persistErr) {
      logger.error && logger.error({ event: 'message.delivery.persist_failed', messageId: String(message._id), error: persistErr && persistErr.message ? persistErr.message : String(persistErr), correlationId });
      try {
        await auditService.logEvent({
          eventType: 'message.delivery.persist_failed',
          actor,
          target: { type: 'Message', id: message._id.toString() },
          outcome: 'failure',
          severity: 'error',
          correlationId,
          details: { error: persistErr && persistErr.message ? persistErr.message : String(persistErr) }
        });
      } catch (_) {}
      // Still return delivery result but surface persistence issue in logs
    }

    try {
      await auditService.logEvent({
        eventType: 'message.delivery.success',
        actor,
        target: { type: 'Message', id: message._id.toString() },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { deliverySummary: deliveryInfo }
      });
    } catch (_) {}

    const fresh = await Message.findById(message._id).lean().exec();
    return { ok: true, message: fresh, deliveryInfo };
  }

  // Engine returned failure summary
  const errorMsg = (deliveryResult && deliveryResult.error) ? deliveryResult.error : 'delivery_failed';
  try {
    await auditService.logEvent({
      eventType: 'message.delivery.failed',
      actor,
      target: { type: 'Message', id: message._id.toString() },
      outcome: 'failure',
      severity: 'error',
      correlationId,
      details: { deliveryResult }
    });
  } catch (_) {}

  const err = new Error(errorMsg);
  err.status = deliveryResult && deliveryResult.status ? deliveryResult.status : 500;
  throw err;
}

module.exports = { deliverMessage };
