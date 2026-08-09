/**
* @description Unit tests for TLS, SNI and session-resumption configuration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createTlsConfiguration = require('../webserver/tls-configuration.js').createTlsConfiguration;

function createFixture(overrides) {
    const args = Object.assign({}, overrides || {});
    const domains = { sales: { id: 'sales', dns: 'sales.example.com' } };
    const createdServers = [];
    const expressCalls = [];
    const state = { args: args, app: {}, agentapp: {}, dnsDomains: {}, useNodeDefaultTLSCiphers: false, tlsCiphers: null };
    const tls = {
        DEFAULT_CIPHERS: 'NODE_DEFAULT',
        createSecureContext: function (value) { return { context: { certificate: value.cert } }; }
    };
    const https = {
        createServer: function (options, app) {
            const handlers = {};
            const server = { options: options, app: app, handlers: handlers, on: function (event, callback) { handlers[event] = callback; return server; } };
            createdServers.push(server);
            return server;
        }
    };
    const config = createTlsConfiguration({
        state: state,
        parent: { config: { domains: domains } },
        args: args,
        certificates: { web: { cert: 'main-cert', key: 'key', ca: 'ca' }, webdefault: { cert: 'default-cert', key: 'key', ca: 'ca' }, dns: { sales: { cert: 'sales-cert' } } },
        tls: tls,
        https: https,
        expressWs: function (app, server, options) { expressCalls.push([app, server, options]); return { app: app, server: server }; },
        constants: { SSL_OP_NO_SSLv2: 1, SSL_OP_NO_SSLv3: 2, SSL_OP_NO_COMPRESSION: 4, SSL_OP_CIPHER_SERVER_PREFERENCE: 8, SSL_OP_NO_TLSv1: 16, SSL_OP_NO_TLSv1_1: 32 }
    });
    return { config: config, state: state, createdServers: createdServers, expressCalls: expressCalls };
}

test('SNI credentials populate DNS-domain lookup and fallback certificates', function () {
    const fixture = createFixture();
    assert.equal(fixture.state.dnsDomains['sales.example.com'].id, 'sales');
    assert.equal(fixture.state.tlsSniCredentials['sales.example.com'].certificate, 'sales-cert');
    let selected;
    fixture.config.tlsSniCallback('missing.example.com', function (err, context) { selected = context; });
    assert.equal(selected.certificate, 'main-cert');
});

test('TLS offload attaches WebSockets without creating an HTTPS server', function () {
    const fixture = createFixture({ tlsoffload: true, wscompression: true });
    fixture.config.setupServers();
    assert.equal(fixture.createdServers.length, 0);
    assert.equal(fixture.expressCalls[0][1], null);
    assert.equal(fixture.expressCalls[0][2].wsOptions.perMessageDeflate, true);
});

test('TLS servers honor custom ciphers and cache resumable sessions', function () {
    const fixture = createFixture();
    fixture.state.tlsCiphers = ['ONE', 'TWO'];
    fixture.config.setupServers();
    const server = fixture.createdServers[0];
    assert.equal(server.options.ciphers, 'ONE:TWO');
    assert.equal(typeof server.options.SNICallback, 'function');
    let completed = false;
    server.handlers.newSession(Buffer.from('id'), Buffer.from('data'), function () { completed = true; });
    assert.equal(completed, true);
    assert.equal(fixture.config.getSessionStoreSize(), 1);
    let resumed;
    server.handlers.resumeSession(Buffer.from('id'), function (err, data) { resumed = data; });
    assert.deepEqual(resumed, Buffer.from('data'));
});

test('agent-only TLS creates a second server with the default certificate', function () {
    const fixture = createFixture({ agentport: 4443, agentporttls: true });
    fixture.config.setupServers();
    assert.equal(fixture.createdServers.length, 2);
    assert.equal(fixture.createdServers[1].options.cert, 'default-cert');
    assert.equal(fixture.state.expressWsAlt.server, fixture.createdServers[1]);
});
