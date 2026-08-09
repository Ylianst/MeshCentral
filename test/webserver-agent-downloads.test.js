/**
* @description Unit tests for Mesh agent and companion tool downloads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getSessionUser = require('../webserver/agent-downloads.js').getSessionUser;
const hasDatabaseFailure = require('../webserver/agent-downloads.js').hasDatabaseFailure;
const getAgentInfo = require('../webserver/agent-downloads.js').getAgentInfo;
const getMeshRelayUrl = require('../webserver/agent-downloads.js').getMeshRelayUrl;

test('agent tool downloads safely resolve optional session users', function () {
    const users = { 'user//alice': { name: 'Alice' } };
    assert.equal(getSessionUser(users, null), null);
    assert.equal(getSessionUser(users, {}), null);
    assert.equal(getSessionUser(users, { session: null }), null);
    assert.equal(getSessionUser(users, { session: {} }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//missing' } }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//alice' } }), users['user//alice']);
});

test('agent action node lookups reject database failures and missing arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('agent listings prefer binaries customized for the domain', function () {
    const defaults = { 3: { name: 'default' }, 4: { name: 'default-64' } };
    const domain = { 3: { name: 'custom' } };
    assert.equal(getAgentInfo(defaults, domain, 3), domain[3]);
    assert.equal(getAgentInfo(defaults, domain, 4), defaults[4]);
    assert.equal(getAgentInfo(defaults, null, 3), defaults[3]);
});

test('agent actions build valid relay URLs for root and path domains', function () {
    const state = { args: { port: 443 }, getWebServerName: function () { return 'server.example.com'; } };
    assert.equal(getMeshRelayUrl(state, { id: '' }, {}), 'wss://server.example.com:443/meshrelay.ashx');
    assert.equal(getMeshRelayUrl(state, { id: 'tenant' }, {}), 'wss://server.example.com:443/tenant/meshrelay.ashx');
    state.args.aliasport = 8443;
    assert.equal(getMeshRelayUrl(state, { id: 'tenant' }, {}), 'wss://server.example.com:8443/tenant/meshrelay.ashx');
});
