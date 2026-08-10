/**
* @description Unit tests for shared two-factor authentication logic
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createTwoFactorAuthentication = require('../../../../webserver/auth/login/two-factor-authentication.js').createTwoFactorAuthentication;

function createFixture(settings) {
    settings = settings || {};
    const saved = [];
    const parent = {
        config: { settings: { no2factorauth: settings.disabled === true } },
        certificates: { CommonName: 'server.example.com' },
        smsserver: settings.sms ? {} : null,
        msgserver: settings.messenger ? { providers: 1 } : null,
        debug: function () { },
        loginCookieEncryptionKey: 'key',
        decodeCookie: function () { return settings.cookie || null; },
        decryptSessionData: function (value) { return Object.assign({}, value); },
        encryptSessionData: function (value) { return value; }
    };
    const state = {
        parent: parent,
        args: {},
        db: { SetUser: function (user) { saved.push(user); } },
        crypto: { randomBytes: function (length) { return Buffer.alloc(length, 1); } }
    };
    const service = createTwoFactorAuthentication({
        state: state,
        parent: parent,
        args: { port: 443 },
        checkCookieIp: function (expected, actual) { return expected === actual; },
        require: function (name) {
            if (name === 'ipcheck') return { match: function (address, range) { return settings.ipMatch === true; } };
            if (name === 'otplib') return { verifySync: function () { return { valid: settings.otpValid === true }; }, createGuardrails: function () { return {}; } };
            throw new Error('Unexpected module: ' + name);
        }
    });
    return { service: service, state: state, parent: parent, saved: saved };
}

test('login tokens and configured source addresses skip a second factor', function () {
    const fixture = createFixture({ ipMatch: true });
    const domain = { passwordrequirements: { skip2factor: ['192.0.2.0/24'] } };
    const user = { _id: 'user/tenant/alice' };
    assert.deepEqual(fixture.service.checkUserOneTimePasswordSkip(domain, user, { headers: {}, clientIp: '192.0.2.1' }, { tokenName: 'automation' }), { twoFactorType: 'tokenlogin' });
    assert.deepEqual(fixture.service.checkUserOneTimePasswordSkip(domain, user, { headers: {}, clientIp: '192.0.2.1' }), { twoFactorType: 'ipaddr' });
});

test('trusted cookies skip 2FA only for the matching user and address', function () {
    const user = { _id: 'user/tenant/alice' };
    const fixture = createFixture({ cookie: { userid: user._id, ip: '192.0.2.1' } });
    const result = fixture.service.checkUserOneTimePasswordSkip({}, user, { headers: { cookie: 'twofactor=encoded' }, clientIp: '192.0.2.1' });
    assert.deepEqual(result, { twoFactorType: 'cookie' });
});

test('2FA requirements reflect available factors and the global switch', function () {
    const domain = { passwordrequirements: {}, mailserver: {} };
    const user = { _id: 'user/tenant/alice', otpsecret: 'secret' };
    assert.equal(createFixture().service.checkUserOneTimePasswordRequired(domain, user, { headers: {} }), true);
    assert.equal(createFixture({ disabled: true }).service.checkUserOneTimePasswordRequired(domain, user, { headers: {} }), false);
});

test('fresh email tokens are consumed and persisted', function () {
    const fixture = createFixture();
    const domain = { mailserver: {} };
    const user = { _id: 'user/tenant/alice', otpekey: { k: '12345678', d: Date.now() - 1000 } };
    let result;
    fixture.service.checkUserOneTimePassword({ clientIp: '192.0.2.1' }, domain, user, '12345678', null, function (valid, authData) { result = [valid, authData]; });
    assert.deepEqual(result, [true, { twoFactorType: 'email' }]);
    assert.deepEqual(user.otpekey, {});
    assert.equal(fixture.saved[0], user);
});

test('hardware challenges contain registered WebAuthn key IDs and persist state', function () {
    const fixture = createFixture();
    const req = { session: { e: {} } };
    const user = { otphkeys: [{ type: 3, keyId: 'key-one' }, { type: 2, keyId: 'ignored' }] };
    let challenge;
    fixture.service.getHardwareKeyChallenge(req, { passwordrequirements: { fidopininput: 'required' } }, user, function (value) { challenge = JSON.parse(value); });
    assert.equal(challenge.type, 'webAuthn');
    assert.deepEqual(challenge.keyIds, ['key-one']);
    assert.equal(challenge.userVerification, 'required');
    assert.equal(req.session.e.u2f, challenge.challenge);
});
