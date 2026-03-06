// src/repositories/service.repo.js
const Service = require('../models/service.model');

async function createService(obj) {
  const svc = new Service(obj);
  return svc.save();
}

async function findByServiceId(serviceId) {
  return Service.findOne({ serviceId }).exec();
}

async function findByProviderAndName(providerId, name) {
  return Service.findOne({ providerId, name }).exec();
}

async function updateByServiceId(serviceId, patch) {
  patch.updatedAt = Date.now();
  return Service.findOneAndUpdate({ serviceId }, { $set: patch }, { new: true }).exec();
}

async function deleteByServiceId(serviceId) {
  return Service.findOneAndDelete({ serviceId }).exec();
}

async function searchServices({ q, categories, location, page = 1, pageSize = 20 }) {
  const filter = { status: 'active' };
  if (categories && categories.length) filter.categories = { $in: categories };
  if (location) filter.locations = location;
  let query;
  if (q) {
    query = Service.find({ $text: { $search: q }, ...filter }, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } });
  } else {
    query = Service.find(filter).sort({ createdAt: -1 });
  }
  const skip = (page - 1) * pageSize;
  const results = await query.skip(skip).limit(pageSize).exec();
  const total = await Service.countDocuments(filter).exec();
  return { results, total, page, pageSize };
}

module.exports = {
  createService,
  findByServiceId,
  findByProviderAndName,
  updateByServiceId,
  deleteByServiceId,
  searchServices
};
