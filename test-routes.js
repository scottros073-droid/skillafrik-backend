#!/usr/bin/env node
require('./config/loadEnv');
console.log('[TEST] Starting route loading test...');

const names = [
  'authRoutes',
  'userRoutes',
  'dashboardRoutes',
  'jobRoutes',
  'proposalRoutes',
  'paymentRoutes',
  'walletRoutes',
  'escrowRoutes',
  'messageRoutes',
  'chatRoutes',
  'portfolioRoutes',
  'adRoutes',
  'gamificationRoutes',
  'adminRoutes',
  'notificationRoutes',
  'reviewRoutes',
  'hireRoutes',
  'monetizationRoutes',
  'uploadRoutes',
  'communityRoutes',
  'supportRoutes',
  'categoriesRoutes',
  'skillMatchRoutes',
  'ordersRoutes',
  'agentRoutes',
  'marketplaceRoutes'
];

for (const name of names) {
  try {
    console.log(`[TEST] Loading ${name}...`);
    require(`./routes/${name}`);
    console.log(`[✓] ${name} OK`);
  } catch (e) {
    console.error(`[✗] ${name} ERROR: ${e.message}`);
    process.exit(1);
  }
}

console.log('[TEST] All routes loaded successfully!');
