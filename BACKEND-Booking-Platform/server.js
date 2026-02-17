// server.js
const createApp = require('./src/app');
const connectDB = require('./src/config/db');
const config = require('./src/config/env');

async function start() {
  try {
    await connectDB(config.mongoUri);

    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down server...');
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });

      // Force exit after timeout
      setTimeout(() => {
        console.error('Forcing shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
