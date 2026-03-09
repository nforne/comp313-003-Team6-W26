// src/services/s3Storage.service.js
//
// Business logic for storage upload lifecycle.
// - Request upload: validate, create DB placeholder, generate presigned PUT URL and return key/fileId.
// - Confirm upload: verify S3 object (HEAD), validate size/type, mark DB record available, enqueue background processing.
// - Presign download: RBAC check, return short-lived GET presign.
// - Replace file: create new object key, swap DB reference atomically, schedule old object deletion.
// - Delete file: RBAC check, mark DB record deleted and schedule S3 deletion.
//
// Dependencies (assumed present):
// - src/repositories/s3Storage.repo.js  (generatePresignedPutUrl, generatePresignedGetUrl, headObjectMeta, deleteObjectByKey, copyObjectWithinBucket)
// - src/repos/file.repo.js              (createFileRecord, getFileById, updateFile, findByKey, markDeleted)
// - src/utils/storage.keys.js           (makeObjectKey(ownerId, filename, opts))
// - src/jobs/s3Storage.jobs.js          (enqueue processing jobs) OR a generic jobQueue.enqueue
// - auditService (optional) for audit events
//
// The service functions accept an `actor` object (may be null for system) and `correlationId` for logging/audit.

const s3Repo = require('../repositories/s3Storage.repo');
const fileRepo = require('../repositories/s3storedfiles.repo');
const { makeObjectKey } = require('../utils/s3storage.keys');
const auditService = require('../services/audit.service'); // optional
const jobHandlers = require('../jobs/s3Storage.jobs'); // assumed to expose enqueue helpers or job names
const DEFAULT_PUT_EXPIRES = parseInt(process.env.PRESIGN_PUT_EXPIRES || '900', 10);
const DEFAULT_GET_EXPIRES = parseInt(process.env.PRESIGN_GET_EXPIRES || '300', 10);

function _makeError(message, code = 'ERROR', status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function _safeLogger(logger) {
  return logger || console;
}

/**
 * requestUpload
 * - Validates inputs, enforces RBAC (actor must exist for owner-scoped uploads),
 * - Generates canonical key and presigned PUT URL,
 * - Creates DB file record with status 'pending'.
 *
 * @param {Object} actor - { userId, role } or null
 * @param {Object} payload - { filename, contentType, size, purpose, ownerId? }
 * @param {Object} opts - { logger, correlationId, expiresIn }
 * @returns {Promise<{ ok:true, file: {...}, presign: { url, key, bucket, expiresIn } }>}
 */
async function requestUpload(actor, payload = {}, opts = {}) {
  const logger = _safeLogger(opts.logger);
  const correlationId = opts.correlationId || null;

  const filename = payload && payload.filename ? String(payload.filename) : null;
  const contentType = payload && payload.contentType ? String(payload.contentType) : null;
  const size = typeof payload.size === 'number' ? payload.size : (payload.size ? Number(payload.size) : null);
  const purpose = payload && payload.purpose ? String(payload.purpose) : null;
  const ownerId = payload && payload.ownerId ? String(payload.ownerId) : (actor && actor.userId ? actor.userId : null);

  if (!filename || !contentType || !ownerId) {
    throw _makeError('filename, contentType and ownerId are required', 'INVALID_INPUT', 400);
  }

  // RBAC: ensure actor is owner or admin
  if (!actor || (actor.userId !== ownerId && actor.role !== 'administrator')) {
    throw _makeError('unauthorized', 'FORBIDDEN', 403);
  }

  // Build canonical key
  const key = makeObjectKey(ownerId, filename, { purpose });

  // Create DB placeholder
  const now = Date.now();
  const fileRecord = {
    key,
    ownerId,
    filename,
    contentType,
    size: size || null,
    purpose: purpose || null,
    status: 'pending',
    createdAt: now,
    uploadedAt: null,
    processedAt: null
  };

  let created;
  try {
    created = await fileRepo.createFileRecord(fileRecord);
  } catch (err) {
    logger.error && logger.error({ event: 's3.service.requestUpload.create_failed', error: err && err.message ? err.message : String(err), correlationId });
    throw err;
  }

  // Generate presigned PUT URL
  const expiresIn = typeof opts.expiresIn === 'number' ? opts.expiresIn : DEFAULT_PUT_EXPIRES;
  const presign = await s3Repo.generatePresignedPutUrl(key, { contentType, expiresIn, logger });

  // Audit (best-effort)
  try {
    await auditService.logEvent({
      eventType: 'storage.request_upload',
      actor: actor ? { userId: actor.userId, role: actor.role } : null,
      target: { type: 'File', id: created._id ? String(created._id) : null },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { key, filename, purpose }
    });
  } catch (_) {}

  return { ok: true, file: created, presign: { url: presign.url, key: presign.key, bucket: presign.bucket, expiresIn } };
}

/**
 * confirmUpload
 * - Verifies S3 object exists and matches expected size/contentType (if provided),
 * - Updates DB record to 'available', sets uploadedAt, enqueues background processing jobs.
 *
 * @param {Object} actor - { userId, role } or null
 * @param {Object} params - { fileId, key, expectedSize?, expectedContentType? }
 * @param {Object} opts - { logger, correlationId }
 * @returns {Promise<{ ok:true, file: {...}, key }>}
 */
async function confirmUpload(actor, params = {}, opts = {}) {
  const logger = _safeLogger(opts.logger);
  const correlationId = opts.correlationId || null;

  const fileId = params && params.fileId ? String(params.fileId) : null;
  const key = params && params.key ? String(params.key) : null;
  const expectedSize = typeof params.expectedSize === 'number' ? params.expectedSize : (params.expectedSize ? Number(params.expectedSize) : null);
  const expectedContentType = params && params.expectedContentType ? String(params.expectedContentType) : null;

  if (!fileId || !key) throw _makeError('fileId and key required', 'INVALID_INPUT', 400);

  // Load DB record
  const file = await fileRepo.getFileById(fileId);
  if (!file) throw _makeError('file_not_found', 'NOT_FOUND', 404);

  // Ownership/RBAC: actor must be owner or admin
  if (!actor || (actor.userId !== file.ownerId && actor.role !== 'admin')) {
    throw _makeError('unauthorized', 'FORBIDDEN', 403);
  }

  // Ensure key matches DB record
  if (file.key !== key) {
    throw _makeError('key_mismatch', 'INVALID_INPUT', 400);
  }

  // HEAD S3 object to verify presence and metadata
  const head = await s3Repo.headObjectMeta(key, { logger });
  if (!head || head.notFound) {
    // mark file as failed
    await fileRepo.updateFile(fileId, { status: 'failed', uploadedAt: Date.now() });
    throw _makeError('object_not_found', 'NOT_FOUND', 404);
  }

  // Validate size/contentType if provided
  if (expectedSize && typeof head.contentLength === 'number' && head.contentLength !== expectedSize) {
    await fileRepo.updateFile(fileId, { status: 'failed', uploadedAt: Date.now() });
    throw _makeError('size_mismatch', 'INVALID_INPUT', 400);
  }
  if (expectedContentType && head.contentType && expectedContentType !== head.contentType) {
    await fileRepo.updateFile(fileId, { status: 'failed', uploadedAt: Date.now() });
    throw _makeError('content_type_mismatch', 'INVALID_INPUT', 400);
  }

  // Update DB record to available
  const now = Date.now();
  const patch = {
    status: 'available',
    uploadedAt: now,
    contentType: head.contentType || file.contentType || null,
    size: (typeof head.contentLength === 'number') ? head.contentLength : (file.size || null),
    metadata: Object.assign({}, file.metadata || {}, head.metadata || {})
  };

  const updated = await fileRepo.updateFile(fileId, patch);

  // Enqueue background processing (best-effort)
  try {
    // jobHandlers.processUploadedFile(fileId, { key, ownerId: file.ownerId, correlationId })
    if (jobHandlers && typeof jobHandlers.enqueueProcessUploadedFile === 'function') {
      await jobHandlers.enqueueProcessUploadedFile({ fileId: String(fileId), key, ownerId: file.ownerId, correlationId });
    } else if (jobHandlers && typeof jobHandlers.processUploadedFile === 'function') {
      // synchronous fallback (not recommended in production)
      jobHandlers.processUploadedFile({ fileId: String(fileId), key, ownerId: file.ownerId, correlationId }).catch(() => {});
    }
  } catch (e) {
    logger.warn && logger.warn({ event: 's3.service.confirmUpload.enqueue_failed', fileId, key, error: e && e.message ? e.message : String(e), correlationId });
  }

  // Audit
  try {
    await auditService.logEvent({
      eventType: 'storage.confirm_upload',
      actor: actor ? { userId: actor.userId, role: actor.role } : null,
      target: { type: 'File', id: String(fileId) },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { key }
    });
  } catch (_) {}

  return { ok: true, file: updated, key };
}

/**
 * presignDownload
 * - RBAC: actor must be owner or admin (or other policy as required),
 * - Returns short-lived GET presign for the canonical key.
 *
 * @param {Object} actor - { userId, role } or null
 * @param {Object} params - { key, fileId, expiresIn? }
 * @param {Object} opts - { logger, correlationId }
 * @returns {Promise<{ ok:true, url, key, bucket, expiresIn }>}
 */
async function presignDownload(actor, params = {}, opts = {}) {
  const logger = _safeLogger(opts.logger);
  const correlationId = opts.correlationId || null;
  const key = params && params.key ? String(params.key) : null;
  const fileId = params && params.fileId ? String(params.fileId) : null;

  if (!key && !fileId) throw _makeError('key or fileId required', 'INVALID_INPUT', 400);

  let file = null;
  if (fileId) {
    file = await fileRepo.getFileById(fileId);
    if (!file) throw _makeError('file_not_found', 'NOT_FOUND', 404);
    if (file.key !== key && key) throw _makeError('key_mismatch', 'INVALID_INPUT', 400);
  } else {
    file = await fileRepo.findByKey(key);
    if (!file) throw _makeError('file_not_found', 'NOT_FOUND', 404);
  }

  // RBAC: owner or admin
  if (!actor || (actor.userId !== file.ownerId && actor.role !== 'admin')) {
    throw _makeError('unauthorized', 'FORBIDDEN', 403);
  }

  if (file.status !== 'available') {
    throw _makeError('file_not_available', 'CONFLICT', 409);
  }

  const expiresIn = typeof params.expiresIn === 'number' ? params.expiresIn : DEFAULT_GET_EXPIRES;
  const presign = await s3Repo.generatePresignedGetUrl(file.key, { expiresIn, logger });

  // Audit
  try {
    await auditService.logEvent({
      eventType: 'storage.presign_download',
      actor: actor ? { userId: actor.userId, role: actor.role } : null,
      target: { type: 'File', id: String(file._id) },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { key: file.key, expiresIn }
    });
  } catch (_) {}

  return { ok: true, url: presign.url, key: presign.key, bucket: presign.bucket, expiresIn };
}

/**
 * replaceFile
 * - Create a new key (timestamped), expect new upload flow for replacement,
 * - Atomically swap DB reference to new file record, mark old record deleted and enqueue deletion.
 *
 * @param {Object} actor - { userId, role }
 * @param {Object} params - { fileId, newFilename, purpose }
 * @param {Object} opts - { logger, correlationId }
 * @returns {Promise<{ ok:true, newFile, oldFileId }>}
 */
async function replaceFile(actor, params = {}, opts = {}) {
  const logger = _safeLogger(opts.logger);
  const correlationId = opts.correlationId || null;

  const fileId = params && params.fileId ? String(params.fileId) : null;
  const newFilename = params && params.newFilename ? String(params.newFilename) : null;
  const purpose = params && params.purpose ? String(params.purpose) : null;

  if (!fileId || !newFilename) throw _makeError('fileId and newFilename required', 'INVALID_INPUT', 400);

  const oldFile = await fileRepo.getFileById(fileId);
  if (!oldFile) throw _makeError('file_not_found', 'NOT_FOUND', 404);

  // RBAC
  if (!actor || (actor.userId !== oldFile.ownerId && actor.role !== 'admin')) {
    throw _makeError('unauthorized', 'FORBIDDEN', 403);
  }

  // Create new key and DB record in pending state
  const newKey = makeObjectKey(oldFile.ownerId, newFilename, { purpose: purpose || oldFile.purpose });
  const now = Date.now();
  const newRecord = {
    key: newKey,
    ownerId: oldFile.ownerId,
    filename: newFilename,
    contentType: oldFile.contentType,
    size: null,
    purpose: purpose || oldFile.purpose,
    status: 'pending',
    createdAt: now
  };

  const created = await fileRepo.createFileRecord(newRecord);

  // Return presign for new upload so client can PUT; controller will call requestUpload flow or use repo directly
  const presign = await s3Repo.generatePresignedPutUrl(newKey, { contentType: created.contentType || 'application/octet-stream', logger });

  // Atomically swap references is left to controller/service caller after confirm; here we just return created record and presign
  return { ok: true, newFile: created, presign: { url: presign.url, key: presign.key, bucket: presign.bucket } };
}

/**
 * deleteFile
 * - RBAC: owner or admin
 * - Mark DB record deleted and enqueue S3 deletion (best-effort)
 *
 * @param {Object} actor - { userId, role }
 * @param {Object} params - { fileId, key }
 * @param {Object} opts - { logger, correlationId }
 * @returns {Promise<{ ok:true, file: {...} }>}
 */
async function deleteFile(actor, params = {}, opts = {}) {
  const logger = _safeLogger(opts.logger);
  const correlationId = opts.correlationId || null;

  const fileId = params && params.fileId ? String(params.fileId) : null;
  const key = params && params.key ? String(params.key) : null;

  if (!fileId && !key) throw _makeError('fileId or key required', 'INVALID_INPUT', 400);

  let file = null;
  if (fileId) {
    file = await fileRepo.getFileById(fileId);
    if (!file) throw _makeError('file_not_found', 'NOT_FOUND', 404);
  } else {
    file = await fileRepo.findByKey(key);
    if (!file) throw _makeError('file_not_found', 'NOT_FOUND', 404);
  }

  // RBAC
  if (!actor || (actor.userId !== file.ownerId && actor.role !== 'admin')) {
    throw _makeError('unauthorized', 'FORBIDDEN', 403);
  }

  // Mark DB record deleted (soft-delete)
  const updated = await fileRepo.markDeleted(String(file._id), { deletedAt: Date.now(), status: 'deleted' });

  // Enqueue S3 deletion (best-effort)
  try {
    if (jobHandlers && typeof jobHandlers.enqueueDeleteObject === 'function') {
      await jobHandlers.enqueueDeleteObject({ key: file.key, ownerId: file.ownerId, correlationId });
    } else {
      // best-effort immediate delete (not recommended for production)
      await s3Repo.deleteObjectByKey(file.key, { logger });
    }
  } catch (e) {
    logger.warn && logger.warn({ event: 's3.service.deleteFile.s3_delete_failed', key: file.key, error: e && e.message ? e.message : String(e), correlationId });
  }

  // Audit
  try {
    await auditService.logEvent({
      eventType: 'storage.delete',
      actor: actor ? { userId: actor.userId, role: actor.role } : null,
      target: { type: 'File', id: String(file._id) },
      outcome: 'success',
      severity: 'info',
      correlationId,
      details: { key: file.key }
    });
  } catch (_) {}

  return { ok: true, file: updated };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  requestUpload,
  confirmUpload,
  presignDownload,
  replaceFile,
  deleteFile
};
