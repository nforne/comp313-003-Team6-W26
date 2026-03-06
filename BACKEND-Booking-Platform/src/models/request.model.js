// src/models/request.model.js
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
  status: { type: String, enum: ['active','expired','booked','suspended','cancelled'], default: 'active' },
  createdAt: { type: Number },
  updatedAt: { type: Number }
}, { collection: 'requests' });

// helpful indexes
RequestSchema.index({ createdBy: 1, status: 1 });
RequestSchema.index({ categories: 1 });
RequestSchema.index({ 'geo': '2dsphere' });

RequestSchema.pre('save', function(next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

module.exports = mongoose.model('Request', RequestSchema);
