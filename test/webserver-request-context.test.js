/**
* @description Unit tests for client address resolution and traffic accounting
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRequestContext = require('../webserver/request-context.js').createRequestContext;

function createFixture(args) {
    const state = { args: args || {}, trafficStats: { httpWebSocketCount: 0, httpRequestCount: 0, httpIn: 0, httpOut: 0 } };
    const service = createRequestContext({ state: state, isIPMatch: function (ip, ranges) { return ranges.indexOf(ip) >= 0; } });
    return { state: state, service: service };
}

test('trusted proxies prefer Cloudflare client addresses and forwarded hosts', function () {
    const fixture = createFixture({ trustedproxy: true });
    const req = { connection: { remoteAddress: '::ffff:10.0.0.1' }, headers: { host: 'internal', 'cf-connecting-ip': '198.51.100.2:1234, other', 'x-forwarded-for': '203.0.113.2', 'x-forwarded-host': 'public.example.com, other' } };
    const forwardedHost = fixture.service.resolveClientAddress(req, true, true);
    assert.equal(req.clientIp, '198.51.100.2');
    assert.equal(forwardedHost, 'public.example.com');
});

test('untrusted requests use the direct remote address', function () {
    const fixture = createFixture({});
    const req = { connection: { remoteAddress: '::ffff:192.0.2.1' }, headers: { host: 'server', 'x-forwarded-for': '203.0.113.1' } };
    assert.equal(fixture.service.resolveClientAddress(req, true, true), 'server');
    assert.equal(req.clientIp, '192.0.2.1');
});

test('WebSocket requests increment only their connection counter', function () {
    const fixture = createFixture({});
    fixture.service.accountTraffic({ headers: { upgrade: 'websocket' } });
    assert.deepEqual(fixture.state.trafficStats, { httpWebSocketCount: 1, httpRequestCount: 0, httpIn: 0, httpOut: 0 });
});

test('HTTP socket traffic is accumulated during updates and close', function () {
    const fixture = createFixture({});
    let closeHandler;
    const socket = { bytesRead: 10, bytesWritten: 20, on: function (event, handler) { closeHandler = handler; } };
    fixture.service.accountTraffic({ headers: {}, socket: socket });
    assert.equal(fixture.state.trafficStats.httpRequestCount, 1);
    socket.bytesRead = 15;
    socket.bytesWritten = 28;
    fixture.service.accountTraffic({ headers: {}, socket: socket });
    assert.equal(fixture.state.trafficStats.httpIn, 15);
    assert.equal(fixture.state.trafficStats.httpOut, 28);
    socket.bytesRead = 17;
    socket.bytesWritten = 31;
    closeHandler.call(socket);
    assert.equal(fixture.state.trafficStats.httpIn, 17);
    assert.equal(fixture.state.trafficStats.httpOut, 31);
});
