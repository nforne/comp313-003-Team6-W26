/**
 * @module pages/admin/Bookings
 * @description Admin bookings overview page.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { adminAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const Bookings = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchBookings();
  }, [filter]);

  const fetchBookings = async () => {
    try {
      const params = {};
      if (filter) params.status = filter;
      const res = await adminAPI.getAllBookings(params);
      setBookings(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const statusFilters = ['', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">All Bookings</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">Monitor all platform bookings</p>
      </motion.div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {statusFilters.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all ${
              filter === s ? 'bg-apple-purple text-white' : 'bg-apple-gray-100 text-apple-gray-600 hover:bg-apple-gray-200'
            }`}
          >
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : bookings.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">📅</p>
          <p className="text-[14px] text-apple-gray-500">No bookings found</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-apple-gray-100">
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Service</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Provider</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-apple-gray-50">
                {bookings.map((b) => (
                  <tr key={b._id} className="hover:bg-apple-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-semibold text-apple-gray-900">{b.service?.title || 'N/A'}</p>
                      <p className="text-[11px] text-apple-gray-500">{b.service?.serviceType}</p>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-apple-gray-700">{b.customer?.name}</td>
                    <td className="px-4 py-3 text-[13px] text-apple-gray-700">{b.provider?.name}</td>
                    <td className="px-4 py-3">
                      <span className={`apple-badge text-[11px] status-${b.status}`}>{b.status.replace('_', ' ')}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-[14px] font-semibold text-apple-gray-900">${b.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Bookings;
