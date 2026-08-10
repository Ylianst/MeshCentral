/**
* @description Unit tests for WebSocket session and inner authentication
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createWebSocketAuth = require('../../../webserver/realtime/websocket-auth.js').createWebSocketAuth;

function socket() {
    const events = {};
    return {
        events: events,
        messages: [],
        closed: false,
        _socket: { paused: false, pause: function () { this.paused = true; }, resume: function () { this.paused = false; } },
        on: function (name, handler) { events[name] = handler; },
        send: function (message) { this.messages.push(JSON.parse(message)); },
        close: function () { this.closed = true; },
        removeAllListeners: function () { }
    };
}

function createFixture(settings) {
    settings = settings || {};
    const domain = { id: 'tenant' };
    const user = { _id: 'user/tenant/alice', name: 'alice', siteadmin: 0 };
    const parent = {
        certificates: { CommonName: 'server.example.com' },
        debug: function () { },
        loginCookieEncryptionKey: 'key',
        decodeCookie: settings.decodeCookie || function () { return null; }
    };
    const state = {
        parent: parent,
        args: {},
        users: { 'user/tenant/alice': user },
        checkAllowLogin: function () { return settings.allowed !== false; },
        common: { validateString: function (value, min, max) { return (typeof value == 'string') && (value.length >= min) && (value.length <= max); }, zeroPad: function (value) { return String(value); } },
        authenticate: function (name, pass, requestDomain, callback) { callback(null, user._id, null, {}); },
        db: { SetUser: function () { } },
        getLanguageCodes: function () { return ['en']; },
        webCertificateHashs: {},
        webCertificateFullHashs: {},
        crypto: { randomBytes: function (length) { return Buffer.alloc(length); } },
        agentCertificateAsn1: ''
    };
    const service = createWebSocketAuth({
        state: state,
        parent: parent,
        getDomain: function () { return settings.domainMissing ? null : domain; },
        checkUserIpAddress: function () { return settings.domainMissing ? null : domain; },
        checkCookieIp: settings.checkCookieIp || function (expected, actual) { return expected === actual; },
        noMeshCommandRight: 0x80,
        cleanRemoteAddr: function (value) { return value; },
        getRandomEightDigitInteger: function () { return 12345678; },
        getRandomSixDigitInteger: function () { return 123456; },
        checkUserOneTimePasswordSkip: function () { return true; },
        checkUserOneTimePasswordRequired: function () { return false; },
        checkUserOneTimePassword: function (req, requestDomain, requestUser, token, hardwareToken, callback) { callback(true); },
        setSessionRandom: function (req) { req.session.x = 'random'; }
    });
    return { service: service, state: state, parent: parent, domain: domain, user: user };
}

function request() { return { headers: {}, query: {}, session: {}, clientIp: '192.0.2.1' }; }

test('anonymous sockets continue only when no-auth mode is allowed', function () {
    const fixture = createFixture();
    const ws = socket();
    let result;
    fixture.service.PerformWSSessionAuth(ws, request(), true, function (activeWs, req, domain, user) { result = [domain, user]; });
    assert.deepEqual(result, [fixture.domain, null]);
    assert.equal(ws._socket.paused, true);

    const required = socket();
    fixture.service.PerformWSSessionAuth(required, request(), false, function () { });
    assert.equal(required.closed, true);
    assert.deepEqual(required.messages[0], { action: 'close', cause: 'noauth', msg: 'noauth-4' });
});

test('existing same-domain sessions resolve their user', function () {
    const fixture = createFixture();
    const req = request();
    req.session.userid = fixture.user._id;
    let authenticatedUser;
    fixture.service.PerformWSSessionAuth(socket(), req, true, function (ws, requestValue, domain, user) { authenticatedUser = user; });
    assert.equal(authenticatedUser, fixture.user);
});

test('encrypted authentication cookies enforce their bound IP address', function () {
    const checks = [];
    const fixture = createFixture({
        decodeCookie: function () { return { userid: 'user/tenant/alice', domainid: 'tenant', ip: '192.0.2.10' }; },
        checkCookieIp: function (expected, actual) { checks.push([expected, actual]); return false; }
    });
    const req = request();
    req.query.auth = 'cookie';
    const ws = socket();
    let authenticated = false;
    fixture.service.PerformWSSessionAuth(ws, req, false, function () { authenticated = true; });
    assert.deepEqual(checks, [['192.0.2.10', '192.0.2.1']]);
    assert.equal(authenticated, false);
    assert.equal(ws.closed, true);
    assert.deepEqual(ws.messages[0], { action: 'close', cause: 'noauth', msg: 'noauth-4' });
});

test('banned sockets are closed before domain and session processing', function () {
    const fixture = createFixture({ allowed: false });
    const ws = socket();
    fixture.service.PerformWSSessionAuth(ws, request(), true, function () { });
    assert.equal(ws.closed, true);
    assert.deepEqual(ws.messages[0], { action: 'close', cause: 'banned', msg: 'banned-1' });
    assert.equal(ws._socket.paused, false);
});

test('inner authentication rejects malformed server challenges', function () {
    const fixture = createFixture();
    const ws = socket();
    fixture.service.PerformWSSessionInnerAuth(ws, request(), fixture.domain, function () { });
    ws.events.message(Buffer.from(JSON.stringify({ action: 'serverAuth', cnonce: '', tlshash: '' })));
    assert.equal(ws.closed, true);
    assert.deepEqual(ws.messages[0], { action: 'close', cause: 'noauth', msg: 'badargs' });
});
