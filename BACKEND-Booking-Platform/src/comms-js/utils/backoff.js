// src/comms-js/utils/backoff.js
//
// Exponential backoff retry helper.
// - Usage: await retry(() => doSomething(), { attempts: 3, backoffMs: 500, jitter: true, onRetry })
// - Retries the provided async function on rejection according to options.
// - Does not swallow the final error; throws the last error when attempts exhausted.

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * sleep
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * randomJitter
 * - Returns a jitter value in range [-jitterFactor*base, +jitterFactor*base]
 */
function randomJitter(base, jitterFactor = 0.5) {
  return (Math.random() * 2 - 1) * base * jitterFactor;
}

/**
 * retry
 * @param {Function} fn - async function to execute. Should return a value or throw.
 * @param {Object} opts
 *   { attempts = 3, backoffMs = 500, maxBackoffMs = 30000, jitter = true, jitterFactor = 0.5,
 *     isTransient = null, onRetry = null, logger = console }
 *
 * - isTransient(err) => boolean  : optional predicate to decide whether to retry on a given error.
 * - onRetry(attempt, err, delayMs) => void : optional hook called before sleeping for next attempt.
 *
 * @returns {Promise<*>} resolves with fn() result or rejects with last error after exhausting attempts.
 */
async function retry(fn, opts = {}) {
  const attempts = Math.max(1, parseInt(opts.attempts || DEFAULT_ATTEMPTS, 10));
  const baseBackoff = Math.max(1, parseInt(opts.backoffMs || DEFAULT_BACKOFF_MS, 10));
  const maxBackoff = Math.max(baseBackoff, parseInt(opts.maxBackoffMs || DEFAULT_MAX_BACKOFF_MS, 10));
  const jitter = typeof opts.jitter === 'undefined' ? true : !!opts.jitter;
  const jitterFactor = typeof opts.jitterFactor === 'number' ? Math.max(0, Math.min(1, opts.jitterFactor)) : 0.5;
  const isTransient = typeof opts.isTransient === 'function' ? opts.isTransient : null;
  const onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;
  const logger = opts.logger || console;

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastErr = err;

      // If caller provided isTransient and it returns false, abort immediately
      if (isTransient && !isTransient(err)) {
        logger && logger.debug && logger.debug({ event: 'backoff.non_transient_error', attempt, error: err && err.message ? err.message : String(err) });
        throw err;
      }

      // If this was the last attempt, break and rethrow below
      if (attempt >= attempts) break;

      // compute exponential backoff delay
      const exp = Math.pow(2, attempt - 1);
      let delay = Math.min(maxBackoff, Math.round(baseBackoff * exp));

      // apply jitter
      if (jitter) {
        delay = Math.max(0, Math.round(delay + randomJitter(delay, jitterFactor)));
      }

      // call onRetry hook if provided
      try {
        if (onRetry) {
          try { onRetry(attempt, err, delay); } catch (hookErr) { /* swallow hook errors */ }
        }
      } catch (_) {}

      logger && logger.info && logger.info({ event: 'backoff.retry_scheduled', attempt, delayMs: delay, error: err && err.message ? err.message : String(err) });

      // wait before next attempt
      await sleep(delay);
      // continue to next attempt
    }
  }

  // exhausted attempts
  const finalErr = lastErr || new Error('retry_failed');
  throw finalErr;
}

module.exports = { retry };
