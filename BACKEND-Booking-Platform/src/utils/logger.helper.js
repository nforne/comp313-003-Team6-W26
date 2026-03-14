// src/utils/logger.helper.js
// Minimal optional logger helper — no external deps, safe fallback to console.

function formatMeta(actor = {}) {
  const parts = [];
  if (actor.userId) parts.push(`user:${actor.userId}`);
  if (actor.role) parts.push(`role:${actor.role}`);
  if (actor.correlationId) parts.push(`cid:${actor.correlationId}`);
  return parts.length ? `[${parts.join(' ')}]` : '';
}

function wrapConsoleMethod(consoleMethod, meta) {
  return (...args) => {
    try {
      if (typeof args[0] === 'string') {
        consoleMethod(`${meta} ${args[0]}`, ...args.slice(1));
      } else {
        consoleMethod(meta, ...args);
      }
    } catch (e) {
      // best-effort: if console fails, ignore
    }
  };
}

/**
 * loggerFor(actor)
 * - actor: optional object { userId, role, correlationId, app }
 * - If actor.app.get('logger') exists and looks like a logger, return a child logger when possible.
 * - Otherwise return a small console-backed logger that prefixes messages with actor metadata.
 */
function loggerFor(actor = {}) {
  // Prefer an app-provided logger if available
  try {
    const appLogger = actor && actor.app && typeof actor.app.get === 'function' && actor.app.get('logger');
    if (appLogger) {
      // If the logger supports child/context (winston/pino), try to create a child with metadata
      const meta = {};
      if (actor.userId) meta.userId = actor.userId;
      if (actor.role) meta.role = actor.role;
      if (actor.correlationId) meta.correlationId = actor.correlationId;

      if (typeof appLogger.child === 'function') {
        return appLogger.child(meta);
      }
      if (typeof appLogger.withContext === 'function') {
        return appLogger.withContext(meta);
      }
      return appLogger;
    }
  } catch (e) {
    // ignore and fall back to console
  }

  // Fallback: console-backed logger
  const meta = formatMeta(actor);
  return {
    info: wrapConsoleMethod(console.info.bind(console), meta),
    warn: wrapConsoleMethod(console.warn.bind(console), meta),
    error: wrapConsoleMethod(console.error.bind(console), meta),
    debug: wrapConsoleMethod(console.debug ? console.debug.bind(console) : console.log.bind(console), meta)
  };
}

module.exports = { loggerFor };
