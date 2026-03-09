/**
 * @module controllers/admin
 * @description Admin controller.
 * Handles administrative operations including user management,
 * booking oversight, review moderation, and reporting.
 */

const User = require('../models/User.model');
const Service = require('../models/Service.model');
const Booking = require('../models/Booking.model');

/**
 * Get dashboard statistics.
 * @route GET /api/admin/dashboard
 * @access Private (Admin)
 */
const getDashboard = async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalCustomers,
      totalProviders,
      totalServices,
      openServices,
      totalBookings,
      completedBookings,
      cancelledBookings,
      recentBookings,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'provider' }),
      Service.countDocuments(),
      Service.countDocuments({ status: 'open' }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'completed' }),
      Booking.countDocuments({ status: 'cancelled' }),
      Booking.find()
        .populate('customer', 'name email')
        .populate('provider', 'name email')
        .populate('service', 'title serviceType')
        .sort({ createdAt: -1 })
        .limit(10),
      User.find().sort({ createdAt: -1 }).limit(10).select('-password'),
    ]);

    // Revenue calculation
    const revenueData = await Booking.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$price' } } },
    ]);

    const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalCustomers,
          totalProviders,
          totalServices,
          openServices,
          totalBookings,
          completedBookings,
          cancelledBookings,
          totalRevenue,
        },
        recentBookings,
        recentUsers,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users with filtering and pagination.
 * @route GET /api/admin/users
 * @access Private (Admin)
 */
const getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, search, isActive } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: users,
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
 * Update user status (activate/deactivate).
 * @route PUT /api/admin/users/:id
 * @access Private (Admin)
 */
const updateUser = async (req, res, next) => {
  try {
    const { isActive, role } = req.body;
    const updates = {};

    if (isActive !== undefined) updates.isActive = isActive;
    if (role) updates.role = role;

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a user.
 * @route DELETE /api/admin/users/:id
 * @access Private (Admin)
 */
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all bookings (admin view).
 * @route GET /api/admin/bookings
 * @access Private (Admin)
 */
const getAllBookings = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customer', 'name email avatar')
        .populate('provider', 'name email avatar')
        .populate('service', 'title serviceType location')
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
 * Get all reviews for moderation.
 * @route GET /api/admin/reviews
 * @access Private (Admin)
 */
const getReviews = async (req, res, next) => {
  try {
    const { flagged } = req.query;
    const filter = { rating: { $exists: true, $ne: null } };

    if (flagged === 'true') {
      filter['rating.isFlagged'] = true;
    }

    const bookings = await Booking.find(filter)
      .populate('customer', 'name email avatar')
      .populate('provider', 'name email avatar')
      .populate('service', 'title serviceType')
      .select('rating customer provider service createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Moderate a review (flag/unflag/approve).
 * @route PUT /api/admin/reviews/:id
 * @access Private (Admin)
 */
const moderateReview = async (req, res, next) => {
  try {
    const { isFlagged, isModerated } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking || !booking.rating) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (isFlagged !== undefined) booking.rating.isFlagged = isFlagged;
    if (isModerated !== undefined) booking.rating.isModerated = isModerated;

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Review moderated successfully',
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a review.
 * @route DELETE /api/admin/reviews/:id
 * @access Private (Admin)
 */
const deleteReview = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking || !booking.rating) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    booking.rating = undefined;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get providers list with stats.
 * @route GET /api/admin/providers
 * @access Private (Admin)
 */
const getProviders = async (req, res, next) => {
  try {
    const providers = await User.find({ role: 'provider' }).select('-password');

    const providersWithStats = await Promise.all(
      providers.map(async (provider) => {
        const [totalBookings, completedBookings, ratingData] = await Promise.all([
          Booking.countDocuments({ provider: provider._id }),
          Booking.countDocuments({ provider: provider._id, status: 'completed' }),
          Booking.aggregate([
            { $match: { provider: provider._id, rating: { $exists: true } } },
            { $group: { _id: null, avgRating: { $avg: '$rating.score' }, count: { $sum: 1 } } },
          ]),
        ]);

        return {
          ...provider.toObject(),
          stats: {
            totalBookings,
            completedBookings,
            averageRating: ratingData.length > 0 ? Math.round(ratingData[0].avgRating * 10) / 10 : 0,
            totalReviews: ratingData.length > 0 ? ratingData[0].count : 0,
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: providersWithStats,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  getUsers,
  updateUser,
  deleteUser,
  getAllBookings,
  getReviews,
  moderateReview,
  deleteReview,
  getProviders,
};
