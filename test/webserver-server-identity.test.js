/**
* @description Unit tests for web server public identity and origin checks
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createServerIdentity = require('../webserver/server-identity.js').createServerIdentity;

test('server names prefer domain DNS and configured certificate names', function () {
    const identity = createServerIdentity({ args: { port: 443 }, certificates: { CommonName: 'server.example.com' } });
    assert.equal(identity.getWebServerName({ dns: 'tenant.example.com' }, {}), 'tenant.example.com');
    assert.equal(identity.getWebServerName({}, {}), 'server.example.com');
});

test('unconfigured certificates use the HTTP host without its port', function () {
    const identity = createServerIdentity({ args: { port: 443 }, certificates: { CommonName: 'un-configured' } });
    assert.equal(identity.getWebServerName({}, { headers: { host: 'local.example:8443' } }), 'local.example');
});

test('base URLs honor alias ports and domain paths', function () {
    const identity = createServerIdentity({ args: { port: 443, aliasport: 8443 }, certificates: { CommonName: 'server.example.com' } });
    assert.equal(identity.generateBaseURL({ id: 'sales' }, {}), 'https://server.example.com:8443/sales/');
    assert.equal(identity.generateBaseURL({ id: 'sales', dns: 'sales.example.com' }, {}), 'https://sales.example.com:8443/');
});

test('origin checks support bypass, explicit lists and domain DNS', function () {
    const identity = createServerIdentity({ args: { port: 443 }, certificates: { CommonName: 'server.example.com' } });
    assert.equal(identity.CheckWebServerOriginName({ allowedorigin: true }, { headers: { origin: 'not a url' } }), true);
    assert.equal(identity.CheckWebServerOriginName({ allowedorigin: ['app.example.com'] }, { headers: { origin: 'https://app.example.com:1234' } }), true);
    assert.equal(identity.CheckWebServerOriginName({ dns: 'sales.example.com' }, { headers: { origin: 'https://sales.example.com' } }), true);
    assert.equal(identity.CheckWebServerOriginName({}, { headers: { origin: 'https://evil.example.com' } }), false);
    assert.equal(identity.CheckWebServerOriginName({}, { headers: { origin: '%' } }), false);
});
