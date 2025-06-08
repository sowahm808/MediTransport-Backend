const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  phone: Joi.string().pattern(/^\+?[\d\s-()]+$/).optional(),
  role: Joi.string().valid('patient', 'driver', 'admin').default('patient'),
  // Driver-specific fields
  licenseNumber: Joi.when('role', {
    is: 'driver',
    then: Joi.string().required(),
    otherwise: Joi.forbidden()
  }),
  vehicleType: Joi.when('role', {
    is: 'driver',
    then: Joi.string().valid('car', 'van', 'wheelchair-accessible', 'stretcher-enabled').required(),
    otherwise: Joi.forbidden()
  })
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Helper function to generate JWT tokens
const generateTokens = (user) => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });

  return { accessToken, refreshToken };
};

// Register new user
router.post('/register', asyncHandler(async (req, res) => {
  // Validate request body
  const { error, value } = registerSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { name, email, password, phone, role, licenseNumber, vehicleType } = value;

  // Check if user already exists
  const existingUser = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new AppError('User with this email already exists', 409);
  }

  // Hash password
  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Generate unique user ID
  const userId = uuidv4();

  try {
    // Begin transaction
    await query('BEGIN');

    // Create user with hashed password
    await query(
      `INSERT INTO users (id, name, email, password, phone, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, name, email, hashedPassword, phone, role]
    );

    // If registering as driver, create driver record
    if (role === 'driver') {
      await query(
        `INSERT INTO drivers (user_id, license_number, vehicle_type, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, licenseNumber, vehicleType]
      );
    }

    // Commit transaction
    await query('COMMIT');

    // Get complete user data
    const userResult = await query(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.created_at
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (dbError) {
    await query('ROLLBACK');
    console.error('Registration error:', dbError);
    throw new AppError('Registration failed', 500);
  }
}));

// Login user
router.post('/login', asyncHandler(async (req, res) => {
  // Validate request body
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { email, password } = value;

  // Retrieve user including hashed password
  const userResult = await query(
    'SELECT id, name, email, phone, role, password, created_at FROM users WHERE email = $1',
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const user = userResult.rows[0];

  // Validate password using bcrypt hash
  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user);

  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.created_at
    },
    tokens: {
      accessToken,
      refreshToken
    }
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Verify user still exists
    const userResult = await query(
      'SELECT id, name, email, phone, role FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found', 401);
    }

    const user = userResult.rows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    res.json({
      message: 'Token refreshed successfully',
      tokens: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (error) {
    throw new AppError('Invalid refresh token', 401);
  }
}));

// Logout (client-side token removal, server-side blacklisting could be added)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Verify token endpoint
router.get('/verify', asyncHandler(async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    throw new AppError('No token provided', 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get current user data
    const userResult = await query(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found', 401);
    }

    res.json({
      valid: true,
      user: userResult.rows[0]
    });

  } catch (error) {
    throw new AppError('Invalid token', 401);
  }
}));

module.exports = router;
