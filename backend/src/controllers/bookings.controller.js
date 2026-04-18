/**
 * @module controllers/bookings
 * @description Booking controller.
 * Handles booking creation, status updates, and rating/review submission.
 * Includes calendar conflict checking to prevent double bookings.
 * Auto-closes past bookings on fetch.
 */

const Booking = require('../models/Booking.model');
const Service = require('../models/Service.model');
const Review = require('../models/Review.model');
const Availability = require('../models/Availability.model');
const { checkProviderAvailability } = require('./services.controller');

/**
 * Normalize service type string.
 */
const normalize = (v) => String(v || '').trim().toLowerCase() || 'other';

/**
 * Auto-close past bookings that are still active.
 * Bookings whose scheduledDate + scheduledTime have passed
 * will be automatically marked as 'completed'.
 */
const autoClosePastBookings = async (filter = {}) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Find active bookings that are past their scheduled date
    const pastBookings = await Booking.find({
      ...filter,
      status: { $in: ['confirmed', 'in_progress'] },
      scheduledDate: { $lt: today },
    });

    for (const booking of pastBookings) {
      booking.status = 'completed';
      await booking.save();
      // Also update the service status
      await Service.findByIdAndUpdate(booking.service, { status: 'completed' });
    }

    // Also check bookings scheduled for today but whose time has passed
    const todayStart = new Date(today);
    const todayEnd = new Date(today.getTime() + 86400000);

    const todayBookings = await Booking.find({
      ...filter,
      status: { $in: ['confirmed', 'in_progress'] },
      scheduledDate: { $gte: todayStart, $lt: todayEnd },
    });

    for (const booking of todayBookings) {
      // Parse the scheduled time and check if it's passed
      const timeStr = booking.scheduledTime || '';
      let hours = 0, minutes = 0;

      // Try 12h format
      const match12 = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match12) {
        hours = parseInt(match12[1], 10);
        minutes = parseInt(match12[2], 10);
        const period = match12[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
      } else {
        // Try 24h format
        const match24 = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (match24) {
          hours = parseInt(match24[1], 10);
          minutes = parseInt(match24[2], 10);
        }
      }

      // Add the booking duration to get end time
      const duration = booking.duration || 60;
      const bookingEndMinutes = hours * 60 + minutes + duration;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (nowMinutes > bookingEndMinutes) {
        booking.status = 'completed';
        await booking.save();
        await Service.findByIdAndUpdate(booking.service, { status: 'completed' });
      }
    }
  } catch (error) {
    console.error('Auto-close error:', error.message);
  }
};

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

    // Check for scheduling conflicts using enhanced availability check
    const availCheck = await checkProviderAvailability(
      bid.provider,
      service.preferredDate,
      service.preferredTime
    );

    if (!availCheck.available) {
      return res.status(409).json({
        success: false,
        message: availCheck.reason,
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
 * Auto-closes past bookings before returning results.
 * Supports ?tab=upcoming or ?tab=previous for filtering.
 * @route GET /api/bookings
 * @access Private
 */
const getMyBookings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50, tab } = req.query;
    const filter = {};

    if (req.user.role === 'customer') {
      filter.customer = req.user._id;
    } else if (req.user.role === 'provider') {
      filter.provider = req.user._id;
    }

    // Auto-close past bookings before fetching
    await autoClosePastBookings(
      req.user.role === 'customer'
        ? { customer: req.user._id }
        : req.user.role === 'provider'
        ? { provider: req.user._id }
        : {}
    );

    if (status) filter.status = status;

    // Tab-based filtering for upcoming vs previous
    if (tab === 'upcoming') {
      filter.status = { $in: ['pending', 'confirmed', 'in_progress'] };
    } else if (tab === 'previous') {
      filter.status = { $in: ['completed', 'cancelled'] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customer', 'name email avatar')
        .populate('provider', 'name email avatar specialties')
        .populate('service', 'title serviceType location description preferredDate preferredTime')
        .sort({ scheduledDate: tab === 'upcoming' ? 1 : -1, createdAt: -1 })
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

    // Also create a Review document if one doesn't exist
    const existed = await Review.findOne({ booking: booking._id });
    if (!existed) {
      await Review.create({
        booking: booking._id,
        customer: booking.customer,
        provider: booking.provider,
        rating: score,
        comment: comment || '',
        serviceType: normalize(booking.service?.serviceType),
        serviceTitle: booking.service?.title || '',
      });
    }

    await booking.save();
    await booking.populate([
      { path: 'customer', select: 'name email avatar' },
      { path: 'provider', select: 'name email avatar specialties' },
      { path: 'service', select: 'title serviceType' },
    ]);

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
