/**
* @description Unit tests for Windows SSPI web authentication
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSspiAuthentication = require('../../../../webserver/auth/sso/sspi-authentication.js').createSspiAuthentication;

function createFixture() {
    const statusCodes = [], users = [], groups = [], events = [], authLogs = [];
    const state = { users: {}, userGroups: {}, common: { validateStrArray: Array.isArray }, CloneSafeUser: function (user) { return Object.assign({}, user); } };
    const database = { SetUser: function (user) { users.push(user); }, Set: function (group) { groups.push(group); } };
    const parent = { debug: function () { }, authLog: function () { authLogs.push(Array.from(arguments)); }, DispatchEvent: function () { events.push(Array.from(arguments)); } };
    const authenticate = createSspiAuthentication({ state: state, parent: parent, database: database, setSessionRandom: function (request) { request.session.x = 'random'; }, now: function () { return 2000000; } });
    return { state: state, database: database, authenticate: authenticate, users: users, groups: groups, events: events, authLogs: authLogs, response: { sendStatus: function (code) { statusCodes.push(code); } }, statusCodes: statusCodes };
}

test('SSPI requests without a complete Windows identity return not found', function () {
    const fixture = createFixture();
    const result = fixture.authenticate({ connection: {}, session: {} }, fixture.response, { id: 'tenant' });
    assert.equal(result, false);
    assert.deepEqual(fixture.statusCodes, [404]);
});

test('existing SSPI users initialize the session without reprovisioning', function () {
    const fixture = createFixture();
    fixture.state.users['user/tenant/alice'] = { _id: 'user/tenant/alice', sid: 'S-1', domain: 'tenant' };
    const request = { connection: { user: 'Alice', userSid: 'S-1', userGroups: ['Users'], remotePort: 1234 }, session: { currentNode: 'old' }, clientIp: '192.0.2.1', headers: { 'user-agent': 'test' } };
    assert.equal(fixture.authenticate(request, fixture.response, { id: 'tenant' }), true);
    assert.equal(request.session.userid, 'user/tenant/alice');
    assert.equal(request.session.currentNode, undefined);
    assert.equal(request.session.x, 'random');
    assert.equal(fixture.users.length, 0);
    assert.equal(fixture.authLogs.length, 1);
});

test('new SSPI users are persisted, made first-domain admin and joined to groups', function () {
    const fixture = createFixture();
    fixture.state.userGroups['ugrp/tenant/operators'] = { _id: 'ugrp/tenant/operators', name: 'Operators', links: {} };
    const request = { connection: { user: 'Alice', userSid: 'S-1', userGroups: [], remotePort: 1234 }, session: {}, clientIp: '192.0.2.1', headers: {} };
    const domain = { id: 'tenant', newaccountsrights: 1, newaccountrealms: ['realm'], newaccountsusergroups: ['operators'] };
    assert.equal(fixture.authenticate(request, fixture.response, domain), true);
    const user = fixture.state.users['user/tenant/alice'];
    assert.equal(user.siteadmin, 4294967295);
    assert.deepEqual(user.groups, ['realm']);
    assert.deepEqual(user.links, { 'ugrp/tenant/operators': { rights: 1 } });
    assert.equal(fixture.groups.length, 1);
    assert.equal(fixture.users.length, 1);
    assert.equal(fixture.events.length, 2);
});
