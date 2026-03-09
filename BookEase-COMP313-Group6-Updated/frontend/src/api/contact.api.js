import API from "./axios";

// Admin
export const adminGetMessages = () => API.get("/contact");
export const adminMarkRead = (id) => API.patch(`/contact/${id}/read`);
export const adminDeleteMessage = (id) => API.delete(`/contact/${id}`);

// Public submit
export const sendContactMessage = (payload) => {
  const isFD = typeof FormData !== "undefined" && payload instanceof FormData;

  return API.post(
    "/contact",
    payload,
    isFD ? { headers: { "Content-Type": "multipart/form-data" } } : undefined
  );
};