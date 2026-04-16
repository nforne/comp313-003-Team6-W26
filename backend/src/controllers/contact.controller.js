const { validationResult } = require("express-validator");
const ContactMessage = require("../models/ContactMessage.model");
const { sendContactEmail } = require("../utils/mailer");

// POST /api/contact
const createContactMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, message, purpose, address, phone, rating, lat, lng } = req.body;

    const saved = await ContactMessage.create({
      name,
      email,
      message,
      purpose: purpose || "General",
      address: address || "",
      phone: phone || "",
      rating: rating ? Number(rating) : 5,
      location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined,
      attachmentUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
      status: "new",
      readAt: null,
    });

    // Email notify (optional)
    try {
      await sendContactEmail({
        name,
        email,
        message,
        purpose: saved.purpose,
        address: saved.address,
        phone: saved.phone,
        rating: saved.rating,
        attachmentUrl: saved.attachmentUrl,
      });
    } catch (e) {
      console.error("Contact email failed:", e.message);
    }

    return res.status(201).json({ message: "Message received", data: saved });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

// GET /api/contact (admin)
const getAllMessages = async (req, res) => {
  try {
    const items = await ContactMessage.find().sort({ createdAt: -1 });
    return res.json(items);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

// PATCH /api/contact/:id/read (admin)
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await ContactMessage.findByIdAndUpdate(
      id,
      { status: "read", readAt: new Date() },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Message not found" });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

// DELETE /api/contact/:id (admin)
const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ContactMessage.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Message not found" });
    return res.json({ message: "Deleted" });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

module.exports = {
  createContactMessage,
  getAllMessages,
  markAsRead,
  deleteMessage,
};