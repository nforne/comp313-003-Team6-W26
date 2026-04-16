/**
 * @module pages/public/Login
 * @description Login page with Apple-style design.
 */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.name}!`);
      const redirectMap = {
        admin: '/admin/dashboard',
        provider: '/provider/dashboard',
        customer: '/customer/dashboard',
      };
      navigate(from !== '/' ? from : redirectMap[user.role] || '/');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-52px)] flex items-center justify-center px-6 py-12">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 to-[#f5f5f7]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-[400px]"
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl gradient-blue flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mb-1">
            Welcome back
          </h1>
          <p className="text-[15px] text-apple-gray-500">
            Sign in to your BookEase account
          </p>
        </div>

        <div className="glass-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="glass-input"
                required
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="glass-input pr-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-apple-gray-100"
                >
                  {showPassword ? (
                    <EyeOff className="w-4.5 h-4.5 text-apple-gray-400" />
                  ) : (
                    <Eye className="w-4.5 h-4.5 text-apple-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="apple-btn apple-btn-primary w-full mt-2"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-[14px] text-apple-gray-500">
          Don't have an account?{' '}
          <Link to="/register" className="text-apple-blue font-semibold no-underline hover:underline">
            Create Account
          </Link>
        </p>

        {/* Demo accounts */}
        <div className="mt-6 glass-card p-4">
          <p className="text-[12px] font-semibold text-apple-gray-500 mb-2 text-center">Demo Accounts</p>
          <div className="space-y-1.5 text-[12px] text-apple-gray-500">
            {[
              { label: 'Admin', email: 'admin@bookease.com' },
              { label: 'Customer', email: 'alice@example.com' },
              { label: 'Provider', email: 'david@example.com' },
            ].map((acc) => (
              <button
                key={acc.email}
                onClick={() => { setEmail(acc.email); setPassword('password123'); }}
                className="flex items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-apple-gray-100 transition-colors"
              >
                <span className="font-medium text-apple-gray-700">{acc.label}</span>
                <span className="text-apple-gray-400">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
