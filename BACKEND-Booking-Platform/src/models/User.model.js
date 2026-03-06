// src/models/user.model.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const EmailSchema = new mongoose.Schema({
  value: { type: String, required: true, lowercase: true, trim: true },
  primary: { type: Boolean, default: false }
}, { _id: false });

const PhoneSchema = new mongoose.Schema({
  value: { type: String, required: true },
  type: { type: String, enum: ['mobile','home','work','other'], default: 'mobile' }
}, { _id: false });

const DescriptionCardSchema = new mongoose.Schema({
  cardId: String,
  cardName: String,
  title: String,
  images: [String],
  descriptions: [String]
}, { _id: false });

const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true, index: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true },
  avatarUrl: { type: String },
  emails: { type: [EmailSchema], required: true },
  phones: { type: [PhoneSchema], default: [] },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['service_seeker','service_provider','administrator'], default: 'service_seeker' },
  paymentMethods: { type: [Object], default: [] },
  selfIntro: { text: String, images: [String] },
  status: { type: String, enum: ['active','inactive','suspended','available','unavailable','out_of_service'], default: 'active' },
  descriptionCards: { type: [DescriptionCardSchema], default: [] },
  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
  refreshTokens: [{ tokenHash: String, createdAt: Number }],
  createdAt: { type: Number },
  updatedAt: { type: Number }
}, { collection: 'users' });

UserSchema.index({ 'emails.value': 1 }, { unique: true, sparse: true });

UserSchema.pre('save', async function(next) {
  const now = Date.now();
  this.updatedAt = now;
  if (!this.createdAt) this.createdAt = now;
  // If passwordHash field contains a plain password (on create/update), hash it.
  if (this.isModified('passwordHash')) {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, saltRounds);
  }
  next();
});

UserSchema.methods.comparePassword = function(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

UserSchema.methods.toPublicJSON = function() {
  return {
    userId: this.userId,
    firstName: this.firstName,
    lastName: this.lastName,
    avatarUrl: this.avatarUrl,
    emails: this.emails,
    phones: this.phones,
    role: this.role,
    status: this.status,
    selfIntro: this.selfIntro,
    descriptionCards: this.descriptionCards,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

module.exports = mongoose.model('User', UserSchema);
