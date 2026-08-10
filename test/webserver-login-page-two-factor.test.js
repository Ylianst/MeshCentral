/**
* @description Unit tests for login-page two-factor options
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getLoginTwoFactorOptions = require('../webserver/login-page-two-factor.js').getLoginTwoFactorOptions;

function parent() {
    return {
        smsserver: {}, msgserver: {}, firebase: {}, loginCookieEncryptionKey: 'key',
        decryptSessionData: function () { return { tuser: 'Alice', tpass: 'secret', u2f: 'challenge' }; },
        encodeCookie: function (value) { return JSON.stringify(value); }
    };
}

test('enabled two-factor methods follow session capabilities', function () {
    const request = { session: { temail: 1, tduo: 1, tsms: 1, tmsg: 1, tpush: 1 } };
    const domain = { mailserver: {}, duo2factor: {}, passwordrequirements: { autofido2fa: true, twofactortimeout: 12 }, twofactorcookiedurationdays: 7 };
    const options = getLoginTwoFactorOptions(request, domain, '', 4, parent());
    assert.deepEqual({ email: options.email, duo: options.duo, sms: options.sms, messaging: options.messaging, push: options.push }, { email: true, duo: true, sms: true, messaging: true, push: true });
    assert.equal(options.autoFido, true);
    assert.equal(options.cookieDays, 7);
    assert.equal(options.timeout, 12000);
});

test('password requirements can disable individual two-factor methods', function () {
    const request = { session: { temail: 1, tduo: 1, tsms: 1, tmsg: 1, tpush: 1 } };
    const disabled = { email2factor: false, duo2factor: false, sms2factor: false, msg2factor: false, push2factor: false };
    const options = getLoginTwoFactorOptions(request, { mailserver: {}, duo2factor: {}, passwordrequirements: disabled }, '', 4, parent());
    assert.deepEqual({ email: options.email, duo: options.duo, sms: options.sms, messaging: options.messaging, push: options.push }, { email: false, duo: false, sms: false, messaging: false, push: false });
});

test('password recovery suppresses email two-factor and defaults durations', function () {
    const options = getLoginTwoFactorOptions({ session: { temail: 'alice@example.com' } }, { mailserver: {} }, '', 5, parent());
    assert.equal(options.email, false);
    assert.equal(options.cookieDays, 30);
    assert.equal(options.timeout, 300000);
});

test('hardware challenges produce an encoded continuation state', function () {
    const options = getLoginTwoFactorOptions({ session: { e: 'encrypted' } }, {}, 'challenge', 4, parent());
    assert.deepEqual(JSON.parse(options.hardwareState), { u: 'Alice', p: 'secret', c: 'challenge' });
});
