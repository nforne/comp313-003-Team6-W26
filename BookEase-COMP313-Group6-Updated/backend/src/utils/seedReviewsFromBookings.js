const mongoose = require("mongoose");
require("dotenv").config();

const Booking = require("../models/Booking.model");
const Review = require("../models/Review.model");
const User = require("../models/User.model");
const Service = require("../models/Service.model");

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/bookease";

const normalizeServiceType = (value) => {
  const v = String(value || "").trim().toLowerCase();
  return v || "other";
};

const SAMPLE_COMMENTS = {
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

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRating() {
  const pool = [5, 5, 5, 4, 4, 4, 5, 4, 3];
  return pickRandom(pool);
}

async function recalcProviderRating(providerId) {
  const stats = await Review.aggregate([
    {
      $match: {
        provider: new mongoose.Types.ObjectId(providerId),
      },
    },
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

async function getServiceInfo(booking) {
  if (booking.service && typeof booking.service === "object" && booking.service.title) {
    return {
      serviceType: normalizeServiceType(booking.service.serviceType),
      serviceTitle: booking.service.title || "Service",
    };
  }

  if (booking.service) {
    const serviceDoc = await Service.findById(booking.service).select("serviceType title");
    return {
      serviceType: normalizeServiceType(serviceDoc?.serviceType),
      serviceTitle: serviceDoc?.title || "Service",
    };
  }

  return {
    serviceType: "other",
    serviceTitle: "Service",
  };
}

async function seedFromExistingBookingRatings() {
  const bookings = await Booking.find({
    status: "completed",
    "rating.score": { $exists: true, $ne: null },
  }).populate("service", "serviceType title");

  console.log(`Found ${bookings.length} completed bookings with rating.score`);

  let created = 0;
  let skipped = 0;
  const touchedProviders = new Set();

  for (const booking of bookings) {
    const existingReview = await Review.findOne({ booking: booking._id });

    if (existingReview) {
      if (!booking.review) {
        await Booking.findByIdAndUpdate(booking._id, {
          review: existingReview._id,
        });
      }
      skipped++;
      continue;
    }

    if (!booking.customer || !booking.provider) {
      skipped++;
      continue;
    }

    const score = Number(booking.rating?.score || 0);
    const comment = String(booking.rating?.comment || "").trim();

    if (score < 1 || score > 5) {
      skipped++;
      continue;
    }

    const serviceInfo = await getServiceInfo(booking);

    const review = await Review.create({
      booking: booking._id,
      customer: booking.customer,
      provider: booking.provider,
      rating: score,
      comment,
      serviceType: serviceInfo.serviceType,
      serviceTitle: serviceInfo.serviceTitle,
      createdAt: booking.updatedAt || booking.createdAt || new Date(),
      updatedAt: booking.updatedAt || booking.createdAt || new Date(),
    });

    await Booking.findByIdAndUpdate(booking._id, {
      review: review._id,
    });

    touchedProviders.add(String(booking.provider));
    created++;
  }

  return { created, skipped, touchedProviders };
}

async function seedExtraCustomerReviews(limit = 12) {
  const bookings = await Booking.find({
    status: "completed",
    provider: { $ne: null },
    customer: { $ne: null },
    $or: [{ review: { $exists: false } }, { review: null }],
  })
    .populate("service", "serviceType title")
    .sort({ updatedAt: -1 })
    .limit(limit * 3);

  console.log(`Found ${bookings.length} completed bookings without review`);

  let created = 0;
  let skipped = 0;
  const touchedProviders = new Set();

  for (const booking of bookings) {
    if (created >= limit) break;

    const exists = await Review.findOne({ booking: booking._id });
    if (exists) {
      skipped++;
      continue;
    }

    if (!booking.customer || !booking.provider) {
      skipped++;
      continue;
    }

    const serviceInfo = await getServiceInfo(booking);
    const rating = randomRating();

    const commentPool =
      SAMPLE_COMMENTS[serviceInfo.serviceType] || SAMPLE_COMMENTS.other;

    const comment = pickRandom(commentPool);

    const daysAgo = Math.floor(Math.random() * 30);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const review = await Review.create({
      booking: booking._id,
      customer: booking.customer,
      provider: booking.provider,
      rating,
      comment,
      serviceType: serviceInfo.serviceType,
      serviceTitle: serviceInfo.serviceTitle,
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

    touchedProviders.add(String(booking.provider));
    created++;

    console.log(
      `Created extra review for booking ${booking._id} | ${serviceInfo.serviceType} | ${rating}★`
    );
  }

  return { created, skipped, touchedProviders };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const base = await seedFromExistingBookingRatings();
  const extra = await seedExtraCustomerReviews(40);

  const allTouchedProviders = new Set([
    ...base.touchedProviders,
    ...extra.touchedProviders,
  ]);

  for (const providerId of allTouchedProviders) {
    await recalcProviderRating(providerId);
  }

  console.log("=================================");
  console.log(`Created from existing ratings: ${base.created}`);
  console.log(`Skipped existing ratings: ${base.skipped}`);
  console.log(`Created extra customer reviews: ${extra.created}`);
  console.log(`Skipped extra customer reviews: ${extra.skipped}`);
  console.log(`Updated provider ratings: ${allTouchedProviders.size}`);

  await mongoose.disconnect();
  console.log("Done");
}

run().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    await mongoose.disconnect();
  } catch (e) {}
  process.exit(1);
});