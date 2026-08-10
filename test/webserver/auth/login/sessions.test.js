/**
* @description Unit tests for HTTP and WebSocket session helpers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSessions = require('../../../../webserver/auth/login/sessions.js').createSessions;

test('session random values are unique among destroyed sessions', function () {
    const values = [Buffer.from('first!'), Buffer.from('second')];
    const first = values[0].toString('base64');
    const destroyed = { ['user/domain/alice/' + first]: 1 };
    const sessions = createSessions({ crypto: { randomBytes: function () { return values.shift(); } }, destroyedSessions: destroyed });
    const req = { session: { userid: 'user/domain/alice' } };
    sessions.setSessionRandom(req);
    assert.equal(req.session.x, Buffer.from('second').toString('base64'));
});

test('destroyed sessions expire after two hours', function () {
    const now = 10000000;
    const destroyed = { old: now - 7200001, boundary: now - 7200000, recent: now - 1000 };
    const sessions = createSessions({ crypto: {}, destroyedSessions: destroyed, now: function () { return now; } });
    sessions.clearDestroyedSessions();
    assert.deepEqual(destroyed, { boundary: now - 7200000, recent: now - 1000 });
});

test('session preparation invalidates destroyed sessions and removes legacy values', function () {
    const destroyed = { 'user/domain/alice/random': 1 };
    const sessions = createSessions({ crypto: {}, destroyedSessions: destroyed });
    const req = { session: { userid: 'user/domain/alice', x: 'random', ip: '192.0.2.1', t: 1, tokenpassword: 'secret', u2f: {} } };
    sessions.prepareSession(req);
    assert.deepEqual(req.session, {});
});

test('legacy sessions receive a random identifier', function () {
    const sessions = createSessions({ crypto: { randomBytes: function () { return Buffer.from('random'); } }, destroyedSessions: {} });
    const req = { session: { userid: 'user/domain/alice' } };
    sessions.prepareSession(req);
    assert.equal(req.session.x, Buffer.from('random').toString('base64'));
});

test('session refresh enforces IP binding and updates active timestamps', function () {
    const now = 600000;
    const sessions = createSessions({ crypto: {}, destroyedSessions: {}, now: function () { return now; }, checkCookieIp: function (cookieIp, requestIp) { return cookieIp == requestIp; } });
    const active = { clientIp: '192.0.2.1', session: { userid: 'user/domain/alice', ip: '192.0.2.1' } };
    sessions.refreshSession(active);
    assert.equal(active.session.t, 10);
    const changed = { clientIp: '192.0.2.2', session: { userid: 'user/domain/alice', ip: '192.0.2.1' } };
    sessions.refreshSession(changed);
    assert.deepEqual(changed.session, {});
});

test('WebSocket arguments pass immediately when no extension is requested', function () {
    const sessions = createSessions({ crypto: {}, destroyedSessions: {} });
    const ws = {};
    const req = { query: {} };
    let received;
    sessions.getWebsocketArgs(ws, req, function (actualWs, actualReq) { received = [actualWs, actualReq]; });
    assert.deepEqual(received, [ws, req]);
});

test('WebSocket arguments merge one valid message and remove the listener', function () {
    const sessions = createSessions({ crypto: {}, destroyedSessions: {} });
    let listener;
    let removed;
    const ws = {
        on: function (event, callback) { assert.equal(event, 'message'); listener = callback; },
        removeEventListener: function (event, callback) { removed = [event, callback]; }
    };
    const req = { query: { moreargs: '1', existing: 'yes' } };
    let calls = 0;
    sessions.getWebsocketArgs(ws, req, function () { calls++; });
    listener(Buffer.from('{"action":"urlargs","args":{"nodeid":"node/1"}}'));
    assert.deepEqual(req.query, { existing: 'yes', nodeid: 'node/1' });
    assert.deepEqual(removed, ['message', listener]);
    assert.equal(calls, 1);
});
