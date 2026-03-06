// tests/request.spec.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const reqRoutes = require('../src/routes/requests.routes');

describe('Request model flows', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(bodyParser.json());
    app.use('/reqs', reqRoutes);
  });

  test('create request by customer (skeleton)', async () => {
    // Real tests should mock auth middleware and connect to test DB
    expect(true).toBe(true);
  });

  test('search open requests (skeleton)', async () => {
    expect(true).toBe(true);
  });
});
