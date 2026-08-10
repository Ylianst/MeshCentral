/**
* @description Unit tests for core Express and WebSocket middleware setup
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createCoreMiddleware = require('../../../../webserver/http/middleware/core-middleware.js').createCoreMiddleware;

function createFixture(args) {
    const engines = [];
    const settings = [];
    const uses = [];
    const websockets = [];
    const cookieOptions = [];
    const relayCalls = [];
    const app = {
        engine: function (name, engine) { engines.push([name, engine]); },
        set: function (name, value) { settings.push([name, value]); },
        use: function (middleware) { uses.push(middleware); },
        ws: function (route, handler) { websockets.push([route, handler]); }
    };
    const state = { args: Object.assign({ sessionkey: 'secret' }, args || {}), app: app, exphbs: { engine: function () { return 'view-engine'; } }, webRelayRouter: null };
    const service = createCoreMiddleware({
        state: state,
        parent: { debug: function () { } },
        keygrip: function (keys, algorithm, encoding) { return { keys: keys, algorithm: algorithm, encoding: encoding }; },
        cookieSession: function (options) { cookieOptions.push(options); return { cookie: true }; },
        dnsLookup: function () { },
        handleWebRelayWebSocket: function (ws, req) { relayCalls.push([ws, req]); }
    });
    return { service: service, state: state, engines: engines, settings: settings, uses: uses, websockets: websockets, cookieOptions: cookieOptions, relayCalls: relayCalls };
}

test('core middleware configures views, proxy trust and secure sessions', function () {
    const fixture = createFixture({ trustedproxy: ['127.0.0.1'], sessiontime: 5, sessionsamesite: 'strict' });
    fixture.service.setupCoreMiddleware();
    assert.deepEqual(fixture.engines, [['handlebars', 'view-engine']]);
    assert.ok(fixture.settings.some(function (entry) { return entry[0] == 'trust proxy'; }));
    assert.equal(fixture.cookieOptions[0].name, 'xid');
    assert.equal(fixture.cookieOptions[0].secure, true);
    assert.equal(fixture.cookieOptions[0].sameSite, 'strict');
    assert.equal(fixture.cookieOptions[0].maxAge, 300000);
});

test('session compatibility middleware adds regenerate and save callbacks', function () {
    const fixture = createFixture();
    fixture.service.setupCoreMiddleware();
    const request = { session: {}, hostname: 'server.example.com' };
    let nextCalled = false;
    fixture.uses[1](request, {}, function () { nextCalled = true; });
    assert.equal(typeof request.session.regenerate, 'function');
    assert.equal(typeof request.session.save, 'function');
    assert.equal(nextCalled, true);
});

test('Client Hint headers are advertised outside relay hostnames', function () {
    const fixture = createFixture({ relaydns: ['relay.example.com'] });
    fixture.state.webRelayRouter = {};
    fixture.service.setupCoreMiddleware();
    const headers = {};
    fixture.uses[1]({ session: {}, hostname: 'server.example.com' }, { setHeader: function (name, value) { headers[name] = value; } }, function () { });
    assert.ok(headers['Accept-CH'].includes('Sec-CH-UA-Platform'));
    assert.equal(headers['Accept-CH'], headers['Critical-CH']);
});

test('global WebSocket middleware diverts relay hosts and passes other hosts', function () {
    const fixture = createFixture({ relaydns: ['relay.example.com'] });
    fixture.state.webRelayRouter = {};
    fixture.service.setupCoreMiddleware();
    const ws = { on: function () { } };
    let nextCalls = 0;
    fixture.websockets[0][1](ws, { hostname: 'relay.example.com' }, function () { nextCalls++; });
    fixture.websockets[0][1](ws, { hostname: 'server.example.com' }, function () { nextCalls++; });
    assert.equal(fixture.relayCalls.length, 1);
    assert.equal(nextCalls, 1);
});
