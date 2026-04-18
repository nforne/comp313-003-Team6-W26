/**
 * @module pages/provider/Dashboard
 * @description Provider dashboard with stats and recent activity.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Briefcase, Calendar, CheckCircle, DollarSign, Star } from 'lucide-react';
import { bookingsAPI } from '../../api/bookings.api';
import { servicesAPI } from '../../api/services.api';
import Loading from '../../components/Loading';
import useAuth from '../../hooks/useAuth';

const Dashboard = () => {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [openRequests, setOpenRequests] = useState([]);
  const [activeRequests, setActiveRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [bookingsRes, requestsRes, activeRes] = await Promise.all([
        bookingsAPI.getMyBookings(),
        servicesAPI.getOpenRequests(),
        servicesAPI.getProviderActiveRequests(),
      ]);
      setBookings(bookingsRes.data.data || []);
      setOpenRequests(requestsRes.data.data || []);
      setActiveRequests(activeRes?.data?.data || []);
    } catch (error) {
      setActiveRequests([]);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const totalEarnings = completedBookings.reduce((sum, b) => sum + b.price, 0);
  const avgRating = completedBookings.filter((b) => b.rating).length > 0
    ? completedBookings.filter((b) => b.rating).reduce((sum, b) => sum + b.rating.score, 0) / completedBookings.filter((b) => b.rating).length
    : 0;

  const stats = [
    { label: 'Open Requests', value: openRequests?.length || 0, icon: Briefcase, color: 'text-apple-blue', bg: 'bg-blue-50' },
    { label: 'Active Bookings', value: activeRequests?.length || 0, icon: Calendar, color: 'text-apple-orange', bg: 'bg-orange-50' },
    { label: 'Completed', value: completedBookings.length, icon: CheckCircle, color: 'text-apple-green', bg: 'bg-green-50' },
    { label: 'Total Earnings', value: `$${totalEarnings}`, icon: DollarSign, color: 'text-apple-purple', bg: 'bg-purple-50' },
  ];

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">
          Here's your provider dashboard overview
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
          >
            <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-2`}>
              <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
            </div>
            <p className="text-[24px] font-bold text-apple-gray-900">{stat.value}</p>
            <p className="text-[12px] text-apple-gray-500">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Active Bookings */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[19px] font-semibold text-apple-gray-900">Active Bookings</h2>
        </div>
        {activeRequests.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-[40px] mb-2">📋</p>
            <p className="text-[14px] text-apple-gray-500">No active bookings</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeRequests.map((service) => (
              <Link
                key={service._id}
                to={`/services/${service._id}`}
                className="glass-card p-4 flex items-center justify-between no-underline block"
              >
                <div>
                  <p className="text-[14px] font-semibold text-apple-gray-900">{service.title}</p>
                  <p className="text-[12px] text-apple-gray-500">{service.location} · {service.serviceType}</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold text-apple-green">
                    ${service.budget?.min} - ${service.budget?.max}
                  </p>
                  <p className="text-[11px] text-apple-gray-400">{service.bids?.length || 0} bids</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>

      {/* Recent Open Requests */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[19px] font-semibold text-apple-gray-900">Open Requests</h2>
          <Link to="/provider/services" className="text-[13px] font-medium text-apple-blue no-underline">
            View All
          </Link>
        </div>
        {openRequests.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-[40px] mb-2">📋</p>
            <p className="text-[14px] text-apple-gray-500">No open requests available</p>
          </div>
        ) : (
          <div className="space-y-3">
            {openRequests.slice(0, 5).map((service) => (
              <Link
                key={service._id}
                to={`/services/${service._id}`}
                className="glass-card p-4 flex items-center justify-between no-underline block"
              >
                <div>
                  <p className="text-[14px] font-semibold text-apple-gray-900">{service.title}</p>
                  <p className="text-[12px] text-apple-gray-500">{service.location} · {service.serviceType}</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold text-apple-green">
                    ${service.budget?.min} - ${service.budget?.max}
                  </p>
                  <p className="text-[11px] text-apple-gray-400">{service.bids?.length || 0} bids</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>

      {/* Recent Bookings */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[19px] font-semibold text-apple-gray-900">Recent Bookings</h2>
          <Link to="/provider/bookings" className="text-[13px] font-medium text-apple-blue no-underline">
            View All
          </Link>
        </div>
        {bookings.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-[40px] mb-2">📅</p>
            <p className="text-[14px] text-apple-gray-500">No bookings yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.slice(0, 5).map((booking) => (
              <Link
                key={booking._id}
                to={`/provider/bookings/${booking._id}`}
                className="glass-card p-4 flex items-center justify-between no-underline block"
              >
                <div>
                  <span className={`apple-badge text-[11px] status-${booking.status} mb-1`}>
                    {booking.status.replace('_', ' ')}
                  </span>
                  <p className="text-[14px] font-semibold text-apple-gray-900">{booking.service?.title}</p>
                  <p className="text-[12px] text-apple-gray-500">Customer: {booking.customer?.name}</p>
                </div>
                <p className="text-[18px] font-bold text-apple-gray-900">${booking.price}</p>
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Dashboard;
