/**
* @description Unit tests for Intel AMT event requests
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../webserver/amt-events.js').hasDatabaseFailure;
const hasRandomBytesFailure = require('../webserver/amt-events.js').hasRandomBytesFailure;

test('AMT event node lookups safely reject database failures', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('AMT authentication challenges reject random byte generation failures', function () {
    assert.equal(hasRandomBytesFailure(new Error('entropy unavailable'), null), true);
    assert.equal(hasRandomBytesFailure(null, null), true);
    assert.equal(hasRandomBytesFailure(null, Buffer.alloc(48)), false);
});
