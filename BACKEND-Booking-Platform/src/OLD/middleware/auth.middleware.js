// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User.model');

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: 'No token provided' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // attach minimal user info; avoid fetching full user for performance unless needed
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = verifyToken;
