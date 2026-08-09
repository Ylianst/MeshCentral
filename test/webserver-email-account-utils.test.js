/**
* @description Unit tests for account email validation helpers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasOtherVerifiedUser = require('../webserver/email-account-utils.js').hasOtherVerifiedUser;

test('the current account does not conflict with its own verified email', function () {
    assert.equal(hasOtherVerifiedUser([{ _id: 'user/tenant/alice' }], 'user/tenant/alice'), false);
});

test('another account with the verified email is detected', function () {
    assert.equal(hasOtherVerifiedUser([{ _id: 'user/tenant/alice' }, { _id: 'user/tenant/bob' }], 'user/tenant/alice'), true);
    assert.equal(hasOtherVerifiedUser([{ _id: 'user/tenant/bob' }], 'user/tenant/alice'), true);
});

test('missing email query results do not report a conflict', function () {
    assert.equal(hasOtherVerifiedUser(null, 'user/tenant/alice'), false);
    assert.equal(hasOtherVerifiedUser([], 'user/tenant/alice'), false);
});
