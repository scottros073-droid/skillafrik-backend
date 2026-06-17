const cron = require('node-cron');
const Escrow = require('../models/Escrow');
const { autoReleaseEscrow } = require('../controllers/escrowController');
const prodLogger = require('../utils/productionLogger');

class CronService {
  // Auto-release escrows after 7 days
  static startAutoReleaseCron() {
    // Run every hour
    cron.schedule('0 * * * *', async () => {
      try {
        const expiredEscrows = await Escrow.find({
          status: 'FUNDED',
          autoReleaseDateAt: { $lt: new Date() }
        });

        for (const escrow of expiredEscrows) {
          try {
            await autoReleaseEscrow(escrow._id);
          } catch (error) {
            prodLogger.error(`Failed to auto-release escrow ${escrow._id}`, error?.message || error);
          }
        }
      } catch (error) {
        prodLogger.error('Auto-release cron error', error?.message || error);
      }
    });
  }

  // Clean up old notifications (optional)
  static startCleanupCron() {
    // Run daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        // Add cleanup logic here if needed
        // e.g., delete old notifications, expired sessions, etc.
      } catch (error) {
        prodLogger.error('Cleanup cron error', error?.message || error);
      }
    });
  }

  // Start all cron jobs
  static startAll() {
    this.startAutoReleaseCron();
    this.startCleanupCron();
    prodLogger.info('All cron jobs started');
  }
}

module.exports = CronService;