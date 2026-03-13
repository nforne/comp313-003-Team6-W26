// src/models/message.model.js
//
// Polished Mongoose model for application messages.
// - Messages are created as "draft" and moved to "submitted" when sent.
// - Supports soft delete (visible=false + status='deleted') and hard delete (permanent removal).
// - Attachments are metadata only; files live in external storage referenced by storageRef.
// - Provides DTO helpers for normal and deleted responses.

const mongoose = require('mongoose');
const { Schema } = mongoose;

const AttachmentSchema = new Schema({
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true }, // bytes
  storageRef: { type: String, required: true } // e.g., s3 key or internal ref
}, { _id: false });

const MessageSchema = new Schema({
  // optional avatar URL or storage reference for sender/system
  avatar: { type: String, default: null },

  // message type
  type: {
    type: String,
    enum: ['issue_wall', 'email', 'notification', 'booking', 'review', 'bid', 'system', 'in_app'],
    required: true,
    index: true
  },

  // recipients: either broadcast (recipientsAll=true) or explicit short list
  recipientsAll: { type: Boolean, default: false, index: true },
  recipients: [{ type: Schema.Types.ObjectId, ref: 'User' }], // short list of recipients

  // author/sender (may be null for system messages)
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  // optional link to a service, booking, bid, review etc.
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service', default: null, index: true },

  subject: { type: String, default: '' },
  details: { type: String, default: '' },

  // attachments metadata only
  attachments: { type: [AttachmentSchema], default: [] },

  // threading
  replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null, index: true },

  // idempotency key to prevent duplicate sends (sparse so optional)
  idempotencyKey: { type: String, index: true, sparse: true },

  // message lifecycle status
  status: {
    type: String,
    enum: ['draft', 'submitted', 'deleted', 'read', 'unread', 'sent'],
    default: 'draft',
    index: true
  },

  // soft visibility flag (true => visible)
  visible: { type: Boolean, default: true, index: true },

  // extensible metadata (bookingId, reviewId, delivery status, etc.)
  metadata: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: true // createdAt, updatedAt
});

/* -------------------------
 * Indexes
 * ------------------------- */
MessageSchema.index({ type: 1, 'metadata.bookingId': 1 });
MessageSchema.index({ recipientsAll: 1, visible: 1 });
MessageSchema.index({ userId: 1, createdAt: -1 });
// Unique idempotency per sender when idempotencyKey provided
MessageSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

/* -------------------------
 * Virtuals: epoch timestamps for createdAt/updatedAt
 * ------------------------- */
MessageSchema.virtual('createdAtEpoch').get(function () {
  return this.createdAt ? this.createdAt.getTime() : null;
});
MessageSchema.virtual('updatedAtEpoch').get(function () {
  return this.updatedAt ? this.updatedAt.getTime() : null;
});

/* -------------------------
 * Instance helpers
 * ------------------------- */

/**
 * markSubmitted
 * - Transition a draft message to submitted and update metadata.
 * - Called by service when sending/submitting the message.
 */
MessageSchema.methods.markSubmitted = function (opts = {}) {
  this.status = 'submitted';
  this.visible = true;
  if (opts.sentAt) this.metadata.sentAt = opts.sentAt instanceof Date ? opts.sentAt : new Date();
  if (opts.deliveryInfo) this.metadata.deliveryInfo = opts.deliveryInfo;
  return this.save();
};

/**
 * markSoftDeleted
 * - Soft-delete the message (status + visible + metadata.deletedBy/At).
 * - Intended for use by author or admin.
 */
MessageSchema.methods.markSoftDeleted = function (byUserId = null) {
  this.status = 'deleted';
  this.visible = false;
  this.metadata.deletedBy = byUserId;
  this.metadata.deletedAt = new Date();
  return this.save();
};

/**
 * markRead / markUnread
 * - Update status to read/unread and optionally record per-user read metadata.
 * - Note: per-user read state is better stored in a separate MessageRead collection; this is a convenience.
 */
MessageSchema.methods.markRead = function (opts = {}) {
  this.status = 'read';
  if (opts.readBy) {
    this.metadata.lastReadBy = opts.readBy;
    this.metadata.lastReadAt = new Date();
  }
  return this.save();
};
MessageSchema.methods.markUnread = function () {
  this.status = 'unread';
  return this.save();
};

/* -------------------------
 * DTO helpers
 * ------------------------- */

/**
 * toDTO
 * - Safe public representation of a message for reads.
 * - opts: { includeDetails: boolean, redactRecipients: boolean }
 */
MessageSchema.methods.toDTO = function (opts = {}) {
  const base = {
    id: this._id.toString(),
    type: this.type,
    status: this.status,
    avatar: this.avatar,
    subject: this.subject,
    serviceId: this.serviceId ? this.serviceId.toString() : null,
    userId: this.userId ? this.userId.toString() : null,
    replyTo: this.replyTo ? this.replyTo.toString() : null,
    createdAt: this.createdAt ? this.createdAt.getTime() : null,
    updatedAt: this.updatedAt ? this.updatedAt.getTime() : null
  };

  if (opts.includeDetails) {
    base.details = this.details;
    base.attachments = this.attachments;
    base.metadata = this.metadata;
  }

  if (!opts.redactRecipients) {
    base.recipientsAll = !!this.recipientsAll;
    base.recipients = Array.isArray(this.recipients) ? this.recipients.map(r => r.toString()) : [];
  }

  Object.keys(base).forEach(k => base[k] === undefined && delete base[k]);
  return base;
};

/**
 * toDeletedDTO
 * - Minimal DTO returned for deleted messages per spec:
 *   { id, type, status, createdAt, updatedAt, reply_to }
 */
MessageSchema.methods.toDeletedDTO = function () {
  return {
    id: this._id.toString(),
    type: this.type,
    status: this.status,
    createdAt: this.createdAt ? this.createdAt.getTime() : null,
    updatedAt: this.updatedAt ? this.updatedAt.getTime() : null,
    reply_to: this.replyTo ? this.replyTo.toString() : null
  };
};

/* -------------------------
 * Static helpers
 * ------------------------- */

/**
 * buildDraft
 * - Create a draft message instance (not saved). Service should call repo.createMessage to persist.
 */
MessageSchema.statics.buildDraft = function (payload = {}) {
  const doc = {
    avatar: payload.avatar || null,
    type: payload.type,
    recipientsAll: !!payload.recipientsAll,
    recipients: Array.isArray(payload.recipients) ? payload.recipients : [],
    userId: payload.userId || null,
    serviceId: payload.serviceId || null,
    subject: payload.subject || '',
    details: payload.details || '',
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    replyTo: payload.replyTo || null,
    idempotencyKey: payload.idempotencyKey || null,
    status: 'draft',
    visible: true,
    metadata: payload.metadata || {}
  };
  return new this(doc);
};

/**
 * hardDeleteById
 * - Permanently remove a message document. Intended for admin-only operations.
 * - Caller must enforce admin authorization.
 */
MessageSchema.statics.hardDeleteById = function (id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return Promise.resolve(null);
  return this.findByIdAndDelete(id).exec();
};

module.exports = mongoose.model('Message', MessageSchema);
