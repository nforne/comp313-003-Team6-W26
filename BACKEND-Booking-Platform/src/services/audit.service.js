// src/services/audit.service.js
const auditRepo = require('../repositories/audit.repo');

function buildBase(actor = {}, correlationId = null) {
  return {
    actor: { userId: actor.userId || null, role: actor.role || null },
    correlationId: correlationId || null,
    createdAt: Date.now()
  };
}

function normalizeTarget(input) {
  // Ensure we pass a string into the repo (matches existing schema)
  if (input == null) return undefined;

  // If it's already a string, return trimmed string
  if (typeof input === 'string') {
    const s = input.trim();
    return s.length ? s : undefined;
  }

  // If it's an object with a type field, prefer that
  if (typeof input === 'object' && !Array.isArray(input)) {
    if (input.type != null) return String(input.type);
    if (input.id != null) return String(input.id);
    try {
      return JSON.stringify(input);
    } catch (e) {
      return undefined;
    }
  }

  // Fallback: coerce primitives to string
  return String(input);
}

async function logEvent({ eventType, actor = {}, target = {}, outcome = 'success', severity = 'info', correlationId = null, details = {} }) {
  const record = Object.assign(buildBase(actor, correlationId), {
    eventType,
    // normalize target to a string to avoid Mongoose cast errors
    target: normalizeTarget(target),
    outcome,
    severity,
    details
  });
  try {
    // best-effort write; caller may await this promise or run it in parallel
    return await auditRepo.createAudit(record);
  } catch (err) {
    // If audit write fails, do not throw to caller; log to console and return null
    console.error('[audit.service] failed to write audit', err && err.message);
    return null;
  }
}

module.exports = { logEvent };
