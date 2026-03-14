// src/controllers/message.controller-deliver.js
//
// Delivery helper for message.controller
// - Exposes deliverMessageForActor(actorId, message, opts)
// - Loads actor from user repo, enforces RBAC for broadcasts/multi-recipient sends,
//   delegates to comms.deliverMessage, and emits audit events.
// - Returns the comms result or throws an Error with .code/.status for controller handling.

const userRepo = require('../repositories/user.repo');
const comms = require('../comms-js/index');
const auditService = require('../services/audit.service');
const config = require('../comms-js/config');

function _makeError(message, code = 'ERROR', status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

/**
 * deliverMessageForActor
 * @param {String} actorId - userId of the actor initiating delivery (may be null for system)
 * @param {Object} message - Mongoose message document or plain object (must include _id, recipientsAll, recipients)
 * @param {Object} opts - { logger, correlationId, asyncBroadcastOverride }
 * @returns {Promise<Object>} - comms.deliverMessage result
 */
async function deliverMessageForActor(actorId, message, opts = {}) {
  const logger = opts.logger || console;
  const correlationId = opts.correlationId || null;
  const asyncBroadcastOverride = typeof opts.asyncBroadcastOverride !== 'undefined' ? !!opts.asyncBroadcastOverride : undefined;

  if (!message || !message._id) throw _makeError('message_required', 'INVALID_INPUT', 400);

  // Load actor (if provided) to verify role
  let actor = null;
  if (actorId) {
    actor = await userRepo.findPublicById(actorId);
    if (!actor) {
      // treat missing actor as unauthorized
      throw _makeError('actor_not_found', 'FORBIDDEN', 403);
    }
  }

  // Enforce admin-only broadcast / multi-recipient sends
  const recipientsAll = !!message.recipientsAll;
  const recipients = Array.isArray(message.recipients) ? message.recipients : [];
  const multipleRecipients = recipientsAll || recipients.length > 1;

  if (multipleRecipients) {
    const role = actor && actor.role ? actor.role : null;
    if (role !== 'administrator') {
      throw _makeError('broadcast_forbidden', 'FORBIDDEN', 403);
    }
  }

  // Determine asyncBroadcast preference
  const isBroadcast = recipientsAll;
  const asyncBroadcastDefault = (config && typeof config.asyncBroadcastDefault !== 'undefined') ? !!config.asyncBroadcastDefault : true;
  const asyncBroadcast = (typeof asyncBroadcastOverride !== 'undefined')
    ? asyncBroadcastOverride
    : (isBroadcast ? (message.asyncBroadcast === true || asyncBroadcastDefault) : false);

  // Delegate to comms-js
  try {
    const deliveryOpts = {
      actor: actor || null,
      logger,
      correlationId,
      asyncBroadcast
    };

    const result = await comms.deliverMessage(message._id, deliveryOpts);

    // Emit audit event (best-effort)
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.attempt',
        actor: actor ? { userId: actor.userId, role: actor.role } : null,
        target: { type: 'Message', id: String(message._id) },
        outcome: result && result.ok ? 'success' : 'info',
        severity: result && result.ok ? 'info' : 'info',
        correlationId,
        details: { asyncBroadcast, deliveryResult: result && result.deliveryInfo ? result.deliveryInfo : null }
      });
    } catch (_) {}

    return result;
  } catch (err) {
    // Audit failure and rethrow with normalized shape
    try {
      await auditService.logEvent({
        eventType: 'message.delivery.failed.attempt',
        actor: actor ? { userId: actor.userId, role: actor.role } : null,
        target: { type: 'Message', id: String(message._id) },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err && err.message ? err.message : String(err) }
      });
    } catch (_) {}

    // If comms threw an error with status, propagate; otherwise wrap
    if (err && (err.status || err.code)) throw err;
    throw _makeError(err && err.message ? err.message : 'delivery_error', 'DELIVERY_ERROR', 500);
  }
}

module.exports = { deliverMessageForActor };
