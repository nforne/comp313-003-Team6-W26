// src/controllers/request.controller.js
const requestService = require('../services/request.service');
const { createRequestSchema, searchSchema } = require('../validators/request.validator');

async function createRequest(req, res) {
  const { error, value } = createRequestSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    const actor = req.user || {};
    const created = await requestService.createRequest(value, actor);
    return res.status(201).json({ request: created });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function getRequest(req, res) {
  try {
    const actor = req.user || null;
    const r = await requestService.getRequest(req.params.id, actor);
    return res.json({ request: r });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function searchRequests(req, res) {
  const { error, value } = searchSchema.validate(req.query);
  if (error) return res.status(400).json({ message: error.message });
  const actor = req.user || null;
  const near = (value.nearLng && value.nearLat) ? { nearLng: value.nearLng, nearLat: value.nearLat } : {};
  const params = Object.assign({}, value, near);
  const results = await requestService.searchOpenRequests(params, actor);
  return res.json(results);
}

async function updateRequest(req, res) {
  try {
    const actor = req.user || {};
    const updated = await requestService.updateRequest(req.params.id, req.body, actor);
    return res.json({ request: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

module.exports = { createRequest, getRequest, searchRequests, updateRequest };
