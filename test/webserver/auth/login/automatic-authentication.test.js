/**
* @description Unit tests for automatic web authentication modes
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAutomaticAuthentication = require('../../../../webserver/auth/login/automatic-authentication.js').createAutomaticAuthentication;

function createFixture(args, users, cookie) {
    const persisted = [];
    const state = { args: args || {}, users: users || {}, db: { SetUser: function (user) { persisted.push(user); } } };
    const parent = { loginCookieEncryptionKey: 'key', debug: function () { }, decodeCookie: function () { return cookie; } };
    const authenticate = createAutomaticAuthentication({ state: state, parent: parent, setSessionRandom: function (request) { request.session.x = 'random'; } });
    return { state: state, persisted: persisted, authenticate: authenticate };
}

test('no-user mode initializes the session and creates its dummy account once', function () {
    const fixture = createFixture({ nousers: true });
    const request = { clientIp: '192.0.2.1', session: { loginmode: 1, currentNode: 'old' }, query: {} };
    assert.equal(fixture.authenticate(request, { id: 'tenant' }), true);
    assert.equal(request.session.userid, 'user/tenant/~');
    assert.equal(request.session.loginmode, undefined);
    assert.equal(request.session.currentNode, undefined);
    assert.equal(request.session.ip, '192.0.2.1');
    assert.equal(fixture.persisted.length, 1);
    fixture.authenticate(request, { id: 'tenant' });
    assert.equal(fixture.persisted.length, 1);
});

test('configured default users authenticate only when their account exists', function () {
    const user = { _id: 'user/tenant/alice' };
    const fixture = createFixture({ user: 'Alice' }, { 'user/tenant/alice': user });
    const request = { clientIp: '192.0.2.1', session: {}, query: {} };
    assert.equal(fixture.authenticate(request, { id: 'tenant' }), true);
    assert.equal(request.session.userid, user._id);
});

test('valid special login cookies initialize same-domain sessions', function () {
    const fixture = createFixture({}, {}, { a: 3, u: 'user/tenant/alice' });
    const request = { clientIp: '192.0.2.1', session: {}, query: { login: 'encoded' } };
    assert.equal(fixture.authenticate(request, { id: 'tenant' }), true);
    assert.equal(request.session.userid, 'user/tenant/alice');
});

test('invalid login cookies consume the automatic authentication branch', function () {
    const fixture = createFixture({}, {}, { a: 3, u: 'user/other/alice' });
    const request = { session: {}, query: { login: 'encoded' } };
    assert.equal(fixture.authenticate(request, { id: 'tenant' }), true);
    assert.equal(request.session.userid, undefined);
});
