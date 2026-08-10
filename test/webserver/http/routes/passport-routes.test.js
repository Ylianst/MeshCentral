/**
* @description Unit tests for Passport domain route registration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPassportRoutes = require('../../../../webserver/http/routes/passport-routes.js').createPassportRoutes;

const flags = { twitter: 1, google: 2, github: 4, azure: 8, oidc: 16, saml: 32, intelSaml: 64, jumpCloudSaml: 128 };

function createFixture(domain) {
    const routes = [];
    const authentications = [];
    const app = {};
    for (const method of ['get', 'post']) app[method] = function () { routes.push([method].concat(Array.from(arguments))); };
    domain.passport = {
        authenticate: function (name, options) {
            authentications.push([name, options]);
            return function (req, res, next) { if (next) next(); };
        }
    };
    const service = createPassportRoutes({
        state: { app: app },
        parent: {
            loginCookieEncryptionKey: 'key',
            authLog: function () { },
            encodeCookie: function () { return 'encoded-state'; },
            decodeCookie: function (value) { return value === 'valid-state' ? { p: 'azure' } : null; }
        },
        flags: flags,
        getDomain: function () { return domain; },
        strategyLogin: function strategyLogin() { },
        urlencoded: function () { return 'urlencoded'; }
    });
    return { service: service, routes: routes, authentications: authentications, domain: domain };
}

function findRoute(fixture, method, path) {
    return fixture.routes.find(function (route) { return (route[0] === method) && (route[1] === path); });
}

test('registers only strategies enabled by the domain flags', function () {
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: flags.google | flags.github } };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    assert.ok(findRoute(fixture, 'get', '/tenant/auth-google'));
    assert.ok(findRoute(fixture, 'get', '/tenant/auth-github-callback'));
    assert.equal(findRoute(fixture, 'get', '/tenant/auth-twitter'), undefined);
    assert.equal(findRoute(fixture, 'post', '/tenant/auth-saml-callback'), undefined);
});

test('Google authorization retains scopes and domain-specific strategy name', function () {
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: flags.google } };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    let nextCalls = 0;
    findRoute(fixture, 'get', '/tenant/auth-google')[2]({}, {}, function () { nextCalls++; });
    assert.deepEqual(fixture.authentications[0], ['google-tenant', { scope: ['profile', 'email'] }]);
    assert.equal(nextCalls, 1);
});

test('Twitter callback retries an empty redirected session once', function () {
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: flags.twitter } };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    const response = { set: function (name, value) { this.contentType = [name, value]; }, end: function (body) { this.body = body; } };
    findRoute(fixture, 'get', '/tenant/auth-twitter-callback')[2]({ session: {}, query: {}, url: '/tenant/auth-twitter-callback?x=1' }, response, function () { });
    assert.deepEqual(response.contentType, ['Content-Type', 'text/html']);
    assert.match(response.body, /nmr%3D1/);
    assert.equal(fixture.authentications.length, 0);
});

test('OIDC callback uses the configured redirect path and URL-encoded middleware', function () {
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: flags.oidc, oidc: { client: { redirect_uri: 'https://login.example.com/custom/callback' } } } };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    const route = findRoute(fixture, 'get', '/custom/callback');
    assert.equal(route[2], 'urlencoded');
    route[3]({ session: { 'oidc-tenant': true } }, {}, function () { });
    assert.deepEqual(fixture.authentications[0], ['oidc-tenant', { failureRedirect: '/tenant/', failureFlash: true }]);
});

test('generic SAML preserves query information in RelayState', function () {
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: flags.saml } };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    const req = { query: { target: 'node' }, protocol: 'https', hostname: 'server.example.com', originalUrl: '/tenant/auth-saml/?target=node' };
    findRoute(fixture, 'get', '/tenant/auth-saml')[2](req, {}, function () { });
    assert.equal(req.query.RelayState, encodeURIComponent('https://server.example.com/tenant/?target=node'));
    assert.equal(fixture.authentications[0][0], 'saml-tenant');
});
