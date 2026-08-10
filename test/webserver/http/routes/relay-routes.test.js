/**
* @description Unit tests for authenticated domain relay WebSocket routes
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRelayRoutes = require('../../../../webserver/http/routes/relay-routes.js').createRelayRoutes;

function createFixture(settings) {
    settings = settings || {};
    const routes = [];
    const calls = [];
    const app = { ws: function () { routes.push(Array.from(arguments)); } };
    const requestDomain = settings.requestDomain || { id: 'tenant' };
    const state = {
        app: app,
        args: { wanonly: settings.wanonly },
        db: {},
        CheckWebServerOriginName: function () { return settings.validOrigin !== false; },
        meshIderHandler: { CreateAmtIderSession: function () { calls.push(['ider'].concat(Array.from(arguments))); } },
        meshUserHandler: { CreateMeshUser: function () { calls.push(['user'].concat(Array.from(arguments))); } },
        meshDeviceFileHandler: { CreateMeshDeviceFile: function () { calls.push(['devicefile'].concat(Array.from(arguments))); } },
        meshDesktopMultiplexHandler: { CreateMeshRelay: function () { calls.push(['multiplex'].concat(Array.from(arguments))); } },
        meshRelayHandler: {
            CreateMeshRelay: function () { calls.push(['relay'].concat(Array.from(arguments))); },
            CreateLocalRelay: function () { calls.push(['local'].concat(Array.from(arguments))); }
        }
    };
    const service = createRelayRoutes({
        state: state,
        parent: { config: { settings: { desktopmultiplex: settings.desktopMultiplex === true } } },
        getDomain: function () { return requestDomain; },
        getWebSocketArgs: function (ws, req, callback) { callback(ws, req); },
        authorizeWebSocket: function (ws, req, required, callback) {
            callback(ws, req, requestDomain, settings.user === undefined ? { name: 'user' } : settings.user, settings.cookie === undefined ? { token: true } : settings.cookie, { auth: true });
        },
        authorizeInnerWebSocket: function (ws, req, domain, callback) { calls.push(['inner-auth']); callback(ws, req, domain, { name: 'inner' }); },
        relayWebSocket: function () { }
    });
    return { service: service, routes: routes, calls: calls, requestDomain: requestDomain };
}

function findRoute(fixture, path) { return fixture.routes.find(function (route) { return route[0] === path; }); }
function socket() {
    return {
        messages: [],
        closed: false,
        send: function (message) { this.messages.push(JSON.parse(message)); },
        close: function () { this.closed = true; }
    };
}

test('registers all relay endpoints and omits local relay in WAN-only mode', function () {
    const normal = createFixture();
    normal.service.register({ url: '/tenant/' });
    for (const name of ['webrelay.ashx', 'webider.ashx', 'control.ashx', 'devicefile.ashx', 'meshrelay.ashx', 'localrelay.ashx']) assert.ok(findRoute(normal, '/tenant/' + name));

    const wan = createFixture({ wanonly: true });
    wan.service.register({ url: '/' });
    assert.equal(findRoute(wan, '/localrelay.ashx'), undefined);
});

test('control socket rejects invalid origins with the existing close payload', function () {
    const fixture = createFixture({ validOrigin: false });
    fixture.service.register({ url: '/' });
    const ws = socket();
    findRoute(fixture, '/control.ashx')[1](ws, { query: {}, headers: {} });
    assert.deepEqual(ws.messages, [{ action: 'close', cause: 'invalidorigin', msg: 'invalidorigin' }]);
    assert.equal(ws.closed, true);
});

test('control socket supports inner authentication when requested', function () {
    const fixture = createFixture({ user: null });
    fixture.service.register({ url: '/' });
    findRoute(fixture, '/control.ashx')[1](socket(), { query: {}, headers: { 'x-meshauth': '*' } });
    assert.equal(fixture.calls[0][0], 'inner-auth');
    assert.equal(fixture.calls[1][0], 'user');
    assert.equal(fixture.calls[1][7].name, 'inner');
});

test('desktop protocol two uses the multiplex relay when enabled', function () {
    const fixture = createFixture({ desktopMultiplex: true });
    fixture.service.register({ url: '/' });
    findRoute(fixture, '/meshrelay.ashx')[1](socket(), { query: { p: 2 }, headers: {} });
    assert.equal(fixture.calls[0][0], 'multiplex');
});

test('device file sockets retain the domain used for their registration', function () {
    const fixture = createFixture();
    const first = { id: 'first', url: '/first/' };
    const second = { id: 'second', url: '/second/' };
    fixture.service.register(first);
    fixture.service.register(second);
    findRoute(fixture, '/first/devicefile.ashx')[1](socket(), {});
    assert.equal(fixture.calls[0][5], first);
});
