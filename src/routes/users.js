const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get current user profile
router.get('/profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(
    'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = result.rows[0];

  // If user is a driver, get driver-specific info
  if (user.role === 'driver') {
    const driverResult = await query(
      `SELECT d.*, v.license_plate, v.vehicle_make, v.vehicle_model
       FROM drivers d
       LEFT JOIN vehicles v ON d.id = v.driver_id
       WHERE d.user_id = $1`,
      [userId]
    );

    if (driverResult.rows.length > 0) {
      user.driverInfo = driverResult.rows[0];
    }
  }

  res.json({ user });
}));

// Update user profile
router.patch('/profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { name, phone } = req.body;

  const updateFields = [];
  const updateParams = [];
  let paramCount = 0;

  if (name) {
    updateFields.push(`name = $${++paramCount}`);
    updateParams.push(name);
  }
  if (phone) {
    updateFields.push(`phone = $${++paramCount}`);
    updateParams.push(phone);
  }

  if (updateFields.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  updateFields.push('updated_at = NOW()');
  updateParams.push(userId);

  const updateQuery = `
    UPDATE users
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount}
    RETURNING id, name, email, phone, role, created_at, updated_at
  `;

  const result = await query(updateQuery, updateParams);

  res.json({
    message: 'Profile updated successfully',
    user: result.rows[0]
  });
}));

// Get all users (admin only)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { role, limit = 50, offset = 0 } = req.query;

  let queryText = 'SELECT id, name, email, phone, role, created_at FROM users WHERE 1=1';
  const queryParams = [];
  let paramCount = 0;

  if (role) {
    queryText += ` AND role = $${++paramCount}`;
    queryParams.push(role);
  }

  queryText += ` ORDER BY created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
  queryParams.push(limit, offset);

  const result = await query(queryText, queryParams);

  res.json({
    users: result.rows,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: result.rows.length
    }
  });
}));

module.exports = router;
