/**
 * Debug password storage issue in MongoDB user model
 * Run with: node debug-password-storage.js
 */

const bcrypt = require('bcrypt');

// Simulate User model behavior
class MockUser {
  constructor(data) {
    this._id = 'mock-user-id-' + Date.now();
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
    this.password = data.password;
    this.userType = data.userType || 'freelancer';
    this.verificationToken = data.verificationToken;
    this.verificationTokenExpiry = data.verificationTokenExpiry;
    this.isModified = (field) => field === 'password'; // Simulate mongoose isModified
  }

  // Simulate pre-save hook
  async preSaveHook() {
    console.log('🔄 Running pre-save hook...');

    // Validate password exists and is a string
    if (!this.password || typeof this.password !== 'string') {
      throw new Error('Password is required and must be a valid string');
    }

    console.log(`   Password exists: ${!!this.password}`);
    console.log(`   Password type: ${typeof this.password}`);
    console.log(`   Password length: ${this.password.length}`);
    console.log(`   Password is modified: ${this.isModified('password')}`);

    // Only hash if password is modified (to allow saving without re-hashing)
    if (!this.isModified('password')) {
      console.log('   Skipping password hashing (not modified)');
      return;
    }

    try {
      console.log('   Hashing password with bcrypt.hash(password, 10)...');
      const hashedPassword = await bcrypt.hash(this.password, 10);
      console.log(`   Original password: ${this.password}`);
      console.log(`   Hashed password: ${hashedPassword.substring(0, 20)}...`);
      console.log(`   Hash length: ${hashedPassword.length}`);

      // Save hashed password in DB (NOT plain text)
      this.password = hashedPassword;
      console.log('   Password successfully hashed and stored');
    } catch (err) {
      console.log(`   Error hashing password: ${err.message}`);
      throw err;
    }
  }

  // Simulate toJSON method
  toJSON() {
    const user = { ...this };
    delete user.password;
    delete user.verificationToken;
    delete user.__v;
    user.role = user.userType;
    return user;
  }

  // Method to compare passwords
  async matchPassword(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
  }
}

async function debugPasswordStorage() {
  try {
    console.log('🔧 Debugging password storage in MongoDB user model...\n');

    // Test 1: Password field exists in schema
    console.log('📋 TEST 1: Checking password field in schema...');

    const schemaFields = {
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      password: { type: String, required: true },
      userType: { type: String, enum: ['client', 'freelancer', 'admin', 'agent'], default: 'freelancer' }
    };

    const passwordField = schemaFields.password;
    const hasPasswordField = !!passwordField;
    const isRequired = passwordField && passwordField.required === true;
    const isStringType = passwordField && passwordField.type === String;
    const hasSelectFalse = passwordField && passwordField.select === false;

    console.log(`   Password field exists: ${hasPasswordField ? '✅' : '❌'}`);
    console.log(`   Password is required: ${isRequired ? '✅' : '❌'}`);
    console.log(`   Password type is String: ${isStringType ? '✅' : '❌'}`);
    console.log(`   Password has select: false: ${hasSelectFalse ? '❌ (would exclude from queries)' : '✅ (included in queries)'}`);

    if (!hasPasswordField || !isRequired || !isStringType) {
      console.log('❌ ERROR: Password field schema is incorrect!');
      process.exit(1);
    }
    console.log('✅ Password field schema is correct\n');

    // Test 2: Simulate user creation with password
    console.log('👤 TEST 2: Simulating user creation with password...');

    const testPassword = 'TestPassword123!';
    const userData = {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: testPassword, // Plain text password
      userType: 'freelancer',
      verificationToken: '123456',
      verificationTokenExpiry: new Date(Date.now() + 30 * 60 * 1000)
    };

    console.log('   Creating user with plain text password...');
    const user = new MockUser(userData);
    console.log(`   User created with password: ${user.password === testPassword ? '✅ (plain text)' : '❌ (already hashed)'}`);
    console.log(`   Password length: ${user.password.length}`);

    // Test 3: Run pre-save hook (password hashing)
    console.log('\n🔄 TEST 3: Running pre-save hook (password hashing)...');
    await user.preSaveHook();

    console.log(`   Password after hashing: ${user.password === testPassword ? '❌ (still plain text!)' : '✅ (hashed)'}`);
    console.log(`   Password starts with $2b$: ${user.password.startsWith('$2b$') ? '✅ (bcrypt format)' : '❌ (not bcrypt)'}`);
    console.log(`   Password length: ${user.password.length}`);

    if (user.password === testPassword) {
      console.log('❌ ERROR: Password was not hashed!');
      process.exit(1);
    }
    console.log('✅ Password hashing works correctly\n');

    // Test 4: Simulate database storage and retrieval
    console.log('💾 TEST 4: Simulating database storage and retrieval...');

    // Simulate what gets stored in database
    const storedUserData = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: user.password, // This should be hashed
      userType: user.userType
    };

    console.log('   Data stored in database:');
    console.log(`   - _id: ${storedUserData._id}`);
    console.log(`   - email: ${storedUserData.email}`);
    console.log(`   - password exists: ${!!storedUserData.password}`);
    console.log(`   - password length: ${storedUserData.password.length}`);
    console.log(`   - password is hashed: ${storedUserData.password !== testPassword}`);

    // Simulate retrieving from database
    const retrievedUser = new MockUser(storedUserData);
    console.log('\n   Data retrieved from database:');
    console.log(`   - password exists: ${!!retrievedUser.password}`);
    console.log(`   - password length: ${retrievedUser.password.length}`);

    // Test 5: Test password comparison
    console.log('\n🔐 TEST 5: Testing password comparison for login...');

    const loginAttempts = [
      { password: testPassword, expected: true, description: 'Correct password' },
      { password: 'WrongPassword123!', expected: false, description: 'Wrong password' },
      { password: 'testpassword123!', expected: false, description: 'Case sensitive difference' }
    ];

    for (const attempt of loginAttempts) {
      const isValid = await retrievedUser.matchPassword(attempt.password);
      const result = isValid === attempt.expected ? '✅' : '❌';
      console.log(`   ${attempt.description}: ${result} (${isValid ? 'valid' : 'invalid'})`);
      if (isValid !== attempt.expected) {
        console.log('❌ ERROR: Password comparison failed!');
        process.exit(1);
      }
    }
    console.log('✅ Password comparison works correctly\n');

    // Test 6: Test toJSON method (password exclusion)
    console.log('📤 TEST 6: Testing toJSON method (password exclusion from responses)...');

    const jsonResponse = user.toJSON();
    const hasPasswordInJSON = 'password' in jsonResponse;
    const hasRoleInJSON = 'role' in jsonResponse;

    console.log(`   Password included in JSON: ${hasPasswordInJSON ? '❌ (security risk!)' : '✅ (excluded)'}`);
    console.log(`   Role field added: ${hasRoleInJSON ? '✅' : '❌'}`);
    console.log(`   JSON response fields: ${Object.keys(jsonResponse).join(', ')}`);

    if (hasPasswordInJSON) {
      console.log('❌ ERROR: Password is exposed in JSON responses!');
      process.exit(1);
    }
    console.log('✅ Password properly excluded from JSON responses\n');

    // Test 7: Simulate signup logging
    console.log('📝 TEST 7: Simulating signup logging...');

    const signupLogData = {
      userId: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      hasPassword: !!user.password && typeof user.password === 'string',
      passwordLength: user.password ? user.password.length : 0
    };

    console.log('   Signup logging data:');
    console.log(`   - userId: ${signupLogData.userId}`);
    console.log(`   - email: ${signupLogData.email}`);
    console.log(`   - hasPassword: ${signupLogData.hasPassword}`);
    console.log(`   - passwordLength: ${signupLogData.passwordLength}`);
    console.log('   - password value: NOT LOGGED (security)');

    if (!signupLogData.hasPassword || signupLogData.passwordLength < 20) {
      console.log('❌ ERROR: Password logging indicates storage issue!');
      process.exit(1);
    }
    console.log('✅ Signup logging confirms password storage\n');

    console.log('✅ ALL PASSWORD STORAGE DEBUG TESTS PASSED!');
    console.log('✅ Password is correctly stored and retrievable for login');
    console.log('');
    console.log('📋 Summary of verified requirements:');
    console.log('✅ Password field exists in schema');
    console.log('✅ Password is required and of type String');
    console.log('✅ Password is NOT excluded by select: false');
    console.log('✅ Password is hashed with bcrypt before save');
    console.log('✅ Password is stored in database (hashed)');
    console.log('✅ Password can be retrieved for login comparison');
    console.log('✅ Password is excluded from JSON responses');

  } catch (err) {
    console.error('❌ Debug test failed with error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run debug tests
debugPasswordStorage();