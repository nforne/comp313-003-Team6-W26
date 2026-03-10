// src/repos/s3storedfiles.repo.js
//
// Persistence layer for S3-backed File records.
// - Mongoose-based repository with a clear API used by services.
// - Idempotent create, read, update, soft-delete, and useful queries for background jobs.
// - Schema: key is canonical identifier and indexed unique.
// - Returns plain JS objects (lean) and normalizes _id to string.

const mongoose = require('mongoose');
const { Schema } = mongoose;

/* -------------------------
 * Schema & Model
 * ------------------------- */

const FileSchema = new Schema({
  key: { type: String, required: true, index: true, unique: true },
  ownerId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  contentType: { type: String, default: null },
  size: { type: Number, default: null },
  purpose: { type: String, default: null },
  status: { type: String, enum: ['pending', 'available', 'failed', 'deleted'], default: 'pending', index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: () => new Date() },
  uploadedAt: { type: Date, default: null },
  processedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  idempotencyKey: { type: String, default: null, index: true, sparse: true }
}, { versionKey: false });

FileSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

const FileModel = mongoose.models.S3StoredFile || mongoose.model('S3StoredFile', FileSchema);

/* -------------------------
 * Helpers
 * ------------------------- */

function toPlain(doc) {
  if (!doc) return null;
  const obj = (typeof doc.toObject === 'function') ? doc.toObject() : doc;
  if (obj._id) obj._id = String(obj._id);
  return obj;
}

/* -------------------------
 * Repository API
 * ------------------------- */

async function createFileRecord(record) {
  if (!record || !record.key || !record.ownerId || !record.filename) {
    const e = new Error('key, ownerId and filename are required');
    e.code = 'INVALID_INPUT';
    e.status = 400;
    throw e;
  }
  try {
    const created = await FileModel.create(record);
    return toPlain(created);
  } catch (err) {
    if (err && err.code === 11000) {
      const e = new Error('duplicate');
      e.code = 'DUPLICATE';
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

async function getFileById(id) {
  if (!id) return null;
  const doc = await FileModel.findById(id).lean();
  return toPlain(doc);
}

async function findByKey(key) {
  if (!key) return null;
  const doc = await FileModel.findOne({ key }).lean();
  return toPlain(doc);
}

async function updateFile(id, patch = {}) {
  if (!id) {
    const e = new Error('id required');
    e.code = 'INVALID_INPUT';
    e.status = 400;
    throw e;
  }
  const updated = await FileModel.findByIdAndUpdate(id, { $set: patch }, { new: true, lean: true });
  return toPlain(updated);
}

async function markDeleted(id, extras = {}) {
  if (!id) {
    const e = new Error('id required');
    e.code = 'INVALID_INPUT';
    e.status = 400;
    throw e;
  }
  const patch = Object.assign({ status: 'deleted', deletedAt: new Date() }, extras);
  const updated = await FileModel.findByIdAndUpdate(id, { $set: patch }, { new: true, lean: true });
  return toPlain(updated);
}

async function findPendingOlderThan(ms, limit = 100) {
  const cutoff = new Date(Date.now() - Number(ms));
  const docs = await FileModel.find({ status: 'pending', createdAt: { $lt: cutoff } })
    .sort({ createdAt: 1 })
    .limit(Number(limit))
    .lean();
  return docs.map(toPlain);
}

async function listByOwner(ownerId, opts = {}) {
  if (!ownerId) {
    const e = new Error('ownerId required');
    e.code = 'INVALID_INPUT';
    e.status = 400;
    throw e;
  }
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 25));
  const skip = (page - 1) * limit;
  const q = { ownerId };
  if (opts.status) q.status = opts.status;
  const [results, total] = await Promise.all([
    FileModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    FileModel.countDocuments(q)
  ]);
  return { results: results.map(toPlain), page, limit, total };
}

async function findByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  const doc = await FileModel.findOne({ idempotencyKey }).lean();
  return toPlain(doc);
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createFileRecord,
  getFileById,
  findByKey,
  updateFile,
  markDeleted,
  findPendingOlderThan,
  listByOwner,
  findByIdempotencyKey,
  _model: FileModel
};
