// src/services/audit.service.js
const auditRepo = require('../repositories/audit.repo');

function buildBase(actor = {}, correlationId = null) {
  return {
    actor: { userId: actor.userId || null, role: actor.role || null },
    correlationId: correlationId || null,
    createdAt: Date.now()
  };
}

async function logEvent({ eventType, actor = {}, target = {}, outcome = 'success', severity = 'info', correlationId = null, details = {} }) {
  const record = Object.assign(buildBase(actor, correlationId), {
    eventType,
    target,
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
