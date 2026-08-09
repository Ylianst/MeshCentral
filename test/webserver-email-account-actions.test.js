/**
* @description Unit tests for account actions initiated from email links
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createEmailAccountActions = require('../webserver/email-account-actions.js').createEmailAccountActions;

function createFixture(user) {
    const renders = [], writes = [], events = [], mails = [], redirects = [];
    const domain = { id: 'tenant', url: '/tenant/', mailserver: { mailCookieEncryptionKey: 'key', sendAccountCheckMail: function () { mails.push(Array.from(arguments)); } } };
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
        hasDatabaseFailure: function (error, users) { return (error != null) || !Array.isArray(users); },
        hasOtherVerifiedUser: function (users, id) { return users.some(function (value) { return value._id !== id; }); },
        hasEmailLinkCookie: function (query) { return (query != null) && (query.c != null); },
        hasAccountEmailRequest: function (request) { return (request.session != null) && (request.body != null); },
        resolveAccountEmail: function (request) { return request.body.email || request.session.temail; },
        validateEmail: function (email) { return typeof email == 'string'; },
        checkEmail: function (email) { return email.includes('@'); },
        getQueryPortion: function () { return '?key=value'; },
        handleRootRequestEx: function () { },
        getLanguageCodes: function () { return ['en']; },
        checkUserIpAddress: function () { return domain; },
        decodeCookie: function () { return null; },
        hashPassword: function () { },
        now: function () { return 5000; }
    });
    return { service: service, state: state, domain: domain, renders: renders, writes: writes, events: events, mails: mails, redirects: redirects };
}

test('password reset links require confirmation before changing credentials', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'alice@example.com', emailVerified: true };
    const fixture = createFixture(user);
    fixture.service.handlePasswordReset({ query: {} }, {}, { id: 'tenant', url: '/tenant/' }, user);
    assert.equal(fixture.renders[0].msgid, 14);
    assert.equal(fixture.writes.length, 0);
});

test('missing email cookies render the invalid link page', function () {
    const user = { _id: 'user/tenant/alice' };
    const fixture = createFixture(user);
    fixture.service.handleCheckMailRequest({ query: {}, headers: {} }, { sendStatus: function () { } });
    assert.equal(fixture.renders[0].msgid, 10);
});

test('account email checks accept the fallback address stored in session', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'old@example.com', groups: ['staff'] };
    const fixture = createFixture(user);
    fixture.state.db.GetUserWithVerifiedEmail = function (domainId, email, callback) { callback(null, []); };
    const req = { query: {}, headers: {}, body: {}, session: { cuserid: user._id, temail: 'new@example.com' } };
    const res = { redirect: function (url) { fixture.redirects.push(url); }, sendStatus: function () { } };
    fixture.service.handleCheckAccountEmailRequest(req, res, false);
    assert.equal(user.email, 'new@example.com');
    assert.equal(req.session.messageid, 2);
    assert.equal(req.session.cuserid, undefined);
    assert.equal(fixture.mails.length, 1);
    assert.deepEqual(fixture.redirects, ['/tenant/?key=value']);
});

test('email verification persists and announces the verified account', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'alice@example.com', emailVerified: false };
    const fixture = createFixture(user);
    fixture.state.db.GetUserWithVerifiedEmail = function (domainId, email, callback) { callback(null, []); };
    fixture.service.handleEmailVerification({ headers: { 'user-agent': 'test' } }, {}, { id: 'tenant', url: '/tenant/' }, user);
    assert.equal(user.emailVerified, true);
    assert.equal(fixture.writes.length, 1);
    assert.deepEqual(fixture.events.map(function (event) { return event.action; }), ['accountchange', 'notify']);
    assert.equal(fixture.renders[0].msgid, 6);
});

test('email verification rejects an address used by another account', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice', email: 'shared@example.com', emailVerified: false };
    const fixture = createFixture(user);
    fixture.state.db.GetUserWithVerifiedEmail = function (domainId, email, callback) { callback(null, [{ _id: 'user/tenant/bob' }]); };
    fixture.service.handleEmailVerification({ headers: {} }, {}, { id: 'tenant', url: '/tenant/' }, user);
    assert.equal(user.emailVerified, false);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.renders[0].msgid, 5);
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
