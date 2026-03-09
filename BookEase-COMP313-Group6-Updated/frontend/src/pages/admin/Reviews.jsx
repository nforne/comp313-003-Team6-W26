/**
 * @module pages/admin/Reviews
 * @description Admin review moderation page.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, Flag, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const Reviews = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      const res = await adminAPI.getReviews();
      setReviews(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFlag = async (id) => {
    try {
      await adminAPI.moderateReview(id, { isFlagged: true });
      toast.success('Review flagged');
      fetchReviews();
    } catch (error) {
      toast.error('Failed to flag review');
    }
  };

  const handleApprove = async (id) => {
    try {
      await adminAPI.moderateReview(id, { isFlagged: false, isModerated: true });
      toast.success('Review approved');
      fetchReviews();
    } catch (error) {
      toast.error('Failed to approve review');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this review?')) return;
    try {
      await adminAPI.deleteReview(id);
      toast.success('Review deleted');
      fetchReviews();
    } catch (error) {
      toast.error('Failed to delete review');
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Review Moderation</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">Monitor and moderate user reviews</p>
      </motion.div>

      {reviews.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">⭐</p>
          <p className="text-[14px] text-apple-gray-500">No reviews to moderate</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review, i) => (
            <motion.div
              key={review._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-card p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className={`w-4 h-4 ${s <= review.rating?.score ? 'text-yellow-500 fill-yellow-500' : 'text-apple-gray-200'}`} />
                      ))}
                    </div>
                    {review.rating?.isFlagged && (
                      <span className="apple-badge text-[10px] status-cancelled">Flagged</span>
                    )}
                  </div>
                  <p className="text-[14px] text-apple-gray-700 mb-2">{review.rating?.comment || 'No comment'}</p>
                  <div className="text-[12px] text-apple-gray-500">
                    <span>By: <strong>{review.customer?.name}</strong></span>
                    <span className="mx-2">·</span>
                    <span>For: <strong>{review.provider?.name}</strong></span>
                    <span className="mx-2">·</span>
                    <span>Service: {review.service?.title}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button
                    onClick={() => handleApprove(review._id)}
                    className="p-1.5 rounded-lg hover:bg-green-50 text-apple-gray-400 hover:text-apple-green transition-colors"
                    title="Approve"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleFlag(review._id)}
                    className="p-1.5 rounded-lg hover:bg-orange-50 text-apple-gray-400 hover:text-apple-orange transition-colors"
                    title="Flag"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(review._id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-apple-gray-400 hover:text-apple-red transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Reviews;
