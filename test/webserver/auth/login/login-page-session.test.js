/**
* @description Unit tests for login-page transient session state
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const consumeLoginPageSession = require('../../../../webserver/auth/login/login-page-session.js').consumeLoginPageSession;

function uniqueArray(values) { return Array.from(new Set(values)); }

test('login mode, message and configured password hints are consumed once', function () {
    const request = { session: { loginmode: 2, messageid: 9, passhint: '<hint>', flash: {} } };
    const state = consumeLoginPageSession(request, { passwordrequirements: { hint: true } }, function (value) { return value.replace(/</g, '&lt;'); }, uniqueArray);
    assert.deepEqual(state, { loginMode: 2, messageId: 9, passwordHint: '&lt;hint>', flashErrors: [] });
    assert.deepEqual(request.session, { flash: {} });
});

test('recovery messages expose hints even when hints are not generally enabled', function () {
    const request = { session: { loginmode: 1, messageid: 5, passhint: 'recovery', flash: {} } };
    const state = consumeLoginPageSession(request, {}, function (value) { return value; }, uniqueArray);
    assert.equal(state.passwordHint, 'recovery');
});

test('passport flash errors are deduplicated and cleared', function () {
    const request = { session: { flash: { error: ['denied', 'denied', 'expired'] } } };
    const state = consumeLoginPageSession(request, {}, function (value) { return value; }, uniqueArray);
    assert.deepEqual(state.flashErrors, ['denied', 'expired']);
    assert.equal(request.session.flash, null);
});
