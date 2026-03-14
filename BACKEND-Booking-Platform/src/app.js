// src/app.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const config = require('./config/env');

// route imports
const authRoutes = require('./routes/auth.routes');
const servicesRoutes = require('./routes/service.routes');
const requestsRoutes = require('./routes/request.routes');
const usersRoutes = require('./routes/user.routes');
const auditsRoutes = require('./routes/audit.routes');
const calendarRoutes = require('./routes/calendar.routes');
const bookingRoutes = require('./routes/booking.routes');
const messageRoutes = require('./routes/message.routes');
const biddingRoutes = require('./routes/bid.routes');
const s3storeRoutes = require('./routes/s3Storage.routes');
const reviewRoutes = require('./routes/review.routes');

const { s3Ensure } = require('./scripts/s3.ensure');

const errorMiddleware = require('./middleware/error.middleware');
const correlationMiddleware = require('./middleware/correlation.middleware');

const createApp = async () => {
  const app = express();

  // Trust proxy when behind a load balancer (adjust if not needed)
  if (config.trustProxy) app.set('trust proxy', 1);

  // Basic security and parsing
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Correlation ID middleware (must run early so controllers/services can use req.correlationId)
  app.use(correlationMiddleware);

  // Logging
  if (config.nodeEnv !== 'production') {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }

  // CORS
  app.use(cors({
    origin: config.clientUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'x-correlation-id'],
    credentials: true
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(limiter);

  // Ensure S3 bucket and baseline config before listening
  await s3Ensure({ logger: app.get('logger'), bucket: 'comp313-booking-platform', enableCors: false });

  // Health check
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // API routes (versioned)
  app.use('/api/auth', authRoutes);
  app.use('/api/svcs', servicesRoutes);
  app.use('/api/reqs', requestsRoutes);
  app.use('/api/bids', biddingRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/audts', auditsRoutes);
  app.use('/api/clder', calendarRoutes);
  app.use('/api/coms', messageRoutes);
  app.use('/api/bkns', bookingRoutes);
  app.use('/api/s3go', s3storeRoutes);
  app.use('/api/rvws', reviewRoutes);

  // 404 handler
  app.use((req, res, next) => {
    res.status(404).json({ success: false, error: 'Not Found' });
  });

  // Centralized error handler
  app.use(errorMiddleware);

  return app;
}

module.exports = createApp;
