/**
 * src/repositories/bid.repo.js
 *
 * Repository layer for Bid model. Provides session-aware helpers and
 * both hard and soft delete operations.
 */

const Bid = require('../models/bid.model');

/**
 * Create a bid document.
 * @param {Object} obj
 * @returns {Promise<Document>}
 */
async function create(obj) {
  return Bid.create(obj);
}

/**
 * Find a bid by Mongo _id (string or ObjectId). Excludes archived by default.
 * @param {String} id
 * @returns {Promise<Document|null>}
 */
async function findById(id) {
  return Bid.findById(id).where({ archived: false }).exec();
}

/**
 * Find an active bid by request_id and provider_id.
 * @param {String} request_id
 * @param {String} provider_id
 * @returns {Promise<Document|null>}
 */
async function findByRequestAndProvider(request_id, provider_id) {
  return Bid.findOne({ request_id, provider_id, archived: false }).exec();
}

/**
 * List bids for a request with pagination and optional status filter.
 * @param {String} request_id
 * @param {Object} opts
 * @returns {Promise<Object>} { results, total, page, pageSize }
 */
async function listByRequest(request_id, { page = 1, pageSize = 20, status } = {}) {
  const filter = { request_id, archived: false };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await Bid.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await Bid.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

/**
 * Update a bid by _id (non-transactional).
 * @param {String} id
 * @param {Object} patch
 * @returns {Promise<Document|null>}
 */
async function updateById(id, patch) {
  if (!patch || Object.keys(patch).length === 0) return findById(id);
  patch.updatedAt = Date.now();
  return Bid.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
}

/**
 * Session-aware updateById (used in transactions).
 * @param {String} id
 * @param {Object} patch
 * @param {ClientSession} session
 * @returns {Promise<Document|null>}
 */
async function updateByIdWithSession(id, patch, session) {
  patch.updatedAt = Date.now();
  return Bid.findByIdAndUpdate(id, { $set: patch }, { new: true, session }).exec();
}

/**
 * Soft-delete a bid by setting archived=true and status='withdrawn'.
 * @param {String} id
 * @returns {Promise<Document|null>}
 */
async function softDeleteById(id) {
  const patch = { archived: true, status: 'withdrawn', updatedAt: Date.now() };
  return Bid.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
}

/**
 * Hard delete a bid (irreversible). Use only for draft bids per business rule.
 * @param {String} id
 * @returns {Promise<{deletedCount: number}>}
 */
async function hardDeleteById(id) {
  return Bid.deleteOne({ _id: id }).exec();
}

/**
 * Update many bids by filter. Accepts optional session.
 * @param {Object} filter
 * @param {Object} patch
 * @param {ClientSession|null} session
 * @returns {Promise<UpdateWriteOpResult>}
 */
async function updateMany(filter, patch, session = null) {
  patch.updatedAt = Date.now();
  const opts = session ? { session } : {};
  return Bid.updateMany(filter, { $set: patch }, opts).exec();
}

/**
 * Soft-delete many bids by filter (archived=true, status='withdrawn').
 * @param {Object} filter
 * @param {ClientSession|null} session
 * @returns {Promise<UpdateWriteOpResult>}
 */
async function softDeleteMany(filter, session = null) {
  const patch = { archived: true, status: 'withdrawn', updatedAt: Date.now() };
  const opts = session ? { session } : {};
  return Bid.updateMany(filter, { $set: patch }, opts).exec();
}

/**
 * Find multiple bids by request with optional status filter.
 * @param {String} request_id
 * @param {Object} opts
 * @returns {Promise<Array>}
 */
async function findByRequest(request_id, { status, archived = false } = {}) {
  const filter = { request_id, archived };
  if (status) filter.status = status;
  return Bid.find(filter).lean().exec();
}

module.exports = {
  create,
  findById,
  findByRequestAndProvider,
  listByRequest,
  updateById,
  updateByIdWithSession,
  softDeleteById,
  hardDeleteById,
  updateMany,
  softDeleteMany,
  findByRequest
};
