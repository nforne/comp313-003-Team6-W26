/**
 * @module pages/customer/Dashboard
 * @description Customer dashboard with service request creation and overview.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Calendar, Clock, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesAPI } from '../../api/services.api';
import { bookingsAPI } from '../../api/bookings.api';
import BookingForm from '../../components/BookingForm';
import useAuth from '../../hooks/useAuth';

const Dashboard = () => {
  const { user } = useAuth();
  const [myServices, setMyServices] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [servicesRes, bookingsRes] = await Promise.all([
        servicesAPI.getMyRequests(),
        bookingsAPI.getMyBookings(),
      ]);
      setMyServices(servicesRes.data.data);
      setMyBookings(bookingsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateService = async (data) => {
    try {
      await servicesAPI.create(data);
      toast.success('Service request created!');
      setShowForm(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create request');
    }
  };

  const stats = [
    { label: 'Active Requests', value: myServices.filter((s) => s.status === 'open').length, icon: Clock, color: 'text-apple-blue', bg: 'bg-blue-50' },
    { label: 'Total Bookings', value: myBookings.length, icon: Calendar, color: 'text-apple-purple', bg: 'bg-purple-50' },
    { label: 'Completed', value: myBookings.filter((b) => b.status === 'completed').length, icon: CheckCircle, color: 'text-apple-green', bg: 'bg-green-50' },
    { label: 'Cancelled', value: myBookings.filter((b) => b.status === 'cancelled').length, icon: XCircle, color: 'text-apple-red', bg: 'bg-red-50' },
  ];

  return (
    <div>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">
          Manage your service requests and bookings
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

      {/* Create Request */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-8"
      >
        <button
          onClick={() => setShowForm(!showForm)}
          className="apple-btn apple-btn-primary mb-4"
        >
          <Plus className="w-4 h-4" />
          {showForm ? 'Cancel' : 'New Service Request'}
        </button>

        {showForm && (
          <div className="glass-card p-6">
            <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">
              Create Service Request
            </h2>
            <BookingForm onSubmit={handleCreateService} submitText="Post Request" />
          </div>
        )}
      </motion.div>

      {/* My Service Requests */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">
          My Service Requests
        </h2>
        {myServices.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-[40px] mb-2">📋</p>
            <p className="text-[15px] text-apple-gray-500">No service requests yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myServices.map((service) => (
              <Link
                key={service._id}
                to={`/services/${service._id}`}
                className="glass-card p-4 flex items-center justify-between no-underline block"
              >
                <div className="flex items-center gap-3">
                  <span className={`apple-badge text-[11px] status-${service.status}`}>
                    {service.status.replace('_', ' ')}
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold text-apple-gray-900">{service.title}</p>
                    <p className="text-[12px] text-apple-gray-500">{service.location} · {service.serviceType}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold text-apple-blue">{service.bids?.length || 0} bids</p>
                  <p className="text-[11px] text-apple-gray-400">
                    {new Date(service.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Dashboard;
