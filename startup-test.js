#!/usr/bin/env node
/**
 * Quick start test - loads all modules without DB connection
 */
require('./config/loadEnv');

console.log('[STARTUP TEST] Starting backend startup test...');
console.log('[STARTUP TEST] Loading core modules...');

try {
  const express = require('express');
  console.log('[✓] Express loaded');
  
  const mongoose = require('mongoose');
  console.log('[✓] Mongoose loaded');
  
  const CronService = require('./services/cronService');
  console.log('[✓] CronService loaded');
  
  const logger = require('./utils/logger');
  console.log('[✓] Logger loaded');
  
  console.log('[STARTUP TEST] Loading all routes...');
  
  const routes = [
    'authRoutes', 'userRoutes', 'dashboardRoutes', 'jobRoutes', 'proposalRoutes',
    'paymentRoutes', 'walletRoutes', 'escrowRoutes', 'messageRoutes', 'chatRoutes',
    'portfolioRoutes', 'adRoutes', 'gamificationRoutes', 'adminRoutes',
    'notificationRoutes', 'reviewRoutes', 'hireRoutes', 'monetizationRoutes',
    'uploadRoutes', 'communityRoutes', 'supportRoutes', 'categoriesRoutes', 
    'skillMatchRoutes', 'ordersRoutes', 'marketplaceRoutes'
  ];
  
  for (const name of routes) {
    try {
      require(`./routes/${name}`);
      console.log(`[✓] ${name} loaded`);
    } catch (e) {
      console.error(`[✗] ${name} ERROR: ${e.message}`);
      console.error(e.stack);
      process.exit(1);
    }
  }
  
  console.log('[STARTUP TEST] All modules loaded successfully!');
  console.log('[STARTUP TEST] Backend is ready to start');
  
} catch (error) {
  console.error('[✗] STARTUP TEST FAILED:', error.message);
  console.error(error.stack);
  process.exit(1);
}
