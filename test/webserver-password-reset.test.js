/**
* @description Unit tests for password reset requests
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPasswordReset = require('../webserver/password-reset.js').createPasswordReset;

function createFixture(overrides) {
    const calls = { redirects: [], writes: [], events: [], completions: [] };
    const user = { _id: 'user/tenant/alice', name: 'Alice', salt: 'old-salt', hash: 'old-hash', passchange: 10, passtype: 1 };
    const state = {
        users: { 'user/tenant/alice': user },
        common: { checkPasswordRequirements: function () { return true; } },
        authenticate: function (name, pass, domain, callback) { callback(null, user._id, null, { twoFactorType: 'otp' }); },
        checkOldUserPasswords: function (domain, account, password, callback) { callback(0); },
        db: { changeStream: false, SetUser: function (account) { calls.writes.push(account); } },
        CloneSafeUser: function (account) { return { _id: account._id }; },
        parent: { DispatchEvent: function () { calls.events.push(Array.from(arguments)); } }
    };
    const parent = {
        debug: function () { },
        decryptSessionData: function () { return { rtuser: 'Alice', rtpass: 'old-password', tuser: 'Alice', tpass: 'old-password' }; }
    };
    const service = createPasswordReset(Object.assign({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return { id: 'tenant', url: '/tenant/', passwordrequirements: { hint: true, oldpasswordban: 1 } }; },
        getQueryPortion: function () { return ''; },
        handleRootRequestEx: function () { },
        setSessionRandom: function (req) { req.session.x = 'random'; },
        completeLoginRequest: function () { calls.completions.push(Array.from(arguments)); },
        hashPassword: function (password, callback) { callback(null, 'new-salt', 'new-hash'); },
        updatePasswordHint: function (account, requirements, hint) { account.passhint = hint; },
        now: function () { return 2000000; }
    }, overrides || {}));
    const req = { query: {}, session: { e: 'encrypted' }, body: { rpassword1: 'new-password', rpassword2: 'new-password', rpasswordhint: 'new hint' }, clientIp: '192.0.2.1' };
    const res = { redirect: function (url) { calls.redirects.push(url); }, sendStatus: function () { } };
    return { service: service, state: state, parent: parent, user: user, req: req, res: res, calls: calls };
}

test('invalid password recovery state is cleared and redirected', function () {
    const fixture = createFixture({ parent: { debug: function () { }, decryptSessionData: function () { return {}; } } });
    fixture.req.session.loginmode = 6;
    fixture.service.handleResetPasswordRequest(fixture.req, fixture.res, false);
    assert.equal(fixture.req.session.e, undefined);
    assert.equal(fixture.req.session.loginmode, undefined);
    assert.deepEqual(fixture.calls.redirects, ['/tenant/']);
});

test('valid password resets persist history and complete the login', function () {
    const fixture = createFixture();
    fixture.service.handleResetPasswordRequest(fixture.req, fixture.res, false);
    assert.equal(fixture.user.salt, 'new-salt');
    assert.equal(fixture.user.hash, 'new-hash');
    assert.equal(fixture.user.passhint, 'new hint');
    assert.deepEqual(fixture.user.oldpasswords, [{ salt: 'old-salt', hash: 'old-hash', start: 10, end: 2000 }]);
    assert.equal(fixture.user.passtype, undefined);
    assert.equal(fixture.calls.writes.length, 1);
    assert.equal(fixture.calls.events.length, 1);
    assert.equal(fixture.calls.completions.length, 1);
});
