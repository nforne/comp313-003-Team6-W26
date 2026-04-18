/**
 * @module components/BookingForm
 * @description Reusable booking/service request form with Apple-style design.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';

const serviceTypes = [
  { value: 'haircut', label: 'Haircut', icon: '💇' },
  { value: 'massage', label: 'Massage', icon: '💆' },
  { value: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { value: 'plumbing', label: 'Plumbing', icon: '🔧' },
  { value: 'electrical', label: 'Electrical', icon: '⚡' },
  { value: 'tutoring', label: 'Tutoring', icon: '📚' },
  { value: 'photography', label: 'Photography', icon: '📸' },
  { value: 'catering', label: 'Catering', icon: '🍽️' },
  { value: 'fitness', label: 'Fitness', icon: '💪' },
  { value: 'beauty', label: 'Beauty', icon: '💄' },
  { value: 'repair', label: 'Repair', icon: '🛠️' },
  { value: 'moving', label: 'Moving', icon: '📦' },
  { value: 'gardening', label: 'Gardening', icon: '🌿' },
  { value: 'painting', label: 'Painting', icon: '🎨' },
  { value: 'other', label: 'Other', icon: '📋' },
];

const BookingForm = ({ onSubmit, initialData = {}, loading = false, submitText = 'Submit' }) => {
  const [formData, setFormData] = useState({
    title: initialData.title || '',
    description: initialData.description || '',
    serviceType: initialData.serviceType || '',
    location: initialData.location || '',
    preferredDate: initialData.preferredDate
      ? new Date(initialData.preferredDate).toISOString().split('T')[0]
      : '',
    preferredTime: initialData.preferredTime || '',
    budgetMin: initialData.budget?.min || '',
    budgetMax: initialData.budget?.max || '',
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      title: formData.title,
      description: formData.description,
      serviceType: formData.serviceType,
      location: formData.location,
      preferredDate: formData.preferredDate,
      preferredTime: formData.preferredTime,
      budget: {
        min: Number(formData.budgetMin) || 0,
        max: Number(formData.budgetMax) || 0,
      },
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      <div>
        <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
          Service Title
        </label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={handleChange}
          placeholder="e.g., Haircut and Styling for Wedding"
          className="glass-input"
          required
        />
      </div>

      <div>
        <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
          Description
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Describe what you need..."
          rows={4}
          className="glass-input resize-none"
          required
        />
      </div>

      <div>
        <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
          Service Type
        </label>
        <select
          name="serviceType"
          value={formData.serviceType}
          onChange={handleChange}
          className="glass-input"
          required
        >
          <option value="">Select a service type</option>
          {serviceTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.icon} {type.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
          Location
        </label>
        <input
          type="text"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder="e.g., Toronto, ON"
          className="glass-input"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
            Preferred Date
          </label>
          <input
            type="date"
            name="preferredDate"
            value={formData.preferredDate}
            onChange={handleChange}
            className="glass-input"
            required
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
            Preferred Time
          </label>
          <input
            type="text"
            name="preferredTime"
            value={formData.preferredTime}
            onChange={handleChange}
            placeholder="e.g., 10:00 AM"
            className="glass-input"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
            Budget Min ($)
          </label>
          <input
            type="number"
            name="budgetMin"
            value={formData.budgetMin}
            onChange={handleChange}
            placeholder="0"
            min="0"
            className="glass-input"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-apple-gray-700 mb-1.5">
            Budget Max ($)
          </label>
          <input
            type="number"
            name="budgetMax"
            value={formData.budgetMax}
            onChange={handleChange}
            placeholder="0"
            min="0"
            className="glass-input"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="apple-btn apple-btn-primary w-full apple-btn-lg"
      >
        {loading ? 'Submitting...' : submitText}
      </button>
    </motion.form>
  );
};

export { serviceTypes };
export default BookingForm;
