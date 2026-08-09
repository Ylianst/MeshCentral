/**
* @description Unit tests for account actions initiated from email links
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createEmailAccountActions = require('../webserver/email-account-actions.js').createEmailAccountActions;

function createFixture(user) {
    const renders = [], writes = [], events = [];
    const state = {
        users: { [user._id]: user },
        crypto: {},
        db: { changeStream: false, SetUser: function (value) { writes.push(value); } },
        CloneSafeUser: function (value) { return { _id: value._id }; }
    };
    const service = createEmailAccountActions({
        state: state,
        parent: { debug: function () { }, authLog: function () { }, DispatchEvent: function (targets, source, event) { events.push(event); } },
        render: function (req, res, page, args) { renders.push(args); },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; },
        escapeHtml: function (value) { return value; },
        createTemporaryPassword: function (crypto, hash, callback) { callback(null, { password: 'temporary', salt: 'salt', hash: 'hash' }); },
        getActiveUser: function (users, id) { return users[id] || null; },
        hashPassword: function () { },
        now: function () { return 5000; }
    });
    return { service: service, state: state, renders: renders, writes: writes, events: events };
}

test('password reset links require confirmation before changing credentials', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'alice@example.com', emailVerified: true };
    const fixture = createFixture(user);
    fixture.service.handlePasswordReset({ query: {} }, {}, { id: 'tenant', url: '/tenant/' }, user);
    assert.equal(fixture.renders[0].msgid, 14);
    assert.equal(fixture.writes.length, 0);
});

test('confirmed password resets persist the temporary credentials', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'alice@example.com', emailVerified: true, passtype: 1, passhint: 'old' };
    const fixture = createFixture(user);
    fixture.service.handlePasswordReset({ query: { confirm: 1 } }, {}, { id: 'tenant', url: '/tenant/' }, user);
    assert.equal(user.salt, 'salt');
    assert.equal(user.hash, 'hash');
    assert.equal(user.passchange, 5);
    assert.equal(user.passtype, undefined);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.events[0].action, 'accountchange');
    assert.equal(fixture.renders[0].msgid, 8);
});
