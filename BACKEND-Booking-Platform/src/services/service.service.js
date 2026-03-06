// src/services/service.service.js
const { generateServiceId } = require('../utils/id.generator');
const serviceRepo = require('../repositories/service.repo');

async function ensureUniqueServiceId() {
  for (let i = 0; i < 5; i++) {
    const candidate = generateServiceId();
    const existing = await serviceRepo.findByServiceId(candidate);
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique serviceId');
}

async function createService(payload) {
  // ensure provider doesn't already have a service with same name
  const existing = await serviceRepo.findByProviderAndName(payload.providerId, payload.name);
  if (existing) {
    const err = new Error('Service name already exists for this provider');
    err.status = 409;
    throw err;
  }
  const serviceId = await ensureUniqueServiceId();
  const obj = Object.assign({}, payload, { serviceId });
  const created = await serviceRepo.createService(obj);
  return created;
}

async function getService(serviceId) {
  return serviceRepo.findByServiceId(serviceId);
}

async function updateService(serviceId, patch, actor) {
  // actor: { userId, role } - enforce ownership unless admin
  const svc = await serviceRepo.findByServiceId(serviceId);
  if (!svc) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  if (actor.role !== 'administrator' && actor.userId !== svc.providerId) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  // if name change, ensure uniqueness per provider
  if (patch.name && patch.name !== svc.name) {
    const dup = await serviceRepo.findByProviderAndName(svc.providerId, patch.name);
    if (dup) {
      const err = new Error('Service name already exists for this provider');
      err.status = 409;
      throw err;
    }
  }
  const updated = await serviceRepo.updateByServiceId(serviceId, patch);
  return updated;
}

async function removeService(serviceId, actor) {
  const svc = await serviceRepo.findByServiceId(serviceId);
  if (!svc) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  if (actor.role !== 'administrator' && actor.userId !== svc.providerId) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return serviceRepo.deleteByServiceId(serviceId);
}

async function search(params) {
  return serviceRepo.searchServices(params);
}

module.exports = {
  createService,
  getService,
  updateService,
  removeService,
  search
};
