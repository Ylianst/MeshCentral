/**
* @description Unit tests for login-page account options
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginPageAccountOptions = require('../webserver/login-page-account-options.js').createLoginPageAccountOptions;

function createFixture(overrides) {
    const values = overrides || {};
    const state = { users: values.users || {} };
    const parent = { config: { settings: values.settings || {} }, certificates: { CommonName: values.commonName === undefined ? 'server.example.com' : values.commonName } };
    const getOptions = createLoginPageAccountOptions({ state: state, parent: parent, args: values.args || { port: 443 }, captcha: { createNewAccountCookie: function () { return 'captcha-cookie'; } } });
    return getOptions;
}

test('login features include framing and email usernames', function () {
    const options = createFixture({ settings: { allowframing: true } })({ id: 'tenant', usernameisemail: true });
    assert.equal(options.features, 32 + 0x00200000);
    assert.equal(options.serverPublicPort, 443);
});

test('verified public mail configuration enables account recovery', function () {
    const options = createFixture()({ id: 'tenant', mailserver: {}, passwordrequirements: {} });
    assert.equal(options.emailCheck, true);
    assert.equal(createFixture({ args: { port: 443, lanonly: true } })({ id: 'tenant', mailserver: {} }).emailCheck, false);
    assert.equal(createFixture()({ id: 'tenant', mailserver: {}, auth: 'ldap' }).emailCheck, false);
});

test('existing domain users and maintenance disable public account creation', function () {
    const users = { 'user/tenant/alice': { domain: 'tenant' } };
    assert.equal(createFixture({ users: users })({ id: 'tenant' }).newAccountsAllowed, false);
    assert.equal(createFixture({ settings: { maintenancemode: true } })({ id: 'tenant', newaccounts: true }).newAccountsAllowed, false);
    assert.equal(createFixture()({ id: 'tenant', newaccounts: true }).newAccountsAllowed, true);
});

test('configured account CAPTCHA returns its cookie and image URL', function () {
    const options = createFixture()({ id: 'tenant', newaccountscaptcha: true });
    assert.equal(options.newAccountCaptcha, 'captcha-cookie');
    assert.equal(options.newAccountCaptchaImage, 'newAccountCaptcha.ashx?x=captcha-cookie');
});
