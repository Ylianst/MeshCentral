/**
* @description Unit tests for login request orchestration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginRequestHandler = require('../../../../webserver/auth/login/login-request.js').createLoginRequestHandler;

function createFixture(userPresent) {
    const calls = { completions: [], failures: [] };
    const user = { _id: 'user/tenant/alice', name: 'Alice', emailVerified: true };
    const state = {
        users: userPresent ? { [user._id]: user } : {}, args: {},
        parent: { certificates: { CommonName: 'server.example.com' } },
        checkAllowLogin: function () { return true; },
        authenticate: function (username, password, domain, callback) { callback(null, user._id, null, {}); }
    };
    const parent = { config: { settings: {} }, debug: function () { } };
    const handler = createLoginRequestHandler({
        state: state, parent: parent,
        checkUserIpAddress: function () { return { id: 'tenant', url: '/tenant/' }; }, getQueryPortion: function () { return ''; }, handleRootRequestEx: function () { },
        checkUserOneTimePasswordSkip: function () { return null; }, handleLoginTwoFactor: function () { return false; },
        completeLoginRequest: function () { calls.completions.push(Array.from(arguments)); },
        handleLoginFailure: function () { calls.failures.push(Array.from(arguments)); }
    });
    const req = { query: {}, body: { username: 'Alice', password: 'secret' }, session: {} };
    return { handler: handler, req: req, res: { sendStatus: function () { } }, user: user, calls: calls };
}

test('basic authenticated logins reach session completion', function () {
    const fixture = createFixture(true);
    fixture.handler(fixture.req, fixture.res, false);
    assert.equal(fixture.calls.completions.length, 1);
    assert.equal(fixture.calls.completions[0][3], fixture.user);
    assert.equal(fixture.calls.failures.length, 0);
});

test('accounts removed during authentication use the failed-login path', function () {
    const fixture = createFixture(false);
    fixture.handler(fixture.req, fixture.res, false);
    assert.equal(fixture.calls.completions.length, 0);
    assert.equal(fixture.calls.failures.length, 1);
    assert.equal(fixture.calls.failures[0][3], 'Alice');
});
