/**
 * @module pages/admin/Providers
 * @description Admin providers management page with stats.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, Calendar, CheckCircle } from 'lucide-react';
import { adminAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const Providers = () => {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await adminAPI.getProviders();
      setProviders(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Providers</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">View and manage service providers</p>
      </motion.div>

      {providers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">👤</p>
          <p className="text-[14px] text-apple-gray-500">No providers registered yet</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {providers.map((provider, i) => (
            <motion.div
              key={provider._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-5"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-full gradient-green flex items-center justify-center">
                  <span className="text-white font-semibold">{provider.name?.charAt(0)?.toUpperCase()}</span>
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-apple-gray-900">{provider.name}</h3>
                  <p className="text-[12px] text-apple-gray-500">{provider.email}</p>
                  <p className="text-[12px] text-apple-gray-500">{provider.location}</p>
                </div>
                <span className={`apple-badge text-[10px] ${provider.isActive ? 'status-completed' : 'status-cancelled'}`}>
                  {provider.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              {provider.specialties?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {provider.specialties.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-full bg-apple-gray-100 text-[11px] font-medium text-apple-gray-600">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-apple-gray-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-apple-blue">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="text-[16px] font-bold">{provider.stats?.totalBookings || 0}</span>
                  </div>
                  <p className="text-[10px] text-apple-gray-500">Bookings</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-apple-green">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span className="text-[16px] font-bold">{provider.stats?.completedBookings || 0}</span>
                  </div>
                  <p className="text-[10px] text-apple-gray-500">Completed</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-yellow-500">
                    <Star className="w-3.5 h-3.5 fill-yellow-500" />
                    <span className="text-[16px] font-bold">{provider.stats?.averageRating || 0}</span>
                  </div>
                  <p className="text-[10px] text-apple-gray-500">Rating</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Providers;
