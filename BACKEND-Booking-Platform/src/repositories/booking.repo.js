/**
 * src/repositories/booking.repo.js
 *
 * Repository for Booking model
 * - CRUD wrappers
 * - Transaction-aware create/update helpers
 * - Pagination helpers
 * - Conflict detection helpers returning minimal conflict info
 *
 * Non-disruptive: existing function names preserved; added small helpers:
 *  - findByBookingId
 *  - findConflictsByProvider (returns concise conflict records)
 *  - cancelByBookingId (transaction-aware)
 *  - listByService (new)
 */

const Booking = require('../models/booking.model');
const mongoose = require('mongoose');

/**
 * Create a booking (non-transactional).
 * @param {Object} obj
 * @returns {Promise<Document>}
 */
async function create(obj) {
  const b = new Booking(obj);
  return b.save();
}

/**
 * Create a booking within a session (transactional).
 * @param {Object} obj
 * @param {ClientSession} session
 * @returns {Promise<Document>}
 */
async function createWithSession(obj, session) {
  const b = new Booking(obj);
  return b.save({ session });
}

/**
 * Find booking by Mongo _id or booking_id.
 * @param {String} idOrBookingId
 * @returns {Promise<Document|null>}
 */
async function findById(idOrBookingId) {
  if (!idOrBookingId) return null;
  // Try by ObjectId first
  if (mongoose.Types.ObjectId.isValid(idOrBookingId)) {
    const byId = await Booking.findById(idOrBookingId).exec();
    if (byId) return byId;
  }
  // Fallback to booking_id field
  return Booking.findOne({ booking_id: idOrBookingId }).exec();
}

/**
 * Convenience: find by booking_id (string).
 * @param {String} bookingId
 * @returns {Promise<Document|null>}
 */
async function findByBookingId(bookingId) {
  if (!bookingId) return null;
  return Booking.findOne({ booking_id: bookingId }).exec();
}

/**
 * Find bookings by request_id.
 * @param {String} requestId
 * @returns {Promise<Array>}
 */
async function findByRequest(requestId) {
  return Booking.find({ request_id: requestId }).lean().exec();
}

/**
 * Update booking by _id (non-transactional).
 * @param {String} id
 * @param {Object} patch
 * @returns {Promise<Document|null>}
 */
async function updateById(id, patch) {
  if (!patch || Object.keys(patch).length === 0) return findById(id);
  patch.updatedAt = Date.now();
  return Booking.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
}

/**
 * Update booking by _id with session (transactional).
 * @param {String} id
 * @param {Object} patch
 * @param {ClientSession} session
 * @returns {Promise<Document|null>}
 */
async function updateByIdWithSession(id, patch, session) {
  patch.updatedAt = Date.now();
  return Booking.findByIdAndUpdate(id, { $set: patch }, { new: true, session }).exec();
}

/**
 * List bookings by provider with pagination and optional status filter.
 * @param {String} providerId
 * @param {Object} opts
 * @returns {Promise<Object>} { results, total, page, pageSize }
 */
async function listByProvider(providerId, { page = 1, pageSize = 20, status } = {}) {
  const filter = { provider_id: providerId };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await Booking.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

/**
 * List bookings by seeker with pagination and optional status filter.
 * @param {String} seekerId
 * @param {Object} opts
 * @returns {Promise<Object>} { results, total, page, pageSize }
 */
async function listBySeeker(seekerId, { page = 1, pageSize = 20, status } = {}) {
  const filter = { seeker_id: seekerId };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await Booking.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

/**
 * List bookings by service with pagination and optional status filter.
 * - Matches bookings where services array contains the provided serviceId.
 * @param {String} serviceId
 * @param {Object} opts
 * @returns {Promise<Object>} { results, total, page, pageSize }
 */
async function listByService(serviceId, { page = 1, pageSize = 20, status } = {}) {
  if (!serviceId) return { results: [], total: 0, page: Number(page), pageSize: Number(pageSize) };
  const filter = { services: serviceId };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await Booking.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

/**
 * Find bookings for a provider that overlap with any of the provided slots.
 * Useful for conflict checks before confirming a booking.
 * Returns full booking docs (lean).
 * @param {String} providerId
 * @param {Array<{from:Number,to:Number}>} slots
 * @returns {Promise<Array>}
 */
async function findOverlappingByProvider(providerId, slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  // Use $elemMatch to find any booking with a slot that overlaps any requested slot.
  const orClauses = slots.map(s => ({
    provider_id: providerId,
    slots: { $elemMatch: { from: { $lt: s.to }, to: { $gt: s.from } } }
  }));
  return Booking.find({ $or: orClauses }).lean().exec();
}

/**
 * Find concise conflict records for a provider and requested slots.
 * - Returns array of { booking_id, _id, status, overlappingSlots: [{from,to}] }
 * - Useful for returning minimal conflict info to callers.
 */
async function findConflictsByProvider(providerId, slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const matches = await findOverlappingByProvider(providerId, slots);
  if (!matches || matches.length === 0) return [];

  // For each match, compute which slots overlap and return concise info
  return matches.map(b => {
    const overlappingSlots = [];
    for (const s of (b.slots || [])) {
      for (const req of slots) {
        if (s.from < req.to && req.from < s.to) {
          overlappingSlots.push({ from: s.from, to: s.to });
          break;
        }
      }
    }
    return {
      booking_id: b.booking_id,
      _id: b._id,
      status: b.status,
      overlappingSlots
    };
  });
}

/**
 * Count bookings for a provider in a time window (optional).
 * @param {String} providerId
 * @param {Number|null} windowFrom epoch ms
 * @param {Number|null} windowTo epoch ms
 * @returns {Promise<Number>}
 */
async function countByProviderWindow(providerId, windowFrom = null, windowTo = null) {
  const filter = { provider_id: providerId };
  if (windowFrom !== null && windowTo !== null) {
    filter.slots = { $elemMatch: { from: { $gte: windowFrom }, to: { $lte: windowTo } } };
  }
  return Booking.countDocuments(filter).exec();
}

/**
 * Cancel a booking by booking_id or _id.
 * - actor: { type: 'seeker'|'provider'|'admin', id: string }
 * - reason: optional string
 * - If session provided, operation runs in that session.
 * @param {String} idOrBookingId
 * @param {Object} actor
 * @param {String} reason
 * @param {ClientSession|null} session
 * @returns {Promise<Document|null>}
 */
async function cancelById(idOrBookingId, actor = {}, reason = '', session = null) {
  const doc = await findById(idOrBookingId);
  if (!doc) return null;

  // Use model instance method to centralize cancellation semantics
  if (session) {
    // reload document in session
    const docInSession = await Booking.findById(doc._id).session(session).exec();
    if (!docInSession) return null;
    return docInSession.cancel(actor, reason);
  }

  return doc.cancel(actor, reason);
}

/**
 * Hard delete a booking by _id or booking_id.
 * @param {String} idOrBookingId
 * @returns {Promise<{deletedCount: number}>}
 */
async function hardDeleteById(idOrBookingId) {
  if (mongoose.Types.ObjectId.isValid(idOrBookingId)) {
    return Booking.deleteOne({ _id: idOrBookingId }).exec();
  }
  return Booking.deleteOne({ booking_id: idOrBookingId }).exec();
}

module.exports = {
  create,
  createWithSession,
  findById,
  findByBookingId,
  findByRequest,
  updateById,
  updateByIdWithSession,
  listByProvider,
  listBySeeker,
  listByService,
  findOverlappingByProvider,
  findConflictsByProvider,
  countByProviderWindow,
  cancelById,
  hardDeleteById
};
