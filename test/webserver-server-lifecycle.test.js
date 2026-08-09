/**
* @description Unit tests for web listener probing and startup
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createServerLifecycle = require('../webserver/server-lifecycle.js').createServerLifecycle;

function createFixture(overrides) {
    const listens = [];
    const updates = [];
    const args = Object.assign({ port: 443 }, overrides || {});
    const listener = { listen: function (port, addr) { listens.push([port, addr]); return { kind: 'listener' }; } };
    const state = { args: args, net: {}, app: listener, agentapp: listener, tlsServer: null, tlsAltServer: null };
    const parent = {
        config: { settings: { port: 443 } },
        updateServerState: function (key, value) { updates.push([key, value]); },
        debug: function () { },
        addServerWarning: function () { }
    };
    const service = createServerLifecycle({ state: state, parent: parent, args: args, certificates: { CommonName: 'server.example.com' }, os: { platform: function () { return 'win32'; } } });
    return { service: service, state: state, parent: parent, listens: listens, updates: updates };
}

test('port probing reports an available port after closing the probe', function () {
    const fixture = createFixture();
    let closed = false;
    fixture.state.net.createServer = function () {
        return {
            listen: function (port, addr, callback) { callback(); return { on: function () { return this; } }; },
            close: function (callback) { closed = true; callback(); }
        };
    };
    let result;
    fixture.service.CheckListenPort(443, '127.0.0.1', function (port, addr) { result = [port, addr]; });
    assert.equal(closed, true);
    assert.deepEqual(result, [443, '127.0.0.1']);
});

test('HTTP startup records the selected port and alias', function () {
    const fixture = createFixture({ aliasport: 8443 });
    fixture.service.StartWebServer(444, '0.0.0.0');
    assert.equal(fixture.state.args.port, 444);
    assert.deepEqual(fixture.listens, [[444, '0.0.0.0']]);
    assert.deepEqual(fixture.updates, [['http-port', 444], ['http-aliasport', 8443]]);
});

test('TLS startup publishes server identity and HTTPS state', function () {
    const fixture = createFixture();
    fixture.state.tlsServer = { listen: function (port, addr) { fixture.listens.push([port, addr]); return { kind: 'tls' }; } };
    fixture.service.StartWebServer(443, null);
    assert.deepEqual(fixture.updates, [['servername', 'server.example.com'], ['https-port', 443]]);
    assert.equal(fixture.state.tcpServer.kind, 'tls');
});

test('agent-only HTTP startup publishes its own port', function () {
    const fixture = createFixture();
    fixture.service.StartAltWebServer(4443, '127.0.0.1');
    assert.deepEqual(fixture.updates, [['http-agent-port', 4443]]);
    assert.equal(fixture.state.tcpAltServer.kind, 'listener');
});
