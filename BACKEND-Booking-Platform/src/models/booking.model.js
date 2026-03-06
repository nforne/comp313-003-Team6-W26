/**
 * src/models/booking.model.js
 *
 * Minimal Booking schema used by accept->booking flow.
 * createdAt / updatedAt stored as epoch milliseconds (Number).
 */

const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  request_id: { type: String, required: true, index: true },
  seeker_id: { type: String, required: true, index: true },
  provider_id: { type: String, required: true, index: true },
  quote_amount: { type: Number, required: true },
  currency: { type: String, required: true, length: 3 },
  what: { type: String, default: '' },
  where: { type: String, default: '' },
  slots: { type: [{ from: Number, to: Number }], default: [] },
  services: { type: [String], default: [] },
  bids: { type: [String], default: [] },
  description: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'honored', 'seeker_cancelled', 'provider_cancelled', 'suspended'],
    default: 'active',
    index: true
  },
  createdAt: { type: Number, default: () => Date.now(), index: true },
  updatedAt: { type: Number, default: () => Date.now() }
}, {
  timestamps: false,
  versionKey: false
});

BookingSchema.pre('save', function (next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

module.exports = mongoose.model('Booking', BookingSchema);
