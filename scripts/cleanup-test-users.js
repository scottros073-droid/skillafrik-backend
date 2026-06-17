const path = require('path');
require(path.join(__dirname, '..', 'config', 'loadEnv'));

const { connectDatabase, disconnectDatabase } = require('../utils/mongoConnectionManager');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

const TARGET_EMAILS = [
  'adewaleadedimeji2020@gmail.com',
  'scottros077@gmail.com',
  'scottros073@gmail.com'
];

const runCleanup = async () => {
  console.log('Starting one-time admin cleanup...');

  const connected = await connectDatabase();
  if (!connected) {
    console.error('Failed to connect to MongoDB. Aborting cleanup.');
    process.exit(1);
  }

  try {
    const users = await User.find({ email: { $in: TARGET_EMAILS } }).select('_id email');
    const foundEmails = users.map((user) => user.email);
    const missingEmails = TARGET_EMAILS.filter((email) => !foundEmails.includes(email));

    if (missingEmails.length > 0) {
      console.warn('The following target emails were not found in the database:', missingEmails);
    }

    if (users.length === 0) {
      console.log('No matching users found. Nothing to delete.');
      return;
    }

    const userIds = users.map((user) => user._id);

    const refreshResult = await RefreshToken.deleteMany({ userId: { $in: userIds } });
    console.log(`Deleted ${refreshResult.deletedCount} refresh token(s) for target users.`);

    const deleteResult = await User.deleteMany({ _id: { $in: userIds } });
    console.log(`Deleted ${deleteResult.deletedCount} user record(s).`);

    // Verification
    const usersRemaining = await User.countDocuments({ email: { $in: TARGET_EMAILS } });
    const tokensRemaining = await RefreshToken.countDocuments({ userId: { $in: userIds } });
    console.log(`Verification: ${usersRemaining} matching users still present.`);
    console.log(`Verification: ${tokensRemaining} matching refresh tokens still present.`);

    if (usersRemaining === 0 && tokensRemaining === 0) {
      console.log('Verification passed: target users and associated refresh tokens are removed.');
    } else {
      console.warn('Verification failed: there are remaining records for the target accounts.');
    }

    console.log('Cleanup completed successfully.');
  } catch (error) {
    console.error('Cleanup failed with error:', error);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
};

runCleanup();
