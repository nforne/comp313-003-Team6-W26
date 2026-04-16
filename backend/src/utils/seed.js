/**
 * @module utils/seed
 * @description Database seeder script.
 * Populates the database with sample data for development and testing.
 */

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User.model');
const Service = require('../models/Service.model');
const Booking = require('../models/Booking.model');
const Availability = require('../models/Availability.model');

const seedData = async () => {
  try {
    await connectDB();
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await Service.deleteMany({});
    await Booking.deleteMany({});
    await Availability.deleteMany({});

    console.log('Creating users...');
    const plainPassword = 'password123';

    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@bookease.com',
      password: plainPassword,
      role: 'admin',
      phone: '416-555-0100',
      location: 'Toronto, ON',
    });

    const customers = await User.create([
      {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        password: plainPassword,
        role: 'customer',
        phone: '416-555-0101',
        location: 'Toronto, ON',
        bio: 'Looking for reliable local services.',
      },
      {
        name: 'Bob Williams',
        email: 'bob@example.com',
        password: plainPassword,
        role: 'customer',
        phone: '416-555-0102',
        location: 'Scarborough, ON',
        bio: 'Frequent user of home services.',
      },
      {
        name: 'Carol Davis',
        email: 'carol@example.com',
        password: plainPassword,
        role: 'customer',
        phone: '416-555-0103',
        location: 'North York, ON',
      },
    ]);

    const providers = await User.create([
      {
        name: 'David Chen',
        email: 'david@example.com',
        password: plainPassword,
        role: 'provider',
        phone: '416-555-0201',
        location: 'Toronto, ON',
        bio: 'Professional hair stylist with 10 years of experience.',
        specialties: ['haircut', 'beauty'],
      },
      {
        name: 'Emma Wilson',
        email: 'emma@example.com',
        password: plainPassword,
        role: 'provider',
        phone: '416-555-0202',
        location: 'Mississauga, ON',
        bio: 'Licensed massage therapist specializing in deep tissue and relaxation.',
        specialties: ['massage', 'fitness'],
      },
      {
        name: 'Frank Martinez',
        email: 'frank@example.com',
        password: plainPassword,
        role: 'provider',
        phone: '416-555-0203',
        location: 'Toronto, ON',
        bio: 'Expert plumber and handyman. No job too small!',
        specialties: ['plumbing', 'repair', 'electrical'],
      },
      {
        name: 'Grace Lee',
        email: 'grace@example.com',
        password: plainPassword,
        role: 'provider',
        phone: '416-555-0204',
        location: 'Markham, ON',
        bio: 'Professional house cleaning service with eco-friendly products.',
        specialties: ['cleaning', 'gardening'],
      },
      {
        name: 'Henry Park',
        email: 'henry@example.com',
        password: plainPassword,
        role: 'provider',
        phone: '416-555-0205',
        location: 'Richmond Hill, ON',
        bio: 'Experienced tutor in math, science, and programming.',
        specialties: ['tutoring'],
      },
    ]);

    const MAX_PER_TYPE = 5;
    const limitServicesPerType = (servicesArr, maxPerType = MAX_PER_TYPE) => {
      const count = {};
      return servicesArr.filter((s) => {
        const key = (s.serviceType || 'other').toLowerCase();
        count[key] = (count[key] || 0) + 1;
        return count[key] <= maxPerType;
      });
    };

    console.log('Creating service requests...');
    const rawServices = [
      {
        customer: customers[0]._id,
        title: 'Haircut and Styling for Wedding',
        description: 'Need a professional haircut and styling for my wedding next month. Looking for someone experienced with formal hairstyles.',
        serviceType: 'haircut',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-15'),
        preferredTime: '10:00 AM',
        budget: { min: 50, max: 150 },
        status: 'open',
        bids: [
          {
            provider: providers[0]._id,
            price: 85,
            message: 'I specialize in wedding hairstyles. I can create a beautiful look for your special day!',
            estimatedDuration: 90,
          },
        ],
      },
      {
        customer: customers[1]._id,
        title: 'Deep Tissue Massage - Back Pain Relief',
        description: 'Suffering from chronic back pain. Need a professional deep tissue massage session.',
        serviceType: 'massage',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-10'),
        preferredTime: '2:00 PM',
        budget: { min: 60, max: 120 },
        status: 'open',
        bids: [
          {
            provider: providers[1]._id,
            price: 95,
            message: 'I have extensive experience with deep tissue massage for pain relief. Let me help you feel better!',
            estimatedDuration: 60,
          },
        ],
      },
      {
        customer: customers[0]._id,
        title: 'Kitchen Sink Repair',
        description: 'Kitchen sink is leaking. Need a plumber to fix it as soon as possible.',
        serviceType: 'plumbing',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-08'),
        preferredTime: '9:00 AM',
        budget: { min: 80, max: 200 },
        status: 'open',
        bids: [
          {
            provider: providers[2]._id,
            price: 120,
            message: 'I can fix your sink quickly. I bring all necessary parts and tools.',
            estimatedDuration: 120,
          },
        ],
      },
      {
        customer: customers[2]._id,
        title: 'House Deep Cleaning',
        description: 'Need a thorough deep cleaning of my 3-bedroom house. Including kitchen, bathrooms, and all living areas.',
        serviceType: 'cleaning',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-20'),
        preferredTime: '8:00 AM',
        budget: { min: 150, max: 300 },
        status: 'open',
        bids: [
          {
            provider: providers[3]._id,
            price: 200,
            message: 'I use eco-friendly products and provide a thorough deep clean. Your home will sparkle!',
            estimatedDuration: 240,
          },
        ],
      },
      {
        customer: customers[1]._id,
        title: 'Math Tutoring for High School Student',
        description: 'My son needs help with Grade 11 math. Looking for a patient and experienced tutor.',
        serviceType: 'tutoring',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-12'),
        preferredTime: '4:00 PM',
        budget: { min: 30, max: 60 },
        status: 'open',
        bids: [
          {
            provider: providers[4]._id,
            price: 45,
            message: 'I have helped many students improve their math grades. I can definitely help your son!',
            estimatedDuration: 60,
          },
        ],
      },
      {
        customer: customers[2]._id,
        title: 'Professional Photography for Family Portrait',
        description: 'Looking for a photographer for a family portrait session at home.',
        serviceType: 'photography',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-25'),
        preferredTime: '11:00 AM',
        budget: { min: 100, max: 250 },
        status: 'open',
      },
      {
        customer: customers[1]._id,
        title: 'Men Haircut (Quick)',
        description: 'Need a quick haircut this week.',
        serviceType: 'haircut',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-16'),
        preferredTime: '6:00 PM',
        budget: { min: 20, max: 60 },
        status: 'open',
      },
      {
        customer: customers[2]._id,
        title: 'Hair Styling for Party',
        description: 'Hair styling for weekend party.',
        serviceType: 'haircut',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-18'),
        preferredTime: '1:00 PM',
        budget: { min: 50, max: 140 },
        status: 'open',
      },
      {
        customer: customers[0]._id,
        title: 'Relaxation Massage',
        description: 'Need a relaxation massage after long work week.',
        serviceType: 'massage',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-11'),
        preferredTime: '7:00 PM',
        budget: { min: 60, max: 130 },
        status: 'open',
      },
      {
        customer: customers[2]._id,
        title: 'Sports Massage Session',
        description: 'Sports massage for recovery.',
        serviceType: 'massage',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-13'),
        preferredTime: '5:00 PM',
        budget: { min: 70, max: 150 },
        status: 'open',
      },
      {
        customer: customers[1]._id,
        title: 'Bathroom Faucet Leak',
        description: 'Bathroom faucet leaking slowly.',
        serviceType: 'plumbing',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-09'),
        preferredTime: '1:00 PM',
        budget: { min: 70, max: 180 },
        status: 'open',
      },
      {
        customer: customers[2]._id,
        title: 'Clogged Drain Fix',
        description: 'Kitchen drain clogged, needs cleaning/fix.',
        serviceType: 'plumbing',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-14'),
        preferredTime: '9:30 AM',
        budget: { min: 60, max: 160 },
        status: 'open',
      },
      {
        customer: customers[0]._id,
        title: 'Apartment Cleaning',
        description: '2-bedroom apartment cleaning (monthly).',
        serviceType: 'cleaning',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-22'),
        preferredTime: '10:00 AM',
        budget: { min: 90, max: 220 },
        status: 'open',
      },
      {
        customer: customers[2]._id,
        title: 'Programming Tutoring (JavaScript)',
        description: 'Need help with JavaScript basics and React.',
        serviceType: 'tutoring',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-17'),
        preferredTime: '4:30 PM',
        budget: { min: 35, max: 80 },
        status: 'open',
      },
      {
        customer: customers[0]._id,
        title: 'Product Photography for Small Business',
        description: 'Need clean product photos for online store.',
        serviceType: 'photography',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-26'),
        preferredTime: '2:00 PM',
        budget: { min: 120, max: 300 },
        status: 'open',
      },
      {
        customer: customers[1]._id,
        title: 'Electrical Outlet Fix',
        description: 'One wall outlet is not working.',
        serviceType: 'electrical',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-19'),
        preferredTime: '6:30 PM',
        budget: { min: 70, max: 200 },
        status: 'open',
      },
      {
        customer: customers[2]._id,
        title: 'Personal Training Session',
        description: 'Need 1-on-1 fitness coaching for beginners.',
        serviceType: 'fitness',
        location: 'North York, ON',
        preferredDate: new Date('2026-03-23'),
        preferredTime: '7:00 PM',
        budget: { min: 40, max: 120 },
        status: 'open',
      },
      {
        customer: customers[0]._id,
        title: 'Fix Door Handle',
        description: 'Door handle is loose and needs repair.',
        serviceType: 'repair',
        location: 'Toronto, ON',
        preferredDate: new Date('2026-03-24'),
        preferredTime: '12:00 PM',
        budget: { min: 30, max: 120 },
        status: 'open',
      },
      {
        customer: customers[1]._id,
        title: 'Other - Help Moving Small Items',
        description: 'Need help moving a few small items within the house.',
        serviceType: 'other',
        location: 'Scarborough, ON',
        preferredDate: new Date('2026-03-27'),
        preferredTime: '3:00 PM',
        budget: { min: 40, max: 140 },
        status: 'open',
      },
    ];

    const services = await Service.create(limitServicesPerType(rawServices, 5));

    console.log('Creating completed bookings with ratings...');
    const completedBooking = await Booking.create({
      service: services[0]._id,
      customer: customers[0]._id,
      provider: providers[0]._id,
      scheduledDate: new Date('2026-02-15'),
      scheduledTime: '10:00 AM',
      duration: 90,
      price: 85,
      status: 'completed',
      rating: {
        score: 5,
        comment: 'David did an amazing job with my hair! Highly recommend!',
      },
    });

    console.log('Setting up provider availability...');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const provider of providers) {
      for (let day = 1; day <= 5; day++) {
        await Availability.create({
          provider: provider._id,
          dayOfWeek: day,
          slots: [
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '13:00', endTime: '17:00' },
          ],
          isAvailable: true,
        });
      }
    }

    console.log('\n✅ Database seeded successfully!');
    console.log('\n📋 Test Accounts:');
    console.log('─────────────────────────────────────');
    console.log('Admin:    admin@bookease.com / password123');
    console.log('Customer: alice@example.com  / password123');
    console.log('Customer: bob@example.com    / password123');
    console.log('Customer: carol@example.com  / password123');
    console.log('Provider: david@example.com  / password123');
    console.log('Provider: emma@example.com   / password123');
    console.log('Provider: frank@example.com  / password123');
    console.log('Provider: grace@example.com  / password123');
    console.log('Provider: henry@example.com  / password123');
    console.log('─────────────────────────────────────\n');

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedData();
