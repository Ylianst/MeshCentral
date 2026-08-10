/**
* @description Unit tests for web session logout handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSessionLogout = require('../../../../webserver/auth/login/session-logout.js').createSessionLogout;

function createFixture(domain, userid) {
    const redirects = [], events = [], logs = [], state = { users: {}, destroyedSessions: {} };
    if (userid) state.users[userid] = { _id: userid, name: 'Alice' };
    const handler = createSessionLogout({
        state: state,
        parent: {
            debug: function () { },
            authLog: function () { logs.push(Array.from(arguments)); },
            DispatchEvent: function (targets, source, event) { events.push(event); }
        },
        checkUserIpAddress: function () { return domain; },
        clearDestroyedSessions: function () { },
        now: function () { return 1234; }
    });
    const req = { query: {}, headers: { 'user-agent': 'test' }, session: { userid: userid, x: 'session' }, clientIp: '192.0.2.1', connection: { remotePort: 443 } };
    const res = { set: function () { }, redirect: function (url) { redirects.push(url); }, sendStatus: function (status) { this.status = status; } };
    return { handler: handler, req: req, res: res, state: state, redirects: redirects, events: events, logs: logs };
}

test('local logout destroys the session and redirects to login', function () {
    const userid = 'user/tenant/alice';
    const fixture = createFixture({ id: 'tenant', url: '/tenant/' }, userid);
    fixture.req.query.key = 'a b';
    fixture.handler(fixture.req, fixture.res);
    assert.equal(fixture.req.session, null);
    assert.equal(fixture.state.destroyedSessions[userid + '/session'], 1234);
    assert.equal(fixture.events[0].action, 'logout');
    assert.deepEqual(fixture.redirects, ['/tenant/login?key=a%20b']);
});

test('SSO logout uses the provider logout URL', function () {
    const userid = 'user/tenant/~oidc:alice';
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { authStrategyFlags: 32, oidc: { logouturl: 'https://login.example/logout' } } };
    const fixture = createFixture(domain, userid);
    fixture.handler(fixture.req, fixture.res);
    assert.deepEqual(fixture.redirects, ['https://login.example/logout']);
    assert.match(fixture.logs.at(-1)[1], /OIDC: LOGOUT/);
});
