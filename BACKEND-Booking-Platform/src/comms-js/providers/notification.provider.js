// src/comms-js/providers/notification.provider.js
//
// In-app notification / websocket provider for comms-js.
// - Publishes real-time notifications to a user's websocket/channel when available.
// - Falls back to persisting an in-app notification record (Message metadata) if user is offline or websocket publish fails.
// - Returns a simple result: { ok: true, providerId?: string } or { ok: false, error: string }.
// - Does not perform retries; caller (batch.worker) handles retry/backoff.

const userRepo = require('../../repositories/user.repo');
const messageRepo = require('../../repositories/message.repo');
const config = require('../config');
const auditService = require('../../services/audit.service'); // optional

// Expected to be injected or available in app context. Provide a safe no-op default.
let wsPublisher = null;

/**
 * setWSPublisher
 * - Optional runtime hook to provide a websocket publish function.
 * - publishFn signature: async function publish(channel, payload) -> { ok: true, providerId?: string } or throws
 */
function setWSPublisher(publishFn) {
  wsPublisher = publishFn;
}

/**
 * publishNotification
 * @param {String} userId - application userId (string)
 * @param {Object} payload - { messageId, subject, body, attachments, metadata }
 * @param {Object} opts - { correlationId }
 *
 * @returns {Promise<{ ok: boolean, providerId?: string, error?: string }>}
 */
async function publishNotification(userId, payload = {}, opts = {}) {
  const correlationId = opts.correlationId || null;
  const logger = opts.logger || console;

  if (!userId) return { ok: false, error: 'missing_userId' };
  if (!payload || !payload.messageId) return { ok: false, error: 'missing_message_payload' };

  // Resolve user to find websocket channel id or presence info
  let user;
  try {
    user = await userRepo.findPublicById(userId);
  } catch (err) {
    logger.error && logger.error({ event: 'notification.provider.user_lookup_failed', userId, error: err && err.message ? err.message : String(err), correlationId });
    return { ok: false, error: 'user_lookup_failed' };
  }

  // If user not found, persist failure info and return
  if (!user) {
    logger.warn && logger.warn({ event: 'notification.provider.user_not_found', userId, correlationId });
    return { ok: false, error: 'user_not_found' };
  }

  // Determine channel id(s) from user record. Common fields: wsChannelId, socketId, connections
  const channelId = (user && (user.wsChannelId || user.socketId || (user.connections && user.connections[0] && user.connections[0].channel))) || null;

  // Build notification payload for real-time transport
  const transportPayload = {
    type: 'message_notification',
    messageId: payload.messageId,
    subject: payload.subject || '',
    body: payload.body || '',
    attachments: payload.attachments || [],
    metadata: payload.metadata || {},
    sentAt: new Date().toISOString(),
    correlationId
  };

  // Try websocket publish if publisher is configured and channelId exists
  if (wsPublisher && channelId) {
    try {
      const res = await wsPublisher(channelId, transportPayload);
      // Expect res to be { ok: true, providerId } or throw on failure
      if (res && res.ok) {
        // Optionally persist a deliveryInfo marker for in-app channel
        try {
          const key = `metadata.deliveryInfo.${userId}.in_app`;
          const update = {};
          update[key] = { ok: true, providerId: res.providerId || null, deliveredAt: new Date() };
          await messageRepo.updateMessage(payload.messageId, update);
        } catch (persistErr) {
          logger.warn && logger.warn({ event: 'notification.provider.persist_delivery_marker_failed', userId, messageId: payload.messageId, error: persistErr && persistErr.message ? persistErr.message : String(persistErr), correlationId });
        }

        return { ok: true, providerId: res.providerId || null };
      }
      // If res.ok is false, fall through to fallback
      logger.warn && logger.warn({ event: 'notification.provider.ws_publish_failed_response', userId, channelId, response: res, correlationId });
    } catch (err) {
      logger.error && logger.error({ event: 'notification.provider.ws_publish_error', userId, channelId, error: err && err.message ? err.message : String(err), correlationId });
      // continue to fallback persist
    }
  }

  // Fallback: persist an in-app notification by appending to message.metadata.inAppQueue or deliveryInfo
  try {
    const deliveryRecord = {
      ok: false,
      persistedAt: new Date(),
      note: 'persisted_for_later_delivery_or_inbox'
    };
    const key = `metadata.deliveryInfo.${userId}.in_app`;
    const update = {};
    update[key] = deliveryRecord;
    await messageRepo.updateMessage(payload.messageId, update);

    // Optionally, also append to a per-user inbox collection or trigger internal notification counters.
    // For now, we rely on Message visibility and listForUser to surface the message in the user's inbox.

    // Emit audit event (best-effort)
    try {
      await auditService.logEvent({
        eventType: 'message.notification.persisted',
        actor: null,
        target: { type: 'Message', id: payload.messageId },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { userId, reason: 'ws_unavailable_or_publish_failed' }
      });
    } catch (_) {}

    return { ok: true, providerId: null };
  } catch (err) {
    logger.error && logger.error({ event: 'notification.provider.persist_failed', userId, messageId: payload.messageId, error: err && err.message ? err.message : String(err), correlationId });
    try {
      await auditService.logEvent({
        eventType: 'message.notification.persist_failed',
        actor: null,
        target: { type: 'Message', id: payload.messageId },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { userId, error: err && err.message ? err.message : String(err) }
      });
    } catch (_) {}
    return { ok: false, error: 'persist_failed' };
  }
}

module.exports = { publishNotification, setWSPublisher };
