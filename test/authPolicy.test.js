const test = require('node:test');
const assert = require('node:assert/strict');
const { getAccountAccessFailure } = require('../services/authPolicy');

test('auth policy rejects missing users', () => {
  const failure = getAccountAccessFailure(null);

  assert.equal(failure.status, 401);
  assert.equal(failure.message, 'Invalid authentication session');
});

test('auth policy rejects suspended, banned, inactive, and unverified users', () => {
  assert.equal(getAccountAccessFailure({ status: 'suspended' }).status, 403);
  assert.equal(getAccountAccessFailure({ status: 'banned' }).status, 403);
  assert.equal(getAccountAccessFailure({ status: 'disabled' }).message, 'Account is not active');

  const unverified = getAccountAccessFailure({
    status: 'active',
    verified: false,
    email: 'pending@example.com'
  });

  assert.equal(unverified.status, 403);
  assert.equal(unverified.data.requiresVerification, true);
});

test('auth policy allows active verified users and admin sessions', () => {
  assert.equal(getAccountAccessFailure({ status: 'active', verified: true }), null);
  assert.equal(getAccountAccessFailure({ _id: 'admin-user-id', status: 'active', verified: false }), null);
});
