/**
 * @module components/ServiceCard
 * @description Apple-style service request card with glassmorphism.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Clock, DollarSign, Users, Tag } from 'lucide-react';

const serviceTypeIcons = {
  haircut: '💇',
  massage: '💆',
  cleaning: '🧹',
  plumbing: '🔧',
  electrical: '⚡',
  tutoring: '📚',
  photography: '📸',
  catering: '🍽️',
  fitness: '💪',
  beauty: '💄',
  repair: '🛠️',
  moving: '📦',
  gardening: '🌿',
  painting: '🎨',
  other: '📋',
};

const statusStyles = {
  open: 'status-open',
  in_progress: 'status-in_progress',
  completed: 'status-completed',
  cancelled: 'status-cancelled',
};

const ServiceCard = ({ service, index = 0 }) => {
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
    >
      <Link to={`/services/${service._id}`} className="block no-underline">
        <div className="glass-card p-5 h-full">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">
                {serviceTypeIcons[service.serviceType] || '📋'}
              </span>
              <span className={`apple-badge text-[11px] ${statusStyles[service.status]}`}>
                {service.status.replace('_', ' ')}
              </span>
            </div>
            {service.bids?.length > 0 && (
              <div className="flex items-center gap-1 text-apple-gray-500">
                <Users className="w-3.5 h-3.5" />
                <span className="text-[12px] font-medium">{service.bids.length} bids</span>
              </div>
            )}
          </div>

          {/* Title */}
          <h3 className="text-[16px] font-semibold text-apple-gray-900 mb-1.5 line-clamp-2 leading-tight">
            {service.title}
          </h3>

          {/* Description */}
          <p className="text-[13px] text-apple-gray-500 mb-3 line-clamp-2 leading-relaxed">
            {service.description}
          </p>

          {/* Meta */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[12px] text-apple-gray-500">
              <MapPin className="w-3.5 h-3.5 text-apple-gray-400" />
              <span>{service.location}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-apple-gray-500">
              <Clock className="w-3.5 h-3.5 text-apple-gray-400" />
              <span>{formatDate(service.preferredDate)} · {service.preferredTime}</span>
            </div>
            {(service.budget?.min > 0 || service.budget?.max > 0) && (
              <div className="flex items-center gap-2 text-[12px] text-apple-gray-500">
                <DollarSign className="w-3.5 h-3.5 text-apple-gray-400" />
                <span>Budget: ${service.budget.min} - ${service.budget.max}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          {service.bids?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-apple-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-apple-gray-500">Lowest bid</span>
                <span className="text-[15px] font-semibold text-apple-green">
                  ${Math.min(...service.bids.map((b) => b.price))}
                </span>
              </div>
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
};

export default ServiceCard;
