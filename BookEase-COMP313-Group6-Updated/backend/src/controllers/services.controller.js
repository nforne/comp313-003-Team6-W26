/**
 * @module controllers/services
 * @description Service request controller.
 * Handles CRUD operations for service requests and bid management.
 */

const Service = require('../models/Service.model');

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
};
