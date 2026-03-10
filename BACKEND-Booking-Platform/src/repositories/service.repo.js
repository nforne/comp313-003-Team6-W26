// src/repositories/service.repo.js
//
// Repository layer for Service model.
// - Thin persistence helpers: create, read, update, delete, and search.
// - Returns Mongoose documents (or arrays) and leaves projection/leaning to callers when needed.
// - All functions are async and throw on error; callers should handle errors and logging.
//
// Usage:
//   const repo = require('../repositories/service.repo');
//   await repo.createService({...});
//   const { results, total } = await repo.searchServices({ q: 'plumbing', page: 1 });

const Service = require('../models/service.model');

/**
 * createService
 * - Persist a new Service document.
 *
 * @param {Object} obj - Service payload matching the Service schema
 * @returns {Promise<Document>} saved Service document
 */
async function createService(obj) {
  const svc = new Service(obj);
  return svc.save();
}

/**
 * findByServiceId
 * - Find a service by its application-level serviceId.
 *
 * @param {string} serviceId
 * @returns {Promise<Document|null>}
 */
async function findByServiceId(serviceId) {
  if (!serviceId) return null;
  return Service.findOne({ serviceId }).exec();
}

/**
 * findByProviderAndName
 * - Find a service by providerId and name (useful to enforce uniqueness).
 *
 * @param {string} providerId
 * @param {string} name
 * @returns {Promise<Document|null>}
 */
async function findByProviderAndName(providerId, name) {
  if (!providerId || !name) return null;
  return Service.findOne({ providerId, name }).exec();
}

/**
 * updateByServiceId
 * - Partial update by serviceId. Automatically updates updatedAt timestamp.
 * - Returns the updated document.
 *
 * @param {string} serviceId
 * @param {Object} patch
 * @returns {Promise<Document|null>}
 */
async function updateByServiceId(serviceId, patch = {}) {
  if (!serviceId) throw new Error('serviceId is required');
  patch.updatedAt = Date.now();
  return Service.findOneAndUpdate({ serviceId }, { $set: patch }, { new: true }).exec();
}

/**
 * deleteByServiceId
 * - Permanently deletes a service document by serviceId.
 *
 * @param {string} serviceId
 * @returns {Promise<Document|null>} deleted document
 */
async function deleteByServiceId(serviceId) {
  if (!serviceId) return null;
  return Service.findOneAndDelete({ serviceId }).exec();
}

/**
 * searchServices
 * - Search active services with optional full-text query, category and location filters.
 * - Supports pagination.
 *
 * Behavior notes:
 * - When `q` is provided, a text search is performed and results are sorted by text score.
 * - `categories` may be an array of category strings; services matching any category are returned.
 * - `location` matches the `locations` array field exactly (adjust as needed for fuzzy matching).
 *
 * @param {Object} opts
 * @param {string} [opts.q] - full-text search string
 * @param {string[]} [opts.categories] - categories to filter by
 * @param {string} [opts.location] - location filter
 * @param {number} [opts.page=1] - 1-based page number
 * @param {number} [opts.pageSize=20] - page size
 * @returns {Promise<{ results: Document[], total: number, page: number, pageSize: number }>}
 */
async function searchServices({ q, categories, location, page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
  const skip = (p - 1) * ps;

  // Base filter: only active services by default
  const filter = { status: 'active' };

  if (Array.isArray(categories) && categories.length) {
    filter.categories = { $in: categories };
  }

  if (location) {
    // exact match against locations array; adapt to partial/fuzzy matching if needed
    filter.locations = location;
  }

  let query;
  let totalFilter = Object.assign({}, filter);

  if (q && String(q).trim()) {
    // Use MongoDB text search; include text score for sorting
    const search = String(q).trim();
    query = Service.find({ $text: { $search: search }, ...filter }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } });
    // When using text search, total should reflect text-matched documents
    totalFilter = { $text: { $search: search }, ...filter };
  } else {
    query = Service.find(filter).sort({ createdAt: -1 });
  }

  const results = await query.skip(skip).limit(ps).exec();
  const total = await Service.countDocuments(totalFilter).exec();

  return { results, total, page: p, pageSize: ps };
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  createService,
  findByServiceId,
  findByProviderAndName,
  updateByServiceId,
  deleteByServiceId,
  searchServices
};
