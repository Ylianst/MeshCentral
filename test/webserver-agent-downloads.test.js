/**
* @description Unit tests for Mesh agent and companion tool downloads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getSessionUser = require('../webserver/agent-downloads.js').getSessionUser;
const hasDatabaseFailure = require('../webserver/agent-downloads.js').hasDatabaseFailure;

test('agent tool downloads safely resolve optional session users', function () {
    const users = { 'user//alice': { name: 'Alice' } };
    assert.equal(getSessionUser(users, null), null);
    assert.equal(getSessionUser(users, {}), null);
    assert.equal(getSessionUser(users, { session: null }), null);
    assert.equal(getSessionUser(users, { session: {} }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//missing' } }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//alice' } }), users['user//alice']);
});

test('agent action node lookups reject database failures and missing arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});
