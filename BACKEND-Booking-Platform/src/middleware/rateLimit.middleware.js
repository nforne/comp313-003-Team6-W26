// src/middleware/rateLimit.middleware.js
//
// Lightweight, production-aware rate limiting middleware factory for Express.
// - Supports in-memory token-bucket (default) and optional Redis backend when REDIS_URL is set.
// - Usage: const rateLimit = require('./rateLimit.middleware'); app.use('/api', rateLimit('global', { windowMs:60000, max:120 }));
// - Returns middleware that sets standard rate-limit headers and JSON 429 responses.
// - Configurable per-key defaults and per-route overrides.

const crypto = require('crypto');

let Redis;
try {
  Redis = require('ioredis');
} catch (e) {
  Redis = null;
}

/* Default configuration per named limiter */
const DEFAULTS = {
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per window
  keyPrefix: 'rl:',
  identifier: (req) => (req.user && req.user.userId) ? `u:${req.user.userId}` : `ip:${req.ip}`,
  skip: () => false     // function(req) => boolean to skip limiting (e.g., internal health checks)
};

/* In-memory store (simple, efficient for single-process dev) */
class MemoryStore {
  constructor() {
    this.buckets = new Map(); // key -> { remaining, resetAt }
  }

  _now() { return Date.now(); }

  async incr(key, windowMs, max) {
    const now = this._now();
    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { remaining: max - 1, resetAt: now + windowMs };
      this.buckets.set(key, b);
      return { remaining: b.remaining, resetAt: b.resetAt, limit: max };
    }
    if (b.remaining > 0) {
      b.remaining -= 1;
      return { remaining: b.remaining, resetAt: b.resetAt, limit: max };
    }
    return { remaining: 0, resetAt: b.resetAt, limit: max };
  }
}

/* Redis store (uses simple INCR/PEXPIRE pattern) */
class RedisStore {
  constructor(redisClient, prefix = 'rl:') {
    this.client = redisClient;
    this.prefix = prefix;
  }

  _key(key) { return `${this.prefix}${key}`; }

  async incr(key, windowMs, max) {
    const k = this._key(key);
    const ttl = Math.ceil(windowMs / 1000);
    // Use multi to ensure expire is set
    const res = await this.client.multi()
      .incr(k)
      .pttl(k)
      .exec();

    const count = res && res[0] && res[0][1] ? Number(res[0][1]) : 0;
    let pttl = res && res[1] && res[1][1] ? Number(res[1][1]) : -1;

    if (pttl === -1) {
      // set expiry
      await this.client.pexpire(k, windowMs);
      pttl = windowMs;
    }

    const remaining = Math.max(0, max - count);
    const resetAt = Date.now() + pttl;
    return { remaining, resetAt, limit: max };
  }
}

/**
 * rateLimit factory
 * @param {string|object} keyOrOptions - named key string or options object
 * @param {object} [opts] - overrides: { windowMs, max, keyPrefix, identifier(req), skip(req) }
 * @returns {function} express middleware
 */
function rateLimit(keyOrOptions, opts = {}) {
  const named = typeof keyOrOptions === 'string' ? String(keyOrOptions) : null;
  const config = Object.assign({}, DEFAULTS, typeof keyOrOptions === 'object' ? keyOrOptions : {}, opts);
  const windowMs = Number(config.windowMs);
  const max = Number(config.max);
  const keyPrefix = config.keyPrefix || DEFAULTS.keyPrefix;
  const identifierFn = typeof config.identifier === 'function' ? config.identifier : DEFAULTS.identifier;
  const skipFn = typeof config.skip === 'function' ? config.skip : DEFAULTS.skip;

  // choose store: Redis if REDIS_URL and ioredis available, else memory
  let store;
  if (process.env.REDIS_URL && Redis) {
    const redisClient = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    // connect lazily
    redisClient.on('error', () => {});
    store = new RedisStore(redisClient, keyPrefix + (named ? `${named}:` : ''));
  } else {
    store = new MemoryStore();
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      if (skipFn(req)) return next();

      const id = identifierFn(req) || req.ip || 'anon';
      const bucketKey = (named ? `${named}:` : '') + id;

      const { remaining, resetAt, limit } = await store.incr(bucketKey, windowMs, max);

      // Set standard headers
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000))); // epoch seconds
      const retryAfterSec = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));

      if (remaining <= 0) {
        // Too many requests
        return res.status(429).json({
          ok: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
          meta: { limit, retryAfter: retryAfterSec }
        });
      }

      return next();
    } catch (err) {
      // Fail open: if store errors, allow request but log
      (config.logger || console).warn && (config.logger || console).warn({ event: 'rateLimit.error', error: err && err.message ? err.message : String(err) });
      return next();
    }
  };
}

module.exports = rateLimit;
