/**
* @description Unit tests for current and historical password checks
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createPasswordHistory = require('../../../../webserver/auth/login/password-history.js').createPasswordHistory;
const updatePasswordHint = require('../../../../webserver/auth/login/password-history.js').updatePasswordHint;

function createFixture(settings) {
    settings = settings || {};
    const pass = {
        hash: function (password, salt, callback, tag) { callback(null, settings.hashes && settings.hashes[salt] ? settings.hashes[salt] : 'mismatch', tag); },
        iishash: function (type, password, salt, callback) { callback(null, settings.iisHash || 'mismatch'); }
    };
    return createPasswordHistory({
        debug: function () { },
        require: function (name) {
            if (name === './pass') return pass;
            if (name === 'wildleek') return function () { return Promise.resolve(settings.common === true); };
            throw new Error('Unexpected module: ' + name);
        }
    });
}

function checkCurrent(service, user) { return new Promise(function (resolve) { service.checkUserPassword({}, user, 'password', resolve); }); }
function checkHistory(service, domain, user) { return new Promise(function (resolve) { service.checkOldUserPasswords(domain, user, 'password', resolve); }); }

test('validates strong and legacy current password hashes', async function () {
    const strong = createFixture({ hashes: { salt: 'stored' } });
    assert.equal(await checkCurrent(strong, { salt: 'salt', hash: 'stored' }), true);
    assert.equal(await checkCurrent(createFixture(), { salt: 'salt', hash: 'stored' }), false);

    const legacy = createFixture({ iisHash: 'legacy-hash' });
    assert.equal(await checkCurrent(legacy, { passtype: 1, salt: 'salt', hash: 'legacy-hash' }), true);
});

test('locked accounts cannot validate an otherwise correct password', async function () {
    const service = createFixture({ hashes: { salt: 'stored' } });
    assert.equal(await checkCurrent(service, { salt: 'salt', hash: 'stored', siteadmin: 32 }), false);
});

test('password history is trimmed to policy length and detects reuse', async function () {
    const user = { salt: 'current', hash: 'current-hash', oldpasswords: [{ salt: 'old-one', hash: 'one' }, { salt: 'old-two', hash: 'two' }, { salt: 'old-three', hash: 'three' }] };
    const service = createFixture({ hashes: { current: 'different', 'old-two': 'two', 'old-three': 'different' } });
    const result = await checkHistory(service, { passwordrequirements: { oldpasswordban: 2 } }, user);
    assert.equal(result, 1);
    assert.deepEqual(user.oldpasswords.map(function (entry) { return entry.salt; }), ['old-two', 'old-three']);
});

test('common-password policy reports its distinct result', async function () {
    const user = { salt: 'current', hash: 'stored' };
    const result = await checkHistory(createFixture({ common: true }), { passwordrequirements: { oldpasswordban: 1, bancommonpasswords: true } }, user);
    assert.equal(result, 2);
});

test('password reset hints use the recovery field and enforce the storage limit', function () {
    const user = { passhint: 'old hint' };
    updatePasswordHint(user, { hint: true }, 'x'.repeat(300));
    assert.equal(user.passhint, 'x'.repeat(250));
    updatePasswordHint(user, { hint: false }, 'new hint');
    assert.equal(user.passhint, undefined);
});
