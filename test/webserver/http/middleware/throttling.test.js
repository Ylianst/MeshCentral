/**
* @description Characterization tests for login and 2FA throttling
* @license Apache-2.0
*/

"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const createThrottling = require('../../../../webserver/http/middleware/throttling.js').createThrottling;

function createFixture(settings) {
    var currentTime = 1000000;
    const ipcheck = { match: function (ip, pattern) { return ip == pattern; } };
    const throttling = createThrottling(settings, ipcheck, function () { return currentTime; });
    return {
        throttling: throttling,
        advance: function (milliseconds) { currentTime += milliseconds; }
    };
}

test('throttling supplies default configuration', function () {
    const settings = {};
    createFixture(settings);

    assert.deepEqual(settings.maxinvalidlogin, { time: 10, count: 10, coolofftime: null });
    assert.deepEqual(settings.maxinvalid2fa, { time: 10, count: 10, coolofftime: null });
});

test('login attempts are grouped by IPv4 subnet and blocked at the limit', function () {
    const fixture = createFixture({
        maxinvalidlogin: { time: 10, count: 2 },
        maxinvalid2fa: false
    });

    fixture.throttling.setbadLogin('192.0.2.10');
    assert.equal(fixture.throttling.checkAllowLogin('192.0.2.99'), true);
    fixture.throttling.setbadLogin({ clientIp: '192.0.2.20' });

    assert.equal(fixture.throttling.checkAllowLogin('192.0.2.30'), false);
    assert.equal(fixture.throttling.checkAllowLogin('192.0.3.30'), true);
});

test('excluded addresses and disabled throttles are ignored', function () {
    const fixture = createFixture({
        maxinvalidlogin: { time: 10, count: 1, exclude: ['198.51.100.1'] },
        maxinvalid2fa: false
    });

    fixture.throttling.setbadLogin('198.51.100.1');
    fixture.throttling.setbad2Fa('203.0.113.1');

    assert.deepEqual(fixture.throttling.badLoginTable, {});
    assert.equal(fixture.throttling.checkAllowLogin('198.51.100.1'), true);
    assert.equal(fixture.throttling.checkAllow2Fa('203.0.113.1'), true);
});

test('cleanup expires old attempts independently for login and 2FA', function () {
    const fixture = createFixture({
        maxinvalidlogin: { time: 1, count: 1 },
        maxinvalid2fa: { time: 1, count: 1 }
    });
    fixture.throttling.setbadLogin('192.0.2.1');
    fixture.throttling.setbad2Fa('198.51.100.1');
    fixture.advance(61000);

    fixture.throttling.cleanBadLoginTable();
    fixture.throttling.cleanBad2faTable();

    assert.deepEqual(fixture.throttling.badLoginTable, {});
    assert.deepEqual(fixture.throttling.bad2faTable, {});
    assert.equal(fixture.throttling.badLoginTableLastClean, 0);
    assert.equal(fixture.throttling.bad2faTableLastClean, 0);
});
