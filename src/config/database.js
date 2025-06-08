const { Pool } = require('pg');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// Database initialization script
const initDatabase = async () => {
  try {
    console.log('🔄 Initializing database schema...');

    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT UNIQUE,
        role TEXT CHECK (role IN ('patient', 'driver', 'admin')) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        license_number TEXT UNIQUE NOT NULL,
        vehicle_type TEXT CHECK (vehicle_type IN ('car', 'van', 'wheelchair-accessible', 'stretcher-enabled')),
        availability BOOLEAN DEFAULT TRUE,
        rating NUMERIC(3,2) DEFAULT 5.0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        driver_id INT REFERENCES drivers(id) ON DELETE CASCADE,
        license_plate TEXT UNIQUE NOT NULL,
        capacity INT NOT NULL,
        availability BOOLEAN DEFAULT TRUE,
        vehicle_make TEXT,
        vehicle_model TEXT,
        vehicle_year INT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rides (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        driver_id INT REFERENCES drivers(id) ON DELETE SET NULL,
        vehicle_id INT REFERENCES vehicles(id) ON DELETE SET NULL,
        start_location TEXT NOT NULL,
        end_location TEXT NOT NULL,
        start_latitude NUMERIC,
        start_longitude NUMERIC,
        end_latitude NUMERIC,
        end_longitude NUMERIC,
        ride_date TIMESTAMP NOT NULL,
        status TEXT CHECK (status IN ('pending', 'accepted', 'in-progress', 'completed', 'canceled')) DEFAULT 'pending',
        fare NUMERIC,
        distance NUMERIC,
        duration_minutes INT,
        special_requirements TEXT,
        emergency_contact TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        ride_id INT REFERENCES rides(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        method TEXT CHECK (method IN ('credit_card', 'debit_card', 'cash', 'insurance')),
        status TEXT CHECK (status IN ('pending', 'completed', 'failed', 'refunded')) DEFAULT 'pending',
        stripe_payment_intent_id TEXT,
        transaction_id TEXT,
        payment_date TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ride_tracking (
        id SERIAL PRIMARY KEY,
        ride_id INT REFERENCES rides(id) ON DELETE CASCADE,
        latitude NUMERIC NOT NULL,
        longitude NUMERIC NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        speed NUMERIC,
        heading NUMERIC
      );
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_drivers_availability ON drivers(availability);
      CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
      CREATE INDEX IF NOT EXISTS idx_rides_user_id ON rides(user_id);
      CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
      CREATE INDEX IF NOT EXISTS idx_payments_ride_id ON payments(ride_id);
      CREATE INDEX IF NOT EXISTS idx_ride_tracking_ride_id ON ride_tracking(ride_id);
    `);

    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

// Helper function to execute queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

module.exports = {
  pool,
  query,
  initDatabase
};
