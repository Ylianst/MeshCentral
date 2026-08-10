/**
* @description Unit tests for password-requirement serialization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getEncodedPasswordRequirements = require('../../../../webserver/auth/login/password-requirements.js').getEncodedPasswordRequirements;

test('domains without password requirements return no serialized value', function () {
    assert.equal(getEncodedPasswordRequirements({}), null);
});

test('only numeric client password requirements are serialized', function () {
    const domain = { passwordrequirements: { min: 12, max: 64, upper: 1, lower: 1, numeric: 2, nonalpha: 1, hint: true, reset: 30 } };
    const result = JSON.parse(decodeURIComponent(getEncodedPasswordRequirements(domain)));
    assert.deepEqual(result, { min: 12, max: 64, upper: 1, lower: 1, numeric: 2, nonalpha: 1 });
});

test('serialized password requirements are cached on the domain', function () {
    const domain = { passwordrequirements: { min: 8 } };
    const first = getEncodedPasswordRequirements(domain);
    domain.passwordrequirements.min = 20;
    assert.equal(getEncodedPasswordRequirements(domain), first);
});
