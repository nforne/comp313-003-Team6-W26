/**
 * @module pages/customer/MyBookings
 * @description Customer bookings page with Upcoming and Previous tabs.
 * Upcoming bookings show confirmed/in-progress bookings.
 * Previous bookings show completed/cancelled bookings with review capability.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, Clock, MapPin, Star, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { bookingsAPI } from '../../api/bookings.api';
import { createReview } from '../../api/reviews.api';
import Loading from '../../components/Loading';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  confirmed: 'bg-blue-100 text-blue-700 border-blue-300',
  in_progress: 'bg-orange-100 text-orange-700 border-orange-300',
  completed: 'bg-green-100 text-green-700 border-green-300',
  cancelled: 'bg-red-100 text-red-700 border-red-300',
};

const MyBookings = () => {
  const [activeTab, setActiveTab] = useState('upcoming');
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [previousBookings, setPreviousBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Rating modal state
  const [showRateModal, setShowRateModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const [upcomingRes, previousRes] = await Promise.all([
        bookingsAPI.getUpcoming(),
        bookingsAPI.getPrevious(),
      ]);
      setUpcomingBookings(upcomingRes.data.data || []);
      setPreviousBookings(previousRes.data.data || []);
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const isRated = (booking) => {
    return booking?.rating != null || booking?.review != null;
  };

  const canRate = (booking) => {
    return booking?.status === 'completed' && !isRated(booking);
  };

  const openRateModal = (booking, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setSelectedBooking(booking);
    setRatingValue(5);
    setComment('');
    setShowRateModal(true);
  };

  const closeRateModal = () => {
    setShowRateModal(false);
    setSelectedBooking(null);
    setSubmitting(false);
  };

  const handleSubmitRating = async () => {
    if (!selectedBooking?._id) return;
    const r = Number(ratingValue);
    if (Number.isNaN(r) || r < 1 || r > 5) {
      toast.error('Rating must be 1 to 5');
      return;
    }
    setSubmitting(true);
    try {
      // Try the bookings API rating endpoint first
      await bookingsAPI.submitRating(selectedBooking._id, {
        score: r,
        comment: comment?.trim() || '',
      });
      toast.success('Review submitted!');
      closeRateModal();
      fetchBookings();
    } catch (err) {
      // Fallback to reviews API
      try {
        await createReview({
          bookingId: selectedBooking._id,
          rating: r,
          comment: comment?.trim() || '',
        });
        toast.success('Review submitted!');
        closeRateModal();
        fetchBookings();
      } catch (err2) {
        const msg = err2?.response?.data?.message || err?.response?.data?.message || 'Failed to submit review';
        toast.error(msg);
        setSubmitting(false);
      }
    }
  };

  if (loading) return <Loading />;

  const currentBookings = activeTab === 'upcoming' ? upcomingBookings : previousBookings;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">My Bookings</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">
          View and manage your service bookings
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-apple-gray-100 rounded-xl mb-6 w-fit">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'upcoming'
              ? 'bg-white text-apple-blue shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          Upcoming ({upcomingBookings.length})
        </button>
        <button
          onClick={() => setActiveTab('previous')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'previous'
              ? 'bg-white text-apple-blue shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          Previous ({previousBookings.length})
        </button>
      </div>

      {/* Bookings List */}
      {currentBookings.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-12 text-center"
        >
          <Calendar className="w-12 h-12 text-apple-gray-300 mx-auto mb-3" />
          <p className="text-[17px] font-semibold text-apple-gray-500 mb-1">
            {activeTab === 'upcoming' ? 'No upcoming bookings' : 'No previous bookings'}
          </p>
          <p className="text-[14px] text-apple-gray-400">
            {activeTab === 'upcoming'
              ? 'When you accept a bid on your service request, it will appear here.'
              : 'Your completed and cancelled bookings will appear here.'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {currentBookings.map((booking, i) => (
            <motion.div
              key={booking._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link
                to={`/customer/bookings/${booking._id}`}
                className="glass-card p-5 flex items-center justify-between no-underline block hover:shadow-md transition-shadow"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`apple-badge text-[11px] ${statusColors[booking.status] || ''}`}>
                      {booking.status.replace('_', ' ')}
                    </span>
                    {booking.status === 'completed' && !isRated(booking) && (
                      <span className="apple-badge text-[11px] bg-purple-100 text-purple-700 border-purple-300">
                        <Star className="w-3 h-3 inline mr-0.5" />
                        Rate Now
                      </span>
                    )}
                    {isRated(booking) && (
                      <span className="flex items-center gap-0.5 text-[12px] text-yellow-600">
                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                        {booking.rating?.score || 0}/5
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] font-semibold text-apple-gray-900 mb-1">
                    {booking.service?.title || 'Service'}
                  </p>
                  <div className="flex items-center gap-4 text-[12px] text-apple-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(booking.scheduledDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {booking.scheduledTime}
                    </span>
                    {booking.service?.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {booking.service.location}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-apple-gray-400 mt-1">
                    Provider: {booking.provider?.name}
                  </p>
                  {canRate(booking) && (
                    <div className="mt-3">
                      <button
                        onClick={(e) => openRateModal(booking, e)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold bg-yellow-500 text-white hover:bg-yellow-600 transition"
                        type="button"
                      >
                        <Star className="w-4 h-4 fill-white" />
                        Rate / Review
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-[20px] font-bold text-apple-gray-900">${booking.price}</p>
                  <ChevronRight className="w-5 h-5 text-apple-gray-300" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {/* Rating Modal */}
      {showRateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={closeRateModal}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg glass-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-[18px] font-bold text-apple-gray-900">Leave a Review</h3>
                <p className="text-[13px] text-apple-gray-500">
                  {selectedBooking?.service?.title || 'Service'}
                </p>
              </div>
              <button
                onClick={closeRateModal}
                className="p-2 rounded-full hover:bg-apple-gray-100 transition"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-apple-gray-800">Rating</label>
                <div className="mt-2 flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRatingValue(n)}
                      className="p-1"
                      type="button"
                    >
                      <Star
                        className={`w-8 h-8 transition-colors ${
                          n <= ratingValue
                            ? 'text-yellow-500 fill-yellow-500'
                            : 'text-apple-gray-200'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[13px] font-semibold text-apple-gray-800">Comment</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-2xl bg-white/70 border border-apple-gray-200 px-4 py-3 text-[13px] outline-none focus:ring-2 focus:ring-apple-blue"
                  placeholder="Share your experience (optional)..."
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={closeRateModal}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold bg-apple-gray-100 text-apple-gray-700 hover:bg-apple-gray-200 transition"
                  type="button"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRating}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold bg-apple-blue text-white hover:opacity-90 transition"
                  type="button"
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyBookings;
