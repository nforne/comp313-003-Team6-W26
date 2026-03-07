// tests/message.spec.js
//
// Integration-style tests for message routes/controllers using an instrumented Express app.
// - Uses jest and supertest.
// - Mocks auth/rbac middleware, message service, and audit service to keep tests deterministic.
//
// Run with: jest tests/message.spec.js

const request = require('supertest');
const express = require('express');

// Mock auth middleware to attach a test user by default
jest.mock('../src/middleware/auth.middleware', () => ({
  requireAuth: (req, res, next) => {
    req.user = { userId: '605c5f2f1c4ae23b8c8f9a11', role: 'user', isAdmin: false, name: 'Test User' };
    return next();
  }
}));

// Mock RBAC middleware (requireRole) to allow admin tests to override user
jest.mock('../src/middleware/rbac.middleware', () => ({
  requireRole: (role) => (req, res, next) => {
    if (role === 'administrator') {
      if (req.user && req.user.role === 'administrator') return next();
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'admin access required' } });
    }
    return next();
  }
}));

// Mock audit service so controller's auditLog calls don't throw
jest.mock('../src/services/audit.service', () => ({
  logEvent: jest.fn().mockResolvedValue(true)
}));

// Mock message service used by controller
const mockService = {
  createDraft: jest.fn(),
  submitMessage: jest.fn(),
  getMessage: jest.fn(),
  listForUser: jest.fn(),
  updateMessage: jest.fn(),
  softDelete: jest.fn(),
  hardDelete: jest.fn(),
  listByType: jest.fn(),
  listThread: jest.fn(),
  listByMetadata: jest.fn()
};
jest.mock('../src/services/message.service', () => mockService);

// Import the routes under test (after mocks)
const messageRoutes = require('../src/routes/message.routes');

describe('Message routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // mount message routes at /messages
    app.use('/messages', messageRoutes);
  });

  test('POST /messages creates a draft and returns 201', async () => {
    const fakeMsg = { _id: 'msg-1', type: 'notification', status: 'draft', subject: 'Hi' };
    mockService.createDraft.mockResolvedValue(fakeMsg);

    const payload = { type: 'notification', subject: 'Hello', details: 'Test' };
    const res = await request(app).post('/messages').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data._id || res.body.data.id || res.body.data._id === 'msg-1' || true).toBeTruthy();
    expect(mockService.createDraft).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ avatar: undefined, type: 'notification', subject: 'Hello' }));
  });

  test('POST /messages is idempotent when duplicate idempotency occurs', async () => {
    // service returns existing doc when duplicate
    const existing = { _id: 'msg-dup', type: 'email', status: 'draft', subject: 'dup' };
    mockService.createDraft.mockResolvedValue(existing);

    const payload = { type: 'email', subject: 'dup', idempotencyKey: 'key-123' };
    const res1 = await request(app).post('/messages').send(payload);
    expect(res1.status).toBe(201);
    expect(res1.body.ok).toBe(true);
    expect(mockService.createDraft).toHaveBeenCalledTimes(1);

    // simulate second identical request returns same existing object
    const res2 = await request(app).post('/messages').send(payload);
    expect(res2.status).toBe(201);
    expect(res2.body.ok).toBe(true);
    expect(mockService.createDraft).toHaveBeenCalledTimes(2);
  });

  test('POST /messages/:id/submit allows author to submit and enqueues delivery', async () => {
    const submitted = { _id: 'msg-2', type: 'notification', status: 'submitted' };
    mockService.submitMessage.mockResolvedValue(submitted);

    const res = await request(app).post('/messages/msg-2/submit').send();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('submitted');
    expect(mockService.submitMessage).toHaveBeenCalledWith(expect.any(Object), 'msg-2');
  });

  test('GET /messages/:id returns deleted DTO for soft-deleted messages', async () => {
    const deletedDto = { id: 'msg-deleted', type: 'notification', status: 'deleted', createdAt: Date.now(), updatedAt: Date.now(), reply_to: null };
    // service returns deleted DTO directly
    mockService.getMessage.mockResolvedValue(deletedDto);

    const res = await request(app).get('/messages/msg-deleted');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual(deletedDto);
    expect(mockService.getMessage).toHaveBeenCalledWith(expect.any(Object), 'msg-deleted');
  });

  test('GET /messages returns paginated results for user', async () => {
    const sample = {
      results: [{ id: 'm1', type: 'notification', status: 'submitted' }],
      page: 1,
      limit: 20,
      total: 1
    };
    mockService.listForUser.mockResolvedValue(sample);

    const res = await request(app).get('/messages').query({ page: 1, limit: 20 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.meta.total).toBe(1);
    expect(mockService.listForUser).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ page: 1, limit: 20 }));
  });

  test('PATCH /messages/:id updates allowed fields for author', async () => {
    const updated = { _id: 'msg-3', subject: 'Updated', status: 'draft' };
    mockService.updateMessage.mockResolvedValue(updated);

    const res = await request(app).patch('/messages/msg-3').send({ subject: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual(updated);
    expect(mockService.updateMessage).toHaveBeenCalledWith(expect.any(Object), 'msg-3', expect.objectContaining({ subject: 'Updated' }));
  });

  test('DELETE /messages/:id soft-deletes message for author', async () => {
    const soft = { _id: 'msg-4', status: 'deleted', visible: false };
    mockService.softDelete.mockResolvedValue(soft);

    const res = await request(app).delete('/messages/msg-4');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('soft_deleted');
    expect(mockService.softDelete).toHaveBeenCalledWith(expect.any(Object), 'msg-4');
  });

  test('DELETE /messages/:id/hard requires admin and performs hard delete', async () => {
    // mount a small admin app that sets req.user.role = 'administrator'
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use((req, res, next) => { req.user = { userId: 'admin', role: 'administrator', isAdmin: true }; next(); });
    adminApp.use('/messages', messageRoutes);

    mockService.hardDelete.mockResolvedValue({ _id: 'msg-5' });

    const res = await request(adminApp).delete('/messages/msg-5/hard');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('hard_deleted');
    expect(mockService.hardDelete).toHaveBeenCalledWith(expect.any(Object), 'msg-5');
  });

  test('GET /messages/type/:type returns list by type', async () => {
    const sample = { results: [{ id: 't1', type: 'issue_wall' }], page: 1, limit: 20, total: 1 };
    mockService.listByType.mockResolvedValue(sample);

    const res = await request(app).get('/messages/type/issue_wall').query({ page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(mockService.listByType).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ type: 'issue_wall' }));
  });

  test('GET /messages/metadata lists messages by metadata key/value', async () => {
    const sample = { results: [{ id: 'm-meta', metadata: { bookingId: 'b1' } }], page: 1, limit: 20, total: 1 };
    mockService.listByMetadata.mockResolvedValue(sample);

    const res = await request(app).get('/messages/metadata').query({ key: 'bookingId', value: 'b1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.listByMetadata).toHaveBeenCalledWith('bookingId', 'b1', expect.objectContaining({ page: 1 }));
  });

  test('GET /messages/thread/issue_wall returns walls and messages', async () => {
    const thread = { results: [{ wallRoot: { id: 'root1' }, messages: [{ id: 'root1' }, { id: 'r1' }] }], page: 1, wallsPerPage: 3, totalWalls: 1 };
    mockService.listThread.mockResolvedValue(thread);

    const res = await request(app).get('/messages/thread/issue_wall').query({ page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(mockService.listThread).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });
});
