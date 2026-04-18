// src/models/Offer.model.js
const mongoose = require("mongoose");

const OfferSchema = new mongoose.Schema(
  {
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      required: true,
      index: true,
    },

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // customer id optional (can be derived from request.customer)
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    price: { type: Number, required: true, min: 0 },

    message: { type: String, trim: true, maxlength: 1000, default: "" },

    // provider đề xuất thời gian (optional)
    proposedDate: { type: Date },
    proposedTime: { type: String, trim: true, maxlength: 30, default: "" },

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

// 1 provider chỉ gửi 1 offer cho 1 request (tránh spam)
OfferSchema.index({ request: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model("Offer", OfferSchema);