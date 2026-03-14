// src/config/env.js
const dotenv = require('dotenv');
const path = require('path');

const envPath = process.env.NODE_ENV === 'test'
  ? path.resolve(process.cwd(), '.env.test')
  : path.resolve(process.cwd(), '.env');

dotenv.config({ path: envPath });

const required = [
  'PORT',
  'MONGO_URI',
  'JWT_SECRET'
];

const missing = required.filter((k) => !process.env[k]);

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongo_connection_string',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || '*'
};

module.exports = config;