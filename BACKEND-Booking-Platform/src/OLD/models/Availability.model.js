// src/models/Availability.model.js
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  start: Date,
  end: Date,
  slots: Number
}, { timestamps: true });

module.exports = mongoose.model('Availability', schema);
