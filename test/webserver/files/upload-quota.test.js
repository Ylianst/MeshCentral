/**
* @description Unit tests for cumulative upload quota reservations
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createUploadQuota = require('../../../webserver/files/upload-quota.js').createUploadQuota;

test('upload quota reservations accumulate across all files in a request', function () {
    const quota = createUploadQuota(20, 100);
    assert.equal(quota.tryReserve(40), true);
    assert.equal(quota.tryReserve(30), true);
    assert.equal(quota.tryReserve(15), false);
    assert.equal(quota.getReservedSize(), 90);
});

test('rejected reservations do not consume quota', function () {
    const quota = createUploadQuota(80, 100);
    assert.equal(quota.tryReserve(25), false);
    assert.equal(quota.tryReserve(10), true);
    assert.equal(quota.getReservedSize(), 90);
});

test('unlimited quotas still validate sizes and accumulate reservations', function () {
    const quota = createUploadQuota(10, null);
    assert.equal(quota.tryReserve(1000), true);
    assert.equal(quota.tryReserve(-1), false);
    assert.equal(quota.tryReserve(Number.NaN), false);
    assert.equal(quota.getReservedSize(), 1010);
});

test('reservations preserve the existing strict quota boundary', function () {
    const quota = createUploadQuota(90, 100);
    assert.equal(quota.tryReserve(10), false);
    assert.equal(quota.tryReserve(9), true);
});
