// src/models/Booking.model.js
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  guest: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  start: Date,
  end: Date,
  totalPrice: Number,
  status: { type: String, enum: ['pending','confirmed','cancelled'], default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('Booking', schema);
