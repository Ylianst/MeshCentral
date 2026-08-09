/**
* @description Unit tests for web push and Android token ownership
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPushNotifications = require('../webserver/push-notifications.js').createPushNotifications;
const isValidFirebaseRelayData = require('../webserver/push-notifications.js').isValidFirebaseRelayData;

function createRelayFixture(config) {
    const sends = [], relays = [];
    const parent = {
        config: { firebase: config },
        debug: function () { },
        firebase: {
            sendToDevice: function (target, payload, options, callback) { sends.push({ target: target, payload: payload, options: options }); callback('id', null); },
            setupRelay: function (ws) { relays.push(ws); }
        }
    };
    const service = createPushNotifications({
        parent: parent,
        db: {},
        getWebPush: function () { return null; },
        dispatchEvent: function () { },
        cloneSafeUser: function (user) { return user; },
        cloneSafeNode: function (node) { return node; },
        eventSource: {}
    });
    return { service: service, sends: sends, relays: relays };
}

test('Firebase relay validation safely rejects null nested objects', function () {
    const valid = { pmt: 'token', payload: { notification: { title: 'Title', body: 'Body' } }, options: { priority: 'Normal', timeToLive: 60 } };
    assert.equal(isValidFirebaseRelayData(valid), true);
    assert.equal(isValidFirebaseRelayData(null), false);
    assert.equal(isValidFirebaseRelayData({ pmt: 'token', payload: null, options: valid.options }), false);
    assert.equal(isValidFirebaseRelayData({ pmt: 'token', payload: { notification: null }, options: valid.options }), false);
    assert.equal(isValidFirebaseRelayData({ pmt: 'token', payload: valid.payload, options: null }), false);
});

test('Firebase push-only relay rejects malformed payloads and forwards valid messages', function () {
    const fixture = createRelayFixture({ pushrelayserver: 'secret' });
    const invalidResponse = { sendStatus: function (status) { this.status = status; } };
    fixture.service.handleFirebasePushOnlyRelayRequest({ body: { msg: 'null' }, query: { key: 'secret' } }, invalidResponse);
    assert.equal(invalidResponse.status, 404);
    assert.equal(fixture.sends.length, 0);

    const message = { pmt: 'token', payload: { notification: { title: 'Title', body: 'Body' } }, options: { priority: 'High', timeToLive: 60 } };
    const validResponse = { sendStatus: function (status) { this.status = status; } };
    fixture.service.handleFirebasePushOnlyRelayRequest({ body: { msg: JSON.stringify(message) }, query: { key: 'secret' } }, validResponse);
    assert.equal(validResponse.status, 200);
    assert.deepEqual(fixture.sends[0], { target: { pmt: 'token' }, payload: message.payload, options: message.options });
});

test('Firebase WebSocket relay closes invalid keys and accepts configured keys', function () {
    const fixture = createRelayFixture({ relayserver: 'secret' });
    const rejected = { close: function () { this.closed = true; } };
    fixture.service.handleFirebaseRelayRequest(rejected, { query: { key: 'wrong' } });
    assert.equal(rejected.closed, true);
    assert.equal(fixture.relays.length, 0);

    const accepted = { close: function () { this.closed = true; } };
    fixture.service.handleFirebaseRelayRequest(accepted, { query: { key: 'secret' } });
    assert.equal(accepted.closed, undefined);
    assert.deepEqual(fixture.relays, [accepted]);
});

test('failed web push subscriptions are removed after all sends complete', async function () {
    const writes = [];
    const events = [];
    const good = { endpoint: 'good' };
    const bad = { endpoint: 'bad' };
    const db = { changeStream: false, SetUser: function (user) { writes.push(user); } };
    const service = createPushNotifications({
        db: db,
        getWebPush: function () { return { sendNotification: function (subscription) { return subscription === bad ? Promise.reject(new Error('gone')) : Promise.resolve(); } }; },
        dispatchEvent: function (targets, source, event) { events.push([targets, event]); },
        cloneSafeUser: function (user) { return { _id: user._id }; },
        cloneSafeNode: function (node) { return node; },
        eventSource: {}
    });
    const user = { _id: 'user/domain/alice', name: 'alice', webpush: [good, bad], groups: { operators: 1 } };
    service.performWebPush({ id: 'domain' }, user, { message: 'hello' }, {});
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.deepEqual(user.webpush, [good]);
    assert.equal(writes.length, 1);
    assert.deepEqual(events[0][0], ['*', 'server-users', user._id, 'server-users:operators']);
});

test('push token ownership is removed from an old node and reassigned', function () {
    const writes = [];
    const events = [];
    const oldNode = { _id: 'node/domain/old', domain: 'domain', meshid: 'mesh/domain/1', pmt: 'token' };
    const db = {
        changeStream: true,
        Get: function (id, callback) {
            if (id == 'pmt_token') { callback(null, [{ nodeid: oldNode._id }]); } else { callback(null, [oldNode]); }
        },
        Set: function (value) { writes.push(Object.assign({}, value)); }
    };
    const service = createPushNotifications({
        db: db,
        getWebPush: function () { return null; },
        dispatchEvent: function (targets, source, event) { events.push(event); },
        cloneSafeUser: function (user) { return user; },
        cloneSafeNode: function (node) { return Object.assign({}, node); },
        eventSource: {},
        now: function () { return 1234; }
    });
    service.removePmtFromAllOtherNodes({ _id: 'node/domain/new', domain: 'domain', pmt: 'token' });
    assert.equal(oldNode.pmt, undefined);
    assert.equal(writes[0]._id, oldNode._id);
    assert.deepEqual(writes[1], { _id: 'pmt_token', type: 'pmt', domain: 'domain', time: 1234, nodeid: 'node/domain/new' });
    assert.equal(events[0].noact, 1);
});
