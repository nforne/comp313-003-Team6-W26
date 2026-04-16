import API from "./axios";

export const createReview = (data) => API.post("/reviews", data);

export const getReviewFeed = ({ serviceType = "all", page = 1, limit = 10 } = {}) =>
  API.get("/reviews/feed", {
    params: { serviceType, page, limit },
  });

export const getMyReviews = () => API.get("/reviews/me");

export const getReviewsByProvider = (providerId) =>
  API.get(`/reviews/provider/${providerId}`);

export const replyReview = (reviewId, reply) =>
  API.patch(`/reviews/${reviewId}/reply`, { reply });

export const deleteReview = (reviewId) =>
  API.delete(`/reviews/${reviewId}`);