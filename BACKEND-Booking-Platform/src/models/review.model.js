// src/models/review.model.js
//
// Review model
// - Stores a single review left by a user for a reviewee (service or user).
// - Optionally tied to a booking (enforces one review per booking per user).
// - References a primary message (messageId) which holds the review text; additional messages/replies
//   related to the review are stored in the Message model and can be paginated via loadMessages.
// - Exposes a clean JSON representation suitable for API responses.
//
// Notes:
// - reviewPoints is an integer between 1 and 5.
// - idempotencyKey is sparse and indexed to support idempotent create operations.
// - The unique index on { bookingId, userId } is partial and only applies when bookingId is an ObjectId.

const mongoose = require("mongoose");
const { Schema } = mongoose;

const ReviewSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    revieweeId: { type: Schema.Types.ObjectId, required: true, index: true }, // service_id or user_id
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    }, // optional: one review per booking per user
    reviewPoints: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "reviewPoints must be an integer",
      },
    },
    // Primary message that contains the review text; replies and related messages reference reviewId
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      required: true,
      index: true,
    },
    visible: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, default: null, sparse: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
  },
);

/**
 * Unique index: one review per booking per user.
 * - Partial index ensures uniqueness only when bookingId is present and is an ObjectId.
 * - Name provided for clarity in DB tooling.
 */
ReviewSchema.index(
  { bookingId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: { $type: "objectId" } },
    name: "unique_booking_review_per_user",
  },
);

/**
 * loadMessages
 * - Paginate messages related to this review.
 * - Primary message (messageId) is included in the result set along with replies that reference reviewId.
 * - Pagination is applied across the combined set; ordering is by createdAt ascending.
 *
 * @param {number} page - 1-based page number
 * @param {number} limit - page size (max 100)
 * @returns {Promise<{results: Array, page: number, limit: number, total: number}>}
 */
ReviewSchema.methods.loadMessages = async function (page = 1, limit = 10) {
  const Message = mongoose.model("Message");
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const skip = (p - 1) * l;

  // Primary message plus replies referencing this review
  const query = {
    visible: true,
    $or: [{ _id: this.messageId }, { reviewId: this._id }],
  };

  const [results, total] = await Promise.all([
    Message.find(query)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(l)
      .lean()
      .exec(),
    Message.countDocuments(query),
  ]);

  return { results, page: p, limit: l, total };
};

/**
 * toJSON transform
 * - Normalizes field names for API consumers and converts timestamps to epoch ms.
 * - Returns a compact object with the most relevant fields for a review listing.
 */
ReviewSchema.options.toJSON.transform = function (doc, ret) {
  // Normalize id
  const id = ret._id;
  // Convert timestamps to epoch ms if present
  const createdAt = ret.createdAt
    ? ret.createdAt instanceof Date
      ? ret.createdAt.getTime()
      : new Date(ret.createdAt).getTime()
    : undefined;
  const updatedAt = ret.updatedAt
    ? ret.updatedAt instanceof Date
      ? ret.updatedAt.getTime()
      : new Date(ret.updatedAt).getTime()
    : undefined;

  return {
    id: id,
    user_id: ret.userId,
    reviewee_id: ret.revieweeId,
    booking_id: ret.bookingId || null,
    review_points: ret.reviewPoints,
    message: { id: ret.messageId },
    createdAt,
    updatedAt,
  };
};

module.exports = mongoose.model("Review", ReviewSchema);
