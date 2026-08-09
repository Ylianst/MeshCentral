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
const getActiveUser = require('../webserver/email-account-utils.js').getActiveUser;
const hasEmailLinkCookie = require('../webserver/email-account-utils.js').hasEmailLinkCookie;
const hasAccountEmailRequest = require('../webserver/email-account-utils.js').hasAccountEmailRequest;
const resolveAccountEmail = require('../webserver/email-account-utils.js').resolveAccountEmail;

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

test('active account lookup detects users removed during asynchronous work', function () {
    const user = { _id: 'user/tenant/alice' };
    assert.equal(getActiveUser({ [user._id]: user }, user._id), user);
    assert.equal(getActiveUser({}, user._id), null);
    assert.equal(getActiveUser(null, user._id), null);
});

test('email link cookie presence distinguishes absent and supplied parameters', function () {
    assert.equal(hasEmailLinkCookie(null), false);
    assert.equal(hasEmailLinkCookie({}), false);
    assert.equal(hasEmailLinkCookie({ c: null }), false);
    assert.equal(hasEmailLinkCookie({ c: '' }), true);
    assert.equal(hasEmailLinkCookie({ c: 'cookie' }), true);
});

test('account email requests require both session and parsed body', function () {
    assert.equal(hasAccountEmailRequest(null), false);
    assert.equal(hasAccountEmailRequest({}), false);
    assert.equal(hasAccountEmailRequest({ session: {} }), false);
    assert.equal(hasAccountEmailRequest({ body: {} }), false);
    assert.equal(hasAccountEmailRequest({ session: {}, body: {} }), true);
});

test('account email resolution prefers and normalizes the submitted address', function () {
    const request = { body: { email: 'Alice@Example.COM' }, session: { temail: 'fallback@example.com' } };
    assert.equal(resolveAccountEmail(request), 'alice@example.com');
    assert.equal(request.body.email, 'alice@example.com');
});

test('account email resolution falls back to the session address', function () {
    assert.equal(resolveAccountEmail({ body: {}, session: { temail: 'fallback@example.com' } }), 'fallback@example.com');
    assert.equal(resolveAccountEmail({ body: { email: '' }, session: { temail: 'fallback@example.com' } }), 'fallback@example.com');
});
