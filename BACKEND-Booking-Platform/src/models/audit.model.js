// src/models/audit.model.js
const mongoose = require('mongoose');

const AuditSchema = new mongoose.Schema({
  eventType: { type: String, required: true }, // e.g., "request.create", "booking.confirm"
  actor: {
    userId: { type: String },
    role: { type: String }
  },
  target: {
    type: String, // resource type e.g., "Request", "Booking", "User"
    id: { type: String } // resource id (userId, serviceId, ObjectId string)
  },
  outcome: { type: String, enum: ['success','failure','partial'], default: 'success' },
  severity: { type: String, enum: ['info','warning','error','critical'], default: 'info' },
  correlationId: { type: String, index: true }, // request-level id for tracing
  details: { type: Object, default: {} }, // arbitrary JSON with context
  createdAt: { type: Number, required: true } // epoch ms
}, { collection: 'audits' });

AuditSchema.pre('save', function(next) {
  if (!this.createdAt) this.createdAt = Date.now();
  next();
});

module.exports = mongoose.model('Audit', AuditSchema);
