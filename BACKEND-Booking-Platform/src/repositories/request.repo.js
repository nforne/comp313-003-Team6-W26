// src/repositories/request.repo.js
const Request = require('../models/request.model');

async function createRequest(obj) {
  const r = new Request(obj);
  return r.save();
}

async function findById(id) {
  return Request.findById(id).populate('bids').exec();
}

async function updateById(id, patch) {
  patch.updatedAt = Date.now();
  return Request.findByIdAndUpdate(id, { $set: patch }, { new: true }).populate('bids').exec();
}

async function searchOpenRequests({ categories, location, near, radiusMeters = 50000, page = 1, pageSize = 20 }) {
  const filter = { status: 'active' };
  if (categories && categories.length) filter.categories = { $in: categories };
  if (location) filter.locations = location;
  let query = Request.find(filter).sort({ createdAt: -1 });
  if (near && Array.isArray(near) && near.length === 2) {
    query = Request.find({
      ...filter,
      geo: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: near },
          $maxDistance: radiusMeters
        }
      }
    });
  }
  const skip = (page - 1) * pageSize;
  const results = await query.skip(skip).limit(pageSize).exec();
  const total = await Request.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

module.exports = { createRequest, findById, updateById, searchOpenRequests };
