// capture-mongoose-debug.js
// Minimal helper to capture mongoose debug output (and warnings) into debug.txt.
// Usage:
//   const mongoose = require('mongoose');
//   const enableMongooseDebugLogging = require('./capture-mongoose-debug');
//   const disable = enableMongooseDebugLogging(mongoose); // returns a disable() fn if you want to stop logging

const fs = require('fs');
const path = require('path');

function enableMongooseDebugLogging(mongoose, filePath = path.resolve(process.cwd(), 'debug.txt')) {
  // Ensure directory exists for the file (safe no-op if file is in cwd)
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch (e) {}

  const writeLine = (line) => {
    try {
      fs.appendFileSync(filePath, line + '\n', { encoding: 'utf8' });
    } catch (err) {
      // Best-effort: log to console if file write fails
      console.error('Failed to write debug log:', err && err.message ? err.message : err);
    }
  };

  // Custom mongoose debug function: coll, method, query, doc, options
  const debugFn = function (coll, method, query, doc, options) {
    const ts = new Date().toISOString();
    let q, d;
    try { q = JSON.stringify(query); } catch (e) { q = String(query); }
    try { d = JSON.stringify(doc); } catch (e) { d = String(doc); }
    const line = `${ts} - mongoose: ${coll}.${method} - query: ${q} - doc: ${d}`;
    writeLine(line);
  };

  mongoose.set('debug', debugFn);

  // Also capture console.warn (useful for mongoose warnings). Preserve original.
  const origWarn = console.warn;
  console.warn = function (...args) {
    try {
      const ts = new Date().toISOString();
      const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      writeLine(`${ts} - WARN - ${text}`);
    } catch (e) {}
    return origWarn.apply(console, args);
  };

  // Return a function to disable logging and restore console.warn
  return function disable() {
    try { mongoose.set('debug', false); } catch (e) {}
    try { console.warn = origWarn; } catch (e) {}
  };
}

module.exports = enableMongooseDebugLogging;

/* -------------------------
Example usage (in your debug script or server startup)
---------------------------

const mongoose = require('mongoose');
const enableMongooseDebugLogging = require('./capture-mongoose-debug');

const disableLogging = enableMongooseDebugLogging(mongoose); // starts logging to ./debug.txt

// ... run seeds, etc ...

// optionally stop logging later
// disableLogging();

*/
