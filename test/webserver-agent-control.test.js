/**
* @description Unit tests for authorized local agent control
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('crypto');
const createAgentControl = require('../webserver/agent-control.js').createAgentControl;

function createFixture(rights) {
    const sent = [];
    const closed = [];
    const binary = [];
    const agent = {
        dbMeshKey: 'mesh/domain/group',
        send: function (value) { sent.push(value); },
        sendBinary: function (value) { binary.push(value); },
        close: function (mode) { closed.push(mode); }
    };
    const state = { wsagents: { 'node/domain/1': agent } };
    const service = createAgentControl({
        state: state,
        common: { ShortToStr: function (value) { return '[' + value + ']'; } },
        crypto: crypto,
        getMeshRights: function () { return rights; },
        agentConsoleRight: 0x10
    });
    return { service: service, agent: agent, sent: sent, binary: binary, closed: closed };
}

test('authorized users can disconnect local agents', function () {
    const fixture = createFixture(0x10);
    fixture.service.forceMeshAgentDisconnect({ siteadmin: 0 }, { id: 'domain' }, 'node/domain/1', 2);
    assert.deepEqual(fixture.closed, [2]);
});

test('wrong domains and missing rights reject agent controls', function () {
    const fixture = createFixture(0);
    fixture.service.forceMeshAgentDisconnect({ siteadmin: 0 }, { id: 'other' }, 'node/domain/1', 2);
    fixture.service.sendMeshAgentCore({ siteadmin: 0 }, { id: 'domain' }, 'node/domain/1', 'clear');
    assert.equal(fixture.closed.length, 0);
    assert.equal(fixture.sent.length, 0);
});

test('administrators can select built-in agent cores', function () {
    const fixture = createFixture(0);
    fixture.service.sendMeshAgentCore({ siteadmin: 0xFFFFFFFF }, { id: 'domain' }, 'node/domain/1', 'recovery');
    assert.equal(fixture.agent.agentCoreCheck, 1001);
    assert.deepEqual(fixture.sent, ['[11][0]']);
});

test('custom agent cores include their SHA-384 hash and payload', function () {
    const fixture = createFixture(0x10);
    fixture.service.sendMeshAgentCore({ siteadmin: 0 }, { id: 'domain' }, 'node/domain/1', 'custom', 'module-code');
    assert.equal(fixture.agent.agentCoreCheck, 1000);
    assert.equal(fixture.binary.length, 1);
    assert.equal(fixture.binary[0].startsWith('[10][0]'), true);
    assert.equal(fixture.binary[0].endsWith('module-code'), true);
});
