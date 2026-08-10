/**
* @description Unit tests for successful login completion
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginCompletion = require('../webserver/login-completion.js').createLoginCompletion;

test('expired passwords preserve credentials and request a password change', function () {
    const redirects = [], encrypted = [];
    const parent = {
        debug: function () { },
        decryptSessionData: function () { return {}; },
        encryptSessionData: function (value) { encrypted.push(value); return 'encrypted'; }
    };
    const completeLogin = createLoginCompletion({ state: {}, parent: parent, setSessionRandom: function () { }, getQueryPortion: function () { return '?key=1'; }, handleRootRequestEx: function () { }, now: function () { return 2000000000000; } });
    const req = { session: {}, body: {}, clientIp: '192.0.2.1' };
    completeLogin(req, { redirect: function (url) { redirects.push(url); } }, { url: '/tenant/', passwordrequirements: { reset: 1 } }, { passchange: 1 }, 'user/tenant/alice', 'Alice', 'secret', false, null);
    assert.equal(req.session.loginmode, 6);
    assert.equal(req.session.messageid, 113);
    assert.deepEqual(encrypted[0], { rtuser: 'Alice', rtpass: 'secret', rtreset: true });
    assert.deepEqual(redirects, ['/tenant/?key=1']);
});

test('completed logins initialize the session and dispatch token metadata', function () {
    const writes = [], events = [], logs = [], redirects = [];
    const state = {
        db: { SetUser: function (user) { writes.push(user); } },
        getUserAgentInfo: function () { return { browserStr: 'Browser', osStr: 'OS' }; },
        CloneSafeUser: function (user) { return { _id: user._id }; },
        parent: { DispatchEvent: function () { events.push(Array.from(arguments)); }, authLog: function () { logs.push(Array.from(arguments)); } }
    };
    const completeLogin = createLoginCompletion({ state: state, parent: { debug: function () { } }, setSessionRandom: function (req) { req.session.x = 'random'; }, getQueryPortion: function () { return ''; }, handleRootRequestEx: function () { }, now: function () { return 2000000000000; } });
    const req = { session: { e: 'old', loginmode: 4 }, body: { viewmode: 3 }, clientIp: '192.0.2.1', headers: { 'user-agent': 'Test' }, connection: { remotePort: 1234 } };
    const user = { _id: 'user/tenant/alice', name: 'Alice', groups: ['staff'], login: 1 };
    completeLogin(req, { redirect: function (url) { redirects.push(url); } }, { id: 'tenant', url: '/tenant/' }, user, user._id, 'Alice', 'secret', false, { tokenName: 'API', tokenUser: 'token1', expire: 42, twoFactorType: 'otp' });
    assert.equal(writes.length, 1);
    assert.equal(req.session.userid, user._id);
    assert.equal(req.session.loginToken, 'token1');
    assert.equal(req.session.expire, 42);
    assert.equal(req.session.viewmode, 3);
    assert.equal(req.session.e, undefined);
    assert.equal(events[0][2].tokenName, 'API');
    assert.equal(events[0][2].twoFactorType, 'otp');
    assert.equal(logs.length, 1);
    assert.deepEqual(redirects, ['/tenant/']);
});
