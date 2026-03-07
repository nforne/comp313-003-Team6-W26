// src/services/review.service.js
//
// High-level Review service.
// - Coordinates creation of Review + authoritative Message (atomic via mongoose transactions).
// - Delegates persistence to ReviewRepo where appropriate.
// - Performs validation, idempotency handling, booking participation checks (seeker/provider), and emits best-effort audit/log events.
// - Returns normalized DTOs (lean objects) suitable for controllers.

const mongoose = require('mongoose');
const Review = require('../models/review.model');
const Message = require('../models/message.model');
const Booking = require('../models/booking.model'); // used to validate booking participation (booking_id, seeker_id, provider_id)
const ReviewRepo = require('../repositories/review.repo');
const auditService = require('./audit.service'); // optional; safe if missing

const DEFAULT_MESSAGE_STATUS = 'submitted';

class ReviewService {
  /**
   * createReview
   * - Creates a Message and Review atomically and returns the saved review (lean).
   * - Enforces idempotency when idempotencyKey + userId provided.
   * - Enforces one-review-per-booking when bookingId is provided (fast pre-check + DB unique index).
   *
   * @param {Object} attrs
   *   {
   *     userId,                // required (ObjectId or string)
   *     revieweeId,            // required (service_id or user_id)
   *     reviewPoints,          // required (1-5)
   *     bookingId,             // optional: booking.booking_id (string) - enforces one review per booking per user
   *     messageText,           // optional
   *     messageSubject,        // optional
   *     attachments,           // optional array
   *     idempotencyKey,        // optional
   *     metadata               // optional
   *   }
   * @param {Object} opts
   *   {
   *     actor,                 // actor for audit (optional)
   *     logger,                // logger (optional)
   *     messageStatus,         // 'draft'|'submitted' (default submitted)
   *     failOnDuplicate = false // if true, throw on duplicate idempotency key
   *   }
   */
  static async createReview(attrs = {}, opts = {}) {
    const logger = opts.logger || console;

    // Basic validation
    if (!attrs || !attrs.userId) throw new Error('userId required');
    if (!attrs || !attrs.revieweeId) throw new Error('revieweeId required');
    if (typeof attrs.reviewPoints === 'undefined') throw new Error('reviewPoints required');
    const rp = Number(attrs.reviewPoints);
    if (!Number.isFinite(rp) || rp < 1 || rp > 5) throw new Error('reviewPoints must be between 1 and 5');

    // If bookingId provided, validate booking exists and user is a participant (seeker or provider)
    if (attrs.bookingId) {
      // bookingId is expected to be the booking.booking_id (string) per your Booking schema
      const booking = await Booking.findOne({ booking_id: attrs.bookingId }).lean().exec();
      if (!booking) throw new Error('invalid_booking');

      const userIdStr = String(attrs.userId);
      const isParticipant =
        (booking.seeker_id && String(booking.seeker_id) === userIdStr) ||
        (booking.provider_id && String(booking.provider_id) === userIdStr);

      if (!isParticipant) throw new Error('not_allowed_to_review_booking');
    }

    // Idempotency check (fast path)
    if (attrs.idempotencyKey && attrs.userId) {
      const existing = await Review.findOne({ idempotencyKey: attrs.idempotencyKey, userId: attrs.userId }).lean().exec();
      if (existing) {
        logger.info && logger.info({ event: 'review.create.idempotent', reviewId: existing._id });
        if (opts.failOnDuplicate) throw new Error('duplicate request');
        return existing;
      }
    }

    // Enforce one-review-per-booking (fast pre-check). DB unique index will still protect against races.
    if (attrs.bookingId && attrs.userId) {
      // bookingId stored on Review as bookingId (ObjectId or string depending on your usage).
      // We store bookingId as the booking.booking_id string here to match Booking schema.
      const existingBookingReview = await Review.findOne({ bookingId: attrs.bookingId, userId: attrs.userId }).lean().exec();
      if (existingBookingReview) {
        // If idempotency key matches, return existing; otherwise surface a clear error
        if (attrs.idempotencyKey && existingBookingReview.idempotencyKey === attrs.idempotencyKey) {
          logger.info && logger.info({ event: 'review.create.booking.idempotent', reviewId: existingBookingReview._id });
          return existingBookingReview;
        }
        throw new Error('review_already_exists_for_booking');
      }
    }

    // Delegate to repository which performs the atomic create (message + review) inside a transaction.
    try {
      const reviewAttrs = {
        userId: attrs.userId,
        revieweeId: attrs.revieweeId,
        // store bookingId exactly as provided (booking.booking_id string). Model index enforces uniqueness.
        bookingId: attrs.bookingId || null,
        reviewPoints: Math.round(rp),
        messageText: attrs.messageText || '',
        metadata: attrs.metadata || {},
        idempotencyKey: attrs.idempotencyKey || null
      };

      const messageAttrs = {
        subject: opts.messageSubject || attrs.messageSubject || `Review from ${String(attrs.userId)}`,
        details: attrs.messageText || '',
        attachments: attrs.attachments || [],
        metadata: Object.assign({}, attrs.metadata || {}, { revieweeId: attrs.revieweeId, bookingId: attrs.bookingId || null }),
        status: opts.messageStatus || DEFAULT_MESSAGE_STATUS,
        idempotencyKey: attrs.idempotencyKey || null
      };

      const created = await ReviewRepo.create(reviewAttrs, messageAttrs, {
        actor: opts.actor,
        logger,
        messagePersistAsSubmitted: (opts.messageStatus || DEFAULT_MESSAGE_STATUS) === 'submitted'
      });

      // Best-effort audit/log
      try {
        await auditService.logEvent({
          event: 'review.created',
          actor: opts.actor || attrs.userId,
          reviewId: created._id,
          messageId: created.messageId || null,
          meta: { revieweeId: attrs.revieweeId, reviewPoints: created.reviewPoints, bookingId: attrs.bookingId || null }
        });
      } catch (auditErr) {
        logger.warn && logger.warn({ event: 'audit.failed', error: auditErr && auditErr.message ? auditErr.message : String(auditErr) });
      }

      return created;
    } catch (err) {
      // Normalize duplicate-key error coming from DB unique index on bookingId+userId
      if (err && err.code === 11000 && String(err.message).includes('unique_booking_review_per_user')) {
        throw new Error('review_already_exists_for_booking');
      }
      throw err;
    }
  }

  /**
   * getReview
   * - Returns a single review by id (lean) or null.
   */
  static async getReview(id) {
    if (!id) return null;
    return Review.findById(id).lean().exec();
  }

  /**
   * listReviewsForReviewee
   * - Paginated list for a reviewee (service or user).
   * - opts: { page, limit, includeHidden=false, sort }
   */
  static async listReviewsForReviewee(revieweeId, opts = {}) {
    return ReviewRepo.listByReviewee(revieweeId, opts);
  }

  /**
   * listReviewsForBooking
   * - Paginated list of reviews tied to a booking (customer and provider reviews).
   * - opts: { page, limit, includeHidden=false, sort }
   */
  static async listReviewsForBooking(bookingId, opts = {}) {
    if (!bookingId) return { results: [], page: 1, limit: 0, total: 0 };
    return ReviewRepo.listByBookingId(bookingId, opts);
  }

  /**
   * updateReview
   * - Update review fields and optionally update the linked message.
   * - updates: { reviewPoints, metadata, messageUpdate: { details, subject, attachments, status } }
   */
  static async updateReview(id, updates = {}, opts = {}) {
    return ReviewRepo.update(id, updates, opts);
  }

  /**
   * softDeleteReview
   * - Soft-delete review and optionally soft-delete linked message.
   */
  static async softDeleteReview(id, opts = {}) {
    return ReviewRepo.softDelete(id, opts);
  }

  /**
   * hardDeleteReview
   * - Permanently delete review and optionally the linked message (admin only).
   */
  static async hardDeleteReview(id, opts = {}) {
    return ReviewRepo.hardDelete(id, opts);
  }

  /**
   * loadMessages
   * - Convenience wrapper to paginate messages for a review.
   */
  static async loadMessages(reviewId, page = 1, limit = 10) {
    return ReviewRepo.loadMessages(reviewId, page, limit);
  }
}

module.exports = ReviewService;
