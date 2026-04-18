/**
 * @module layouts/ProviderLayout
 * @description Provider dashboard layout with sidebar navigation.
 */

import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutDashboard, Briefcase, Calendar, Clock, Send, User, LogOut, ArrowLeft, Settings } from 'lucide-react';
import useAuth from '../hooks/useAuth';

const sidebarLinks = [
  { path: '/provider/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/provider/services', label: 'Open Requests', icon: Briefcase },
  { path: '/provider/bookings', label: 'My Bookings', icon: Calendar },
  { path: '/provider/availability', label: 'Availability', icon: Clock },
  { path: '/provider/offers', label: 'My Offers', icon: Send },
  { path: '/provider/account', label: 'Manage Account', icon: Settings },
];

const ProviderLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex">
      <motion.aside
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="hidden lg:flex w-[260px] flex-col fixed left-0 top-0 bottom-0 glass border-r border-apple-gray-200/50 z-40"
      >
        <div className="p-5 border-b border-apple-gray-200/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl gradient-green flex items-center justify-center">
              <Briefcase className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-[17px] font-semibold tracking-tight">BookEase</span>
          </div>
        </div>

        <div className="p-4 border-b border-apple-gray-200/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-green flex items-center justify-center">
              <span className="text-white text-sm font-semibold">
                {user?.name?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[14px] font-semibold text-apple-gray-900">{user?.name}</p>
              <p className="text-[11px] text-apple-gray-500">Service Provider</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {sidebarLinks.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium no-underline transition-all ${
                  isActive
                    ? 'bg-apple-green/10 text-apple-green'
                    : 'text-apple-gray-600 hover:bg-apple-gray-100'
                }`
              }
            >
              <link.icon className="w-[18px] h-[18px]" />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-apple-gray-200/50 space-y-1">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-apple-gray-600 hover:bg-apple-gray-100 w-full transition-colors"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
            Back to Home
          </button>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-apple-red hover:bg-red-50 w-full transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Sign Out
          </button>
        </div>
      </motion.aside>

      <main className="flex-1 lg:ml-[260px] min-h-screen">
        <div className="lg:hidden glass-nav sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-apple-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-[15px] font-semibold">Provider Dashboard</span>
          <button onClick={() => { logout(); navigate('/'); }} className="p-1.5 rounded-lg hover:bg-red-50">
            <LogOut className="w-5 h-5 text-apple-red" />
          </button>
        </div>
        <div className="p-4 lg:p-8 max-w-[1200px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default ProviderLayout;
