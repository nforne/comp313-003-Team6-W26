/**
 * @module pages/public/ServiceDetail
 * @description Service detail page with bid listing and submission.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Clock, DollarSign, User, Star, Send, Check, Trash2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesAPI } from '../../api/services.api';
import { bookingsAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';
import useAuth from '../../hooks/useAuth';

const ServiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bidForm, setBidForm] = useState({ price: '', message: '', estimatedDuration: 60 });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchService();
  }, [id]);

  const fetchService = async () => {
    try {
      const res = await servicesAPI.getById(id);
      setService(res.data.data);
    } catch (error) {
      toast.error('Service not found');
      navigate('/services');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitBid = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await servicesAPI.submitBid(id, {
        price: Number(bidForm.price),
        message: bidForm.message,
        estimatedDuration: Number(bidForm.estimatedDuration),
      });
      toast.success('Bid submitted successfully!');
      fetchService();
      setBidForm({ price: '', message: '', estimatedDuration: 60 });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit bid');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptBid = async (bidId) => {
    try {
      const res = await servicesAPI.selectBid(id, bidId);
      toast.success('Bid accepted and booking created! Check your bookings page.');
      // Update service state with response data
      setService(res.data.data);
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || 'Failed to select bid';
      if (status === 409) {
        // Booking conflict
        toast.error(`Booking Conflict: ${msg}`, { duration: 5000 });
      } else {
        toast.error(msg);
      }
    }
  };

  const handleDeleteRequest = async () => {
    if (!window.confirm('Are you sure you want to delete this service request? This action cannot be undone.')) {
      return;
    }
    try {
      await servicesAPI.delete(id);
      toast.success('Service request deleted successfully!');
      navigate('/customer/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete service request');
    }
  };

  const handleCancelRequest = async () => {
    if (!window.confirm('Are you sure you want to cancel this service request?')) {
      return;
    }
    try {
      await servicesAPI.update(id, { status: 'cancelled' });
      toast.success('Service request cancelled successfully!');
      fetchService();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to cancel service request');
    }
  };

  if (loading) return <Loading />;
  if (!service) return null;

  const isOwner = user && (String(service.customer?._id) === String(user._id) || String(service.customer?._id) === String(user.id));
  const isProvider = user?.role === 'provider';
  const hasMyBid = service.bids?.some((b) => b.provider?._id === user?.id || b.provider?._id === user?._id);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-apple-blue text-[14px] font-medium mb-6 hover:opacity-80"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Service Info */}
        <div className="glass-card p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className={`apple-badge text-[11px] status-${service.status} mb-2`}>
                {service.status.replace('_', ' ')}
              </span>
              <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mt-1">
                {service.title}
              </h1>
            </div>
          </div>

          <p className="text-[15px] text-apple-gray-600 leading-relaxed mb-5">
            {service.description}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-apple-blue" />
              </div>
              <div>
                <p className="text-[11px] text-apple-gray-400">Location</p>
                <p className="text-[13px] font-medium text-apple-gray-700">{service.location}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-apple-purple" />
              </div>
              <div>
                <p className="text-[11px] text-apple-gray-400">Schedule</p>
                <p className="text-[13px] font-medium text-apple-gray-700">
                  {new Date(service.preferredDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {service.preferredTime}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-apple-green" />
              </div>
              <div>
                <p className="text-[11px] text-apple-gray-400">Budget</p>
                <p className="text-[13px] font-medium text-apple-gray-700">
                  ${service.budget?.min || 0} - ${service.budget?.max || 0}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <User className="w-4 h-4 text-apple-orange" />
              </div>
              <div>
                <p className="text-[11px] text-apple-gray-400">Posted by</p>
                <p className="text-[13px] font-medium text-apple-gray-700">{service.customer?.name}</p>
              </div>
            </div>
          </div>

          {/* Owner Action Buttons: Delete & Cancel */}
          {isOwner && (
            <div className="flex items-center gap-3 mt-6 pt-5 border-t border-apple-gray-100">
              {/* Delete Request - available when status is open (no bid accepted yet) */}
              {service.status === 'open' && (
                <button
                  onClick={handleDeleteRequest}
                  className="apple-btn apple-btn-sm flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Request
                </button>
              )}
              {/* Cancel Request - available when status is open or in_progress */}
              {(service.status === 'open' || service.status === 'in_progress') && (
                <button
                  onClick={handleCancelRequest}
                  className="apple-btn apple-btn-sm flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cancel Request
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bids Section */}
        <div className="glass-card p-6 mb-6">
          <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">
            Bids ({service.bids?.length || 0})
          </h2>

          {service.bids?.length === 0 ? (
            <p className="text-[14px] text-apple-gray-500 text-center py-8">
              No bids yet. Be the first to submit a bid!
            </p>
          ) : (
            <div className="space-y-3">
              {service.bids?.map((bid) => (
                <motion.div
                  key={bid._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-apple-gray-50/80 border border-apple-gray-100"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full gradient-green flex items-center justify-center">
                        <span className="text-white text-sm font-semibold">
                          {bid.provider?.name?.charAt(0)?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-apple-gray-900">{bid.provider?.name}</p>
                        <p className="text-[12px] text-apple-gray-500">
                          {bid.provider?.specialties?.join(', ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[20px] font-bold text-apple-green">${bid.price}</p>
                      <p className="text-[11px] text-apple-gray-400">{bid.estimatedDuration} min</p>
                    </div>
                  </div>
                  {bid.message && (
                    <p className="text-[13px] text-apple-gray-600 mt-3 pl-[52px]">{bid.message}</p>
                  )}
                  {bid.status && (
                    <span
                      className={`apple-badge text-[11px] mt-2 ml-[52px] ${
                        bid.status === 'accepted'
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : bid.status === 'rejected'
                          ? 'bg-red-100 text-red-700 border-red-300'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                      }`}
                    >
                      {bid.status === 'accepted'
                        ? 'Accepted'
                        : bid.status === 'rejected'
                        ? 'Rejected'
                        : 'Pending'}
                    </span>
                  )}
                  {isOwner && service.status === 'open' && (
                    <div className="mt-3 pl-[52px]">
                      <button
                        onClick={() => handleAcceptBid(bid._id)}
                        className="apple-btn apple-btn-success apple-btn-sm"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Accept Bid
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Bid Form (Provider only) */}
        {isProvider && service.status === 'open' && !hasMyBid && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6"
          >
            <h2 className="text-[19px] font-semibold text-apple-gray-900 mb-4">Submit Your Bid</h2>
            <form onSubmit={handleSubmitBid} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                    Your Price ($)
                  </label>
                  <input
                    type="number"
                    value={bidForm.price}
                    onChange={(e) => setBidForm({ ...bidForm, price: e.target.value })}
                    placeholder="0"
                    min="1"
                    className="glass-input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    value={bidForm.estimatedDuration}
                    onChange={(e) => setBidForm({ ...bidForm, estimatedDuration: e.target.value })}
                    min="15"
                    className="glass-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                  Message
                </label>
                <textarea
                  value={bidForm.message}
                  onChange={(e) => setBidForm({ ...bidForm, message: e.target.value })}
                  placeholder="Why should the customer choose you?"
                  rows={3}
                  className="glass-input resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="apple-btn apple-btn-primary w-full"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit Bid'}
              </button>
            </form>
          </motion.div>
        )}

        {!user && (
          <div className="glass-card p-6 text-center">
            <p className="text-[15px] text-apple-gray-500 mb-3">
              Sign in to submit a bid or create a service request
            </p>
            <Link to="/login" className="apple-btn apple-btn-primary">
              Sign In
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default ServiceDetail;
