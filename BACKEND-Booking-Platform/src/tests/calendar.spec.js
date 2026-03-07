// tests/calendar.spec.js
//
// Integration-style tests for calendar routes/controllers using an instrumented Express app.
// - Uses jest and supertest.
// - Mocks auth/rbac middleware, calendar service, and audit service to keep tests deterministic.
//
// Run with: jest tests/calendar.spec.js

const request = require('supertest');
const express = require('express');

// Mocks for middleware and services
jest.mock('../src/middleware/auth.middleware', () => ({
  requireAuth: (req, res, next) => {
    // attach a fake user for authenticated routes
    req.user = { userId: 'user-1', role: 'user', isAdmin: false };
    return next();
  }
}));
jest.mock('../src/middleware/rbac.middleware', () => ({
  requireRole: (role) => (req, res, next) => {
    // simple admin guard for tests; treat role 'administrator' specially
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

// Mock calendar service used by controller
const mockService = {
  getLatestCalendarByService: jest.fn(),
  getLatestCalendarByUser: jest.fn(),
  getDefaultCalendarView: jest.fn(),
  isSlotAvailable: jest.fn(),
  reserveSlotRange: jest.fn(),
  cleanupBlankCalendars: jest.fn(),
  startWeeklyCleanupScheduler: jest.fn(),
  stopWeeklyCleanupScheduler: jest.fn(),
  detectTimezoneFromIp: jest.fn().mockReturnValue('UTC')
};
jest.mock('../src/services/calendar.service', () => mockService);

// Import the routes under test (after mocks)
const calendarRoutes = require('../src/routes/calendar.routes');

describe('Calendar routes', () => {
  let app;

  beforeEach(() => {
    // reset mocks
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // mount calendar routes at /calendar (same as app.js would)
    app.use('/calendar', calendarRoutes);
  });

  test('GET /calendar/service/:serviceId/latest returns default when no persisted calendar', async () => {
    mockService.getLatestCalendarByService.mockResolvedValue(null);
    mockService.getDefaultCalendarView.mockReturnValue({ meta: { source: 'default' }, offLimitsSlots: [] });

    const res = await request(app).get('/calendar/service/svc-123/latest').query({ dateEpoch: Date.now() });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.source).toBe('default');
    expect(mockService.getLatestCalendarByService).toHaveBeenCalledWith('svc-123');
    expect(mockService.getDefaultCalendarView).toHaveBeenCalled();
  });

  test('GET /calendar/user/:ownerId/latest returns persisted calendar when present', async () => {
    const fakeCal = { _id: 'cal-1', ownerId: 'owner-1' };
    mockService.getLatestCalendarByUser.mockResolvedValue(fakeCal);

    const res = await request(app).get('/calendar/user/owner-1/latest');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual(fakeCal);
    expect(res.body.meta.source).toBe('persisted');
    expect(mockService.getLatestCalendarByUser).toHaveBeenCalledWith('owner-1');
  });

  test('GET /calendar/default returns computed default view', async () => {
    mockService.getDefaultCalendarView.mockReturnValue({ meta: { source: 'default' } });

    const res = await request(app).get('/calendar/default').query({ ownerId: 'owner-2', dateEpoch: 1600000000000 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(mockService.getDefaultCalendarView).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-2' }));
  });

  test('POST /calendar/availability validates and returns available result', async () => {
    mockService.isSlotAvailable.mockResolvedValue({ ok: true, code: 'DEFAULT_CALENDAR' });

    const payload = { ownerId: 'owner-3', fromEpoch: 1600000000000, toEpoch: 1600003600000 };
    const res = await request(app).post('/calendar/availability').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.ok).toBe(true);
    expect(mockService.isSlotAvailable).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-3' }));
  });

  test('POST /calendar/reserve requires auth and attempts reservation', async () => {
    // requireAuth middleware attaches req.user in our mock
    mockService.reserveSlotRange.mockResolvedValue({ ok: true, results: [{ ok: true }], action: 'committed' });

    const payload = { ownerId: 'owner-4', bookingId: 'bk-1', fromEpoch: 1600000000000, toEpoch: 1600003600000 };
    const res = await request(app).post('/calendar/reserve').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('committed');
    expect(mockService.reserveSlotRange).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'bk-1' }));
  });

  test('POST /calendar/cleanup (admin) rejects non-admin and accepts admin', async () => {
    // First, non-admin user (default mock) should be blocked by route-level middleware
    const payload = { cutoffWeekStartEpoch: 1600000000000 };
    const resForbidden = await request(app).post('/calendar/cleanup').send(payload);
    expect(resForbidden.status).toBe(403);
    expect(resForbidden.body.ok).toBe(false);

    // Now simulate admin by mounting a small app that sets req.user.role = 'administrator'
    const adminApp = express();
    adminApp.use(express.json());
    // override requireAuth mock behavior for this test: attach admin user
    adminApp.use((req, res, next) => { req.user = { userId: 'admin', role: 'administrator', isAdmin: true }; next(); });
    adminApp.use('/calendar', calendarRoutes);

    mockService.cleanupBlankCalendars.mockResolvedValue({ removed: 1 });

    const resAdmin = await request(adminApp).post('/calendar/cleanup').send(payload);
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.ok).toBe(true);
    expect(resAdmin.body.data).toEqual({ removed: 1 });
    expect(mockService.cleanupBlankCalendars).toHaveBeenCalledWith(1600000000000);
  });

  test('POST /calendar/cleanup/scheduler start/stop flows', async () => {
    // non-admin blocked
    const resForbidden = await request(app).post('/calendar/cleanup/scheduler').send({ action: 'start' });
    expect(resForbidden.status).toBe(403);

    // admin start
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use((req, res, next) => { req.user = { userId: 'admin', role: 'administrator', isAdmin: true }; next(); });
    adminApp.use('/calendar', calendarRoutes);

    mockService.startWeeklyCleanupScheduler.mockReturnValue({ running: true, intervalMs: 604800000 });
    const resStart = await request(adminApp).post('/calendar/cleanup/scheduler').send({ action: 'start' });
    expect(resStart.status).toBe(200);
    expect(resStart.body.ok).toBe(true);
    expect(resStart.body.data.running).toBe(true);
    expect(mockService.startWeeklyCleanupScheduler).toHaveBeenCalled();

    // admin stop
    mockService.stopWeeklyCleanupScheduler.mockReturnValue({ stopped: true });
    const resStop = await request(adminApp).post('/calendar/cleanup/scheduler').send({ action: 'stop' });
    expect(resStop.status).toBe(200);
    expect(resStop.body.ok).toBe(true);
    expect(resStop.body.data.stopped).toBe(true);
    expect(mockService.stopWeeklyCleanupScheduler).toHaveBeenCalled();
  });
});
