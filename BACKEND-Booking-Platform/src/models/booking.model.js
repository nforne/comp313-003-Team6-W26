/**
 * src/models/booking.model.js
 *
 * Booking model (production-ready)
 *
 * - Uses epoch milliseconds (Number) for createdAt / updatedAt and slot boundaries.
 * - Includes validation for slots (from < to, no overlaps, reasonable duration bounds).
 * - Provides instance helpers and static query helpers used by services and repos.
 *
 * Non-disruptive: existing fields, hooks and indexes preserved. Added small helpers:
 *  - statics.findByBookingId
 *  - methods.cancel
 *  - lightweight services validator
 *  - virtuals firstSlotFrom / lastSlotTo
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Generate a readable booking id (optional).
 * Format: bkn_{timestamp}_{4hex}
 */
function generateBookingId() {
  return `bkn_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * Slot subdocument schema
 * - from / to are epoch milliseconds (Number)
 */
const SlotSchema = new mongoose.Schema({
  from: { type: Number, required: true },
  to: { type: Number, required: true }
}, { _id: false });

/**
 * Booking schema
 */
const BookingSchema = new mongoose.Schema({
  booking_id: { type: String, required: true, unique: true, default: generateBookingId, index: true },

  request_id: { type: String, required: true, index: true },
  seeker_id: { type: String, required: true, index: true },
  provider_id: { type: String, required: true, index: true },
  bid_id: { type: String, default: null, index: true },

  quote_amount: { type: Number, required: true },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'CAD',
    validate: {
      validator: v => typeof v === 'string' && v.length === 3,
      message: props => `${props.value} is not a valid 3-letter currency code`
    }
  },

  what: { type: String, default: '' },
  where: { type: String, default: '' },

  /**
   * slots: array of { from: Number(epoch ms), to: Number(epoch ms) }
   * - validated in pre-validate hook for ordering and overlap
   */
  slots: { type: [SlotSchema], default: [] },

  services: { type: [String], default: [] }, // service ids (svc_...)
  bids: { type: [String], default: [] },     // related bid ids (optional)

  description: { type: String, default: '' },

  /**
   * status:
   * - active: booking confirmed and upcoming
   * - honored: booking completed successfully
   * - seeker_cancelled / provider_cancelled: cancelled by party
   * - suspended: administrative hold
   */
  status: {
    type: String,
    enum: ['active', 'honored', 'seeker_cancelled', 'provider_cancelled', 'suspended'],
    default: 'active',
    index: true
  },

  messages: { type: [String], default: [] }, // message ids
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  // epoch ms timestamps
  createdAt: { type: Number, default: () => Date.now(), index: true },
  updatedAt: { type: Number, default: () => Date.now() }
}, {
  timestamps: false,
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

/* -------------------------
 * Virtuals
 * ------------------------- */

/**
 * firstSlotFrom / lastSlotTo
 * - convenience virtuals for quick range queries and sorting
 */
BookingSchema.virtual('firstSlotFrom').get(function () {
  if (!Array.isArray(this.slots) || this.slots.length === 0) return null;
  return this.slots.reduce((min, s) => (min === null || s.from < min ? s.from : min), null);
});

BookingSchema.virtual('lastSlotTo').get(function () {
  if (!Array.isArray(this.slots) || this.slots.length === 0) return null;
  return this.slots.reduce((max, s) => (max === null || s.to > max ? s.to : max), null);
});

/* -------------------------
 * Validation helpers
 */

/**
 * Ensure each slot has from < to and durations are within reasonable bounds.
 * Also ensure slots do not overlap each other.
 */
BookingSchema.pre('validate', function (next) {
  const MIN_DURATION_MS = 5 * 60 * 1000;        // 5 minutes
  const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  if (!Array.isArray(this.slots)) {
    this.slots = [];
    return next();
  }

  // Normalize numeric values and validate
  for (let i = 0; i < this.slots.length; i++) {
    const s = this.slots[i];
    if (typeof s.from !== 'number' || typeof s.to !== 'number') {
      const err = new Error('Slot boundaries must be epoch milliseconds (Number)');
      err.status = 400;
      return next(err);
    }
    if (s.from >= s.to) {
      const err = new Error(`Slot.from must be less than slot.to (slot index ${i})`);
      err.status = 400;
      return next(err);
    }
    const dur = s.to - s.from;
    if (dur < MIN_DURATION_MS) {
      const err = new Error(`Slot duration too short (min 5 minutes) at index ${i}`);
      err.status = 400;
      return next(err);
    }
    if (dur > MAX_DURATION_MS) {
      const err = new Error(`Slot duration too long (max 30 days) at index ${i}`);
      err.status = 400;
      return next(err);
    }
  }

  // Check for overlaps: sort by from and ensure no overlap
  const sorted = this.slots.slice().sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) {
      const err = new Error('Slots must not overlap');
      err.status = 400;
      return next(err);
    }
  }

  // Lightweight services validation: ensure service ids look like 'svc_...' when present
  if (Array.isArray(this.services)) {
    for (let i = 0; i < this.services.length; i++) {
      const s = this.services[i];
      if (typeof s !== 'string') {
        const err = new Error(`Service id must be a string at index ${i}`);
        err.status = 400;
        return next(err);
      }
      if (s && !s.startsWith('svc_')) {
        const err = new Error(`Service id must start with 'svc_' at index ${i}`);
        err.status = 400;
        return next(err);
      }
    }
  }

  next();
});

/**
 * Pre-save hook: maintain epoch timestamps
 */
BookingSchema.pre('save', function (next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

/* -------------------------
 * Instance methods
 */

/**
 * isCancelable
 * - returns true if booking is in a state that allows cancellation
 * - NOTE: preserved original behavior (non-disruptive)
 */
BookingSchema.methods.isCancelable = function () {
  return ['active', 'honored'].includes(this.status);
};

/**
 * overlapsWithSlots
 * - checks whether provided slot array overlaps with this booking's slots
 */
BookingSchema.methods.overlapsWithSlots = function (otherSlots = []) {
  if (!Array.isArray(otherSlots) || otherSlots.length === 0 || !Array.isArray(this.slots) || this.slots.length === 0) return false;

  // sort both arrays
  const mine = this.slots.slice().sort((a, b) => a.from - b.from);
  const theirs = otherSlots.slice().sort((a, b) => a.from - b.from);

  let i = 0, j = 0;
  while (i < mine.length && j < theirs.length) {
    const a = mine[i];
    const b = theirs[j];
    // overlap if a.from < b.to && b.from < a.to
    if (a.from < b.to && b.from < a.to) return true;
    if (a.to <= b.from) i++;
    else j++;
  }
  return false;
};

/**
 * cancel
 * - actor: { type: 'seeker'|'provider'|'admin', id: string }
 * - reason: optional string
 * - sets status to seeker_cancelled or provider_cancelled (or suspended for admin if desired)
 * - records cancellation metadata under metadata.cancellations (append)
 */
BookingSchema.methods.cancel = async function (actor = {}, reason = '') {
  if (!this.isCancelable()) {
    const err = new Error('Booking not cancelable in current state');
    err.status = 400;
    throw err;
  }

  const actorType = actor && actor.type ? actor.type : null;
  const actorId = actor && actor.id ? actor.id : null;

  if (actorType === 'seeker') this.status = 'seeker_cancelled';
  else if (actorType === 'provider') this.status = 'provider_cancelled';
  else this.status = 'suspended'; // admin or unknown actor -> suspended as safe default

  this.updatedAt = Date.now();

  // append cancellation record
  this.metadata = this.metadata || {};
  this.metadata.cancellations = this.metadata.cancellations || [];
  this.metadata.cancellations.push({
    at: Date.now(),
    by: { type: actorType, id: actorId },
    reason: reason || null
  });

  return this.save();
};

/*
 * -------------------------
 * Static helpers
 * -------------------------
 */

/**
 * findByRequest
 */
BookingSchema.statics.findByRequest = function (requestId) {
  return this.find({ request_id: requestId }).exec();
};

/**
 * findByBookingId
 * - convenience wrapper for external lookups by booking_id
 */
BookingSchema.statics.findByBookingId = function (bookingId) {
  return this.findOne({ booking_id: bookingId }).exec();
};

/**
 * listByProvider with pagination
 */
BookingSchema.statics.listByProvider = async function (providerId, { page = 1, pageSize = 20, status } = {}) {
  const filter = { provider_id: providerId };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await this.countDocuments(filter).exec();
  return { results, total, page, pageSize };
};

/**
 * listBySeeker with pagination
 */
BookingSchema.statics.listBySeeker = async function (seekerId, { page = 1, pageSize = 20, status } = {}) {
  const filter = { seeker_id: seekerId };
  if (status) filter.status = status;
  const skip = (page - 1) * pageSize;
  const results = await this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec();
  const total = await this.countDocuments(filter).exec();
  return { results, total, page, pageSize };
};

/* -------------------------
 * Indexes
 *
 * - booking_id unique for external references
 * - compound index to speed up provider slot queries (note: slot overlap checks are application-level)
 */
BookingSchema.index({ provider_id: 1, 'slots.from': 1, 'slots.to': 1 });
BookingSchema.index({ request_id: 1, provider_id: 1 });

module.exports = mongoose.model('Booking', BookingSchema);
