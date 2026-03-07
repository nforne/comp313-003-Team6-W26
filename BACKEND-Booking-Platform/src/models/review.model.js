// src/models/review.model.js
const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['Service', 'Owner'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewerName: { type: String, default: null },
  anonymous: { type: Boolean, default: false },
  bookingId: { type: String, default: null, index: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  title: { type: String, maxlength: 140, default: '' },
  body: { type: String, maxlength: 2000, default: '' },
  status: { type: String, enum: ['published', 'pending', 'removed'], default: 'pending', index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Unique constraint to avoid duplicate reviews for same reviewer + target + booking
ReviewSchema.index({ targetType: 1, targetId: 1, reviewerId: 1, bookingId: 1 }, { unique: true, partialFilterExpression: { reviewerId: { $type: 'objectId' } } });

module.exports = mongoose.model('Review', ReviewSchema);
