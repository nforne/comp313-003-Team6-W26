const mongoose = require("mongoose");

const ServiceRequestSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  title: String,
  description: String,
  serviceType: String,
  location: String,
  preferredDate: Date,
  preferredTime: String,
  budgetMin: Number,
  budgetMax: Number,

  status: {
    type: String,
    enum: ["open", "booked", "closed"],
    default: "open",
  },
});

module.exports = mongoose.model("ServiceRequest", ServiceRequestSchema);