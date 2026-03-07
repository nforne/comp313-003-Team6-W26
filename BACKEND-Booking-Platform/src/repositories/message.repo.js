// src/repositories/message.repo.js
//
// Polished persistence layer for Message model.
// - Centralizes Mongoose operations and idempotency handling.
// - Provides soft and hard delete helpers (hard delete intended for admin use).
// - Exposes convenient list helpers used by services/controllers.

const mongoose = require('mongoose');
const Message = require('../models/message.model');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * createMessage
 * - Attempts to persist a message document.
 * - If idempotencyKey + userId cause a duplicate key error, returns the existing document.
 * - Accepts an optional session for transactional callers.
 */
async function createMessage(doc, { session = null } = {}) {
  try {
    const m = new Message(doc);
    return await m.save({ session });
  } catch (err) {
    // Duplicate key likely from unique index on (userId, idempotencyKey)
    if (err && err.code === 11000 && doc.userId && doc.idempotencyKey) {
      return Message.findOne({ userId: doc.userId, idempotencyKey: doc.idempotencyKey }).lean().exec();
    }
    throw err;
  }
}

/**
 * findById
 * - Returns a Message document or null.
 * - visibleOnly: if true, only returns visible messages.
 */
async function findById(id, { visibleOnly = true } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const q = Message.findById(id);
  if (visibleOnly) q.where({ visible: true });
  return q.exec();
}

/**
 * listForUser
 * - Paginated list of messages relevant to a user:
 *   broadcasts (recipientsAll), messages where user is in recipients, or authored by user.
 * - Supports filtering by type, since (epoch ms), unreadOnly (requires readIds), and pagination.
 */
async function listForUser({
  userId,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  type,
  since,
  unreadOnly = false,
  readIds = []
} = {}) {
  if (!userId) throw new Error('userId required');

  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? mongoose.Types.ObjectId(userId) : userId;

  const q = {
    visible: true,
    $or: [
      { recipientsAll: true },
      { recipients: userObjectId },
      { userId: userObjectId }
    ]
  };

  if (type) q.type = type;
  if (since) q.createdAt = { $gte: new Date(Number(since)) };
  if (unreadOnly && Array.isArray(readIds) && readIds.length) {
    q._id = { $nin: readIds.map(id => (mongoose.Types.ObjectId.isValid(id) ? mongoose.Types.ObjectId(id) : id)) };
  }

  const [results, total] = await Promise.all([
    Message.find(q).sort({ createdAt: -1 }).skip(skip).limit(Math.max(1, limit)).lean().exec(),
    Message.countDocuments(q).exec()
  ]);

  return {
    results,
    page: Number(page),
    limit: Number(limit),
    total
  };
}

/**
 * listByType
 * - Generic listing by message type with pagination and optional filters.
 */
async function listByType({ type, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, since, visibleOnly = true } = {}) {
  if (!type) throw new Error('type required');
  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
  const q = { type };
  if (visibleOnly) q.visible = true;
  if (since) q.createdAt = { $gte: new Date(Number(since)) };

  const [results, total] = await Promise.all([
    Message.find(q).sort({ createdAt: -1 }).skip(skip).limit(Math.max(1, limit)).lean().exec(),
    Message.countDocuments(q).exec()
  ]);

  return { results, page: Number(page), limit: Number(limit), total };
}

/**
 * listThread (issue_wall)
 * - For issue_wall type: returns paginated "walls" (roots with no replyTo) and up to `messagesPerWall`
 *   replies per wall. This implements the "max 3 walls at a time, 20 messages per wall" pattern.
 *
 * opts:
 *  - page (walls page)
 *  - wallsPerPage (default 3)
 *  - messagesPerWall (default 20)
 */
async function listThread({ page = 1, wallsPerPage = 3, messagesPerWall = 20 } = {}) {
  const skip = (Math.max(1, page) - 1) * Math.max(1, wallsPerPage);

  // find root walls (issue_wall with no replyTo)
  const rootQuery = { type: 'issue_wall', replyTo: null, visible: true };
  const roots = await Message.find(rootQuery).sort({ createdAt: -1 }).skip(skip).limit(wallsPerPage).lean().exec();

  // for each root, fetch up to messagesPerWall replies (including the root)
  const results = await Promise.all(roots.map(async (root) => {
    const replies = await Message.find({
      $or: [{ _id: root._id }, { replyTo: root._id }],
      visible: true
    }).sort({ createdAt: 1 }).limit(messagesPerWall).lean().exec();

    return { wallRoot: root, messages: replies };
  }));

  // total count of walls for pagination
  const totalWalls = await Message.countDocuments(rootQuery).exec();

  return { results, page: Number(page), wallsPerPage: Number(wallsPerPage), totalWalls };
}

/**
 * listByMetadata
 * - Generic helper to list messages by metadata key (bookingId, reviewId, bidId, etc.)
 */
async function listByMetadata(key, value, { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, visibleOnly = true } = {}) {
  if (!key) throw new Error('metadata key required');
  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
  const q = {};
  q[`metadata.${key}`] = value;
  if (visibleOnly) q.visible = true;

  const [results, total] = await Promise.all([
    Message.find(q).sort({ createdAt: -1 }).skip(skip).limit(Math.max(1, limit)).lean().exec(),
    Message.countDocuments(q).exec()
  ]);

  return { results, page: Number(page), limit: Number(limit), total };
}

/**
 * findByIdempotency
 * - Return existing message for a given userId + idempotencyKey
 */
async function findByIdempotency(userId, idempotencyKey) {
  if (!userId || !idempotencyKey) return null;
  return Message.findOne({ userId, idempotencyKey }).lean().exec();
}

/**
 * updateMessage
 * - Updates allowed fields and returns the updated document.
 * - Caller should enforce authorization (author or admin).
 * - Accepts optional session for transactional callers.
 */
async function updateMessage(id, updates = {}, { session = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  updates.updatedAt = new Date();
  return Message.findByIdAndUpdate(id, { $set: updates }, { new: true, session }).exec();
}

/**
 * softDeleteMessage
 * - Soft delete (visible=false, status='deleted') and record who deleted it.
 * - Returns the updated document.
 */
async function softDeleteMessage(id, { byUserId = null, session = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const updates = {
    visible: false,
    status: 'deleted',
    updatedAt: new Date()
  };
  if (byUserId) {
    updates['metadata.deletedBy'] = byUserId;
    updates['metadata.deletedAt'] = new Date();
  } else {
    updates['metadata.deletedAt'] = new Date();
  }
  return Message.findByIdAndUpdate(id, { $set: updates }, { new: true, session }).exec();
}

/**
 * hardDeleteMessage
 * - Permanently remove a message document. Intended for admin-only operations.
 * - Caller must enforce admin authorization.
 */
async function hardDeleteMessage(id, { session = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Message.findByIdAndDelete(id, { session }).exec();
}

/**
 * findByMetadata (single)
 * - Convenience wrapper returning array of messages matching metadata key/value.
 */
async function findByMetadata(key, value, { limit = 50, visibleOnly = true } = {}) {
  return listByMetadata(key, value, { page: 1, limit, visibleOnly });
}

module.exports = {
  createMessage,
  findById,
  listForUser,
  listByType,
  listThread,
  listByMetadata,
  findByIdempotency,
  updateMessage,
  softDeleteMessage,
  hardDeleteMessage,
  findByMetadata
};
