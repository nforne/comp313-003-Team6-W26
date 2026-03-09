// src/services/message.service.js
//
// Polished service layer for Message operations.
// - Encapsulates business rules: draft lifecycle, idempotency, soft/hard delete, access checks.
// - Emits audit events for state changes and delegates persistence to message.repo.
// - Enqueues delivery for email/notification types (placeholder hooks for communications engine).
//
// Usage: controllers call these methods and pass `actor` (the requesting user context).
// actor: { userId, role, isAdmin, name, correlationId }

const mongoose = require('mongoose');
const repo = require('../repositories/message.repo');
const Message = require('../models/message.model');
const auditService = require('../services/audit.service');
const { loggerFor } = require('../utils/logger.helper'); // optional helper; fallback to console if not present

/**
 * Helper: emit audit event best-effort
 */
async function auditLog(actor, eventType, outcome, severity = 'info', details = {}) {
  try {
    await auditService.logEvent({
      eventType,
      actor: { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null },
      target: details.target || null,
      outcome,
      severity,
      correlationId: actor && actor.correlationId ? actor.correlationId : null,
      details
    });
  } catch (e) {
    const log = (actor && actor.app && actor.app.get && actor.app.get('logger')) || console;
    log.error && log.error({ event: 'audit.error', error: e && e.message ? e.message : String(e), originalEvent: eventType });
  }
}

/* -------------------------
 * Create / lifecycle
 * ------------------------- */

/**
 * createDraft
 * - Build and persist a draft message. Idempotent when idempotencyKey + userId provided.
 * - Returns the saved message document (lean).
 */
async function createDraft(actor, payload, { session = null } = {}) {
  const log = loggerFor(actor) || console;
  const doc = Message.buildDraft({
    avatar: payload.avatar,
    type: payload.type,
    recipientsAll: payload.recipientsAll,
    recipients: payload.recipients,
    userId: payload.userId || actor && actor.userId || null,
    serviceId: payload.serviceId || null,
    subject: payload.subject,
    details: payload.details,
    attachments: payload.attachments,
    replyTo: payload.replyTo,
    idempotencyKey: payload.idempotencyKey,
    metadata: payload.metadata
  });

  try {
    const saved = await repo.createMessage(doc.toObject(), { session });
    await auditLog(actor, 'message.create.draft', 'success', 'info', { messageId: saved._id, type: saved.type });
    return saved;
  } catch (err) {
    log.error && log.error({ event: 'message.create.draft.error', error: err && err.message ? err.message : String(err), correlationId: actor && actor.correlationId });
    await auditLog(actor, 'message.create.draft.failed', 'failure', 'error', { error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * submitMessage
 * - Transition a draft to submitted and trigger delivery for email/notification types.
 * - Enforces that only the author or an admin can submit a draft.
 */
async function submitMessage(actor, messageId, { deliveryInfo = null, session = null } = {}) {
  const log = loggerFor(actor) || console;
  const msg = await repo.findById(messageId, { visibleOnly: false });
  if (!msg) throw Object.assign(new Error('message not found'), { code: 'NOT_FOUND' });

  // authorization: author or admin
  const isAuthor = msg.userId && actor && actor.userId && String(msg.userId) === String(actor.userId);
  if (!isAuthor && !(actor && actor.isAdmin)) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
  }

  // only allow submit from draft
  if (msg.status !== 'draft') {
    throw Object.assign(new Error('invalid state: only draft can be submitted'), { code: 'INVALID_STATE' });
  }

  try {
    // mark submitted via model helper to ensure metadata.sentAt etc.
    const messageDoc = await Message.findById(msg._id).exec();
    await messageDoc.markSubmitted({ sentAt: new Date(), deliveryInfo });

    await auditLog(actor, 'message.submit', 'success', 'info', { messageId: msg._id, type: msg.type });

    // enqueue delivery for email/notification types (non-blocking)
    if (msg.type === 'email' || msg.type === 'notification') {
      try {
        // NOTE: Covered on the controller at the moment: 
        // --- DELIVERY: use deliver helper (server-side RBAC + comms-js) ---
        // TODO: integrate with communications engine / queue
        // e.g., communications.enqueueSend({ messageId: msg._id, type: msg.type })
        const commLog = loggerFor(actor) || console;
        commLog.info && commLog.info({ event: 'message.enqueue.delivery', messageId: msg._id, type: msg.type });
      } catch (e) {
        // record delivery enqueue failure but do not fail the submit
        await auditLog(actor, 'message.enqueue.failed', 'failure', 'warning', { messageId: msg._id, error: e && e.message ? e.message : String(e) });
      }
    }

    return await repo.findById(msg._id, { visibleOnly: false });
  } catch (err) {
    log.error && log.error({ event: 'message.submit.error', error: err && err.message ? err.message : String(err), messageId: msg._id });
    await auditLog(actor, 'message.submit.failed', 'failure', 'error', { messageId: msg._id, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Read / list
 * ------------------------- */

/**
 * getMessage
 * - Returns a message if the actor has access (recipient, author, admin, or broadcast).
 * - For deleted messages, returns minimal deleted DTO.
 */
async function getMessage(actor, messageId) {
  const log = loggerFor(actor) || console;
  const msg = await repo.findById(messageId, { visibleOnly: false });
  if (!msg) return null;

  // access checks
  const isAdmin = actor && actor.isAdmin;
  const isAuthor = msg.userId && actor && actor.userId && String(msg.userId) === String(actor.userId);
  const isRecipient = (Array.isArray(msg.recipients) && actor && actor.userId && msg.recipients.some(r => String(r) === String(actor.userId)));
  const isBroadcast = !!msg.recipientsAll;

  if (!(isAdmin || isAuthor || isRecipient || isBroadcast)) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
  }

  // if soft-deleted, return minimal DTO
  if (!msg.visible || msg.status === 'deleted') {
    return Message.hydrate(msg).toDeletedDTO();
  }

  // otherwise return full DTO with details for authorized readers
  const includeDetails = isAdmin || isAuthor || isRecipient;
  return Message.hydrate(msg).toDTO({ includeDetails, redactRecipients: false });
}

/**
 * listForUser
 * - Wrapper around repo.listForUser that returns DTOs.
 * - readIds can be provided to filter unreadOnly.
 */
async function listForUser(actor, opts = {}) {
  const { userId = actor && actor.userId, page, limit, type, since, unreadOnly = false, readIds = [] } = opts;
  const data = await repo.listForUser({ userId, page, limit, type, since, unreadOnly, readIds });
  // map to DTOs: for deleted messages return deleted DTO
  const results = data.results.map(r => {
    const m = Message.hydrate(r);
    if (!r.visible || r.status === 'deleted') return m.toDeletedDTO();
    return m.toDTO({ includeDetails: true, redactRecipients: false });
  });
  return { ...data, results };
}

/* -------------------------
 * Update
 * ------------------------- */

/**
 * updateMessage
 * - Allows author or admin to update allowed fields.
 * - If content changes, set status back to 'draft' or 'submitted' -> 'draft' depending on policy.
 */
async function updateMessage(actor, messageId, updates = {}, { session = null } = {}) {
  const log = loggerFor(actor) || console;
  const msg = await repo.findById(messageId, { visibleOnly: false });
  if (!msg) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });

  const isAdmin = actor && actor.isAdmin;
  const isAuthor = msg.userId && actor && actor.userId && String(msg.userId) === String(actor.userId);
  if (!isAdmin && !isAuthor) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });

  // Allowed fields
  const allowed = ['subject', 'details', 'attachments', 'metadata', 'recipients', 'recipientsAll', 'serviceId', 'replyTo'];
  const patch = {};
  let contentChanged = false;
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      patch[k] = updates[k];
      if (k === 'subject' || k === 'details' || k === 'attachments') contentChanged = true;
    }
  }

  // If content changed and message was submitted, revert to draft for moderation/editing
  if (contentChanged && msg.status === 'submitted') {
    patch.status = 'draft';
  }

  try {
    const updated = await repo.updateMessage(messageId, patch, { session });
    await auditLog(actor, 'message.update', 'success', 'info', { messageId, changes: Object.keys(patch) });
    return updated;
  } catch (err) {
    log.error && log.error({ event: 'message.update.error', error: err && err.message ? err.message : String(err), messageId });
    await auditLog(actor, 'message.update.failed', 'failure', 'error', { messageId, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Delete (soft + hard)
 * ------------------------- */

/**
 * softDelete
 * - Author or admin can soft-delete a message. Records who deleted it.
 */
async function softDelete(actor, messageId, { session = null } = {}) {
  const log = loggerFor(actor) || console;
  const msg = await repo.findById(messageId, { visibleOnly: false });
  if (!msg) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });

  const isAdmin = actor && actor.isAdmin;
  const isAuthor = msg.userId && actor && actor.userId && String(msg.userId) === String(actor.userId);
  if (!isAdmin && !isAuthor) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });

  try {
    const updated = await repo.softDeleteMessage(messageId, { byUserId: actor && actor.userId, session });
    await auditLog(actor, 'message.softDelete', 'success', 'info', { messageId });
    return updated;
  } catch (err) {
    log.error && log.error({ event: 'message.softDelete.error', error: err && err.message ? err.message : String(err), messageId });
    await auditLog(actor, 'message.softDelete.failed', 'failure', 'error', { messageId, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/**
 * hardDelete
 * - Permanently remove a message. Admin-only operation.
 */
async function hardDelete(actor, messageId, { session = null } = {}) {
  const log = loggerFor(actor) || console;
  if (!(actor && actor.isAdmin)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
      // TODO call s3storage to delete attachments
  try {
    const removed = await repo.hardDeleteMessage(messageId, { session });
    await auditLog(actor, 'message.hardDelete', 'success', 'info', { messageId });
    return removed;
  } catch (err) {
    log.error && log.error({ event: 'message.hardDelete.error', error: err && err.message ? err.message : String(err), messageId });
    await auditLog(actor, 'message.hardDelete.failed', 'failure', 'error', { messageId, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

/* -------------------------
 * Utility listing helpers
 * ------------------------- */

async function listByType(actor, opts = {}) {
  const data = await repo.listByType(opts);
  const results = data.results.map(r => {
    const m = Message.hydrate(r);
    if (!r.visible || r.status === 'deleted') return m.toDeletedDTO();
    return m.toDTO({ includeDetails: true, redactRecipients: !(actor && actor.isAdmin) });
  });
  return { ...data, results };
}

async function listThread(opts = {}) {
  // issue_wall specialized listing
  return repo.listThread(opts);
}

async function listByMetadata(key, value, opts = {}) {
  const data = await repo.listByMetadata(key, value, opts);
  const results = data.results.map(r => {
    const m = Message.hydrate(r);
    if (!r.visible || r.status === 'deleted') return m.toDeletedDTO();
    return m.toDTO({ includeDetails: true, redactRecipients: true });
  });
  return { ...data, results };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createDraft,
  submitMessage,
  getMessage,
  listForUser,
  updateMessage,
  softDelete,
  hardDelete,
  listByType,
  listThread,
  listByMetadata
};
