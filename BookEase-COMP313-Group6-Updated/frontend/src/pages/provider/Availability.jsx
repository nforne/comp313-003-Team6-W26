/**
 * @module pages/provider/Availability
 * @description Provider availability management page.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, Save, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { availabilityAPI } from '../../api/bookings.api';
import Loading from '../../components/Loading';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const Availability = () => {
  const [schedule, setSchedule] = useState(
    dayNames.map((_, i) => ({
      dayOfWeek: i,
      isAvailable: i >= 1 && i <= 5,
      slots: i >= 1 && i <= 5
        ? [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }]
        : [],
    }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAvailability();
  }, []);

  const fetchAvailability = async () => {
    try {
      const res = await availabilityAPI.getMy();
      if (res.data.data.length > 0) {
        const existing = res.data.data;
        setSchedule((prev) =>
          prev.map((day) => {
            const found = existing.find((e) => e.dayOfWeek === day.dayOfWeek && !e.specificDate);
            return found ? { ...day, isAvailable: found.isAvailable, slots: found.slots } : day;
          })
        );
      }
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

  const handleSave = async () => {
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

  if (loading) return <Loading />;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Availability</h1>
            <p className="text-[15px] text-apple-gray-500 mt-1">Set your weekly availability schedule</p>
          </div>
          <button onClick={handleSave} disabled={saving} className="apple-btn apple-btn-primary">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </motion.div>

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
                  <p className="text-[13px] text-apple-gray-400">No time slots set</p>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Availability;
