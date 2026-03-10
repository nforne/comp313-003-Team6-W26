// src/models/request.model.js
//
// Request model
// - Represents a consumer request for services with optional geolocation, time window, and bidding.
// - Keeps explicit expiration fields (expiresAt epoch ms and expiresAtDate Date) for scheduling and reporting.
// - IMPORTANT: TTL deletion code is commented out below to avoid server-side deletion. Use an application worker to mark requests expired.

const mongoose = require('mongoose');

const WhenSchema = new mongoose.Schema({
  from: { type: Number, required: true }, // epoch ms UTC
  to: { type: Number, required: true }    // epoch ms UTC
}, { _id: false });

const RequestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  createdBy: { type: String, required: true, index: true }, // userId of creator
  services: { type: [String], default: [] }, // may contain serviceId (svc_...) or provider userId
  categories: { type: [String], default: [] },
  locations: { type: [String], default: [] },
  geo: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined } // [lng, lat]
  },
  when: { type: WhenSchema, required: true },
  bids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bid' }],
  isPrivate: { type: Boolean, default: false },
  // allowedProviders MUST contain provider userIds only (no serviceIds). Service-layer will populate from services when needed.
  allowedProviders: { type: [String], default: [], index: true },

  // New: explicit expiration time (epoch ms).
  expiresAt: { type: Number, default: null, index: true },

  // Date form of expiresAt (kept for scheduling/reporting).
  expiresAtDate: { type: Date, default: null },

  status: { type: String, enum: ['draft','active','expired','booked','suspended','cancelled'], default: 'draft' },

  createdAt: { type: Number },
  updatedAt: { type: Number }
}, { collection: 'requests' });

/**
 * Indexes
 */
RequestSchema.index({ createdBy: 1, status: 1 });
RequestSchema.index({ categories: 1 });
RequestSchema.index({ 'geo': '2dsphere' });
RequestSchema.index({ expiresAt: 1 });

/**
 * TTL index creation (disabled)
 *
 * The code below previously created a TTL index on expiresAtDate which causes MongoDB to
 * delete documents when the indexed date + expireAfterSeconds is older than now.
 * That behavior is intentionally disabled to preserve request documents; expiration
 * should be handled by an application worker that marks requests as 'expired'.
 *
 * If you ever want to re-enable TTL deletion, uncomment and set REQUEST_EXPIRES_TTL_SECONDS
 * appropriately in your environment. Example:
 *
 * // const TTL_SECONDS = Number(process.env.REQUEST_EXPIRES_TTL_SECONDS || 0);
 * // if (TTL_SECONDS >= 0) {
 * //   // createIndex is idempotent; safe to call on startup
 * //   RequestSchema.index({ expiresAtDate: 1 }, { expireAfterSeconds: TTL_SECONDS });
 * // }
 */

/**
 * Pre-save hook: maintain epoch timestamps and sync expiresAt/Date
 */
RequestSchema.pre('save', function(next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;

  // If expiresAt not provided, default to when.to (end of requested window)
  if ((!this.expiresAt || this.expiresAt === null) && this.when && typeof this.when.to === 'number') {
    this.expiresAt = Number(this.when.to);
  }

  // Keep expiresAtDate in sync (null if no expiresAt)
  if (this.expiresAt && typeof this.expiresAt === 'number') {
    this.expiresAtDate = new Date(Number(this.expiresAt));
  } else {
    this.expiresAtDate = null;
  }

  next();
});

/**
 * Static helper: find requests that are candidates to be marked expired.
 * Use in a background job to set status='expired' for requests past expiresAt.
 *
 * Example usage:
 *   const now = Date.now();
 *   const candidates = await Request.findExpiredCandidates(now);
 *   // iterate and set status to 'expired' where appropriate
 */
RequestSchema.statics.findExpiredCandidates = function(nowEpochMs = Date.now(), limit = 100) {
  return this.find({
    status: 'active',
    expiresAt: { $lte: Number(nowEpochMs) }
  }).limit(limit).lean().exec();
};

/**
 * Atomic helper: mark a single request expired if still active and past expiresAt.
 * Returns the updated document or null if no update occurred.
 */
RequestSchema.statics.markExpired = function(requestId) {
  return this.findOneAndUpdate(
    { _id: requestId, status: 'active', expiresAt: { $lte: Date.now() } },
    { $set: { status: 'expired', updatedAt: Date.now() } },
    { new: true }
  ).lean().exec();
};

module.exports = mongoose.model('Request', RequestSchema);
