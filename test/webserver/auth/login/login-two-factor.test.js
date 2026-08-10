/**
* @description Unit tests for two-factor login challenges
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginTwoFactorHandler = require('../../../../webserver/auth/login/login-two-factor.js').createLoginTwoFactorHandler;

test('email two-factor requests persist and send a fresh code', function () {
    const writes = [], mails = [], redirects = [];
    const state = { common: { zeroPad: function (value, length) { return String(value).padStart(length, '0'); } }, db: { SetUser: function (user) { writes.push(user); } }, getLanguageCodes: function () { return ['en']; } };
    const parent = { debug: function () { } };
    const domain = { id: 'tenant', url: '/tenant/', mailserver: { sendAccountLoginMail: function () { mails.push(Array.from(arguments)); } } };
    const handler = createLoginTwoFactorHandler({ state: state, parent: parent, getRandomEightDigitInteger: function () { return 42; }, getRandomSixDigitInteger: function () { return 1; }, getQueryPortion: function () { return ''; }, handleRootRequestEx: function () { }, checkUserOneTimePasswordRequired: function () { return true; }, checkUserOneTimePassword: function () { }, completeLoginRequest: function () { }, cleanRemoteAddr: function (value) { return value; }, now: function () { return 1000; } });
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'alice@example.com', emailVerified: true, otpekey: {} };
    const req = { query: {}, body: { hwtoken: '**email**' }, session: {} };
    assert.equal(handler(req, { redirect: function (url) { redirects.push(url); } }, domain, user, user._id, 'Alice', 'secret', false, null, null), true);
    assert.deepEqual(user.otpekey, { k: '00000042', d: 1000 });
    assert.equal(writes.length, 1);
    assert.equal(mails.length, 1);
    assert.equal(req.session.loginmode, 4);
    assert.equal(req.session.messageid, 2);
    assert.deepEqual(redirects, ['/tenant/']);
});

test('two-factor handler leaves logins without a challenge untouched', function () {
    const handler = createLoginTwoFactorHandler({ state: {}, parent: {}, getQueryPortion: function () { return ''; }, checkUserOneTimePasswordRequired: function () { return false; } });
    assert.equal(handler({ session: {}, body: {} }, {}, {}, {}, 'user', 'Alice', 'secret', false, null, null), false);
});
