// src/controllers/service.controller.js
const serviceService = require('../services/service.service');
const { createServiceSchema, updateServiceSchema, searchSchema } = require('../validators/service.validator');

async function createService(req, res) {
  const { error, value } = createServiceSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    // providerId must match authenticated user unless admin
    const actor = req.user || {};
    if (actor.role !== 'administrator' && actor.userId !== value.providerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const created = await serviceService.createService(value);
    return res.status(201).json({ service: created });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function getService(req, res) {
  const serviceId = req.params.id;
  const svc = await serviceService.getService(serviceId);
  if (!svc) return res.status(404).json({ message: 'Not found' });
  return res.json({ service: svc });
}

async function updateService(req, res) {
  const serviceId = req.params.id;
  const { error, value } = updateServiceSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    const actor = req.user || {};
    const updated = await serviceService.updateService(serviceId, value, actor);
    return res.json({ service: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function deleteService(req, res) {
  const serviceId = req.params.id;
  try {
    const actor = req.user || {};
    await serviceService.removeService(serviceId, actor);
    return res.status(204).send();
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function searchServices(req, res) {
  const { error, value } = searchSchema.validate(req.query);
  if (error) return res.status(400).json({ message: error.message });
  const results = await serviceService.search(value);
  return res.json(results);
}

module.exports = { createService, getService, updateService, deleteService, searchServices };
