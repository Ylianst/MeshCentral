/**
* @description Unit tests for basic per-domain HTTP and WebSocket route registration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createBasicRoutes = require('../../../../webserver/http/routes/basic-routes.js').createBasicRoutes;

function createFixture() {
    const routes = [];
    const middleware = function urlencodedMiddleware() { };
    const handlerCache = {};
    const handlers = new Proxy({}, {
        get: function (target, name) {
            if (handlerCache[name] == null) handlerCache[name] = function routeHandler() { };
            return handlerCache[name];
        }
    });
    const app = {};
    for (const method of ['get', 'post', 'ws']) {
        app[method] = function () { routes.push([method].concat(Array.from(arguments))); };
    }
    const service = createBasicRoutes({
        state: { app: app },
        handlers: handlers,
        urlencoded: function (options) {
            assert.deepEqual(options, { extended: false });
            return middleware;
        }
    });
    return { service: service, routes: routes, handlers: handlers, middleware: middleware };
}

function findRoute(fixture, method, path) {
    return fixture.routes.find(function (route) { return (route[0] === method) && (route[1] === path); });
}

test('registers basic routes under the domain URL', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/customers/' });
    assert.equal(findRoute(fixture, 'get', '/customers/')[2], fixture.handlers.rootRequest);
    assert.deepEqual(findRoute(fixture, 'post', '/customers/').slice(2), [fixture.middleware, fixture.handlers.rootPostRequest]);
    assert.equal(findRoute(fixture, 'get', '/customers/manifest.json')[2], fixture.handlers.manifestRequest);
    assert.equal(findRoute(fixture, 'get', '/customers/userfiles/*')[2], fixture.handlers.downloadUserFiles);
});

test('root redirects do not register the root POST handler', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/', rootredirect: 'https://example.com/' });
    assert.equal(findRoute(fixture, 'get', '/')[2], fixture.handlers.rootRedirect);
    assert.equal(findRoute(fixture, 'post', '/'), undefined);
    assert.ok(findRoute(fixture, 'post', '/login'));
});

test('backup and restore routes honor domain settings', function () {
    const disabled = createFixture();
    disabled.service.register({ url: '/', myserver: false });
    assert.equal(findRoute(disabled, 'get', '/backup.zip'), undefined);
    assert.equal(findRoute(disabled, 'post', '/restoreserver.ashx'), undefined);

    const enabled = createFixture();
    enabled.service.register({ url: '/', myserver: { backup: true, restore: true } });
    assert.ok(findRoute(enabled, 'get', '/backup.zip'));
    assert.deepEqual(findRoute(enabled, 'post', '/restoreserver.ashx').slice(2), [enabled.middleware, enabled.handlers.restoreRequest]);
});

test('registers simple websocket endpoints with their assigned handlers', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/tenant/' });
    assert.equal(findRoute(fixture, 'ws', '/tenant/echo.ashx')[2], fixture.handlers.echoWebSocket);
    assert.equal(findRoute(fixture, 'ws', '/tenant/2fahold.ashx')[2], fixture.handlers.twoFactorHoldWebSocket);
    assert.equal(findRoute(fixture, 'ws', '/tenant/apf.ashx')[2], fixture.handlers.apfWebSocket);
    assert.equal(findRoute(fixture, 'get', '/tenant/webrelay.ashx')[2], fixture.handlers.websocketExpected);
    assert.equal(findRoute(fixture, 'get', '/tenant/health.ashx')[2], fixture.handlers.health);
});
