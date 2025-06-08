const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const createRideSchema = Joi.object({
  startLocation: Joi.string().required(),
  endLocation: Joi.string().required(),
  startLatitude: Joi.number().min(-90).max(90).optional(),
  startLongitude: Joi.number().min(-180).max(180).optional(),
  endLatitude: Joi.number().min(-90).max(90).optional(),
  endLongitude: Joi.number().min(-180).max(180).optional(),
  rideDate: Joi.date().iso().min('now').required(),
  specialRequirements: Joi.string().max(500).optional(),
  emergencyContact: Joi.string().optional(),
  vehicleType: Joi.string().valid('car', 'van', 'wheelchair-accessible', 'stretcher-enabled').optional()
});

const updateRideSchema = Joi.object({
  status: Joi.string().valid('pending', 'accepted', 'in-progress', 'completed', 'canceled').optional(),
  fare: Joi.number().min(0).optional(),
  distance: Joi.number().min(0).optional(),
  durationMinutes: Joi.number().min(0).optional()
});

// Get all rides for current user
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { status, limit = 20, offset = 0 } = req.query;

  let queryText = `
    SELECT
      r.*,
      u.name as patient_name,
      u.email as patient_email,
      d.user_id as driver_user_id,
      du.name as driver_name,
      v.license_plate,
      v.vehicle_make,
      v.vehicle_model
    FROM rides r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN drivers d ON r.driver_id = d.id
    LEFT JOIN users du ON d.user_id = du.id
    LEFT JOIN vehicles v ON r.vehicle_id = v.id
    WHERE 1=1
  `;

  const queryParams = [];
  let paramCount = 0;

  // Filter based on user role
  if (req.user.role === 'patient') {
    queryText += ` AND r.user_id = $${++paramCount}`;
    queryParams.push(userId);
  } else if (req.user.role === 'driver') {
    // Get driver record for current user
    const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
    if (driverResult.rows.length > 0) {
      queryText += ` AND r.driver_id = $${++paramCount}`;
      queryParams.push(driverResult.rows[0].id);
    }
  }
  // Admin can see all rides

  if (status) {
    queryText += ` AND r.status = $${++paramCount}`;
    queryParams.push(status);
  }

  queryText += ` ORDER BY r.created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
  queryParams.push(limit, offset);

  const result = await query(queryText, queryParams);

  res.json({
    rides: result.rows,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: result.rows.length
    }
  });
}));

// Get specific ride by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const rideId = req.params.id;
  const userId = req.user.id;

  let queryText = `
    SELECT
      r.*,
      u.name as patient_name,
      u.email as patient_email,
      u.phone as patient_phone,
      d.user_id as driver_user_id,
      du.name as driver_name,
      du.phone as driver_phone,
      d.license_number,
      d.rating as driver_rating,
      v.license_plate,
      v.vehicle_make,
      v.vehicle_model,
      v.capacity
    FROM rides r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN drivers d ON r.driver_id = d.id
    LEFT JOIN users du ON d.user_id = du.id
    LEFT JOIN vehicles v ON r.vehicle_id = v.id
    WHERE r.id = $1
  `;

  const queryParams = [rideId];

  // Add permission check based on role
  if (req.user.role === 'patient') {
    queryText += ` AND r.user_id = $2`;
    queryParams.push(userId);
  } else if (req.user.role === 'driver') {
    const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [userId]);
    if (driverResult.rows.length > 0) {
      queryText += ` AND r.driver_id = $2`;
      queryParams.push(driverResult.rows[0].id);
    }
  }

  const result = await query(queryText, queryParams);

  if (result.rows.length === 0) {
    throw new AppError('Ride not found', 404);
  }

  res.json({ ride: result.rows[0] });
}));

// Create new ride (patients only)
router.post('/', requireRole(['patient', 'admin']), asyncHandler(async (req, res) => {
  const { error, value } = createRideSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const {
    startLocation,
    endLocation,
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude,
    rideDate,
    specialRequirements,
    emergencyContact,
    vehicleType
  } = value;

  const userId = req.user.id;

  // Calculate estimated fare (simplified calculation)
  let estimatedFare = 15.0; // Base fare
  if (startLatitude && startLongitude && endLatitude && endLongitude) {
    const distance = calculateDistance(
      startLatitude, startLongitude,
      endLatitude, endLongitude
    );
    estimatedFare += distance * 2.5; // $2.50 per mile
  }

  const result = await query(
    `INSERT INTO rides (
      user_id, start_location, end_location, start_latitude, start_longitude,
      end_latitude, end_longitude, ride_date, fare, special_requirements,
      emergency_contact, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    RETURNING *`,
    [
      userId, startLocation, endLocation, startLatitude, startLongitude,
      endLatitude, endLongitude, rideDate, estimatedFare, specialRequirements,
      emergencyContact
    ]
  );

  const ride = result.rows[0];

  // Find available drivers (simplified matching)
  if (vehicleType) {
    const availableDrivers = await query(
      `SELECT d.id, d.user_id, du.name, d.vehicle_type, d.rating
       FROM drivers d
       JOIN users du ON d.user_id = du.id
       WHERE d.availability = true
       AND d.vehicle_type = $1
       ORDER BY d.rating DESC
       LIMIT 5`,
      [vehicleType]
    );

    ride.availableDrivers = availableDrivers.rows;
  }

  res.status(201).json({
    message: 'Ride created successfully',
    ride
  });
}));

// Update ride status (drivers and admins)
router.patch('/:id', requireRole(['driver', 'admin']), asyncHandler(async (req, res) => {
  const rideId = req.params.id;
  const { error, value } = updateRideSchema.validate(req.body);

  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { status, fare, distance, durationMinutes } = value;

  // Check if ride exists and user has permission
  let permissionQuery = 'SELECT * FROM rides WHERE id = $1';
  const permissionParams = [rideId];

  if (req.user.role === 'driver') {
    const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [req.user.id]);
    if (driverResult.rows.length > 0) {
      permissionQuery += ' AND driver_id = $2';
      permissionParams.push(driverResult.rows[0].id);
    }
  }

  const rideCheck = await query(permissionQuery, permissionParams);
  if (rideCheck.rows.length === 0) {
    throw new AppError('Ride not found or no permission', 404);
  }

  // Build update query dynamically
  const updateFields = [];
  const updateParams = [];
  let paramCount = 0;

  if (status !== undefined) {
    updateFields.push(`status = $${++paramCount}`);
    updateParams.push(status);
  }
  if (fare !== undefined) {
    updateFields.push(`fare = $${++paramCount}`);
    updateParams.push(fare);
  }
  if (distance !== undefined) {
    updateFields.push(`distance = $${++paramCount}`);
    updateParams.push(distance);
  }
  if (durationMinutes !== undefined) {
    updateFields.push(`duration_minutes = $${++paramCount}`);
    updateParams.push(durationMinutes);
  }

  updateFields.push(`updated_at = NOW()`);
  updateParams.push(rideId);

  const updateQuery = `
    UPDATE rides
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount}
    RETURNING *
  `;

  const result = await query(updateQuery, updateParams);

  res.json({
    message: 'Ride updated successfully',
    ride: result.rows[0]
  });
}));

// Assign driver to ride (admins or auto-assignment)
router.post('/:id/assign', requireRole(['admin']), asyncHandler(async (req, res) => {
  const rideId = req.params.id;
  const { driverId } = req.body;

  if (!driverId) {
    throw new AppError('Driver ID is required', 400);
  }

  // Check if ride exists and is pending
  const rideResult = await query(
    'SELECT * FROM rides WHERE id = $1 AND status = $2',
    [rideId, 'pending']
  );

  if (rideResult.rows.length === 0) {
    throw new AppError('Ride not found or not available for assignment', 404);
  }

  // Check if driver is available
  const driverResult = await query(
    `SELECT d.*, v.id as vehicle_id FROM drivers d
     LEFT JOIN vehicles v ON d.id = v.driver_id
     WHERE d.id = $1 AND d.availability = true`,
    [driverId]
  );

  if (driverResult.rows.length === 0) {
    throw new AppError('Driver not found or not available', 404);
  }

  const driver = driverResult.rows[0];

  // Assign driver and vehicle to ride
  const updateResult = await query(
    `UPDATE rides
     SET driver_id = $1, vehicle_id = $2, status = 'accepted', updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [driverId, driver.vehicle_id, rideId]
  );

  res.json({
    message: 'Driver assigned successfully',
    ride: updateResult.rows[0]
  });
}));

// Get ride tracking data
router.get('/:id/tracking', asyncHandler(async (req, res) => {
  const rideId = req.params.id;

  // Check if user has permission to view this ride
  let permissionQuery = `
    SELECT r.id FROM rides r
    WHERE r.id = $1 AND (r.user_id = $2
  `;
  const permissionParams = [rideId, req.user.id];

  if (req.user.role === 'driver') {
    const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [req.user.id]);
    if (driverResult.rows.length > 0) {
      permissionQuery += ' OR r.driver_id = $3';
      permissionParams.push(driverResult.rows[0].id);
    }
  }

  permissionQuery += ')';

  const permissionCheck = await query(permissionQuery, permissionParams);
  if (permissionCheck.rows.length === 0 && req.user.role !== 'admin') {
    throw new AppError('No permission to view this ride tracking', 403);
  }

  // Get tracking data
  const trackingResult = await query(
    `SELECT * FROM ride_tracking
     WHERE ride_id = $1
     ORDER BY timestamp DESC
     LIMIT 50`,
    [rideId]
  );

  res.json({
    rideId,
    tracking: trackingResult.rows
  });
}));

// Add tracking point (drivers only)
router.post('/:id/tracking', requireRole(['driver']), asyncHandler(async (req, res) => {
  const rideId = req.params.id;
  const { latitude, longitude, speed, heading } = req.body;

  if (!latitude || !longitude) {
    throw new AppError('Latitude and longitude are required', 400);
  }

  // Verify driver is assigned to this ride
  const driverResult = await query('SELECT id FROM drivers WHERE user_id = $1', [req.user.id]);
  if (driverResult.rows.length === 0) {
    throw new AppError('Driver record not found', 404);
  }

  const rideCheck = await query(
    'SELECT id FROM rides WHERE id = $1 AND driver_id = $2',
    [rideId, driverResult.rows[0].id]
  );

  if (rideCheck.rows.length === 0) {
    throw new AppError('Ride not found or not assigned to you', 404);
  }

  // Add tracking point
  await query(
    `INSERT INTO ride_tracking (ride_id, latitude, longitude, speed, heading, timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [rideId, latitude, longitude, speed, heading]
  );

  res.json({ message: 'Tracking point added successfully' });
}));

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = router;
