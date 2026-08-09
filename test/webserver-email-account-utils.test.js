/**
* @description Unit tests for account email validation helpers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasOtherVerifiedUser = require('../webserver/email-account-utils.js').hasOtherVerifiedUser;
const hasDatabaseFailure = require('../webserver/email-account-utils.js').hasDatabaseFailure;
const createTemporaryPassword = require('../webserver/email-account-utils.js').createTemporaryPassword;

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

test('database failures and invalid result collections are detected', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('temporary password creation returns random and hash failures', async function () {
    const randomError = new Error('random failed');
    const randomResult = await new Promise(function (resolve) {
        createTemporaryPassword({ randomBytes: function (size, callback) { callback(randomError); } }, function () { }, function (error) { resolve(error); });
    });
    assert.equal(randomResult, randomError);

    const hashError = new Error('hash failed');
    const hashResult = await new Promise(function (resolve) {
        createTemporaryPassword({ randomBytes: function (size, callback) { callback(null, Buffer.alloc(size, 1)); } }, function (password, callback) { callback(hashError); }, function (error) { resolve(error); });
    });
    assert.equal(hashResult, hashError);
});

test('temporary password creation returns the generated password and hash', async function () {
    const result = await new Promise(function (resolve, reject) {
        createTemporaryPassword({ randomBytes: function (size, callback) { callback(null, Buffer.alloc(size, 1)); } }, function (password, callback) { callback(null, 'salt', 'hash'); }, function (error, value) { if (error) reject(error); else resolve(value); });
    });
    assert.equal(result.password, 'AQEBAQEBAQEBAQEBAQEBAQ');
    assert.equal(result.salt, 'salt');
    assert.equal(result.hash, 'hash');
});
