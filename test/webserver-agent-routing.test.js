/**
* @description Unit tests for routing agent commands to user sessions
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAgentRouting = require('../webserver/agent-routing.js').createAgentRouting;

function createFixture(rights) {
    const sent = [];
    const peerSent = [];
    const state = { wssessions: {}, wssessions2: {}, wsPeerSessions2: {} };
    const multiServer = {
        DispatchMessageSingleServer: function (command, serverId) { peerSent.push(['single', command, serverId]); },
        DispatchMessage: function (command) { peerSent.push(['all', command]); }
    };
    const service = createAgentRouting({ state: state, getNodeRights: function () { return rights; }, getMultiServer: function () { return multiServer; } });
    return { state: state, service: service, sent: sent, peerSent: peerSent, socket: function () { return { send: function (message) { sent.push(JSON.parse(message)); } }; } };
}

test('commands addressed to a local session are delivered after authorization', function () {
    const fixture = createFixture(1);
    const sessionId = 'user/domain/alice/session1';
    fixture.state.wssessions2[sessionId] = fixture.socket();
    const command = { sessionid: sessionId, action: 'console' };
    fixture.service.routeAgentCommand(command, 'domain', 'node/domain/1', 'mesh/domain/1');
    assert.deepEqual(fixture.sent, [{ action: 'console', nodeid: 'node/domain/1' }]);
    assert.equal(command.sessionid, undefined);
});

test('remote session commands are forwarded to the owning peer', function () {
    const fixture = createFixture(1);
    const sessionId = 'user/domain/alice/session1';
    fixture.state.wsPeerSessions2[sessionId] = 'peer1';
    const command = { sessionid: sessionId, action: 'console' };
    fixture.service.routeAgentCommand(command, 'domain', 'node/domain/1', 'mesh/domain/1');
    assert.equal(fixture.peerSent[0][0], 'single');
    assert.equal(fixture.peerSent[0][2], 'peer1');
    assert.equal(command.fromNodeid, 'node/domain/1');
});

test('broadcast commands reach authorized local users and peer servers', function () {
    const fixture = createFixture(1);
    fixture.state.wssessions['user/domain/alice'] = [fixture.socket(), fixture.socket()];
    const command = { action: 'state' };
    fixture.service.routeAgentCommand(command, 'domain', 'node/domain/1', 'mesh/domain/1');
    assert.equal(fixture.sent.length, 2);
    assert.equal(fixture.sent[0].nodeid, 'node/domain/1');
    assert.deepEqual(command, { action: 'state', fromNodeid: 'node/domain/1', meshid: 'mesh/domain/1' });
    assert.equal(fixture.peerSent[0][0], 'all');
});

test('unauthorized targeted commands are discarded', function () {
    const fixture = createFixture(0);
    const sessionId = 'user/domain/alice/session1';
    fixture.state.wssessions2[sessionId] = fixture.socket();
    fixture.service.routeAgentCommand({ sessionid: sessionId }, 'domain', 'node/domain/1', 'mesh/domain/1');
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.peerSent.length, 0);
});
