// src/repositories/user.repo.js
//
// Persistence helpers for User model.
// - Existing CRUD helpers retained.
// - Added paginated user id listing and a cursor stream helper for broadcasts.

const mongoose = require('mongoose');
const User = require('../models/user.model');

async function createUser(userObj) {
  const user = new User(userObj);
  return user.save();
}

async function findByUserId(userId) {
  return User.findOne({ userId }).select('+passwordHash').exec();
}

async function findByEmail(email) {
  return User.findOne({ 'emails.value': email.toLowerCase() }).select('+passwordHash').exec();
}

async function findPublicById(userId) {
  return User.findOne({ userId }).exec();
}

async function updateByUserId(userId, patch) {
  patch.updatedAt = Date.now();
  return User.findOneAndUpdate({ userId }, { $set: patch }, { new: true }).exec();
}

async function addRefreshToken(userId, tokenHash) {
  return User.findOneAndUpdate(
    { userId },
    { $push: { refreshTokens: { tokenHash, createdAt: Date.now() } } },
    { new: true }
  ).exec();
}

async function removeRefreshToken(userId, tokenHash) {
  return User.findOneAndUpdate(
    { userId },
    { $pull: { refreshTokens: { tokenHash } } },
    { new: true }
  ).exec();
}

/* -------------------------
 * Broadcast helpers
 * ------------------------- */

/**
 * listUserIds
 * - Returns an array of userId strings for a single page.
 * - Useful for paginated broadcast batching.
 *
 * @param {Object} opts - { page=1, limit=1000, sort = { createdAt: 1 } }
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
 * - Returns a Mongoose query cursor that yields documents with { userId }.
 * - Caller should iterate the cursor and build batches to avoid loading all users into memory.
 *
 * Example:
 * const cursor = streamAllUserIds();
 * for await (const doc of cursor) { /* doc.userId *\/ }
 *
 * @param {Object} query - optional Mongo query to filter users (default: active users)
 * @param {Object} projection - optional projection (default: { userId: 1, _id: 0 })
 * @param {Object} options - cursor options (e.g., batchSize)
 * @returns {QueryCursor}
 */
function streamAllUserIds(query = {}, projection = { userId: 1, _id: 0 }, options = {}) {
  return User.find(query, projection).cursor(options);
}

/* -------------------------
 * Export
 * ------------------------- */
module.exports = {
  createUser,
  findByUserId,
  findByEmail,
  findPublicById,
  updateByUserId,
  addRefreshToken,
  removeRefreshToken,
  // broadcast helpers
  listUserIds,
  streamAllUserIds
};
