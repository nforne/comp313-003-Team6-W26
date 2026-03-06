// src/repositories/audit.repo.js
const Audit = require('../models/audit.model');

async function createAudit(record) {
  const a = new Audit(record);
  return a.save();
}

async function findByCorrelationId(correlationId, { page = 1, pageSize = 50 } = {}) {
  const skip = (page - 1) * pageSize;
  const results = await Audit.find({ correlationId }).sort({ createdAt: 1 }).skip(skip).limit(pageSize).exec();
  const total = await Audit.countDocuments({ correlationId }).exec();
  return { results, total, page, pageSize };
}

module.exports = { createAudit, findByCorrelationId };
