import axios from "./axios";

// customer
export const createServiceRequest = (payload) => axios.post("/requests", payload);
export const getMyRequests = () => axios.get("/requests/me");

// provider browse
export const getOpenRequests = (params = {}) => axios.get("/requests", { params });