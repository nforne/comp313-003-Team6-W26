// src/repositories/request.repo.js
/**
 * Repository for Request model
 *
 * - CRUD wrappers
 * - Session-aware update helpers for transactional flows
 * - Search helpers that respect expiresAt and status
 * - Helpers for expiration reconciliation jobs
 *
 * All functions return Promises.
 */

const mongoose = require('mongoose');
const Request = require('../models/request.model');

/**
 * Create a request.
 * If expiresAt is not provided, the model pre-save hook will default it to when.to.
 * @param {Object} obj
 * @param {ClientSession} [session] optional mongoose session
 * @returns {Promise<Document>}
 */
async function createRequest(obj, session = null) {
  const r = new Request(obj);
  if (session) return r.save({ session });
  return r.save();
}

/**
 * Find request by Mongo _id.
 * Populates bids.
 * @param {String} id
 * @param {Object} [opts] { lean: boolean }
 * @returns {Promise<Document|null>}
 */
async function findById(id, opts = {}) {
  const q = Request.findById(id).populate('bids');
  if (opts.lean) return q.lean().exec();
  return q.exec();
}

/**
 * Update request by _id (non-transactional).
 * @param {String} id
 * @param {Object} patch
 * @returns {Promise<Document|null>}
 */
async function updateById(id, patch) {
  if (!patch || Object.keys(patch).length === 0) return findById(id);
  // keep updatedAt
  patch.updatedAt = Date.now();

  // Keep expiresAtDate in sync when expiresAt is provided in the patch
  if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) {
    const val = patch.expiresAt === null ? null : Number(patch.expiresAt);
    patch.expiresAt = val;
    patch.expiresAtDate = val ? new Date(val) : null;
  }

  return Request.findByIdAndUpdate(id, { $set: patch }, { new: true }).populate('bids').exec();
}

/**
 * Update request by _id with session (transactional).
 * Use this in booking flows where request status must be updated inside a transaction.
 * @param {String} id
 * @param {Object} patch
 * @param {ClientSession} session
 * @returns {Promise<Document|null>}
 */
async function updateByIdWithSession(id, patch, session) {
  if (!patch || Object.keys(patch).length === 0) return findById(id);
  patch.updatedAt = Date.now();

  // Keep expiresAtDate in sync when expiresAt is provided in the patch
  if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) {
    const val = patch.expiresAt === null ? null : Number(patch.expiresAt);
    patch.expiresAt = val;
    patch.expiresAtDate = val ? new Date(val) : null;
  }

  return Request.findByIdAndUpdate(id, { $set: patch }, { new: true, session }).populate('bids').exec();
}

/**
 * Search open requests (status === 'active') with optional filters.
 * Respects expiresAt implicitly by filtering status === 'active' (expired requests should be reconciled to 'expired').
 *
 * @param {Object} params
 *   - categories: Array<String>
 *   - location: String
 *   - near: [lng, lat]
 *   - radiusMeters: Number
 *   - page: Number
 *   - pageSize: Number
 *   - includeExpiredCandidates: Boolean (if true, include requests whose expiresAt <= now)
 * @returns {Promise<Object>} { results, total, page, pageSize }
 */
async function searchOpenRequests({
  categories,
  location,
  near,
  radiusMeters = 50000,
  page = 1,
  pageSize = 20,
  includeExpiredCandidates = false
} = {}) {
  const now = Date.now();
  const filter = { status: 'active' };

  if (!includeExpiredCandidates) {
    // Exclude requests that have an expiresAt in the past (they should be reconciled by background job)
    filter.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: now } }
    ];
  }

  if (categories && categories.length) filter.categories = { $in: categories };
  if (location) filter.locations = location;

  let query;
  if (near && Array.isArray(near) && near.length === 2) {
    query = Request.find({
      ...filter,
      geo: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: near },
          $maxDistance: radiusMeters
        }
      }
    });
  } else {
    query = Request.find(filter).sort({ createdAt: -1 });
  }

  const skip = Math.max(0, (Number(page) - 1)) * Number(pageSize);
  const results = await query.skip(skip).limit(Number(pageSize)).populate('bids').lean().exec();

  // total should reflect the same filter (near queries may be expensive; this keeps semantics consistent)
  const total = await Request.countDocuments(filter).exec();
  return { results, total, page: Number(page), pageSize: Number(pageSize) };
}

/**
 * Find requests that are candidates to be marked expired.
 * Returns active requests whose expiresAt <= now.
 * Use in a background reconciliation job to mark status='expired' and notify stakeholders.
 *
 * @param {Number} nowEpochMs
 * @param {Number} limit
 * @returns {Promise<Array>}
 */
async function findExpiredCandidates(nowEpochMs = Date.now(), limit = 100) {
  return Request.find({
    status: 'active',
    expiresAt: { $lte: Number(nowEpochMs) }
  }).limit(limit).lean().exec();
}

/**
 * Mark a set of request ids as expired (transactional optional).
 * Returns the update result.
 *
 * @param {Array<String>} ids
 * @param {ClientSession} [session]
 * @returns {Promise<Object>} result of updateMany
 */
async function markRequestsExpiredByIds(ids = [], session = null) {
  if (!Array.isArray(ids) || ids.length === 0) return { matchedCount: 0, modifiedCount: 0 };
  const filter = { _id: { $in: ids }, status: 'active' };
  const update = { $set: { status: 'expired', updatedAt: Date.now() } };
  if (session) return Request.updateMany(filter, update, { session }).exec();
  return Request.updateMany(filter, update).exec();
}

/**
 * Hard delete a request by id.
 * - Returns the deleted document (with populated bids) if found and deleted.
 * - Returns null if no document was found for the given id.
 *
 * Note: If you need cascade deletes (e.g., remove related Bid documents), implement that logic here (or use a transaction).
 */
async function hardDeleteById(id) {
  const doc = await Request.findById(id).populate('bids').exec();
  if (!doc) return null;
  await Request.deleteOne({ _id: id }).exec();
  return doc;
}

module.exports = {
  createRequest,
  findById,
  updateById,
  updateByIdWithSession,
  searchOpenRequests,
  findExpiredCandidates,
  markRequestsExpiredByIds,
  hardDeleteById
};
