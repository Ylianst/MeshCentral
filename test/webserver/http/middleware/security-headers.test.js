/**
* @description Unit tests for HTTP security-header construction
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSecurityHeaders = require('../../../../webserver/http/middleware/security-headers.js').createSecurityHeaders;

function createFixture(settings, trusted, relayServer) {
    return createSecurityHeaders({
        getSettings: function () { return settings || {}; },
        getWebRelayServer: function () { return relayServer || null; },
        isTrustedCert: function () { return trusted === true; }
    });
}

test('default security headers deny framing and enable HSTS for trusted certificates', function () {
    const service = createFixture({}, true);
    const headers = service.build({}, { headers: { host: 'server.example.com', 'user-agent': 'Chrome' } }, null);
    assert.equal(headers['X-Frame-Options'], 'sameorigin');
    assert.equal(headers['Strict-Transport-Security'], 'max-age=63072000');
    assert.equal(headers['Permissions-Policy'], 'interest-cohort=()');
    assert.ok(headers['Content-Security-Policy'].includes("connect-src 'self' wss://server.example.com"));
});

test('allowed framing origins become CSP frame ancestors', function () {
    const service = createFixture({ allowedframingorigins: 'https://one.example, https://two.example' }, false);
    const headers = service.build({}, { headers: { host: 'server.example.com' } }, null);
    assert.ok(headers['Content-Security-Policy'].includes("frame-ancestors 'self' https://one.example https://two.example"));
    assert.equal(headers['X-Frame-Options'], undefined);
});

test('relay, forwarded-host, geolocation and Duo sources are reflected in CSP', function () {
    const service = createFixture({}, false, { port: 4443 });
    const domain = { geolocation: true, duo2factor: { apihostname: 'api.duo.example' } };
    const headers = service.build(domain, { headers: { host: 'server.example.com' } }, 'proxy.example.com');
    const csp = headers['Content-Security-Policy'];
    assert.ok(csp.includes('*.openstreetmap.org'));
    assert.ok(csp.includes('wss://proxy.example.com'));
    assert.ok(csp.includes('https://proxy.example.com:4443'));
    assert.ok(csp.includes('api.duo.example'));
});

test('domain headers can override or remove generated headers', function () {
    const service = createFixture({}, false);
    const headers = service.build({ httpheaders: { 'Referrer-Policy': 'same-origin', 'X-XSS-Protection': null, 'X-Custom': 'yes' } }, { headers: { host: 'server.example.com' } }, null);
    assert.equal(headers['Referrer-Policy'], 'same-origin');
    assert.equal(headers['X-XSS-Protection'], undefined);
    assert.equal(headers['X-Custom'], 'yes');
});
