// src/models/bid.model.js
/**
 * Bid schema (snake_case fields). Uses MongoDB _id as primary identifier.
 * createdAt / updatedAt stored as epoch milliseconds (Number).
 *
 * Business index: prevent more than one active (non-archived) bid per provider per request.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const BidSchema = new Schema({
  request_id: { type: String, required: true, index: true },
  provider_id: { type: String, required: true, index: true }, // 16-digit userId per spec
  quote_amount: { type: Number, required: true },
  currency: { type: String, required: true, maxlength: 3 }, // ISO 4217
  services: { type: [String], default: [] }, // optional list of service ids
  message: { type: Schema.Types.ObjectId, ref: 'Message', required: false, index: true },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'withdrawn', 'accepted', 'rejected', 'cancelled', 'pending_accept'],
    default: 'submitted',
    index: true
  },
  metadata: { type: Schema.Types.Mixed, default: {} },
  // Do not rely on schema defaults for timestamps here; pre-save hook will set them.
  createdAt: { type: Number, index: true },
  updatedAt: { type: Number },
  archived: { type: Boolean, default: false } // soft-delete flag for non-draft deletions
}, {
  timestamps: false,
  versionKey: false
});

// keep timestamps as epoch ms; synchronous pre-save ensures values are set before the actual save.
// This is intentionally a non-async callback so Mongoose invokes it in callback mode and next() is valid.
BidSchema.pre('save', function () {
  try {
    const now = Date.now();
    this.updatedAt = now;
    if (!this.createdAt) this.createdAt = now;
  } catch (err) {
    throw new Error(`Keep timestamps at epoch ms failed ${err.message}`)
  }
 
});

// Prevent more than one active (non-archived) bid per provider per request
BidSchema.index(
  { request_id: 1, provider_id: 1 },
  { unique: true, partialFilterExpression: { archived: false } }
);

module.exports = mongoose.models.Bid || mongoose.model('Bid', BidSchema);
