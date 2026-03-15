// src/models/audit.model.js
const mongoose = require("mongoose");

const AuditSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true }, // e.g., "request.create", "booking.confirm"
    actor: {
      userId: { type: String },
      role: { type: String },
    },
    target: {
      type: String, // resource type e.g., "Request", "Booking", "User"
      id: { type: String }, // resource id (userId, serviceId, ObjectId string)
    },
    outcome: {
      type: String,
      enum: ["success", "failure", "partial"],
      default: "success",
    },
    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
    },
    correlationId: { type: String, index: true }, // request-level id for tracing
    details: { type: Object, default: {} }, // arbitrary JSON with context
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Number, required: true }, // epoch ms; set by pre-save hook
  },
  {
    collection: "audits",
    versionKey: false,
  },
);

// Synchronous pre-save hook ensures createdAt is populated before save.
// Keep this as a non-async function so Mongoose invokes it in callback mode and next() is valid.
AuditSchema.pre("save", function () {
  try {
    if (!this.createdAt) this.createdAt = Date.now();
  } catch (err) {
    throw new Error("Audit : pre-save failed!");
  }
});

module.exports = mongoose.models.Audit || mongoose.model("Audit", AuditSchema);
