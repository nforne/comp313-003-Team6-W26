/**
 * @module api/auth
 * @description Authentication API calls.
 */

import API from './axios';

export const authAPI = {
  register: (data) => API.post('/auth/register', data),
  login: (data) => API.post('/auth/login', data),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data) => API.put('/auth/me', data),
  changePassword: (data) => API.put('/auth/password', data),
  toggleFavorite: (serviceId) => API.post(`/auth/favorites/${serviceId}`),
};
