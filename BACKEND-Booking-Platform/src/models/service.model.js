// src/models/service.model.js
//
// Mongoose model for Service entities (business/service listings).
// - Purpose: represent a provider's service offering, contact points, locations, capacity and metadata.
// - Design goals: clear schema, defensive defaults, useful indexes for uniqueness and simple text search,
//   epoch-ms timestamps for consistency with other models, and safe export for reuse.
//
// Notes:
// - `serviceId` is an application-level identifier (string) and is indexed/unique.
// - `providerId` links to the owning user (string). Use application-level checks to enforce ownership.
// - Text index on `name` and `categories` supports simple search; consider a dedicated search service for advanced queries.

const mongoose = require('mongoose');
const { Schema } = mongoose;

/* -------------------------
 * Sub-schemas
 * ------------------------- */

/**
 * ContactSchema
 * - use: semantic purpose of the contact (office, billing, support, other)
 * - value: contact string (email, phone, url, etc.)
 */
const ContactSchema = new Schema({
  use: { type: String, enum: ['office', 'billing', 'support', 'other'], default: 'office' },
  value: { type: String, required: true, trim: true }
}, { _id: false });

/**
 * AddressSchema
 * - Flexible postal address structure; no strict validation here to keep it adaptable.
 */
const AddressSchema = new Schema({
  label: { type: String, trim: true, default: null },
  line1: { type: String, trim: true, default: null },
  line2: { type: String, trim: true, default: null },
  city: { type: String, trim: true, default: null },
  province: { type: String, trim: true, default: null },
  postalCode: { type: String, trim: true, default: null },
  country: { type: String, trim: true, default: null }
}, { _id: false });

/**
 * DescriptionCardSchema
 * - Reusable card for rich descriptions, images and multi-line text.
 */
const DescriptionCardSchema = new Schema({
  cardId: { type: String, trim: true, default: null },
  cardName: { type: String, trim: true, default: null },
  title: { type: String, trim: true, default: null },
  images: { type: [String], default: [] },
  descriptions: { type: [String], default: [] }
}, { _id: false });

/* -------------------------
 * Service schema
 * ------------------------- */

const ServiceSchema = new Schema({
  // Application-level identifier (not Mongo _id)
  serviceId: { type: String, unique: true, required: true, index: true },

  // Human-friendly name
  name: { type: String, required: true, trim: true },

  // Owner/provider reference (application-level id)
  providerId: { type: String, required: true, index: true },

  // Locations and contact points
  addresses: { type: [AddressSchema], default: [] },
  locations: { type: [String], default: [] }, // e.g., city names, region codes
  contacts: { type: [ContactSchema], default: [] },
  emails: { type: [String], default: [] },
  phones: { type: [String], default: [] },

  // Categorization and payment
  categories: { type: [String], default: [] },
  paymentMethods: { type: [Schema.Types.Mixed], default: [] },

  // Operational capacity and calendar
  capacity: { type: Number, default: 1, min: 1 },
  calendarId: { type: String, default: null },

  // Rich description cards and reviews
  descriptionCards: { type: [DescriptionCardSchema], default: [] },
  reviews: [{ type: Schema.Types.ObjectId, ref: 'Review' }],

  // Lifecycle status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'available', 'unavailable', 'out_of_service'],
    default: 'active',
    index: true
  },

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Auditing timestamps (epoch ms)
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() }
}, {
  collection: 'services',
  versionKey: false
});

/* -------------------------
 * Indexes
 * ------------------------- */

// Unique service name per provider to avoid duplicate listings
ServiceSchema.index({ providerId: 1, name: 1 }, { unique: true, sparse: true });

// Simple text index for name and categories to support basic search queries
ServiceSchema.index({ name: 'text', categories: 'text' });

/* -------------------------
 * Hooks
 * ------------------------- */

/**
 * pre-save hook
 * - Maintain updatedAt and createdAt timestamps in epoch milliseconds.
 */
ServiceSchema.pre('save', function (next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  next();
});

/* -------------------------
 * Instance helpers / virtuals (optional)
 * ------------------------- */

/**
 * toPublicJSON
 * - Safe projection for returning service data to clients.
 * - Excludes internal fields if needed; here we return the document as-is but you can customize.
 */
ServiceSchema.methods.toPublicJSON = function () {
  return {
    serviceId: this.serviceId,
    name: this.name,
    providerId: this.providerId,
    addresses: this.addresses,
    locations: this.locations,
    contacts: this.contacts,
    emails: this.emails,
    phones: this.phones,
    categories: this.categories,
    paymentMethods: this.paymentMethods,
    capacity: this.capacity,
    descriptionCards: this.descriptionCards,
    calendarId: this.calendarId,
    status: this.status,
    reviews: this.reviews,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

/* -------------------------
 * Export model
 * ------------------------- */

module.exports = mongoose.models.Service || mongoose.model('Service', ServiceSchema);
