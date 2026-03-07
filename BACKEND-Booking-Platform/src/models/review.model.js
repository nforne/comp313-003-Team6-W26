// src/models/review.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ReviewSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  revieweeId: { type: Schema.Types.ObjectId, required: true, index: true }, // service_id or user_id
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true }, // optional: enforce one review per booking per user
  reviewPoints: { type: Number, required: true, min: 1, max: 5 },
  // single message reference (primary message for the review)
  messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true, index: true },
  visible: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
  idempotencyKey: { type: String, default: null, sparse: true, index: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true, versionKey: false }
});

// Ensure one review per booking per user (only applies when bookingId exists)
ReviewSchema.index(
  { bookingId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: { $type: 'objectId' } },
    name: 'unique_booking_review_per_user'
  }
);

// paginate messages related to this review (delegates to Message model)
ReviewSchema.methods.loadMessages = async function (page = 1, limit = 10) {
  const Message = mongoose.model('Message');
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const skip = (p - 1) * l;

  // Primary message first, then replies that reference reviewId
  const query = { visible: true, $or: [{ _id: this.messageId }, { reviewId: this._id }] };
  const [results, total] = await Promise.all([
    Message.find(query).sort({ createdAt: 1 }).skip(skip).limit(l).lean().exec(),
    Message.countDocuments(query)
  ]);
  return { results, page: p, limit: l, total };
};

ReviewSchema.options.toJSON.transform = function (doc, ret) {
  ret.id = ret._id; delete ret._id;
  if (ret.createdAt) ret.createdAt = new Date(ret.createdAt).getTime();
  if (ret.updatedAt) ret.updatedAt = new Date(ret.updatedAt).getTime();
  return {
    id: ret.id,
    user_id: ret.userId,
    reviewee_id: ret.revieweeId,
    booking_id: ret.bookingId || null,
    review_points: ret.reviewPoints,
    message: { id: ret.messageId },
    createdAt: ret.createdAt,
    updatedAt: ret.updatedAt
  };
};

module.exports = mongoose.model('Review', ReviewSchema);
