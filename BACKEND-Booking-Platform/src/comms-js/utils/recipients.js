// src/comms-js/utils/recipients.js
//
// Recipient resolution and pagination helpers for comms-js.
// - resolveRecipients: lightweight decision helper used by engine to decide broadcast vs explicit list.
// - paginate: utility to split an array of ids into batches.
// - collectAllUserIds: convenience (caution: may load many ids into memory) using userRepo.streamAllUserIds.
// - paginateArray is exported for backward compatibility with engine.js import.

const userRepo = require('../../repositories/user.repo');

/**
 * resolveRecipients
 * - Inspect a Message document and return a small descriptor indicating how recipients should be handled.
 *
 * @param {Object} messageDoc - Mongoose Message document (may be lean)
 * @returns {Object} { mode: 'broadcast'|'list'|'none', ids: string[] }
 */
function resolveRecipients(messageDoc) {
  if (!messageDoc) return { mode: 'none', ids: [] };

  if (messageDoc.recipientsAll) {
    return { mode: 'broadcast', ids: [] };
  }

  if (Array.isArray(messageDoc.recipients) && messageDoc.recipients.length) {
    const ids = messageDoc.recipients.map(r => (typeof r === 'string' ? r : String(r)));
    return { mode: 'list', ids };
  }

  return { mode: 'none', ids: [] };
}

/**
 * paginate
 * - Split an array of ids into batches of given size.
 *
 * @param {string[]} ids
 * @param {number} size
 * @returns {string[][]}
 */
function paginate(ids = [], size = 10) {
  const s = Math.max(1, parseInt(size, 10) || 10);
  const out = [];
  for (let i = 0; i < ids.length; i += s) {
    out.push(ids.slice(i, i + s));
  }
  return out;
}

/**
 * collectAllUserIds
 * - Convenience helper that collects all userIds into an array by streaming the user repo.
 * - WARNING: may consume significant memory for large user bases. Prefer streaming in engine for broadcasts.
 *
 * @param {Object} [query={}] - optional Mongo query to filter users (e.g., { status: 'active' })
 * @param {Object} [options={}] - cursor options (e.g., { batchSize: 1000 })
 * @returns {Promise<string[]>}
 */
async function collectAllUserIds(query = {}, options = {}) {
  const ids = [];
  const cursor = userRepo.streamAllUserIds(query, { userId: 1, _id: 0 }, options);
  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    if (doc && doc.userId) ids.push(String(doc.userId));
  }
  return ids;
}

/* backward-compatible alias used by engine.js */
const paginateArray = paginate;

module.exports = {
  resolveRecipients,
  paginate,
  paginateArray,
  collectAllUserIds
};
