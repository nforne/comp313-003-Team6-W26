// tests/service.spec.js
//
// Integration-style tests for the Service HTTP surface.
// - Uses Jest + Supertest against an Express app that mounts the services router.
// - Service layer and RBAC middleware are mocked so tests are deterministic.
// - Covers: create (happy + forbidden), search pagination, update/delete ownership checks.
//
// Run with: jest tests/service.spec.js

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

// Mock service layer used by controllers
jest.mock('../src/services/service.service');
const serviceService = require('../src/services/service.service');

// Mock auth and rbac middleware so tests can control req.user
jest.mock('../src/middleware/auth.middleware', () => ({
  requireAuth: (req, res, next) => {
    // allow tests to set req.__testUser before calling the route
    req.user = req.__testUser || null;
    next();
  }
}));

// requireRole is used in routes; return a middleware that enforces a role if test sets req.__testRoleFail
jest.mock('../src/middleware/rbac.middleware', () => ({
  requireRole: (role) => (req, res, next) => {
    // If test sets req.__testRoleFail = true, simulate forbidden
    if (req.__testRoleFail) return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN' } });
    next();
  }
}));

const servicesRoutes = require('../src/routes/services.routes');

describe('Service HTTP surface', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/svcs', servicesRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /svcs - create service as provider (happy path)', async () => {
    // Arrange: authenticated provider
    const providerUser = { userId: 'prov-1', role: 'service_provider' };
    const payload = { providerId: 'prov-1', name: 'Test Service', categories: ['cleaning'] };

    // Mock serviceService.createService to return created object
    const created = Object.assign({}, payload, { serviceId: 'svc_000000000001', createdAt: Date.now(), updatedAt: Date.now() });
    serviceService.createService.mockResolvedValueOnce(created);

    // Act
    const res = await request(app)
      .post('/svcs')
      .send(payload)
      .set('Content-Type', 'application/json')
      // inject test user via header interpreted by mocked requireAuth
      .set('x-test-user', '1') // not used directly; we'll set __testUser on req in middleware below
      .use((req) => { req.__testUser = providerUser; });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, service: expect.objectContaining({ serviceId: 'svc_000000000001', name: 'Test Service' }) }));
    expect(serviceService.createService).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'prov-1', name: 'Test Service' }), providerUser, expect.anything());
  });

  test('POST /svcs - create service forbidden when providerId mismatches authenticated user', async () => {
    const providerUser = { userId: 'prov-1', role: 'service_provider' };
    const payload = { providerId: 'other-prov', name: 'Another Service' };

    const res = await request(app)
      .post('/svcs')
      .send(payload)
      .use((req) => { req.__testUser = providerUser; });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) }));
    expect(serviceService.createService).not.toHaveBeenCalled();
  });

  test('GET /svcs - search returns paginated results', async () => {
    // Arrange: mock search result
    const fakeResults = {
      results: [
        { serviceId: 'svc_1', name: 'A' },
        { serviceId: 'svc_2', name: 'B' }
      ],
      total: 2,
      page: 1,
      pageSize: 20
    };
    serviceService.search.mockResolvedValueOnce(fakeResults);

    // Act
    const res = await request(app)
      .get('/svcs')
      .query({ q: 'cleaning', page: 1 });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, results: expect.any(Array), total: 2 }));
    expect(serviceService.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'cleaning', page: '1' }), {}, expect.anything());
  });

  test('PATCH /svcs/:id - update forbidden for non-owner non-admin', async () => {
    const actor = { userId: 'someone-else', role: 'service_provider' };
    // Mock serviceService.updateService to throw forbidden if called (should not be called)
    serviceService.updateService.mockImplementation(() => { throw new Error('should not be called'); });

    const res = await request(app)
      .patch('/svcs/svc_1')
      .send({ name: 'New Name' })
      .use((req) => { req.__testUser = actor; });

    // Because serviceService enforces ownership, controller will call it; but in our route-level test we expect service layer to handle auth.
    // If service layer throws, controller will surface error. To keep this test meaningful, simulate serviceService throwing 403.
    serviceService.updateService.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res2 = await request(app)
      .patch('/svcs/svc_1')
      .send({ name: 'New Name' })
      .use((req) => { req.__testUser = actor; });

    expect(res2.status).toBe(403);
    expect(res2.body).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'ERROR' }) }));
  });

  test('DELETE /svcs/:id - delete by owner succeeds', async () => {
    const actor = { userId: 'prov-1', role: 'service_provider' };
    // Mock removeService to resolve
    serviceService.removeService.mockResolvedValueOnce({ serviceId: 'svc_1', providerId: 'prov-1' });

    const res = await request(app)
      .delete('/svcs/svc_1')
      .use((req) => { req.__testUser = actor; });

    expect(res.status).toBe(204);
    expect(serviceService.removeService).toHaveBeenCalledWith('svc_1', actor, expect.anything());
  });
});
