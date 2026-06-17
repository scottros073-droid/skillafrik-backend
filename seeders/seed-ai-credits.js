/**
 * AI CREDIT SEEDER
 * Initializes AI credits for new users or existing users without credits
 * 
 * Usage: node seeders/seed-ai-credits.js
 * 
 * This script:
 * - Finds all users
 * - Creates AICredit records for users without credits
 * - Initializes with default credit amounts
 */

require('../config/loadEnv');
const mongoose = require('mongoose');

// Load models
const User = require('../models/User');
const AICredit = require('../models/AICredit');

async function seedAICredits() {
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

    // Find all users
    console.log('👥 Fetching all users...');
    const users = await User.find();
    console.log(`Found ${users.length} users`);

    let created = 0;
    let skipped = 0;

    // Initialize AI credits for each user
    for (const user of users) {
      const existingCredits = await AICredit.findOne({ userId: user._id });

      if (existingCredits) {
        skipped++;
        continue;
      }

      // Determine initial credit amounts based on user type
      let proposalCredits = 0;
      let designCredits = 0;
      let cvCredits = 0;

      if (user.userType === 'admin') {
        // Admin users get unlimited credits
        proposalCredits = 999999;
        designCredits = 999999;
        cvCredits = 999999;
      } else if (user.premiumTier && user.premiumTier !== 'basic') {
        // Premium users get credits
        if (user.premiumTier === 'professional') {
          proposalCredits = 50;
          designCredits = 10;
          cvCredits = 20;
        } else if (user.premiumTier === 'expert') {
          proposalCredits = 999999;
          designCredits = 999999;
          cvCredits = 999999;
        }
      } else {
        // Free users get limited starter credits
        proposalCredits = 5;
        designCredits = 2;
        cvCredits = 3;
      }

      // Create AI credit record
      const aiCredit = new AICredit({
        userId: user._id,
        proposalCredits,
        proposalUsed: 0,
        designCredits,
        designUsed: 0,
        cvCredits,
        cvUsed: 0,
        totalSpent: 0,
        isPremium: user.premiumTier !== 'basic',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await aiCredit.save();
      created++;

      console.log(`✅ AI Credits initialized for: ${user.firstName} ${user.lastName} (${user._id})`);
      console.log(`   Proposal: ${proposalCredits} | Design: ${designCredits} | CV: ${cvCredits}`);
    }

    console.log(`\n📊 AI Credit Initialization Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped (already exist): ${skipped}`);
    console.log(`   Total: ${users.length}`);

    console.log(`\n🎉 AI credit seeding completed successfully!`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeder
seedAICredits();
