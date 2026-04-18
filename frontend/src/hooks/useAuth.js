/**
 * @module hooks/useAuth
 * @description Custom hook for accessing authentication context.
 */

import { useContext } from 'react';
import { AuthContext } from '../auth/AuthProvider';

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default useAuth;
