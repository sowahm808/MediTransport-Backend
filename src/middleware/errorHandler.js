// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error Stack:', err.stack);

  // Default error response
  let error = {
    message: err.message || 'Internal Server Error',
    status: err.statusCode || 500
  };

  // Handle different types of errors
  if (err.name === 'ValidationError') {
    error.status = 400;
    error.message = 'Validation Error';
    error.details = err.details;
  }

  if (err.name === 'UnauthorizedError') {
    error.status = 401;
    error.message = 'Unauthorized Access';
  }

  if (err.code === '23505') { // PostgreSQL unique violation
    error.status = 409;
    error.message = 'Resource already exists';
  }

  if (err.code === '23503') { // PostgreSQL foreign key violation
    error.status = 400;
    error.message = 'Invalid reference to related resource';
  }

  if (err.code === '23502') { // PostgreSQL not null violation
    error.status = 400;
    error.message = 'Required field is missing';
  }

  // Don't expose error details in production
  const response = {
    error: error.message,
    status: error.status,
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.details = error.details;
  }

  res.status(error.status).json(response);
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  errorHandler,
  asyncHandler,
  AppError
};
