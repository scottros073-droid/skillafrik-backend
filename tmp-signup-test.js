require('./config/loadEnv');
const { connectDatabase } = require('./utils/mongoConnectionManager');
const authController = require('./controllers/authController');

(async () => {
  try {
    await connectDatabase();
    const email = `test+${Date.now()}@example.com`;
    const req = {
      validated: {
        firstName: 'Test',
        lastName: 'User',
        email,
        password: 'Test12345',
        role: 'freelancer'
      },
      body: {},
      ip: '127.0.0.1',
      headers: { 'user-agent': 'node-test', host: 'localhost' }
    };

    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        console.log('RES', this.statusCode, JSON.stringify(data, null, 2));
        return this;
      },
      cookie(name, value, opts) {
        this.headers[name] = value;
        return this;
      },
      clearCookie(name, opts) {
        this.headers[`clear-${name}`] = opts;
        return this;
      }
    };

    await authController.signup(req, res);
    console.log('DONE', res.statusCode);
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    process.exit(0);
  }
})();
