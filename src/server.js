const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

// Load environment variables
dotenv.config();

// Import database initialization
const { initDatabase } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const driverRoutes = require('./routes/drivers');
const rideRoutes = require('./routes/rides');
const paymentRoutes = require('./routes/payments');
const vehicleRoutes = require('./routes/vehicles');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:4200",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:4200",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'MediTransport Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/drivers', authenticateToken, driverRoutes);
app.use('/api/rides', authenticateToken, rideRoutes);
app.use('/api/payments', authenticateToken, paymentRoutes);
app.use('/api/vehicles', authenticateToken, vehicleRoutes);

// Socket.IO for real-time tracking
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join ride room for real-time updates
  socket.on('join-ride', (rideId) => {
    socket.join(`ride-${rideId}`);
    console.log(`User ${socket.id} joined ride room: ride-${rideId}`);
  });

  // Handle driver location updates
  socket.on('driver-location-update', (data) => {
    socket.to(`ride-${data.rideId}`).emit('location-update', {
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date().toISOString()
    });
  });

  // Handle ride status updates
  socket.on('ride-status-update', (data) => {
    socket.to(`ride-${data.rideId}`).emit('status-update', {
      status: data.status,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The requested route ${req.originalUrl} does not exist`
  });
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
const startServer = async () => {
  try {
    await initDatabase();

    server.listen(PORT, () => {
      console.log(`🚀 MediTransport Backend Server running on port ${PORT}`);
      console.log(`📡 Socket.IO server ready for real-time connections`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, io };
