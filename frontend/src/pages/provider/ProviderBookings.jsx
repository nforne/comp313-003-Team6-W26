/**
 * @module pages/provider/ProviderBookings
 * @description Provider bookings page with Upcoming and Previous tabs.
 * Upcoming bookings show confirmed/in-progress bookings.
 * Previous bookings show completed/cancelled bookings.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, MapPin, Clock, Star, ArrowLeft, User, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { bookingsAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  confirmed: 'bg-blue-100 text-blue-700 border-blue-300',
  in_progress: 'bg-orange-100 text-orange-700 border-orange-300',
  completed: 'bg-green-100 text-green-700 border-green-300',
  cancelled: 'bg-red-100 text-red-700 border-red-300',
};

const ProviderBookings = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('upcoming');
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [previousBookings, setPreviousBookings] = useState([]);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchBookingDetail();
    } else {
      fetchBookings();
    }
  }, [id]);

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

  const fetchBookingDetail = async () => {
    try {
      const res = await bookingsAPI.getById(id);
      setBooking(res.data.data);
    } catch (error) {
      toast.error('Booking not found');
      navigate('/provider/bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (bookingId, status) => {
    try {
      await bookingsAPI.updateStatus(bookingId, { status });
      toast.success(`Booking ${status}`);
      if (id) fetchBookingDetail();
      else fetchBookings();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update');
    }
  };

  if (loading) return <Loading />;

  // Detail view
  if (id && booking) {
    return (
      <div className="max-w-[700px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => navigate('/provider/bookings')}
            className="flex items-center gap-2 text-apple-green text-[14px] font-medium mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Bookings
          </button>

          <div className="glass-card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <span className={`apple-badge ${statusColors[booking.status] || ''}`}>
                {booking.status.replace('_', ' ')}
              </span>
              <span className="text-[24px] font-bold text-apple-green">${booking.price}</span>
            </div>
            <h1 className="text-[22px] font-bold text-apple-gray-900 mb-2">{booking.service?.title}</h1>
            <p className="text-[13px] text-apple-gray-500">
              Customer: <span className="font-medium text-apple-gray-700">{booking.customer?.name}</span>
              {' · '}{booking.customer?.email}
            </p>
            <div className="flex items-center gap-4 mt-3 text-[13px] text-apple-gray-500">
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{booking.service?.location}</span>
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{booking.scheduledTime}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{new Date(booking.scheduledDate).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-[17px] font-semibold text-apple-gray-900 mb-3">Actions</h2>
            <div className="flex gap-2 flex-wrap">
              {booking.status === 'confirmed' && (
                <>
                  <button onClick={() => handleStatusUpdate(booking._id, 'in_progress')} className="apple-btn apple-btn-primary apple-btn-sm">
                    Start Service
                  </button>
                  <button onClick={() => handleStatusUpdate(booking._id, 'cancelled')} className="apple-btn apple-btn-danger apple-btn-sm">
                    Cancel
                  </button>
                </>
              )}
              {booking.status === 'in_progress' && (
                <button onClick={() => handleStatusUpdate(booking._id, 'completed')} className="apple-btn apple-btn-success apple-btn-sm">
                  Mark Completed
                </button>
              )}
              {(booking.status === 'completed' || booking.status === 'cancelled') && (
                <p className="text-[13px] text-apple-gray-500">No actions available for this booking.</p>
              )}
            </div>
            {booking.rating && (
              <div className="mt-4 pt-4 border-t border-apple-gray-100">
                <p className="text-[13px] font-semibold text-apple-gray-700 mb-1">Customer Rating</p>
                <div className="flex items-center gap-1 mb-1">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-4 h-4 ${s <= booking.rating.score ? 'text-yellow-500 fill-yellow-500' : 'text-apple-gray-200'}`} />
                  ))}
                </div>
                {booking.rating.comment && <p className="text-[13px] text-apple-gray-600">{booking.rating.comment}</p>}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  // List view with tabs
  const currentBookings = activeTab === 'upcoming' ? upcomingBookings : previousBookings;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">My Bookings</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">
          Manage your upcoming and past service bookings
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-apple-gray-100 rounded-xl mb-6 w-fit">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'upcoming'
              ? 'bg-white text-apple-green shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          Upcoming ({upcomingBookings.length})
        </button>
        <button
          onClick={() => setActiveTab('previous')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'previous'
              ? 'bg-white text-apple-green shadow-sm'
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
              ? 'When a customer accepts your bid, the booking will appear here.'
              : 'Your completed and cancelled bookings will appear here.'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {currentBookings.map((b, i) => (
            <motion.div
              key={b._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link
                to={`/provider/bookings/${b._id}`}
                className="glass-card p-5 flex items-center justify-between no-underline block hover:shadow-md transition-shadow"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`apple-badge text-[11px] ${statusColors[b.status] || ''}`}>
                      {b.status.replace('_', ' ')}
                    </span>
                    {b.rating && (
                      <span className="flex items-center gap-0.5 text-[12px] text-yellow-600">
                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                        {b.rating.score}/5
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] font-semibold text-apple-gray-900 mb-1">
                    {b.service?.title || 'Service'}
                  </p>
                  <div className="flex items-center gap-4 text-[12px] text-apple-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(b.scheduledDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {b.scheduledTime}
                    </span>
                    {b.service?.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {b.service.location}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-apple-gray-400 mt-1">
                    <User className="w-3 h-3 inline mr-1" />
                    Customer: {b.customer?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-[20px] font-bold text-apple-green">${b.price}</p>
                  <ChevronRight className="w-5 h-5 text-apple-gray-300" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProviderBookings;
