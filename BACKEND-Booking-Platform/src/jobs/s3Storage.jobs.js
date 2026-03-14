// src/jobs/s3Storage.jobs.js
//
// Background job handlers for S3 storage processing.
// - Provides enqueue helpers and worker handlers for: processUploadedFile, deleteObject, cleanupOrphans.
// - Uses Redis-backed Bull queue when REDIS_URL is set and ioredis/bull are available; falls back to a lightweight in-memory queue for dev.
// - Jobs are idempotent and log/audit outcomes. Designed to be safe to call from multiple processes.
// - Exports: enqueueProcessUploadedFile, processUploadedFile (worker), enqueueDeleteObject, enqueueCleanupOrphans, registerWorkers

const os = require('os');
const path = require('path');

const s3Repo = require('../repositories/s3Storage.repo');
const fileRepo = require('../repositories/s3storedfiles.repo');
const auditService = require('../services/audit.service'); // optional
const logger = (global && global.logger) ? global.logger : console;

let Queue;
let Redis;
let useBull = false;
try {
  // optional dependencies
  Redis = require('ioredis');
  Queue = require('bull');
  useBull = !!process.env.REDIS_URL && !!Queue && !!Redis;
} catch (e) {
  useBull = false;
}

/* -------------------------
 * In-memory fallback queue (simple)
 * ------------------------- */
class InMemoryQueue {
  constructor() {
    this.tasks = [];
    this.processing = false;
  }

  async add(jobName, payload, opts = {}) {
    const job = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: jobName, data: payload, opts };
    this.tasks.push(job);
    // schedule async processing (best-effort)
    setImmediate(() => this._drain());
    return job;
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;
    while (this.tasks.length) {
      const job = this.tasks.shift();
      try {
        // route to handler if registered
        if (InMemoryQueue.handlers && typeof InMemoryQueue.handlers[job.name] === 'function') {
          await InMemoryQueue.handlers[job.name](job);
        } else {
          logger.warn && logger.warn({ event: 'jobs.inmemory.unhandled', job: job.name });
        }
      } catch (err) {
        logger.error && logger.error({ event: 'jobs.inmemory.error', job: job.name, error: err && err.message ? err.message : String(err) });
      }
    }
    this.processing = false;
  }

  // register handlers map { jobName: fn(job) }
  static registerHandlers(handlers) {
    InMemoryQueue.handlers = Object.assign({}, InMemoryQueue.handlers || {}, handlers);
  }
}

let queueClient = null;

/* -------------------------
 * Queue initialization
 * ------------------------- */
function _initQueue() {
  if (queueClient) return queueClient;

  if (useBull) {
    const redisOpts = { redis: process.env.REDIS_URL };
    queueClient = new Queue('s3-storage-jobs', process.env.REDIS_URL);
    // optional: configure event listeners
    queueClient.on('error', (err) => logger.error && logger.error({ event: 'jobs.queue.error', error: err && err.message ? err.message : String(err) }));
    return queueClient;
  }

  queueClient = new InMemoryQueue();
  return queueClient;
}

/* -------------------------
 * Job names
 * ------------------------- */
const JOBS = {
  PROCESS_UPLOADED_FILE: 'processUploadedFile',
  DELETE_OBJECT: 'deleteObject',
  CLEANUP_ORPHANS: 'cleanupOrphans'
};

/* -------------------------
 * Worker handlers (idempotent)
 * ------------------------- */

/**
 * processUploadedFile
 * - Job payload: { fileId, key, ownerId, correlationId }
 * - Responsibilities:
 *   - Verify file record exists and status is 'available' or 'pending' (idempotent)
 *   - Run processing steps: virus scan (placeholder), image resize/thumbnail (placeholder), metadata normalization
 *   - Update file.processedAt and status to 'available' (if not already)
 *   - Optionally move/copy object to final prefix or storage class
 */
async function processUploadedFile(job) {
  const payload = job && job.data ? job.data : job;
  const { fileId, key, ownerId, correlationId } = payload || {};
  const logCtx = { event: 'jobs.processUploadedFile', fileId, key, ownerId, correlationId };

  try {
    if (!fileId || !key) {
      logger.warn && logger.warn(Object.assign({}, logCtx, { message: 'missing fileId or key' }));
      return;
    }

    // Load file record
    const file = await fileRepo.getFileById(fileId);
    if (!file) {
      logger.warn && logger.warn(Object.assign({}, logCtx, { message: 'file record not found' }));
      return;
    }

    // If already processed recently, skip (idempotency)
    if (file.status === 'available' && file.processedAt) {
      logger.info && logger.info(Object.assign({}, logCtx, { message: 'already processed', processedAt: file.processedAt }));
      return;
    }

    // HEAD S3 object to ensure present
    const head = await s3Repo.headObjectMeta(key, { logger });
    if (!head || head.notFound) {
      // mark failed and exit
      await fileRepo.updateFile(fileId, { status: 'failed', processedAt: Date.now() });
      logger.warn && logger.warn(Object.assign({}, logCtx, { message: 's3 object missing, marked failed' }));
      return;
    }

    // Placeholder: virus scan (implement integration with scanner)
    // Example: await virusScanner.scan(key)
    logger.info && logger.info(Object.assign({}, logCtx, { message: 'running virus scan (placeholder)' }));

    // Placeholder: image processing (resize/thumbnail) if contentType indicates image
    if (head.contentType && head.contentType.startsWith('image/')) {
      logger.info && logger.info(Object.assign({}, logCtx, { message: 'image processing (placeholder)' }));
      // e.g., download, resize, upload thumbnails, update metadata
    }

    // Normalize metadata and update file record
    const patch = {
      status: 'available',
      processedAt: new Date(),
      contentType: head.contentType || file.contentType || null,
      size: (typeof head.contentLength === 'number') ? head.contentLength : file.size || null,
      metadata: Object.assign({}, file.metadata || {}, head.metadata || {})
    };
    const updated = await fileRepo.updateFile(fileId, patch);

    // Audit success
    try {
      await auditService.logEvent({
        eventType: 'storage.process_uploaded',
        actor: null,
        target: { type: 'File', id: String(fileId) },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: { key }
      });
    } catch (_) {}

    logger.info && logger.info(Object.assign({}, logCtx, { message: 'processing complete' }));
    return updated;
  } catch (err) {
    logger.error && logger.error(Object.assign({}, logCtx, { message: 'processing error', error: err && err.message ? err.message : String(err) }));
    // best-effort: mark file as failed
    try {
      if (fileId) await fileRepo.updateFile(fileId, { status: 'failed', processedAt: new Date() });
    } catch (_) {}
    throw err;
  }
}

/**
 * deleteObject
 * - Job payload: { key, ownerId, correlationId }
 * - Responsibilities:
 *   - Delete S3 object (idempotent)
 *   - Optionally remove DB record or mark archived (caller should handle DB)
 */
async function deleteObjectJob(job) {
  const payload = job && job.data ? job.data : job;
  const { key, ownerId, correlationId } = payload || {};
  const logCtx = { event: 'jobs.deleteObject', key, ownerId, correlationId };

  try {
    if (!key) {
      logger.warn && logger.warn(Object.assign({}, logCtx, { message: 'missing key' }));
      return;
    }

    // Attempt delete (s3Repo.deleteObjectByKey is idempotent)
    await s3Repo.deleteObjectByKey(key, { logger });
    logger.info && logger.info(Object.assign({}, logCtx, { message: 's3 delete success' }));

    // Audit
    try {
      await auditService.logEvent({
        eventType: 'storage.delete_object',
        actor: null,
        target: { type: 'S3Object', id: key },
        outcome: 'success',
        severity: 'info',
        correlationId,
        details: {}
      });
    } catch (_) {}

    return { ok: true };
  } catch (err) {
    logger.error && logger.error(Object.assign({}, logCtx, { message: 's3 delete error', error: err && err.message ? err.message : String(err) }));
    throw err;
  }
}

/**
 * cleanupOrphans
 * - Job payload: { olderThanMs, limit, correlationId }
 * - Responsibilities:
 *   - Find pending DB records older than threshold and delete orphan S3 objects
 *   - Delete S3 objects that have no DB record under a given prefix (optional)
 */
async function cleanupOrphansJob(job) {
  const payload = job && job.data ? job.data : job;
  const { olderThanMs = 24 * 60 * 60 * 1000, limit = 100, correlationId } = payload || {};
  const logCtx = { event: 'jobs.cleanupOrphans', olderThanMs, limit, correlationId };

  try {
    // Find pending DB records older than threshold
    const pending = await fileRepo.findPendingOlderThan(olderThanMs, limit);
    for (const f of pending) {
      try {
        // If object exists, delete it; otherwise just mark deleted
        const head = await s3Repo.headObjectMeta(f.key, { logger });
        if (head && !head.notFound) {
          await s3Repo.deleteObjectByKey(f.key, { logger });
          logger.info && logger.info(Object.assign({}, logCtx, { message: 'deleted orphan s3 object', key: f.key }));
        } else {
          logger.info && logger.info(Object.assign({}, logCtx, { message: 'orphan s3 object not found', key: f.key }));
        }
      } catch (e) {
        logger.warn && logger.warn(Object.assign({}, logCtx, { message: 'error deleting orphan', key: f.key, error: e && e.message ? e.message : String(e) }));
      } finally {
        // mark DB record deleted to avoid repeated attempts
        try {
          await fileRepo.markDeleted(f._id, { deletedAt: new Date(), status: 'deleted' });
        } catch (_) {}
      }
    }

    // Optionally: list S3 prefix and find objects without DB records (not implemented by default)
    logger.info && logger.info(Object.assign({}, logCtx, { message: 'cleanupOrphans complete', processed: pending.length }));
    return { ok: true, processed: pending.length };
  } catch (err) {
    logger.error && logger.error(Object.assign({}, logCtx, { message: 'cleanupOrphans error', error: err && err.message ? err.message : String(err) }));
    throw err;
  }
}

/* -------------------------
 * Enqueue helpers
 * ------------------------- */

async function enqueueProcessUploadedFile(payload = {}, opts = {}) {
  const q = _initQueue();
  const jobPayload = Object.assign({}, payload);
  if (useBull && q.add) {
    return q.add(JOBS.PROCESS_UPLOADED_FILE, jobPayload, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  }
  return q.add(JOBS.PROCESS_UPLOADED_FILE, jobPayload);
}

async function enqueueDeleteObject(payload = {}, opts = {}) {
  const q = _initQueue();
  const jobPayload = Object.assign({}, payload);
  if (useBull && q.add) {
    return q.add(JOBS.DELETE_OBJECT, jobPayload, { attempts: 2, backoff: { type: 'fixed', delay: 500 } });
  }
  return q.add(JOBS.DELETE_OBJECT, jobPayload);
}

async function enqueueCleanupOrphans(payload = {}, opts = {}) {
  const q = _initQueue();
  const jobPayload = Object.assign({}, payload);
  if (useBull && q.add) {
    return q.add(JOBS.CLEANUP_ORPHANS, jobPayload, { attempts: 1 });
  }
  return q.add(JOBS.CLEANUP_ORPHANS, jobPayload);
}

/* -------------------------
 * Worker registration
 * ------------------------- */

/**
 * registerWorkers(appOrOptions)
 * - If using Bull, registers processors on the queue.
 * - If using in-memory queue, registers handlers.
 * - Call this from your worker process bootstrap.
 */
function registerWorkers(opts = {}) {
  const q = _initQueue();

  if (useBull && q.process) {
    // register processors
    q.process(JOBS.PROCESS_UPLOADED_FILE, async (job) => {
      return processUploadedFile(job);
    });
    q.process(JOBS.DELETE_OBJECT, async (job) => {
      return deleteObjectJob(job);
    });
    q.process(JOBS.CLEANUP_ORPHANS, async (job) => {
      return cleanupOrphansJob(job);
    });

    q.on('completed', (job) => logger.info && logger.info({ event: 'jobs.bull.completed', jobId: job.id, name: job.name }));
    q.on('failed', (job, err) => logger.error && logger.error({ event: 'jobs.bull.failed', jobId: job.id, name: job.name, error: err && err.message ? err.message : String(err) }));
    logger.info && logger.info({ event: 'jobs.registered', backend: 'bull' });
    return q;
  }

  // In-memory: register handlers map
  InMemoryQueue.registerHandlers({
    [JOBS.PROCESS_UPLOADED_FILE]: async (job) => processUploadedFile(job),
    [JOBS.DELETE_OBJECT]: async (job) => deleteObjectJob(job),
    [JOBS.CLEANUP_ORPHANS]: async (job) => cleanupOrphansJob(job)
  });

  logger.info && logger.info({ event: 'jobs.registered', backend: 'inmemory' });
  return q;
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  enqueueProcessUploadedFile,
  enqueueDeleteObject,
  enqueueCleanupOrphans,
  processUploadedFile,      // exported for direct invocation/testing
  deleteObjectJob,          // exported for direct invocation/testing
  cleanupOrphansJob,        // exported for direct invocation/testing
  registerWorkers,
  JOBS
};
