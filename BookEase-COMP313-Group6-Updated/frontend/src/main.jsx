import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";

import AuthProvider from "./auth/AuthProvider"; // ✅ chỉnh path đúng theo dự án bạn

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);