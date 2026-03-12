// src/middleware/auth.middleware.js
const { verifyAccess } = require('../utils/jwt.helper');

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = verifyAccess(token);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

/**
 * optionalAuth
 * - If a Bearer token is present, verifies it and attaches req.user.
 * - If no token or token invalid, continues without failing (req.user left undefined).
 * - Non-disruptive: does not change requireAuth behavior.
 */
function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccess(token);
    req.user = payload;
  } catch (err) {
    // token invalid or expired — do not block the request; leave req.user undefined
    req.user = undefined;
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
