const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../models/User.model");
const Booking = require("../models/Booking.model");
const Review = require("../models/Review.model");
const Service = require("../models/Service.model");

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/bookease";

const CUSTOMER_DATA = [
  {
    name: "Alice Johnson",
    email: "customer1@bookease.com",
    phone: "6471000001",
    location: "Toronto",
    bio: "Friendly customer who loves great service.",
  },
  {
    name: "Emma Brown",
    email: "customer2@bookease.com",
    phone: "6471000002",
    location: "North York",
    bio: "Regular customer looking for trusted providers.",
  },
  {
    name: "Sophia Lee",
    email: "customer3@bookease.com",
    phone: "6471000003",
    location: "Scarborough",
    bio: "Enjoys booking beauty and wellness services.",
  },
  {
    name: "Michael Smith",
    email: "customer4@bookease.com",
    phone: "6471000004",
    location: "Mississauga",
    bio: "Prefers professional and reliable services.",
  },
  {
    name: "Olivia Wilson",
    email: "customer5@bookease.com",
    phone: "6471000005",
    location: "Etobicoke",
    bio: "Loves easy booking and quality work.",
  },
  {
    name: "Daniel Martinez",
    email: "customer6@bookease.com",
    phone: "6471000006",
    location: "Brampton",
    bio: "Books home services frequently.",
  },
  {
    name: "James Anderson",
    email: "customer7@bookease.com",
    phone: "6471000007",
    location: "Markham",
    bio: "Looks for affordable and skilled providers.",
  },
  {
    name: "Isabella Thomas",
    email: "customer8@bookease.com",
    phone: "6471000008",
    location: "Vaughan",
    bio: "Enjoys fitness and personal care services.",
  },
];

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

async function createCustomers() {
  const customers = [];

  for (const item of CUSTOMER_DATA) {
    let user = await User.findOne({ email: item.email });

    if (!user) {
      user = await User.create({
        name: item.name,
        email: item.email,
        password: "Password123!",
        role: "customer",
        phone: item.phone,
        location: item.location,
        bio: item.bio,
        avatar: "",
      });
      console.log(`Created customer: ${item.name}`);
    } else {
      console.log(`Customer already exists: ${item.name}`);
    }

    customers.push(user);
  }

  return customers;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const customers = await createCustomers();

  const providers = await User.find({ role: "provider", isActive: true });
  const services = await Service.find();

  if (!providers.length) {
    throw new Error("No providers found in database");
  }

  if (!services.length) {
    throw new Error("No services found in database");
  }

  let createdBookings = 0;
  let createdReviews = 0;
  const touchedProviders = new Set();

for (let i = 0; i < 15; i++) {
  const customer = randomItem(customers);
  const provider = randomItem(providers);

  const providerServices = services.filter(
    (s) => String(s.provider) === String(provider._id)
  );

  const service =
    providerServices.length > 0
      ? randomItem(providerServices)
      : randomItem(services);

  const serviceType = normalizeServiceType(service.serviceType);
  const commentPool = COMMENTS_BY_TYPE[serviceType] || COMMENTS_BY_TYPE.other;
  const rating = randomRating();
  const comment = randomItem(commentPool);

  const daysAgo = Math.floor(Math.random() * 40);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  const booking = await Booking.create({
    service: service._id,
    customer: customer._id,
    provider: provider._id,
    scheduledDate: createdAt,
    scheduledTime: "10:00 AM",
    duration: 60,
    price: Number(service.price || 50),
    status: "completed",
    notes: "Seeded booking for review demo",
    rating: {
      score: rating,
      comment,
    },
  });

  createdBookings++;

  const review = await Review.create({
    booking: booking._id,
    customer: customer._id,
    provider: provider._id,
    rating,
    comment,
    serviceType,
    serviceTitle: service.title || "Service",
    createdAt,
    updatedAt: createdAt,
  });

  await Booking.findByIdAndUpdate(booking._id, {
    review: review._id,
  });

  touchedProviders.add(String(provider._id));
  createdReviews++;

  console.log(
    `Created review ${createdReviews}: ${customer.name} -> ${provider.name} | ${rating}⭐`
  );
}

  for (const providerId of touchedProviders) {
    await recalcProviderRating(providerId);
  }

  console.log("=================================");
  console.log(`Created customers: ${customers.length}`);
  console.log(`Created bookings: ${createdBookings}`);
  console.log(`Created reviews: ${createdReviews}`);
  console.log(`Updated providers: ${touchedProviders.size}`);

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