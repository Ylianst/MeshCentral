/**
* @description Unit tests for device record cleanup
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDeviceCleaner = require('../webserver/device-cleanup.js').createDeviceCleaner;

test('device cleanup preserves links to existing users and user groups', function () {
    const cleanDevice = createDeviceCleaner({ users: { 'user//alice': {} }, userGroups: { 'ugrp//staff': {} } });
    const device = { links: { 'user//alice': { rights: 1 }, 'ugrp//staff': { rights: 2 } } };
    assert.equal(cleanDevice(device), device);
    assert.deepEqual(Object.keys(device.links), ['user//alice', 'ugrp//staff']);
});

test('device cleanup removes unknown links and empty link collections', function () {
    const cleanDevice = createDeviceCleaner({ users: {}, userGroups: {} });
    const device = { links: { 'user//missing': { rights: 1 } } };
    cleanDevice(device);
    assert.equal(device.links, undefined);
});
