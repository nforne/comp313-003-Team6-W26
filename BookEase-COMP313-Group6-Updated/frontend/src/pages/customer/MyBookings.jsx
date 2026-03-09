/**
 * @module pages/customer/MyBookings
 * @description Customer bookings list page.
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MapPin, Clock, Star } from "lucide-react";
import toast from "react-hot-toast";
import { bookingsAPI } from "../../api/bookings.api";
import { createReview } from "../../api/reviews.api";
import Loading from "../../components/Loading";

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "pending", label: "pending" },
  { key: "confirmed", label: "confirmed" },
  { key: "in_progress", label: "in progress" },
  { key: "completed", label: "completed" },
  { key: "cancelled", label: "cancelled" },
];

const MyBookings = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const [showRateModal, setShowRateModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchBookings();
  }, [filter]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter) params.status = filter;

      const res = await bookingsAPI.getMyBookings(params);

      const list =
        res?.data?.data ||
        res?.data?.bookings ||
        res?.data?.items ||
        res?.data ||
        [];

      setBookings(Array.isArray(list) ? list : []);
    } catch (error) {
      toast.error("Failed to load bookings");
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const isRated = (booking) => {
    return (
      booking?.ratingSubmitted === true ||
      booking?.rating != null ||
      booking?.score != null ||
      booking?.review != null ||
      booking?.reviewId != null
    );
  };

  const canRate = (booking) => {
    return booking?.status === "completed" && !isRated(booking);
  };

  const openRateModal = (booking, e) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (isRated(booking)) {
      toast.error("Booking has already been rated");
      return;
    }

    setSelectedBooking(booking);
    setRatingValue(5);
    setComment("");
    setShowRateModal(true);
  };

  const closeRateModal = () => {
    setShowRateModal(false);
    setSelectedBooking(null);
    setSubmitting(false);
    setRatingValue(5);
    setComment("");
  };

  const handleSubmitRating = async () => {
    if (!selectedBooking?._id) return;

    const r = Number(ratingValue);
    if (Number.isNaN(r) || r < 1 || r > 5) {
      toast.error("Rating must be 1 to 5");
      return;
    }

    setSubmitting(true);

    try {
      await createReview({
        bookingId: selectedBooking._id,
        rating: r,
        comment: comment?.trim() || "",
      });

      toast.success("Review submitted!");
      closeRateModal();
      fetchBookings();
    } catch (err) {
      const msg = err?.response?.data?.message || "Failed to submit review";
      toast.error(msg);

      if (
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("already been rated")
      ) {
        closeRateModal();
        fetchBookings();
        return;
      }

      setSubmitting(false);
    }
  };

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mb-1">
          My Bookings
        </h1>
        <p className="text-[15px] text-apple-gray-500 mb-6">
          Track and manage your bookings
        </p>
      </motion.div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key || "all"}
            onClick={() => setFilter(s.key)}
            className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all ${
              filter === s.key
                ? "bg-apple-blue text-white"
                : "bg-apple-gray-100 text-apple-gray-600 hover:bg-apple-gray-200"
            }`}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : bookings.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[48px] mb-3">📅</p>
          <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-1">
            No bookings found
          </h3>
          <p className="text-[14px] text-apple-gray-500">
            {filter ? `No bookings with status "${filter}"` : "Your bookings will appear here"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking, i) => (
            <motion.div
              key={booking._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link
                to={`/customer/bookings/${booking._id}`}
                className="glass-card p-5 block no-underline"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`apple-badge text-[11px] status-${booking.status}`}>
                        {(booking.status || "").replace("_", " ")}
                      </span>

                      {isRated(booking) && (
                        <span className="apple-badge text-[11px] bg-apple-gray-100 text-apple-gray-700">
                          rated
                        </span>
                      )}
                    </div>

                    <h3 className="text-[16px] font-semibold text-apple-gray-900 mb-1">
                      {booking.service?.title || "Service"}
                    </h3>

                    <div className="flex items-center gap-4 text-[12px] text-apple-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {booking.service?.location || "N/A"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {booking.scheduledTime || "N/A"}
                      </span>
                    </div>

                    <p className="text-[13px] text-apple-gray-500 mt-2">
                      Provider:{" "}
                      <span className="font-medium text-apple-gray-700">
                        {booking.provider?.name || "N/A"}
                      </span>
                    </p>

                    {canRate(booking) && (
                      <div className="mt-3">
                        <button
                          onClick={(e) => openRateModal(booking, e)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold bg-yellow-500 text-white hover:bg-yellow-600 transition"
                          type="button"
                        >
                          <Star className="w-4 h-4 fill-white" />
                          Rate / Review
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-[20px] font-bold text-apple-gray-900">
                      ${booking.price ?? 0}
                    </p>
                    <p className="text-[11px] text-apple-gray-400">
                      {booking.scheduledDate
                        ? new Date(booking.scheduledDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {showRateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={closeRateModal}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg glass-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-[18px] font-bold text-apple-gray-900">
                  Leave a Review
                </h3>
                <p className="text-[13px] text-apple-gray-500">
                  {selectedBooking?.service?.title || "Service"}
                </p>
              </div>

              <button
                onClick={closeRateModal}
                className="p-2 rounded-full hover:bg-apple-gray-100 transition"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-apple-gray-800">
                  Rating
                </label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRatingValue(n)}
                      className={`px-3 py-2 rounded-full text-[13px] font-semibold transition ${
                        Number(ratingValue) === n
                          ? "bg-yellow-500 text-white"
                          : "bg-apple-gray-100 text-apple-gray-700 hover:bg-apple-gray-200"
                      }`}
                      type="button"
                    >
                      {n}★
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[13px] font-semibold text-apple-gray-800">
                  Comment
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-2xl bg-white/70 border border-apple-gray-200 px-4 py-3 text-[13px] outline-none focus:ring-2 focus:ring-apple-blue"
                  placeholder="Write your review (optional)..."
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={closeRateModal}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold bg-apple-gray-100 text-apple-gray-700 hover:bg-apple-gray-200 transition"
                  type="button"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRating}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold bg-apple-blue text-white hover:opacity-90 transition"
                  type="button"
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyBookings;