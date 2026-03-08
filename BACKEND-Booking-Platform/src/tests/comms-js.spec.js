// comms-js.spec.js
//
// Jest test suite for comms-js core modules (high-level integration-style unit tests).
// - Tests deliverMessage (entrypoint), engine.processMessage (orchestration), and batch.worker.processBatch (per-batch).
// - Uses module mocks for repositories, providers, and auditService to validate control flow and persistence calls.
// - Focuses on behavior, not DB/network integration.

const path = require('path');
const { jest } = require('@jest/globals');

//
// Helper to reset module cache and re-require modules under test with mocks applied.
//
function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

describe('comms-js integration behavior', () => {
  let mockMessageRepo;
  let mockUserRepo;
  let mockBatchWorker;
  let mockEmailProvider;
  let mockNotificationProvider;
  let mockAuditService;
  let configBackup;

  beforeEach(() => {
    // Reset mocks and module cache
    jest.resetModules();

    // Basic mock implementations
    mockMessageRepo = {
      findById: jest.fn(),
      updateMessage: jest.fn(),
    };

    mockUserRepo = {
      streamAllUserIds: jest.fn(),
      findPublicById: jest.fn(),
    };

    mockBatchWorker = {
      processBatch: jest.fn(),
    };

    mockEmailProvider = {
      sendEmail: jest.fn(),
    };

    mockNotificationProvider = {
      publishNotification: jest.fn(),
      setWSPublisher: jest.fn()
    };

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(true)
    };

    // Inject mocks into require cache for modules that will be required by the code under test.
    // We map the repository/provider module paths used in the source files to our mocks.
    const repoPath = path.resolve(__dirname, './src/comms-js/repositories/message.repo.js');
    const userRepoPath = path.resolve(__dirname, './src/comms-js/repositories/user.repo.js');
    const batchWorkerPath = path.resolve(__dirname, './src/comms-js/workers/batch.worker.js');
    const emailProvPath = path.resolve(__dirname, './src/comms-js/providers/email.provider.js');
    const notifProvPath = path.resolve(__dirname, './src/comms-js/providers/notification.provider.js');
    const auditPath = path.resolve(__dirname, './src/comms-js/services/audit.service.js');

    // Provide minimal module wrappers in cache so require() returns our mocks.
    jest.mock(repoPath, () => mockMessageRepo, { virtual: true });
    jest.mock(userRepoPath, () => mockUserRepo, { virtual: true });
    jest.mock(batchWorkerPath, () => mockBatchWorker, { virtual: true });
    jest.mock(emailProvPath, () => mockEmailProvider, { virtual: true });
    jest.mock(notifProvPath, () => mockNotificationProvider, { virtual: true });
    jest.mock(auditPath, () => mockAuditService, { virtual: true });

    // Also mock config to keep deterministic behavior
    configBackup = jest.requireActual('./src/comms-js/config.js');
    jest.mock('./src/comms-js/config.js', () => Object.assign({}, configBackup, {
      broadcastBatchSize: 3,
      limitedBatchSize: 2,
      batchConcurrency: 2,
      maxRetries: 2,
      backoffBaseMs: 1
    }), { virtual: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deliverMessage (entrypoint)', () => {
    test('throws 400 when messageId missing', async () => {
      const index = requireFresh('./src/comms-js/index.js');
      await expect(index.deliverMessage(null)).rejects.toMatchObject({ status: 400 });
    });

    test('throws 404 when message not found and audits failure', async () => {
      mockMessageRepo.findById.mockResolvedValue(null);
      const index = requireFresh('./src/comms-js/index.js');

      await expect(index.deliverMessage('missing-id', { actor: 'tester' })).rejects.toMatchObject({ status: 404 });
      expect(mockAuditService.logEvent).toHaveBeenCalled();
    });

    test('throws 409 when message status not submitted', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm1', status: 'draft' });
      const index = requireFresh('./src/comms-js/index.js');

      await expect(index.deliverMessage('m1', { actor: 'tester' })).rejects.toMatchObject({ status: 409 });
      expect(mockAuditService.logEvent).toHaveBeenCalled();
    });

    test('returns enqueued when engine returns asyncEnqueued', async () => {
      // message in submitted state
      const messageDoc = { _id: 'm2', status: 'submitted' };
      mockMessageRepo.findById.mockResolvedValue(messageDoc);

      // mock engine to return asyncEnqueued
      jest.mock('./src/comms-js/engine.js', () => ({
        processMessage: jest.fn().mockResolvedValue({ ok: true, asyncEnqueued: true })
      }), { virtual: true });

      // Re-require index after mocking engine
      const index = requireFresh('./src/comms-js/index.js');

      // Provide Message model lean findById used at the end; create a minimal stub
      jest.mock('./src/comms-js/models/message.model.js', () => ({
        findById: () => ({ lean: () => ({ exec: () => Promise.resolve(messageDoc) }) })
      }), { virtual: true });

      const res = await index.deliverMessage('m2', { actor: 'tester' });
      expect(res.ok).toBe(true);
      expect(res.deliveryInfo).toEqual({ enqueued: true });
    });
  });

  describe('engine.processMessage', () => {
    let engine;
    beforeEach(() => {
      // Provide a fresh engine with mocked dependencies
      engine = requireFresh('./src/comms-js/engine.js');
    });

    test('returns no_recipients when message has empty recipients', async () => {
      const msg = { _id: 'm3', status: 'submitted', recipientsAll: false, recipients: [] };
      const res = await engine.processMessage(msg, { logger: console });
      expect(res.ok).toBe(true);
      expect(res.deliveryInfo).toMatchObject({ note: 'no_recipients' });
    });

    test('enqueues broadcast when recipientsAll and asyncBroadcast true', async () => {
      // streamAllUserIds should return an async iterator
      const users = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }];
      mockUserRepo.streamAllUserIds.mockImplementation(function* () {
        for (const u of users) yield u;
      });

      const msg = { _id: 'm4', status: 'submitted', recipientsAll: true };
      const res = await engine.processMessage(msg, { asyncBroadcast: true, logger: console });
      expect(res.asyncEnqueued).toBe(true);
    });

    test('processes limited recipients realtime when below threshold', async () => {
      // batchWorker.processBatch should be called per recipient
      mockBatchWorker.processBatch.mockResolvedValue({ results: [{ userId: 'u1', ok: true }] });

      const msg = { _id: 'm5', status: 'submitted', recipientsAll: false, recipients: ['u1'] };
      const res = await engine.processMessage(msg, { logger: console });
      expect(mockBatchWorker.processBatch).toHaveBeenCalledTimes(1);
      expect(res.deliveryInfo.perRecipient.length).toBeGreaterThanOrEqual(1);
    });

    test('processes limited recipients in batches when >= threshold', async () => {
      mockBatchWorker.processBatch.mockResolvedValue({ results: [{ userId: 'u1', ok: true }, { userId: 'u2', ok: true }] });

      const msg = { _id: 'm6', status: 'submitted', recipientsAll: false, recipients: ['u1', 'u2', 'u3'] };
      const res = await engine.processMessage(msg, { logger: console });
      expect(mockBatchWorker.processBatch).toHaveBeenCalled();
      expect(res.deliveryInfo.summary).toBeDefined();
    });
  });

  describe('batch.worker.processBatch', () => {
    let batchWorker;
    beforeEach(() => {
      // Re-require the real worker module (it will pick up our mocked repos/providers)
      batchWorker = requireFresh('./src/comms-js/workers/batch.worker.js');
    });

    test('returns empty results for empty recipient list', async () => {
      const res = await batchWorker.processBatch({ messageId: 'm-empty', recipientIds: [] });
      expect(res.results).toEqual([]);
    });

    test('marks user_not_found when userRepo.findPublicById returns null', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm7', subject: 'hi', details: 'body', attachments: [], metadata: {} });
      mockUserRepo.findPublicById.mockResolvedValue(null);

      const res = await batchWorker.processBatch({ messageId: 'm7', recipientIds: ['u-missing'], channels: ['in_app'], metadata: {} });
      expect(res.results.length).toBe(1);
      expect(res.results[0].ok).toBe(false);
      expect(res.results[0].channelResults.in_app.error).toBe('user_not_found');
      // messageRepo.updateMessage should have been called to persist failure marker
      expect(mockMessageRepo.updateMessage).toHaveBeenCalled();
    });

    test('succeeds when notificationProvider publishes', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm8', subject: 'S', details: 'B', attachments: [], metadata: {} });
      mockUserRepo.findPublicById.mockResolvedValue({ userId: 'u1', emails: [{ value: 'a@b.com' }] });
      mockNotificationProvider.publishNotification.mockResolvedValue({ ok: true, providerId: 'ws-1' });

      const res = await batchWorker.processBatch({ messageId: 'm8', recipientIds: ['u1'], channels: ['in_app'], metadata: {} });
      expect(res.results.length).toBe(1);
      expect(res.results[0].ok).toBe(true);
      expect(res.results[0].channelResults.in_app.providerId).toBe('ws-1');
    });

    test('falls back to persist when ws publish fails', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm9', subject: 'S', details: 'B', attachments: [], metadata: {} });
      mockUserRepo.findPublicById.mockResolvedValue({ userId: 'u2', emails: [{ value: 'x@y.com' }] });
      mockNotificationProvider.publishNotification.mockResolvedValue({ ok: false, error: 'ws_down' });

      const res = await batchWorker.processBatch({ messageId: 'm9', recipientIds: ['u2'], channels: ['in_app'], metadata: {} });
      expect(res.results.length).toBe(1);
      // Even if publish returned ok:false, worker persists fallback and returns ok:false for channel
      expect(res.results[0].ok).toBe(false);
      expect(mockMessageRepo.updateMessage).toHaveBeenCalled();
    });

    test('attempts email channel and records providerId on success', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm10', subject: 'Order', details: 'Your order', attachments: [], metadata: {} });
      mockUserRepo.findPublicById.mockResolvedValue({ userId: 'u3', emails: [{ value: 'c@d.com' }] });
      mockEmailProvider.sendEmail.mockResolvedValue({ ok: true, providerId: 'ses-123' });

      const res = await batchWorker.processBatch({ messageId: 'm10', recipientIds: ['u3'], channels: ['email'], metadata: {} });
      expect(res.results.length).toBe(1);
      expect(res.results[0].ok).toBe(true);
      expect(res.results[0].channelResults.email.providerId).toBe('ses-123');
      // ensure persistDeliveryInfo was called to record success
      expect(mockMessageRepo.updateMessage).toHaveBeenCalled();
    });

    test('retries transient provider errors and records final failure', async () => {
      mockMessageRepo.findById.mockResolvedValue({ _id: 'm11', subject: 'Retry', details: 'Retry body', attachments: [], metadata: {} });
      mockUserRepo.findPublicById.mockResolvedValue({ userId: 'u4', emails: [{ value: 'r@r.com' }] });

      // First attempt fails, second attempt fails as well (exhaust retries)
      mockEmailProvider.sendEmail
        .mockRejectedValueOnce(new Error('transient'))
        .mockRejectedValueOnce(new Error('transient2'));

      const res = await batchWorker.processBatch({ messageId: 'm11', recipientIds: ['u4'], channels: ['email'], metadata: {} });
      expect(res.results.length).toBe(1);
      expect(res.results[0].ok).toBe(false);
      expect(res.results[0].channelResults.email.error).toBeDefined();
      expect(mockMessageRepo.updateMessage).toHaveBeenCalled();
    });
  });
});
