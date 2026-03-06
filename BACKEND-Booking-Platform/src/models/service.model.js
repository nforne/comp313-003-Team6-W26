// src/models/service.model.js
const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  use: { type: String, enum: ['office','billing','support','other'], default: 'office' },
  value: { type: String, required: true }
}, { _id: false });

const AddressSchema = new mongoose.Schema({
  label: String,
  line1: String,
  line2: String,
  city: String,
  province: String,
  postalCode: String,
  country: String
}, { _id: false });

const DescriptionCardSchema = new mongoose.Schema({
  cardId: String,
  cardName: String,
  title: String,
  images: [String],
  descriptions: [String]
}, { _id: false });

const ServiceSchema = new mongoose.Schema({
  serviceId: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true, trim: true },
  providerId: { type: String, required: true, index: true },
  addresses: { type: [AddressSchema], default: [] },
  locations: { type: [String], default: [] },
  contacts: { type: [ContactSchema], default: [] },
  emails: { type: [String], default: [] },
  phones: { type: [String], default: [] },
  categories: { type: [String], default: [] },
  paymentMethods: { type: [Object], default: [] },
  capacity: { type: Number, default: 1, min: 1 },
  descriptionCards: { type: [DescriptionCardSchema], default: [] },
  calendarId: { type: String, default: null },
  status: { type: String, enum: ['active','inactive','suspended','available','unavailable','out_of_service'], default: 'active' },
  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
  createdAt: { type: Number },
  updatedAt: { type: Number }
}, { collection: 'services' });

// Unique service name per provider
ServiceSchema.index({ providerId: 1, name: 1 }, { unique: true });

// Text index for simple search
ServiceSchema.index({ name: 'text', categories: 'text' });

ServiceSchema.pre('save', function(next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

module.exports = mongoose.model('Service', ServiceSchema);
