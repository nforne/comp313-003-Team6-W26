// src/controllers/bookings.controller.js
const Booking = require('../models/Booking.model');

async function create(req, res, next) {
  try {
    const payload = { ...req.body, guest: req.user.id };
    const booking = await Booking.create(payload);
    res.status(201).json({ success: true, data: booking });
  } catch (err) { next(err); }
}

async function listForUser(req, res, next) {
  try {
    const bookings = await Booking.find({ guest: req.user.id });
    res.json({ success: true, data: bookings });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: booking });
  } catch (err) { next(err); }
}

async function cancel(req, res, next) {
  try {
    const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    res.json({ success: true, data: booking });
  } catch (err) { next(err); }
}

module.exports = { create, listForUser, getById, cancel };
