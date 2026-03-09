const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
    reply: { type: String, trim: true, maxlength: 1000, default: "" },
    repliedAt: { type: Date },
    serviceType: { type: String, required: true, lowercase: true, index: true },
    serviceTitle: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Review", ReviewSchema);