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
const getCoreDownloadUrl = require('../webserver/agent-downloads.js').getCoreDownloadUrl;
const sendMeshCoreList = require('../webserver/agent-downloads.js').sendMeshCoreList;
const sendMeshCore = require('../webserver/agent-downloads.js').sendMeshCore;

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

test('MeshCore links preserve the request path and encode query values', function () {
    assert.equal(getCoreDownloadUrl({ originalUrl: '/meshagents?cores=1', query: {} }, 'dlcore', 'Core 1'), '/meshagents?dlcore=Core%201');
    assert.equal(getCoreDownloadUrl({ originalUrl: '/tenant/meshagents?cores=1', query: { key: 'a&b' } }, 'dlccore', 'Core 1'), '/tenant/meshagents?dlccore=Core%201&key=a%26b');
});

test('MeshCore listings contain download links, sizes and hashes', function () {
    const parent = {
        defaultMeshCores: { 'Core 1': Buffer.alloc(8) },
        defaultMeshCoresDeflate: { 'Core 1': Buffer.alloc(4) },
        defaultMeshCoresHash: { 'Core 1': Buffer.from([1, 2]) }
    };
    const res = { send: function (body) { this.body = body; } };
    sendMeshCoreList(parent, { originalUrl: '/tenant/meshagents?cores=1', query: { key: 'secret' } }, res);
    assert.match(res.body, /href="\/tenant\/meshagents\?dlcore=Core%201&amp;key=secret"|href="\/tenant\/meshagents\?dlcore=Core%201&key=secret"/);
    assert.match(res.body, />8<\/a>/);
    assert.match(res.body, /0102/);
});

test('MeshCore downloads strip the uncompressed header and preserve compressed data', function () {
    const parent = { defaultMeshCores: { core: Buffer.from('HEADcode') }, defaultMeshCoresDeflate: { core: Buffer.from('zip') } };
    const headers = [];
    const setHeader = function (res, type, filename) { headers.push(filename); };
    const plain = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendMeshCore(parent, setHeader, { query: { dlcore: 'core' } }, plain, false);
    assert.equal(plain.body.toString(), 'code');
    assert.equal(headers[0], 'core.js');

    const compressed = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendMeshCore(parent, setHeader, { query: { dlccore: 'core' } }, compressed, true);
    assert.equal(compressed.body, parent.defaultMeshCoresDeflate.core);
    assert.equal(headers[1], 'core.js.deflate');
});

test('unknown MeshCore downloads return not found', function () {
    const res = { sendStatus: function (status) { this.status = status; } };
    sendMeshCore({ defaultMeshCores: {} }, function () { }, { query: { dlcore: 'missing' } }, res, false);
    assert.equal(res.status, 404);
});
