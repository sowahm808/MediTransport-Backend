const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireDriver, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const vehicleSchema = Joi.object({
  licensePlate: Joi.string().required(),
  capacity: Joi.number().min(1).max(20).required(),
  vehicleMake: Joi.string().required(),
  vehicleModel: Joi.string().required(),
  vehicleYear: Joi.number().min(1990).max(new Date().getFullYear() + 1).required()
});

// Get all vehicles (admin) or driver's vehicle
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  let queryText;
  let queryParams;

  if (req.user.role === 'admin') {
    queryText = `
      SELECT v.*, d.user_id, u.name as driver_name
      FROM vehicles v
      JOIN drivers d ON v.driver_id = d.id
      JOIN users u ON d.user_id = u.id
      ORDER BY v.created_at DESC
    `;
    queryParams = [];
  } else if (req.user.role === 'driver') {
    const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
    if (driverResult.rows.length === 0) {
      throw new AppError('Driver record not found', 404);
    }

    queryText = `
      SELECT v.* FROM vehicles v
      WHERE v.driver_id = $1
    `;
    queryParams = [driverResult.rows[0].id];
  } else {
    throw new AppError('Access denied', 403);
  }

  const result = await query(queryText, queryParams);

  res.json({ vehicles: result.rows });
}));

// Add vehicle (driver only)
router.post('/', requireDriver, asyncHandler(async (req, res) => {
  const { error, value } = vehicleSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { licensePlate, capacity, vehicleMake, vehicleModel, vehicleYear } = value;
  const userId = req.user.id;

  // Get driver ID
  const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
  if (driverResult.rows.length === 0) {
    throw new AppError('Driver record not found', 404);
  }

  const driverId = driverResult.rows[0].id;

  // Check if driver already has a vehicle
  const existingVehicle = await query('SELECT id FROM vehicles WHERE driver_id = $1', [driverId]);
  if (existingVehicle.rows.length > 0) {
    throw new AppError('Driver already has a vehicle registered', 409);
  }

  // Create vehicle
  const result = await query(
    `INSERT INTO vehicles (driver_id, license_plate, capacity, vehicle_make, vehicle_model, vehicle_year, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [driverId, licensePlate, capacity, vehicleMake, vehicleModel, vehicleYear]
  );

  res.status(201).json({
    message: 'Vehicle added successfully',
    vehicle: result.rows[0]
  });
}));

// Update vehicle
router.patch('/:id', requireDriver, asyncHandler(async (req, res) => {
  const vehicleId = req.params.id;
  const userId = req.user.id;
  const { licensePlate, capacity, vehicleMake, vehicleModel, vehicleYear, availability } = req.body;

  // Get driver ID and verify ownership
  const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
  if (driverResult.rows.length === 0) {
    throw new AppError('Driver record not found', 404);
  }

  const driverId = driverResult.rows[0].id;

  // Verify vehicle belongs to driver
  const vehicleResult = await query(
    'SELECT * FROM vehicles WHERE id = $1 AND driver_id = $2',
    [vehicleId, driverId]
  );

  if (vehicleResult.rows.length === 0) {
    throw new AppError('Vehicle not found or access denied', 404);
  }

  // Build update query
  const updateFields = [];
  const updateParams = [];
  let paramCount = 0;

  if (licensePlate) {
    updateFields.push(`license_plate = $${++paramCount}`);
    updateParams.push(licensePlate);
  }
  if (capacity) {
    updateFields.push(`capacity = $${++paramCount}`);
    updateParams.push(capacity);
  }
  if (vehicleMake) {
    updateFields.push(`vehicle_make = $${++paramCount}`);
    updateParams.push(vehicleMake);
  }
  if (vehicleModel) {
    updateFields.push(`vehicle_model = $${++paramCount}`);
    updateParams.push(vehicleModel);
  }
  if (vehicleYear) {
    updateFields.push(`vehicle_year = $${++paramCount}`);
    updateParams.push(vehicleYear);
  }
  if (typeof availability === 'boolean') {
    updateFields.push(`availability = $${++paramCount}`);
    updateParams.push(availability);
  }

  if (updateFields.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  updateFields.push('updated_at = NOW()');
  updateParams.push(vehicleId);

  const updateQuery = `
    UPDATE vehicles
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount}
    RETURNING *
  `;

  const result = await query(updateQuery, updateParams);

  res.json({
    message: 'Vehicle updated successfully',
    vehicle: result.rows[0]
  });
}));

// Delete vehicle (admin only)
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const vehicleId = req.params.id;

  const result = await query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [vehicleId]);

  if (result.rows.length === 0) {
    throw new AppError('Vehicle not found', 404);
  }

  res.json({ message: 'Vehicle deleted successfully' });
}));

module.exports = router;
