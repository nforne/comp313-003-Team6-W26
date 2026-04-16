/**
 * @module app/App
 * @description Main application component with routing configuration.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import AuthProvider from '../auth/AuthProvider';
import RequireAuth from '../auth/RequireAuth';
import RequireRole from '../auth/RequireRole';

// Layouts
import PublicLayout from '../layouts/PublicLayout';
import CustomerLayout from '../layouts/CustomerLayout';
import ProviderLayout from '../layouts/ProviderLayout';
import AdminLayout from '../layouts/AdminLayout';

// Public Pages
import Home from '../pages/public/Home';
import Services from '../pages/public/Services';
import ServiceDetail from '../pages/public/ServiceDetail';
import Login from '../pages/public/Login';
import Register from '../pages/public/Register';
import About from '../pages/About';
import Contact from '../pages/Contact';
import ReviewsPage from '../pages/review/ReviewsPage';

// Customer Pages
import CustomerDashboard from '../pages/customer/Dashboard';
import MyBookings from '../pages/customer/MyBookings';
import BookingDetail from '../pages/customer/BookingDetail';
import Favorites from '../pages/viewer/Favorites';

// Provider Pages
import ProviderDashboard from '../pages/provider/Dashboard';
import MyServices from '../pages/provider/MyServices';
import ProviderAvailability from '../pages/provider/Availability';
import ProviderBookings from '../pages/provider/ProviderBookings';

// Admin Pages
import AdminDashboard from '../pages/admin/Dashboard';
import AdminUsers from '../pages/admin/Users';
import AdminProviders from '../pages/admin/Providers';
import AdminBookings from '../pages/admin/Bookings';
import AdminReviews from '../pages/admin/Reviews';
import ContactInbox from '../pages/admin/ContactInbox';

// Shared Pages
import ManageAccount from '../pages/shared/ManageAccount';

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '14px',
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: '500',
              color: '#1d1d1f',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            },
          }}
        />

        <Routes>
          {/* Public Routes */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/reviews" element={<ReviewsPage />} />
          </Route>

          {/* Customer Routes */}
          <Route
            element={
              <RequireAuth>
                <RequireRole roles={['customer']}>
                  <CustomerLayout />
                </RequireRole>
              </RequireAuth>
            }
          >
            <Route path="/customer/dashboard" element={<CustomerDashboard />} />
            <Route path="/customer/bookings" element={<MyBookings />} />
            <Route path="/customer/bookings/:id" element={<BookingDetail />} />
            <Route path="/customer/favorites" element={<Favorites />} />
            <Route path="/customer/account" element={<ManageAccount />} />
          </Route>

          {/* Provider Routes */}
          <Route
            element={
              <RequireAuth>
                <RequireRole roles={['provider']}>
                  <ProviderLayout />
                </RequireRole>
              </RequireAuth>
            }
          >
            <Route path="/provider/dashboard" element={<ProviderDashboard />} />
            <Route path="/provider/services" element={<MyServices />} />
            <Route path="/provider/bookings" element={<ProviderBookings />} />
            <Route path="/provider/bookings/:id" element={<ProviderBookings />} />
            <Route path="/provider/availability" element={<ProviderAvailability />} />
            <Route path="/provider/account" element={<ManageAccount />} />
          </Route>

          {/* Admin Routes */}
          <Route
            element={
              <RequireAuth>
                <RequireRole roles={['admin']}>
                  <AdminLayout />
                </RequireRole>
              </RequireAuth>
            }
          >
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/providers" element={<AdminProviders />} />
            <Route path="/admin/bookings" element={<AdminBookings />} />
            <Route path="/admin/reviews" element={<AdminReviews />} />
            <Route path="/admin/contact" element={<ContactInbox />} />
            <Route path="/admin/account" element={<ManageAccount />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
