/**
* @description Unit tests for optional application route registration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createApplicationRoutes = require('../webserver/application-routes.js').createApplicationRoutes;

function createFixture(settings) {
    settings = settings || {};
    const routes = [];
    const relayCalls = [];
    const app = {};
    for (const method of ['get', 'post', 'ws']) app[method] = function () { routes.push([method].concat(Array.from(arguments))); };
    const domain = { id: 'tenant', url: '/tenant/' };
    const state = { app: app, args: settings.args || {}, users: settings.users || {}, db: {} };
    const parent = {
        config: settings.firebaseConfig ? { firebase: settings.firebaseConfig } : {},
        firebase: settings.firebaseConfig ? {} : null,
        debug: function () { },
        ipKvmManager: {
            handleIpKvmWebSocket: function () { relayCalls.push(['ipkvm-ws'].concat(Array.from(arguments))); },
            handleIpKvmGet: function () { relayCalls.push(['ipkvm-get'].concat(Array.from(arguments))); }
        }
    };
    const appRelays = {
        CreateMstscRelay: function () { relayCalls.push(['mstsc'].concat(Array.from(arguments))); },
        CreateSshRelay: function () { relayCalls.push(['ssh'].concat(Array.from(arguments))); },
        CreateSshTerminalRelay: function () { relayCalls.push(['ssh-terminal'].concat(Array.from(arguments))); },
        CreateSshFilesRelay: function () { relayCalls.push(['ssh-files'].concat(Array.from(arguments))); }
    };
    const handlers = { mstscRequest: function () { }, firebasePushOnlyRelayRequest: function () { }, firebaseRelayRequest: function () { } };
    const service = createApplicationRoutes({
        state: state,
        parent: parent,
        handlers: handlers,
        getDomain: function () { return settings.requestDomain === null ? null : domain; },
        authorizeWebSocket: function (ws, req, required, callback) { callback(ws, req, domain, { name: 'user' }, { token: 'cookie' }); },
        urlencoded: function () { return 'urlencoded'; },
        loadAppRelays: function () { return appRelays; }
    });
    return { service: service, routes: routes, relayCalls: relayCalls, domain: domain, handlers: handlers };
}

function findRoute(fixture, method, path) {
    return fixture.routes.find(function (route) { return (route[0] === method) && (route[1] === path); });
}

test('RDP routes are enabled by default and can be disabled per domain', function () {
    const enabled = createFixture();
    enabled.service.register(enabled.domain);
    assert.ok(findRoute(enabled, 'get', '/tenant/mstsc.html'));
    assert.ok(findRoute(enabled, 'ws', '/tenant/mstscrelay.ashx'));

    const disabled = createFixture();
    disabled.service.register({ id: 'tenant', url: '/tenant/', mstsc: false });
    assert.equal(findRoute(disabled, 'get', '/tenant/mstsc.html'), undefined);
});

test('RDP relay assigns a configured default user before creating the relay', function () {
    const fixture = createFixture({ args: { user: 'Alice' }, users: { 'user/tenant/alice': {} } });
    fixture.service.register(fixture.domain);
    const req = { session: {} };
    findRoute(fixture, 'ws', '/tenant/mstscrelay.ashx')[2]({}, req);
    assert.equal(req.session.userid, 'user/tenant/alice');
    assert.equal(fixture.relayCalls[0][0], 'mstsc');
    assert.equal(fixture.relayCalls[0][6], fixture.domain);
});

test('IP-KVM and SSH routes follow domain feature flags', function () {
    const fixture = createFixture();
    fixture.service.register({ id: 'tenant', url: '/tenant/', ipkvm: true, ssh: true, mstsc: false });
    assert.ok(findRoute(fixture, 'ws', '/tenant/ipkvm.ashx/*'));
    assert.ok(findRoute(fixture, 'get', '/tenant/ipkvm.ashx/*'));
    assert.ok(findRoute(fixture, 'get', '/tenant/ssh.html'));
    assert.ok(findRoute(fixture, 'ws', '/tenant/sshterminalrelay.ashx'));
    assert.ok(findRoute(fixture, 'ws', '/tenant/sshfilesrelay.ashx'));
});

test('Firebase HTTP and WebSocket relays retain their configured middleware', function () {
    const fixture = createFixture({ firebaseConfig: { pushrelayserver: true, relayserver: true } });
    fixture.service.register(fixture.domain);
    assert.deepEqual(findRoute(fixture, 'post', '/tenant/firebaserelay.aspx').slice(2), ['urlencoded', fixture.handlers.firebasePushOnlyRelayRequest]);
    assert.equal(findRoute(fixture, 'ws', '/tenant/firebaserelay.aspx')[2], fixture.handlers.firebaseRelayRequest);
});
