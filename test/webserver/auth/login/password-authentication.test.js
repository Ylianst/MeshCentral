/**
* @description Unit tests for token, LDAP and local password authentication
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPasswordAuthentication = require('../../../../webserver/auth/login/password-authentication.js').createPasswordAuthentication;

function createFixture(settings) {
    settings = settings || {};
    const savedUsers = [];
    const removed = [];
    const users = settings.users || {};
    const db = {
        changeStream: false,
        Get: function (id, callback) { callback(null, settings.loginTokens || []); },
        Remove: function (id) { removed.push(id); },
        Set: function () { },
        SetUser: function (user) { savedUsers.push(user); }
    };
    const state = {
        users: users,
        userGroups: {},
        fs: { appendFile: function () { } },
        db: db,
        common: { validateStrArray: function (value) { return Array.isArray(value); } },
        CloneSafeUser: function (user) { return { name: user.name }; }
    };
    const parent = { db: db, debug: function () { }, authLog: function () { }, DispatchEvent: function () { }, config: { domains: {} } };
    state.parent = parent;
    const passModule = {
        hash: function (password, salt, callback) {
            if (typeof salt == 'function') { callback = salt; callback(null, 'new-salt', 'new-hash'); return; }
            callback(null, password === settings.acceptedPassword ? settings.expectedHash : 'wrong-hash');
        },
        iishash: function (type, password, salt, callback) { callback(null, settings.expectedHash); }
    };
    const service = createPasswordAuthentication({
        state: state,
        parent: parent,
        db: db,
        assembleStringFromObject: function () { return ''; },
        syncExternalUserGroups: function () { return false; },
        require: function (name) { if (name === './pass') return passModule; throw new Error('Unexpected module: ' + name); }
    });
    return { service: service, state: state, db: db, savedUsers: savedUsers, removed: removed };
}

function authenticate(service, name, password, domain) {
    return new Promise(function (resolve) { service.authenticate(name, password, domain, function () { resolve(Array.from(arguments)); }); });
}

test('rejects invalid authentication fields before accessing storage', async function () {
    const fixture = createFixture();
    const result = await authenticate(fixture.service, null, 'password', { id: 'tenant' });
    assert.match(result[0].message, /invalid fields/);
});

test('local password hashes authenticate users and return password hints on failure', async function () {
    const user = { _id: 'user/tenant/alice', name: 'alice', salt: 'salt', hash: 'stored-hash', passhint: 'hint' };
    const fixture = createFixture({ users: { 'user/tenant/alice': user }, acceptedPassword: 'correct', expectedHash: 'stored-hash' });
    const success = await authenticate(fixture.service, 'Alice', 'correct', { id: 'tenant' });
    assert.deepEqual(success, [null, user._id]);
    const failure = await authenticate(fixture.service, 'Alice', 'wrong', { id: 'tenant' });
    assert.match(failure[0].message, /invalid password/);
    assert.equal(failure[2], 'hint');
});

test('login tokens return their metadata and enforce expiry', async function () {
    const user = { _id: 'user/tenant/alice', name: 'alice' };
    const validToken = { userid: user._id, salt: 'salt', hash: 'stored-hash', expire: 0, name: 'automation', tokenUser: 'issuer' };
    const valid = createFixture({ users: { [user._id]: user }, loginTokens: [validToken], acceptedPassword: 'secret', expectedHash: 'stored-hash' });
    const success = await authenticate(valid.service, '~t:id', 'secret', { id: 'tenant' });
    assert.deepEqual(success, [null, user._id, null, { tokenName: 'automation', tokenUser: 'issuer' }]);

    const expired = createFixture({ users: { [user._id]: user }, loginTokens: [Object.assign({}, validToken, { expire: 1 })], acceptedPassword: 'secret', expectedHash: 'stored-hash' });
    const failure = await authenticate(expired.service, '~t:id', 'secret', { id: 'tenant' });
    assert.match(failure[0].message, /expired/);
});

test('test LDAP mode synchronizes an existing user without loading LDAP modules', async function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', realname: 'alice', email: 'alice@example.com', emailVerified: true, domain: 'tenant' };
    const fixture = createFixture({ users: { [user._id]: user } });
    const domain = { id: 'tenant', auth: 'ldap', ldapoptions: { url: 'test', alice: { displayName: 'Alice', name: 'alice', mail: 'alice@example.com' } } };
    const result = await authenticate(fixture.service, 'Alice', 'password', domain);
    assert.deepEqual(result, [null, user._id]);
    assert.deepEqual(fixture.removed, ['im' + user._id]);
    assert.equal(fixture.savedUsers.length, 0);
});
