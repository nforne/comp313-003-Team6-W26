/**
 * src/models/calendar.model.js
 *
 * Polished Mongoose model for weekly provider/service calendars using epoch ms timestamps.
 *
 * Key behaviors added/clarified:
 * - All timestamps stored as epoch milliseconds (Number).
 * - datesBracket.startEpoch is the Monday 00:00:00.000 UTC epoch for the week.
 * - Missing offLimitsSlots is treated as "no persisted off-limits" (service will compute defaults on read).
 * - When materializing a week, callers should use findOrCreateWeeklyCalendar which will copy-forward
 *   the latest persisted offLimitsSlots for the same serviceId (fallback to user-level) if available.
 * - Exposes copyForwardOffLimits(ownerId, serviceId, weekStartEpoch) to fetch the most recent
 *   offLimitsSlots to persist for a newly materialized week.
 *
 * Note: timezone-aware default off-limits (09:00-17:00 local) is computed in the service layer
 * where an IANA timezone library (Luxon / date-fns-tz) is available.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/* -------------------------
 * Helpers (epoch-based)
 * ------------------------- */

/**
 * Return Monday 00:00:00.000 UTC epoch ms for the week containing `d`.
 * Accepts Date, epoch ms number, or ISO string.
 */
function mondayStartEpoch(d) {
  const date = d instanceof Date ? d : new Date(Number(d));
  const utcDay = date.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const isoWeekday = utcDay === 0 ? 7 : utcDay; // Monday=1..Sunday=7
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysToSubtract = isoWeekday - 1;
  return midnight - daysToSubtract * 24 * 60 * 60 * 1000;
}

/**
 * Given mondayEpoch (ms), return Sunday 23:59:59.999 UTC epoch ms
 */
function sundayEndEpoch(mondayEpoch) {
  return mondayEpoch + 7 * 24 * 60 * 60 * 1000 - 1;
}

/* -------------------------
 * Sub-schemas
 * ------------------------- */

const OffLimitSlotSchema = new Schema(
  {
    weekday: { type: Number, required: true, min: 1, max: 7 }, // 1..7 (Mon..Sun)
    fromEpoch: { type: Number, required: true }, // epoch ms UTC
    toEpoch: { type: Number, required: true }, // epoch ms UTC
    reason: { type: String, default: '' }
  },
  { _id: false }
);

const BookingSlotSchema = new Schema(
  {
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: false },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    fromEpoch: { type: Number, required: true },
    toEpoch: { type: Number, required: true },
    status: {
      type: String,
      enum: ['tentative', 'confirmed', 'cancelled'],
      default: 'tentative'
    },
    capacityUsed: { type: Number, default: 1, min: 0 }
  },
  { _id: true }
);

/* -------------------------
 * Calendar schema
 * ------------------------- */

const CalendarSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: false, index: true },
    timezone: { type: String, required: true, default: 'UTC' }, // IANA tz for display/rrule interpretation
    capacity: { type: Number, required: true, default: 1, min: 1 },

    // canonical week bracket (epoch ms)
    datesBracket: {
      startEpoch: { type: Number, required: true },
      endEpoch: { type: Number, required: true }
    },

    // persisted off-limits (may be empty => no persisted off-limits)
    offLimitsSlots: { type: [OffLimitSlotSchema], default: [] },

    // embedded bookings for the week
    bookingsSlots: { type: [BookingSlotSchema], default: [] },

    // optimistic lock for owner/admin updates (epoch ms when lock acquired)
    updateLockEpoch: { type: Number, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdAtEpoch: { type: Number, default: () => Date.now() },
    updatedAtEpoch: { type: Number, default: () => Date.now() }
  },
  {
    collection: 'calendars'
  }
);

/* -------------------------
 * Indexes
 * ------------------------- */

// ensure one weekly calendar per owner + week
CalendarSchema.index({ ownerId: 1, 'datesBracket.startEpoch': 1 }, { unique: true });
// quick lookup by service + week
CalendarSchema.index({ serviceId: 1, 'datesBracket.startEpoch': 1 });
// for queries by booking ranges (if embedded)
CalendarSchema.index({ ownerId: 1, 'bookingsSlots.fromEpoch': 1, 'bookingsSlots.toEpoch': 1 });

/* -------------------------
 * Pre-save normalization
 * ------------------------- */

CalendarSchema.pre('save', function (next) {
  try {
    // normalize datesBracket.startEpoch to Monday 00:00 UTC and set endEpoch
    if (!this.datesBracket || !this.datesBracket.startEpoch) {
      const monday = mondayStartEpoch(Date.now());
      this.datesBracket = { startEpoch: monday, endEpoch: sundayEndEpoch(monday) };
    } else {
      const monday = mondayStartEpoch(this.datesBracket.startEpoch);
      this.datesBracket.startEpoch = monday;
      this.datesBracket.endEpoch = sundayEndEpoch(monday);
    }

    const now = Date.now();
    this.updatedAtEpoch = now;
    if (!this.createdAtEpoch) this.createdAtEpoch = now;
    next();
  } catch (err) {
    next(err);
  }
});

/* -------------------------
 * Instance methods
 * ------------------------- */

/**
 * Check availability for a slot within this weekly calendar (embedded bookingsSlots).
 * Returns structured result:
 *  { ok: true } or
 *  { ok: false, code: 'OUT_OF_BUSINESS_HOURS'|'CAPACITY_EXCEEDED'|'OUT_OF_RANGE'|'INVALID_RANGE', message: '...' }
 */
CalendarSchema.methods.isSlotAvailableLocal = function (fromEpoch, toEpoch, capacityNeeded = 1) {
  if (typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    throw new Error('fromEpoch and toEpoch must be numbers (epoch ms)');
  }
  if (fromEpoch >= toEpoch) return { ok: false, code: 'INVALID_RANGE', message: 'from must be < to' };

  if (fromEpoch < this.datesBracket.startEpoch || toEpoch > this.datesBracket.endEpoch) {
    return { ok: false, code: 'OUT_OF_RANGE', message: 'slot outside this calendar week' };
  }

  // 1) check persisted off-limits (if any)
  for (const o of this.offLimitsSlots || []) {
    if (o.fromEpoch < toEpoch && o.toEpoch > fromEpoch) {
      return { ok: false, code: 'OUT_OF_BUSINESS_HOURS', message: 'CANNOT book out of business hours' };
    }
  }

  // 2) sum capacityUsed for overlapping bookings (tentative/confirmed)
  let used = 0;
  for (const s of this.bookingsSlots || []) {
    if (s.status === 'cancelled') continue;
    if (s.fromEpoch < toEpoch && s.toEpoch > fromEpoch) {
      used += (s.capacityUsed || 1);
      if (used >= this.capacity) break;
    }
  }

  if (used + capacityNeeded > this.capacity) {
    return { ok: false, code: 'CAPACITY_EXCEEDED', message: 'capacity exceeded for requested slot' };
  }

  return { ok: true };
};

/* -------------------------
 * Static methods (helpers)
 * ------------------------- */

/**
 * findOrCreateWeeklyCalendar(ownerId, serviceId, dateEpoch, opts)
 * - Materializes a weekly calendar document for the week containing dateEpoch.
 * - If a persisted calendar already exists for that week it is returned.
 * - If created and there are no persisted offLimitsSlots, this method will attempt to copy-forward
 *   the latest persisted offLimitsSlots for the same serviceId (fallback to user-level) and persist them.
 *
 * opts: { capacity, timezone }
 */
CalendarSchema.statics.findOrCreateWeeklyCalendar = async function (ownerId, serviceId = null, dateEpoch = Date.now(), opts = {}) {
  const Calendar = this;
  const monday = mondayStartEpoch(dateEpoch);
  const end = sundayEndEpoch(monday);

  const query = { ownerId, 'datesBracket.startEpoch': monday };
  if (serviceId) query.serviceId = serviceId;
  else query.serviceId = { $in: [null, undefined] };

  // Try to find existing
  let doc = await Calendar.findOne(query).exec();
  if (doc) return doc;

  // Not found -> create new doc with provided opts
  const createPayload = {
    ownerId,
    serviceId: serviceId || undefined,
    timezone: opts.timezone || 'UTC',
    capacity: opts.capacity || 1,
    datesBracket: { startEpoch: monday, endEpoch: end },
    offLimitsSlots: [], // will attempt copy-forward below
    bookingsSlots: [],
    createdAtEpoch: Date.now(),
    updatedAtEpoch: Date.now()
  };

  try {
    doc = await Calendar.create(createPayload);
  } catch (err) {
    // possible race: another process created it; fetch and return
    if (err && err.code === 11000) {
      doc = await Calendar.findOne(query).exec();
      if (doc) return doc;
    }
    throw err;
  }

  // If no persisted offLimitsSlots, attempt to copy-forward from latest persisted calendar
  if ((!doc.offLimitsSlots || doc.offLimitsSlots.length === 0)) {
    const copied = await Calendar.copyForwardOffLimits(ownerId, serviceId);
    if (copied && copied.length > 0) {
      doc.offLimitsSlots = copied;
      doc.updatedAtEpoch = Date.now();
      await doc.save();
    }
  }

  return doc;
};

/**
 * getLatestByService(serviceId)
 * - returns the latest calendar document for the service (by datesBracket.startEpoch desc)
 * - if none found, returns null
 */
CalendarSchema.statics.getLatestByService = async function (serviceId) {
  if (!serviceId) return null;
  return this.findOne({ serviceId }).sort({ 'datesBracket.startEpoch': -1 }).lean();
};

/**
 * getLatestByUser(ownerId)
 * - returns the latest calendar for the user that has NO serviceId (user-level calendar)
 * - if none found, returns null
 */
CalendarSchema.statics.getLatestByUser = async function (ownerId) {
  if (!ownerId) return null;
  return this.findOne({ ownerId, serviceId: { $in: [null, undefined] } }).sort({ 'datesBracket.startEpoch': -1 }).lean();
};

/**
 * copyForwardOffLimits(ownerId, serviceId)
 * - Finds the most recent persisted calendar for the same serviceId; if none, falls back to the most recent user-level calendar.
 * - Returns the offLimitsSlots array (cloned) or [] if none found.
 * - This helper is used when materializing a new week so that owner/service settings carry forward.
 */
CalendarSchema.statics.copyForwardOffLimits = async function (ownerId, serviceId = null) {
  const Calendar = this;

  // 1) try latest for serviceId
  if (serviceId) {
    const svc = await Calendar.findOne({ ownerId, serviceId }).sort({ 'datesBracket.startEpoch': -1 }).lean();
    if (svc && Array.isArray(svc.offLimitsSlots) && svc.offLimitsSlots.length > 0) {
      // return deep clone to avoid accidental mutation
      return svc.offLimitsSlots.map(s => ({ weekday: s.weekday, fromEpoch: s.fromEpoch, toEpoch: s.toEpoch, reason: s.reason || '' }));
    }
  }

  // 2) fallback to latest user-level calendar (no serviceId)
  const userCal = await Calendar.findOne({ ownerId, serviceId: { $in: [null, undefined] } }).sort({ 'datesBracket.startEpoch': -1 }).lean();
  if (userCal && Array.isArray(userCal.offLimitsSlots) && userCal.offLimitsSlots.length > 0) {
    return userCal.offLimitsSlots.map(s => ({ weekday: s.weekday, fromEpoch: s.fromEpoch, toEpoch: s.toEpoch, reason: s.reason || '' }));
  }

  // none found
  return [];
};

/**
 * isSlotAvailable (cross-calendar helper)
 * - Attempts to determine availability for owner/service for a requested UTC epoch range.
 * - If no materialized calendar exists for the week containing fromEpoch, returns { ok:false, code:'NO_CALENDAR' }.
 *   The service layer will treat that as "use default" or materialize the week.
 */
CalendarSchema.statics.isSlotAvailable = async function ({ ownerId, serviceId = null, fromEpoch, toEpoch, capacityNeeded = 1 }) {
  if (!ownerId || typeof fromEpoch !== 'number' || typeof toEpoch !== 'number') {
    throw new Error('ownerId and fromEpoch/toEpoch required');
  }
  const monday = mondayStartEpoch(fromEpoch);
  const query = { ownerId, 'datesBracket.startEpoch': monday };
  if (serviceId) query.serviceId = serviceId;
  else query.serviceId = { $in: [null, undefined] };

  const cal = await this.findOne(query);
  if (!cal) {
    return { ok: false, code: 'NO_CALENDAR', message: 'no materialized calendar for week; treat as default or materialize' };
  }

  return cal.isSlotAvailableLocal(fromEpoch, toEpoch, capacityNeeded);
};

/**
 * acquireCalendarLock / releaseCalendarLock
 * - short-lived optimistic lock helpers for owner/admin updates
 */
CalendarSchema.statics.acquireCalendarLock = async function (ownerId, startEpoch, lockEpoch = Date.now(), lockTimeoutMs = 30 * 1000) {
  const Calendar = this;
  const cutoff = Date.now() - lockTimeoutMs;
  const query = { ownerId, 'datesBracket.startEpoch': startEpoch, $or: [{ updateLockEpoch: null }, { updateLockEpoch: { $lt: cutoff } }] };
  const update = { $set: { updateLockEpoch: lockEpoch } };
  const res = await Calendar.findOneAndUpdate(query, update, { new: true });
  return !!res;
};

CalendarSchema.statics.releaseCalendarLock = async function (ownerId, startEpoch, lockEpoch) {
  const Calendar = this;
  const query = { ownerId, 'datesBracket.startEpoch': startEpoch, updateLockEpoch: lockEpoch };
  const update = { $set: { updateLockEpoch: null } };
  const res = await Calendar.findOneAndUpdate(query, update, { new: true });
  return !!res;
};

/* -------------------------
 * Cleanup
 * ------------------------- */

/**
 * cleanupBlankCalendars(cutoffWeekStartEpoch)
 * - Delete persisted weekly calendars that:
 *    * datesBracket.startEpoch <= cutoffWeekStartEpoch
 *    * have NO bookingsSlots (empty array)
 *    * have NO offLimitsSlots (missing or empty array)
 *
 * This preserves persisted weeks that either contain bookings or have any offLimitsSlots (including defaults if explicitly persisted).
 */
CalendarSchema.statics.cleanupBlankCalendars = async function (cutoffWeekStartEpoch) {
  const Calendar = this;
  const query = {
    'datesBracket.startEpoch': { $lte: cutoffWeekStartEpoch },
    bookingsSlots: { $size: 0 },
    $or: [{ offLimitsSlots: { $exists: false } }, { offLimitsSlots: { $size: 0 } }]
  };
  const res = await Calendar.deleteMany(query);
  return { deletedCount: res.deletedCount || 0, raw: res };
};

/* -------------------------
 * Export
 * ------------------------- */

const Calendar = mongoose.model('Calendar', CalendarSchema);

module.exports = {
  Calendar,
  mondayStartEpoch,
  sundayEndEpoch
};
