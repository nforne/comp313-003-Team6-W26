// src/comms-js/templates/repository.js
//
// Template repository with versioning, validation, caching and basic CRUD.
// - Validates templates against schema.json using AJV.
// - Persists templates to a provided `db` collection (expects Mongo-like API).
// - Caches active templates in Redis when available; falls back to in-memory cache.
// - Update creates a new version (immutable history). Deleting is soft (status -> deprecated).
//
// Usage:
//   const repo = createTemplateRepo({ db: mongoDb, redisClient, logger });
//   await repo.createTemplate(templateObj, { actor: 'alice' });
//   const tpl = await repo.findActive('auth.signin_success', 'en-US');

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;

const SCHEMA_PATH = path.join(__dirname, 'schema.json');
const DEFAULT_CACHE_TTL = 60 * 60; // 1 hour

function _loadSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(raw);
}

function _nowIso() {
  return new Date().toISOString();
}

/**
 * createTemplateRepo
 * @param {Object} deps
 *  { db, redisClient, logger, cacheTtl = DEFAULT_CACHE_TTL }
 *
 * - db must expose a collection `templates` with insertOne, findOne, updateOne, find methods.
 * - redisClient is optional and should support get/setex/del (promisified).
 */
function createTemplateRepo(deps = {}) {
  const { db, redisClient = null, logger = console, cacheTtl = DEFAULT_CACHE_TTL } = deps;
  if (!db || !db.collection) {
    throw new Error('db.collection required');
  }

  const templatesColl = db.collection('templates');
  const schema = _loadSchema();
  const ajv = new Ajv({ allErrors: true, useDefaults: true, removeAdditional: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  // simple in-memory cache fallback
  const memoryCache = new Map();

  async function _cacheSet(key, value) {
    const str = JSON.stringify(value);
    if (redisClient && typeof redisClient.setex === 'function') {
      try {
        await redisClient.setex(key, cacheTtl, str);
        return;
      } catch (err) {
        logger && logger.warn && logger.warn({ event: 'templates.cache.redis_set_failed', key, error: err && err.message });
      }
    }
    memoryCache.set(key, { value, expiresAt: Date.now() + cacheTtl * 1000 });
  }

  async function _cacheGet(key) {
    if (redisClient && typeof redisClient.get === 'function') {
      try {
        const raw = await redisClient.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (err) {
        logger && logger.warn && logger.warn({ event: 'templates.cache.redis_get_failed', key, error: err && err.message });
      }
    }
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  async function _cacheDel(key) {
    if (redisClient && typeof redisClient.del === 'function') {
      try {
        await redisClient.del(key);
      } catch (err) {
        logger && logger.warn && logger.warn({ event: 'templates.cache.redis_del_failed', key, error: err && err.message });
      }
    }
    memoryCache.delete(key);
  }

  function _validateTemplate(template) {
    const ok = validate(template);
    if (ok) return { ok: true };
    return { ok: false, errors: validate.errors };
  }

  /**
   * createTemplate
   * - Validates and inserts a new template. If a template with same id exists, this will insert as version 1 only if none exist.
   */
  async function createTemplate(template, opts = {}) {
    const actor = opts.actor || null;
    const now = _nowIso();

    // ensure required fields
    if (!template || !template.id) throw new Error('template.id required');

    // determine version: if any existing versions, set version = max+1
    const existing = await templatesColl.findOne({ id: template.id }, { sort: { version: -1 }, projection: { version: 1 } });
    const nextVersion = existing && existing.version ? existing.version + 1 : (template.version || 1);

    const tpl = Object.assign({}, template, {
      id: template.id,
      version: nextVersion,
      status: template.status || 'draft',
      createdBy: template.createdBy || actor || 'system',
      createdAt: template.createdAt || now,
      updatedBy: template.updatedBy || actor || 'system',
      updatedAt: template.updatedAt || now
    });

    // validate
    const v = _validateTemplate(tpl);
    if (!v.ok) {
      const err = new Error('template validation failed');
      err.details = v.errors;
      throw err;
    }

    await templatesColl.insertOne(tpl);

    // invalidate active cache for this id
    await _cacheDel(`template:active:${tpl.id}`);

    return tpl;
  }

  /**
   * updateTemplate
   * - Creates a new version of the template. Keeps previous versions immutable.
   */
  async function updateTemplate(id, patch, opts = {}) {
    const actor = opts.actor || null;
    const now = _nowIso();

    if (!id) throw new Error('id required');

    // fetch latest version
    const latest = await templatesColl.findOne({ id }, { sort: { version: -1 } });
    if (!latest) throw new Error('template_not_found');

    const newVersion = latest.version + 1;
    const merged = Object.assign({}, latest, patch, {
      version: newVersion,
      status: patch.status || latest.status,
      createdBy: latest.createdBy,
      createdAt: latest.createdAt,
      updatedBy: actor || latest.updatedBy || 'system',
      updatedAt: now
    });

    // remove _id if present
    delete merged._id;

    const v = _validateTemplate(merged);
    if (!v.ok) {
      const err = new Error('template validation failed');
      err.details = v.errors;
      throw err;
    }

    await templatesColl.insertOne(merged);

    // invalidate cache
    await _cacheDel(`template:active:${id}`);

    return merged;
  }

  /**
   * findById
   * - If version provided, returns that version; otherwise returns latest version.
   */
  async function findById(id, version = null) {
    if (!id) return null;
    const query = { id };
    const opts = {};
    if (version) {
      query.version = version;
      return templatesColl.findOne(query);
    }
    // latest
    return templatesColl.findOne(query, { sort: { version: -1 } });
  }

  /**
   * findActive
   * - Returns the active template for id, optionally for a locale (locale overrides are applied by renderer).
   * - Uses cache for performance.
   */
  async function findActive(id) {
    if (!id) return null;
    const cacheKey = `template:active:${id}`;
    const cached = await _cacheGet(cacheKey);
    if (cached) return cached;

    const tpl = await templatesColl.findOne({ id, status: 'active' }, { sort: { version: -1 } });
    if (!tpl) return null;

    await _cacheSet(cacheKey, tpl);
    return tpl;
  }

  /**
   * listTemplates
   * - Simple listing with optional filters.
   */
  async function listTemplates(filter = {}, opts = {}) {
    const cursor = templatesColl.find(filter).sort({ id: 1, version: -1 });
    if (opts.limit) cursor.limit(opts.limit);
    if (opts.skip) cursor.skip(opts.skip);
    return cursor.toArray();
  }

  /**
   * deprecateTemplate
   * - Soft-deletes a template id by marking latest version as deprecated (creates a new version with status deprecated).
   */
  async function deprecateTemplate(id, opts = {}) {
    const actor = opts.actor || null;
    const latest = await templatesColl.findOne({ id }, { sort: { version: -1 } });
    if (!latest) throw new Error('template_not_found');

    const deprecated = Object.assign({}, latest, {
      version: latest.version + 1,
      status: 'deprecated',
      updatedBy: actor || latest.updatedBy || 'system',
      updatedAt: _nowIso()
    });
    delete deprecated._id;

    const v = _validateTemplate(deprecated);
    if (!v.ok) {
      const err = new Error('template validation failed');
      err.details = v.errors;
      throw err;
    }

    await templatesColl.insertOne(deprecated);
    await _cacheDel(`template:active:${id}`);
    return deprecated;
  }

  /**
   * validateTemplate - expose validator for admin UI/tests
   */
  function validateTemplate(template) {
    return _validateTemplate(template);
  }

  return {
    createTemplate,
    updateTemplate,
    findById,
    findActive,
    listTemplates,
    deprecateTemplate,
    validateTemplate
  };
}

module.exports = { createTemplateRepo };
