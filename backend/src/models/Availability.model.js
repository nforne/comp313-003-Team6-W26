/**
 * @module models/Availability
 * @description Availability model for the Booking Platform.
 * Represents time slots when a provider is available for bookings.
 * Supports recurring weekly schedules and specific date overrides.
 */

const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema(
  {
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
    },
  },
  { _id: false }
);

const availabilitySchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    slots: [timeSlotSchema],
    isAvailable: {
      type: Boolean,
      default: true,
    },
    specificDate: {
      type: Date,
      default: null,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Compound index to ensure unique availability per provider per day.
 */
availabilitySchema.index({ provider: 1, dayOfWeek: 1 }, { unique: true, partialFilterExpression: { specificDate: null } });

module.exports = mongoose.model('Availability', availabilitySchema);
