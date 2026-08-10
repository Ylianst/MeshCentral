/**
* @description Unit tests for main application server features
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getApplicationServerFeatures = require('../webserver/application-server-features.js').getApplicationServerFeatures;

test('default domains expose all server features with NeDB', function () {
    assert.equal(getApplicationServerFeatures({}, 1), 255);
});

test('domains can disable the My Server feature set', function () {
    assert.equal(getApplicationServerFeatures({ myserver: false }, 1), 0);
});

test('configured My Server capabilities produce the expected bit mask', function () {
    const domain = { myserver: { backup: true, restore: true, upgrade: false, errorlog: false, console: true, trace: false, config: true } };
    assert.equal(getApplicationServerFeatures(domain, 1), 255 - 4 - 8 - 32);
});

test('non-NeDB databases disable only web restore', function () {
    assert.equal(getApplicationServerFeatures({}, 2), 253);
    assert.equal(getApplicationServerFeatures({ myserver: false }, 2), 0);
});
