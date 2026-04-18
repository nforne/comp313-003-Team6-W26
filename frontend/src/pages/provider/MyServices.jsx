/**
 * @module pages/provider/MyServices
 * @description Provider view of open service requests to bid on.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { servicesAPI } from '../../api/services.api';
import ServiceCard from '../../components/ServiceCard';
import Loading from '../../components/Loading';

const MyServices = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [serviceType, setServiceType] = useState('');

  useEffect(() => {
    fetchServices();
  }, [serviceType]);

  const fetchServices = async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (serviceType) params.serviceType = serviceType;
      const res = await servicesAPI.getOpenRequests(params);
      setServices(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Open Requests</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">Browse and bid on service requests</p>
      </motion.div>

      <div className="glass-card p-4 mb-6">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-apple-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchServices()}
              placeholder="Search requests..."
              className="glass-input pl-11"
            />
          </div>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="glass-input w-[180px]"
          >
            <option value="">All Types</option>
            <option value="haircut">Haircut</option>
            <option value="massage">Massage</option>
            <option value="cleaning">Cleaning</option>
            <option value="plumbing">Plumbing</option>
            <option value="electrical">Electrical</option>
            <option value="tutoring">Tutoring</option>
            <option value="photography">Photography</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : services.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">🔍</p>
          <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-1">No open requests</h3>
          <p className="text-[14px] text-apple-gray-500">Check back later for new requests</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {services.map((service, i) => (
            <ServiceCard key={service._id} service={service} index={i} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MyServices;
