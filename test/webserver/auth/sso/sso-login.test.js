/**
* @description Unit tests for SSO login request orchestration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSsoLogin = require('../../../../webserver/auth/sso/sso-login.js').createSsoLogin;

function createFixture(settings) {
    settings = settings || {};
    const calls = [], redirects = [], users = settings.users || {};
    const domain = { id: 'tenant', url: '/tenant/', authstrategies: { oidc: {} } };
    const accounts = {
        getNewAccountSettings: function () { calls.push('settings'); return { allowed: settings.newAccounts === true }; },
        createAccount: function () { calls.push('create'); return { _id: 'user/tenant/alice', name: 'Alice' }; },
        updateExistingAccount: function () { calls.push('update'); },
        completeSsoLogin: function () { calls.push('complete'); }
    };
    const handle = createSsoLogin({
        users: users,
        authLog: function () { },
        checkUserIpAddress: function () { return domain; },
        getQueryPortion: function () { return '?key=value'; },
        prepareSsoLoginGroups: function () { return settings.groups || { enabled: false }; },
        ssoAccounts: accounts,
        sendSsoLoginResponse: function () { calls.push('response'); }
    });
    const req = { user: { sid: 'alice', strategy: 'oidc', name: 'Alice' }, session: {} };
    const res = { redirect: function (url) { redirects.push(url); } };
    return { handle: handle, req: req, res: res, calls: calls, redirects: redirects };
}

test('required SSO group denial redirects before account processing', function () {
    const fixture = createFixture({ groups: { loginDenied: true } });
    fixture.handle(fixture.req, fixture.res);
    assert.equal(fixture.req.session.messageid, 111);
    assert.deepEqual(fixture.redirects, ['/tenant/?key=value']);
    assert.deepEqual(fixture.calls, []);
});

test('existing SSO users are updated, completed and sent a response', function () {
    const user = { _id: 'user/tenant/alice', name: 'Alice' };
    const fixture = createFixture({ users: { [user._id]: user } });
    fixture.handle(fixture.req, fixture.res);
    assert.deepEqual(fixture.calls, ['update', 'complete', 'response']);
});

test('disallowed new SSO accounts receive the account creation error', function () {
    const fixture = createFixture();
    fixture.handle(fixture.req, fixture.res);
    assert.equal(fixture.req.session.messageid, 100);
    assert.deepEqual(fixture.calls, ['settings']);
    assert.deepEqual(fixture.redirects, ['/tenant/?key=value']);
});
