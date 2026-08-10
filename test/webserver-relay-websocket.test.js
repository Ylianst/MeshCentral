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
