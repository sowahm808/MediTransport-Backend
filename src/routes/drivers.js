const express = require('express');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireAdmin, requireDriver } = require('../middleware/auth');

const router = express.Router();

// Get available drivers
router.get('/available', asyncHandler(async (req, res) => {
  const { vehicleType } = req.query;

  let queryText = `
    SELECT
      d.id, d.user_id, d.license_number, d.vehicle_type, d.availability, d.rating,
      u.name, u.email, u.phone,
      v.license_plate, v.vehicle_make, v.vehicle_model, v.capacity
    FROM drivers d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN vehicles v ON d.id = v.driver_id
    WHERE d.availability = true
  `;

  const queryParams = [];
  let paramCount = 0;

  if (vehicleType) {
    queryText += ` AND d.vehicle_type = $${++paramCount}`;
    queryParams.push(vehicleType);
  }

  queryText += ' ORDER BY d.rating DESC, d.id';

  const result = await query(queryText, queryParams);

  res.json({ drivers: result.rows });
}));

// Update driver availability
router.patch('/availability', requireDriver, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { availability } = req.body;

  if (typeof availability !== 'boolean') {
    throw new AppError('Availability must be true or false', 400);
  }

  const result = await query(
    'UPDATE drivers SET availability = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
    [availability, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Driver record not found', 404);
  }

  res.json({
    message: 'Availability updated successfully',
    driver: result.rows[0]
  });
}));

// Get driver statistics
router.get('/stats', requireDriver, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Get driver ID
  const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
  if (driverResult.rows.length === 0) {
    throw new AppError('Driver record not found', 404);
  }

  const driverId = driverResult.rows[0].id;

  // Get ride statistics
  const statsResult = await query(
    `SELECT
      COUNT(*) as total_rides,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides,
      COUNT(CASE WHEN status = 'canceled' THEN 1 END) as canceled_rides,
      AVG(CASE WHEN status = 'completed' THEN fare END) as average_fare,
      SUM(CASE WHEN status = 'completed' THEN fare END) as total_earnings
    FROM rides
    WHERE driver_id = $1`,
    [driverId]
  );

  const stats = statsResult.rows[0];

  res.json({ stats });
}));

module.exports = router;
