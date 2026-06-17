const mongoose = require('mongoose');
const User = require('./models/User');
require('./config/loadEnv');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const email = 'admin@skillafrik.com';
    const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();

    console.log('userExists', !!user);
    if (user) {
      console.log('email', user.email);
      console.log('passwordExists', !!user.password);
      console.log('password', user.password ? user.password.substring(0, 20) + '...' : 'none');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('err', err.message);
    process.exit(1);
  }
})();
