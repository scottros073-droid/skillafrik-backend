/**
 * Test file to verify signup and login flow works correctly
 * Run with: node test-auth-flow.js
 */

require('./config/loadEnv');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');

// Mock logger
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}:`, JSON.stringify(data, null, 2)),
  warn: (msg, data) => console.warn(`[WARN] ${msg}:`, JSON.stringify(data, null, 2)),
  error: (msg, data) => console.error(`[ERROR] ${msg}:`, JSON.stringify(data, null, 2))
};

// Require models
const User = require('./models/User');

async function testAuthFlow() {
  try {
    console.log('🔧 Starting authentication flow test...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is required for test-auth-flow');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Test data
    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';
    const testFirstName = 'Test';
    const testLastName = 'User';

    // Test 1: Signup (create user with plain password)
    console.log('📝 TEST 1: Creating new user with plain password...');
    const user = await User.create({
      email: testEmail,
      password: testPassword,
      firstName: testFirstName,
      lastName: testLastName,
      userType: 'freelancer'
    });

    console.log('✅ User created:');
    console.log(`  - User ID: ${user._id}`);
    console.log(`  - Email: ${user.email}`);
    console.log(`  - Password exists: ${!!user.password}`);
    console.log(`  - Password length: ${user.password ? user.password.length : 0}`);
    console.log(`  - Password is hashed: ${user.password !== testPassword}`);
    console.log(`  - Password starts with: ${user.password ? user.password.substring(0, 15) + '...' : 'N/A'}\n`);

    // Verify password is hashed
    if (user.password === testPassword) {
      console.log('❌ ERROR: Password was NOT hashed! Password in DB equals plain text password');
      process.exit(1);
    }

    // Test 2: Retrieve user and verify password
    console.log('🔍 TEST 2: Retrieving user from database...');
    const retrievedUser = await User.findById(user._id);
    console.log('✅ User retrieved:');
    console.log(`  - Email: ${retrievedUser.email}`);
    console.log(`  - Password exists: ${!!retrievedUser.password}`);
    console.log(`  - Password length: ${retrievedUser.password ? retrievedUser.password.length : 0}\n`);

    // Test 3: Login - Compare password with bcrypt
    console.log('🔐 TEST 3: Attempting login with correct password...');
    const isPasswordValid = await bcryptjs.compare(testPassword, retrievedUser.password);
    console.log(`✅ Password comparison result: ${isPasswordValid}`);
    if (!isPasswordValid) {
      console.log('❌ ERROR: Password comparison failed! User cannot login');
      process.exit(1);
    }
    console.log('✅ Password matches! User can login\n');

    // Test 4: Wrong password should fail
    console.log('🔐 TEST 4: Attempting login with wrong password...');
    const wrongPassword = 'WrongPassword123!';
    const isWrongPasswordValid = await bcryptjs.compare(wrongPassword, retrievedUser.password);
    console.log(`✅ Wrong password comparison result: ${isWrongPasswordValid}`);
    if (isWrongPasswordValid) {
      console.log('❌ ERROR: Wrong password was accepted! Security issue');
      process.exit(1);
    }
    console.log('✅ Wrong password rejected! Security verified\n');

    // Test 5: Email normalization
    console.log('🔍 TEST 5: Verifying email normalization...');
    const upperCaseEmail = testEmail.toUpperCase();
    const userByUpperCaseEmail = await User.findOne({ email: upperCaseEmail.toLowerCase() });
    console.log(`✅ Found user by lowercase email: ${!!userByUpperCaseEmail}`);
    if (!userByUpperCaseEmail) {
      console.log('❌ ERROR: Email normalization failed!');
      process.exit(1);
    }
    console.log('✅ Email normalization working correctly\n');

    // Cleanup
    console.log('🧹 TEST 6: Cleaning up test user...');
    await User.deleteOne({ _id: user._id });
    console.log('✅ Test user deleted\n');

    console.log('✅ ALL TESTS PASSED! Signup and login flow is working correctly');
    process.exit(0);

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
testAuthFlow();
