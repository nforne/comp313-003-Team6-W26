// src/repositories/review.repo.js
//
// Repository for Review persistence and related Message coordination.
// - Single-message-per-review shape: Review.messageId references authoritative Message doc.
// - Uses transactions for create flows to keep Review <-> Message consistent.
// - Exposes CRUD, listing, pagination, and helper to load messages for a review.
// - Audit logging is best-effort and does not change primary operation outcomes.

const mongoose = require('mongoose');
const Review = require('../models/review.model');
const Message = require('../models/message.model');
const auditService = require('../services/audit.service'); // optional; safe if missing

class ReviewRepo {
  /**
   * create
   * - Creates a Message and Review atomically (transaction).
   * - Enforces idempotency if idempotencyKey + userId provided: returns existing review.
   * @param {Object} reviewAttrs - { userId, revieweeId, reviewPoints, metadata, idempotencyKey, bookingId }
   * @param {Object} messageAttrs - { subject, details, attachments, status }
   * @param {Object} opts - { actor, logger, messagePersistAsSubmitted=false }
   * @returns {Promise<Object>} saved review (lean)
   */
  static async create(reviewAttrs = {}, messageAttrs = {}, opts = {}) {
    const logger = opts.logger || console;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Idempotency check (best-effort)
      if (reviewAttrs.idempotencyKey && reviewAttrs.userId) {
        const existing = await Review.findOne({
          idempotencyKey: reviewAttrs.idempotencyKey,
          userId: reviewAttrs.userId
        }).lean().exec();
        if (existing) {
          logger.info && logger.info({ event: 'review.create.idempotent', reviewId: existing._id });
          await session.abortTransaction();
          session.endSession();
          return existing;
        }
      }

      // Create message
      const messagePayload = {
        type: 'review',
        subject: messageAttrs.subject || null,
        details: messageAttrs.details || reviewAttrs.messageText || '',
        attachments: messageAttrs.attachments || [],
        userId: reviewAttrs.userId,
        metadata: Object.assign({}, messageAttrs.metadata || {}, { revieweeId: reviewAttrs.revieweeId }),
        status: opts.messagePersistAsSubmitted ? 'submitted' : (messageAttrs.status || 'draft'),
        idempotencyKey: messageAttrs.idempotencyKey || null
      };

      const messageDoc = new Message(messagePayload);
      await messageDoc.save({ session });

      // Create review referencing message
      const reviewPayload = {
        userId: reviewAttrs.userId,
        revieweeId: reviewAttrs.revieweeId,
        bookingId: reviewAttrs.bookingId || null,
        reviewPoints: reviewAttrs.reviewPoints,
        messageId: messageDoc._id,
        metadata: reviewAttrs.metadata || {},
        idempotencyKey: reviewAttrs.idempotencyKey || null
      };

      const reviewDoc = new Review(reviewPayload);
      await reviewDoc.save({ session });

      // Link reviewId back to message metadata (optional)
      messageDoc.metadata = messageDoc.metadata || {};
      messageDoc.metadata.reviewId = reviewDoc._id;
      await messageDoc.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Best-effort audit
      try {
        await auditService.logEvent({
          event: 'review.create',
          actor: opts.actor || reviewAttrs.userId,
          reviewId: reviewDoc._id,
          messageId: messageDoc._id,
          meta: { revieweeId: reviewAttrs.revieweeId, reviewPoints: reviewAttrs.reviewPoints, bookingId: reviewAttrs.bookingId || null }
        });
      } catch (auditErr) {
        logger.warn && logger.warn({ event: 'audit.failed', error: auditErr && auditErr.message ? auditErr.message : String(auditErr) });
      }

      return await Review.findById(reviewDoc._id).lean().exec();
    } catch (err) {
      try { await session.abortTransaction(); } catch (_) {}
      session.endSession();
      throw err;
    }
  }

  /**
   * getById
   * - Returns review (lean). If review is soft-deleted, returns minimal DTO shape (model's toJSON handles this).
   * @param {String|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  static async getById(id) {
    if (!id) return null;
    return Review.findById(id).lean().exec();
  }

  /**
   * listByReviewee
   * - Paginated list of reviews for a reviewee (service or user).
   * - Only returns visible reviews by default.
   * @param {ObjectId|String} revieweeId
   * @param {Object} opts - { page=1, limit=20, sort={createdAt:-1}, includeHidden=false }
   */
  static async listByReviewee(revieweeId, opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const sort = opts.sort || { createdAt: -1 };

    const query = { revieweeId: revieweeId };
    if (!opts.includeHidden) query.visible = true;

    const [results, total] = await Promise.all([
      Review.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
      Review.countDocuments(query)
    ]);

    return { results, page, limit, total };
  }

  /**
   * listByBookingId
   * - Paginated list of reviews for a booking (should be at most one per user due to unique index).
   * - Useful to fetch the review(s) tied to a booking (customer and provider can both leave reviews).
   * @param {ObjectId|String} bookingId
   * @param {Object} opts - { page=1, limit=20, sort={createdAt:-1}, includeHidden=false }
   */
  static async listByBookingId(bookingId, opts = {}) {
    if (!bookingId) return { results: [], page: 1, limit: 0, total: 0 };

    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const sort = opts.sort || { createdAt: -1 };

    const query = { bookingId: bookingId };
    if (!opts.includeHidden) query.visible = true;

    const [results, total] = await Promise.all([
      Review.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
      Review.countDocuments(query)
    ]);

    return { results, page, limit, total };
  }

  /**
   * update
   * - Updates review fields and optionally updates the linked Message if message updates provided.
   * - If message update is provided, updates Message document (not embedded copy).
   * @param {String|ObjectId} id
   * @param {Object} updates - allowed: reviewPoints, metadata, messageUpdate: { details, attachments, subject, status }
   * @param {Object} opts - { actor, logger }
   */
  static async update(id, updates = {}, opts = {}) {
    const logger = opts.logger || console;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        session.endSession();
        return null;
      }

      // Apply review-level updates
      if (typeof updates.reviewPoints !== 'undefined') review.reviewPoints = updates.reviewPoints;
      if (typeof updates.metadata !== 'undefined') review.metadata = updates.metadata;

      await review.save({ session });

      // Optionally update linked message
      if (updates.messageUpdate && review.messageId) {
        const msgUpd = {};
        if (typeof updates.messageUpdate.details !== 'undefined') msgUpd.details = updates.messageUpdate.details;
        if (typeof updates.messageUpdate.subject !== 'undefined') msgUpd.subject = updates.messageUpdate.subject;
        if (typeof updates.messageUpdate.attachments !== 'undefined') msgUpd.attachments = updates.messageUpdate.attachments;
        if (typeof updates.messageUpdate.status !== 'undefined') msgUpd.status = updates.messageUpdate.status;

        if (Object.keys(msgUpd).length) {
          await Message.findByIdAndUpdate(review.messageId, { $set: msgUpd }, { new: true, session }).exec();
        }
      }

      await session.commitTransaction();
      session.endSession();

      // audit best-effort
      try {
        await auditService.logEvent({
          event: 'review.update',
          actor: opts.actor || null,
          reviewId: review._id,
          meta: { updates: Object.keys(updates) }
        });
      } catch (auditErr) {
        logger.warn && logger.warn({ event: 'audit.failed', error: auditErr && auditErr.message ? auditErr.message : String(auditErr) });
      }

      return await Review.findById(id).lean().exec();
    } catch (err) {
      try { await session.abortTransaction(); } catch (_) {}
      session.endSession();
      throw err;
    }
  }

  /**
   * softDelete
   * - Soft-deletes the review and optionally soft-deletes the linked message.
   * - Returns the updated review (lean).
   * @param {String|ObjectId} id
   * @param {Object} opts - { actor, alsoDeleteMessage=false, logger }
   */
  static async softDelete(id, opts = {}) {
    const logger = opts.logger || console;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        session.endSession();
        return null;
      }

      review.visible = false;
      review.deletedAt = new Date();
      review.metadata = review.metadata || {};
      review.metadata.audit = Object.assign(review.metadata.audit || {}, {
        removedBy: opts.actor && (opts.actor.userId || opts.actor) || null,
        removedAt: review.deletedAt
      });
      await review.save({ session });

      if (opts.alsoDeleteMessage && review.messageId) {
        const msg = await Message.findById(review.messageId).session(session);
        if (msg) {
          msg.visible = false;
          msg.metadata = msg.metadata || {};
          msg.metadata.audit = Object.assign(msg.metadata.audit || {}, { removedBy: opts.actor && (opts.actor.userId || opts.actor) || null, removedAt: new Date() });
          await msg.save({ session });
        }
      }

      await session.commitTransaction();
      session.endSession();

      try {
        await auditService.logEvent({
          event: 'review.soft_delete',
          actor: opts.actor || null,
          reviewId: review._id
        });
      } catch (auditErr) {
        logger.warn && logger.warn({ event: 'audit.failed', error: auditErr && auditErr.message ? auditErr.message : String(auditErr) });
      }

      return await Review.findById(id).lean().exec();
    } catch (err) {
      try { await session.abortTransaction(); } catch (_) {}
      session.endSession();
      throw err;
    }
  }

  /**
   * hardDelete
   * - Permanently removes the review and optionally the linked message.
   * - Admin-only responsibility should be enforced by caller.
   * @param {String|ObjectId} id
   * @param {Object} opts - { alsoDeleteMessage=false, logger }
   */
  static async hardDelete(id, opts = {}) {
    const logger = opts.logger || console;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        session.endSession();
        return null;
      }

      const messageId = review.messageId;

      await Review.deleteOne({ _id: id }).session(session);

      if (opts.alsoDeleteMessage && messageId) { // call message repo delete instead
        await Message.deleteOne({ _id: messageId }).session(session);
      }

      await session.commitTransaction();
      session.endSession();

      try {
        await auditService.logEvent({
          event: 'review.hard_delete',
          actor: opts.actor || null,
          reviewId: id,
          messageId
        });
      } catch (auditErr) {
        logger.warn && logger.warn({ event: 'audit.failed', error: auditErr && auditErr.message ? auditErr.message : String(auditErr) });
      }

      return { ok: true };
    } catch (err) {
      try { await session.abortTransaction(); } catch (_) {}
      session.endSession();
      throw err;
    }
  }

  /**
   * loadMessages
   * - Convenience: delegates to Review model's loadMessages instance method.
   * @param {String|ObjectId} reviewId
   * @param {Number} page
   * @param {Number} limit
   */
  static async loadMessages(reviewId, page = 1, limit = 10) {
    const review = await Review.findById(reviewId);
    if (!review) return { results: [], page, limit, total: 0 };
    return review.loadMessages(page, limit);
  }
}

module.exports = ReviewRepo;
