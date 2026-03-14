// src/config/db.js
// Compact connector: prefer modern Mongoose usage, fallback to legacy flags once.

const mongoose = require('mongoose');
// mongoose.set('debug', true);

function sanitizeUri(uri) {
  if (!uri || typeof uri !== 'string') return uri;
  const [base, query] = uri.split('?');
  if (!query) return uri;
  const params = query.split('&').filter(p => {
    const k = p.split('=')[0].toLowerCase();
    return k !== 'usenewurlparser' && k !== 'useunifiedtopology';
  });
  return params.length ? `${base}?${params.join('&')}` : base;
}

async function connectDB(mongoUri, options = {}) {
  const raw = mongoUri || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!raw) throw new Error('MONGO_URI is required');

  const modernUri = sanitizeUri(raw);
  const modernOpts = Object.assign({ serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, family: 4 }, options);
  const legacyOpts = Object.assign({}, modernOpts, { useNewUrlParser: true, useUnifiedTopology: true });

  // If already connected or connecting, return existing connection
  const state = mongoose.connection.readyState;
  if (state === 1) return mongoose.connection;
  if (state === 2) {
    await new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onErr = e => { cleanup(); reject(e); };
      function cleanup() { mongoose.connection.off('open', onOpen); mongoose.connection.off('error', onErr); }
      mongoose.connection.on('open', onOpen);
      mongoose.connection.on('error', onErr);
    });
    return mongoose.connection;
  }

  // Try modern first
  try {
    await mongoose.connect(modernUri, modernOpts);
    console.log('MongoDB connected (modern)');
    return mongoose.connection;
  } catch (err) {
    const msg = (err && err.message || '').toLowerCase();
    const needsLegacy = msg.includes('usenewurlparser') || msg.includes('useunifiedtopology') || err.name === 'MongoParseError';
    if (!needsLegacy) throw err;
    // Retry once with legacy-compatible options using the original URI
    try {
      await mongoose.connect(raw, legacyOpts);
      console.log('MongoDB connected (legacy fallback)');
      return mongoose.connection;
    } catch (err2) {
      console.error('MongoDB connection error:', err2 && err2.message ? err2.message : err2);
      throw err2;
    }
  }
}

module.exports = connectDB;
