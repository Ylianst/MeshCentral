/**
* @description Unit tests for Intel AMT relay WebSockets
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../webserver/relay-websocket.js').hasDatabaseFailure;

test('relay node lookups reject database failures and missing result arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});
