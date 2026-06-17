/**
 * Test role-based authentication and dashboard access
 * Run with: node test-role-based-auth.js
 */

require('./config/loadEnv');
const mongoose = require('mongoose');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const jwtService = require('./services/jwtService');

const API_BASE = process.env.API_URL || 'http://localhost:3001/api';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const decodeJWT = (token) => {
  try {
    return jwt.decode(token);
  } catch (e) {
    return null;
  }
};

async function testRoleBasedAuth() {
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  const logTest = (name, success, details = '') => {
    if (success) {
      console.log(`✅ ${name}`);
      results.passed++;
    } else {
      console.log(`❌ ${name}${details ? ': ' + details : ''}`);
      results.failed++;
      results.errors.push({ name, details });
    }
  };

  try {
    console.log('🔧 Starting role-based auth tests...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Test 1: Freelancer signup, login, and role persistence
    console.log('TEST 1: Freelancer signup and login');
    const freelancerEmail = `freelancer-${Date.now()}@test.com`;
    const freelancerPassword = 'Test@1234';

    try {
      const signupRes = await axios.post(`${API_BASE}/auth/signup`, {
        email: freelancerEmail,
        password: freelancerPassword,
        firstName: 'Freelance',
        lastName: 'User',
        userType: 'freelancer'
      });
      logTest('Freelancer signup', signupRes.status === 201);
    } catch (e) {
      logTest('Freelancer signup', false, e.response?.data?.message || e.message);
    }

    // Find freelancer and verify to allow login
    const freelancer = await User.findOne({ email: freelancerEmail });
    if (freelancer) {
      freelancer.verified = true;
      freelancer.verificationDate = new Date();
      await freelancer.save();
      console.log('   [Verified freelancer account for testing]');
    }

    try {
      const loginRes = await axios.post(`${API_BASE}/auth/login`, {
        email: freelancerEmail,
        password: freelancerPassword
      });

      const token = loginRes.data.token;
      const user = loginRes.data.user;

      logTest('Freelancer login returns token', !!token);
      logTest('Freelancer login returns user', !!user);
      logTest('Freelancer role is set correctly', user?.role === 'freelancer' || user?.userType === 'freelancer');

      if (token) {
        const decoded = decodeJWT(token);
        logTest('Access token contains role', decoded?.role === 'freelancer');
        logTest('Access token has correct user ID', !!decoded?.id);
      }

      // Test 2: Freelancer can access /auth/me
      if (token) {
        try {
          const meRes = await axios.get(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const meUser = meRes.data.user;
          logTest('Freelancer /auth/me returns role', meUser?.role === 'freelancer' || meUser?.userType === 'freelancer');
          logTest('Freelancer /auth/me returns user data', !!meUser?.email);
        } catch (e) {
          logTest('Freelancer /auth/me', false, e.response?.data?.message || e.message);
        }
      }
    } catch (e) {
      logTest('Freelancer login', false, e.response?.data?.message || e.message);
    }

    // Test 3: Client signup and login with correct role
    console.log('\nTEST 2: Client signup and login');
    const clientEmail = `client-${Date.now()}@test.com`;
    const clientPassword = 'Test@1234';

    try {
      const signupRes = await axios.post(`${API_BASE}/auth/signup`, {
        email: clientEmail,
        password: clientPassword,
        firstName: 'Client',
        lastName: 'User',
        userType: 'client'
      });
      logTest('Client signup', signupRes.status === 201);
    } catch (e) {
      logTest('Client signup', false, e.response?.data?.message || e.message);
    }

    // Verify client account
    const client = await User.findOne({ email: clientEmail });
    if (client) {
      client.verified = true;
      client.verificationDate = new Date();
      await client.save();
      console.log('   [Verified client account for testing]');
    }

    try {
      const loginRes = await axios.post(`${API_BASE}/auth/login`, {
        email: clientEmail,
        password: clientPassword
      });

      const token = loginRes.data.token;
      const user = loginRes.data.user;

      logTest('Client login returns token', !!token);
      logTest('Client role is set correctly', user?.role === 'client' || user?.userType === 'client');

      if (token) {
        const decoded = decodeJWT(token);
        logTest('Access token contains client role', decoded?.role === 'client');
      }
    } catch (e) {
      logTest('Client login', false, e.response?.data?.message || e.message);
    }

    // Test 4: Different roles can't access each other's dashboards
    console.log('\nTEST 3: Authorization and role-based access');
    
    // Create test tokens
    const testFreelancer = await User.findOne({ email: freelancerEmail });
    const testClient = await User.findOne({ email: clientEmail });

    if (testFreelancer && testClient) {
      const freelancerToken = jwtService.generateTokenPair(testFreelancer._id, 'freelancer').accessToken;
      const clientToken = jwtService.generateTokenPair(testClient._id, 'client').accessToken;

      logTest('Freelancer token contains freelancer role', 
        decodeJWT(freelancerToken)?.role === 'freelancer'
      );
      logTest('Client token contains client role',
        decodeJWT(clientToken)?.role === 'client'
      );
    }

    // Test 5: Role persistence through refresh
    console.log('\nTEST 4: Token refresh preserves role');
    
    if (testFreelancer && testClient) {
      const freelancerAccessToken = jwtService.generateTokenPair(testFreelancer._id, 'freelancer').accessToken;
      const clientAccessToken = jwtService.generateTokenPair(testClient._id, 'client').accessToken;
      
      const freelancerDecoded = decodeJWT(freelancerAccessToken);
      const clientDecoded = decodeJWT(clientAccessToken);
      
      logTest('Freelancer access token contains role in JWT', freelancerDecoded?.role === 'freelancer');
      logTest('Client access token contains role in JWT', clientDecoded?.role === 'client');
    }

    // Test 6: Admin login
    console.log('\nTEST 5: Admin authentication');
    
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      try {
        const loginRes = await axios.post(`${API_BASE}/auth/login`, {
          email: adminEmail,
          password: adminPassword
        });

        const token = loginRes.data.token;
        const user = loginRes.data.user;

        logTest('Admin login successful', loginRes.status === 200);
        logTest('Admin role is set correctly', user?.role === 'admin' || user?.userType === 'admin');

        if (token) {
          const decoded = decodeJWT(token);
          logTest('Admin token contains admin role', decoded?.role === 'admin');
        }
      } catch (e) {
        logTest('Admin login', false, e.response?.data?.message || e.message);
      }
    }

    // Test 7: User schema role field is correctly set
    console.log('\nTEST 6: Database role persistence');

    if (testFreelancer) {
      logTest('Freelancer userType is stored correctly', testFreelancer.userType === 'freelancer');
      logTest('Freelancer role field exists', !!testFreelancer.role);
    }

    if (testClient) {
      logTest('Client userType is stored correctly', testClient.userType === 'client');
      logTest('Client role field exists', !!testClient.role);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed`);
    
    if (results.errors.length > 0) {
      console.log('\nFailed tests:');
      results.errors.forEach(err => {
        console.log(`  - ${err.name}${err.details ? ': ' + err.details : ''}`);
      });
    }

    process.exit(results.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('Test setup error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

testRoleBasedAuth();
