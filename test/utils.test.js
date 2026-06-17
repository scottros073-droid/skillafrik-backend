const assert = require('assert');
const test = require('node:test');
const { containsBlockedCommunication } = require('../utils/spamFilter');

test('containsBlockedCommunication should flag phone numbers', () => {
  assert.strictEqual(containsBlockedCommunication('Call me at 08012345678'), true);
});

test('containsBlockedCommunication should flag email addresses', () => {
  assert.strictEqual(containsBlockedCommunication('Email test@example.com'), true);
});

test('containsBlockedCommunication should flag WhatsApp links', () => {
  assert.strictEqual(containsBlockedCommunication('Join via wa.me/1234567890'), true);
});

test('containsBlockedCommunication should not flag clean text', () => {
  assert.strictEqual(containsBlockedCommunication('I am interested in this job and can deliver fast.'), false);
});