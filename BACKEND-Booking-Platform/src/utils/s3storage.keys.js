// src/utils/s3storage.keys.js
//
// Helpers for generating and parsing canonical S3 object keys.
// - Keys are the single source of truth for stored objects.
// - Key format: {prefix}/{ownerId}-{timestamp}-{randHex}-{safeFilename}
// - Functions: makeObjectKey, safeFilename, timestampedKey, parseObjectKey
// - Keeps filenames safe (no path traversal, no control chars), limits length, and URL-encodes final filename.

const path = require('path');
const crypto = require('crypto');

const DEFAULT_PREFIX = process.env.STORAGE_PREFIX || 'uploads';
const MAX_FILENAME_LEN = 200; // keep room for other key parts

function _nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-'); // safe for keys
}

/**
 * safeFilename
 * - Strip path separators, control characters, and collapse whitespace.
 * - Truncate to MAX_FILENAME_LEN and URL-encode the result.
 * @param {string} filename
 * @returns {string}
 */
function safeFilename(filename = '') {
  let name = String(filename || '').trim();

  // Remove directory components
  name = path.basename(name);

  // Remove null bytes and control characters
  name = name.replace(/[\u0000-\u001F\u007F]/g, '');

  // Replace sequences of whitespace with single dash
  name = name.replace(/\s+/g, '-');

  // Replace any remaining slashes or backslashes (defensive)
  name = name.replace(/[\/\\]+/g, '-');

  // Collapse multiple dashes
  name = name.replace(/-+/g, '-');

  // Trim leading/trailing dashes
  name = name.replace(/^-+|-+$/g, '');

  // Truncate preserving extension if present
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const allowedBaseLen = Math.max(1, MAX_FILENAME_LEN - (ext ? ext.length : 0));
  const truncatedBase = base.length > allowedBaseLen ? base.slice(0, allowedBaseLen) : base;
  const finalName = (truncatedBase + (ext || '')).slice(0, MAX_FILENAME_LEN);

  // URL-encode to be safe for S3 keys
  return encodeURIComponent(finalName);
}

/**
 * timestampedKey
 * - Build a timestamp + random hex token for uniqueness.
 * @returns {string}
 */
function timestampedToken() {
  const ts = _nowIso();
  const rand = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  return `${ts}-${rand}`;
}

/**
 * makeObjectKey
 * - ownerId: string (required)
 * - filename: string (required)
 * - opts: { prefix, purpose, suffix } optional
 * - Returns normalized key without leading slash.
 */
function makeObjectKey(ownerId, filename, opts = {}) {
  if (!ownerId) throw new Error('ownerId required for object key');
  if (!filename) throw new Error('filename required for object key');

  const prefix = (opts.prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
  const purpose = opts.purpose ? String(opts.purpose).replace(/[^a-zA-Z0-9-_]/g, '') : null;
  const suffix = opts.suffix ? String(opts.suffix).replace(/[^a-zA-Z0-9-_.]/g, '') : null;

  const safeName = safeFilename(filename);
  const token = timestampedToken();

  // key parts: prefix / [purpose/] ownerId-token-safeFilename [ -suffix ]
  const purposePart = purpose ? `${purpose}/` : '';
  const suffixPart = suffix ? `-${suffix}` : '';

  const key = `${prefix}/${purposePart}${ownerId}-${token}-${safeName}${suffixPart}`;
  return key.replace(/^\/+/, '');
}

/**
 * parseObjectKey
 * - Basic parser to extract prefix, purpose (if present), ownerId, timestampToken, filename
 * - Returns { prefix, purpose, ownerId, token, filename, suffix } or null if not parseable
 */
function parseObjectKey(key) {
  if (!key) return null;
  const normalized = String(key).replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (parts.length < 2) return null;

  const prefix = parts[0];
  let purpose = null;
  let remainderParts = parts.slice(1);

  // If there are more than 2 parts, treat the second as purpose
  if (remainderParts.length > 1) {
    purpose = remainderParts[0];
    remainderParts = remainderParts.slice(1);
  }

  const remainder = remainderParts.join('/');
  // remainder expected: {ownerId}-{token}-{filename}[ -suffix ]
  const match = remainder.match(/^([^-]+)-([0-9T\-\:Z\.]+-[0-9a-f]{12})-([^]+)$/);
  if (!match) {
    // fallback: try split by first two dashes
    const idx1 = remainder.indexOf('-');
    const idx2 = remainder.indexOf('-', idx1 + 1);
    if (idx1 === -1 || idx2 === -1) return { prefix, purpose, raw: remainder };
    const ownerId = remainder.slice(0, idx1);
    const token = remainder.slice(idx1 + 1, idx2);
    const filename = remainder.slice(idx2 + 1);
    return { prefix, purpose, ownerId, token, filename };
  }

  const ownerId = match[1];
  const token = match[2];
  const filename = match[3];

  return { prefix, purpose, ownerId, token, filename };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  makeObjectKey,
  safeFilename,
  timestampedToken,
  parseObjectKey,
  DEFAULT_PREFIX
};
