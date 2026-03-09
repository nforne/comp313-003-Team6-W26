// tests/user.spec.js
//
// Integration-style tests for authentication routes.
// - Uses Jest + Supertest against an Express app that mounts the auth routes.
// - External dependencies (user repository / service) are mocked to keep tests deterministic.
// - Covers: register duplicate-email -> 409, login wrong password -> 401.
// - Run with: jest tests/user.spec.js

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

// Replace these paths with your actual modules
const authRoutes = require('../src/routes/auth.routes');
const userService = require('../src/services/user.service');

// Mock the user service used by auth routes to control behavior
jest.mock('../src/services/user.service');

describe('User auth flows', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(bodyParser.json());
    // mount auth routes under /auth
    app.use('/auth', authRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /auth/register -> duplicate email returns 409', async () => {
    // Arrange: simulate service throwing duplicate-email error
    const duplicateErr = new Error('Email already in use');
    duplicateErr.status = 409;
    userService.register.mockRejectedValueOnce(duplicateErr);

    // Act
    const res = await request(app)
      .post('/auth/register')
      .send({
        firstName: 'Alice',
        lastName: 'Example',
        email: 'alice@example.com',
        password: 'P@ssw0rd!'
      });

    // Assert
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      ok: false
    }));
    expect(userService.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com' }),
      expect.anything()
    );
  });

  test('POST /auth/login -> wrong password returns 401', async () => {
    // Arrange: simulate service throwing invalid credentials error
    const authErr = new Error('Invalid credentials');
    authErr.status = 401;
    userService.authenticate.mockRejectedValueOnce(authErr);

    // Act
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'bob@example.com',
        password: 'wrong-password'
      });

    // Assert
    expect(res.status).toBe(401);
    expect(res.body).toEqual(expect.objectContaining({
      ok: false
    }));
    expect(userService.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'bob@example.com' }),
      expect.anything()
    );
  });

  // Optional: example of a happy-path smoke test (uncomment if you want)
 
  test('POST /auth/register -> success returns 201 and tokens', async () => {
    const fakeUser = { userId: '0001', firstName: 'Sam' };
    userService.register.mockResolvedValueOnce(fakeUser);
    userService.authenticate.mockResolvedValueOnce({
      user: fakeUser,
      accessToken: 'access',
      refreshToken: 'refresh'
    });

    const res = await request(app)
      .post('/auth/register')
      .send({
        firstName: 'Sam',
        lastName: 'Smith',
        email: 'sam@example.com',
        password: 'StrongPass123'
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ ok: true }));
  });
  
});
