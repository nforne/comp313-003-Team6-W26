/**
 * @module routes/auth
 * @description Authentication routes.
 */

const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  toggleFavorite,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { registerRules, loginRules, validate } = require('../utils/validators');

router.post('/register', registerRules, validate, register);
router.post('/login', loginRules, validate, login);
router.get('/me', protect, getMe);
router.put('/me', protect, updateProfile);
router.put('/password', protect, changePassword);
router.post('/favorites/:id', protect, toggleFavorite);

module.exports = router;
