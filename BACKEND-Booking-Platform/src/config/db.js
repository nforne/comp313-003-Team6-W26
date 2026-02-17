// src/config/db.js
const mongoose = require('mongoose');

async function connectDB(mongoUri, options = {}) {
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to connect to the database');
  }

  const defaultOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // keep other options minimal; Mongoose manages pooling
  };

  try {
    await mongoose.connect(mongoUri, { ...defaultOptions, ...options });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

module.exports = connectDB;
