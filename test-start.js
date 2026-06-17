// Test script to check server loading
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

try {
  console.log('Loading server...');
  require('./server.js');
  console.log('Server loaded successfully');
} catch (err) {
  console.error('Error loading server:', err.message);
  console.error(err.stack);
  process.exit(1);
}