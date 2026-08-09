/**
* @description Unit tests for Passport strategy initialization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ssoStrategies = require('../webserver/sso-strategies.js');

function createFixture() {
    const middleware = [];
    const strategies = [];
    const constructors = [];
    const passport = {
        serializeUser: function (handler) { this.serialize = handler; },
        deserializeUser: function (handler) { this.deserialize = handler; },
        initialize: function () { return 'passport-initialize'; },
        use: function (name, strategy) { strategies.push([name, strategy]); }
    };
    class GoogleStrategy {
        constructor(options, callback) { this.options = options; this.callback = callback; constructors.push(this); }
    }
    class GitHubStrategy {
        constructor(options, callback) { this.options = options; this.callback = callback; constructors.push(this); }
    }
    const modules = {
        passport: passport,
        'connect-flash': function () { return 'connect-flash'; },
        'passport-google-oauth20': GoogleStrategy,
        'passport-github2': GitHubStrategy
    };
    const state = {
        app: { use: function (handler) { middleware.push(handler); } },
        common: { validateObject: function (value) { return (value != null) && (typeof value == 'object') && !Array.isArray(value); } }
    };
    const parent = { authLog: function () { }, debug: function () { }, config: { domains: {} }, certificates: { CommonName: 'server.example.com' } };
    const setup = ssoStrategies.createSsoStrategies({ state: state, parent: parent, args: { port: 443 }, require: function (name) {
        if (modules[name] == null) throw new Error('Unexpected module: ' + name);
        return modules[name];
    } });
    return { setup: setup, state: state, passport: passport, middleware: middleware, strategies: strategies, constructors: constructors };
}

test('exports stable strategy flag values', function () {
    assert.deepEqual(ssoStrategies.constants, { twitter: 1, google: 2, github: 4, reddit: 8, azure: 16, oidc: 32, saml: 64, intelSaml: 128, jumpCloudSaml: 256 });
});

test('null is not treated as a group configuration', function () {
    assert.equal(ssoStrategies.isGroupConfiguration(null), false);
    assert.equal(ssoStrategies.isGroupConfiguration(undefined), false);
    assert.equal(ssoStrategies.isGroupConfiguration({}), true);
});

test('explicit false disables revoking SSO administrator rights', function () {
    assert.equal(ssoStrategies.shouldRevokeAdmin({}), true);
    assert.equal(ssoStrategies.shouldRevokeAdmin({ revokeAdmin: true }), true);
    assert.equal(ssoStrategies.shouldRevokeAdmin({ revokeAdmin: false }), false);
});

test('domains without authentication strategies require no provider modules', async function () {
    const fixture = createFixture();
    const result = await fixture.setup({ id: 'tenant', url: '/tenant/' });
    assert.equal(result, 0);
    assert.equal(fixture.middleware.length, 0);
});

test('Google strategy setup configures middleware, callback URL and verified profile', async function () {
    const fixture = createFixture();
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { google: { clientid: 'client', clientsecret: 'secret' } } };
    const result = await fixture.setup(domain);
    assert.equal(result, ssoStrategies.constants.google);
    assert.equal(domain.passport, fixture.passport);
    assert.deepEqual(fixture.middleware, ['passport-initialize', 'connect-flash']);
    assert.equal(fixture.strategies[0][0], 'google-tenant');
    assert.deepEqual(fixture.constructors[0].options, { clientID: 'client', clientSecret: 'secret', callbackURL: '/tenant/auth-google-callback' });
    let mappedUser;
    fixture.constructors[0].callback('token', 'secret', { id: 'profile-id', displayName: 'Alice', emails: [{ value: 'alice@example.com', verified: true }] }, function (err, user) { mappedUser = user; });
    assert.deepEqual(mappedUser, { sid: '~google:profile-id', name: 'Alice', strategy: 'google', email: 'alice@example.com' });
});

test('GitHub Enterprise endpoint overrides are retained', async function () {
    const fixture = createFixture();
    const github = { clientid: 'client', clientsecret: 'secret', authorizationurl: 'https://git/auth', tokenurl: 'https://git/token', userprofileurl: 'https://git/user', useremailurl: 'https://git/email' };
    const domain = { id: 'tenant', url: '/', authstrategies: { github: github } };
    const result = await fixture.setup(domain);
    assert.equal(result, ssoStrategies.constants.github);
    assert.equal(fixture.constructors[0].options.authorizationURL, 'https://git/auth');
    assert.equal(fixture.constructors[0].options.tokenURL, 'https://git/token');
    assert.equal(fixture.constructors[0].options.userProfileURL, 'https://git/user');
    assert.equal(fixture.constructors[0].options.userEmailURL, 'https://git/email');
});
