// src/controllers/offers.controller.js
const mongoose = require("mongoose");
const Offer = require("../models/Offer.model");
const ServiceRequest = require("../models/ServiceRequest.model"); // bạn phải có model này
const Booking = require("../models/Booking.model");

const getUserId = (req) => req.user?._id || req.user?.id;

const normalizeServiceType = (v) => String(v || "").trim().toLowerCase() || "other";

/**
 * Provider creates an offer for a service request
 * POST /api/offers
 * body: { requestId, price, message, proposedDate, proposedTime }
 */
exports.createOffer = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "provider") return res.status(403).json({ message: "Only providers can send offers" });

    const { requestId, price, message, proposedDate, proposedTime } = req.body;

    if (!requestId) return res.status(400).json({ message: "requestId is required" });

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: "price must be a non-negative number" });
    }

    const reqDoc = await ServiceRequest.findById(requestId);
    if (!reqDoc) return res.status(404).json({ message: "Service request not found" });

    if (reqDoc.status !== "open") {
      return res.status(400).json({ message: "This request is not open for offers" });
    }

    // không cho provider gửi offer cho request của chính mình (phòng trường hợp role lẫn)
    if (String(reqDoc.customer) === String(userId)) {
      return res.status(400).json({ message: "You cannot offer on your own request" });
    }

    const offer = await Offer.create({
      request: reqDoc._id,
      provider: userId,
      customer: reqDoc.customer,
      price: priceNum,
      message: (message || "").trim(),
      proposedDate: proposedDate ? new Date(proposedDate) : undefined,
      proposedTime: (proposedTime || "").trim(),
      status: "pending",
    });

    return res.status(201).json(offer);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "You already sent an offer for this request" });
    }
    return res.status(500).json({ message: "Create offer failed", error: err.message });
  }
};

/**
 * Customer views offers for a request
 * GET /api/offers/request/:requestId
 */
exports.getOffersByRequest = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { requestId } = req.params;

    const reqDoc = await ServiceRequest.findById(requestId);
    if (!reqDoc) return res.status(404).json({ message: "Service request not found" });

    // customer chỉ xem offers của request mình
    if (role === "customer" && String(reqDoc.customer) !== String(userId)) {
      return res.status(403).json({ message: "Not your request" });
    }

    // provider: chỉ xem offers của request (public) cũng được — tùy bạn, ở đây cho xem
    const offers = await Offer.find({ request: requestId })
      .sort({ price: 1, createdAt: -1 })
      .populate("provider", "name ratingAvg ratingCount")
      .lean();

    return res.json({ request: reqDoc, offers });
  } catch (err) {
    return res.status(500).json({ message: "Fetch offers failed", error: err.message });
  }
};

/**
 * Customer accepts an offer -> creates Booking
 * POST /api/offers/:offerId/accept
 */
exports.acceptOffer = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "customer") return res.status(403).json({ message: "Only customers can accept offers" });

    const { offerId } = req.params;

    let createdBooking = null;

    await session.withTransaction(async () => {
      const offer = await Offer.findById(offerId).session(session);
      if (!offer) throw new Error("Offer not found");

      if (offer.status !== "pending") throw new Error("Offer is not pending");

      const reqDoc = await ServiceRequest.findById(offer.request).session(session);
      if (!reqDoc) throw new Error("Service request not found");

      if (String(reqDoc.customer) !== String(userId)) throw new Error("Not your request");
      if (reqDoc.status !== "open") throw new Error("Request is not open");

      // 1) accept offer
      offer.status = "accepted";
      await offer.save({ session });

      // 2) reject other offers
      await Offer.updateMany(
        { request: reqDoc._id, _id: { $ne: offer._id }, status: "pending" },
        { $set: { status: "rejected" } },
        { session }
      );

      // 3) mark request booked
      reqDoc.status = "booked";
      reqDoc.acceptedOffer = offer._id; // nếu bạn có field này
      await reqDoc.save({ session });

      // 4) create booking
      // booking fields theo style của bạn: customer/provider/serviceType/location/date/time/price/status...
      createdBooking = await Booking.create(
        [
          {
            customer: reqDoc.customer,
            provider: offer.provider,
            request: reqDoc._id, // optional field in Booking schema
            offer: offer._id,    // optional field
            serviceType: normalizeServiceType(reqDoc.serviceType),
            serviceTitle: (reqDoc.title || "").trim(),
            location: (reqDoc.location || "").trim(),
            scheduledAt: reqDoc.preferredDate ? new Date(reqDoc.preferredDate) : undefined,
            preferredTime: (offer.proposedTime || reqDoc.preferredTime || "").trim(),
            price: offer.price,
            status: "confirmed",
          },
        ],
        { session }
      );

      createdBooking = createdBooking[0];
    });

    session.endSession();
    return res.status(201).json({ booking: createdBooking });
  } catch (err) {
    session.endSession();
    const msg = err?.message || "Accept offer failed";
    // map một số message thường gặp cho đẹp
    if (msg === "Offer not found") return res.status(404).json({ message: msg });
    if (msg.includes("not")) return res.status(400).json({ message: msg });
    return res.status(500).json({ message: "Accept offer failed", error: msg });
  }
};

/**
 * Provider cancels own offer (optional)
 * POST /api/offers/:offerId/cancel
 */
exports.cancelMyOffer = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "provider") return res.status(403).json({ message: "Only providers can cancel offers" });

    const { offerId } = req.params;

    const offer = await Offer.findById(offerId);
    if (!offer) return res.status(404).json({ message: "Offer not found" });

    if (String(offer.provider) !== String(userId)) {
      return res.status(403).json({ message: "Not your offer" });
    }

    if (offer.status !== "pending") {
      return res.status(400).json({ message: "Only pending offer can be cancelled" });
    }

    offer.status = "cancelled";
    await offer.save();

    return res.json({ ok: true, offer });
  } catch (err) {
    return res.status(500).json({ message: "Cancel offer failed", error: err.message });
  }
};

/**
 * Customer/Provider list my offers (optional)
 * GET /api/offers/me
 */
exports.getMyOffers = async (req, res) => {
  try {
    const userId = getUserId(req);
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const filter =
      role === "provider"
        ? { provider: userId }
        : role === "customer"
        ? { customer: userId }
        : {};

    const offers = await Offer.find(filter)
      .sort({ createdAt: -1 })
      .populate("provider", "name ratingAvg ratingCount")
      .populate("request", "title serviceType status location preferredDate preferredTime")
      .lean();

    return res.json(offers);
  } catch (err) {
    return res.status(500).json({ message: "Fetch my offers failed", error: err.message });
  }
};