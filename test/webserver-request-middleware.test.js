/**
* @description Unit tests for main and agent-port request middleware
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRequestMiddleware = require('../webserver/request-middleware.js').createRequestMiddleware;

function createFixture(withAgentApp) {
    const appMiddleware = [];
    const agentMiddleware = [];
    const calls = [];
    const domain = { id: 'domain' };
    const state = {
        args: { port: 443 },
        certificates: { CommonName: 'server.example.com' },
        app: { use: function (handler) { appMiddleware.push(handler); } },
        agentapp: withAgentApp ? { use: function (handler) { agentMiddleware.push(handler); } } : null,
        webRelayRouter: null
    };
    const service = createRequestMiddleware({
        state: state,
        parent: { args: {}, path: {}, fs: {}, crowdSecBounser: null, debug: function () { } },
        sessions: { prepareSession: function () { calls.push('prepare'); }, refreshSession: function () { calls.push('refresh'); } },
        requestContext: {
            accountTraffic: function () { calls.push('traffic'); },
            resolveClientAddress: function (req) { req.clientIp = '192.0.2.1'; calls.push('address'); return 'forwarded.example.com'; }
        },
        getDomain: function () { calls.push('domain'); return domain; },
        securityHeaders: { build: function () { calls.push('headers'); return { Security: 'yes' }; } }
    });
    return { service: service, state: state, appMiddleware: appMiddleware, agentMiddleware: agentMiddleware, calls: calls, domain: domain };
}

function response() {
    return { set: function (headers) { this.headers = headers; }, redirect: function (url) { this.redirected = url; }, sendStatus: function (status) { this.status = status; }, removeHeader: function (name) { this.removed = name; }, render: function () { }, send: function () { } };
}

test('forwarded HTTP requests redirect to the configured HTTPS endpoint', async function () {
    const fixture = createFixture(false);
    fixture.service.setup();
    const res = response();
    await fixture.appMiddleware[0]({ session: {}, method: 'GET', url: '/path', headers: { host: 'server.example.com:80', 'x-forwarded-proto': 'http' } }, res, function () { });
    assert.equal(res.redirected, 'https://server.example.com:443/path');
    assert.deepEqual(fixture.calls, ['prepare']);
});

test('normal requests receive context, headers and refreshed sessions', async function () {
    const fixture = createFixture(false);
    fixture.service.setup();
    const res = response();
    let nextCalls = 0;
    const req = { session: { userid: 'user/domain/alice' }, method: 'GET', url: '/', hostname: 'server.example.com', headers: { host: 'server.example.com' } };
    await fixture.appMiddleware[0](req, res, function () { nextCalls++; });
    assert.equal(req.xdomain, fixture.domain);
    assert.deepEqual(res.headers, { Security: 'yes' });
    assert.deepEqual(fixture.calls, ['prepare', 'traffic', 'address', 'domain', 'headers', 'refresh']);
    assert.equal(nextCalls, 1);
});

test('web relay requests are diverted before domain security processing', async function () {
    const fixture = createFixture(false);
    fixture.state.args.relaydns = ['relay.example.com'];
    fixture.state.webRelayRouter = function (req, res) { res.relay = true; };
    fixture.service.setup();
    const res = response();
    await fixture.appMiddleware[0]({ session: {}, method: 'GET', url: '/', hostname: 'relay.example.com', headers: { host: 'relay.example.com' } }, res, function () { });
    assert.equal(res.relay, true);
    assert.equal(fixture.calls.includes('domain'), false);
});

test('agent-port middleware resolves context and removes Express identity', function () {
    const fixture = createFixture(true);
    fixture.service.setup();
    const req = { url: '/agent.ashx', headers: {}, connection: {} };
    const res = response();
    let nextCalls = 0;
    fixture.agentMiddleware[0](req, res, function () { nextCalls++; });
    assert.equal(req.xdomain, fixture.domain);
    assert.equal(res.removed, 'X-Powered-By');
    assert.equal(nextCalls, 1);
});
