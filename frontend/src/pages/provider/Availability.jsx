/**
 * @module pages/provider/Availability
 * @description Provider availability management page.
 * Includes weekly schedule, blocked dates management,
 * and upcoming bookings calendar for conflict visibility.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, Save, Plus, Trash2, CalendarX, Calendar, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { availabilityAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const Availability = () => {
  const [activeTab, setActiveTab] = useState('schedule');
  const [schedule, setSchedule] = useState(
    dayNames.map((_, i) => ({
      dayOfWeek: i,
      isAvailable: i >= 1 && i <= 5,
      slots: i >= 1 && i <= 5
        ? [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }]
        : [],
    }))
  );
  const [blockedDates, setBlockedDates] = useState([]);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [blockDateInput, setBlockDateInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [availRes, bookingsRes] = await Promise.all([
        availabilityAPI.getMy(),
        availabilityAPI.getMyBookings({}).catch(() => ({ data: { data: [] } })),
      ]);

      const allAvail = availRes.data.data || [];

      // Separate weekly schedule from blocked dates
      const weekly = allAvail.filter((a) => !a.specificDate && !a.isBlocked);
      const blocked = allAvail.filter((a) => a.isBlocked && a.specificDate);

      if (weekly.length > 0) {
        setSchedule((prev) =>
          prev.map((day) => {
            const found = weekly.find((e) => e.dayOfWeek === day.dayOfWeek);
            return found ? { ...day, isAvailable: found.isAvailable, slots: found.slots } : day;
          })
        );
      }

      setBlockedDates(blocked);
      setUpcomingBookings(bookingsRes.data.data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (dayIndex) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayIndex ? { ...day, isAvailable: !day.isAvailable } : day
      )
    );
  };

  const addSlot = (dayIndex) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayIndex
          ? { ...day, slots: [...day.slots, { startTime: '09:00', endTime: '17:00' }] }
          : day
      )
    );
  };

  const removeSlot = (dayIndex, slotIndex) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayIndex
          ? { ...day, slots: day.slots.filter((_, i) => i !== slotIndex) }
          : day
      )
    );
  };

  const updateSlot = (dayIndex, slotIndex, field, value) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayIndex
          ? {
              ...day,
              slots: day.slots.map((slot, i) =>
                i === slotIndex ? { ...slot, [field]: value } : slot
              ),
            }
          : day
      )
    );
  };

  const validateSlots = () => {
    for (const day of schedule) {
      if (!day.isAvailable) continue;
      for (let i = 0; i < day.slots.length; i++) {
        const slot = day.slots[i];
        if (slot.startTime >= slot.endTime) {
          toast.error(`${dayNames[day.dayOfWeek]}: Slot ${i + 1} start time must be before end time`);
          return false;
        }
        // Check for overlapping slots within the same day
        for (let j = i + 1; j < day.slots.length; j++) {
          const other = day.slots[j];
          if (slot.startTime < other.endTime && other.startTime < slot.endTime) {
            toast.error(`${dayNames[day.dayOfWeek]}: Slots ${i + 1} and ${j + 1} overlap`);
            return false;
          }
        }
      }
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateSlots()) return;
    setSaving(true);
    try {
      await availabilityAPI.setBulk({ schedule });
      toast.success('Availability saved!');
    } catch (error) {
      toast.error('Failed to save availability');
    } finally {
      setSaving(false);
    }
  };

  const handleBlockDate = async () => {
    if (!blockDateInput) {
      toast.error('Please select a date to block');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    if (blockDateInput < today) {
      toast.error('Cannot block a past date');
      return;
    }
    setBlocking(true);
    try {
      await availabilityAPI.blockDate({ date: blockDateInput });
      toast.success('Date blocked successfully');
      setBlockDateInput('');
      fetchAll();
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to block date';
      toast.error(msg);
    } finally {
      setBlocking(false);
    }
  };

  const handleUnblockDate = async (id) => {
    try {
      await availabilityAPI.unblockDate(id);
      toast.success('Date unblocked');
      fetchAll();
    } catch (error) {
      toast.error('Failed to unblock date');
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Availability</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">
          Manage your schedule, block dates, and view booking conflicts
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-apple-gray-100 rounded-xl mb-6 w-fit">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'schedule'
              ? 'bg-white text-apple-green shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          <Clock className="w-4 h-4 inline mr-1.5" />
          Weekly Schedule
        </button>
        <button
          onClick={() => setActiveTab('blocked')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'blocked'
              ? 'bg-white text-apple-green shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          <CalendarX className="w-4 h-4 inline mr-1.5" />
          Blocked Dates ({blockedDates.length})
        </button>
        <button
          onClick={() => setActiveTab('bookings')}
          className={`px-5 py-2 rounded-lg text-[14px] font-semibold transition-all ${
            activeTab === 'bookings'
              ? 'bg-white text-apple-green shadow-sm'
              : 'text-apple-gray-500 hover:text-apple-gray-700'
          }`}
        >
          <Calendar className="w-4 h-4 inline mr-1.5" />
          Booked Slots ({upcomingBookings.length})
        </button>
      </div>

      {/* Weekly Schedule Tab */}
      {activeTab === 'schedule' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex justify-end mb-4">
            <button onClick={handleSave} disabled={saving} className="apple-btn apple-btn-primary">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>

          <div className="space-y-3">
            {schedule.map((day, i) => (
              <motion.div
                key={day.dayOfWeek}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass-card p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleDay(day.dayOfWeek)}
                      className={`w-10 h-6 rounded-full transition-colors relative ${
                        day.isAvailable ? 'bg-apple-green' : 'bg-apple-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          day.isAvailable ? 'translate-x-[18px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <span className={`text-[15px] font-semibold ${day.isAvailable ? 'text-apple-gray-900' : 'text-apple-gray-400'}`}>
                      {dayNames[day.dayOfWeek]}
                    </span>
                  </div>
                  {day.isAvailable && (
                    <button
                      onClick={() => addSlot(day.dayOfWeek)}
                      className="apple-btn apple-btn-secondary apple-btn-sm"
                    >
                      <Plus className="w-3 h-3" />
                      Add Slot
                    </button>
                  )}
                </div>

                {day.isAvailable && (
                  <div className="space-y-2 ml-[52px]">
                    {day.slots.map((slot, si) => (
                      <div key={si} className="flex items-center gap-3">
                        <input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) => updateSlot(day.dayOfWeek, si, 'startTime', e.target.value)}
                          className="glass-input w-[140px] text-[14px]"
                        />
                        <span className="text-apple-gray-400">to</span>
                        <input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) => updateSlot(day.dayOfWeek, si, 'endTime', e.target.value)}
                          className="glass-input w-[140px] text-[14px]"
                        />
                        <button
                          onClick={() => removeSlot(day.dayOfWeek, si)}
                          className="p-2 rounded-lg hover:bg-red-50 text-apple-gray-400 hover:text-apple-red transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {day.slots.length === 0 && (
                      <p className="text-[13px] text-apple-gray-400">No time slots set — available all day</p>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Blocked Dates Tab */}
      {activeTab === 'blocked' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {/* Block a date form */}
          <div className="glass-card p-5 mb-5">
            <h3 className="text-[15px] font-semibold text-apple-gray-900 mb-3">Block a Date</h3>
            <p className="text-[13px] text-apple-gray-500 mb-3">
              Block specific dates when you are unavailable. Customers will not be able to book you on blocked dates.
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  type="date"
                  value={blockDateInput}
                  onChange={(e) => setBlockDateInput(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="glass-input"
                />
              </div>
              <button
                onClick={handleBlockDate}
                disabled={blocking}
                className="apple-btn apple-btn-danger apple-btn-sm"
              >
                <CalendarX className="w-4 h-4" />
                {blocking ? 'Blocking...' : 'Block Date'}
              </button>
            </div>
          </div>

          {/* Blocked dates list */}
          {blockedDates.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <CalendarX className="w-12 h-12 text-apple-gray-300 mx-auto mb-3" />
              <p className="text-[17px] font-semibold text-apple-gray-500 mb-1">No blocked dates</p>
              <p className="text-[14px] text-apple-gray-400">
                Block dates when you are unavailable for bookings
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {blockedDates
                .sort((a, b) => new Date(a.specificDate) - new Date(b.specificDate))
                .map((bd) => (
                  <div key={bd._id} className="glass-card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                        <CalendarX className="w-5 h-5 text-apple-red" />
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-apple-gray-900">
                          {new Date(bd.specificDate).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="text-[12px] text-apple-gray-500">Blocked</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnblockDate(bd._id)}
                      className="apple-btn apple-btn-secondary apple-btn-sm text-apple-red"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Unblock
                    </button>
                  </div>
                ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Booked Slots Tab */}
      {activeTab === 'bookings' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="glass-card p-5 mb-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <h3 className="text-[15px] font-semibold text-apple-gray-900">Booking Conflicts</h3>
            </div>
            <p className="text-[13px] text-apple-gray-500">
              These are your currently active bookings. The system automatically prevents double-bookings
              at the same date and time. If you need to block an entire day, use the Blocked Dates tab.
            </p>
          </div>

          {upcomingBookings.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <Calendar className="w-12 h-12 text-apple-gray-300 mx-auto mb-3" />
              <p className="text-[17px] font-semibold text-apple-gray-500 mb-1">No active bookings</p>
              <p className="text-[14px] text-apple-gray-400">
                Your confirmed bookings will appear here for conflict reference
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingBookings.map((booking) => (
                <div key={booking._id} className="glass-card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-apple-blue" />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-apple-gray-900">
                        {booking.service?.title || 'Service'}
                      </p>
                      <div className="flex items-center gap-3 text-[12px] text-apple-gray-500">
                        <span>
                          {new Date(booking.scheduledDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        <span>{booking.scheduledTime}</span>
                        <span>{booking.duration} min</span>
                        <span className="text-apple-gray-400">
                          Customer: {booking.customer?.name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className={`apple-badge text-[11px] ${
                    booking.status === 'confirmed'
                      ? 'bg-blue-100 text-blue-700'
                      : booking.status === 'in_progress'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {booking.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default Availability;
