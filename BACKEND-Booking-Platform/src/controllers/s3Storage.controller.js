// src/controllers/s3Storage.controller.js
//
// HTTP controllers for storage flows (request-upload, confirm-upload, presign-download, replace, delete).
// - Thin layer: validate inputs, enforce RBAC via actor (req.user), delegate to s3Storage.service.
// - Uses auditService for important events and returns consistent JSON shape: { ok, data?, error?, action?, presign? }.
// - Validation middleware is applied on each route and controller will fail fast if validated payload is missing.

const express = require('express');
const router = express.Router();

const service = require('../services/s3Storage.service');
const auditService = require('../services/audit.service');
const { requireAuth } = require('../middleware/auth.middleware');

// Validators: Joi schemas + middleware factory
const { schemas, validate } = require('../validators/s3Storage.validators');
const { requestUpload, confirmUpload, presignDownload, replaceFile, deleteFile } = schemas;

/* Helpers */

function jsonError(res, status = 400, code = 'INVALID', message = 'invalid request') {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function validatedBodyOrFail(req) {
  if (req.validated && req.validated.body) return req.validated.body;
  // Fail fast: validators are expected to run on routes. If missing, treat as server misconfiguration.
  const err = new Error('Request validation middleware not applied');
  err.status = 500;
  throw err;
}

function validatedQueryOrFail(req) {
  if (req.validated && req.validated.query) return req.validated.query;
  // If no validator ran, fall back to raw query (less desirable) but log via thrown error to surface misconfig.
  const err = new Error('Request validation middleware not applied');
  err.status = 500;
  throw err;
}

function loggerFor(reqOrActor) {
  if (!reqOrActor) return console;
  const app = (reqOrActor.app) || (reqOrActor.req && reqOrActor.req.app) || null;
  return (app && app.get && app.get('logger')) || console;
}

/**
 * auditLog
 * - actorOrReq: either req (preferred) or actor object
 * - eventType: string
 * - outcome: 'success'|'failure'|'info'
 * - severity: 'info'|'warning'|'error'
 * - details: object
 */
async function auditLog(actorOrReq, eventType, outcome, severity = 'info', details = {}) {
  try {
    const actor = actorOrReq && actorOrReq.user ? actorOrReq.user : actorOrReq;
    const correlationId = (actorOrReq && actorOrReq.correlationId) || (actor && actor.correlationId) || null;
    await auditService.logEvent({
      eventType,
      actor: { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null },
      target: details.target || null,
      outcome,
      severity,
      correlationId,
      details
    });
  } catch (e) {
    const log = loggerFor(actorOrReq);
    log.error && log.error({ event: 'audit.error', error: e && e.message ? e.message : String(e), originalEvent: eventType });
  }
}

/* Routes */

/**
 * POST /storage/request-upload
 * Body: { filename, contentType, size, purpose, ownerId? }
 * Auth required.
 */
router.post(
  '/request-upload',
  requireAuth,
  validate(requestUpload, 'body'),
  async (req, res) => {
    const log = loggerFor(req);
    const correlationId = req.correlationId || null;
    const actor = req.user || null;

    try {
      const body = validatedBodyOrFail(req);
      const result = await service.requestUpload(actor, body, { logger: log, correlationId });

      await auditLog(req, 'storage.request_upload', 'success', 'info', {
        target: { type: 'File', id: result.file && result.file._id ? String(result.file._id) : null },
        correlationId,
        key: result.presign && result.presign.key ? result.presign.key : null
      });

      return res.status(201).json({ ok: true, data: result.file, presign: result.presign });
    } catch (err) {
      log.error && log.error({ event: 'storage.request_upload.error', error: err && err.message ? err.message : String(err), correlationId });
      const status = err.status || 400;
      await auditLog(req, 'storage.request_upload.failed', 'failure', err.status && err.status >= 500 ? 'error' : 'warning', { correlationId, error: err.message });
      return jsonError(res, status, err.code || 'ERROR', err.message || 'request upload failed');
    }
  }
);

/**
 * POST /storage/confirm
 * Body: { fileId, key, expectedSize?, expectedContentType? }
 * Auth required.
 */
router.post(
  '/confirm',
  requireAuth,
  validate(confirmUpload, 'body'),
  async (req, res) => {
    const log = loggerFor(req);
    const correlationId = req.correlationId || null;
    const actor = req.user || null;

    try {
      const body = validatedBodyOrFail(req);
      const result = await service.confirmUpload(actor, body, { logger: log, correlationId });

      await auditLog(req, 'storage.confirm_upload', 'success', 'info', {
        target: { type: 'File', id: result.file && result.file._id ? String(result.file._id) : null },
        correlationId,
        key: result.key
      });

      return res.json({ ok: true, data: result.file, key: result.key, action: 'available' });
    } catch (err) {
      log.error && log.error({ event: 'storage.confirm_upload.error', error: err && err.message ? err.message : String(err), correlationId });
      const status = err.status || 400;
      await auditLog(req, 'storage.confirm_upload.failed', 'failure', err.status && err.status >= 500 ? 'error' : 'warning', { correlationId, error: err.message });
      return jsonError(res, status, err.code || 'ERROR', err.message || 'confirm upload failed');
    }
  }
);

/**
 * GET /storage/presign-download
 * Query: ?key=... or ?fileId=...&expiresIn=...
 * Auth required.
 */
router.get(
  '/presign-download',
  requireAuth,
  validate(presignDownload, 'query'),
  async (req, res) => {
    const log = loggerFor(req);
    const correlationId = req.correlationId || null;
    const actor = req.user || null;

    try {
      const q = validatedQueryOrFail(req);
      const params = { key: q.key, fileId: q.fileId, expiresIn: q.expiresIn ? Number(q.expiresIn) : undefined };
      const result = await service.presignDownload(actor, params, { logger: log, correlationId });

      await auditLog(req, 'storage.presign_download', 'success', 'info', {
        target: { type: 'File', id: q.fileId || null },
        correlationId,
        key: result.key
      });

      return res.json({ ok: true, presign: { url: result.url, key: result.key, bucket: result.bucket, expiresIn: result.expiresIn } });
    } catch (err) {
      log.error && log.error({ event: 'storage.presign_download.error', error: err && err.message ? err.message : String(err), correlationId });
      const status = err.status || 400;
      await auditLog(req, 'storage.presign_download.failed', 'failure', err.status && err.status >= 500 ? 'error' : 'warning', { correlationId, error: err.message });
      return jsonError(res, status, err.code || 'ERROR', err.message || 'presign download failed');
    }
  }
);

/**
 * POST /storage/replace
 * Body: { fileId, newFilename, purpose? }
 * Auth required.
 * Returns new pending file record and presign for replacement upload.
 */
router.post(
  '/replace',
  requireAuth,
  validate(replaceFile, 'body'),
  async (req, res) => {
    const log = loggerFor(req);
    const correlationId = req.correlationId || null;
    const actor = req.user || null;

    try {
      const body = validatedBodyOrFail(req);
      const result = await service.replaceFile(actor, body, { logger: log, correlationId });

      await auditLog(req, 'storage.replace_initiated', 'success', 'info', {
        target: { type: 'File', id: result.newFile && result.newFile._id ? String(result.newFile._id) : null },
        correlationId,
        key: result.presign && result.presign.key ? result.presign.key : null
      });

      return res.status(201).json({ ok: true, data: result.newFile, presign: result.presign, action: 'replace_pending' });
    } catch (err) {
      log.error && log.error({ event: 'storage.replace.error', error: err && err.message ? err.message : String(err), correlationId });
      const status = err.status || 400;
      await auditLog(req, 'storage.replace.failed', 'failure', err.status && err.status >= 500 ? 'error' : 'warning', { correlationId, error: err.message });
      return jsonError(res, status, err.code || 'ERROR', err.message || 'replace failed');
    }
  }
);

/**
 * DELETE /storage/:id
 * Soft-delete by fileId or by key via query param ?key=...
 * Auth required.
 */
router.delete(
  '/:id',
  requireAuth,
  validate(deleteFile, 'query'),
  async (req, res) => {
    const log = loggerFor(req);
    const correlationId = req.correlationId || null;
    const actor = req.user || null;

    try {
      const { id } = req.params;
      // validated query is required by middleware; if missing, validatedQueryOrFail will throw
      const q = req.validated && req.validated.query ? req.validated.query : {};
      const params = { fileId: id || null, key: q.key || null };
      const result = await service.deleteFile(actor, params, { logger: log, correlationId });

      await auditLog(req, 'storage.delete', 'success', 'info', { target: { type: 'File', id }, correlationId, key: params.key });
      return res.json({ ok: true, data: result.file, action: 'deleted' });
    } catch (err) {
      log.error && log.error({ event: 'storage.delete.error', error: err && err.message ? err.message : String(err), correlationId });
      const status = err.status || 400;
      await auditLog(req, 'storage.delete.failed', 'failure', err.status && err.status >= 500 ? 'error' : 'warning', { correlationId, error: err.message });
      return jsonError(res, status, err.code || 'ERROR', err.message || 'delete failed');
    }
  }
);

module.exports = router;
