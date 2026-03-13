/**
 * src/jobs/request.service.worker.js
 *
 * Worker module for request expiry scheduling, expiry handling, and validation helpers.
 *
 * - Exposes: scheduleExpiryForRequest, clearExpiryForRequestId, markRequestExpired, expiryTimers, validateWhenSlots
 * - validateWhenSlots returns a structured result with all failing slots (no logging).
 * - Timer and notification behavior preserved and non-disruptive.
 */

const mongoose = require('mongoose');
const requestRepo = require('../repositories/request.repo');
const auditService = require('../services/audit.service');

let messageRepo;
try { messageRepo = require('../repositories/message.repo'); } catch (e) { messageRepo = null; }

let comms;
try { comms = require('../comms-js'); } catch (e) { comms = null; }

let notifyProviders;
try { notifyProviders = require('../utils/notification.stub').notifyProviders; } catch (e) { notifyProviders = null; }

function dedupeArray(arr = []) { return Array.from(new Set((arr || []).filter(Boolean))); }

/**
 * In-memory timers map for request expirations.
 * Key: request._id.toString()
 * Value: { timer: Timeout, runAt: epochMs }
 */
const expiryTimers = new Map();

/**
 * Compact safe audit logger used by worker (one-line calls).
 */
async function _log(payload) { try { if (auditService && typeof auditService.logEvent === 'function') await auditService.logEvent(payload); } catch (e) { try { console.error('[request.worker] audit log failed', e && e.message, payload && payload.eventType); } catch (_) { /* ignore */ } } }

/**
 * Validate `when` slots array.
 * - Accepts an array of slots: [{ from: Number, to: Number, isBusinessHours?: Boolean }, ...]
 * - Returns an object: { valid: Boolean, maxTo: Number, errors: Array<{ index, slot, message }> }
 * - Does NOT perform logging; caller (service) is responsible for logging and throwing.
 */
function validateWhenSlots(whenArray) {
  const now = Date.now();
  const result = { valid: true, maxTo: 0, errors: [] };

  if (!Array.isArray(whenArray) || whenArray.length === 0) {
    result.valid = false;
    result.errors.push({ index: null, slot: whenArray, message: 'Invalid or missing "when" windows (expected non-empty array of slots)' });
    return result;
  }

  for (let i = 0; i < whenArray.length; i++) {
    const slot = whenArray[i];
    if (!slot || typeof slot !== 'object') {
      result.valid = false;
      result.errors.push({ index: i, slot, message: 'Each when entry must be an object with from and to epoch ms' });
      continue;
    }

    const from = Number(slot.from || 0);
    const to = Number(slot.to || 0);

    if (!from || !to || Number.isNaN(from) || Number.isNaN(to)) {
      result.valid = false;
      result.errors.push({ index: i, slot, message: '"when.from" and "when.to" must be valid epoch millisecond numbers for each slot' });
      continue;
    }

    if (to <= now) {
      result.valid = false;
      result.errors.push({ index: i, slot, message: '"when.to" must be in the future for each slot' });
    }

    if (from < now) {
      result.valid = false;
      result.errors.push({ index: i, slot, message: '"when.from" must be now or in the future for each slot' });
    }

    if (to < from) {
      result.valid = false;
      result.errors.push({ index: i, slot, message: '"when.to" must be greater than or equal to "when.from" for each slot' });
    }

    // normalize isBusinessHours if present (mutates slot)
    if (slot.isBusinessHours !== undefined) slot.isBusinessHours = Boolean(slot.isBusinessHours);

    if (!Number.isNaN(to)) result.maxTo = Math.max(result.maxTo, to);
  }

  return result;
}

/**
 * Clear scheduled expiry for a request id (if any).
 * @param {String} requestId
 * @returns {Boolean} true if a timer was cleared
 */
function clearExpiryForRequestId(requestId) {
  if (!requestId) return false;
  const key = requestId.toString();
  const entry = expiryTimers.get(key);
  if (entry && entry.timer) {
    try { clearTimeout(entry.timer); } catch (e) { /* ignore */ }
    expiryTimers.delete(key);
    return true;
  }
  return false;
}

/**
 * Mark a request expired (idempotent).
 * - Loads latest request, ensures status active and expiresAt <= now, then sets status='expired'.
 * - Persists notification message (status 'submitted') and attempts delivery via comms-js.
 */
async function markRequestExpired(requestId, correlationId = null) {
  if (!requestId) return null;
  const req = await requestRepo.findById(requestId);
  if (!req) { await _log({ eventType: 'request.expire.failed.not_found', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'failure', severity: 'warning', correlationId }); return null; }

  const now = Date.now();
  if (req.status !== 'active') { await _log({ eventType: 'request.expire.skipped', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'info', severity: 'info', correlationId, details: { currentStatus: req.status } }); return req; }
  if (!req.expiresAt || Number(req.expiresAt) > now) { await _log({ eventType: 'request.expire.skipped.not_due', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'info', severity: 'info', correlationId, details: { expiresAt: req.expiresAt, now } }); return req; }

  const updated = await requestRepo.updateById(requestId, { status: 'expired' });
  await _log({ eventType: 'request.expired', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'success', severity: 'info', correlationId, details: { expiredAt: now } });

  try {
    const seekerId = updated && updated.createdBy ? String(updated.createdBy) : null;
    const allowed = Array.isArray(updated && updated.allowedProviders) ? updated.allowedProviders.map(String) : [];
    let recipients = [];
    if (allowed && allowed.length > 0) recipients = dedupeArray([seekerId, ...allowed]); else if (seekerId) recipients = [seekerId];

    if (recipients.length > 0 && messageRepo && typeof messageRepo.createMessage === 'function') {
      const recipientObjectIds = recipients.filter(Boolean).map(r => (mongoose.Types.ObjectId.isValid(r) ? mongoose.Types.ObjectId(r) : r));
      const messageDoc = {
        type: 'notification',
        recipientsAll: false,
        recipients: recipientObjectIds,
        userId: updated.createdBy || null,
        subject: `Request expired: ${updated.title}`,
        details: `Request "${updated.title}" (id: ${updated._id}) has expired.`,
        idempotencyKey: `request-expire-${updated._id.toString()}`,
        status: 'submitted',
        metadata: { requestId: updated._id.toString(), status: 'expired', channels: ['in_app'] }
      };

      let persisted = null;
      try { persisted = await messageRepo.createMessage(messageDoc); } catch (e) { await _log({ eventType: 'request.expire.notify_persist_failed', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'partial', severity: 'warning', correlationId, details: { error: e && e.message } }); }

      if (persisted && persisted._id && comms && typeof comms.deliverMessage === 'function') {
        try { await comms.deliverMessage(persisted._id, { actor: { userId: null, role: 'system' }, correlationId, asyncBroadcast: true }); } catch (e) { await _log({ eventType: 'request.expire.notify_failed', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'partial', severity: 'warning', correlationId, details: { error: e && e.message } }); }
      } else if ((!persisted || !persisted._id) && notifyProviders) {
        try { await notifyProviders({ providerIds: recipients, message: `Request "${updated.title}" has expired.`, metadata: { requestId: updated._id.toString(), status: 'expired' } }); } catch (e) { await _log({ eventType: 'request.expire.notify_failed', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'partial', severity: 'warning', correlationId, details: { error: e && e.message } }); }
      }
    }
  } catch (e) {
    await _log({ eventType: 'request.expire.notify_failed', actor: { userId: null, role: 'system' }, target: { type: 'Request', id: requestId }, outcome: 'partial', severity: 'warning', correlationId, details: { error: e && e.message } });
  }

  return updated;
}

/**
 * Schedule an expiration timeout for a request.
 * - If a timer already exists for the request, it will be cleared and replaced.
 * - If runAtEpochMs is in the past, mark expired immediately (async).
 *
 * requestDoc may be a mongoose doc or plain object with _id, status, expiresAt
 */
async function scheduleExpiryForRequest(requestDoc, correlationId = null) {
  if (!requestDoc || !requestDoc._id) return;
  const id = requestDoc._id.toString();
  clearExpiryForRequestId(id);

  const expiresAt = Number(requestDoc.expiresAt || 0);
  if (!expiresAt || Number.isNaN(expiresAt)) return;
  if (requestDoc.status !== 'active') return;

  const now = Date.now();
  const delay = Math.max(0, expiresAt - now);

  if (delay === 0 && expiresAt <= now) {
    process.nextTick(() => markRequestExpired(id, correlationId).catch(err => { console.error('[request.worker] immediate expire failed', id, err && err.message); }));
    return;
  }

  const timer = setTimeout(async () => {
    try { await markRequestExpired(id, correlationId); } catch (e) { await _log({ eventType: 'request.expire.failed', actor: { userId: null, role: 'system' }, target: { type: 'Request', id }, outcome: 'failure', severity: 'error', correlationId, details: { error: e && e.message } }); } finally { expiryTimers.delete(id); }
  }, delay);

  expiryTimers.set(id, { timer, runAt: expiresAt });
  await _log({ eventType: 'request.expire.scheduled', actor: { userId: null, role: 'system' }, target: { type: 'Request', id }, outcome: 'info', severity: 'info', correlationId, details: { scheduledFor: expiresAt, delayMs: delay } });
}

module.exports = {
  scheduleExpiryForRequest,
  clearExpiryForRequestId,
  markRequestExpired,
  validateWhenSlots,
  expiryTimers
};
