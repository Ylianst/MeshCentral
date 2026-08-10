/**
* @description Unit tests for failed login handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginFailureHandler = require('../../../../webserver/auth/login/login-failure.js').createLoginFailureHandler;

function createFixture() {
    const events = [], logs = [], redirects = [], delays = [];
    const state = {
        crypto: { randomBytes: function () { return { readUInt16BE: function () { return 5; } }; } },
        getUserAgentInfo: function () { return { browserStr: 'Browser', osStr: 'OS' }; },
        setbadLogin: function () { },
        parent: { authLog: function () { logs.push(Array.from(arguments)); }, DispatchEvent: function () { events.push(Array.from(arguments)); } }
    };
    const handler = createLoginFailureHandler({ state: state, parent: { debug: function () { } }, getQueryPortion: function () { return ''; }, handleRootRequestEx: function () { }, schedule: function (callback, delay) { delays.push(delay); callback(); } });
    const req = { clientIp: '192.0.2.1', connection: { remotePort: 1234 }, headers: { 'user-agent': 'Test' }, session: { loginmode: 4 } };
    const res = { redirect: function (url) { redirects.push(url); } };
    return { handler: handler, req: req, res: res, events: events, logs: logs, redirects: redirects, delays: delays };
}

test('locked login failures are audited and retain password hints', function () {
    const fixture = createFixture();
    fixture.handler(fixture.req, fixture.res, { id: 'tenant', url: '/tenant/' }, 'Alice', 'locked', 'remember me', false);
    assert.equal(fixture.req.session.messageid, 110);
    assert.equal(fixture.req.session.passhint, 'remember me');
    assert.equal(fixture.req.session.loginmode, undefined);
    assert.equal(fixture.events[0][2].msgid, 109);
    assert.equal(fixture.logs.length, 1);
    assert.deepEqual(fixture.redirects, ['/tenant/']);
    assert.equal(fixture.delays[0], 2005);
});

test('removed accounts follow the generic failed-login response', function () {
    const fixture = createFixture();
    fixture.handler(fixture.req, fixture.res, { id: 'tenant', url: '/tenant/' }, 'Alice', null, null, false);
    assert.equal(fixture.req.session.messageid, 112);
    assert.equal(fixture.events[0][2].msgid, 110);
    assert.equal(fixture.req.session.passhint, undefined);
});
