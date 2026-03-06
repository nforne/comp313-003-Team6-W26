// src/models/booking.model.js
/**
 * Booking model (production-ready)
 *
 * - Uses epoch milliseconds (Number) for createdAt / updatedAt and slot boundaries.
 * - Includes validation for slots (from < to, no overlaps, reasonable duration bounds).
 * - Provides instance helpers and static query helpers used by services and repos.
 *
 * Field naming follows snake_case to match existing codebase conventions.
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
    default: 'USD',
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

/**
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

/**
 * Instance methods
 */

/**
 * isCancelable
 * - returns true if booking is in a state that allows cancellation
 */
BookingSchema.methods.isCancelable = function () {
  return ['active', 'honored'].includes(this.status);
};

/**
 * overlapsWithSlots
 * - checks whether provided slot array overlaps with this booking's slots
 * - useful for calendar/conflict checks at model level
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
 * Static helpers
 */

/**
 * findByRequest
 */
BookingSchema.statics.findByRequest = function (requestId) {
  return this.find({ request_id: requestId }).exec();
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

/**
 * Indexes
 *
 * - booking_id unique for external references
 * - compound index to speed up provider slot queries (note: slot overlap checks are application-level)
 */
BookingSchema.index({ provider_id: 1, 'slots.from': 1, 'slots.to': 1 });
BookingSchema.index({ request_id: 1, provider_id: 1 });

module.exports = mongoose.model('Booking', BookingSchema);
