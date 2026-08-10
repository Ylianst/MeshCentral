/**
* @description Unit tests for authenticated plugin HTTP requests
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPluginRequests = require('../../../webserver/services/plugin-requests.js').createPluginRequests;

function createFixture(domain) {
    const calls = [];
    const state = { users: { 'user/tenant/alice': { name: 'Alice' } } };
    const pluginHandler = {
        handleAdminReq: function () { calls.push(['get'].concat(Array.from(arguments))); },
        handleAdminPostReq: function () { calls.push(['post'].concat(Array.from(arguments))); },
        refreshJS: function () { calls.push(['script'].concat(Array.from(arguments))); }
    };
    const handlers = createPluginRequests({ state: state, pluginHandler: pluginHandler, checkUserIpAddress: function () { return domain; } });
    return { handlers: handlers, state: state, calls: calls };
}

function response() { return { sendStatus: function (status) { this.status = status; } }; }

test('plugin requests require an active user session', function () {
    const fixture = createFixture({ id: 'tenant' });
    const res = response();
    fixture.handlers.handleAdminRequest({}, res);
    assert.equal(res.status, 401);
    assert.equal(fixture.calls.length, 0);
});

test('plugin requests stop when the source address is rejected', function () {
    const fixture = createFixture(null);
    fixture.handlers.handleScript({ session: { userid: 'user/tenant/alice' } }, response());
    assert.equal(fixture.calls.length, 0);
});

test('plugin requests delegate with the authenticated user and server state', function () {
    const fixture = createFixture({ id: 'tenant' });
    const req = { session: { userid: 'user/tenant/alice' } };
    const res = response();
    fixture.handlers.handleAdminRequest(req, res);
    fixture.handlers.handleAdminPostRequest(req, res);
    fixture.handlers.handleScript(req, res);
    assert.deepEqual(fixture.calls.map(function (call) { return call[0]; }), ['get', 'post', 'script']);
    assert.equal(fixture.calls[0][3], fixture.state.users['user/tenant/alice']);
    assert.equal(fixture.calls[0][4], fixture.state);
});
