/**
 * @module pages/customer/BookingDetail
 * @description Booking detail page with status management and rating.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Clock, DollarSign, User, Star, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { bookingsAPI } from '../../api/bookings.api';
import { createReview } from '../../api/reviews.api';
import Loading from '../../components/Loading';
import useAuth from '../../hooks/useAuth';

const BookingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ratingForm, setRatingForm] = useState({ score: 5, comment: '' });
  const [showRating, setShowRating] = useState(false);

  useEffect(() => {
    fetchBooking();
  }, [id]);

  const fetchBooking = async () => {
    try {
      const res = await bookingsAPI.getById(id);
      setBooking(res.data.data);
    } catch (error) {
      toast.error('Booking not found');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (status, reason) => {
    try {
      await bookingsAPI.updateStatus(id, { status, cancellationReason: reason });
      toast.success(`Booking ${status}`);
      fetchBooking();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    }
  };

  const handleSubmitRating = async (e) => {
    e.preventDefault();
    try {
      // Try the bookings API rating endpoint first
      await bookingsAPI.submitRating(id, {
        score: ratingForm.score,
        comment: ratingForm.comment,
      });
      toast.success('Review submitted!');
      setShowRating(false);
      fetchBooking();
    } catch (error) {
      // Fallback to reviews API
      try {
        await createReview({
          bookingId: id,
          rating: ratingForm.score,
          comment: ratingForm.comment,
        });
        toast.success('Review submitted!');
        setShowRating(false);
        fetchBooking();
      } catch (err2) {
        toast.error(err2.response?.data?.message || error.response?.data?.message || 'Failed to submit review');
      }
    }
  };

  if (loading) return <Loading />;
  if (!booking) return null;

  const isCustomer = user?.role === 'customer';

  return (
    <div className="max-w-[700px] mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-apple-blue text-[14px] font-medium mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bookings
        </button>

        {/* Booking Info */}
        <div className="glass-card p-6 mb-5">
          <div className="flex items-center justify-between mb-4">
            <span className={`apple-badge status-${booking.status}`}>
              {booking.status.replace('_', ' ')}
            </span>
            <span className="text-[24px] font-bold text-apple-gray-900">${booking.price}</span>
          </div>

          <h1 className="text-[22px] font-bold text-apple-gray-900 mb-4">
            {booking.service?.title}
          </h1>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-[13px] text-apple-gray-600">
              <MapPin className="w-4 h-4 text-apple-gray-400" />
              {booking.service?.location}
            </div>
            <div className="flex items-center gap-2 text-[13px] text-apple-gray-600">
              <Clock className="w-4 h-4 text-apple-gray-400" />
              {new Date(booking.scheduledDate).toLocaleDateString()} · {booking.scheduledTime}
            </div>
          </div>
        </div>

        {/* Provider Info */}
        <div className="glass-card p-6 mb-5">
          <h2 className="text-[17px] font-semibold text-apple-gray-900 mb-3">
            {isCustomer ? 'Service Provider' : 'Customer'}
          </h2>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full gradient-green flex items-center justify-center">
              <span className="text-white font-semibold">
                {(isCustomer ? booking.provider?.name : booking.customer?.name)?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[15px] font-semibold text-apple-gray-900">
                {isCustomer ? booking.provider?.name : booking.customer?.name}
              </p>
              <div className="flex items-center gap-3 mt-1 text-[12px] text-apple-gray-500">
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {isCustomer ? booking.provider?.email : booking.customer?.email}
                </span>
                {(isCustomer ? booking.provider?.phone : booking.customer?.phone) && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {isCustomer ? booking.provider?.phone : booking.customer?.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="glass-card p-6 mb-5">
          <h2 className="text-[17px] font-semibold text-apple-gray-900 mb-3">Actions</h2>
          <div className="flex gap-2 flex-wrap">
            {booking.status === 'confirmed' && (
              <>
                <button
                  onClick={() => handleStatusUpdate('in_progress')}
                  className="apple-btn apple-btn-primary apple-btn-sm"
                >
                  Start Service
                </button>
                <button
                  onClick={() => handleStatusUpdate('cancelled', 'Cancelled by user')}
                  className="apple-btn apple-btn-danger apple-btn-sm"
                >
                  Cancel Booking
                </button>
              </>
            )}
            {booking.status === 'in_progress' && (
              <button
                onClick={() => handleStatusUpdate('completed')}
                className="apple-btn apple-btn-success apple-btn-sm"
              >
                Mark as Completed
              </button>
            )}
            {booking.status === 'completed' && isCustomer && !booking.rating && (
              <button
                onClick={() => setShowRating(!showRating)}
                className="apple-btn apple-btn-primary apple-btn-sm"
              >
                <Star className="w-3.5 h-3.5" />
                Rate Provider
              </button>
            )}
          </div>
        </div>

        {/* Rating Form */}
        {showRating && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 mb-5"
          >
            <h2 className="text-[17px] font-semibold text-apple-gray-900 mb-3">Rate Your Experience</h2>
            <form onSubmit={handleSubmitRating} className="space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-apple-gray-700 mb-2">Rating</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRatingForm({ ...ratingForm, score: s })}
                      className="p-1"
                    >
                      <Star
                        className={`w-8 h-8 transition-colors ${
                          s <= ratingForm.score
                            ? 'text-yellow-500 fill-yellow-500'
                            : 'text-apple-gray-200'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Comment</label>
                <textarea
                  value={ratingForm.comment}
                  onChange={(e) => setRatingForm({ ...ratingForm, comment: e.target.value })}
                  placeholder="Share your experience..."
                  rows={3}
                  className="glass-input resize-none"
                />
              </div>
              <button type="submit" className="apple-btn apple-btn-primary w-full">
                Submit Rating
              </button>
            </form>
          </motion.div>
        )}

        {/* Existing Rating */}
        {booking.rating && (
          <div className="glass-card p-6">
            <h2 className="text-[17px] font-semibold text-apple-gray-900 mb-3">Your Rating</h2>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-5 h-5 ${
                    s <= booking.rating.score ? 'text-yellow-500 fill-yellow-500' : 'text-apple-gray-200'
                  }`}
                />
              ))}
            </div>
            {booking.rating.comment && (
              <p className="text-[14px] text-apple-gray-600">{booking.rating.comment}</p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default BookingDetail;
