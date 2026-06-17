const assert = require('assert');
const test = require('node:test');
const { rateLimit } = require('../middleware/rateLimit');

const noop = () => {};

test('rateLimit should return middleware function', () => {
  const middleware = rateLimit({ windowMs: 1000, max: 2 });
  assert.strictEqual(typeof middleware, 'function');
});

test('rateLimit should allow requests under limit', async () => {
  const middleware = rateLimit({ windowMs: 1000, max: 2 });
  const req = { ip: 'loopback-ip', headers: {}, connection: {} };
  let called = false;

  await new Promise((resolve) => {
    middleware(req, {
      setHeader: noop,
      status: () => ({ json: () => resolve() })
    }, () => {
      called = true;
      resolve();
    });
  });

  assert.strictEqual(called, true);
});
