/**
 * src/models/bid.model.js
 *
 * Bid schema (snake_case fields). Uses MongoDB _id as primary identifier.
 * createdAt / updatedAt stored as epoch milliseconds (Number).
 *
 * Business index: prevent more than one active (non-archived) bid per provider per request.
 */

const mongoose = require('mongoose');

const BidSchema = new mongoose.Schema({
  request_id: { type: String, required: true, index: true },
  provider_id: { type: String, required: true, index: true }, // 16-digit userId per spec
  quote_amount: { type: Number, required: true },
  currency: { type: String, required: true, length: 3 }, // ISO 4217
  services: { type: [String], default: [] },// optional list of service ids
  message: { type: Schema.Types.ObjectId, ref: 'Message', required: false, index: true },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'withdrawn', 'accepted', 'rejected', 'cancelled', 'pending_accept'],
    default: 'submitted',
    index: true
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Number, default: () => Date.now(), index: true },
  updatedAt: { type: Number, default: () => Date.now() },
  archived: { type: Boolean, default: false } // soft-delete flag for non-draft deletions
}, {
  timestamps: false,
  versionKey: false
});

BidSchema.pre('save', function (next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

// Prevent more than one active (non-archived) bid per provider per request
BidSchema.index(
  { request_id: 1, provider_id: 1 },
  { unique: true, partialFilterExpression: { archived: false } }
);

module.exports = mongoose.model('Bid', BidSchema);
