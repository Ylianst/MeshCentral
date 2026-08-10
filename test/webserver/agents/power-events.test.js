/**
* @description Unit tests for device power event handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../../../webserver/agents/power-events.js').hasDatabaseFailure;
const createPowerEventsHandler = require('../../../webserver/agents/power-events.js').createPowerEventsHandler;

function createFixture(database) {
    const userId = 'user//alice';
    const state = {
        users: { [userId]: { links: { mesh: {} } } },
        db: database,
        GetNodeRights: function () { return 1; }
    };
    const handler = createPowerEventsHandler({
        state: state,
        checkUserIpAddress: function () { return { id: '' }; },
        setContentDispositionHeader: function (res) { res.hasDownloadHeader = true; }
    });
    const req = { query: { id: 'node//node1' }, session: { userid: userId } };
    const res = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    return { handler: handler, req: req, res: res };
}

test('power event database failures reject errors and missing result arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('power event handler rejects node lookup database errors', function () {
    const fixture = createFixture({ Get: function (id, callback) { callback(new Error('database unavailable')); } });
    fixture.handler(fixture.req, fixture.res);
    assert.equal(fixture.res.status, 500);
});

test('power event handler returns the device timeline as CSV', function () {
    const fixture = createFixture({
        Get: function (id, callback) { callback(null, [{ _id: id, meshid: 'mesh//main' }]); },
        getPowerTimeline: function (id, callback) { callback(null, [{ time: '2024-01-02T03:04:05.000Z', power: 1, oldPower: 0 }]); }
    });
    fixture.handler(fixture.req, fixture.res);
    assert.equal(fixture.res.hasDownloadHeader, true);
    assert.equal(fixture.res.body, 'UTC Time, Local Time, State, Previous State\r\n\"2024-01-02T03:04:05.000Z\",\"\",1,0');
});
