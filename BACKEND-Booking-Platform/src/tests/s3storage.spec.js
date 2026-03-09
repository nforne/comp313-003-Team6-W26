// tests/s3storage.spec.js
//
// Unit tests for S3 storage HTTP surface (controller + routes) and service wiring.
// - Uses Jest and Supertest to exercise express routes exported by src/controllers/s3Storage.controller.js
// - All external dependencies (s3 repo, file repo, jobs, audit, auth middleware) are mocked
// - Covers happy paths and key error cases for request-upload, confirm, presign-download, replace, delete
//
// Run with: jest tests/s3storage.spec.js

const express = require('express');
const request = require('supertest');
const jestMock = require('jest-mock');

// Ensure NODE_ENV=test for any conditional logic
process.env.NODE_ENV = 'test';

// --- Mocks ---
// We mock modules used by controller/service so tests are deterministic.
// The controller requires ../services/s3Storage.service which in turn requires repos and jobs.
// We'll mock repos and jobs at module level before requiring the controller.

const mockS3Repo = {
  generatePresignedPutUrl: jestMock.fn(),
  generatePresignedGetUrl: jestMock.fn(),
  headObjectMeta: jestMock.fn(),
  deleteObjectByKey: jestMock.fn()
};

const mockFileRepo = {
  createFileRecord: jestMock.fn(),
  getFileById: jestMock.fn(),
  findByKey: jestMock.fn(),
  updateFile: jestMock.fn(),
  markDeleted: jestMock.fn()
};

const mockJobs = {
  enqueueProcessUploadedFile: jestMock.fn(),
  enqueueDeleteObject: jestMock.fn()
};

const mockAudit = {
  logEvent: jestMock.fn()
};

// Mock auth middleware to inject req.user
jest.mock('../src/middleware/auth.middleware', () => {
  return {
    requireAuth: (req, res, next) => {
      // default test actor; tests can override by setting req.__testUser
      req.user = req.__testUser || { userId: 'user-123', role: 'user' };
      next();
    }
  };
});

// Replace module implementations used by service/controller
jest.mock('../src/repositories/s3Storage.repo', () => mockS3Repo);
jest.mock('../src/repos/s3storedfiles.repo', () => mockFileRepo);
jest.mock('../src/jobs/s3Storage.jobs', () => mockJobs);
jest.mock('../src/services/audit.service', () => mockAudit);

// Now require the controller/router under test
const storageRouter = require('../src/routes/s3Storage.routes'); // mounts controller internally

// Build an express app for testing
function makeApp() {
  const app = express();
  app.use(express.json());
  // attach a simple logger and correlationId for compatibility
  app.set('logger', console);
  app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id'] || 'test-cid';
    next();
  });
  app.use('/storage', storageRouter);
  return app;
}

describe('S3 storage HTTP surface', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = makeApp();
  });

  describe('POST /storage/request-upload', () => {
    it('returns presigned PUT and creates DB placeholder on success', async () => {
      const fakeFile = { _id: '60f1b2', key: 'uploads/user-123-abc-file.txt', ownerId: 'user-123', filename: 'file.txt', status: 'pending' };
      mockFileRepo.createFileRecord.mockResolvedValueOnce(fakeFile);
      mockS3Repo.generatePresignedPutUrl.mockResolvedValueOnce({ ok: true, url: 'https://s3.put.url', key: fakeFile.key, bucket: 'b' });

      const payload = { filename: 'file.txt', contentType: 'text/plain', size: 123, purpose: 'avatar' };
      const res = await request(app).post('/storage/request-upload').send(payload).expect(201);

      expect(res.body.ok).toBe(true);
      expect(res.body.presign).toBeDefined();
      expect(res.body.presign.url).toBe('https://s3.put.url');
      expect(mockFileRepo.createFileRecord).toHaveBeenCalledTimes(1);
      expect(mockS3Repo.generatePresignedPutUrl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ contentType: 'text/plain' }));
      expect(mockAudit.logEvent).toHaveBeenCalled();
    });

    it('rejects when missing required fields', async () => {
      const res = await request(app).post('/storage/request-upload').send({ filename: 'x' }).expect(400);
      expect(res.body.ok).toBe(false);
      expect(mockFileRepo.createFileRecord).not.toHaveBeenCalled();
    });
  });

  describe('POST /storage/confirm', () => {
    it('confirms upload when S3 object exists and updates DB', async () => {
      const fileId = '60f1b2';
      const key = 'uploads/user-123-token-file.txt';
      const fileRecord = { _id: fileId, key, ownerId: 'user-123', status: 'pending' };
      mockFileRepo.getFileById.mockResolvedValueOnce(fileRecord);
      mockS3Repo.headObjectMeta.mockResolvedValueOnce({ ok: true, contentLength: 123, contentType: 'text/plain', metadata: {} });
      mockFileRepo.updateFile.mockResolvedValueOnce(Object.assign({}, fileRecord, { status: 'available', uploadedAt: Date.now() }));

      const res = await request(app).post('/storage/confirm').send({ fileId, key }).expect(200);

      expect(res.body.ok).toBe(true);
      expect(mockS3Repo.headObjectMeta).toHaveBeenCalledWith(key, expect.any(Object));
      expect(mockFileRepo.updateFile).toHaveBeenCalled();
      expect(mockJobs.enqueueProcessUploadedFile).toHaveBeenCalled();
    });

    it('marks failed and returns 404 when S3 object missing', async () => {
      const fileId = '60f1b2';
      const key = 'uploads/user-123-token-file.txt';
      const fileRecord = { _id: fileId, key, ownerId: 'user-123', status: 'pending' };
      mockFileRepo.getFileById.mockResolvedValueOnce(fileRecord);
      mockS3Repo.headObjectMeta.mockResolvedValueOnce({ ok: false, notFound: true });
      mockFileRepo.updateFile.mockResolvedValueOnce(Object.assign({}, fileRecord, { status: 'failed' }));

      const res = await request(app).post('/storage/confirm').send({ fileId, key }).expect(404);

      expect(res.body.ok).toBe(false);
      expect(mockFileRepo.updateFile).toHaveBeenCalledWith(fileId, expect.objectContaining({ status: 'failed' }));
    });

    it('rejects when actor is not owner', async () => {
      // override auth middleware to inject different user
      const app2 = makeApp();
      app2.use((req, res, next) => { req.__testUser = { userId: 'other-user', role: 'user' }; next(); });
      app2.use('/storage', storageRouter);

      const fileId = '60f1b2';
      const key = 'uploads/user-123-token-file.txt';
      const fileRecord = { _id: fileId, key, ownerId: 'user-123', status: 'pending' };
      mockFileRepo.getFileById.mockResolvedValueOnce(fileRecord);

      const res = await request(app2).post('/storage/confirm').send({ fileId, key }).expect(403);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('GET /storage/presign-download', () => {
    it('returns presigned GET for available file when owner requests', async () => {
      const file = { _id: '60f1b2', key: 'uploads/user-123-token-file.txt', ownerId: 'user-123', status: 'available' };
      mockFileRepo.getFileById.mockResolvedValueOnce(file);
      mockS3Repo.generatePresignedGetUrl.mockResolvedValueOnce({ ok: true, url: 'https://s3.get.url', key: file.key, bucket: 'b' });

      const res = await request(app).get('/storage/presign-download').query({ fileId: file._id }).expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.presign.url).toBe('https://s3.get.url');
      expect(mockS3Repo.generatePresignedGetUrl).toHaveBeenCalledWith(file.key, expect.any(Object));
    });

    it('rejects when file not available', async () => {
      const file = { _id: '60f1b2', key: 'uploads/user-123-token-file.txt', ownerId: 'user-123', status: 'pending' };
      mockFileRepo.getFileById.mockResolvedValueOnce(file);

      const res = await request(app).get('/storage/presign-download').query({ fileId: file._id }).expect(409);
      expect(res.body.ok).toBe(false);
    });

    it('rejects unauthorized user', async () => {
      // file owned by someone else
      const file = { _id: '60f1b2', key: 'uploads/other-123-token-file.txt', ownerId: 'other-123', status: 'available' };
      mockFileRepo.getFileById.mockResolvedValueOnce(file);

      const res = await request(app).get('/storage/presign-download').query({ fileId: file._id }).expect(403);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /storage/replace', () => {
    it('creates new pending record and returns presign', async () => {
      const oldFile = { _id: 'oldid', key: 'uploads/user-123-old.txt', ownerId: 'user-123', filename: 'old.txt', status: 'available' };
      const newFile = { _id: 'newid', key: 'uploads/user-123-new.txt', ownerId: 'user-123', filename: 'new.txt', status: 'pending' };
      mockFileRepo.getFileById.mockResolvedValueOnce(oldFile);
      mockFileRepo.createFileRecord.mockResolvedValueOnce(newFile);
      mockS3Repo.generatePresignedPutUrl.mockResolvedValueOnce({ ok: true, url: 'https://s3.put.new', key: newFile.key, bucket: 'b' });

      const res = await request(app).post('/storage/replace').send({ fileId: oldFile._id, newFilename: 'new.txt' }).expect(201);

      expect(res.body.ok).toBe(true);
      expect(res.body.presign).toBeDefined();
      expect(mockFileRepo.createFileRecord).toHaveBeenCalled();
    });

    it('rejects when actor not owner', async () => {
      const app2 = makeApp();
      app2.use((req, res, next) => { req.__testUser = { userId: 'other', role: 'user' }; next(); });
      app2.use('/storage', storageRouter);

      const oldFile = { _id: 'oldid', key: 'uploads/user-123-old.txt', ownerId: 'user-123', filename: 'old.txt', status: 'available' };
      mockFileRepo.getFileById.mockResolvedValueOnce(oldFile);

      const res = await request(app2).post('/storage/replace').send({ fileId: oldFile._id, newFilename: 'new.txt' }).expect(403);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('DELETE /storage/:id', () => {
    it('soft-deletes record and enqueues S3 deletion', async () => {
      const file = { _id: 'delid', key: 'uploads/user-123-del.txt', ownerId: 'user-123', status: 'available' };
      mockFileRepo.getFileById.mockResolvedValueOnce(file);
      mockFileRepo.markDeleted.mockResolvedValueOnce(Object.assign({}, file, { status: 'deleted' }));
      mockJobs.enqueueDeleteObject.mockResolvedValueOnce({});

      const res = await request(app).delete(`/storage/${file._id}`).expect(200);
      expect(res.body.ok).toBe(true);
      expect(mockFileRepo.markDeleted).toHaveBeenCalledWith(file._id, expect.any(Object));
      expect(mockJobs.enqueueDeleteObject).toHaveBeenCalledWith(expect.objectContaining({ key: file.key }));
    });

    it('rejects when not owner', async () => {
      const app2 = makeApp();
      app2.use((req, res, next) => { req.__testUser = { userId: 'other', role: 'user' }; next(); });
      app2.use('/storage', storageRouter);

      const file = { _id: 'delid', key: 'uploads/user-123-del.txt', ownerId: 'user-123', status: 'available' };
      mockFileRepo.getFileById.mockResolvedValueOnce(file);

      const res = await request(app2).delete(`/storage/${file._id}`).expect(403);
      expect(res.body.ok).toBe(false);
    });
  });
});
