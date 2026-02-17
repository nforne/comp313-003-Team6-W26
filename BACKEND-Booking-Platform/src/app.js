// src/app.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');

// route imports (placeholders; create these files as you implement)
const authRoutes = require('./routes/auth.routes');
const servicesRoutes = require('./routes/services.routes');
const availabilityRoutes = require('./routes/availability.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const adminRoutes = require('./routes/admin.routes');

const errorMiddleware = require('./middleware/error.middleware');

function createApp() {
  const app = express();

  // Basic security and parsing
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Logging
  if (config.nodeEnv !== 'production') {
    app.use(morgan('dev'));
  }

  // CORS
  app.use(cors({
    origin: config.clientUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(limiter);

  // Health check
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/services', servicesRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/admin', adminRoutes);

  // 404 handler
  app.use((req, res, next) => {
    res.status(404).json({ success: false, error: 'Not Found' });
  });

  // Centralized error handler
  app.use(errorMiddleware);

  return app;
}

module.exports = createApp;
