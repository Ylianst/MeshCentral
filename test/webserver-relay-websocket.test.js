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
