/**
* @description Unit tests for authenticated account management
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAccountManagement = require('../webserver/account-management.js').createAccountManagement;

function createFixture(settings) {
    settings = settings || {};
    const redirects = [], passwordChecks = [], historyChecks = [], hashes = [], writes = [], events = [];
    const userId = 'user/tenant/alice';
    const user = { _id: userId, name: 'Alice', siteadmin: 0, salt: 'old-salt', hash: 'old-hash', passchange: 10, passtype: 1 };
    const domain = { id: 'tenant', url: '/tenant/', passwordrequirements: settings.passwordRequirements };
    const state = {
        users: { [userId]: user },
        db: { SetUser: function (value) { writes.push(value); } },
        checkUserPassword: function (requestDomain, requestUser, password, callback) { passwordChecks.push(password); callback(settings.currentPasswordValid === true); },
        checkOldUserPasswords: function (requestDomain, requestUser, password, callback) { historyChecks.push(password); callback(settings.historyResult || 0); }
    };
    const parent = {
        debug: function () { },
        DispatchEvent: function (targets, source, event) { events.push(event); }
    };
    const service = createAccountManagement({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return domain; },
        getQueryPortion: function () { return '?key=value'; },
        renderRoot: function () { },
        hashPassword: function (password, callback) { hashes.push(password); callback(null, 'new-salt', 'new-hash'); },
        now: function () { return 20000; }
    });
    const req = { query: {}, session: { userid: userId }, body: { apassword0: 'current', apassword1: 'replacement', apassword2: 'replacement' } };
    const res = { redirect: function (url) { redirects.push(url); }, sendStatus: function (status) { this.status = status; } };
    return { service: service, req: req, res: res, user: user, redirects: redirects, passwordChecks: passwordChecks, historyChecks: historyChecks, hashes: hashes, writes: writes, events: events };
}

test('invalid current passwords complete the request without checking password history', function () {
    const fixture = createFixture({ currentPasswordValid: false });
    fixture.service.handlePasswordChangeRequest(fixture.req, fixture.res, false);
    assert.deepEqual(fixture.passwordChecks, ['current']);
    assert.deepEqual(fixture.historyChecks, []);
    assert.deepEqual(fixture.hashes, []);
    assert.deepEqual(fixture.redirects, ['/tenant/?key=value']);
});

test('password history checks receive the requested new password', function () {
    const fixture = createFixture({ currentPasswordValid: true, historyResult: 1 });
    fixture.service.handlePasswordChangeRequest(fixture.req, fixture.res, false);
    assert.deepEqual(fixture.passwordChecks, ['current']);
    assert.deepEqual(fixture.historyChecks, ['replacement']);
    assert.deepEqual(fixture.hashes, []);
    assert.equal(fixture.redirects.length, 1);
});

test('valid password changes persist hashes, history and account events', function () {
    const fixture = createFixture({ currentPasswordValid: true, passwordRequirements: { hint: true, oldpasswordban: 1 } });
    fixture.req.body.apasswordhint = 'new hint';
    fixture.service.handlePasswordChangeRequest(fixture.req, fixture.res, false);
    assert.deepEqual(fixture.hashes, ['replacement']);
    assert.equal(fixture.user.salt, 'new-salt');
    assert.equal(fixture.user.hash, 'new-hash');
    assert.equal(fixture.user.passhint, 'new hint');
    assert.deepEqual(fixture.user.oldpasswords, [{ salt: 'old-salt', hash: 'old-hash', start: 10, end: 20 }]);
    assert.equal(fixture.user.passchange, 20);
    assert.equal(fixture.req.session.viewmode, 2);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.events[0].action, 'passchange');
});
