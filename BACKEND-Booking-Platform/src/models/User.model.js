// src/models/user.model.js
//
// Mongoose model for application users.
// - Purpose: represent authenticated users, contact channels, profile content and auth data.
// - Includes: schema definitions, indexes, pre-save hooks for hashing, instance helpers,
//   and a safe public projection method for returning user data to clients.
//
// Notes:
// - `passwordHash` is stored hashed and excluded from query results by default (`select: false`).
// - `userId` is an application-level identifier (string) and is indexed/unique.
// - Emails are indexed for quick lookup; sparse unique index prevents collisions only when email exists.
// - Timestamps are stored as epoch milliseconds for consistency with other services.

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const { Schema } = mongoose;

/* -------------------------
 * Sub-schemas
 * ------------------------- */

/**
 * EmailSchema
 * - value: normalized email address (lowercase, trimmed)
 * - primary: whether this is the user's primary contact email
 */
const EmailSchema = new Schema({
  value: { type: String, required: true, lowercase: true, trim: true },
  primary: { type: Boolean, default: false }
}, { _id: false });

/**
 * PhoneSchema
 * - value: phone number string (no formatting enforced here)
 * - type: semantic phone type
 */
const PhoneSchema = new Schema({
  value: { type: String, required: true },
  type: { type: String, enum: ['mobile', 'home', 'work', 'other'], default: 'mobile' }
}, { _id: false });

/**
 * DescriptionCardSchema
 * - Flexible card used for profile highlights, service descriptions, etc.
 */
const DescriptionCardSchema = new Schema({
  cardId: { type: String },
  cardName: { type: String },
  title: { type: String },
  images: { type: [String], default: [] },
  descriptions: { type: [String], default: [] }
}, { _id: false });

/* -------------------------
 * User schema
 * ------------------------- */

const UserSchema = new Schema({
  // Application-level identifier (not Mongo _id). Useful for public references.
  userId: { type: String, unique: true, required: true, index: true },

  // Basic profile
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true },
  avatarUrl: { type: String, default: null },

  // Contact channels
  emails: { type: [EmailSchema], required: true },
  phones: { type: [PhoneSchema], default: [] },

  // Authentication
  // - passwordHash stores the bcrypt hash of the user's password.
  // - select: false prevents accidental leakage in queries unless explicitly requested.
  passwordHash: { type: String, required: true, select: false },

  // Role and status
  role: { type: String, enum: ['service_seeker', 'service_provider', 'administrator'], default: 'service_seeker' },
  status: { type: String, enum: ['active', 'inactive', 'suspended', 'available', 'unavailable', 'out_of_service'], default: 'active' },

  // New: whether this provider's profile is eligible to appear in public search results
  // - Default false to avoid accidental exposure; only providers who opt-in should set true.
  IsPublicSearchable: { type: Boolean, default: false, index: true },

  // Payment and profile content
  paymentMethods: { type: [Schema.Types.Mixed], default: [] },
  selfIntro: { text: { type: String, default: '' }, images: { type: [String], default: [] } },
  descriptionCards: { type: [DescriptionCardSchema], default: [] },

  // Relations and tokens
  reviews: [{ type: Schema.Types.ObjectId, ref: 'Review' }],
  refreshTokens: [{ tokenHash: String, createdAt: Number }],

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Auditing timestamps (epoch ms)
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() }
}, {
  collection: 'users',
  versionKey: false
});

/* -------------------------
 * Indexes
 * ------------------------- */

// Index on nested email value for quick lookup by email address.
// Sparse unique ensures only documents with an email value are considered for uniqueness.
UserSchema.index({ 'emails.value': 1 }, { unique: true, sparse: true });

// Compound index to quickly find public providers
UserSchema.index({ role: 1, IsPublicSearchable: 1, status: 1 });

// Text index to support simple public search across common profile fields.
// Adjust fields included in text index as needed for search relevance.
UserSchema.index({
  firstName: 'text',
  lastName: 'text',
  'selfIntro.text': 'text',
  'descriptionCards.title': 'text',
  'descriptionCards.descriptions': 'text'
}, { name: 'UserPublicTextIndex', default_language: 'english' });

/* -------------------------
 * Hooks
 * ------------------------- */

/**
 * pre-save hook
 * - Updates timestamps.
 * - If `passwordHash` was modified and appears to be a plain password, hash it using bcrypt.
 * - Uses BCRYPT_SALT_ROUNDS env var (default 10).
 */
UserSchema.pre('save', async function (next) {
  try {
    const now = Date.now();
    this.updatedAt = now;
    if (!this.createdAt) this.createdAt = now;

    // If passwordHash field changed, ensure it's hashed.
    if (this.isModified('passwordHash')) {
      // Defensive: if passwordHash already looks like a bcrypt hash ($2b$ or $2a$), skip re-hashing.
      const maybeHash = String(this.passwordHash || '');
      if (!maybeHash.startsWith('$2a$') && !maybeHash.startsWith('$2b$') && !maybeHash.startsWith('$2y$')) {
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
        this.passwordHash = await bcrypt.hash(maybeHash, saltRounds);
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

/* -------------------------
 * Instance methods
 * ------------------------- */

/**
 * comparePassword
 * - Compare a plain-text password with the stored bcrypt hash.
 * - Returns a Promise<boolean>.
 *
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
UserSchema.methods.comparePassword = function (plainPassword) {
  // Note: passwordHash is not selected by default; ensure queries include it when calling this method.
  return bcrypt.compare(plainPassword, this.passwordHash);
};

/**
 * toPublicJSON
 * - Safe projection for returning user profile data to clients.
 * - Excludes sensitive fields such as passwordHash and refreshTokens.
 *
 * @returns {Object} public user representation
 */
UserSchema.methods.toPublicJSON = function () {
  // Include IsPublicSearchable so callers can know whether the provider opted in.
  // Consumers should only surface profiles when role === 'service_provider' && IsPublicSearchable === true.
  return {
    userId: this.userId,
    firstName: this.firstName,
    lastName: this.lastName,
    avatarUrl: this.avatarUrl,
    emails: this.emails,
    phones: this.phones,
    role: this.role,
    status: this.status,
    IsPublicSearchable: !!this.IsPublicSearchable,
    selfIntro: this.selfIntro,
    descriptionCards: this.descriptionCards,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

/* -------------------------
 * Statics / Helpers
 * ------------------------- */

/**
 * findByEmail
 * - Convenience static to find a user by email address (case-insensitive).
 *
 * @param {string} email
 * @returns {Promise<Document|null>}
 */
UserSchema.statics.findByEmail = function (email) {
  if (!email) return Promise.resolve(null);
  return this.findOne({ 'emails.value': String(email).toLowerCase().trim() });
};

/**
 * publicSearch
 * - Search public provider profiles for the public directory/search endpoint.
 * - Only returns users with role === 'service_provider', status === 'active', and IsPublicSearchable === true.
 * - Supports optional text query (uses text index) and simple filters/pagination.
 *
 * @param {string|null} q - free-text query (optional)
 * @param {Object} opts - { limit, skip, sort, filters }
 *   - filters: additional Mongo filters (e.g., { 'metadata.someKey': value })
 * @returns {Promise<{ total: number, results: Array<Document> }>}
 */
UserSchema.statics.publicSearch = async function (q = null, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const skip = Math.max(Number(opts.skip) || 0, 0);
  const sort = opts.sort || { score: { $meta: 'textScore' }, updatedAt: -1 };
  const filters = opts.filters && typeof opts.filters === 'object' ? opts.filters : {};

  // Base query: only active providers who opted in
  const baseQuery = Object.assign({}, filters, {
    role: 'service_provider',
    status: 'active',
    IsPublicSearchable: true
  });

  let query;
  if (q && String(q).trim().length > 0) {
    // Use text search when query provided
    query = Object.assign({}, baseQuery, { $text: { $search: String(q).trim() } });
  } else {
    query = baseQuery;
  }

  // Projection: use safe public fields only
  const projection = {
    passwordHash: 0,
    refreshTokens: 0,
    // keep other internal fields out by default; toPublicJSON will be used by callers
  };

  // Execute count and find in parallel
  const [total, docs] = await Promise.all([
    this.countDocuments(query).exec(),
    this.find(query, projection)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec()
  ]);

  return { total: Number(total || 0), results: docs || [] };
};

/* -------------------------
 * Export model
 * ------------------------- */

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
