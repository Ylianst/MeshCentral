/**
* @description Unit tests for Intel AMT relay WebSockets
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../webserver/relay-websocket.js').hasDatabaseFailure;
const isSelectedDeviceGroup = require('../webserver/relay-websocket.js').isSelectedDeviceGroup;
const openRecordingFile = require('../webserver/relay-websocket.js').openRecordingFile;
const closeRecordingFile = require('../webserver/relay-websocket.js').closeRecordingFile;
const setupSessionRecording = require('../webserver/relay-websocket.js').setupSessionRecording;
const routeToPeerServer = require('../webserver/relay-websocket.js').routeToPeerServer;
const finishSessionRecording = require('../webserver/relay-websocket.js').finishSessionRecording;
const logRelaySessionEnd = require('../webserver/relay-websocket.js').logRelaySessionEnd;
const writeOrQueueCiraRelayData = require('../webserver/relay-websocket.js').writeOrQueueCiraRelayData;
const flushCiraRelayData = require('../webserver/relay-websocket.js').flushCiraRelayData;
const closeCiraRelayTransport = require('../webserver/relay-websocket.js').closeCiraRelayTransport;
const setupDirectRelayTransport = require('../webserver/relay-websocket.js').setupDirectRelayTransport;
const recordRelayStartAndUserAccess = require('../webserver/relay-websocket.js').recordRelayStartAndUserAccess;

test('relay node lookups reject database failures and missing result arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('relay recording safely handles removed and unselected device groups', function () {
    assert.equal(isSelectedDeviceGroup(null), false);
    assert.equal(isSelectedDeviceGroup({}), false);
    assert.equal(isSelectedDeviceGroup({ flags: 0 }), false);
    assert.equal(isSelectedDeviceGroup({ flags: 4 }), true);
    assert.equal(isSelectedDeviceGroup({ flags: 5 }), true);
});

test('relay recording file failures are contained', function () {
    const errors = [];
    assert.equal(openRecordingFile({ openSync: function (filename, mode) { assert.equal(mode, 'w'); return 42; } }, 'session.mcrec', function () { }), 42);
    assert.equal(openRecordingFile({ openSync: function () { throw new Error('permission denied'); } }, 'session.mcrec', function (error) { errors.push(error); }), null);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /permission denied/);
});

test('relay recording descriptors close with callbacks and contained errors', function () {
    const errors = [];
    closeRecordingFile({ close: function (descriptor, callback) { assert.equal(descriptor, 7); callback(null); } }, 7, function (error) { errors.push(error); });
    closeRecordingFile({ close: function (descriptor, callback) { callback(new Error('close failed')); } }, 8, function (error) { errors.push(error); });
    closeRecordingFile({ close: function () { throw new Error('close threw'); } }, 9, function (error) { errors.push(error); });
    assert.deepEqual(errors.map(function (error) { return error.message; }), ['close failed', 'close threw']);
});

test('relay recording creates metadata and signals recorded AMT sessions', function () {
    const entries = [], sent = [];
    const state = {
        meshes: {},
        common: { zeroPad: function (value) { return String(value).padStart(2, '0'); } },
        fs: { mkdirSync: function () { }, openSync: function () { return 7; } },
        path: { join: function () { return Array.from(arguments).join('/'); } },
        meshRelayHandler: { recordingEntry: function () { entries.push(Array.from(arguments)); } }
    };
    const parent = { common: { makeFilename: function (value) { return value; } }, recordpath: 'records', debug: function () { } };
    const websocket = { id: 'session1', send: function (data) { sent.push(data); } };
    const node = { _id: 'node/tenant/node1', meshid: 'mesh/tenant/main', name: 'Desktop', host: '192.0.2.10', icon: 1 };
    setupSessionRecording({ state: state, parent: parent, domain: { id: 'tenant', sessionrecording: true }, user: { _id: 'user/tenant/alice', name: 'Alice' }, websocket: websocket, request: { clientIp: '192.0.2.1', query: { p: 2 } }, node: node, ciraConnection: { remoteAddr: '192.0.2.20' }, connectivity: 2 });
    assert.equal(websocket.logfile.fd, 7);
    assert.equal(websocket.logfile.nodeid, node._id);
    const metadata = JSON.parse(entries[0][3]);
    assert.equal(metadata.protocol, 101);
    assert.equal(metadata.ipaddr2, '192.0.2.20');
    assert.equal(sent[0][0], 0xF0);
});

test('relay recording skips removed selected device groups', function () {
    const websocket = { id: 'session1' };
    setupSessionRecording({
        state: { meshes: {} },
        parent: {},
        domain: { id: 'tenant', sessionrecording: { onlyselecteddevicegroups: true } },
        user: {},
        websocket: websocket,
        request: { query: {} },
        node: { meshid: 'mesh/tenant/missing' },
        connectivity: 0
    });
    assert.equal(websocket.logfile, undefined);
});

test('relay routing forwards remote CIRA and direct connections to peers', function () {
    const calls = [];
    const parent = {
        serverId: 'local',
        multiServer: { createPeerRelay: function () { calls.push(Array.from(arguments)); } },
        GetRoutingServerId: function (nodeId, connectionType) { return (connectionType == 2) ? null : { serverid: 'remote' }; },
        debug: function () { }
    };
    const ws = {}, req = { query: { host: 'node//node1' } }, user = {};
    assert.equal(routeToPeerServer(parent, ws, req, user, null), true);
    assert.equal(calls[0][2], 'remote');
    assert.equal(calls[0][3], user);
});

test('relay routing prevents peer cookies from hopping again', function () {
    const parent = { multiServer: { createPeerRelay: function () { throw new Error('unexpected'); } } };
    assert.equal(routeToPeerServer(parent, {}, { query: {} }, {}, { ps: 1 }), false);
});

test('relay recording finalization is idempotent across close and error events', function () {
    const entries = [], events = [];
    const logfile = { fd: 7, filename: 'records/session.mcrec', startTime: Date.now() - 10000, size: 25, nodeid: 'node//node1', meshid: 'mesh//main', name: 'Desktop', req: { query: { p: 2 } } };
    const websocket = { logfile: logfile };
    const state = {
        fs: { close: function (fd, callback) { callback(null); } },
        meshes: { 'mesh//main': { _id: 'mesh//main', name: 'Main' } },
        meshRelayHandler: { recordingEntry: function (log, type, flags, data, callback, ws) { entries.push(log); callback(log, ws); } }
    };
    const parent = { path: { basename: function () { return 'session.mcrec'; } }, debug: function () { }, DispatchEvent: function () { events.push(Array.from(arguments)); } };
    const options = { state: state, parent: parent, domain: { id: '' }, user: { _id: 'user//alice' }, websocket: websocket, delayAdjustmentSeconds: 5, schedule: function (callback) { callback(); } };
    assert.equal(finishSessionRecording(options), true);
    assert.equal(finishSessionRecording(options), false);
    assert.equal(entries.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0][2].protocol, 101);
    assert.equal(websocket.logfile, undefined);
});

test('relay session end logs include duration and routed address', function () {
    const events = [];
    const parent = { DispatchEvent: function () { events.push(Array.from(arguments)); } };
    const websocket = { id: 'session1', time: Date.now() - 2500 };
    const request = { clientIp: '192.0.2.1', query: { p: 2 } };
    const node = { _id: 'node//node1', meshid: 'mesh//main', host: '192.0.2.10' };
    assert.equal(logRelaySessionEnd({}, parent, { id: '' }, { _id: 'user//alice', name: 'Alice' }, websocket, request, node, { remoteAddr: '192.0.2.20' }, 2), true);
    assert.equal(logRelaySessionEnd({}, parent, { id: '' }, { _id: 'user//alice', name: 'Alice' }, websocket, request, node, { remoteAddr: '192.0.2.20' }, 2), false);
    assert.equal(events.length, 1);
    assert.equal(events[0][2].msgid, 9);
    assert.equal(events[0][2].msgArgs[2], '192.0.2.20');
    assert.equal(events[0][2].protocol, 101);
});

test('pending TLS CIRA data is retained until the relay client is ready', function () {
    const writes = [];
    const websocket = {};
    assert.equal(writeOrQueueCiraRelayData(websocket, Buffer.from('first')), true);
    assert.equal(writeOrQueueCiraRelayData(websocket, Buffer.from('second')), true);
    assert.equal(websocket.pendingRelayData.length, 2);
    websocket.forwardclient = { write: function (data) { writes.push(data.toString()); } };
    assert.equal(flushCiraRelayData(websocket), 2);
    assert.deepEqual(writes, ['first', 'second']);
    assert.equal(websocket.pendingRelayData, undefined);
});

test('closing pending TLS CIRA relays releases their channel and rejects queued data', function () {
    var closes = 0;
    const websocket = { pendingRelayData: [Buffer.from('pending')], forwardchannel: { close: function () { closes++; } } };
    closeCiraRelayTransport(websocket);
    assert.equal(closes, 1);
    assert.equal(websocket.forwardchannel, undefined);
    assert.equal(websocket.pendingRelayData, undefined);
    assert.equal(writeOrQueueCiraRelayData(websocket, Buffer.from('late')), false);
});

test('direct relay transport connects plain AMT sockets and installs HTTP interception', function () {
    const socketHandlers = {}, websocketHandlers = {}, connections = [], interceptors = [], resumes = [];
    function FakeSocket() { }
    FakeSocket.prototype.setEncoding = function (encoding) { this.encoding = encoding; };
    FakeSocket.prototype.on = function (event, handler) { socketHandlers[event] = handler; };
    FakeSocket.prototype.connect = function (port, host, callback) { connections.push([port, host]); callback(); };
    const state = {
        parent: { debugLevel: 0 },
        net: { Socket: FakeSocket },
        interceptor: { CreateHttpInterceptor: function (options) { interceptors.push(options); return { processBrowserData: function (data) { return data; }, processAmtData: function (data) { return data; } }; } },
        meshRelayHandler: { recordingEntry: function () { throw new Error('unexpected recording'); } }
    };
    const websocket = {
        _socket: { resume: function () { resumes.push(true); } },
        on: function (event, handler) { websocketHandlers[event] = handler; },
        send: function () { },
        close: function () { }
    };
    const node = { host: '192.0.2.10', intelamt: { tls: 0, user: 'admin', pass: 'secret' } };
    setupDirectRelayTransport({ state: state, parent: { debug: function () { } }, domain: {}, user: { name: 'Alice' }, websocket: websocket, request: { clientIp: '192.0.2.1', query: { host: 'node//node1', p: 1 } }, node: node, ciraConnection: null, connectivity: 4, tlsConstants: {} });
    assert.deepEqual(connections, [[16992, '192.0.2.10']]);
    assert.deepEqual(interceptors, [{ host: '192.0.2.10', port: 16992, user: 'admin', pass: 'secret' }]);
    assert.equal(websocket.forwardclient.encoding, 'binary');
    assert.equal(websocket.forwardclient.xstate, 1);
    assert.equal(websocket.forwardclient.forwardwsocket, websocket);
    assert.equal(resumes.length, 2);
    assert.equal(typeof websocketHandlers.message, 'function');
    assert.equal(typeof socketHandlers.data, 'function');
});

test('relay starts log redirection sessions and refresh stale user access', function () {
    const events = [], writes = [];
    const parent = { db: { changeStream: false, SetUser: function (user) { writes.push(user); } }, DispatchEvent: function () { events.push(Array.from(arguments)); } };
    const state = { CloneSafeUser: function (user) { return { _id: user._id }; } };
    const user = { _id: 'user//alice', name: 'Alice', access: 1, groups: ['staff'] };
    recordRelayStartAndUserAccess(state, parent, { id: '' }, user, { id: 'session1' }, { clientIp: '192.0.2.1', query: { p: 2 } }, { _id: 'node//node1', host: '192.0.2.10' }, null, 4);
    assert.equal(writes.length, 1);
    assert.equal(events[0][2].msgid, 13);
    assert.equal(events[0][2].msgArgs[2], '192.0.2.10');
    assert.deepEqual(events[1][0], ['*', 'server-users', user._id, 'server-users:staff']);
});
