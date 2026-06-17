/**
 * ADMIN USER SEEDER
 * Creates initial admin user for platform management
 * 
 * Usage: node seeders/seed-admin.js
 * 
 * Setup steps:
 * 1. Create .env file with MONGO_URI
 * 2. Add ADMIN_EMAIL and ADMIN_PASSWORD to .env
 * 3. Run: node seeders/seed-admin.js
 */

require('../config/loadEnv');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
const path = require('path');

// Load User model
const User = require('../models/User');

async function seedAdmin() {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI not defined in .env');
      process.exit(1);
    }

    // Connect to MongoDB with timeout
    console.log('🔗 Connecting to MongoDB...');
    await Promise.race([
      mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        retryWrites: true
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout after 10s')), 10000)
      )
    ]);
    console.log('✅ MongoDB connected');

    // Check if admin already exists
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@skillafrik.com';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log(`⚠️  Admin user already exists: ${adminEmail}`);
      if (existingAdmin.userType === 'admin') {
        console.log(`✅ Admin account is active`);
        console.log(`📋 Admin Details:`);
        console.log(`   Email: ${existingAdmin.email}`);
        console.log(`   Name: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
        console.log(`   Status: ${existingAdmin.status}`);
      } else {
        console.log(`⚠️  User exists but is not an admin (userType: ${existingAdmin.userType})`);
      }
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create admin user
    console.log('👤 Creating admin user...');
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const adminPhone = process.env.ADMIN_PHONE || '+234 800 000 0000';

    const adminUser = new User({
      firstName: 'SkillAfrik',
      lastName: 'Admin',
      email: adminEmail,
      phone: adminPhone,
      password: adminPassword, // Will be hashed by pre-save middleware
      userType: 'admin',
      status: 'active',
      isEmailVerified: true,
      bio: 'Platform Administrator',
      avatar: 'https://via.placeholder.com/150?text=Admin',
      rating: 5,
      ratingCount: 0,
      reviewCount: 0,
      isTopUser: true,
      totalXP: 0,
      level: 1,
      totalCompletedJobs: 0,
      totalEarnings: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Save admin user (password will be hashed by pre-save middleware)
    await adminUser.save();

    console.log('✅ Admin user created successfully!');
    console.log(`📋 Admin Details:`);
    console.log(`   ID: ${adminUser._id}`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Password: ${adminPassword} (⚠️ CHANGE THIS IN PRODUCTION)`);
    console.log(`   Role: ${adminUser.userType}`);
    console.log(`   Status: ${adminUser.status}`);
    console.log(`\n⚠️  IMPORTANT: Change the admin password after first login!`);

    // Create wallet for admin
    const Wallet = require('../models/Wallet');
    const walletExists = await Wallet.findOne({ userId: adminUser._id });
    
    if (!walletExists) {
      const wallet = new Wallet({
        userId: adminUser._id,
        availableBalance: 0,
        escrowBalance: 0,
        frozenBalance: 0,
        aiCredits: {
          proposal: 999999,
          design: 999999,
          cv: 999999,
        },
      });
      await wallet.save();
      console.log(`💰 Admin wallet created`);
    }

    // Create gamification record
    const Gamification = require('../models/Gamification');
    const gamificationExists = await Gamification.findOne({ userId: adminUser._id });
    
    if (!gamificationExists) {
      const gamification = new Gamification({
        userId: adminUser._id,
        totalXP: 0,
        level: 1,
        badges: [],
        skills: {},
      });
      await gamification.save();
      console.log(`🎮 Gamification profile created`);
    }

    console.log(`\n🎉 Admin seeding completed successfully!`);
    console.log(`\n📖 Next steps:`);
    console.log(`   1. Start backend: npm run dev`);
    console.log(`   2. Login with:`);
    console.log(`      Email: ${adminEmail}`);
    console.log(`      Password: ${adminPassword}`);
    console.log(`   3. Go to admin dashboard to manage platform`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    if (error.code === 11000) {
      console.error(`\n⚠️  Duplicate email: Admin user already exists`);
    }
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeder
seedAdmin();
