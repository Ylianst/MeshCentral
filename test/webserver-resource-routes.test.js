/**
* @description Unit tests for downloadable resource and optional domain route registration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createResourceRoutes = require('../webserver/resource-routes.js').createResourceRoutes;

function createFixture(options) {
    const routes = [];
    const middleware = function urlencodedMiddleware() { };
    const handlerCache = {};
    const handlers = new Proxy({}, {
        get: function (target, name) {
            if (handlerCache[name] == null) handlerCache[name] = function resourceHandler() { };
            return handlerCache[name];
        }
    });
    const app = {};
    for (const method of ['get', 'post', 'ws']) app[method] = function () { routes.push([method].concat(Array.from(arguments))); };
    const service = createResourceRoutes({
        state: { app: app },
        handlers: handlers,
        hasPlugins: options && options.hasPlugins,
        hasCrowdSec: options && options.hasCrowdSec,
        urlencoded: function (settings) {
            assert.deepEqual(settings, { extended: false });
            return middleware;
        }
    });
    return { service: service, routes: routes, handlers: handlers, middleware: middleware };
}

function findRoute(fixture, method, path) {
    return fixture.routes.find(function (route) { return (route[0] === method) && (route[1] === path); });
}

test('registers downloads, images and recordings below the domain path', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/tenant/' });
    assert.equal(findRoute(fixture, 'get', '/tenant/devicefile.ashx')[2], fixture.handlers.deviceFile);
    assert.equal(findRoute(fixture, 'get', '/tenant/welcome.jpg')[2], fixture.handlers.welcomeImageRequest);
    assert.equal(findRoute(fixture, 'get', '/tenant/welcome.png')[2], fixture.handlers.welcomeImageRequest);
    assert.equal(findRoute(fixture, 'ws', '/tenant/recordings.ashx')[2], fixture.handlers.getRecordingsWebSocket);
    assert.equal(findRoute(fixture, 'ws', '/tenant/agenttransfer.ashx')[2], fixture.handlers.agentFileTransfer);
});

test('form routes receive URL-encoded middleware', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/' });
    assert.deepEqual(findRoute(fixture, 'post', '/translations').slice(2), [fixture.middleware, fixture.handlers.translationsRequest]);
    assert.deepEqual(findRoute(fixture, 'post', '/invite').slice(2), [fixture.middleware, fixture.handlers.inviteRequest]);
});

test('plugin and CrowdSec routes are registered only when available', function () {
    const disabled = createFixture();
    disabled.service.register({ url: '/' });
    assert.equal(findRoute(disabled, 'get', '/pluginadmin.ashx'), undefined);
    assert.equal(findRoute(disabled, 'get', '/captcha.ashx'), undefined);

    const enabled = createFixture({ hasPlugins: true, hasCrowdSec: true });
    enabled.service.register({ url: '/' });
    assert.equal(findRoute(enabled, 'get', '/pluginadmin.ashx')[2], enabled.handlers.pluginAdminRequest);
    assert.equal(findRoute(enabled, 'get', '/pluginHandler.js')[2], enabled.handlers.pluginScript);
    assert.deepEqual(findRoute(enabled, 'post', '/captcha.ashx').slice(2), [enabled.middleware, enabled.handlers.captchaPostRequest]);
});

test('new account CAPTCHA follows the domain setting', function () {
    const fixture = createFixture();
    fixture.service.register({ url: '/off/', newaccountscaptcha: false });
    fixture.service.register({ url: '/on/', newaccountscaptcha: {} });
    assert.equal(findRoute(fixture, 'get', '/off/newAccountCaptcha.ashx'), undefined);
    assert.equal(findRoute(fixture, 'get', '/on/newAccountCaptcha.ashx')[2], fixture.handlers.newAccountCaptchaRequest);
});
