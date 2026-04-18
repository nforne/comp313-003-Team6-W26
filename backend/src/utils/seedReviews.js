const mongoose = require("mongoose");
require("dotenv").config();

const Booking = require("../models/Booking.model");
const Review = require("../models/Review.model");
const User = require("../models/User.model");
const Service = require("../models/Service.model");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bookease";

const COMMENTS_BY_TYPE = {
  haircut: [
    "Amazing haircut service. Very professional and friendly.",
    "Loved the styling result. Exactly what I wanted.",
    "Great haircut and clean service. Highly recommended.",
    "Very skilled provider. My hair looks fantastic now.",
    "Quick, professional, and great attention to detail.",
  ],
  massage: [
    "Very relaxing session. I felt much better afterward.",
    "Professional massage and great atmosphere.",
    "Excellent service. Helped reduce my back pain a lot.",
    "Very calming and worth every dollar.",
    "One of the best massage experiences I have had.",
  ],
  cleaning: [
    "The place was spotless after the cleaning service.",
    "Very detailed and efficient cleaning work.",
    "Excellent cleaning service. My home looks amazing.",
    "Arrived on time and cleaned everything properly.",
    "Super satisfied with the cleaning quality.",
  ],
  plumbing: [
    "Fixed my plumbing issue quickly and professionally.",
    "Very knowledgeable and efficient plumber.",
    "Solved the leak fast. Excellent service.",
    "Professional work and fair communication.",
    "Great plumbing service, would book again.",
  ],
  electrical: [
    "Resolved the electrical issue safely and quickly.",
    "Professional and careful work throughout.",
    "Very satisfied with the repair and explanation.",
    "Great service and very knowledgeable electrician.",
    "Fast response and solid workmanship.",
  ],
  tutoring: [
    "Very patient tutor and explained concepts clearly.",
    "Helped me understand difficult topics easily.",
    "Excellent tutor. I learned a lot from one session.",
    "Very supportive and professional teaching style.",
    "Highly recommend for anyone needing extra help.",
  ],
  photography: [
    "Photos turned out beautiful and professional.",
    "Great eye for detail and very creative shots.",
    "Amazing experience and excellent final photos.",
    "Very friendly photographer and stunning results.",
    "Captured the event perfectly. Highly recommended.",
  ],
  fitness: [
    "Motivating trainer and well-structured workout.",
    "Great session and very professional coaching.",
    "Helped me push myself safely and effectively.",
    "Excellent fitness service and positive energy.",
    "Really enjoyed the training session.",
  ],
  repair: [
    "The repair was done quickly and works perfectly now.",
    "Very professional and efficient repair service.",
    "Solved the issue better than I expected.",
    "Reliable service and good communication.",
    "Fast and high-quality repair work.",
  ],
  other: [
    "Excellent service and very professional.",
    "Really satisfied with the overall experience.",
    "Great communication and quality work.",
    "Very reliable and easy to work with.",
    "Would definitely recommend this provider.",
  ],
};

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRating() {
  const ratings = [5, 5, 5, 4, 4, 4, 3];
  return randomItem(ratings);
}

function normalizeServiceType(value) {
  const v = String(value || "").trim().toLowerCase();
  return v || "other";
}

async function recalcProviderRating(providerId) {
  const stats = await Review.aggregate([
    { $match: { provider: new mongoose.Types.ObjectId(providerId) } },
    {
      $group: {
        _id: "$provider",
        avg: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = stats[0]?.avg ?? 0;
  const count = stats[0]?.count ?? 0;

  await User.findByIdAndUpdate(providerId, {
    ratingAvg: Math.round(avg * 10) / 10,
    ratingCount: count,
  });
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const bookings = await Booking.find({
    status: "completed",
    provider: { $ne: null },
    customer: { $ne: null },
  })
    .populate("service", "serviceType title")
    .sort({ updatedAt: -1 })
    .limit(50);

  console.log("Found bookings:", bookings.length);

  let created = 0;
  let skipped = 0;
  const providers = new Set();

  for (const booking of bookings) {
    const exists = await Review.findOne({ booking: booking._id });
    if (exists) {
      skipped++;
      continue;
    }

    const serviceType = normalizeServiceType(booking.service?.serviceType);
    const serviceTitle = booking.service?.title || "Service";
    const commentPool = COMMENTS_BY_TYPE[serviceType] || COMMENTS_BY_TYPE.other;

    const rating = randomRating();
    const comment = randomItem(commentPool);

    const daysAgo = Math.floor(Math.random() * 45);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const review = await Review.create({
      booking: booking._id,
      customer: booking.customer,
      provider: booking.provider,
      rating,
      comment,
      serviceType,
      serviceTitle,
      createdAt,
      updatedAt: createdAt,
    });

    await Booking.findByIdAndUpdate(booking._id, {
      review: review._id,
      rating: {
        score: rating,
        comment,
      },
    });

    providers.add(String(booking.provider));
    created++;

    console.log(
      `Created review ${created}: ${serviceType} | ${rating}⭐ | ${comment}`
    );
  }

  for (const providerId of providers) {
    await recalcProviderRating(providerId);
  }

  console.log("=================================");
  console.log("Created reviews:", created);
  console.log("Skipped existing reviews:", skipped);
  console.log("Updated providers:", providers.size);

  await mongoose.disconnect();
  console.log("Done");
}

run().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});