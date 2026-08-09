/**
* @description Unit tests for SSO account lifecycle operations
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSsoAccounts = require('../webserver/sso-accounts.js').createSsoAccounts;

test('completing an SSO login establishes the session and dispatches its event', function () {
    const events = [], randomRequests = [];
    const state = {
        getUserAgentInfo: function () { return { browserStr: 'Browser', osStr: 'Operating System' }; },
        CloneSafeUser: function (user) { return { _id: user._id, name: user.name }; }
    };
    const parent = { DispatchEvent: function (targets, source, event) { events.push({ targets: targets, source: source, event: event }); } };
    const accounts = createSsoAccounts({ state: state, parent: parent, setSessionRandom: function (req) { randomRequests.push(req); } });
    const req = { session: {}, clientIp: '192.0.2.5', headers: { 'user-agent': 'test-agent' } };
    const user = { _id: 'user/tenant/alice', name: 'Alice', groups: ['staff', 'west'] };

    accounts.completeSsoLogin(req, { id: 'tenant' }, user);

    assert.equal(req.session.userid, user._id);
    assert.deepEqual(randomRequests, [req]);
    assert.deepEqual(events[0].targets, ['*', 'server-users', user._id, 'server-users:staff', 'server-users:west']);
    assert.equal(events[0].source, state);
    assert.equal(events[0].event.twoFactorType, 'sso');
    assert.deepEqual(events[0].event.msgArgs, ['192.0.2.5', 'Browser', 'Operating System']);
});

test('existing SSO accounts apply profile, group and administrator changes', function () {
    const events = [], writes = [], syncs = [], logs = [];
    const state = {
        db: { changeStream: false, SetUser: function (user) { writes.push(user); } },
        CloneSafeUser: function (user) { return { _id: user._id, name: user.name }; }
    };
    const parent = {
        authLog: function (source, message) { logs.push([source, message]); },
        DispatchEvent: function (targets, source, event) { events.push(event); }
    };
    const accounts = createSsoAccounts({
        state: state,
        parent: parent,
        setSessionRandom: function () { },
        syncExternalUserGroups: function (domain, user, memberships, strategy) { syncs.push([domain, user, memberships, strategy]); },
        isEmailVerified: function (requestUser) { return requestUser.email_verified !== false; }
    });
    const domain = { id: 'tenant' };
    const user = { _id: 'user/tenant/alice', name: 'Old name', email: 'old@example.com', siteadmin: 0 };
    const requestUser = { sid: 'alice', strategy: 'oidc', name: 'Alice', email: 'new@example.com', email_verified: false };
    const groups = { enabled: true, syncEnabled: true, syncMemberships: ['staff'], siteAdminEnabled: true, grantAdmin: true, revokeAdmin: true };

    assert.equal(accounts.updateExistingAccount(domain, user, requestUser, groups), true);
    assert.equal(user.name, 'Alice');
    assert.equal(user.emailVerified, false);
    assert.equal(user.siteadmin, 0xFFFFFFFF);
    assert.equal(writes.length, 1);
    assert.deepEqual(syncs[0], [domain, user, ['staff'], 'oidc']);
    assert.equal(events[0].action, 'accountchange');
    assert.ok(logs.length >= 2);
});
