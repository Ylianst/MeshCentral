/**
* @description Unit tests for agent, MQTT and alternate-port routes
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAgentRoutes = require('../../../../webserver/http/routes/agent-routes.js').createAgentRoutes;

function createRouter() {
    const routes = [];
    return {
        routes: routes,
        ws: function () { routes.push(['ws'].concat(Array.from(arguments))); },
        get: function () { routes.push(['get'].concat(Array.from(arguments))); }
    };
}

function createFixture(settings) {
    settings = settings || {};
    const calls = [];
    const app = createRouter();
    const agentapp = settings.agentPort === false ? null : createRouter();
    const requestDomain = settings.requestDomain || { id: 'tenant' };
    const serialTunnel = { updateBuffer: function (data) { calls.push(['mqtt-data', data]); }, emit: function (name) { calls.push(['mqtt-event', name]); } };
    const state = {
        app: app,
        agentapp: agentapp,
        args: {},
        db: {},
        meshAgentHandler: { CreateMeshAgent: function () { calls.push(['agent'].concat(Array.from(arguments))); } },
        meshDesktopMultiplexHandler: { CreateMeshRelay: function () { calls.push(['multiplex'].concat(Array.from(arguments))); } },
        meshRelayHandler: { CreateMeshRelay: function () { calls.push(['relay'].concat(Array.from(arguments))); } },
        meshDeviceFileHandler: { CreateMeshDeviceFile: function () { calls.push(['devicefile'].concat(Array.from(arguments))); } }
    };
    const parent = {
        config: { settings: { desktopmultiplex: settings.desktopMultiplex === true } },
        mqttbroker: settings.mqtt ? { handle: function (tunnel) { calls.push(['mqtt', tunnel]); } } : null,
        mpsserver: settings.mps ? { onWebSocketConnection: function () { calls.push(['apf']); } } : null,
        debug: function () { }
    };
    const handlers = { agentFileTransfer: function () { }, meshAgentRequest: function () { }, agentDownloadFile: function () { } };
    const service = createAgentRoutes({
        state: state,
        parent: parent,
        checkAgentIpAddress: function () { return settings.blocked ? null : requestDomain; },
        authorizeWebSocket: function (ws, req, required, callback) { callback(ws, req, requestDomain, {}, {}); },
        createSerialTunnel: function () { return serialTunnel; },
        handlers: handlers
    });
    return { service: service, app: app, agentapp: agentapp, calls: calls, handlers: handlers, serialTunnel: serialTunnel, requestDomain: requestDomain };
}

function findRoute(router, method, path) { return router.routes.find(function (route) { return (route[0] === method) && (route[1] === path); }); }

test('registers public and alternate agent endpoints', function () {
    const fixture = createFixture({ mps: true });
    fixture.service.register({ id: 'tenant', url: '/tenant/' });
    assert.ok(findRoute(fixture.app, 'ws', '/tenant/agent.ashx'));
    assert.equal(findRoute(fixture.app, 'ws', '/tenant/mqtt.ashx'), undefined);
    assert.ok(findRoute(fixture.agentapp, 'ws', '/tenant/meshrelay.ashx'));
    assert.ok(findRoute(fixture.agentapp, 'ws', '/tenant/devicefile.ashx'));
    assert.equal(findRoute(fixture.agentapp, 'get', '/tenant/meshagents')[2], fixture.handlers.meshAgentRequest);
    assert.ok(findRoute(fixture.agentapp, 'ws', '/tenant/apf.ashx'));
});

test('agent keys are checked before creating an agent', function () {
    const fixture = createFixture();
    fixture.requestDomain.agentkey = ['accepted'];
    fixture.service.register({ id: 'tenant', url: '/' });
    const handler = findRoute(fixture.app, 'ws', '/agent.ashx')[2];
    handler({}, { query: { key: 'wrong' }, clientIp: '192.0.2.1' });
    assert.equal(fixture.calls.length, 0);
    handler({}, { query: { key: 'accepted' }, clientIp: '192.0.2.1' });
    assert.equal(fixture.calls[0][0], 'agent');
});

test('MQTT websocket traffic is bridged through a serial tunnel', function () {
    const fixture = createFixture({ mqtt: true, agentPort: false });
    fixture.service.register({ id: 'tenant', url: '/' });
    const events = {};
    const sent = [];
    const ws = { on: function (name, handler) { events[name] = handler; }, send: function (data, encoding) { sent.push([data, encoding]); } };
    findRoute(fixture.app, 'ws', '/mqtt.ashx')[2](ws, { query: {}, clientIp: '192.0.2.1' });
    assert.equal(fixture.calls[0][0], 'mqtt');
    events.message(Buffer.from('data'));
    fixture.serialTunnel.forwardwrite('reply');
    events.close();
    assert.equal(fixture.calls[1][0], 'mqtt-data');
    assert.deepEqual(sent, [['reply', 'binary']]);
    assert.deepEqual(fixture.calls[2], ['mqtt-event', 'end']);
});

test('alternate device-file routes retain their registered domain', function () {
    const fixture = createFixture();
    const first = { id: 'first', url: '/first/' };
    fixture.service.register(first);
    fixture.service.register({ id: 'second', url: '/second/' });
    findRoute(fixture.agentapp, 'ws', '/first/devicefile.ashx')[2]({}, {});
    assert.equal(fixture.calls[0][5], first);
});
