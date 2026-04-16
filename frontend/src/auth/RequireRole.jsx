/**
 * @module auth/RequireRole
 * @description Role-based route wrapper that restricts access by user role.
 */

import { Navigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import Loading from '../components/Loading';

const RequireRole = ({ roles, children }) => {
  const { user, loading } = useAuth();

  if (loading) return <Loading />;

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default RequireRole;
