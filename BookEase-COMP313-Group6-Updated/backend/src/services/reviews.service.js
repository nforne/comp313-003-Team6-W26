const Review = require("../models/Review.model");
const Booking = require("../models/Booking.model");

const normalize = (v) => String(v || "").trim().toLowerCase() || "other";

async function upsertReviewForBooking({ bookingId, userId, rating, comment }) {
  const booking = await Booking.findById(bookingId).populate("service");
  if (!booking) throw new Error("Booking not found");

  if (String(booking.customer) !== String(userId)) {
    throw new Error("Not authorized");
  }

  if (booking.status !== "completed") {
    throw new Error("Booking must be completed");
  }

  const review = await Review.findOneAndUpdate(
    { booking: booking._id },
    {
      $set: {
        customer: booking.customer,
        provider: booking.provider,
        rating,
        comment: comment || "",
        serviceType: normalize(booking.service?.serviceType),
        serviceTitle: booking.service?.title || "",
      },
    },
    { new: true, upsert: true }
  );

  return review;
}

module.exports = { upsertReviewForBooking };