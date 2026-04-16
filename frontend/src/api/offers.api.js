import axios from "./axios";

export const createOffer = (payload) => axios.post("/offers", payload);

export const getOffersByRequest = (requestId) =>
  axios.get(`/offers/request/${requestId}`);

export const acceptOffer = (offerId) =>
  axios.post(`/offers/${offerId}/accept`);

export const getMyOffers = () => axios.get("/offers/me");
export const cancelMyOffer = (offerId) => axios.post(`/offers/${offerId}/cancel`);