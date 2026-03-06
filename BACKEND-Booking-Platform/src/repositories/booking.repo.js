/**
 * src/repositories/booking.repo.js
 *
 * Thin repository for Booking model. Methods accept an optional `session`
 * to participate in MongoDB transactions.
 */

const Booking = require('../models/booking.model');

/**
 * Create a booking document within an optional session.
 * @param {Object} obj
 * @param {ClientSession|null} session
 * @returns {Promise<Document>}
 */
async function create(obj, session = null) {
  if (session) {
    const [doc] = await Booking.create([obj], { session });
    return doc;
  }
  return Booking.create(obj);
}

module.exports = { create };
