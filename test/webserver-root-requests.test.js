/**
* @description Unit tests for root page request handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRootRequests = require('../webserver/root-requests.js').createRootRequests;

test('configured root redirects retain the request query portion', function () {
    const redirects = [];
    const service = createRootRequests({
        checkUserIpAddress: function () { return { rootredirect: 'https://portal.example/' }; },
        getQueryPortion: function () { return '?key=value'; },
        isTrustedCert: function () { return true; }
    });
    service.handleRootRedirect({}, { redirect: function (url) { redirects.push(url); } });
    assert.deepEqual(redirects, ['https://portal.example/?key=value']);
});

test('root redirects stop when the request domain is rejected', function () {
    let redirected = false;
    const service = createRootRequests({ checkUserIpAddress: function () { return null; }, getQueryPortion: function () { return ''; }, isTrustedCert: function () { return true; } });
    service.handleRootRedirect({}, { redirect: function () { redirected = true; } });
    assert.equal(redirected, false);
});

test('root certificate links use path domains and skip DNS domains', function () {
    const service = createRootRequests({ checkUserIpAddress: function () { }, getQueryPortion: function () { return ''; }, isTrustedCert: function () { return false; } });
    assert.match(service.getRootCertLink({ id: 'tenant' }), /href=\/tenant\/MeshServerRootCert\.cer/);
    assert.match(service.getRootCertLink({ id: 'tenant', dns: 'tenant.example.com' }), /href=\/MeshServerRootCert\.cer/);
});

test('trusted certificates do not show a root certificate link', function () {
    const service = createRootRequests({ checkUserIpAddress: function () { }, getQueryPortion: function () { return ''; }, isTrustedCert: function () { return true; } });
    assert.equal(service.getRootCertLink({ id: 'tenant' }), '');
});

test('root request checks reject invalid login keys and required headers', function () {
    const statuses = [];
    const service = createRootRequests({ state: { args: {} }, debug: function () { }, now: function () { return 100; } });
    const res = { sendStatus: function (status) { statuses.push(status); } };
    assert.equal(service.checkRootRequest({ query: { key: 'wrong' }, headers: {} }, res, { loginkey: ['expected'] }), false);
    assert.equal(service.checkRootRequest({ query: {}, headers: { authorization: 'wrong' } }, res, { userrequiredhttpheader: { authorization: 'expected' } }), false);
    assert.deepEqual(statuses, [404, 404]);
});

test('expired root sessions are cleared before rendering', function () {
    const service = createRootRequests({ state: { args: {} }, debug: function () { }, now: function () { return 100; } });
    const req = { query: {}, headers: {}, session: { userid: 'user/tenant/alice', expire: 99, other: true } };
    assert.equal(service.checkRootRequest(req, { sendStatus: function () { } }, {}), true);
    assert.deepEqual(req.session, {});
});

test('anonymous root requests use the configured external redirect', function () {
    const redirects = [];
    const service = createRootRequests({ getQueryPortion: function () { return '?viewmode=2'; } });
    const redirected = service.redirectUnknownUser({ url: '/tenant/', session: {} }, { redirect: function (url) { redirects.push(url); } }, { unknownuserrootredirect: 'https://portal.example/' });
    assert.equal(redirected, true);
    assert.deepEqual(redirects, ['https://portal.example/?viewmode=2']);
});

test('login pages and authenticated sessions skip anonymous redirects', function () {
    const service = createRootRequests({ getQueryPortion: function () { return ''; } });
    const res = { redirect: function () { throw new Error('Unexpected redirect'); } };
    assert.equal(service.redirectUnknownUser({ url: '/tenant/login', session: {} }, res, { unknownuserrootredirect: 'https://portal.example/' }), false);
    assert.equal(service.redirectUnknownUser({ url: '/tenant/', session: { userid: 'user/tenant/alice' } }, res, { unknownuserrootredirect: 'https://portal.example/' }), false);
});

test('maintenance mode renders the domain message page', function () {
    const renders = [];
    const service = createRootRequests({
        debug: function () { },
        getMaintenanceMode: function () { return 1; },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; },
        render: function (req, res, page, args) { renders.push([page, args]); }
    });
    assert.equal(service.handleMaintenance({ query: {} }, {}, { sitestyle: 2, url: "/tenant's/" }), true);
    assert.equal(renders[0][0], 'message2');
    assert.equal(renders[0][1].msgid, 13);
    assert.match(renders[0][1].domainurl, /%27/);
});

test('the explicit login screen bypasses maintenance rendering', function () {
    const service = createRootRequests({ getMaintenanceMode: function () { return 1; } });
    assert.equal(service.handleMaintenance({ query: { loginscreen: '1' } }, {}, {}), false);
});
