/**
 * @module pages/shared/ManageAccount
 * @description Manage Account page for all user roles (customer, provider, admin).
 * Allows users to update their profile, change address, contact, and password.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Phone, MapPin, FileText, Shield, Save, Lock, Tag, Camera } from 'lucide-react';
import toast from 'react-hot-toast';
import { authAPI } from '../../api/auth.api';
import useAuth from '../../hooks/useAuth';
import Loading from '../../components/Loading';

const ManageAccount = () => {
  const { user, updateUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');

  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    bio: '',
    location: '',
    specialties: [],
    avatar: '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [specialtyInput, setSpecialtyInput] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await authAPI.getMe();
      const data = res.data.data;
      setProfile({
        name: data.name || '',
        phone: data.phone || '',
        bio: data.bio || '',
        location: data.location || '',
        specialties: data.specialties || [],
        avatar: data.avatar || '',
      });
    } catch (error) {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authAPI.updateProfile(profile);
      toast.success('Profile updated successfully');
      // Update the auth context
      if (updateUser && res.data.data) {
        updateUser(res.data.data);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = (e) => {
    setPasswordForm({ ...passwordForm, [e.target.name]: e.target.value });
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setChangingPassword(true);
    try {
      const res = await authAPI.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      // Update token if returned
      if (res.data.data?.token) {
        localStorage.setItem('token', res.data.data.token);
      }
      toast.success('Password changed successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const addSpecialty = () => {
    const val = specialtyInput.trim();
    if (val && !profile.specialties.includes(val)) {
      setProfile({ ...profile, specialties: [...profile.specialties, val] });
      setSpecialtyInput('');
    }
  };

  const removeSpecialty = (index) => {
    const updated = profile.specialties.filter((_, i) => i !== index);
    setProfile({ ...profile, specialties: updated });
  };

  if (loading) return <Loading />;

  const isProvider = user?.role === 'provider';
  const roleColor = user?.role === 'admin' ? 'apple-red' : isProvider ? 'apple-green' : 'apple-blue';
  const roleBg = user?.role === 'admin' ? 'bg-red-50' : isProvider ? 'bg-green-50' : 'bg-blue-50';
  const roleText = user?.role === 'admin' ? 'text-red-600' : isProvider ? 'text-green-600' : 'text-blue-600';

  return (
    <div className="max-w-[800px] mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900 mb-1">
          Manage Account
        </h1>
        <p className="text-[15px] text-apple-gray-500 mb-6">
          Update your profile information and account settings
        </p>

        {/* Profile Header Card */}
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-[24px] ${
              user?.role === 'admin' ? 'gradient-red' : isProvider ? 'gradient-green' : 'gradient-blue'
            }`}>
              {profile.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-apple-gray-900">{profile.name || 'User'}</h2>
              <p className="text-[13px] text-apple-gray-500">{user?.email}</p>
              <span className={`inline-block mt-1 px-3 py-0.5 rounded-full text-[11px] font-semibold ${roleBg} ${roleText}`}>
                {user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="flex gap-1 p-1 bg-apple-gray-100 rounded-xl mb-6 w-fit">
          <button
            onClick={() => setActiveSection('profile')}
            className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
              activeSection === 'profile'
                ? 'bg-white text-apple-gray-900 shadow-sm'
                : 'text-apple-gray-500 hover:text-apple-gray-700'
            }`}
          >
            <User className="w-4 h-4 inline mr-1.5" />
            Profile
          </button>
          <button
            onClick={() => setActiveSection('security')}
            className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
              activeSection === 'security'
                ? 'bg-white text-apple-gray-900 shadow-sm'
                : 'text-apple-gray-500 hover:text-apple-gray-700'
            }`}
          >
            <Shield className="w-4 h-4 inline mr-1.5" />
            Security
          </button>
        </div>

        {/* Profile Section */}
        {activeSection === 'profile' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <form onSubmit={handleSaveProfile} className="space-y-5">
              <div className="glass-card p-6">
                <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-4">
                  Personal Information
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      <User className="w-3.5 h-3.5 inline mr-1" />
                      Full Name
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={profile.name}
                      onChange={handleProfileChange}
                      className="glass-input"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      <Phone className="w-3.5 h-3.5 inline mr-1" />
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={profile.phone}
                      onChange={handleProfileChange}
                      placeholder="e.g., +1 (416) 555-0123"
                      className="glass-input"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      <MapPin className="w-3.5 h-3.5 inline mr-1" />
                      Address / Location
                    </label>
                    <input
                      type="text"
                      name="location"
                      value={profile.location}
                      onChange={handleProfileChange}
                      placeholder="e.g., Toronto, ON"
                      className="glass-input"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      <FileText className="w-3.5 h-3.5 inline mr-1" />
                      Bio
                    </label>
                    <textarea
                      name="bio"
                      value={profile.bio}
                      onChange={handleProfileChange}
                      placeholder="Tell us about yourself..."
                      rows={3}
                      maxLength={500}
                      className="glass-input resize-none"
                    />
                    <p className="text-[11px] text-apple-gray-400 mt-1">
                      {profile.bio.length}/500 characters
                    </p>
                  </div>
                </div>
              </div>

              {/* Provider-specific: Specialties */}
              {isProvider && (
                <div className="glass-card p-6">
                  <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-4">
                    <Tag className="w-4 h-4 inline mr-1.5" />
                    Specialties
                  </h3>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={specialtyInput}
                      onChange={(e) => setSpecialtyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSpecialty();
                        }
                      }}
                      placeholder="Add a specialty (e.g., Haircut, Massage)"
                      className="glass-input flex-1"
                    />
                    <button
                      type="button"
                      onClick={addSpecialty}
                      className="apple-btn apple-btn-primary apple-btn-sm"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profile.specialties.map((s, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-50 text-green-700 text-[12px] font-medium"
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => removeSpecialty(i)}
                          className="ml-1 text-green-500 hover:text-red-500 transition"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {profile.specialties.length === 0 && (
                      <p className="text-[13px] text-apple-gray-400">No specialties added yet</p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="apple-btn apple-btn-primary w-full apple-btn-lg"
              >
                <Save className="w-4 h-4 inline mr-1.5" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </motion.div>
        )}

        {/* Security Section */}
        {activeSection === 'security' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <form onSubmit={handleChangePassword} className="space-y-5">
              <div className="glass-card p-6">
                <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-4">
                  <Lock className="w-4 h-4 inline mr-1.5" />
                  Change Password
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      Current Password
                    </label>
                    <input
                      type="password"
                      name="currentPassword"
                      value={passwordForm.currentPassword}
                      onChange={handlePasswordChange}
                      className="glass-input"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      New Password
                    </label>
                    <input
                      type="password"
                      name="newPassword"
                      value={passwordForm.newPassword}
                      onChange={handlePasswordChange}
                      className="glass-input"
                      required
                      minLength={6}
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      name="confirmPassword"
                      value={passwordForm.confirmPassword}
                      onChange={handlePasswordChange}
                      className="glass-input"
                      required
                      minLength={6}
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={changingPassword}
                className="apple-btn apple-btn-primary w-full apple-btn-lg"
              >
                <Lock className="w-4 h-4 inline mr-1.5" />
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </form>

            {/* Account Info */}
            <div className="glass-card p-6 mt-5">
              <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-3">Account Information</h3>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between py-2 border-b border-apple-gray-100">
                  <span className="text-apple-gray-500">Email</span>
                  <span className="font-medium text-apple-gray-700">{user?.email}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-apple-gray-100">
                  <span className="text-apple-gray-500">Role</span>
                  <span className={`font-medium ${roleText}`}>
                    {user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-apple-gray-500">Member Since</span>
                  <span className="font-medium text-apple-gray-700">
                    {user?.createdAt
                      ? new Date(user.createdAt).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default ManageAccount;
