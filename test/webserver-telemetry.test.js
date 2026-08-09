/**
* @description Unit tests for web server telemetry and agent issue tracking
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createTelemetry = require('../webserver/telemetry.js').createTelemetry;

function calcDelta(oldData, newData) {
    const result = {};
    for (const key in newData) if (typeof newData[key] == 'number') result[key] = newData[key] - (oldData[key] || 0);
    return result;
}

function createFixture(times) {
    const state = {
        users: { one: {}, two: {} },
        meshes: { mesh: {} },
        dnsDomains: {},
        relaySessionCount: 3,
        relaySessionErrorCount: 1,
        wsagents: { agent: {} },
        wsagentsDisconnections: {},
        wsagentsDisconnectionsTimer: {},
        wssessions: {},
        wssessions2: {},
        wsPeerSessions: {},
        wsPeerSessions2: {},
        wsPeerSessions3: {},
        sessionsCount: {},
        wsrelays: {},
        wsPeerRelays: {},
        blockedUsers: 4,
        blockedAgents: 5,
        common: { Clone: function (value) { return JSON.parse(JSON.stringify(value)); } }
    };
    let timeIndex = 0;
    const telemetry = createTelemetry({
        state: state,
        tlsConfiguration: { getSessionStoreSize: function () { return 6; } },
        calcDelta: calcDelta,
        now: function () { return times ? times[Math.min(timeIndex++, times.length - 1)] : 1000; }
    });
    Object.assign(state, telemetry);
    return { state: state, telemetry: telemetry };
}

test('initializes stable agent and traffic counters', function () {
    const fixture = createFixture([1000]);
    assert.equal(fixture.telemetry.agentStats.createMeshAgentCount, 0);
    assert.equal(fixture.telemetry.agentStats.agentInBigTrouble, 0);
    assert.equal(fixture.telemetry.trafficStats.httpRequestCount, 0);
    assert.deepEqual(fixture.telemetry.trafficStats.relayCount, {});
    assert.equal(fixture.telemetry.trafficStats.time, 1000);
});

test('server stats combine collection sizes, counters and TLS sessions', function () {
    const fixture = createFixture();
    const stats = fixture.telemetry.getStats();
    assert.equal(stats.users, 2);
    assert.equal(stats.meshes, 1);
    assert.equal(stats.wsagents, 1);
    assert.equal(stats.relaySessionCount, 3);
    assert.equal(stats.tlsSessionStore, 6);
    assert.equal(stats.blockedUsers, 4);
});

test('traffic deltas clone current counters and include elapsed time', function () {
    const fixture = createFixture([1000, 2500]);
    fixture.telemetry.trafficStats.httpIn = 30;
    const result = fixture.telemetry.getTrafficDelta({ time: 1000, httpIn: 12 });
    assert.equal(result.current.httpIn, 30);
    assert.equal(result.current.time, 2500);
    assert.equal(result.delta.httpIn, 18);
    assert.equal(result.delta.delta, 1500);
});

test('agent issues resolve socket addresses and retain only the latest fifty', function () {
    const fixture = createFixture();
    for (let i = 0; i < 52; i++) fixture.telemetry.setAgentIssue({ ws: { _socket: { remoteAddress: '192.0.2.1', remotePort: 443 } } }, 'issue-' + i);
    const issues = fixture.telemetry.getAgentIssues();
    assert.equal(issues.length, 50);
    assert.equal(issues[0][1], '192.0.2.1:443');
    assert.equal(issues[0][2], 'issue-2');
    assert.equal(issues[49][2], 'issue-51');
});
