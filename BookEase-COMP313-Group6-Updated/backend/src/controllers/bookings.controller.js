/**
 * @module controllers/bookings
 * @description Booking controller.
 * Handles booking creation, status updates, and rating/review submission.
 * Includes calendar conflict checking to prevent double bookings.
 */

const Booking = require('../models/Booking.model');
const Service = require('../models/Service.model');
const Review = require ('../models/Review.model');
const normalize = (v) => String(v || "").trim().toLowerCase() || "other";
/**
 * Create a booking by accepting a bid.
 * @route POST /api/bookings
 * @access Private (Customer)
 */
const createBooking = async (req, res, next) => {
  try {
    const { serviceId, bidId } = req.body;

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (service.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the service requester can confirm a booking',
      });
    }

    const bid = service.bids.id(bidId);
    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found',
      });
    }
 

    // Check for scheduling conflicts
    const conflictingBooking = await Booking.findOne({
      provider: bid.provider,
      scheduledDate: service.preferredDate,
      scheduledTime: service.preferredTime,
      status: { $in: ['pending', 'confirmed', 'in_progress'] },
    });

    if (conflictingBooking) {
      return res.status(409).json({
        success: false,
        message: 'Provider has a scheduling conflict at this time',
      });
    }

    const booking = await Booking.create({
      service: service._id,
      customer: req.user._id,
      provider: bid.provider,
      bidId: bid._id,
      scheduledDate: service.preferredDate,
      scheduledTime: service.preferredTime,
      duration: bid.estimatedDuration || 60,
      price: bid.price,
      status: 'confirmed',
    });

    // Update bid status
    bid.status = 'accepted';
    service.bids.forEach((b) => {
      if (b._id.toString() !== bidId) {
        b.status = 'rejected';
      }
    });
    service.selectedBid = bid._id;
    service.status = 'in_progress';
    await service.save();

    await booking.populate([
      { path: 'customer', select: 'name email avatar' },
      { path: 'provider', select: 'name email avatar specialties' },
      { path: 'service', select: 'title serviceType location' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Booking confirmed successfully',
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get bookings for the current user.
 * @route GET /api/bookings
 * @access Private
 */
const getMyBookings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (req.user.role === 'customer') {
      filter.customer = req.user._id;
    } else if (req.user.role === 'provider') {
      filter.provider = req.user._id;
    }

    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customer', 'name email avatar')
        .populate('provider', 'name email avatar specialties')
        .populate('service', 'title serviceType location description preferredDate preferredTime')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Booking.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single booking by ID.
 * @route GET /api/bookings/:id
 * @access Private
 */
const getBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customer', 'name email avatar phone location')
      .populate('provider', 'name email avatar specialties phone location bio')
      .populate('service', 'title serviceType location description preferredDate preferredTime budget bids');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Check authorization
    const isOwner =
      booking.customer._id.toString() === req.user._id.toString() ||
      booking.provider._id.toString() === req.user._id.toString() ||
      req.user.role === 'admin';

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking',
      });
    }

    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update booking status.
 * @route PUT /api/bookings/:id/status
 * @access Private
 */
const updateBookingStatus = async (req, res, next) => {
  try {
    const { status, cancellationReason } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Validate status transitions
    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
    };

    if (!validTransitions[booking.status] || !validTransitions[booking.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from '${booking.status}' to '${status}'`,
      });
    }

    booking.status = status;
    if (status === 'cancelled' && cancellationReason) {
      booking.cancellationReason = cancellationReason;
    }

    // If cancelled, reopen the service request
    if (status === 'cancelled') {
      await Service.findByIdAndUpdate(booking.service, { status: 'open', selectedBid: null });
    }

    // If completed, update service status
    if (status === 'completed') {
      await Service.findByIdAndUpdate(booking.service, { status: 'completed' });
    }

    await booking.save();
    await booking.populate([
      { path: 'customer', select: 'name email avatar' },
      { path: 'provider', select: 'name email avatar specialties' },
      { path: 'service', select: 'title serviceType location' },
    ]);

    res.status(200).json({
      success: true,
      message: `Booking ${status} successfully`,
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit a rating for a completed booking.
 * @route POST /api/bookings/:id/rating
 * @access Private (Customer)
 */
const submitRating = async (req, res, next) => {
  try {
    const { score, comment } = req.body;

    const booking = await Booking.findById(req.params.id)
      .populate('service', 'serviceType title');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    if (booking.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer can rate this booking',
      });
    }

    if (booking.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate completed bookings',
      });
    }

    if (booking.rating) {
      return res.status(400).json({
        success: false,
        message: 'Booking has already been rated',
      });
    }
    booking.rating = {
      score,
      comment: comment || '',
    };

   const existed = await Review.findOne({ booking: booking._id });

   

if (!existed) {
  await Review.create({
    booking: booking._id,
    customer: booking.customer,
    provider: booking.provider,
    rating: score,
    comment: comment || "",
    serviceType: normalize(booking.service?.serviceType),
     serviceTitle: booking.service?.title || "",
  });
}

    await booking.save();

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider's ratings/reviews.
 * @route GET /api/bookings/reviews/:providerId
 * @access Public
 */
const getProviderReviews = async (req, res, next) => {
  try {
    const bookings = await Booking.find({
      provider: req.params.providerId,
      rating: { $exists: true, $ne: null },
    })
      .populate('customer', 'name avatar')
      .populate('service', 'title serviceType')
      .select('rating customer service createdAt')
      .sort({ createdAt: -1 });

    const totalRatings = bookings.length;
    const avgRating =
      totalRatings > 0
        ? bookings.reduce((sum, b) => sum + b.rating.score, 0) / totalRatings
        : 0;

    res.status(200).json({
      success: true,
      data: {
        reviews: bookings,
        stats: {
          totalRatings,
          averageRating: Math.round(avgRating * 10) / 10,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBooking,
  updateBookingStatus,
  submitRating,
  getProviderReviews,
};
