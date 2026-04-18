/**
 * @module controllers/services
 * @description Service request controller.
 * Handles CRUD operations for service requests and bid management.
 */

const Service = require('../models/Service.model');
const Booking = require('../models/Booking.model');
const Availability = require('../models/Availability.model');

/**
 * Parse a time string (e.g. "10:00 AM", "14:00", "2:30 PM") into "HH:MM" 24-hour format.
 */
const parseTimeTo24h = (timeStr) => {
  if (!timeStr) return null;
  const s = timeStr.trim();
  // Already 24h format like "14:00"
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  // 12h format like "10:00 AM"
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const period = match12[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return null;
};

/**
 * Check if a provider is available at a given date and time.
 * Returns { available: boolean, reason: string }
 */
const checkProviderAvailability = async (providerId, date, timeStr) => {
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getUTCDay();
  const time24 = parseTimeTo24h(timeStr);

  // Check for blocked specific date
  const blockedDate = await Availability.findOne({
    provider: providerId,
    specificDate: {
      $gte: new Date(dateObj.toISOString().split('T')[0]),
      $lt: new Date(new Date(dateObj.toISOString().split('T')[0]).getTime() + 86400000),
    },
    isBlocked: true,
  });

  if (blockedDate) {
    return { available: false, reason: 'Provider has blocked this date' };
  }

  // Check weekly schedule
  const daySchedule = await Availability.findOne({
    provider: providerId,
    dayOfWeek,
    specificDate: null,
  });

  if (daySchedule && !daySchedule.isAvailable) {
    return { available: false, reason: 'Provider is not available on this day of the week' };
  }

  // If provider has set availability and we have a parseable time, check time slots
  if (daySchedule && daySchedule.slots && daySchedule.slots.length > 0 && time24) {
    const inSlot = daySchedule.slots.some((slot) => {
      return time24 >= slot.startTime && time24 < slot.endTime;
    });
    if (!inSlot) {
      return { available: false, reason: 'Provider is not available at this time. Check their availability schedule.' };
    }
  }

  // Check for existing booking conflicts
  const conflictingBooking = await Booking.findOne({
    provider: providerId,
    scheduledDate: dateObj,
    scheduledTime: timeStr,
    status: { $in: ['pending', 'confirmed', 'in_progress'] },
  });

  if (conflictingBooking) {
    return { available: false, reason: 'Provider already has a booking at this time' };
  }

  return { available: true, reason: '' };
};

/**
 * Get all service requests with filtering and pagination.
 * @route GET /api/services
 * @access Public
 */
const getServices = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 12,
      serviceType,
      status,
      location,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const filter = {};

    if (serviceType) filter.serviceType = serviceType;
    if (status) filter.status = status;
    if (location) filter.location = { $regex: location, $options: 'i' };
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOrder = order === 'asc' ? 1 : -1;

    const [services, total] = await Promise.all([
      Service.find(filter)
        .populate('customer', 'name email avatar location')
        .populate('bids.provider', 'name email avatar specialties')
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit)),
      Service.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: services,
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
 * Get a single service request by ID.
 * @route GET /api/services/:id
 * @access Public
 */
const getService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('customer', 'name email avatar location phone')
      .populate('bids.provider', 'name email avatar specialties bio location');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new service request.
 * @route POST /api/services
 * @access Private (Customer)
 */
const createService = async (req, res, next) => {
  try {
    const serviceData = {
      ...req.body,
      customer: req.user._id,
    };

    const service = await Service.create(serviceData);
    await service.populate('customer', 'name email avatar');

    res.status(201).json({
      success: true,
      message: 'Service request created successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a service request.
 * @route PUT /api/services/:id
 * @access Private (Owner)
 */
const updateService = async (req, res, next) => {
  try {
    let service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (service.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this service request',
      });
    }

    const allowedUpdates = ['title', 'description', 'serviceType', 'location', 'preferredDate', 'preferredTime', 'budget', 'status'];
    const updates = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    service = await Service.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate('customer', 'name email avatar');

    res.status(200).json({
      success: true,
      message: 'Service request updated successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a service request.
 * @route DELETE /api/services/:id
 * @access Private (Owner/Admin)
 */
const deleteService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (service.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this service request',
      });
    }

    await Service.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Service request deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit a bid on a service request.
 * @route POST /api/services/:id/bids
 * @access Private (Provider)
 */
const submitBid = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (service.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'Service request is no longer accepting bids',
      });
    }

    const existingBid = service.bids.find(
      (bid) => bid.provider.toString() === req.user._id.toString()
    );

    if (existingBid) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a bid for this service',
      });
    }

    service.bids.push({
      provider: req.user._id,
      price: req.body.price,
      message: req.body.message || '',
      estimatedDuration: req.body.estimatedDuration || 60,
    });

    await service.save();
    await service.populate('bids.provider', 'name email avatar specialties');

    res.status(201).json({
      success: true,
      message: 'Bid submitted successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a bid.
 * @route PUT /api/services/:id/bids/:bidId
 * @access Private (Provider who submitted the bid)
 */
const updateBid = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    const bid = service.bids.id(req.params.bidId);

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found',
      });
    }

    if (bid.provider.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this bid',
      });
    }

    if (req.body.price !== undefined) bid.price = req.body.price;
    if (req.body.message !== undefined) bid.message = req.body.message;
    if (req.body.estimatedDuration !== undefined) bid.estimatedDuration = req.body.estimatedDuration;

    await service.save();
    await service.populate('bids.provider', 'name email avatar specialties');

    res.status(200).json({
      success: true,
      message: 'Bid updated successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get services by current user (customer's own requests).
 * @route GET /api/services/my/requests
 * @access Private (Customer)
 */
const getMyServices = async (req, res, next) => {
  try {
    const services = await Service.find({ customer: req.user._id })
      .populate('bids.provider', 'name email avatar specialties')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get open service requests for providers to bid on.
 * @route GET /api/services/open/requests
 * @access Private (Provider)
 */
const getOpenRequests = async (req, res, next) => {
  try {
    const { serviceType, location, search } = req.query;
    const filter = { status: 'open' };

    if (serviceType) filter.serviceType = serviceType;
    if (location) filter.location = { $regex: location, $options: 'i' };
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const services = await Service.find(filter)
      .populate('customer', 'name email avatar location')
      .populate('bids.provider', 'name email avatar specialties')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get in-progress service requests for providers who have an accepted bid.
 * @route GET /api/services/provider/active
 * @access Private (Provider)
 */
const getProviderActiveRequests = async (req, res, next) => {
  try {
    const services = await Service.find({
      status: 'in_progress',
      bids: {
        $elemMatch: {
          provider: req.user._id,
          status: 'accepted',
        },
      },
    })
      .populate('customer', 'name email avatar location')
      .populate('bids.provider', 'name email avatar specialties')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Select a bid for a service request.
 * This also creates a Booking automatically.
 * @route PUT /api/services/:id/select-bid/:bidId
 * @access Private (Customer)
 */
const selectBid = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (service.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to select a bid for this service request',
      });
    }

    const bid = service.bids.id(req.params.bidId);

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found',
      });
    }

    // Check provider availability and booking conflicts
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

    // Mark selected bid as accepted, others as rejected
    service.bids.forEach((b) => {
      if (b._id.toString() === bid._id.toString()) {
        b.status = 'accepted';
      } else {
        b.status = 'rejected';
      }
    });

    service.markModified('bids');
    service.selectedBid = bid._id;
    service.status = 'in_progress';

    await service.save();

    // Create a Booking automatically
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

    await service.populate('bids.provider', 'name email avatar specialties');

    res.status(200).json({
      success: true,
      message: 'Bid selected and booking created successfully',
      data: service,
      booking: booking,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
  submitBid,
  updateBid,
  getMyServices,
  getOpenRequests,
  selectBid,
  getProviderActiveRequests,
  checkProviderAvailability,
  parseTimeTo24h,
};
