const mongoose = require("mongoose");
const Review = require("../models/Review.model");
const Booking = require("../models/Booking.model");
const User = require("../models/User.model");

const normalizeServiceType = (v) => String(v || "").trim().toLowerCase() || "other";

const getUserId = (req) => req.user?._id || req.user?.id;

const recalcProviderRating = async (providerId) => {
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
};

exports.createReview = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "customer")
      return res.status(403).json({ message: "Only customers can review" });

    const { bookingId, rating, comment } = req.body;

    if (!bookingId) return res.status(400).json({ message: "bookingId is required" });

    const ratingNum = Number(rating);
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "rating must be between 1 and 5" });
    }

    const booking = await Booking.findById(bookingId).populate(
      "service",
      "serviceType title"
    );

    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (String(booking.customer) !== String(userId)) {
      return res.status(403).json({ message: "Not your booking" });
    }


    if (booking.status !== "completed") {
      return res.status(400).json({ message: "You can only review a completed booking" });
    }

    if (!booking.provider) {
      return res.status(400).json({ message: "Booking has no provider" });
    }

    const existed = await Review.findOne({ booking: bookingId });
    if (existed) return res.status(409).json({ message: "Review already exists" });

   
    const serviceType = normalizeServiceType(booking.service?.serviceType);

    const cleanComment = (comment || "").trim();

    const review = await Review.create({
      booking: bookingId,
      customer: booking.customer,
      provider: booking.provider,
      rating: ratingNum,
      comment: cleanComment,
      serviceType,
      serviceTitle: booking.service?.title || "",
    });

    await Booking.findByIdAndUpdate(bookingId, {
      review: review._id,
      rating: {
        score: ratingNum,
        comment: cleanComment,
      },
    });

    await recalcProviderRating(booking.provider);

    return res.status(201).json(review);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Review already exists" });
    }
    return res.status(500).json({ message: "Create review failed", error: err.message });
  }
};

exports.getMyReviews = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const filter =
      role === "provider"
        ? { provider: userId }
        : role === "customer"
        ? { customer: userId }
        : {}; // admin => all

    const reviews = await Review.find(filter)
      .sort({ createdAt: -1 })
      .populate("customer", "name")
      .populate("provider", "name ratingAvg ratingCount");

    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: "Fetch my reviews failed", error: err.message });
  }
};

exports.getReviewsByProvider = async (req, res) => {
  try {
    const { providerId } = req.params;

    const reviews = await Review.find({ provider: providerId })
      .sort({ createdAt: -1 })
      .populate("customer", "name")
      .populate("provider", "name ratingAvg ratingCount");

    return res.json(reviews);
  } catch (err) {
    return res.status(500).json({
      message: "Fetch provider reviews failed",
      error: err.message,
    });
  }
};

exports.replyReview = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "provider")
      return res.status(403).json({ message: "Only providers can reply" });

    const { id } = req.params;
    const { reply } = req.body;

    if (!reply || !reply.trim()) return res.status(400).json({ message: "reply is required" });

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });

    if (String(review.provider) !== String(userId)) {
      return res.status(403).json({ message: "Not your review" });
    }

    review.reply = reply.trim();
    review.repliedAt = new Date();
    await review.save();

    res.json(review);
  } catch (err) {
    res.status(500).json({ message: "Reply review failed", error: err.message });
  }
};

exports.getReviewFeed = async (req, res) => {
  try {
    const { serviceType = "all", page = 1, limit = 10 } = req.query;

    const q = {};
    if (serviceType && serviceType !== "all") {
      q.serviceType = String(serviceType).trim().toLowerCase();
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const [items, total, statsRaw] = await Promise.all([
      Review.find(q)
        .sort({ createdAt: -1 })
        .select("-__v")
        .skip(skip)
        .limit(limitNum)
        .populate("customer", "name")
        .populate("provider", "name ratingAvg ratingCount"),

      Review.countDocuments(q),

      Review.aggregate([
        { $match: q },
        {
          $group: {
            _id: null,
            avg: { $avg: "$rating" },
            total: { $sum: 1 },
            one: {
              $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] }
            },
            two: {
              $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] }
            },
            three: {
              $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] }
            },
            four: {
              $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] }
            },
            five: {
              $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] }
            }
          }
        }
      ])
    ]);

    const stats = statsRaw[0]
      ? {
          avg: Math.round((statsRaw[0].avg || 0) * 10) / 10,
          total: statsRaw[0].total || 0,
          counts: {
            1: statsRaw[0].one || 0,
            2: statsRaw[0].two || 0,
            3: statsRaw[0].three || 0,
            4: statsRaw[0].four || 0,
            5: statsRaw[0].five || 0,
          },
        }
      : {
          avg: 0,
          total: 0,
          counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        };

    return res.json({
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasMore: skip + items.length < total,
      stats,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Fetch review feed failed",
      error: err.message,
    });
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    const { id } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });

    if (role !== "admin" && String(review.customer) !== String(userId)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const providerId = review.provider;

    await Review.deleteOne({ _id: id });
    await recalcProviderRating(providerId);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Delete review failed", error: err.message });
  }
};