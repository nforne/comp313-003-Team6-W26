/**
 * @module models/Service
 * @description Service Request model for the Booking Platform.
 * Represents a service request posted by a customer.
 * Providers can submit bids on open service requests.
 */

const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    price: {
      type: Number,
      required: [true, 'Bid price is required'],
      min: [0, 'Price cannot be negative'],
    },
    message: {
      type: String,
      maxlength: [500, 'Message cannot exceed 500 characters'],
      default: '',
    },
    estimatedDuration: {
      type: Number,
      default: 60,
      min: [15, 'Duration must be at least 15 minutes'],
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

const serviceSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Service title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Service description is required'],
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    serviceType: {
      type: String,
      required: [true, 'Service type is required'],
      enum: [
        'haircut',
        'massage',
        'cleaning',
        'plumbing',
        'electrical',
        'tutoring',
        'photography',
        'catering',
        'fitness',
        'beauty',
        'repair',
        'moving',
        'gardening',
        'painting',
        'other',
      ],
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    preferredDate: {
      type: Date,
      required: [true, 'Preferred date is required'],
    },
    preferredTime: {
      type: String,
      required: [true, 'Preferred time is required'],
    },
    budget: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'completed', 'cancelled'],
      default: 'open',
    },
    bids: [bidSchema],
    selectedBid: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Virtual field: number of bids.
 */
serviceSchema.virtual('bidCount').get(function () {
  return this.bids ? this.bids.length : 0;
});

/**
 * Virtual field: lowest bid price.
 */
serviceSchema.virtual('lowestBid').get(function () {
  if (!this.bids || this.bids.length === 0) return null;
  return Math.min(...this.bids.map((b) => b.price));
});

module.exports = mongoose.model('Service', serviceSchema);
