// Test script to verify /auth/me endpoint fix for 401 Unauthorized

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://afrikskill-hash.onrender.com/api';

const testConfig = {
  email: `testuser_${Date.now()}@test.com`,
  password: 'TestPassword123',
  firstName: 'Test',
  lastName: 'User'
};

const api = axios.create({
  baseURL: BASE_URL,
  validateStatus: () => true // Don't throw on any status
});

async function runTests() {
  console.log('\n=== Testing /auth/me Endpoint ===\n');
  
  let token = null;
  let userId = null;

  try {
    // TEST 1: Register user
    console.log('1️⃣ TEST: User Registration');
    let response = await api.post('/auth/register', testConfig);
    console.log(`Status: ${response.status}`);
    console.log(`Success: ${response.data.success}`);
    if (response.status === 200 || response.status === 201) {
      console.log('✅ Registration successful\n');
      userId = response.data.data?.user?._id;
    } else {
      console.log(`⚠️ Registration failed: ${response.data.message}\n`);
    }

    // TEST 2: Login
    console.log('2️⃣ TEST: User Login');
    response = await api.post('/auth/login', {
      email: testConfig.email,
      password: testConfig.password
    });
    console.log(`Status: ${response.status}`);
    console.log(`Success: ${response.data.success}`);
    
    if (response.status === 200 && response.data.token) {
      token = response.data.token;
      console.log(`✅ Login successful`);
      console.log(`Token: ${token.substring(0, 20)}...`);
      console.log(`User: ${response.data.user?.email}\n`);
    } else {
      console.log(`⚠️ Login failed: ${response.data.message}\n`);
      return;
    }

    // TEST 3: Call /auth/me WITH valid token
    console.log('3️⃣ TEST: Call /auth/me WITH valid token');
    response = await api.get('/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log(`Status: ${response.status}`);
    console.log(`Success: ${response.data.success}`);
    
    if (response.status === 200 && response.data.user) {
      console.log(`✅ /auth/me successful`);
      console.log(`User: ${response.data.user?.email}`);
      console.log(`User ID: ${response.data.user?._id}\n`);
    } else {
      console.log(`❌ /auth/me failed: ${response.data.message}`);
      console.log(`Response: ${JSON.stringify(response.data)}\n`);
    }

    // TEST 4: Call /auth/me WITHOUT token
    console.log('4️⃣ TEST: Call /auth/me WITHOUT token (should be 401)');
    response = await api.get('/auth/me');
    console.log(`Status: ${response.status}`);
    console.log(`Message: ${response.data.message}`);
    
    if (response.status === 401) {
      console.log(`✅ Correctly returned 401 Unauthorized\n`);
    } else {
      console.log(`❌ Should return 401, got ${response.status}\n`);
    }

    // TEST 5: Call /auth/me WITH invalid token
    console.log('5️⃣ TEST: Call /auth/me WITH invalid token (should be 401)');
    response = await api.get('/auth/me', {
      headers: {
        Authorization: 'Bearer invalid_token_12345'
      }
    });
    console.log(`Status: ${response.status}`);
    console.log(`Message: ${response.data.message}`);
    
    if (response.status === 401) {
      console.log(`✅ Correctly rejected invalid token\n`);
    } else {
      console.log(`❌ Should return 401, got ${response.status}\n`);
    }

    // TEST 6: Call /auth/me WITH malformed header
    console.log('6️⃣ TEST: Call /auth/me WITH malformed header (should be 401)');
    response = await api.get('/auth/me', {
      headers: {
        Authorization: 'Basic ' + token // Wrong auth type
      }
    });
    console.log(`Status: ${response.status}`);
    console.log(`Message: ${response.data.message}`);
    
    if (response.status === 401) {
      console.log(`✅ Correctly rejected malformed header\n`);
    } else {
      console.log(`❌ Should return 401, got ${response.status}\n`);
    }

    console.log('=== All Tests Complete ===\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test error:', error.message);
    process.exit(1);
  }
}

runTests();
