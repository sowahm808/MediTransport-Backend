const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'No token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists in database
    const result = await query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'User not found'
      });
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      name: result.rows[0].name
    };

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Invalid or expired token'
    });
  }
};

// Middleware to check if user has required role
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Required role: ${allowedRoles.join(' or ')}`
      });
    }

    next();
  };
};

// Middleware to check if user is admin
const requireAdmin = requireRole(['admin']);

// Middleware to check if user is driver
const requireDriver = requireRole(['driver', 'admin']);

// Middleware to check if user is patient or admin
const requirePatient = requireRole(['patient', 'admin']);

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireDriver,
  requirePatient
};
