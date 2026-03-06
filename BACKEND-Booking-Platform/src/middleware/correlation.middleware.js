// src/middleware/correlation.middleware.js
const { v4: uuidv4 } = require('uuid');

function correlationId(req, res, next) {
  const header = req.headers['x-correlation-id'];
  req.correlationId = header || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

module.exports = correlationId;
