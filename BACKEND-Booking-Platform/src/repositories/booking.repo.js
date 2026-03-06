// src/repositories/booking.repo.js
/**
 * Repository for Booking model
 * - CRUD wrappers
 * - Transaction-aware create/update helpers
 * - Pagination helpers
 *
 * All functions return Promises.
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
 * Find bookings for a provider that overlap with any of the provided slots.
 * Useful for conflict checks before confirming a booking.
 * @param {String} providerId
 * @param {Array<{from:Number,to:Number}>} slots
 * @returns {Promise<Array>}
 */
async function findOverlappingByProvider(providerId, slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  // Build OR queries for each slot: existing.from < slot.to && existing.to > slot.from
  const orClauses = slots.map(s => ({
    provider_id: providerId,
    $or: [
      { 'slots.from': { $lt: s.to }, 'slots.to': { $gt: s.from } },
      // For multi-slot bookings stored as arrays, use $elemMatch
      { slots: { $elemMatch: { from: { $lt: s.to }, to: { $gt: s.from } } } }
    ]
  }));
  // Merge into a single query using $or
  return Booking.find({ $or: orClauses }).lean().exec();
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
  findByRequest,
  updateById,
  updateByIdWithSession,
  listByProvider,
  listBySeeker,
  findOverlappingByProvider,
  countByProviderWindow,
  hardDeleteById
};
