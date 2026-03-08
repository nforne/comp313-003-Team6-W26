// src/comms-js/templates/migrations/seed-templates.js
//
// Idempotent seed script for comms-js templates.
// - Loads templates from src/comms-js/templates/defaults.json
// - Inserts each template as a new version only if that exact version does not already exist.
// - Can be used programmatically (seedTemplates(db, opts)) or run as a CLI script.
// - Uses the template repository (createTemplateRepo) when available to ensure schema validation and cache invalidation.
//
// Usage (programmatic):
//   const { seedTemplates } = require('./migrations/seed-templates');
//   await seedTemplates(db, { logger });
//
// Usage (CLI):
//   node src/comms-js/templates/migrations/seed-templates.js
//
// Environment variables for CLI mode:
//   MONGO_URI - optional MongoDB connection string (defaults to mongodb://localhost:27017)
//   MONGO_DB  - optional DB name (defaults to comms)

const fs = require('fs');
const path = require('path');

const { MongoClient } = require('mongodb');

// Try to require the template repo factory if present in the project.
// If not available, the script will fall back to direct collection writes.
let createTemplateRepo = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  createTemplateRepo = require('../../templates/repository').createTemplateRepo;
} catch (err) {
  // repository not available — we'll use direct collection operations
  createTemplateRepo = null;
}

const DEFAULTS_PATH = path.join(__dirname, '..', 'defaults.json');

function _nowIso() {
  return new Date().toISOString();
}

/**
 * seedTemplates
 * @param {Object} db - MongoDB database instance (must expose collection())
 * @param {Object} opts
 *   { logger, redisClient, repoOptions }
 *
 * Behavior:
 *  - Reads defaults.json and iterates templates.
 *  - For each template: if a document with same id and version exists, skip.
 *  - Otherwise insert the template document (ensuring createdAt/updatedAt).
 *  - If templateRepo is available, use repo.createTemplate to validate and version correctly.
 */
async function seedTemplates(db, opts = {}) {
  const logger = opts.logger || console;
  if (!db || typeof db.collection !== 'function') {
    throw new Error('db (MongoDB database) required');
  }

  // read defaults.json
  const raw = fs.readFileSync(DEFAULTS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const templates = Array.isArray(parsed.templates) ? parsed.templates : [];

  if (templates.length === 0) {
    logger && logger.info && logger.info({ event: 'templates.seed.no_templates', path: DEFAULTS_PATH });
    return { ok: true, inserted: 0, skipped: 0 };
  }

  const templatesColl = db.collection('templates');
  let repo = null;
  if (createTemplateRepo) {
    try {
      repo = createTemplateRepo({ db, redisClient: opts.redisClient, logger, cacheTtl: opts.cacheTtl || 3600 });
    } catch (err) {
      logger && logger.warn && logger.warn({ event: 'templates.seed.repo_init_failed', error: err && err.message });
      repo = null;
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const t of templates) {
    try {
      // normalize timestamps and actor
      const now = _nowIso();
      const tpl = Object.assign({}, t, {
        createdBy: t.createdBy || 'seed',
        createdAt: t.createdAt || now,
        updatedBy: t.updatedBy || t.createdBy || 'seed',
        updatedAt: t.updatedAt || now
      });

      // check existence: exact id + version
      const exists = await templatesColl.findOne({ id: tpl.id, version: tpl.version });
      if (exists) {
        skipped += 1;
        logger && logger.debug && logger.debug({ event: 'templates.seed.skip_exists', id: tpl.id, version: tpl.version });
        continue;
      }

      if (repo && typeof repo.createTemplate === 'function') {
        // Use repository to validate and insert (it will compute version if needed)
        try {
          await repo.createTemplate(tpl, { actor: tpl.createdBy });
          inserted += 1;
          logger && logger.info && logger.info({ event: 'templates.seed.inserted_via_repo', id: tpl.id, version: tpl.version });
        } catch (err) {
          // If validation fails, log and continue
          logger && logger.error && logger.error({ event: 'templates.seed.repo_create_failed', id: tpl.id, version: tpl.version, error: err && err.message });
        }
      } else {
        // Direct insert (ensure document shape)
        await templatesColl.insertOne(tpl);
        inserted += 1;
        logger && logger.info && logger.info({ event: 'templates.seed.inserted_direct', id: tpl.id, version: tpl.version });
      }
    } catch (err) {
      logger && logger.error && logger.error({ event: 'templates.seed.error', id: t && t.id, error: err && err.message });
    }
  }

  return { ok: true, inserted, skipped };
}

/**
 * CLI runner
 * Connects to MongoDB using MONGO_URI / MONGO_DB and runs seedTemplates.
 */
async function _runCli() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const mongoDbName = process.env.MONGO_DB || 'comms-js';
  const logger = console;

  let client;
  try {
    client = new MongoClient(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db(mongoDbName);
    logger.info({ event: 'templates.seed.cli.start', mongoUri: mongoUri, db: mongoDbName });

    const res = await seedTemplates(db, { logger });
    logger.info({ event: 'templates.seed.cli.done', result: res });
    await client.close();
    process.exit(0);
  } catch (err) {
    logger.error({ event: 'templates.seed.cli.failed', error: err && err.message });
    if (client) try { await client.close(); } catch (e) {}
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = { seedTemplates };

// If executed directly, run CLI
if (require.main === module) {
  _runCli();
}
