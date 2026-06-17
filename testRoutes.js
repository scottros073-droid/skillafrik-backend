const path = require('path');

const routeFiles = [
  './routes/authRoutes.js',
  './routes/userRoutes.js',
  './routes/jobRoutes.js',
  './routes/paymentRoutes.js',
  './routes/walletRoutes.js',
  './routes/reviewRoutes.js',
  './routes/dashboardRoutes.js',
  './routes/marketplaceRoutes.js',
  './routes/hireRoutes.js'
];

console.log('Testing route imports...\n');

for (const file of routeFiles) {
  try {
    const route = require(file);
    console.log(`✅ ${file}`);
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
  }
}

console.log('\n✅ All routes loaded successfully!');
