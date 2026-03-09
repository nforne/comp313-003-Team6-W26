const mongoose = require("mongoose");

const ContactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      index: true,
    },

    message: { type: String, required: true, trim: true, maxlength: 2000 },

    purpose: { type: String, default: "General", maxlength: 60 },
    address: { type: String, maxlength: 200 },
    phone: { type: String, maxlength: 30 },

    rating: { type: Number, min: 1, max: 5, default: 5 },

    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },

    attachmentUrl: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^https?:\/\/.+/i.test(v) || /^\/uploads\/.+/i.test(v);
        },
        message: "Invalid attachment URL",
      },
    },

    status: { type: String, enum: ["new", "read"], default: "new" },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);


ContactMessageSchema.index({ email: 1 });
ContactMessageSchema.index({ createdAt: -1 });
ContactMessageSchema.index({ status: 1 });

module.exports = mongoose.model("ContactMessage", ContactMessageSchema);