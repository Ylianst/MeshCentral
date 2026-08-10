/**
* @description Unit tests for domain theme and static middleware
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDomainStatic = require('../../../../webserver/http/routes/domain-static.js').createDomainStatic;

function createFixture(domain) {
    const middleware = [];
    const staticCalls = [];
    const intervals = [];
    const state = {
        app: { use: function (url, handler) { middleware.push([url, handler]); } },
        path: { join: function () { return Array.from(arguments).join('/'); } },
        fs: { stat: function (path, callback) { callback(null, { isFile: function () { return true; } }); } },
        express: { static: function (folder) { staticCalls.push(folder); return function (req, res) { res.staticFolder = folder; }; } },
        wsagentsDisconnections: { old: true }
    };
    const parent = { datapath: 'data', webPublicPath: 'public', webPublicOverridePath: 'override' };
    const service = createDomainStatic({
        state: state,
        parent: parent,
        getDomain: function () { return domain; },
        setInterval: function (handler, delay) { const token = { handler: handler, delay: delay }; intervals.push(token); return token; }
    });
    return { service: service, state: state, middleware: middleware, staticCalls: staticCalls, intervals: intervals };
}

test('theme middleware serves existing GET assets from the selected pack', function () {
    const domain = { url: '/tenant/', themepack: 'dark' };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    const res = { sendFile: function (path) { this.file = path; } };
    fixture.middleware[0][1]({ method: 'GET', path: 'styles/site.css' }, res, function () { });
    assert.equal(res.file, 'data/theme-pack/dark/public/styles/site.css');
});

test('theme middleware passes non-GET and traversal requests onward', function () {
    const domain = { url: '/', themepack: 'dark' };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    let nextCalls = 0;
    fixture.middleware[0][1]({ method: 'POST', path: 'file' }, {}, function () { nextCalls++; });
    fixture.middleware[0][1]({ method: 'GET', path: '../secret' }, {}, function () { nextCalls++; });
    assert.equal(nextCalls, 2);
});

test('domain public path precedes override and default static folders', function () {
    const domain = { url: '/', webpublicpath: 'domain-public' };
    const fixture = createFixture(domain);
    fixture.service.register(domain);
    const res = {};
    fixture.middleware[1][1]({}, res, function () { });
    assert.equal(res.staticFolder, 'domain-public');
    assert.deepEqual(fixture.staticCalls, ['public', 'domain-public']);
    assert.equal(fixture.middleware[2][1] instanceof Function, true);
});

test('disconnection cleanup starts once and clears state every two minutes', function () {
    const fixture = createFixture({ url: '/' });
    const first = fixture.service.startDisconnectionCleanup();
    const second = fixture.service.startDisconnectionCleanup();
    assert.equal(first, second);
    assert.equal(fixture.intervals.length, 1);
    assert.equal(fixture.intervals[0].delay, 120000);
    fixture.intervals[0].handler();
    assert.deepEqual(fixture.state.wsagentsDisconnections, {});
});
