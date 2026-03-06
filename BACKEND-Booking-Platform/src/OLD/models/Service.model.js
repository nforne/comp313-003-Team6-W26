// src/models/Service.model.js
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  description: String,
  price: Number,
  location: String,
  meta: Object
}, { timestamps: true });

module.exports = mongoose.model('Service', schema);
