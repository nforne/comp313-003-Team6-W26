// src/models/request.model.js
/**
 * Request model (polished, non-disruptive)
 *
 * - Preserves existing field names and semantics.
 * - Keeps TTL deletion code commented out (expiration handled by background worker).
 * - Adds lightweight validation and clearer pre-save sync for expiresAt/Date.
 * - Adds validation for WhenSchema.capacityNeeded (integer >= 1).
 */

const mongoose = require("mongoose");

const WhenSchema = new mongoose.Schema(
  {
    from: { type: Number, required: true }, // epoch ms UTC
    to: { type: Number, required: true }, // epoch ms UTC
    isBusinessHours: { type: Boolean, default: false }, // meaning all business hours between from and to
    capacityNeeded: { type: Number, required: true, default: 1 },
  },
  { _id: false },
);

WhenSchema.path("from").validate(function (v) {
  return typeof v === "number" && !Number.isNaN(v);
}, "when.from must be a valid epoch ms number");

WhenSchema.path("to").validate(function (v) {
  return typeof v === "number" && !Number.isNaN(v);
}, "when.to must be a valid epoch ms number");

WhenSchema.path("capacityNeeded").validate(function (v) {
  // must be an integer >= 1
  return Number.isInteger(v) && v >= 1;
}, "when.capacityNeeded must be an integer greater than or equal to 1");

WhenSchema.pre("validate", function () {
  try {
    if (
      typeof this.from === "number" &&
      typeof this.to === "number" &&
      this.from >= this.to
    ) {
      throw new Error("when.from must be less than when.to");
    }
    // ensure capacityNeeded is sane
    if (
      typeof this.capacityNeeded !== "number" ||
      !Number.isInteger(this.capacityNeeded) ||
      this.capacityNeeded < 1
    ) {
      throw new Error(
        "when.capacityNeeded must be an integer greater than or equal to 1",
      );
    }
  } catch (err) {
    // add context and rethrow so the save fails with a clear message
    throw new Error(
      `Request pre-save:  when validation failed: ${err.message}`,
    );
  }
});

const RequestSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    createdBy: { type: String, required: true, index: true }, // userId of creator
    services: { type: [String], default: [] }, // may contain serviceId (svc_...) or provider userId
    categories: { type: [String], default: [] },
    locations: { type: [String], default: [] },
    geo: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    when: { type: [WhenSchema], required: true, default: [] }, // collection of windows
    bids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Bid" }],
    isPrivate: { type: Boolean, default: false },
    // allowedProviders MUST contain provider userIds only (no serviceIds). Service-layer will populate from services when needed.
    allowedProviders: { type: [String], default: [], index: true },

    // explicit expiration time (epoch ms)
    expiresAt: { type: Number, default: null, index: true },

    // Date form of expiresAt (kept for scheduling/reporting).
    expiresAtDate: { type: Date, default: null },

    status: {
      type: String,
      enum: [
        "draft",
        "active",
        "expired",
        "booked",
        "suspended",
        "cancelled",
        "pending_action",
        "archived",
        "closed",
      ],
      default: "draft",
    },

    // extensible metadata (e.g., IsMultipleBusinessDays, other flags)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // epoch ms timestamps (kept for compatibility with existing code)
    createdAt: { type: Number },
    updatedAt: { type: Number },
  },
  {
    collection: "requests",
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true },
  },
);

/**
 * Indexes
 */
RequestSchema.index({ createdBy: 1, status: 1 });
RequestSchema.index({ categories: 1 });
RequestSchema.index({ geo: "2dsphere" });
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
RequestSchema.pre("save", function () {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  try {
    // Validate when array capacity and ordering at document level
    if (!Array.isArray(this.when) || this.when.length === 0) {
      throw new Error('Request must include at least one "when" slot');
    }

    for (let i = 0; i < this.when.length; i++) {
      const w = this.when[i];
      if (!w || typeof w.from !== "number" || typeof w.to !== "number") {
        throw new Error(`when[${i}] must include numeric from and to epoch ms`);
      }
      if (w.from >= w.to) {
        throw new Error(`when[${i}].from must be less than when[${i}].to`);
      }
      if (!Number.isInteger(w.capacityNeeded) || w.capacityNeeded < 1) {
        throw new Error(`when[${i}].capacityNeeded must be an integer >= 1`);
      }
    }

    // If expiresAt not provided, default to the latest when.to (end of requested window)
    if (
      (!this.expiresAt || this.expiresAt === null) &&
      Array.isArray(this.when) &&
      this.when.length > 0
    ) {
      // compute max 'to' across windows
      const toValues = this.when.map((w) =>
        w && typeof w.to === "number" ? Number(w.to) : 0,
      );
      const maxTo = Math.max(...toValues);
      if (maxTo > 0) this.expiresAt = Number(maxTo);
    }

    // Keep expiresAtDate in sync (null if no expiresAt)
    if (this.expiresAt && typeof this.expiresAt === "number") {
      this.expiresAtDate = new Date(Number(this.expiresAt));
    } else {
      this.expiresAtDate = null;
    }
  } catch (err) {
    // add context and rethrow so the save fails with a clear message
    throw new Error(
      `Request pre-save:  maintain epoch timestamps and sync expiresAt/Date failed: ${err.message}`,
    );
  }
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
RequestSchema.statics.findExpiredCandidates = function (
  nowEpochMs = Date.now(),
  limit = 100,
) {
  return this.find({
    status: "active",
    expiresAt: { $lte: Number(nowEpochMs) },
  })
    .limit(limit)
    .lean()
    .exec();
};

/**
 * Atomic helper: mark a single request expired if still active and past expiresAt.
 * Returns the updated document or null if no update occurred.
 */
RequestSchema.statics.markExpired = function (requestId) {
  return this.findOneAndUpdate(
    { _id: requestId, status: "active", expiresAt: { $lte: Date.now() } },
    { $set: { status: "expired", updatedAt: Date.now() } },
    { new: true },
  )
    .lean()
    .exec();
};

/**
 * Virtuals
 */
RequestSchema.virtual("createdAtDate").get(function () {
  return this.createdAt ? new Date(this.createdAt) : null;
});
RequestSchema.virtual("updatedAtDate").get(function () {
  return this.updatedAt ? new Date(this.updatedAt) : null;
});

module.exports = mongoose.model("Request", RequestSchema);
