// server.js
const createApp = require('./src/app');
const connectDB = require('./src/config/db');
const config = require('./src/config/env');

const start = async () => {
  try {
    await connectDB(config.mongoUri);

    // const seedIndex = require('./src/config/db-seeds/seed-db-models.index');
    // const summary = await seedIndex.run({ force: false, dryRun: false, logger: console });
    // console.log('Seed summary', summary);
    
    //--------------------------------------------------------------------------------------
    const mongoose = require('mongoose');
    const enableMongooseDebugLogging = require('./src/config/capture-mongoose-debug');

    const disableLogging = enableMongooseDebugLogging(mongoose); // starts logging to ./debug.txt

    // temporary debug: force all seeds and print full JSON
    const seedIndex = require('./src/config/db-seeds/seed-db-models.index');
    const summary = await seedIndex.run({ force: true, dryRun: false, logger: console });
    console.log(JSON.stringify(summary, null, 2));

    // write-debug.js
    const fs = require('fs');
    const path = require('path');

    function writeDebug(message) {
      const file = path.resolve(process.cwd(), 'debug.txt');
      const line = `${new Date().toISOString()} - ${message}\n`;
      fs.appendFileSync(file, line, { encoding: 'utf8' });
    }

    writeDebug(JSON.stringify(summary, null, 2))

    disableLogging();
    //--------------------------------------------------------------------------------------

    const app = await createApp();

    const server = app.listen(config.port, () => {
      console.log(`\n\nServer running in ${config.nodeEnv} mode on port ${config.port}`);
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
