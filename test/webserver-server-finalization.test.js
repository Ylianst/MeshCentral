/**
* @description Unit tests for web server finalization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createServerFinalization = require('../webserver/server-finalization.js').createServerFinalization;

test('server finalization installs routes, 404 handling and configured listeners', function () {
    const calls = [];
    const finalization = createServerFinalization({
        setupHttpHandlers: function () { calls.push('routes'); }, args: { port: 443, portbind: '0.0.0.0', agentport: 444, agentportbind: '127.0.0.1' },
        app: { use: function (handler) { calls.push(['use', handler]); } }, nice404: 'nice404',
        checkListenPort: function (port, bind, start) { calls.push(['listen', port, bind, start]); }, startWebServer: 'main', startAltWebServer: 'agent',
        done: function () { calls.push('done'); }
    });
    finalization();
    assert.deepEqual(calls, ['routes', ['use', 'nice404'], ['listen', 443, '0.0.0.0', 'main'], ['listen', 444, '127.0.0.1', 'agent'], 'done']);
});

test('optional 404, agent listener and completion callback can be omitted', function () {
    const calls = [];
    const finalization = createServerFinalization({
        setupHttpHandlers: function () { calls.push('routes'); }, args: { port: 443, nice404: false }, app: { use: function () { calls.push('404'); } }, nice404: 'nice404',
        checkListenPort: function (port) { calls.push(port); }, startWebServer: function () { }, startAltWebServer: function () { }
    });
    finalization();
    assert.deepEqual(calls, ['routes', 443]);
});
