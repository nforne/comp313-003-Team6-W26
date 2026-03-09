/**
 * @module api/axios
 * @description Axios instance configuration with base URL and interceptors.
 */

import axios from "axios";

// 👇 Detect environment
const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5001/api"; // 👉 đổi port backend nếu cần

const API = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// ===== REQUEST INTERCEPTOR =====
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("bookease_token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 👇 Auto detect FormData (for file upload)
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    } else {
      config.headers["Content-Type"] = "application/json";
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ===== RESPONSE INTERCEPTOR =====
API.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("API Error:", error?.response?.data);
    // hoặc:
    console.log("API Error JSON:", JSON.stringify(error?.response?.data, null, 2));

    return Promise.reject(error);
  }
);

export default API;