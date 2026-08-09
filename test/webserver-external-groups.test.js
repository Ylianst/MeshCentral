/**
* @description Unit tests for external user-group synchronization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('crypto');
const createExternalGroups = require('../webserver/external-groups.js').createExternalGroups;

function groupId(domainId, name) {
    return 'ugrp/' + domainId + '/' + crypto.createHash('sha384').update(name).digest('base64').replace(/\+/g, '@').replace(/\//g, '$');
}

function createFixture(userGroups) {
    const writes = [];
    const events = [];
    const logs = [];
    const db = {
        changeStream: false,
        Set: function (value) { writes.push(['Set', value._id]); },
        SetUser: function (value) { writes.push(['SetUser', value._id]); }
    };
    const service = createExternalGroups({
        crypto: crypto,
        userGroups: userGroups,
        db: db,
        dispatchEvent: function (targets, source, event) { events.push([targets, event]); },
        authLog: function (source, message) { logs.push(message); },
        cloneSafeUser: function (user) { return { _id: user._id, name: user.name }; },
        eventSource: {}
    });
    return { service: service, writes: writes, events: events, logs: logs };
}

test('external memberships create groups and link both sides', function () {
    const userGroups = {};
    const fixture = createFixture(userGroups);
    const user = { _id: 'user/domain/alice', name: 'alice', links: {} };
    assert.equal(fixture.service.syncExternalUserGroups({ id: 'domain' }, user, ['Engineering'], 'ldap'), true);

    const id = groupId('domain', 'Engineering');
    assert.deepEqual(user.links[id], { rights: 1 });
    assert.deepEqual(userGroups[id].links[user._id], { userid: user._id, name: 'alice', rights: 1 });
    assert.ok(fixture.events.some(function (entry) { return entry[1].action == 'createusergroup'; }));
    assert.ok(fixture.logs.some(function (message) { return message.includes('Created user group Engineering'); }));
});

test('stale memberships are removed from users and groups', function () {
    const id = groupId('domain', 'Old Team');
    const user = { _id: 'user/domain/alice', name: 'alice', links: { [id]: { rights: 1 } } };
    const userGroups = { [id]: { _id: id, name: 'Old Team', membershipType: 'oidc', links: { [user._id]: { rights: 1 } } } };
    const fixture = createFixture(userGroups);
    assert.equal(fixture.service.syncExternalUserGroups({ id: 'domain' }, user, [], 'oidc'), false);
    assert.equal(user.links[id], undefined);
    assert.equal(userGroups[id].links[user._id], undefined);
    assert.ok(fixture.events.some(function (entry) { return entry[1].action == 'usergroupchange' && entry[1].msgid == 72; }));
});

test('memberships from other providers remain untouched', function () {
    const id = groupId('domain', 'LDAP Team');
    const user = { _id: 'user/domain/alice', name: 'alice', links: { [id]: { rights: 1 } } };
    const userGroups = { [id]: { _id: id, name: 'LDAP Team', membershipType: 'ldap', links: { [user._id]: { rights: 1 } } } };
    const fixture = createFixture(userGroups);
    fixture.service.syncExternalUserGroups({ id: 'domain' }, user, [], 'oidc');
    assert.deepEqual(user.links[id], { rights: 1 });
});
