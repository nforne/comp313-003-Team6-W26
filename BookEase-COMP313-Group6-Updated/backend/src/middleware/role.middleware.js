/**
 * @module middleware/role
 * @description Role-based access control middleware.
 * Restricts access to routes based on user roles.
 */

/**
 * Authorize specific roles.
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'provider', 'customer').
 * @returns {Function} Express middleware function.
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this resource`,
      });
    }

    next();
  };
};

module.exports = { authorize };
