/**
* @description Unit tests for authenticated application rendering
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createApplicationRenderer = require('../../../webserver/ui/application-render.js').createApplicationRenderer;

test('authenticated application state is loaded and rendered', function () {
    const loadedKeys = [], rendered = [], cookies = [];
    const state = {
        db: { databaseType: 1, Get: function (key, callback) { loadedKeys.push(key); callback(null, [{ state: '{}' }]); } },
        common: { validateStrArray: Array.isArray, replacePlaceholders: function (value) { return value; } },
        filterUserWebState: function (value) { return value; },
        getDomainUserFeatures: function () { return { features: 1, features2: 2, features3: 3 }; },
        getWebServerName: function () { return 'server.example.com'; },
        webCertificateFullHashs: { tenant: 'hash' }
    };
    const parent = {
        config: { settings: {} }, loginCookieEncryptionKey: 'key', debugLevel: 1, currentVer: '1.0',
        encodeCookie: function (value) { cookies.push(value); return 'cookie' + cookies.length; },
        decryptSessionData: function () { return {}; }, encryptSessionData: function () { return 'encrypted'; }, debug: function () { },
        webserver: { wsagents: {}, wssessions: {}, wssessions2: {}, relaySessionCount: 0, wsrelays: {} }
    };
    const renderApplication = createApplicationRenderer({
        state: state, parent: parent, args: { port: 443 },
        render: function () { rendered.push(Array.from(arguments)); },
        getRenderPage: function (mode) { return mode; }, getRenderArgs: function (value) { return value; }, getQueryPortion: function () { return ''; }
    });
    const request = { clientIp: '192.0.2.1', session: { userid: 'user/tenant/alice', x: 'session' }, query: {} };
    const user = { _id: 'user/tenant/alice', name: 'Alice', siteadmin: 0 };
    renderApplication(request, {}, { id: 'tenant', url: '/tenant/' }, user, false, 'requirements');

    assert.deepEqual(loadedKeys, ['wsuser/tenant/alice']);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0][2], 'default');
    assert.equal(rendered[0][3].authCookie, 'cookie1');
    assert.equal(rendered[0][3].authRelayCookie, 'cookie2');
    assert.equal(rendered[0][3].passRequirements, 'requirements');
    assert.equal(rendered[0][4], user);
    assert.deepEqual(cookies[0], { userid: user._id, domainid: 'tenant', ip: '192.0.2.1' });
});

test('application rendering stops when the loaded session belongs to another domain', function () {
    const redirects = [], rendered = [];
    const state = { db: { Get: function (key, callback) { callback(null, []); } } };
    const parent = { debug: function () { } };
    const renderApplication = createApplicationRenderer({ state: state, parent: parent, args: {}, render: function () { rendered.push(true); }, getQueryPortion: function () { return '?x=1'; } });
    const request = { session: { userid: 'user/other/alice' }, query: {} };
    renderApplication(request, { redirect: function (url) { redirects.push(url); } }, { id: 'tenant', url: '/tenant/' }, {}, false, null);
    assert.equal(request.session, null);
    assert.deepEqual(redirects, ['/tenant/?x=1']);
    assert.deepEqual(rendered, []);
});
