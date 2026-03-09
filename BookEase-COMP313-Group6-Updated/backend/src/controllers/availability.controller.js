/**
 * @module controllers/availability
 * @description Availability controller.
 * Handles provider availability management including
 * weekly schedules and specific date overrides.
 */

const Availability = require('../models/Availability.model');

/**
 * Get provider's availability schedule.
 * @route GET /api/availability
 * @access Private (Provider)
 */
const getMyAvailability = async (req, res, next) => {
  try {
    const availability = await Availability.find({
      provider: req.user._id,
    }).sort({ dayOfWeek: 1 });

    res.status(200).json({
      success: true,
      data: availability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific provider's availability (public).
 * @route GET /api/availability/provider/:id
 * @access Public
 */
const getProviderAvailability = async (req, res, next) => {
  try {
    const availability = await Availability.find({
      provider: req.params.id,
      isAvailable: true,
    }).sort({ dayOfWeek: 1 });

    res.status(200).json({
      success: true,
      data: availability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Set or update availability for a day.
 * @route PUT /api/availability
 * @access Private (Provider)
 */
const setAvailability = async (req, res, next) => {
  try {
    const { dayOfWeek, slots, isAvailable } = req.body;

    const availability = await Availability.findOneAndUpdate(
      {
        provider: req.user._id,
        dayOfWeek,
        specificDate: null,
      },
      {
        provider: req.user._id,
        dayOfWeek,
        slots: slots || [],
        isAvailable: isAvailable !== undefined ? isAvailable : true,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: 'Availability updated successfully',
      data: availability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Set bulk availability for multiple days.
 * @route PUT /api/availability/bulk
 * @access Private (Provider)
 */
const setBulkAvailability = async (req, res, next) => {
  try {
    const { schedule } = req.body;

    if (!Array.isArray(schedule)) {
      return res.status(400).json({
        success: false,
        message: 'Schedule must be an array',
      });
    }

    const operations = schedule.map((item) => ({
      updateOne: {
        filter: {
          provider: req.user._id,
          dayOfWeek: item.dayOfWeek,
          specificDate: null,
        },
        update: {
          provider: req.user._id,
          dayOfWeek: item.dayOfWeek,
          slots: item.slots || [],
          isAvailable: item.isAvailable !== undefined ? item.isAvailable : true,
        },
        upsert: true,
      },
    }));

    await Availability.bulkWrite(operations);

    const availability = await Availability.find({
      provider: req.user._id,
    }).sort({ dayOfWeek: 1 });

    res.status(200).json({
      success: true,
      message: 'Availability schedule updated successfully',
      data: availability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Block a specific date.
 * @route POST /api/availability/block
 * @access Private (Provider)
 */
const blockDate = async (req, res, next) => {
  try {
    const { date } = req.body;

    const blocked = await Availability.create({
      provider: req.user._id,
      dayOfWeek: new Date(date).getDay(),
      specificDate: new Date(date),
      isBlocked: true,
      isAvailable: false,
      slots: [],
    });

    res.status(201).json({
      success: true,
      message: 'Date blocked successfully',
      data: blocked,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unblock a specific date.
 * @route DELETE /api/availability/block/:id
 * @access Private (Provider)
 */
const unblockDate = async (req, res, next) => {
  try {
    const blocked = await Availability.findOneAndDelete({
      _id: req.params.id,
      provider: req.user._id,
      isBlocked: true,
    });

    if (!blocked) {
      return res.status(404).json({
        success: false,
        message: 'Blocked date not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Date unblocked successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyAvailability,
  getProviderAvailability,
  setAvailability,
  setBulkAvailability,
  blockDate,
  unblockDate,
};
