/**
* @description Unit tests for account recovery requests
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAccountRecovery = require('../../../../webserver/auth/account/account-recovery.js').createAccountRecovery;

test('asynchronous account checks retain the matching recovery user', function () {
    const callbacks = [], mails = [], redirects = [];
    const users = [
        { _id: 'user/tenant/alice', name: 'Alice', email: 'shared@example.com' },
        { _id: 'user/tenant/bob', name: 'Bob', email: 'shared@example.com' }
    ];
    const domain = { id: 'tenant', url: '/tenant/', mailserver: { sendAccountResetMail: function (domain, name, id) { mails.push([name, id]); } } };
    const state = {
        args: {},
        parent: { certificates: { CommonName: 'server.example.com' } },
        db: { GetUserWithVerifiedEmail: function (domainId, email, callback) { callback(null, users); } },
        getLanguageCodes: function () { return ['en']; }
    };
    const service = createAccountRecovery({
        state: state,
        parent: { debug: function () { } },
        checkUserIpAddress: function () { return domain; },
        checkEmail: function () { return true; },
        getQueryPortion: function () { return ''; },
        handleRootRequestEx: function () { },
        checkUserOneTimePasswordRequired: function () { return true; },
        checkUserOneTimePassword: function (req, domain, user, token, hwtoken, callback) { callbacks.push({ user: user, callback: callback }); },
        getRandomSixDigitInteger: function () { return 1; }
    });
    const req = { query: { key: 'key' }, session: {}, body: { email: 'SHARED@example.com' }, clientIp: '192.0.2.1' };
    service.handleResetAccountRequest(req, { redirect: function (url) { redirects.push(url); }, sendStatus: function () { } }, false);
    assert.equal(callbacks.length, 2);
    callbacks[1].callback(true);
    callbacks[0].callback(true);
    assert.deepEqual(mails, [['Bob', users[1]._id], ['Alice', users[0]._id]]);
    assert.deepEqual(redirects, ['/tenant/']);
    assert.equal(req.session.loginmode, 1);
    assert.equal(req.session.messageid, 1);
});

test('unknown recovery accounts return the non-disclosing success message', function () {
    const redirects = [];
    const domain = { id: 'tenant', url: '/tenant/' };
    const service = createAccountRecovery({
        state: { args: {}, parent: { certificates: { CommonName: 'server.example.com' } }, db: { GetUserWithVerifiedEmail: function (domainId, email, callback) { callback(null, []); } } },
        parent: { debug: function () { } },
        checkUserIpAddress: function () { return domain; },
        checkEmail: function () { return true; },
        getQueryPortion: function () { return ''; },
        handleRootRequestEx: function () { },
        checkUserOneTimePasswordRequired: function () { return false; },
        checkUserOneTimePassword: function () { },
        getRandomSixDigitInteger: function () { return 1; }
    });
    const req = { query: {}, session: {}, body: { email: 'missing@example.com' } };
    service.handleResetAccountRequest(req, { redirect: function (url) { redirects.push(url); }, sendStatus: function () { } }, false);
    assert.equal(req.session.messageid, 1);
    assert.deepEqual(redirects, ['/tenant/']);
});
