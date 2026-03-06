// src/controllers/admin.controller.js
async function stats(req, res) {
  // placeholder stats
  res.json({ success: true, data: { users: 0, services: 0, bookings: 0 } });
}

module.exports = { stats };
