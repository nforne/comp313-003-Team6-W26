// src/repositories/user.repo.js
//
// Persistence helpers for the User model (Mongoose).
// - Thin repository layer: CRUD, auth helpers, refresh token management.
// - Broadcast helpers: paginated userId listing and cursor stream for memory-safe iteration.
// - All functions return Promises and throw on errors; callers should handle errors and logging.
//
// Usage examples:
//   const repo = require('../repositories/user.repo');
//   await repo.createUser({ userId: 'u1', firstName: 'A', emails: [{ value: 'a@example.com' }], passwordHash: 'pass' });
//   const cursor = repo.streamAllUserIds({ status: 'active' });
//   for await (const doc of cursor) { console.log(doc.userId); }

const mongoose = require('mongoose');
const User = require('../models/user.model');

/* -------------------------
 * Basic CRUD / Auth helpers
 * ------------------------- */

/**
 * createUser
 * - Creates and persists a new user document.
 * - Expects a complete user object matching the User schema.
 *
 * @param {Object} userObj
 * @returns {Promise<Document>} saved user document
 */
async function createUser(userObj) {
  const user = new User(userObj);
  return user.save();
}

/**
 * findByUserId
 * - Returns the user document including passwordHash (explicitly selected).
 *
 * @param {string} userId
 * @returns {Promise<Document|null>}
 */
async function findByUserId(userId) {
  if (!userId) return null;
  return User.findOne({ userId }).select('+passwordHash').exec();
}

/**
 * findByEmail
 * - Case-insensitive lookup by email value. Returns document with passwordHash selected.
 *
 * @param {string} email
 * @returns {Promise<Document|null>}
 */
async function findByEmail(email) {
  if (!email) return null;
  return User.findOne({ 'emails.value': String(email).toLowerCase().trim() }).select('+passwordHash').exec();
}

/**
 * findPublicById
 * - Returns public user document (passwordHash not selected).
 *
 * @param {string} userId
 * @returns {Promise<Document|null>}
 */
async function findPublicById(userId) {
  if (!userId) return null;
  return User.findOne({ userId }).exec();
}

/**
 * updateByUserId
 * - Partial update by userId. Automatically updates updatedAt timestamp.
 * - Returns the updated document.
 *
 * @param {string} userId
 * @param {Object} patch - fields to set
 * @returns {Promise<Document|null>}
 */
async function updateByUserId(userId, patch = {}) {
  if (!userId) {
    throw new Error('userId is required');
  }
  patch.updatedAt = Date.now();
  return User.findOneAndUpdate({ userId }, { $set: patch }, { new: true }).exec();
}

/* -------------------------
 * Refresh token management
 * ------------------------- */

/**
 * addRefreshToken
 * - Appends a refresh token hash to the user's refreshTokens array.
 *
 * @param {string} userId
 * @param {string} tokenHash
 * @returns {Promise<Document|null>}
 */
async function addRefreshToken(userId, tokenHash) {
  if (!userId || !tokenHash) {
    throw new Error('userId and tokenHash are required');
  }
  return User.findOneAndUpdate(
    { userId },
    { $push: { refreshTokens: { tokenHash, createdAt: Date.now() } } },
    { new: true }
  ).exec();
}

/**
 * removeRefreshToken
 * - Removes a refresh token entry by its hash.
 *
 * @param {string} userId
 * @param {string} tokenHash
 * @returns {Promise<Document|null>}
 */
async function removeRefreshToken(userId, tokenHash) {
  if (!userId || !tokenHash) {
    throw new Error('userId and tokenHash are required');
  }
  return User.findOneAndUpdate(
    { userId },
    { $pull: { refreshTokens: { tokenHash } } },
    { new: true }
  ).exec();
}

/* -------------------------
 * Broadcast / listing helpers
 * ------------------------- */

/**
 * listUserIds
 * - Returns a single page of userId strings.
 * - Useful for batching broadcast operations.
 *
 * @param {Object} opts
 * @param {number} opts.page - 1-based page number (default 1)
 * @param {number} opts.limit - page size (default 1000)
 * @param {Object} opts.sort - mongoose sort object (default { createdAt: 1 })
 * @returns {Promise<string[]>}
 */
async function listUserIds({ page = 1, limit = 1000, sort = { createdAt: 1 } } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.max(1, parseInt(limit, 10) || 1000);
  const skip = (p - 1) * l;

  const docs = await User.find({}, { userId: 1, _id: 0 }).sort(sort).skip(skip).limit(l).lean().exec();
  return docs.map(d => d.userId);
}

/**
 * streamAllUserIds
 * - Returns a Mongoose QueryCursor yielding documents with { userId }.
 * - Caller should iterate the cursor and build batches to avoid loading all users into memory.
 *
 * Example:
 *   const cursor = streamAllUserIds({ status: 'active' }, { batchSize: 500 });
 *   for await (const doc of cursor) { /* doc.userId *\/ }
 *
 * @param {Object} query - Mongo query filter (default: {})
 * @param {Object} projection - fields to return (default: { userId: 1, _id: 0 })
 * @param {Object} options - cursor options (e.g., { batchSize: 1000 })
 * @returns {QueryCursor}
 */
function streamAllUserIds(query = {}, projection = { userId: 1, _id: 0 }, options = {}) {
  return User.find(query, projection).cursor(options);
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  // CRUD / auth
  createUser,
  findByUserId,
  findByEmail,
  findPublicById,
  updateByUserId,

  // refresh tokens
  addRefreshToken,
  removeRefreshToken,

  // broadcast helpers
  listUserIds,
  streamAllUserIds
};
