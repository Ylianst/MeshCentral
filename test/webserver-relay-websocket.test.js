/**
* @description Unit tests for Intel AMT relay WebSockets
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../webserver/relay-websocket.js').hasDatabaseFailure;
const isSelectedDeviceGroup = require('../webserver/relay-websocket.js').isSelectedDeviceGroup;

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
