/**
* @description Unit tests for login-screen account creation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAccountCreation = require('../webserver/account-creation.js').createAccountCreation;
const createReservations = require('../webserver/account-creation-reservations.js').createAccountCreationReservations;

function createFixture() {
    const calls = { hashes: [], writes: [], events: [], redirects: [] };
    const state = {
        args: {}, users: {}, userGroups: {},
        common: {
            validateUsername: function () { return true; }, validateEmail: function () { return true; }, validateString: function () { return true; },
            checkPasswordRequirements: function () { return true; }, validateStrArray: function () { return false; }
        },
        db: {
            changeStream: false,
            isMaxType: function (limit, type, domain, callback) { callback(false); },
            GetUserWithVerifiedEmail: function (domain, email, callback) { callback(null, []); },
            SetUser: function (user) { calls.writes.push(user); }, Set: function () { }
        },
        getLanguageCodes: function () { return ['en']; }, CloneSafeUser: function (user) { return { _id: user._id }; },
        parent: { DispatchEvent: function () { calls.events.push(Array.from(arguments)); } }
    };
    const parent = { config: { settings: {} }, debug: function () { }, DispatchEvent: function () { calls.events.push(Array.from(arguments)); } };
    const reservations = createReservations();
    const domain = { id: 'tenant', url: '/tenant/', newaccounts: true, limits: {}, passwordrequirements: {} };
    const service = createAccountCreation({
        state: state, parent: parent, reservations: reservations,
        checkUserIpAddress: function () { return domain; }, getQueryPortion: function () { return ''; }, handleRootRequestEx: function () { },
        setSessionRandom: function (req) { req.session.x = 'random'; },
        hashPassword: function (password, callback) { calls.hashes.push(callback); },
        hasDatabaseFailure: function (error, users) { return (error != null) || !Array.isArray(users); }, now: function () { return 2000000; }
    });
    const req = { query: {}, session: {}, body: { username: 'Alice', email: 'Alice@Example.com', password1: 'secret', password2: 'secret' }, clientIp: '192.0.2.1' };
    const res = { redirect: function (url) { calls.redirects.push(url); }, sendStatus: function () { } };
    return { service: service, state: state, reservations: reservations, domain: domain, req: req, res: res, calls: calls };
}

test('new accounts remain unpublished until password hashing succeeds', function () {
    const fixture = createFixture();
    fixture.service.handleCreateAccountRequest(fixture.req, fixture.res, false);
    assert.equal(fixture.calls.hashes.length, 1);
    assert.deepEqual(fixture.state.users, {});
    assert.equal(fixture.req.session.userid, undefined);
    assert.equal(fixture.calls.events.length, 0);
    assert.equal(fixture.calls.redirects.length, 0);
    assert.equal(fixture.reservations.isPending('tenant'), true);
    fixture.calls.hashes[0](null, 'salt', 'hash');
    assert.equal(fixture.state.users['user/tenant/alice'].hash, 'hash');
    assert.equal(fixture.req.session.userid, 'user/tenant/alice');
    assert.equal(fixture.calls.writes.length, 1);
    assert.equal(fixture.calls.events.length, 1);
    assert.deepEqual(fixture.calls.redirects, ['/tenant/']);
    assert.equal(fixture.reservations.isPending('tenant'), false);
});

test('password hashing failures release reservations without publishing accounts', function () {
    const fixture = createFixture();
    fixture.service.handleCreateAccountRequest(fixture.req, fixture.res, false);
    fixture.calls.hashes[0](new Error('hash failed'));
    assert.deepEqual(fixture.state.users, {});
    assert.equal(fixture.req.session.userid, undefined);
    assert.equal(fixture.req.session.messageid, 100);
    assert.equal(fixture.calls.events.length, 0);
    assert.deepEqual(fixture.calls.redirects, ['/tenant/']);
    assert.equal(fixture.reservations.isPending('tenant'), false);
});
