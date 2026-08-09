/**
* @description Unit tests for HTTP and WebSocket session helpers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSessions = require('../webserver/sessions.js').createSessions;

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
