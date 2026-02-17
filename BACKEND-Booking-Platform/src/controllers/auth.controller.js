// src/controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User.model');

async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, error: 'Email already in use' });

    const user = await User.create({ name, email, password, role });
    const token = jwt.sign({ id: user._id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.status(201).json({ success: true, data: { user: { id: user._id, email: user.email, role: user.role }, token } });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials' });

    const match = await user.comparePassword(password);
    if (!match) return res.status(400).json({ success: false, error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ success: true, data: { user: { id: user._id, email: user.email, role: user.role }, token } });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };
