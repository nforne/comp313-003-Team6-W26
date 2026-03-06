// src/controllers/auth.controller.js
const userService = require('../services/user.service');
const { registerSchema, loginSchema } = require('../validators/user.validator');

async function register(req, res) {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    const user = await userService.register(value);
    return res.status(201).json({ user: user.toPublicJSON() });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function login(req, res) {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  try {
    const { user, accessToken, refreshToken } = await userService.authenticate(value);
    // set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ accessToken, user: user.toPublicJSON() });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

async function logout(req, res) {
  try {
    const refreshToken = req.cookies && req.cookies.refreshToken;
    const userId = req.user && req.user.userId;
    if (userId && refreshToken) {
      await userService.logout(userId, refreshToken);
    }
    res.clearCookie('refreshToken');
    return res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    return res.status(500).json({ message: 'Logout failed' });
  }
}

module.exports = { register, login, logout };
