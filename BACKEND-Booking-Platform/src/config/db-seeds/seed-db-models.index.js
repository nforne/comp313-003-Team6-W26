// src/config/db-seeds/seed-db-models.index.js
//
// Orchestrator for DB model seeds.
// - Coordinates seeding order and aggregates summaries.
// - Default order: users -> services -> calendars -> reviews -> requests -> bookings -> bids
// - Idempotent: each seed module is responsible for its own idempotency.
// - Provides options: { force: boolean, logger: object, dryRun: boolean }
// - Usage (recommended): call this after your DB connection is established during server startup.
//
// Example:
//   const seedIndex = require('./src/config/db-seeds/seed-db-models.index');
//   await seedIndex.run({ logger: app.get('logger') || console });
//
// Notes:
// - This module does not open or close DB connections; call it only after mongoose.connect().
// - By default it performs a lightweight existence check (seed markers) and skips seeding when markers are present.
// - Set { force: true } to re-run all seeds regardless of markers (useful for CI or dev resets).
'use strict';

const User = require('../../models/user.model');
const Service = require('../../models/service.model');
const Request = require('../../models/request.model');
const Booking = require('../../models/booking.model');
const Bid = require('../../models/bid.model');
const Review = (() => {
  try { return require('../../models/review.model'); } catch (e) { return null; }
})();

// Seed modules (each exports async run())
const seedUsers = require('./seed-db-models.users');
const seedServices = require('./seed-db-models.services');
const seedCalendars = require('./seed-db-models.calenders');
const seedReviews = require('./seed-db-models.reviews');
const seedRequests = require('./seed-db-models.requests');
const seedBookings = require('./seed-db-models.bookings');
const seedBids = require('./seed-db-models.bids');

/**
 * Default logger (console-compatible)
 */
function defaultLogger() {
  return {
    info: (...args) => console.log('[seed] INFO', ...args),
    warn: (...args) => console.warn('[seed] WARN', ...args),
    error: (...args) => console.error('[seed] ERROR', ...args),
    debug: (...args) => console.debug('[seed] DEBUG', ...args)
  };
}

/**
 * quickSeedMarkerCheck
 * - Lightweight check to determine whether the DB already contains the canonical seeded artifacts.
 * - Checks for presence of one stable user and one stable service and one seeded request.
 * - Returns true when markers are present (likely already seeded).
 */
async function quickSeedMarkerCheck() {
  try {
    const userMarker = await User.findOne({ userId: '1000000000000001' }).lean().exec();
    const serviceMarker = await Service.findOne({ serviceId: 'svc_000000000002' }).lean().exec();
    const requestMarker = await Request.findOne({ 'metadata.seeded': true }).lean().exec();
    // If at least user and service exist and there's at least one seeded request, consider DB seeded.
    return !!(userMarker && serviceMarker && requestMarker);
  } catch (err) {
    // If check fails, be conservative and return false so seeding proceeds (caller can use force to override).
    return false;
  }
}

/**
 * run
 * - Orchestrates seeding in the correct order.
 * - options:
 *     { boolean } force   -> ignore marker check and run all seeds
 *     { boolean } dryRun  -> perform checks but do not persist (seeds themselves may still write; dryRun is advisory)
 *     { object }  logger  -> logger with info/warn/error/debug methods
 */
async function run(options = {}) {
  const opts = Object.assign({ force: false, dryRun: false, logger: defaultLogger() }, options || {});
  const logger = opts.logger || defaultLogger();

  const overall = {
    startedAt: Date.now(),
    force: !!opts.force,
    dryRun: !!opts.dryRun,
    steps: [],
    errors: []
  };

  try {
    logger.info('Starting DB seed orchestration', { force: opts.force, dryRun: opts.dryRun });

    if (!opts.force) {
      const already = await quickSeedMarkerCheck();
      if (already) {
        logger.info('Seed markers detected; skipping seeding. Use { force: true } to override.');
        overall.skipped = true;
        overall.finishedAt = Date.now();
        return overall;
      }
    }

    // Order of execution
    const sequence = [
      { name: 'users', fn: seedUsers && typeof seedUsers.run === 'function' ? seedUsers.run : null },
      { name: 'services', fn: seedServices && typeof seedServices.run === 'function' ? seedServices.run : null },
      { name: 'calendars', fn: seedCalendars && typeof seedCalendars.run === 'function' ? seedCalendars.run : null },
      { name: 'reviews', fn: seedReviews && typeof seedReviews.run === 'function' ? seedReviews.run : null },
      { name: 'requests', fn: seedRequests && typeof seedRequests.run === 'function' ? seedRequests.run : null },
      { name: 'bookings', fn: seedBookings && typeof seedBookings.run === 'function' ? seedBookings.run : null },
      { name: 'bids', fn: seedBids && typeof seedBids.run === 'function' ? seedBids.run : null }
    ];

    for (const step of sequence) {
      const stepRecord = { name: step.name, startedAt: Date.now() };
      if (!step.fn) {
        logger.warn(`Seed module for "${step.name}" not found or missing run(); skipping.`);
        stepRecord.skipped = true;
        stepRecord.finishedAt = Date.now();
        overall.steps.push(stepRecord);
        continue;
      }

      try {
        logger.info(`Running seed: ${step.name}`);
        if (opts.dryRun) {
          logger.info(`Dry-run enabled: calling ${step.name}.run() but expecting modules to respect dry-run (advisory).`);
        }
        const result = await step.fn(opts);
        stepRecord.result = result || null;
        stepRecord.finishedAt = Date.now();
        logger.info(`Seed completed: ${step.name}`, { resultSummary: summarizeResult(result) });
      } catch (err) {
        stepRecord.error = err && err.message ? err.message : String(err);
        stepRecord.finishedAt = Date.now();
        overall.errors.push({ step: step.name, message: stepRecord.error });
        logger.error(`Seed failed for ${step.name}`, stepRecord.error);
        // Continue to next step rather than aborting entire process to allow partial progress.
      } finally {
        overall.steps.push(stepRecord);
      }
    }

    overall.finishedAt = Date.now();
    logger.info('DB seed orchestration finished', { durationMs: overall.finishedAt - overall.startedAt, errors: overall.errors.length });
    return overall;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    logger.error('Fatal error during seed orchestration', msg);
    overall.errors.push({ fatal: true, message: msg });
    overall.finishedAt = Date.now();
    return overall;
  }
}

/**
 * summarizeResult
 * - Small helper to produce a compact summary for logging from a seed result object.
 */
function summarizeResult(result) {
  if (!result) return null;
  const s = {};
  if (result.created) s.created = Array.isArray(result.created) ? result.created.length : result.created;
  if (result.skipped) s.skipped = Array.isArray(result.skipped) ? result.skipped.length : result.skipped;
  if (result.errors) s.errors = Array.isArray(result.errors) ? result.errors.length : result.errors;
  // If seed returned a top-level summary (like our user seed), include keys
  if (result.created === undefined && result.skipped === undefined && result.errors === undefined) {
    // try to detect common shapes
    if (result.created || result.skipped || result.errors) {
      s.raw = result;
    } else {
      s.raw = Object.keys(result).slice(0, 5);
    }
  }
  return s;
}

module.exports = { run };

/*
Quick integration notes

- Call order recommendation (after mongoose.connect()):
    const seedIndex = require('./src/config/db-seeds/seed-db-models.index');
    const summary = await seedIndex.run({ force: false, dryRun: false, logger: console });
    console.log('Seed summary', summary);

- Environment toggle:
    You may set an environment variable (e.g., SEED_DB=true) and call the run() from your server entrypoint when true.

- Safety:
    Seeds are designed to be idempotent. Use { force: true } only when you intentionally want to re-run seeds (e.g., CI or dev reset).

- Troubleshooting:
    If a seed step fails due to a transient DB race (duplicate key), re-running with force: true will usually resolve after the conflicting doc exists.

*/
