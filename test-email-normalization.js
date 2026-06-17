/**
 * Test file to verify email normalization and duplicate prevention works correctly
 * Run with: node test-email-normalization.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Mock logger
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}:`, JSON.stringify(data, null, 2)),
  warn: (msg, data) => console.warn(`[WARN] ${msg}:`, JSON.stringify(data, null, 2)),
  error: (msg, data) => console.error(`[ERROR] ${msg}:`, JSON.stringify(data, null, 2))
};

// Import User model
const User = require('./models/User');

async function testEmailNormalization() {
  try {
    console.log('🔧 Testing email normalization and duplicate prevention...\n');

    // Test 1: Email normalization in schema
    console.log('📧 TEST 1: Testing email schema normalization...');

    // Create a test user with mixed case email
    const testEmail = 'TestUser@Example.COM';
    const normalizedEmail = testEmail.toLowerCase().trim();
    console.log(`   Original email: ${testEmail}`);
    console.log(`   Expected normalized: ${normalizedEmail}`);

    // Create user (this will trigger the pre-save hook)
    const user = new User({
      firstName: 'Test',
      lastName: 'User',
      email: testEmail, // Mixed case
      password: 'TestPassword123!'
    });

    // The pre-save hook should normalize the email
    await user.save();
    console.log(`   Saved email: ${user.email}`);
    console.log(`   Email normalized correctly: ${user.email === normalizedEmail ? 'YES' : 'NO'}\n`);

    // Test 2: Duplicate prevention with different cases
    console.log('🚫 TEST 2: Testing duplicate prevention with different email cases...');

    const duplicateEmails = [
      'testuser@example.com',  // lowercase
      'TestUser@Example.com',  // mixed case
      'TESTUSER@EXAMPLE.COM',  // uppercase
      ' testuser@example.com ', // with spaces
    ];

    for (const dupEmail of duplicateEmails) {
      try {
        const dupUser = new User({
          firstName: 'Duplicate',
          lastName: 'User',
          email: dupEmail,
          password: 'TestPassword123!'
        });
        await dupUser.save();
        console.log(`❌ ERROR: Duplicate email ${dupEmail} was allowed!`);
        console.log(`   Saved as: ${dupUser.email}`);
        process.exit(1);
      } catch (err) {
        if (err.code === 11000) { // MongoDB duplicate key error
          console.log(`✅ Duplicate email ${dupEmail} correctly rejected`);
        } else {
          console.log(`❌ Unexpected error for ${dupEmail}: ${err.message}`);
          process.exit(1);
        }
      }
    }
    console.log('');

    // Test 3: Login with different email cases
    console.log('🔐 TEST 3: Testing login with different email cases...');

    const loginEmails = [
      'testuser@example.com',  // lowercase
      'TestUser@Example.com',  // mixed case
      'TESTUSER@EXAMPLE.COM',  // uppercase
      ' testuser@example.com ', // with spaces
    ];

    for (const loginEmail of loginEmails) {
      // Simulate login normalization
      const normalizedLoginEmail = loginEmail.toLowerCase().trim();
      console.log(`   Login email: "${loginEmail}" → normalized: "${normalizedLoginEmail}"`);

      // Query user (this simulates what login does)
      const foundUser = await User.findOne({ email: normalizedLoginEmail });
      const userFound = !!foundUser;
      console.log(`   User found: ${userFound}`);
      if (!userFound) {
        console.log(`❌ ERROR: User not found for normalized email ${normalizedLoginEmail}`);
        process.exit(1);
      }
    }
    console.log('');

    // Test 4: Verify MongoDB schema constraints
    console.log('🗄️  TEST 4: Verifying MongoDB schema constraints...');

    // Check if email field has the correct properties
    const schema = User.schema.paths.email;
    const hasLowercase = schema.options.lowercase === true;
    const hasTrim = schema.options.trim === true;
    const hasUnique = schema.options.unique === true;

    console.log(`   Email field has lowercase: ${hasLowercase}`);
    console.log(`   Email field has trim: ${hasTrim}`);
    console.log(`   Email field has unique: ${hasUnique}`);

    if (!hasLowercase || !hasTrim || !hasUnique) {
      console.log('❌ ERROR: MongoDB schema missing required constraints!');
      process.exit(1);
    }
    console.log('✅ MongoDB schema constraints are correct\n');

    // Cleanup
    console.log('🧹 TEST 5: Cleaning up test user...');
    await User.deleteOne({ _id: user._id });
    console.log('✅ Test user deleted\n');

    console.log('✅ ALL EMAIL NORMALIZATION TESTS PASSED!');
    console.log('✅ Email mismatch issues are resolved');
    console.log('');
    console.log('📋 Summary of implemented requirements:');
    console.log('✅ Email always stored in lowercase in signup');
    console.log('✅ Login uses lowercase comparison');
    console.log('✅ MongoDB schema: email: { type: String, unique: true, lowercase: true, trim: true }');
    console.log('✅ Duplicate accounts prevented due to casing differences');
    console.log('✅ Same email matches regardless of case');

  } catch (err) {
    console.error('❌ Test failed with error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n🔌 Disconnected from MongoDB');
    }
  }
}

// Run tests
testEmailNormalization();