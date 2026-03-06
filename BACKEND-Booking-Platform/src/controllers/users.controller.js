// src/controllers/users.controller.js
const userService = require('../services/user.service');
const { profileUpdateSchema, roleChangeSchema } = require('../validators/user.validator');

async function getProfile(req, res) {
  const userId = req.params.id;
  const profile = await userService.getPublicProfile(userId);
  if (!profile) return res.status(404).json({ message: 'Not found' });
  return res.json({ profile });
}

async function updateProfile(req, res) {
  const userId = req.params.id;
  // only allow self-update unless admin
  if (req.user.userId !== userId && req.user.role !== 'administrator') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const { error, value } = profileUpdateSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  const updated = await userService.updateProfile(userId, value);
  return res.json({ user: updated.toPublicJSON() });
}

async function changeRole(req, res) {
  const targetUserId = req.params.id;
  const { error, value } = roleChangeSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    const updated = await userService.changeRole(req.user, targetUserId, value.role);
    return res.json({ user: updated.toPublicJSON() });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

module.exports = { getProfile, updateProfile, changeRole };
