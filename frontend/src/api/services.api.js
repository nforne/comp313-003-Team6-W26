/**
 * @module api/services
 * @description Service request API calls.
 */

import API from './axios';

export const servicesAPI = {
  getAll: (params) => API.get('/services', { params }),
  getById: (id) => API.get(`/services/${id}`),
  create: (data) => API.post('/services', data),
  update: (id, data) => API.put(`/services/${id}`, data),
  delete: (id) => API.delete(`/services/${id}`),
  getMyRequests: () => API.get('/services/my/requests'),
  getOpenRequests: (params) => API.get('/services/open/requests', { params }),
  getProviderActiveRequests: () => API.get('/services/provider/active'),
  submitBid: (serviceId, data) => API.post(`/services/${serviceId}/bids`, data),
  selectBid: (serviceId, bidId) => API.put(`/services/${serviceId}/select-bid/${bidId}`),
  updateBid: (serviceId, bidId, data) => API.put(`/services/${serviceId}/bids/${bidId}`, data),
};
