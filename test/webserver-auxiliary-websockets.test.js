/**
* @description Unit tests for auxiliary WebSocket handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAuxiliaryWebSockets = require('../webserver/auxiliary-websockets.js').createAuxiliaryWebSockets;

function socket() {
    return {
        handlers: {},
        sent: [],
        _socket: { setKeepAlive: function (enabled, delay) { this.value = [enabled, delay]; } },
        on: function (event, handler) { this.handlers[event] = handler; },
        send: function (data) { this.sent.push(data); },
        close: function () { this.closed = true; }
    };
}

test('echo WebSockets return data and close on the control message', function () {
    const service = createAuxiliaryWebSockets({ state: {}, parent: {}, checkUserIpAddress: function () { return {}; }, log: function () { } });
    const ws = socket();
    service.echo(ws, { clientIp: '127.0.0.1' });
    ws.handlers.message(Buffer.from('hello'));
    assert.equal(ws.sent[0].toString(), 'hello');
    ws.handlers.message(Buffer.from('close'));
    assert.equal(ws.closed, true);
    assert.deepEqual(ws._socket.value, [true, 240000]);
});

test('push-authentication sockets subscribe, notify and issue approval tokens', function () {
    const subscriptions = [];
    const removals = [];
    const userId = 'user/tenant/alice';
    const parent = {
        loginCookieEncryptionKey: 'key',
        decodeCookie: function () { return { d: 'tenant', u: userId, s: 'session', c: Buffer.from('123456').toString('base64') }; },
        encodeCookie: function (value) { return value.a === 'pushAuth' ? 'login-token' : 'device-token'; },
        AddEventDispatch: function (targets) { subscriptions.push(targets); },
        RemoveAllEventDispatch: function (target) { removals.push(target); },
        firebase: { sendToDevice: function (device, payload, options, callback) { callback('id', null); } }
    };
    const service = createAuxiliaryWebSockets({ state: { users: { [userId]: { otpdev: 'device' } } }, parent: parent, checkUserIpAddress: function () { return { id: 'tenant', title: 'Console' }; }, log: function () { } });
    const ws = socket();
    service.twoFactorHold(ws, { query: { c: 'cookie' } });
    assert.deepEqual(subscriptions, [['2fadev-session']]);
    assert.deepEqual(JSON.parse(ws.sent[0]), { sent: true, code: '123456' });
    ws.HandleEvent(null, { approved: true, userid: userId, domain: 'tenant' });
    assert.deepEqual(JSON.parse(ws.sent[1]), { approved: true, token: 'login-token' });
    assert.equal(removals[0], ws);
});

test('push-authentication sockets reject invalid cookies', function () {
    const service = createAuxiliaryWebSockets({ state: { users: {} }, parent: { decodeCookie: function () { return null; } }, checkUserIpAddress: function () { return { id: 'tenant' }; }, log: function () { } });
    const ws = socket();
    service.twoFactorHold(ws, { query: { c: 'cookie' } });
    assert.equal(ws.closed, true);
});
