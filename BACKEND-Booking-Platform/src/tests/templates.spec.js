// tests/templates.spec.js
//
// Jest unit tests for comms-js template modules:
// - repository (create/update/findActive/list/deprecate/validate)
// - renderer (renderTemplate, renderAllChannels, truncation & validation)
// - previewer (previewTemplate, previewFromTemplateObject)
// - migrations/seed-templates (idempotent insert)
//
// These tests use a lightweight in-memory Mongo-like collection and a fake Redis client.

const fs = require('fs');
const path = require('path');
const { createTemplateRepo } = require('../src/comms-js/templates/repository');
const { createRenderer } = require('../src/comms-js/templates/renderer');
const { createPreviewer } = require('../src/comms-js/templates/preview');
const { seedTemplates } = require('../src/comms-js/templates/migrations/seed-templates');

//
// In-memory Mongo collection helper
//
function createInMemoryDb() {
  const store = [];
  return {
    collection: (name) => {
      return {
        insertOne: async (doc) => {
          const copy = Object.assign({}, doc, { _id: `${doc.id}::v${doc.version}` });
          store.push(copy);
          return { insertedId: copy._id };
        },
        findOne: async (query, opts = {}) => {
          // simple findOne supporting sort by version desc
          const matches = store.filter((d) => {
            for (const k of Object.keys(query)) {
              if (d[k] !== query[k]) return false;
            }
            return true;
          });
          if (matches.length === 0) return null;
          if (opts && opts.sort && opts.sort.version === -1) {
            matches.sort((a, b) => b.version - a.version);
            return matches[0];
          }
          // if version specified in query, return exact
          return matches[0];
        },
        find: (filter = {}) => {
          const results = store.filter((d) => {
            for (const k of Object.keys(filter)) {
              if (d[k] !== filter[k]) return false;
            }
            return true;
          });
          return {
            sort: function () { return this; },
            limit: function () { return this; },
            skip: function () { return this; },
            toArray: async () => results.slice()
          };
        },
        // helper for tests to inspect store
        __store: store
      };
    }
  };
}

describe('templates modules', () => {
  let db;
  let repo;
  let redisMock;
  let logger;

  beforeEach(() => {
    db = createInMemoryDb();
    redisMock = {
      // simple in-memory redis-like map
      _m: new Map(),
      get: async function (k) { return this._m.has(k) ? this._m.get(k) : null; },
      setex: async function (k, ttl, v) { this._m.set(k, v); },
      del: async function (k) { this._m.delete(k); }
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    repo = createTemplateRepo({ db, redisClient: redisMock, logger, cacheTtl: 2 });
  });

  describe('repository', () => {
    test('validateTemplate rejects invalid template', () => {
      const invalid = { id: 'x' }; // missing required fields
      const res = repo.validateTemplate(invalid);
      expect(res.ok).toBe(false);
      expect(Array.isArray(res.errors)).toBe(true);
    });

    test('createTemplate inserts and findActive returns it', async () => {
      const tpl = {
        id: 'test.simple',
        version: 1,
        status: 'active',
        channels: [{ name: 'in_app', body: 'hi {{userName}}' }],
        placeholders: { userName: { type: 'string', required: true } }
      };
      const created = await repo.createTemplate(tpl, { actor: 'tester' });
      expect(created.id).toBe('test.simple');
      const active = await repo.findActive('test.simple');
      expect(active).not.toBeNull();
      expect(active.version).toBe(created.version);
    });

    test('updateTemplate creates new version and invalidates cache', async () => {
      const tpl = {
        id: 'test.update',
        version: 1,
        status: 'active',
        channels: [{ name: 'email', body: 'hello {{userName}}' }],
        placeholders: { userName: { type: 'string', required: true } }
      };
      await repo.createTemplate(tpl, { actor: 'alice' });
      const before = await repo.findActive('test.update');
      expect(before.version).toBe(1);

      const patched = await repo.updateTemplate('test.update', { title: 'Updated title' }, { actor: 'bob' });
      expect(patched.version).toBe(2);
      const after = await repo.findActive('test.update');
      expect(after.version).toBe(2);
      expect(after.title).toBe('Updated title');
    });

    test('deprecateTemplate marks new version deprecated', async () => {
      const tpl = {
        id: 'test.deprecate',
        version: 1,
        status: 'active',
        channels: [{ name: 'in_app', body: 'x' }],
        placeholders: {}
      };
      await repo.createTemplate(tpl, { actor: 'seed' });
      const dep = await repo.deprecateTemplate('test.deprecate', { actor: 'ops' });
      expect(dep.status).toBe('deprecated');
      expect(dep.version).toBe(2);
      const active = await repo.findActive('test.deprecate');
      expect(active).toBeNull();
    });

    test('listTemplates returns versions', async () => {
      const t1 = { id: 'list.a', version: 1, status: 'active', channels: [{ name: 'in_app', body: 'a' }], placeholders: {} };
      const t2 = { id: 'list.b', version: 1, status: 'active', channels: [{ name: 'in_app', body: 'b' }], placeholders: {} };
      await repo.createTemplate(t1, { actor: 's' });
      await repo.createTemplate(t2, { actor: 's' });
      const all = await repo.listTemplates({});
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('renderer', () => {
    let renderer;
    beforeEach(async () => {
      // create a template to render
      const tpl = {
        id: 'render.test',
        version: 1,
        status: 'active',
        channels: [
          { name: 'in_app', title: 'Hello {{userName}}', body: 'Welcome {{userName}} to {{app}}' },
          { name: 'push', title: 'Ping {{userName}}', body: 'You have {{count}} new items', limits: { titleMaxLength: 10, bodyMaxLength: 20 } },
          { name: 'email', subject: 'Hi {{userName}}', body: 'Email body {{userName}}', bodyHtml: '<p>{{userName}}</p>' }
        ],
        placeholders: {
          userName: { type: 'string', required: true },
          app: { type: 'string', required: false },
          count: { type: 'number', required: false }
        },
        examplePayload: { userName: 'Sam', app: 'Comms', count: 3 }
      };
      await repo.createTemplate(tpl, { actor: 'test' });
      renderer = createRenderer({ templateRepo: repo, config: { defaultLocale: 'en-US' }, logger });
    });

    test('renderTemplate returns rendered fields and snapshot', async () => {
      const res = await renderer.renderTemplate('render.test', 'en-US', { userName: 'Sam', app: 'Comms' }, 'in_app');
      expect(res.ok).toBe(true);
      expect(res.rendered.title).toContain('Sam');
      expect(res.snapshot).toBeDefined();
      expect(res.snapshot.channel).toBe('in_app');
    });

    test('renderTemplate enforces limits and returns warnings', async () => {
      const longName = 'VeryLongUserNameExceedingLimit';
      const res = await renderer.renderTemplate('render.test', 'en-US', { userName: longName, count: 5 }, 'push');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.warnings)).toBe(true);
      // title should be truncated due to titleMaxLength=10
      expect(res.rendered.title.length).toBeLessThanOrEqual(10);
    });

    test('renderTemplate fails when required placeholder missing', async () => {
      const res = await renderer.renderTemplate('render.test', 'en-US', { app: 'Comms' }, 'in_app');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('payload_validation_failed');
      expect(Array.isArray(res.details)).toBe(true);
    });

    test('renderAllChannels returns map of channel results', async () => {
      const all = await renderer.renderAllChannels('render.test', 'en-US', { userName: 'Sam', app: 'Comms', count: 2 });
      expect(all.ok).toBe(true);
      expect(all.results.in_app.ok).toBe(true);
      expect(all.results.email.ok).toBe(true);
      expect(all.results.push.ok).toBe(true);
    });
  });

  describe('previewer', () => {
    let previewer;
    beforeEach(() => {
      previewer = createPreviewer({ templateRepo: repo, renderer: null, config: { defaultLocale: 'en-US' }, logger });
    });

    test('previewTemplate uses examplePayload when none provided', async () => {
      // create a simple template with examplePayload
      const tpl = {
        id: 'preview.test',
        version: 1,
        status: 'active',
        channels: [{ name: 'email', subject: 'Hello {{userName}}', body: 'Body {{userName}}' }],
        placeholders: { userName: { type: 'string', required: true } },
        examplePayload: { userName: 'Example' }
      };
      await repo.createTemplate(tpl, { actor: 'qa' });

      const res = await previewer.previewTemplate('preview.test', 'en-US', {}, ['email']);
      expect(res.ok).toBe(true);
      expect(res.previews.email.ok).toBe(true);
      expect(res.payloadUsed.userName).toBe('Example');
      expect(res.previews.email.rendered.subject).toContain('Example');
    });

    test('previewFromTemplateObject renders without persisting', async () => {
      const temp = {
        id: 'temp.preview',
        version: 99,
        status: 'draft',
        channels: [{ name: 'in_app', title: 'T {{userName}}', body: 'B {{userName}}' }],
        placeholders: { userName: { type: 'string', required: true } },
        examplePayload: { userName: 'Z' }
      };
      const res = await previewer.previewFromTemplateObject(temp, 'en-US', {}, ['in_app']);
      expect(res.ok).toBe(true);
      expect(res.previews.in_app.ok).toBe(true);
      expect(res.previews.in_app.rendered.title).toContain('Z');
    });
  });

  describe('migrations/seed-templates', () => {
    test('seedTemplates inserts defaults.json templates idempotently', async () => {
      // create a temporary defaults.json with two templates for the test
      const defaultsPath = path.join(__dirname, '..', 'src', 'comms-js', 'templates', 'defaults.json');
      const original = fs.readFileSync(defaultsPath, 'utf8');

      // create a small defaults payload
      const tmpDefaults = {
        templates: [
          {
            id: 'seed.one',
            version: 1,
            status: 'active',
            channels: [{ name: 'in_app', body: 'hi' }],
            placeholders: {}
          },
          {
            id: 'seed.two',
            version: 1,
            status: 'active',
            channels: [{ name: 'email', body: 'hello' }],
            placeholders: {}
          }
        ]
      };
      // write temp defaults to file
      fs.writeFileSync(defaultsPath, JSON.stringify(tmpDefaults, null, 2), 'utf8');

      // run seed
      const res1 = await seedTemplates(db, { logger });
      expect(res1.ok).toBe(true);
      expect(res1.inserted).toBeGreaterThanOrEqual(2);

      // run seed again; should skip existing versions
      const res2 = await seedTemplates(db, { logger });
      expect(res2.ok).toBe(true);
      expect(res2.inserted).toBe(0);

      // restore original defaults.json
      fs.writeFileSync(defaultsPath, original, 'utf8');
    });
  });
});
