/**
* @description Unit tests for SSO login group policy evaluation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ssoStrategies = require('../webserver/sso-strategies.js');
const createSsoLoginGroups = require('../webserver/sso-login-groups.js').createSsoLoginGroups;

function createFixture() {
    const logs = [];
    const prepare = createSsoLoginGroups({
        common: { convertStrArray: function (value) { return Array.isArray(value) ? value.slice() : []; } },
        authLog: function (source, message) { logs.push([source, message]); },
        isGroupConfiguration: ssoStrategies.isGroupConfiguration,
        shouldRevokeAdmin: ssoStrategies.shouldRevokeAdmin
    });
    return { prepare: prepare, logs: logs };
}

test('strategies without group configuration skip group processing', function () {
    const fixture = createFixture();
    assert.deepEqual(fixture.prepare({ groups: null }, { strategy: 'oidc', sid: 'alice' }), { enabled: false });
    assert.deepEqual(fixture.logs, []);
});

test('required SSO memberships deny users with no match', function () {
    const fixture = createFixture();
    const groups = fixture.prepare({ groups: { required: ['operators'] } }, { strategy: 'oidc', sid: 'alice', groups: ['guests'] });
    assert.equal(groups.loginDenied, true);
    assert.equal(groups.grantAdmin, false);
    assert.match(fixture.logs.at(-1)[1], /Login denied/);
});

test('administrator and filtered sync memberships are selected', function () {
    const fixture = createFixture();
    const strategy = { groups: { siteadmin: ['admins'], sync: { filter: ['admins', 'operators'] }, revokeAdmin: false } };
    const groups = fixture.prepare(strategy, { strategy: 'oidc', sid: 'alice', groups: ['admins', 'guests'] });
    assert.equal(groups.loginDenied, undefined);
    assert.equal(groups.grantAdmin, true);
    assert.equal(groups.revokeAdmin, false);
    assert.deepEqual(groups.syncMemberships, ['admins']);
});
