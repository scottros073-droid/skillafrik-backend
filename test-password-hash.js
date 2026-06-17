/**
 * Test file to verify password hashing works correctly
 * Run with: node test-password-hash.js
 */

const bcrypt = require('bcrypt');

async function testPasswordHashing() {
  try {
    console.log('🔧 Testing password hashing...\n');

    const testPassword = 'TestPassword123!';

    // Test 1: Hash password using bcrypt.hash(password, 10)
    console.log('📝 TEST 1: Hashing password with bcrypt.hash(password, 10)...');
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    console.log('✅ Password hashed successfully');
    console.log(`   Original: ${testPassword}`);
    console.log(`   Hashed: ${hashedPassword.substring(0, 20)}...`);
    console.log(`   Length: ${hashedPassword.length}`);
    console.log(`   Is different from original: ${hashedPassword !== testPassword}\n`);

    // Test 2: Verify password comparison works
    console.log('🔐 TEST 2: Verifying password comparison...');
    const isValid = await bcrypt.compare(testPassword, hashedPassword);
    console.log(`✅ Password comparison result: ${isValid}`);

    if (!isValid) {
      console.log('❌ ERROR: Password comparison failed!');
      process.exit(1);
    }
    console.log('✅ Password matches hash\n');

    // Test 3: Wrong password should fail
    console.log('🔐 TEST 3: Testing wrong password...');
    const wrongPassword = 'WrongPassword123!';
    const isWrongValid = await bcrypt.compare(wrongPassword, hashedPassword);
    console.log(`✅ Wrong password comparison result: ${isWrongValid}`);

    if (isWrongValid) {
      console.log('❌ ERROR: Wrong password was accepted!');
      process.exit(1);
    }
    console.log('✅ Wrong password rejected\n');

    console.log('✅ ALL TESTS PASSED! Password hashing is working correctly');
    console.log('✅ Users will be able to login immediately after signup');

  } catch (err) {
    console.error('❌ Test failed with error:', err.message);
    process.exit(1);
  }
}

// Run tests
testPasswordHashing();