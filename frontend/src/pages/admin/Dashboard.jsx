/**
 * @module pages/admin/Dashboard
 * @description Admin dashboard with system statistics.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Briefcase, Calendar, DollarSign, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react';
import { adminAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await adminAPI.getDashboard();
      setData(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;
  if (!data) return null;

  const { stats, recentBookings, recentUsers } = data;

  const statCards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-apple-blue', bg: 'bg-blue-50' },
    { label: 'Customers', value: stats.totalCustomers, icon: Users, color: 'text-apple-green', bg: 'bg-green-50' },
    { label: 'Providers', value: stats.totalProviders, icon: Briefcase, color: 'text-apple-purple', bg: 'bg-purple-50' },
    { label: 'Total Services', value: stats.totalServices, icon: Clock, color: 'text-apple-orange', bg: 'bg-orange-50' },
    { label: 'Open Services', value: stats.openServices, icon: TrendingUp, color: 'text-apple-blue', bg: 'bg-blue-50' },
    { label: 'Total Bookings', value: stats.totalBookings, icon: Calendar, color: 'text-apple-purple', bg: 'bg-purple-50' },
    { label: 'Completed', value: stats.completedBookings, icon: CheckCircle, color: 'text-apple-green', bg: 'bg-green-50' },
    { label: 'Revenue', value: `$${stats.totalRevenue}`, icon: DollarSign, color: 'text-apple-green', bg: 'bg-green-50' },
  ];

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Admin Dashboard</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">System overview and statistics</p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="glass-card p-4"
          >
            <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-2`}>
              <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
            </div>
            <p className="text-[22px] font-bold text-apple-gray-900">{stat.value}</p>
            <p className="text-[12px] text-apple-gray-500">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Bookings */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">Recent Bookings</h2>
          <div className="glass-card divide-y divide-apple-gray-100">
            {recentBookings?.length === 0 ? (
              <p className="p-6 text-center text-[14px] text-apple-gray-500">No bookings yet</p>
            ) : (
              recentBookings?.slice(0, 8).map((b) => (
                <div key={b._id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-apple-gray-900">{b.service?.title || 'Service'}</p>
                    <p className="text-[11px] text-apple-gray-500">
                      {b.customer?.name} → {b.provider?.name}
                    </p>
                  </div>
                  <span className={`apple-badge text-[10px] status-${b.status}`}>
                    {b.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Recent Users */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">Recent Users</h2>
          <div className="glass-card divide-y divide-apple-gray-100">
            {recentUsers?.length === 0 ? (
              <p className="p-6 text-center text-[14px] text-apple-gray-500">No users yet</p>
            ) : (
              recentUsers?.slice(0, 8).map((u) => (
                <div key={u._id} className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full gradient-blue flex items-center justify-center">
                      <span className="text-white text-[10px] font-semibold">{u.name?.charAt(0)?.toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-apple-gray-900">{u.name}</p>
                      <p className="text-[11px] text-apple-gray-500">{u.email}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-apple-gray-500 uppercase">{u.role}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;
