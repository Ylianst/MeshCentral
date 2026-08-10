/**
* @description Unit tests for domain and user capability masks
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDomainUserFeatures = require('../../../webserver/domains/domain-user-features.js').createDomainUserFeatures;

function createFixture(matchIp) {
    const parent = { config: { settings: {} }, certificates: { CommonName: 'server.example.com' } };
    const state = { args: {}, parent: parent, isTrustedCert: function () { return true; } };
    return createDomainUserFeatures({ state: state, parent: parent, ipcheck: { match: function () { return matchIp; } } });
}

function domain() { return { userQuota: 0, auth: '', passwordrequirements: {} }; }
function user() { return { _id: 'user//alice', siteadmin: 0 }; }

test('domain features expose default desktop, WebAuthn and login token capabilities', function () {
    const result = createFixture(false)(domain(), user(), { session: {} });
    assert.equal((result.features & 0x00000200) != 0, true);
    assert.equal((result.features & 0x00020000) != 0, true);
    assert.equal((result.features2 & 0x00000080) != 0, true);
    assert.equal(result.features3, 0);
});

test('domain features suppress forced two factor for configured source addresses', function () {
    const configuredDomain = domain();
    configuredDomain.passwordrequirements = { force2factor: true, skip2factor: ['10.0.0.0/8'] };
    const required = createFixture(false)(configuredDomain, user(), { clientIp: '192.0.2.1', session: {} });
    const skipped = createFixture(true)(configuredDomain, user(), { clientIp: '10.0.0.1', session: {} });
    assert.equal((required.features & 0x00040000) != 0, true);
    assert.equal((skipped.features & 0x00040000) != 0, false);
});
