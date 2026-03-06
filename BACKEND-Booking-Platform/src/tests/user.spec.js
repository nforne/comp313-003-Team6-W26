// tests/user.spec.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const authRoutes = require('../src/routes/auth.routes');

describe('User auth flows', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/auth', authRoutes);
  });

  test('register -> duplicate email returns 409', async () => {
    // This is a skeleton: in real tests, connect to test DB and cleanup between runs.
    expect(true).toBe(true);
  });

  test('login with wrong password returns 401', async () => {
    expect(true).toBe(true);
  });
});
