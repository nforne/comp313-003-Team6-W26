/**
 * @module api/bookings
 * @description Booking API calls.
 */

import API from './axios';

export const bookingsAPI = {
  create: (data) => API.post('/bookings', data),
  getMyBookings: (params) => API.get('/bookings', { params }),
  getUpcoming: () => API.get('/bookings', { params: { tab: 'upcoming' } }),
  getPrevious: () => API.get('/bookings', { params: { tab: 'previous' } }),
  getById: (id) => API.get(`/bookings/${id}`),
  updateStatus: (id, data) => API.put(`/bookings/${id}/status`, data),
  submitRating: (id, data) => API.post(`/bookings/${id}/rating`, data),
  getProviderReviews: (providerId) => API.get(`/bookings/reviews/${providerId}`),
};

export const availabilityAPI = {
  getMy: () => API.get('/availability'),
  getProvider: (id) => API.get(`/availability/provider/${id}`),
  set: (data) => API.put('/availability', data),
  setBulk: (data) => API.put('/availability/bulk', data),
  blockDate: (data) => API.post('/availability/block', data),
  unblockDate: (id) => API.delete(`/availability/block/${id}`),
  getMyBookings: (params) => API.get('/availability/bookings', { params }),
};

export const adminAPI = {
  getDashboard: () => API.get('/admin/dashboard'),
  getUsers: (params) => API.get('/admin/users', { params }),
  updateUser: (id, data) => API.put(`/admin/users/${id}`, data),
  deleteUser: (id) => API.delete(`/admin/users/${id}`),
  getAllBookings: (params) => API.get('/admin/bookings', { params }),
  getReviews: (params) => API.get('/admin/reviews', { params }),
  moderateReview: (id, data) => API.put(`/admin/reviews/${id}`, data),
  deleteReview: (id) => API.delete(`/admin/reviews/${id}`),
  getProviders: () => API.get('/admin/providers'),
};
