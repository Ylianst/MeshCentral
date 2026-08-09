/**
* @description Unit tests for Mesh agent settings generation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasUserSession = require('../webserver/agent-settings.js').hasUserSession;

test('agent download authentication safely handles missing sessions', function () {
    assert.equal(hasUserSession(null), false);
    assert.equal(hasUserSession({}), false);
    assert.equal(hasUserSession({ session: null }), false);
    assert.equal(hasUserSession({ session: {} }), false);
    assert.equal(hasUserSession({ session: { userid: 'user/tenant/alice' } }), true);
});
