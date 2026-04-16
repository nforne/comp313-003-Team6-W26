/**
 * @module pages/public/Register
 * @description Registration page with Apple-style design.
 */

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Calendar, User, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';

const Register = () => {
  const [searchParams] = useSearchParams();
  const defaultRole = searchParams.get('role') || 'customer';

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: defaultRole,
    phone: '',
    location: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const user = await register(formData);
      toast.success(`Welcome to BookEase, ${user.name}!`);
      const redirectMap = {
        provider: '/provider/dashboard',
        customer: '/customer/dashboard',
      };
      navigate(redirectMap[user.role] || '/');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Registration failed');
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
        className="relative z-10 w-full max-w-[440px]"
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl gradient-blue flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mb-1">
            Create Account
          </h1>
          <p className="text-[15px] text-apple-gray-500">
            Join BookEase to start booking services
          </p>
        </div>

        <div className="glass-card p-6">
          {/* Role Selector */}
          <div className="flex gap-2 mb-5 p-1 bg-apple-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, role: 'customer' })}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-semibold transition-all ${
                formData.role === 'customer'
                  ? 'bg-white text-apple-blue shadow-apple'
                  : 'text-apple-gray-500'
              }`}
            >
              <User className="w-4 h-4" />
              Customer
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, role: 'provider' })}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-semibold transition-all ${
                formData.role === 'provider'
                  ? 'bg-white text-apple-green shadow-apple'
                  : 'text-apple-gray-500'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Provider
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Full Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="John Doe"
                className="glass-input"
                required
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className="glass-input"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="416-555-0100"
                  className="glass-input"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Location</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="Toronto, ON"
                  className="glass-input"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Min 6 characters"
                  className="glass-input pr-12"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-apple-gray-100"
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-apple-gray-400" /> : <Eye className="w-4 h-4 text-apple-gray-400" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">Confirm Password</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repeat your password"
                className="glass-input"
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="apple-btn apple-btn-primary w-full mt-2"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-[14px] text-apple-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-apple-blue font-semibold no-underline hover:underline">
            Sign In
          </Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Register;
