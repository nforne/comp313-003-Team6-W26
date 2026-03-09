/**
 * @module pages/admin/Users
 * @description Admin user management page.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Shield, ShieldOff, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const Users = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    fetchUsers();
  }, [roleFilter]);

  const fetchUsers = async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const res = await adminAPI.getUsers(params);
      setUsers(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (userId, isActive) => {
    try {
      await adminAPI.updateUser(userId, { isActive: !isActive });
      toast.success(`User ${!isActive ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user');
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await adminAPI.deleteUser(userId);
      toast.success('User deleted');
      fetchUsers();
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">User Management</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">Manage all platform users</p>
      </motion.div>

      <div className="glass-card p-4 mb-6">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-apple-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
              placeholder="Search users..."
              className="glass-input pl-11"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="glass-input w-[160px]"
          >
            <option value="">All Roles</option>
            <option value="customer">Customer</option>
            <option value="provider">Provider</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-apple-gray-100">
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Joined</th>
                  <th className="text-right px-4 py-3 text-[12px] font-semibold text-apple-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-apple-gray-50">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-apple-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full gradient-blue flex items-center justify-center">
                          <span className="text-white text-[11px] font-semibold">{u.name?.charAt(0)?.toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-apple-gray-900">{u.name}</p>
                          <p className="text-[11px] text-apple-gray-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold uppercase text-apple-gray-600">{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`apple-badge text-[11px] ${u.isActive ? 'status-completed' : 'status-cancelled'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-apple-gray-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggleActive(u._id, u.isActive)}
                          className={`p-1.5 rounded-lg transition-colors ${u.isActive ? 'hover:bg-red-50 text-apple-gray-400 hover:text-apple-red' : 'hover:bg-green-50 text-apple-gray-400 hover:text-apple-green'}`}
                          title={u.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {u.isActive ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDelete(u._id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-apple-gray-400 hover:text-apple-red transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
