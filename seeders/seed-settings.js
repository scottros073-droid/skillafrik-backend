/**
 * PLATFORM SETTINGS SEEDER
 * Creates default platform configuration
 * 
 * Usage: node seeders/seed-settings.js
 * 
 * This creates:
 * - Commission rates
 * - Minimum withdrawal amounts
 * - AI credit pricing
 * - Feature availability flags
 */

require('../config/loadEnv');
const mongoose = require('mongoose');

// Load Settings model
const Settings = require('../models/Settings');

async function seedSettings() {
  try {
    // Connect to MongoDB
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');

    // Check if settings already exist
    let settings = await Settings.findOne();

    if (settings) {
      console.log('⚠️  Platform settings already configured');
      console.log(`📋 Current Settings:`);
      console.log(`   Platform Commission: ${settings.platformCommissionRate}%`);
      console.log(`   Referral Commission: ${settings.referralCommissionRate}%`);
      console.log(`   Min Withdrawal: ₦${settings.minWithdrawalAmount}`);
      console.log(`   Escrow Release Days: ${settings.escrowReleaseDays}`);
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create default settings
    console.log('⚙️  Creating platform settings...');
    settings = new Settings({
      platformCommissionRate: 10, // 10% platform commission
      referralCommissionRate: 5, // 5% referral bonus
      minWithdrawalAmount: 5000, // ₦5000 minimum withdrawal
      escrowReleaseDays: 7, // 7 days auto-release
      maxReputationScore: 100,
      minReputationScore: 0,
      premiumMembership: {
        basic: {
          monthlyFee: 2999,
          features: [
            'Unlimited job postings',
            '5 AI proposal generations per month',
            'Priority support',
          ],
        },
        professional: {
          monthlyFee: 9999,
          features: [
            'Unlimited job postings',
            '50 AI proposal generations per month',
            '10 Design generation per month',
            'Priority support',
            'Custom branding',
          ],
        },
        expert: {
          monthlyFee: 29999,
          features: [
            'Unlimited everything',
            'Dedicated account manager',
            'Custom branding',
            'API access',
            '24/7 support',
          ],
        },
      },
      aiCredits: {
        proposal: {
          basicPrice: 100,
          bulkDiscount: 0.1, // 10% discount for bulk
        },
        design: {
          basicPrice: 200,
          bulkDiscount: 0.15,
        },
        cv: {
          basicPrice: 150,
          bulkDiscount: 0.12,
        },
      },
      features: {
        jobPosting: {
          enabled: true,
          requiresVerification: false,
        },
        messaging: {
          enabled: true,
          complianceChecking: true,
          allowExternalContact: false,
        },
        payments: {
          enabled: true,
          provider: 'paystack',
          supportedCurrencies: ['NGN'],
        },
        escrow: {
          enabled: true,
          autoRelease: true,
        },
        reviews: {
          enabled: true,
          requiresCompletion: true,
        },
        gamification: {
          enabled: true,
          leaderboardsEnabled: true,
        },
        aiFeatures: {
          enabled: true,
          proposalGeneration: true,
          designGeneration: true,
          cvGeneration: true,
        },
        ads: {
          enabled: true,
          requiresApproval: true,
        },
        referral: {
          enabled: true,
          minWithdrawal: 5000,
        },
      },
      bankDetails: {
        bankName: 'Sample Bank',
        accountName: 'SkillAfrik Limited',
        accountNumber: '0000000000',
        bankCode: '000',
      },
      contactInfo: {
        email: 'support@skillafrik.com',
        phone: '+234 800 000 0000',
        address: 'SkillAfrik HQ, Lagos, Nigeria',
      },
      seoSettings: {
        siteName: 'SkillAfrik',
        siteDescription: 'Connect with top freelancers and hire the best talents',
        faviconUrl: 'https://skillafrik.com/favicon.ico',
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Save settings
    await settings.save();

    console.log('✅ Platform settings created successfully!');
    console.log(`\n📋 Default Configuration:`);
    console.log(`   Platform Commission Rate: ${settings.platformCommissionRate}%`);
    console.log(`   Referral Commission Rate: ${settings.referralCommissionRate}%`);
    console.log(`   Minimum Withdrawal: ₦${settings.minWithdrawalAmount}`);
    console.log(`   Escrow Auto-Release: ${settings.escrowReleaseDays} days`);
    console.log(`\n💳 Premium Membership Pricing:`);
    console.log(`   Basic: ₦${settings.premiumMembership.basic.monthlyFee}/month`);
    console.log(`   Professional: ₦${settings.premiumMembership.professional.monthlyFee}/month`);
    console.log(`   Expert: ₦${settings.premiumMembership.expert.monthlyFee}/month`);
    console.log(`\n🤖 AI Features Enabled`);
    console.log(`   Proposal Generation: ₦${settings.aiCredits.proposal.basicPrice}/credit`);
    console.log(`   Design Generation: ₦${settings.aiCredits.design.basicPrice}/credit`);
    console.log(`   CV Generation: ₦${settings.aiCredits.cv.basicPrice}/credit`);

    console.log(`\n🎉 Settings seeding completed successfully!`);
    console.log(`\n💡 To modify settings later:`);
    console.log(`   1. Use admin dashboard`);
    console.log(`   2. Or directly edit Settings in MongoDB`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeder
seedSettings();
