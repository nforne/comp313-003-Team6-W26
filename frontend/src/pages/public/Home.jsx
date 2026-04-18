/**
 * @module pages/public/Home
 * @description Landing page with Apple-inspired hero section and features.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Shield, Clock, Star, Users, Zap } from 'lucide-react';

const features = [
  {
    icon: Sparkles,
    title: 'Smart Matching',
    description: 'Post your service request and receive competitive bids from verified local providers.',
    gradient: 'gradient-blue',
  },
  {
    icon: Shield,
    title: 'Trusted Providers',
    description: 'Every provider is verified with ratings and reviews from real customers.',
    gradient: 'gradient-green',
  },
  {
    icon: Clock,
    title: 'No Conflicts',
    description: 'Automated calendar blocking prevents double bookings and scheduling conflicts.',
    gradient: 'gradient-purple',
  },
  {
    icon: Star,
    title: 'Rate & Review',
    description: 'Share your experience and help others find the best service providers.',
    gradient: 'gradient-orange',
  },
];

const serviceCategories = [
  { icon: '💇', label: 'Haircut' },
  { icon: '💆', label: 'Massage' },
  { icon: '🧹', label: 'Cleaning' },
  { icon: '🔧', label: 'Plumbing' },
  { icon: '⚡', label: 'Electrical' },
  { icon: '📚', label: 'Tutoring' },
  { icon: '📸', label: 'Photography' },
  { icon: '💪', label: 'Fitness' },
];

const Home = () => {
  return (
    <div className="overflow-hidden">
      {/* Hero Section */}
      <section className="relative min-h-[85vh] flex items-center justify-center px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white/50 to-[#f5f5f7]" />
        <div className="absolute top-20 left-1/4 w-[500px] h-[500px] bg-blue-200/30 rounded-full blur-[100px]" />
        <div className="absolute bottom-20 right-1/4 w-[400px] h-[400px] bg-purple-200/30 rounded-full blur-[100px]" />

        <div className="relative z-10 text-center max-w-[800px]">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-6">
              <Sparkles className="w-4 h-4 text-apple-blue" />
              <span className="text-[13px] font-semibold text-apple-blue">Local Service Marketplace</span>
            </div>

            <h1 className="text-[56px] md:text-[72px] font-bold tracking-[-0.04em] leading-[1.05] text-apple-gray-900 mb-4">
              Book local services
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                with confidence.
              </span>
            </h1>

            <p className="text-[19px] md:text-[21px] text-apple-gray-500 leading-relaxed max-w-[600px] mx-auto mb-8">
              Connect with trusted local service providers. Compare bids, check reviews, and book appointments — all in one place.
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link to="/services" className="apple-btn apple-btn-primary apple-btn-lg">
                Browse Services
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link to="/register" className="apple-btn apple-btn-secondary apple-btn-lg">
                Get Started Free
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Service Categories */}
      <section className="py-16 px-6">
        <div className="max-w-[1000px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <h2 className="section-title mb-2">Popular Services</h2>
            <p className="section-subtitle">Find the right professional for any job</p>
          </motion.div>

          <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
            {serviceCategories.map((cat, i) => (
              <motion.div
                key={cat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/services?type=${cat.label.toLowerCase()}`}
                  className="glass-card flex flex-col items-center gap-2 p-4 no-underline hover:scale-105 transition-transform"
                >
                  <span className="text-3xl">{cat.icon}</span>
                  <span className="text-[12px] font-medium text-apple-gray-600">{cat.label}</span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-[1000px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="section-title mb-2">Why BookEase?</h2>
            <p className="section-subtitle">Everything you need for hassle-free service booking</p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-5">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-card p-7"
              >
                <div className={`w-12 h-12 rounded-2xl ${feature.gradient} flex items-center justify-center mb-4`}>
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-[19px] font-semibold text-apple-gray-900 mb-2">{feature.title}</h3>
                <p className="text-[15px] text-apple-gray-500 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-white/50">
        <div className="max-w-[900px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="section-title mb-2">How It Works</h2>
            <p className="section-subtitle">Three simple steps to get started</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Post a Request', desc: 'Describe the service you need, set your preferred time and budget.' },
              { step: '02', title: 'Compare Bids', desc: 'Receive competitive bids from local providers. Compare prices and reviews.' },
              { step: '03', title: 'Book & Rate', desc: 'Confirm your booking and rate your provider after service completion.' },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-apple-gray-100 flex items-center justify-center mx-auto mb-4">
                  <span className="text-[24px] font-bold text-apple-blue">{item.step}</span>
                </div>
                <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-2">{item.title}</h3>
                <p className="text-[14px] text-apple-gray-500 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-[700px] mx-auto text-center"
        >
          <h2 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] text-apple-gray-900 mb-4">
            Ready to get started?
          </h2>
          <p className="text-[19px] text-apple-gray-500 mb-8">
            Join thousands of customers and providers on BookEase.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link to="/register" className="apple-btn apple-btn-primary apple-btn-lg">
              Create Free Account
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/register?role=provider" className="apple-btn apple-btn-secondary apple-btn-lg">
              Become a Provider
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  );
};

export default Home;
