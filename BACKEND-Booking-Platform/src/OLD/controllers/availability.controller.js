// src/controllers/availability.controller.js
const Availability = require('../models/Availability.model');

async function getForService(req, res, next) {
  try {
    const items = await Availability.find({ service: req.params.serviceId });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

async function createOrUpdate(req, res, next) {
  try {
    const { serviceId } = req.params;
    const payload = { ...req.body, service: serviceId, provider: req.user.id };
    // simple upsert by date range id or create new
    const item = await Availability.create(payload);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

module.exports = { getForService, createOrUpdate };
