/**
* @description Unit tests for base web server state creation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createBaseState = require('../../../webserver/bootstrap/base-state.js').createBaseState;

function createLoader(applications, compressionFilters, proxyUrls) {
    function express() {
        const application = { middleware: [], disabled: [], use: function (value) { this.middleware.push(value); }, disable: function (value) { this.disabled.push(value); } };
        applications.push(application);
        return application;
    }
    function compression(options) { compressionFilters.push(options.filter); return 'compression-middleware'; }
    compression.filter = function () { return 'default-filter'; };
    function HttpsProxyAgent(url) { proxyUrls.push(url); }
    return function (name) {
        if (name == 'express') { return express; }
        if (name == 'compression') { return compression; }
        if (name == 'https-proxy-agent') { return { HttpsProxyAgent: HttpsProxyAgent }; }
        if (name == 'crypto') { return { constants: {} }; }
        return { module: name };
    };
}

test('base state initializes applications, dependencies and collections', function () {
    const applications = [], filters = [], proxies = [];
    const state = createBaseState({ filespath: 'files' }, 'database', { agentport: 444, compression: true }, { web: {} }, createLoader(applications, filters, proxies), {});
    assert.equal(applications.length, 2);
    assert.deepEqual(state.app.disabled, ['x-powered-by']);
    assert.deepEqual(state.app.middleware, ['compression-middleware']);
    assert.equal(state.filespath, 'files');
    assert.equal(state.db, 'database');
    assert.deepEqual(state.users, {});
    assert.deepEqual(state.meshes, {});
    assert.deepEqual(state.userGroups, {});
});

test('compression skips device transfers and relay DNS hosts', function () {
    const applications = [], filters = [], proxies = [];
    createBaseState({}, {}, { compression: true, relaydns: ['relay.example.com'] }, {}, createLoader(applications, filters, proxies), {});
    assert.equal(filters[0]({ path: '/devicefile.ashx', hostname: 'server.example.com' }, {}), false);
    assert.equal(filters[0]({ path: '/', hostname: 'relay.example.com' }, {}), false);
    assert.equal(filters[0]({ path: '/', hostname: 'server.example.com' }, {}), 'default-filter');
});

test('proxy environment variables create the HTTPS proxy agent', function () {
    const applications = [], filters = [], proxies = [];
    createBaseState({}, {}, {}, {}, createLoader(applications, filters, proxies), { HTTPS_PROXY: 'http://proxy.example.com' });
    assert.deepEqual(proxies, ['http://proxy.example.com']);
});
