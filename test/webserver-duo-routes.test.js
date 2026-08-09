/**
* @description Unit tests for Duo Universal two-factor authentication routes
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDuoRoutes = require('../webserver/duo-routes.js').createDuoRoutes;

function createFixture(settings) {
    settings = settings || {};
    const routes = [];
    const events = [];
    const clientOptions = [];
    const domain = settings.domain || { id: 'tenant', url: '/tenant/', duo2factor: { integrationkey: 'integration', secretkey: 'secret', apihostname: 'api.example.com' } };
    const user = { _id: 'user/tenant/alice', name: 'alice' };
    const state = {
        app: { get: function () { routes.push(Array.from(arguments)); } },
        users: { 'user/tenant/alice': user },
        db: { SetUser: function (value) { this.saved = value; }, changeStream: settings.changeStream },
        generateBaseURL: function () { return 'https://server.example.com/tenant/'; },
        CloneSafeUser: function (value) { return { name: value.name }; },
        getUserAgentInfo: function () { return { browserStr: 'Browser', osStr: 'OS' }; },
        authenticate: function (name, pass, requestDomain, callback) { callback(null, user._id); },
        setbad2Fa: function () { }
    };
    const parent = {
        decryptSessionData: function (value) { return Object.assign({}, value); },
        encryptSessionData: function (value) { return value; },
        debug: function () { },
        authLog: function () { },
        DispatchEvent: function () { events.push(Array.from(arguments)); }
    };
    class Client {
        constructor(options) { clientOptions.push(options); }
        generateState() { return 'generated-state'; }
        createAuthUrl(userName, state) { return 'https://duo.example.com/' + userName + '/' + state; }
        exchangeAuthorizationCodeFor2FAResult() { return settings.rejectExchange ? Promise.reject(new Error('rejected')) : Promise.resolve({}); }
    }
    const service = createDuoRoutes({
        state: state,
        parent: parent,
        getDomain: function () { return domain; },
        getQueryPortion: function () { return '?key=value'; },
        setSessionRandom: function (req) { req.session.x = 'random'; },
        loadDuo: function () { return { Client: Client }; }
    });
    return { service: service, routes: routes, events: events, clientOptions: clientOptions, domain: domain, state: state, user: user };
}

function findRoute(fixture, path) { return fixture.routes.find(function (route) { return route[0] === path; }); }
function response() { return { redirect: function (url) { this.redirected = url; }, sendStatus: function (status) { this.status = status; } }; }

test('does not register Duo routes without complete credentials', function () {
    const fixture = createFixture({ domain: { id: 'tenant', url: '/tenant/', duo2factor: { integrationkey: 'only-one-value' } } });
    fixture.service.register(fixture.domain);
    assert.equal(fixture.routes.length, 0);
});

test('rejects callbacks whose state does not match the encrypted session', function () {
    const fixture = createFixture();
    fixture.service.register(fixture.domain);
    const req = { session: { e: { duostate: 'expected' } }, query: { state: 'wrong', duo_code: 'code' } };
    const res = response();
    findRoute(fixture, '/tenant/auth-duo')[1](req, res);
    assert.equal(req.session.loginmode, 1);
    assert.equal(req.session.messageid, 117);
    assert.equal(res.redirected, '/tenant/?key=value');
});

test('add-duo stores configuration state and redirects to Duo', function () {
    const fixture = createFixture();
    fixture.domain.loginkey = 'login-key';
    fixture.service.register(fixture.domain);
    const req = { session: { userid: fixture.user._id, e: {} }, query: { rurl: '/return' } };
    const res = response();
    findRoute(fixture, '/tenant/add-duo')[1](req, res);
    assert.equal(req.session.e.duostate, 'generated-state');
    assert.equal(req.session.e.duoconfig, 1);
    assert.equal(req.session.duorurl, '/return');
    assert.equal(res.redirected, 'https://duo.example.com/alice/generated-state');
    assert.equal(fixture.clientOptions[0].redirectUrl, 'https://server.example.com/tenant/auth-duo&key=login-key');
});

test('successful Duo configuration enables the user and emits an account event', async function () {
    const fixture = createFixture();
    fixture.service.register(fixture.domain);
    const req = { session: { userid: fixture.user._id, e: { duostate: 'state', duoconfig: 1 } }, query: { state: 'state', duo_code: 'code' } };
    const res = response();
    findRoute(fixture, '/tenant/auth-duo')[1](req, res);
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.deepEqual(fixture.user.otpduo, {});
    assert.equal(fixture.state.db.saved, fixture.user);
    assert.equal(fixture.events.length, 1);
    assert.equal(req.session.e.duostate, undefined);
    assert.equal(res.redirected, '/tenant/');
});
