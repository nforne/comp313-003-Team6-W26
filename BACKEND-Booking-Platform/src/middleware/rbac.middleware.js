// src/middleware/rbac.middleware.js
function requireRole(role) {
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ message: 'Forbidden' });
    return next();
  };
}

function requireAnyRole(roles = []) {
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
    return next();
  };
}

module.exports = { requireRole, requireAnyRole };
