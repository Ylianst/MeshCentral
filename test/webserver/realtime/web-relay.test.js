/**
* @description Unit tests for DNS-hosted web relay session routing
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createWebRelay = require('../../../webserver/realtime/web-relay.js').createWebRelay;

function createRouter() {
    const routes = [];
    const router = { routes: routes };
    for (const method of ['get', 'post', 'put', 'delete', 'options', 'head']) router[method] = function () { routes.push([method].concat(Array.from(arguments))); };
    return router;
}

function createFixture(settings) {
    settings = settings || {};
    const router = createRouter();
    const intervals = [];
    const stopped = [];
    const createdSessions = [];
    const domain = { id: 'tenant' };
    const state = {
        args: { relaydns: settings.relaydns === undefined ? ['relay.example.com'] : settings.relaydns, port: 443 },
        users: {},
        db: {},
        destroyedSessions: {},
        GetNodeWithRights: function (requestDomain, userid, nodeid, callback) { callback({ mtype: 2 }, settings.rights === undefined ? 0x00000008 : settings.rights); }
    };
    const parent = {
        config: { domains: { tenant: domain } },
        loginCookieEncryptionKey: 'key',
        debug: function () { },
        decodeCookie: function () { return settings.cookie === undefined ? { ruserid: 'user/tenant/alice', x: 'session' } : settings.cookie; }
    };
    const service = createWebRelay({
        state: state,
        parent: parent,
        createRouter: function () { return router; },
        loadAppRelays: function () {
            return { CreateWebRelaySession: function () {
                const relaySession = { close: function () { this.closed = true; }, checkTimeout: function () { this.checked = true; }, handleRequest: function () { this.requested = true; }, handleWebSocket: function () { this.socket = true; } };
                createdSessions.push([relaySession].concat(Array.from(arguments)));
                return relaySession;
            } };
        },
        setInterval: function (handler, delay) { const token = { handler: handler, delay: delay }; intervals.push(token); return token; },
        clearInterval: function (token) { stopped.push(token); }
    });
    return { service: service, router: router, state: state, domain: domain, intervals: intervals, stopped: stopped, createdSessions: createdSessions };
}

function findRoute(fixture, method, path) { return fixture.router.routes.find(function (route) { return (route[0] === method) && (route[1] === path); }); }
function response() { return { set: function (headers) { this.headers = headers; }, sendStatus: function (status) { this.status = status; }, redirect: function (url) { this.redirected = url; } }; }

test('router setup covers the control URL and all proxied HTTP methods', function () {
    const fixture = createFixture();
    assert.equal(fixture.service.setupRouter(), fixture.router);
    assert.ok(findRoute(fixture, 'get', '/control-redirect.ashx'));
    for (const method of ['get', 'post', 'put', 'delete', 'options', 'head']) assert.ok(findRoute(fixture, method, '/*'));

    const disabled = createFixture({ relaydns: null });
    assert.equal(disabled.service.setupRouter(), null);
});

test('valid control redirects create one relay session and cleanup timer', function () {
    const fixture = createFixture();
    fixture.service.setupRouter();
    const req = { hostname: 'relay.example.com', session: {}, query: { c: 'cookie', n: 'node/tenant/id', p: '443', appid: '2' }, url: '/control-redirect.ashx?c=cookie' };
    const res = response();
    findRoute(fixture, 'get', '/control-redirect.ashx')[2](req, res);
    const sessionId = 'user/tenant/alice/session/relay.example.com';
    assert.ok(fixture.service.sessions[sessionId]);
    assert.equal(fixture.createdSessions.length, 1);
    assert.equal(fixture.intervals.length, 1);
    assert.equal(fixture.intervals[0].delay, 10000);
    assert.equal(res.redirected, '/');
    fixture.service.sessions[sessionId].onclose(sessionId);
    assert.equal(fixture.stopped.length, 1);
});

test('HTTP and WebSocket traffic is dispatched only to live matching sessions', function () {
    const fixture = createFixture();
    const relaySession = { handleRequest: function () { this.requested = true; }, handleWebSocket: function () { this.socket = true; } };
    fixture.service.sessions['user/tenant/alice/session/relay.example.com'] = relaySession;
    const req = { hostname: 'relay.example.com', session: { userid: 'user/tenant/alice', x: 'session' } };
    fixture.service.handleRequest(req, response());
    fixture.service.handleWebSocket({ close: function () { this.closed = true; } }, req);
    assert.equal(relaySession.requested, true);
    assert.equal(relaySession.socket, true);

    fixture.state.destroyedSessions['user/tenant/alice/session'] = true;
    const rejected = response();
    const ws = { close: function () { this.closed = true; } };
    fixture.service.handleRequest(req, rejected);
    fixture.service.handleWebSocket(ws, req);
    assert.equal(rejected.status, 404);
    assert.equal(ws.closed, true);
});

test('removed public shares close their matching relay sessions', function () {
    const fixture = createFixture();
    fixture.service.sessions.one = { xpublicid: 'public-one', close: function () { this.closed = true; } };
    fixture.service.sessions.two = { xpublicid: 'public-two', close: function () { this.closed = true; } };
    fixture.service.handleEvent(null, { action: 'removedDeviceShare', publicid: 'public-one' });
    assert.equal(fixture.service.sessions.one.closed, true);
    assert.equal(fixture.service.sessions.two.closed, undefined);
});
