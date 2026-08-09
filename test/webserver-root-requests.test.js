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

test('successful SSPI authentication resumes the root request', function () {
    const resumed = [];
    const service = createRootRequests({
        debug: function () { },
        authLog: function () { },
        getLoginCookieEncryptionKey: function () { return null; },
        handleRootRequestEx: function (req, res, domain, direct) { resumed.push([domain, direct]); }
    });
    const domain = { sspi: { authenticate: function (req, res, callback) { req.connection.user = 'DOMAIN\\alice'; callback(null); } } };
    const req = { query: {}, connection: { remotePort: 443 }, headers: {}, clientIp: '192.0.2.1' };
    assert.equal(service.handleSspi(req, {}, domain, true), true);
    assert.deepEqual(resumed, [[domain, true]]);
});

test('failed SSPI authentication returns unauthorized', function () {
    const statuses = [];
    const service = createRootRequests({ debug: function () { }, authLog: function () { }, getLoginCookieEncryptionKey: function () { return null; } });
    const domain = { sspi: { authenticate: function (req, res, callback) { callback(new Error('denied')); } } };
    const req = { query: {}, connection: { user: null, remotePort: 443 }, headers: {}, clientIp: '192.0.2.1' };
    assert.equal(service.handleSspi(req, { sendStatus: function (status) { statuses.push(status); } }, domain, false), true);
    assert.deepEqual(statuses, [401]);
});

test('URL credentials establish an IP-bound session when 2FA is not required', function () {
    const resumed = [], randomRequests = [], logs = [];
    const userid = 'user/tenant/alice';
    const service = createRootRequests({
        users: { [userid]: { _id: userid } },
        debug: function () { },
        authLog: function () { logs.push(Array.from(arguments)); },
        authenticate: function (username, password, domain, callback) { callback(null, userid, null, {}); },
        checkUserOneTimePasswordRequired: function () { return false; },
        setSessionRandom: function (req) { req.session.x = 'random'; randomRequests.push(req); },
        handleRootRequestEx: function () { resumed.push(true); }
    });
    const req = { query: { user: 'alice', pass: 'secret' }, session: { currentNode: 'node' }, clientIp: '192.0.2.1', connection: { remotePort: 443 }, headers: {} };
    assert.equal(service.handleUrlCredentials(req, {}, {}, false), true);
    assert.equal(req.session.userid, userid);
    assert.equal(req.session.currentNode, undefined);
    assert.equal(req.session.ip, '192.0.2.1');
    assert.equal(randomRequests.length, 1);
    assert.equal(resumed.length, 1);
    assert.equal(logs.length, 1);
});

test('URL credentials do not establish a session when 2FA is required', function () {
    const userid = 'user/tenant/alice';
    const service = createRootRequests({
        users: { [userid]: { _id: userid } },
        authenticate: function (username, password, domain, callback) { callback(null, userid, null, {}); },
        checkUserOneTimePasswordRequired: function () { return true; },
        handleRootRequestEx: function () { }
    });
    const req = { query: { user: 'alice', pass: 'secret' }, session: {} };
    assert.equal(service.handleUrlCredentials(req, {}, {}, false), true);
    assert.equal(req.session.userid, undefined);
});

test('valid login token sessions continue unchanged', function () {
    const resumed = [];
    const service = createRootRequests({
        database: { Get: function (id, callback) { callback(null, [{ tokenUser: 'token' }]); } },
        handleRootRequestEx: function () { resumed.push(true); }
    });
    const req = { session: { userid: 'user/tenant/alice', loginToken: 'token' } };
    assert.equal(service.handleLoginToken(req, {}, {}, false), true);
    assert.equal(req.session.userid, 'user/tenant/alice');
    assert.equal(resumed.length, 1);
});

test('removed login tokens clear the session before continuing', function () {
    const service = createRootRequests({
        database: { Get: function (id, callback) { callback(null, []); } },
        handleRootRequestEx: function () { }
    });
    const req = { session: { userid: 'user/tenant/alice', loginToken: 'removed', other: true } };
    assert.equal(service.handleLoginToken(req, {}, {}, false), true);
    assert.deepEqual(req.session, {});
});

test('plain root requests reach the extended root handler', function () {
    const resumed = [];
    const domain = { id: 'tenant' };
    const service = createRootRequests({
        state: { args: {} },
        debug: function () { },
        checkUserIpAddress: function () { return domain; },
        getMaintenanceMode: function () { return null; },
        getLoginCookieEncryptionKey: function () { return null; },
        getQueryPortion: function () { return ''; },
        handleRootRequestEx: function (req, res, requestDomain, direct) { resumed.push([requestDomain, direct]); }
    });
    service.handleRootRequest({ query: {}, headers: {}, url: '/tenant/', session: {} }, {}, true);
    assert.deepEqual(resumed, [[domain, true]]);
});

test('push authentication rejects cookies for deleted users', function () {
    const service = createRootRequests({ users: {} });
    assert.equal(service.findPushAuthUser({ u: 'user/tenant/deleted', d: 'tenant', a: 'pushAuth' }, { id: 'tenant' }), null);
});

test('push authentication returns an existing same-domain user', function () {
    const user = { _id: 'user/tenant/alice' };
    const service = createRootRequests({ users: { [user._id]: user } });
    assert.equal(service.findPushAuthUser({ u: user._id, d: 'tenant', a: 'pushAuth' }, { id: 'tenant' }), user);
    assert.equal(service.findPushAuthUser({ u: user._id, d: 'other', a: 'pushAuth' }, { id: 'tenant' }), null);
});

test('push login establishes a session, remembered device and login event', function () {
    const events = [], cookies = [], resumed = [];
    const user = { _id: 'user/tenant/alice', name: 'Alice', groups: ['staff'] };
    const state = {
        args: {},
        getUserAgentInfo: function () { return { browserStr: 'Browser', osStr: 'OS' }; },
        CloneSafeUser: function (value) { return { _id: value._id }; }
    };
    const service = createRootRequests({
        state: state,
        users: { [user._id]: user },
        decodeCookie: function () { return { u: user._id, d: 'tenant', a: 'pushAuth' }; },
        encodeCookie: function (value) { return 'encoded-' + value.userid; },
        getLoginCookieEncryptionKey: function () { return 'key'; },
        getSessionSameSite: function () { return 'strict'; },
        dispatchEvent: function (targets, source, event) { events.push([targets, event]); },
        handleRootRequestEx: function () { resumed.push(true); }
    });
    const req = { body: { hwstate: 'state', remembertoken: 'on' }, clientIp: '192.0.2.1', headers: { 'user-agent': 'test' } };
    const res = { cookie: function () { cookies.push(Array.from(arguments)); } };
    assert.equal(service.handlePushLogin(req, res, { id: 'tenant' }), true);
    assert.equal(req.session.userid, user._id);
    assert.deepEqual(events[0][0], ['*', 'server-users', user._id, 'server-users:staff']);
    assert.equal(events[0][1].twoFactorType, 'pushlogin');
    assert.equal(cookies[0][0], 'twofactor');
    assert.equal(cookies[0][2].sameSite, 'strict');
    assert.equal(resumed.length, 1);
});

test('root POST requests dispatch account actions with direct rendering', function () {
    const calls = [];
    const handlers = {};
    for (const name of ['login', 'changePassword', 'deleteAccount', 'createAccount', 'resetPassword', 'resetAccount', 'checkEmail']) {
        handlers[name] = function (req, res, direct) { calls.push([name, direct]); };
    }
    const service = createRootRequests({
        checkUserIpAddress: function () { return {}; },
        debug: function () { },
        postHandlers: handlers
    });
    service.handleRootPostRequest({ query: {}, headers: {}, body: { action: 'deleteaccount' } }, {});
    assert.deepEqual(calls, [['deleteAccount', true]]);
});

test('token login restores encrypted hardware state before login', function () {
    const calls = [];
    const service = createRootRequests({
        checkUserIpAddress: function () { return {}; },
        debug: function () { },
        decodeCookie: function () { return { u: 'alice', p: 'secret', c: 'challenge' }; },
        getLoginCookieEncryptionKey: function () { return 'key'; },
        encryptSessionData: function (value) { calls.push(value); return 'encrypted'; },
        postHandlers: { login: function () { calls.push('login'); } }
    });
    const req = { query: {}, headers: {}, session: {}, body: { action: 'tokenlogin', hwstate: 'state' } };
    service.handleRootPostRequest(req, {});
    assert.equal(req.session.e, 'encrypted');
    assert.deepEqual(calls, [{ tuser: 'alice', tpass: 'secret', u2f: 'challenge' }, 'login']);
});
