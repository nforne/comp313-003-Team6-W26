// src/utils/bookingScheduler.js
/**
 * Booking scheduler using Agenda (Mongo-backed).
 * - Exposes init, scheduleHonorJob, cancelHonorJob.
 * - Job name: booking:mark_honored
 *
 * Requires: npm install agenda
 */

const Agenda = require('agenda');
const mongoose = require('mongoose');
const Booking = require('../models/booking.model');
const auditService = require('../services/audit.service');

let agenda;

/**
 * Initialize Agenda with the same Mongo connection used by Mongoose.
 * Call once at app startup.
 * @param {Object} opts { mongoConnection: mongoose.connection, dbCollection: 'agendaJobs', defaultLockLifetime: 10000 }
 */
async function init(opts = {}) {
  if (agenda) return agenda;
  const mongoConn = opts.mongoConnection || mongoose.connection;
  agenda = new Agenda({
    mongo: mongoConn,
    db: { collection: opts.dbCollection || 'agendaJobs' },
    defaultLockLifetime: opts.defaultLockLifetime || 10000
  });

  // Define job processor
  agenda.define('booking:mark_honored', { concurrency: 5, lockLifetime: 10000 }, async (job, done) => {
    const { bookingId, correlationId } = job.attrs.data || {};
    try {
      if (!bookingId) {
        return done(new Error('Missing bookingId'));
      }
      const booking = await Booking.findById(bookingId).exec();
      if (!booking) {
        await auditService.logEvent({
          eventType: 'booking.honor.failed.not_found',
          actor: { userId: null, role: 'system' },
          target: { type: 'Booking', id: bookingId },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: {}
        });
        return done();
      }

      // Only honor if still active
      if (booking.status === 'active') {
        booking.status = 'honored';
        booking.updatedAt = Date.now();
        await booking.save();

        await auditService.logEvent({
          eventType: 'booking.honored',
          actor: { userId: null, role: 'system' },
          target: { type: 'Booking', id: bookingId },
          outcome: 'success',
          severity: 'info',
          correlationId,
          details: { bookingId }
        });
      } else {
        await auditService.logEvent({
          eventType: 'booking.honored.skipped',
          actor: { userId: null, role: 'system' },
          target: { type: 'Booking', id: bookingId },
          outcome: 'info',
          severity: 'info',
          correlationId,
          details: { currentStatus: booking.status }
        });
      }
      return done();
    } catch (err) {
      await auditService.logEvent({
        eventType: 'booking.honored.failed',
        actor: { userId: null, role: 'system' },
        target: { type: 'Booking', id: bookingId },
        outcome: 'failure',
        severity: 'error',
        correlationId,
        details: { error: err && err.message }
      });
      return done(err);
    }
  });

  await agenda.start();
  return agenda;
}

/**
 * Schedule honor job for a booking.
 * @param {String} bookingId
 * @param {Number} runAtEpochMs - epoch ms when job should run (booking end + optional buffer)
 * @param {String|null} correlationId
 * @returns {Promise<Job>}
 */
async function scheduleHonorJob(bookingId, runAtEpochMs, correlationId = null) {
  if (!agenda) throw new Error('Agenda not initialized');
  const runAt = new Date(runAtEpochMs);
  // Use unique job name + bookingId to allow cancel by name/data
  const job = agenda.create('booking:mark_honored', { bookingId, correlationId });
  job.unique({ 'data.bookingId': bookingId, name: 'booking:mark_honored' });
  job.schedule(runAt);
  job.failCount = 0;
  return job.save();
}

/**
 * Cancel scheduled honor job(s) for a booking.
 * @param {String} bookingId
 * @returns {Promise<Number>} number of cancelled jobs
 */
async function cancelHonorJob(bookingId) {
  if (!agenda) throw new Error('Agenda not initialized');
  const num = await agenda.cancel({ name: 'booking:mark_honored', 'data.bookingId': bookingId });
  return num;
}

module.exports = { init, scheduleHonorJob, cancelHonorJob, _getAgenda: () => agenda };
