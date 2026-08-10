/**
* @description Unit tests for startup database result validation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasStartupDatabaseFailure = require('../../../webserver/bootstrap/startup-data-validation.js').hasStartupDatabaseFailure;

test('valid startup database arrays continue without logging', function () {
    const messages = [];
    assert.equal(hasStartupDatabaseFailure(null, [], 'users', function () { messages.push(Array.from(arguments)); }), false);
    assert.deepEqual(messages, []);
});

test('startup database errors identify the failed collection', function () {
    const messages = [];
    assert.equal(hasStartupDatabaseFailure(new Error('offline'), [], 'meshes', function (source, message) { messages.push([source, message]); }), true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], 'web');
    assert.match(messages[0][1], /meshes/);
    assert.match(messages[0][1], /offline/);
});

test('invalid startup database results are rejected without an explicit error', function () {
    const messages = [];
    assert.equal(hasStartupDatabaseFailure(null, null, 'user groups', function (source, message) { messages.push(message); }), true);
    assert.match(messages[0], /invalid database result/);
});
