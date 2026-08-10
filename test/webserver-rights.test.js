/**
* @description Unit tests for web server permission masks
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const rights = require('../webserver/rights.js');

test('mesh permission masks retain protocol values', function () {
    assert.equal(rights.mesh.remoteControl, 0x00000008);
    assert.equal(rights.mesh.agentConsole, 0x00000010);
    assert.equal(rights.mesh.relay, 0x00200000);
    assert.equal(rights.mesh.admin, 0xFFFFFFFF);
});

test('site permission masks retain account values', function () {
    assert.equal(rights.site.locked, 0x00000020);
    assert.equal(rights.site.noMeshCommand, 0x00000080);
    assert.equal(rights.site.noNewDevices, 0x00001000);
    assert.equal(rights.site.admin, 0xFFFFFFFF);
});

test('permission maps are immutable', function () {
    assert.equal(Object.isFrozen(rights.mesh), true);
    assert.equal(Object.isFrozen(rights.site), true);
});
