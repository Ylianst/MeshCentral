/**
* @description Unit tests for HTTP route finalization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const finalizeHttpRoutes = require('../webserver/http-route-finalization.js').finalizeHttpRoutes;

test('HTTP route finalization installs integrations, domain routes and cleanup', function () {
    const calls = [], state = { args: {}, app: { ws: function (path, handler) { calls.push(['ws', path]); handler('socket', 'request'); } } };
    const parent = {
        config: { domains: { tenant: { id: 'tenant' } } },
        pluginHandler: { callHook: function (name, source, owner) { calls.push(['hook', name, source === state, owner === parent]); } },
        multiServer: { CreatePeerInServer: function (service, websocket, request, tls) { calls.push(['peer', service === parent.multiServer, websocket, request, tls]); } }
    };
    const domainStatic = { register: function () { calls.push('static'); }, startDisconnectionCleanup: function () { calls.push('cleanup'); } };
    finalizeHttpRoutes({
        state: state, parent: parent, webRelay: { setupRouter: function () { calls.push('relay'); return 'router'; } },
        routeGroups: [{ register: function (domain) { calls.push('routes:' + domain.id); } }, domainStatic], domainStatic: domainStatic
    });
    assert.equal(state.webRelayRouter, 'router');
    assert.deepEqual(calls, [
        ['hook', 'hook_setupHttpHandlers', true, true], ['ws', '/meshserver.ashx'], ['peer', true, 'socket', 'request', true], 'relay', 'routes:tenant', 'static', 'cleanup'
    ]);
});

test('TLS offload state is forwarded to peer server connections', function () {
    var tls;
    const state = { args: { tlsoffload: true }, app: { ws: function (path, handler) { handler({}, {}); } } };
    const parent = { config: { domains: {} }, multiServer: { CreatePeerInServer: function (service, websocket, request, value) { tls = value; } } };
    const domainStatic = { startDisconnectionCleanup: function () { } };
    finalizeHttpRoutes({ state: state, parent: parent, webRelay: { setupRouter: function () { return {}; } }, routeGroups: [], domainStatic: domainStatic });
    assert.equal(tls, false);
});
