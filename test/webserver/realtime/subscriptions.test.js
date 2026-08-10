/**
* @description Unit tests for web event subscriptions
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSubscriptions = require('../../../webserver/realtime/subscriptions.js').createSubscriptions;

function createFixture(user) {
    const userId = 'user/domain/alice';
    const calls = [];
    const service = createSubscriptions({
        users: { [userId]: user },
        removeAllEventDispatch: function (target) { calls.push(['remove', target]); },
        addEventDispatch: function (subscriptions, target) { calls.push(['add', subscriptions, target]); }
    });
    return { userId: userId, service: service, calls: calls };
}

test('full administrators subscribe to all events and linked objects', function () {
    const fixture = createFixture({ siteadmin: 0xFFFFFFFF, links: { 'mesh/domain/1': { rights: 1 } } });
    const target = {};
    assert.deepEqual(fixture.service.subscribe(fixture.userId, target), [fixture.userId, 'server-allusers', '*', 'mesh/domain/1']);
    assert.deepEqual(fixture.calls[0], ['remove', target]);
    assert.equal(fixture.calls[1][0], 'add');
});

test('user managers with scoped groups subscribe only to those groups', function () {
    const fixture = createFixture({ siteadmin: 2, groups: ['west', 'east'] });
    assert.deepEqual(fixture.service.subscribe(fixture.userId, {}), [fixture.userId, 'server-allusers', 'server-users:west', 'server-users:east']);
});

test('unscoped user managers subscribe to all user changes', function () {
    const fixture = createFixture({ siteadmin: 2 });
    assert.deepEqual(fixture.service.subscribe(fixture.userId, {}), [fixture.userId, 'server-allusers', 'server-users']);
});

test('unknown users do not alter event dispatch', function () {
    const fixture = createFixture({});
    assert.equal(fixture.service.subscribe('user/domain/missing', {}), undefined);
    assert.equal(fixture.calls.length, 0);
});
