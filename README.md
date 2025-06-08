# MediTransport Backend API

A comprehensive Node.js backend for the Medical Transportation app, providing secure APIs for ride booking, driver management, real-time tracking, and payment processing.

## 🚀 Features

- **User Authentication**: JWT-based authentication with role-based access control
- **Ride Management**: Complete ride booking, assignment, and tracking system
- **Real-time Tracking**: Socket.IO integration for live location updates
- **Payment Processing**: Stripe integration for secure payments
- **Driver Management**: Driver registration, availability, and statistics
- **Vehicle Management**: Vehicle registration and management
- **Admin Dashboard**: Administrative features for system management

## 🏗 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: JWT (JSON Web Tokens)
- **Payment**: Stripe
- **Real-time**: Socket.IO
- **Validation**: Joi
- **Security**: Helmet, CORS

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/sowahm808/MediTransport-Backend.git
cd MediTransport-Backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/meditransport

# JWT
JWT_SECRET=your_super_secret_jwt_key
JWT_REFRESH_SECRET=your_refresh_secret

# Stripe
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Other configurations...
```

4. Set up PostgreSQL database:
```bash
# Create database
createdb meditransport

# The application will automatically create tables on first run
```

5. Start the development server:
```bash
npm run dev
```

## 🗄 Database Schema

### Users Table
- `id` (TEXT, PRIMARY KEY) - UUID
- `name` (TEXT) - User's full name
- `email` (TEXT, UNIQUE) - Email address
- `phone` (TEXT) - Phone number
- `role` (TEXT) - 'patient', 'driver', or 'admin'
- `created_at`, `updated_at` (TIMESTAMP)

### Drivers Table
- `id` (SERIAL, PRIMARY KEY)
- `user_id` (TEXT, FK to users)
- `license_number` (TEXT, UNIQUE)
- `vehicle_type` (TEXT) - Type of vehicle
- `availability` (BOOLEAN)
- `rating` (NUMERIC)

### Rides Table
- `id` (SERIAL, PRIMARY KEY)
- `user_id` (TEXT, FK to users)
- `driver_id` (INT, FK to drivers)
- `start_location`, `end_location` (TEXT)
- `ride_date` (TIMESTAMP)
- `status` (TEXT) - 'pending', 'accepted', 'in-progress', 'completed', 'canceled'
- `fare` (NUMERIC)
- `special_requirements` (TEXT)

### Additional Tables
- `vehicles` - Vehicle information
- `payments` - Payment records with Stripe integration
- `ride_tracking` - Real-time location tracking

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/verify` - Verify token

### Users
- `GET /api/users/profile` - Get current user profile
- `PATCH /api/users/profile` - Update user profile
- `GET /api/users` - Get all users (admin only)

### Rides
- `GET /api/rides` - Get user's rides
- `POST /api/rides` - Create new ride booking
- `GET /api/rides/:id` - Get specific ride details
- `PATCH /api/rides/:id` - Update ride status
- `POST /api/rides/:id/assign` - Assign driver to ride
- `GET /api/rides/:id/tracking` - Get ride tracking data
- `POST /api/rides/:id/tracking` - Add tracking point

### Drivers
- `GET /api/drivers/available` - Get available drivers
- `PATCH /api/drivers/availability` - Update driver availability
- `GET /api/drivers/stats` - Get driver statistics

### Vehicles
- `GET /api/vehicles` - Get vehicles
- `POST /api/vehicles` - Add new vehicle
- `PATCH /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Delete vehicle

### Payments
- `POST /api/payments/create-intent` - Create payment intent
- `POST /api/payments/confirm/:id` - Confirm payment
- `GET /api/payments/history` - Get payment history
- `POST /api/payments/webhook` - Stripe webhook

## 🔐 Authentication & Authorization

The API uses JWT tokens for authentication with role-based access control:

- **Patient**: Can book rides, view their own rides, make payments
- **Driver**: Can view assigned rides, update ride status, manage availability
- **Admin**: Full access to all features

### Making Authenticated Requests

Include the JWT token in the Authorization header:
```javascript
headers: {
  'Authorization': 'Bearer your_jwt_token_here'
}
```

## 🌐 Real-time Features

Socket.IO events for real-time communication:

### Client Events (send to server)
- `join-ride` - Join a ride room for updates
- `driver-location-update` - Send location update (drivers)
- `ride-status-update` - Update ride status

### Server Events (receive from server)
- `location-update` - Real-time location updates
- `status-update` - Ride status changes

### Example Usage
```javascript
// Join ride room
socket.emit('join-ride', rideId);

// Listen for location updates
socket.on('location-update', (data) => {
  console.log('Driver location:', data.latitude, data.longitude);
});

// Send location update (driver)
socket.emit('driver-location-update', {
  rideId: 123,
  latitude: 40.7128,
  longitude: -74.0060
});
```

## 💳 Payment Integration

Stripe integration for secure payment processing:

1. Create payment intent
2. Process payment on frontend
3. Confirm payment via webhook
4. Update ride status automatically

## 🧪 Testing

Run tests:
```bash
npm test
```

## 🚀 Deployment

### Environment Variables for Production
```env
NODE_ENV=production
DATABASE_URL=your_production_db_url
JWT_SECRET=your_production_jwt_secret
STRIPE_SECRET_KEY=your_live_stripe_key
```

### Deploy to Heroku
```bash
# Login to Heroku
heroku login

# Create app
heroku create meditransport-backend

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set DATABASE_URL=your_db_url

# Deploy
git push heroku main
```

## 📝 API Documentation

For detailed API documentation with request/response examples, visit:
`http://localhost:3000/health` for health check

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Create an issue in this repository
- Email: support@meditransport.com

---

## 🔧 Development Notes

### Database Migrations
The application automatically creates tables on startup. For production, consider using proper migration tools.

### Error Handling
Comprehensive error handling with custom error classes and middleware.

### Security
- Helmet for security headers
- CORS configuration
- JWT token validation
- Input validation with Joi
- SQL injection prevention

### Performance
- Database connection pooling
- Proper indexing
- Query optimization
- Pagination support
