// src/controllers/services.controller.js
const Service = require('../models/Service.model');

async function list(req, res, next) {
  try {
    const items = await Service.find().limit(50);
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const payload = req.body;
    payload.provider = req.user.id;
    const item = await Service.create(payload);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const item = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await Service.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
