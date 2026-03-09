/**
 * @module pages/provider/ProviderBookings
 * @description Provider's bookings management page.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, MapPin, Clock, Star, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { bookingsAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const ProviderBookings = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (id) {
      fetchBookingDetail();
    } else {
      fetchBookings();
    }
  }, [id, filter]);

  const fetchBookings = async () => {
    try {
      const params = {};
      if (filter) params.status = filter;
      const res = await bookingsAPI.getMyBookings(params);
      setBookings(res.data.data);
    } catch (error) {
      console.error(error);
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

  
  if (id && booking) {
    return (
      <div className="max-w-[700px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => navigate('/provider/bookings')}
            className="flex items-center gap-2 text-apple-blue text-[14px] font-medium mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Bookings
          </button>

          <div className="glass-card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <span className={`apple-badge status-${booking.status}`}>
                {booking.status.replace('_', ' ')}
              </span>
              <span className="text-[24px] font-bold text-apple-gray-900">${booking.price}</span>
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


  const statusFilters = ['', 'confirmed', 'in_progress', 'completed', 'cancelled'];

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mb-1">My Bookings</h1>
        <p className="text-[15px] text-apple-gray-500 mb-6">Manage your service bookings</p>
      </motion.div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {statusFilters.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all ${
              filter === s ? 'bg-apple-green text-white' : 'bg-apple-gray-100 text-apple-gray-600 hover:bg-apple-gray-200'
            }`}
          >
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      {bookings.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">📅</p>
          <p className="text-[14px] text-apple-gray-500">No bookings found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b, i) => (
            <motion.div key={b._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={`/provider/bookings/${b._id}`} className="glass-card p-4 flex items-center justify-between no-underline block">
                <div>
                  <span className={`apple-badge text-[11px] status-${b.status} mb-1`}>{b.status.replace('_', ' ')}</span>
                  <p className="text-[14px] font-semibold text-apple-gray-900">{b.service?.title}</p>
                  <p className="text-[12px] text-apple-gray-500">Customer: {b.customer?.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-[18px] font-bold text-apple-gray-900">${b.price}</p>
                  <p className="text-[11px] text-apple-gray-400">{new Date(b.scheduledDate).toLocaleDateString()}</p>
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
