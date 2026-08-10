/**
* @description Unit tests for local and peer WebSocket session counts
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSessionCounts = require('../../../webserver/services/session-counts.js').createSessionCounts;

function createFixture() {
    const userId = 'user/domain/alice';
    const events = [];
    const state = {
        users: { [userId]: { _id: userId, groups: ['operators'] } },
        wssessions: {},
        wsPeerSessions3: {},
        sessionsCount: {}
    };
    const service = createSessionCounts({ state: state, dispatchEvent: function (targets, source, event) { events.push({ targets: targets, event: event }); } });
    return { userId: userId, state: state, service: service, events: events };
}

test('full recount combines local and peer sessions', function () {
    const fixture = createFixture();
    fixture.state.wssessions[fixture.userId] = [{}, {}];
    fixture.state.wsPeerSessions3.peer1 = { [fixture.userId]: [{}] };
    fixture.service.recountSessions();
    assert.equal(fixture.state.sessionsCount[fixture.userId], 3);
    assert.equal(fixture.events[0].event.count, 3);
    assert.deepEqual(fixture.events[0].targets, ['*', 'server-users', 'server-users:operators']);
});

test('full recount emits zero for disconnected users', function () {
    const fixture = createFixture();
    fixture.state.sessionsCount[fixture.userId] = 2;
    fixture.service.recountSessions();
    assert.deepEqual(fixture.state.sessionsCount, {});
    assert.equal(fixture.events[0].event.count, 0);
    assert.deepEqual(fixture.events[0].targets, ['*']);
});

test('incremental recount updates only the selected user', function () {
    const fixture = createFixture();
    fixture.state.wssessions[fixture.userId] = [{}];
    fixture.state.wsPeerSessions3.peer1 = { [fixture.userId]: [{}, {}] };
    fixture.service.recountSessions(fixture.userId + '/session1');
    assert.equal(fixture.state.sessionsCount[fixture.userId], 3);
    assert.equal(fixture.events.length, 1);
});
