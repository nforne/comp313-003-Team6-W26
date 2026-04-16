/**
 * @module pages/public/Services
 * @description Services listing page with filtering and search.
 */

import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { servicesAPI } from '../../api/services.api';
import ServiceCard from '../../components/ServiceCard';
import Loading from '../../components/Loading';
import useAuth from '../../hooks/useAuth';

const serviceTypes = [
  { value: '', label: 'All Types' },
  { value: 'haircut', label: 'Haircut' },
  { value: 'massage', label: 'Massage' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'tutoring', label: 'Tutoring' },
  { value: 'photography', label: 'Photography' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'repair', label: 'Repair' },
  { value: 'other', label: 'Other' },
];

const Services = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [serviceType, setServiceType] = useState(searchParams.get('type') || '');

  const fetchServices = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 12 };
      if (search) params.search = search;
      if (serviceType) params.serviceType = serviceType;
      const res = await servicesAPI.getAll(params);
      setServices(res.data.data);
      setPagination(res.data.pagination);
    } catch (error) {
      console.error('Failed to fetch services:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, [serviceType]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchServices(1);
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="section-title">Service Requests</h1>
            <p className="section-subtitle mt-1">Browse and find services near you</p>
          </div>
          {user?.role === 'customer' && (
            <Link to="/customer/dashboard" className="apple-btn apple-btn-primary">
              <Plus className="w-4 h-4" />
              Post a Request
            </Link>
          )}
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-4 mb-6"
      >
        <div className="flex flex-col md:flex-row gap-3">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-apple-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services..."
              className="glass-input pl-11"
            />
          </form>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="glass-input md:w-[200px]"
          >
            {serviceTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </motion.div>

      {/* Results */}
      {loading ? (
        <Loading />
      ) : services.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <p className="text-[48px] mb-4">🔍</p>
          <h3 className="text-[19px] font-semibold text-apple-gray-900 mb-2">No services found</h3>
          <p className="text-[15px] text-apple-gray-500">Try adjusting your search or filters</p>
        </motion.div>
      ) : (
        <>
          <p className="text-[13px] text-apple-gray-500 mb-4">
            Showing {services.length} of {pagination.total} results
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map((service, i) => (
              <ServiceCard key={service._id} service={service} index={i} />
            ))}
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => fetchServices(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="apple-btn apple-btn-secondary apple-btn-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[14px] text-apple-gray-500 px-4">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                onClick={() => fetchServices(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="apple-btn apple-btn-secondary apple-btn-sm"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Services;
