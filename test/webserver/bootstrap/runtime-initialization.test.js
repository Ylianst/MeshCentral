/**
* @description Unit tests for web server runtime initialization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const runtimeInitialization = require('../../../webserver/bootstrap/runtime-initialization.js');

test('SSPI is configured only for Windows domains that request it', function () {
    const created = [];
    function NodeSspi(options) { this.options = options; created.push(options); }
    const parent = { platform: 'win32', config: { domains: { sspi: { auth: 'sspi' }, local: {} } } };
    runtimeInitialization.configureSspiDomains({ args: {} }, parent, function (name) { assert.equal(name, 'node-sspi'); return NodeSspi; });
    assert.deepEqual(created, [{ retrieveGroups: false, offerBasic: false }]);
    assert.equal(parent.config.domains.local.sspi, undefined);
});

test('SSPI setup is skipped outside Windows and in no-user mode', function () {
    var loads = 0;
    runtimeInitialization.configureSspiDomains({ args: {} }, { platform: 'linux', config: { domains: { tenant: { auth: 'sspi' } } } }, function () { loads++; });
    runtimeInitialization.configureSspiDomains({ args: { nousers: true } }, { platform: 'win32', config: { domains: { tenant: { auth: 'sspi' } } } }, function () { loads++; });
    assert.equal(loads, 0);
});

test('runtime collections start empty with a null disconnect timer', function () {
    const state = {};
    runtimeInitialization.initializeRuntimeCollections(state);
    assert.deepEqual(state.wsagents, {});
    assert.deepEqual(state.wssessions2, {});
    assert.deepEqual(state.wsrelays, {});
    assert.deepEqual(state.wsPeerRelays, {});
    assert.equal(state.wsagentsDisconnectionsTimer, null);
});

test('runtime authentication and relay random values are initialized', function () {
    const lengths = [];
    const state = { crypto: { randomBytes: function (length, callback) { lengths.push(length); callback(null, Buffer.alloc(length, length)); } } };
    runtimeInitialization.initializeRuntimeRandoms(state);
    assert.deepEqual(lengths, [48, 16, 48]);
    assert.equal(state.httpAuthRandom.length, 48);
    assert.equal(state.httpAuthRealm.length, 32);
    assert.equal(state.relayRandom.length, 48);
});
