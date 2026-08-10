/**
* @description Characterization tests for web server data sanitization
* @license Apache-2.0
*/

"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const sanitization = require('../../../webserver/shared/sanitization.js');

test('cloneSafeUser removes secrets and exposes only 2FA presence', function () {
    const user = {
        _id: 'user/domain/alice',
        name: 'alice',
        type: 'user',
        domain: 'domain',
        hash: 'hash',
        salt: 'salt',
        passhint: 'hint',
        passtype: 1,
        subscriptions: { secret: true },
        otpsms: '+123',
        otpmsg: 'secret',
        otpekey: { key: 'secret' },
        otpduo: { key: 'secret' },
        otpsecret: 'secret',
        otpkeys: { keys: [{ u: false }, { u: true }] },
        otphkeys: [{ name: 'key1' }, { name: 'key2' }],
        otpdev: 'device-token',
        webpush: [{ endpoint: 'one' }]
    };

    const result = sanitization.cloneSafeUser(user);

    assert.deepEqual(result, {
        _id: 'user/domain/alice',
        name: 'alice',
        otpekey: 1,
        otpduo: 1,
        otpsecret: 1,
        otpkeys: 1,
        otphkeys: 2,
        otpdev: 1,
        webpush: 1
    });
    assert.equal(user.hash, 'hash');
    assert.equal(user.otpsecret, 'secret');
});

test('cloneSafeNode replaces stored connection credentials', function () {
    const node = {
        _id: 'node/domain/one',
        pmt: 'push-token',
        ssh: {
            'user/domain/alice': { u: 'alice', p: 'password' },
            'user/domain/bob': { u: 'bob', k: 'key', kp: 'password' },
            'user/domain/carol': { u: 'carol', k: 'key' },
            invalid: { p: 'hidden' }
        },
        rdp: { 'user/domain/alice': { u: 'alice', p: 'password' }, invalid: { p: 'hidden' } },
        intelamt: { user: 'admin', pass: 'password', mpspass: 'mps-password' }
    };

    const result = sanitization.cloneSafeNode(node);

    assert.equal(result.pmt, 1);
    assert.deepEqual(result.ssh, {
        'user/domain/alice': 1,
        'user/domain/bob': 2,
        'user/domain/carol': 3
    });
    assert.deepEqual(result.rdp, { 'user/domain/alice': 1 });
    assert.deepEqual(result.intelamt, { user: 'admin', pass: 1, mpspass: 1 });
    assert.equal(node.intelamt.pass, 'password');
});

test('cloneSafeMesh hides AMT and KVM policy passwords', function () {
    const mesh = {
        _id: 'mesh/domain/one',
        amt: { type: 2, password: 'password' },
        kvm: { user: 'admin', pass: 'password' }
    };

    const result = sanitization.cloneSafeMesh(mesh);

    assert.deepEqual(result.amt, { type: 2, password: 1 });
    assert.deepEqual(result.kvm, { user: 'admin', pass: 1 });
    assert.equal(mesh.amt.password, 'password');
    assert.equal(mesh.kvm.pass, 'password');
});

test('filterUserWebState keeps supported bounded preferences only', function () {
    const result = JSON.parse(sanitization.filterUserWebState({
        nightMode: true,
        search: 'servers',
        unknown: 'discarded',
        stars: 'favorite',
        desktopsettings: JSON.stringify({ quality: 80, scaling: true, unknown: 'discarded' }),
        deskStrings: 'labels'
    }));

    assert.deepEqual(result, {
        nightMode: true,
        search: 'servers',
        stars: 'favorite',
        desktopsettings: JSON.stringify({ quality: 80, scaling: true }),
        deskStrings: 'labels'
    });
});

test('filterUserWebState rejects invalid input and oversized values', function () {
    assert.equal(sanitization.filterUserWebState('{invalid'), null);
    assert.equal(sanitization.filterUserWebState(null), null);
    assert.deepEqual(JSON.parse(sanitization.filterUserWebState({ search: 'x'.repeat(64), stars: 'x'.repeat(2048) })), {});
});
