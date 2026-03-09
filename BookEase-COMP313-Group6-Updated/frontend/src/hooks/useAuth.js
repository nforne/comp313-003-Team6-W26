/**
 * @module hooks/useAuth
 * @description Custom hook for accessing authentication context.
 */

import { useContext } from "react";
import { AuthContext } from "../auth/AuthProvider";

export default function useAuth() {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}