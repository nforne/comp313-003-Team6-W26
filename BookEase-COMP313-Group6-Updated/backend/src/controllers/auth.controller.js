/**
 * @module controllers/auth
 * @description Authentication controller.
 * Handles user registration, login, profile retrieval, and profile updates.
 */

const User = require('../models/User.model');

/**
 * Register a new user.
 * @route POST /api/auth/register
 * @access Public
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, bio, location, specialties } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'customer',
      phone: phone || '',
      bio: bio || '',
      location: location || '',
      specialties: specialties || [],
    });

    const token = user.generateToken();

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          bio: user.bio,
          location: user.location,
          specialties: user.specialties,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user.
 * @route POST /api/auth/login
 * @access Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const token = user.generateToken();

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          bio: user.bio,
          location: user.location,
          specialties: user.specialties,
          favorites: user.favorites,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user profile.
 * @route GET /api/auth/me
 * @access Private
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('favorites');
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update current user profile.
 * @route PUT /api/auth/me
 * @access Private
 */
const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'phone', 'bio', 'location', 'specialties', 'avatar'];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password.
 * @route PUT /api/auth/password
 * @access Private
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    const token = user.generateToken();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      data: { token },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Toggle favorite service.
 * @route POST /api/auth/favorites/:id
 * @access Private
 */
const toggleFavorite = async (req, res, next) => {
  try {
    const serviceId = req.params.id;
    const user = await User.findById(req.user._id);

    const index = user.favorites.indexOf(serviceId);
    if (index > -1) {
      user.favorites.splice(index, 1);
    } else {
      user.favorites.push(serviceId);
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: index > -1 ? 'Removed from favorites' : 'Added to favorites',
      data: user.favorites,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  toggleFavorite,
};
