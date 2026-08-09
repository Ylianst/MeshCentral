/**
* @description Unit tests for web user-agent information
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createUserAgent = require('../webserver/user-agent.js').createUserAgent;

function ClientHints() { }
ClientHints.prototype.setValuesFromHeaders = function (headers) { return headers.hints || {}; };

test('user-agent parsing adds readable browser and operating-system strings', function () {
    const service = createUserAgent({
        parse: function () { return { browser: { name: 'Firefox', version: '100' }, os: { name: 'Linux', version: '6' } }; },
        ClientHints: ClientHints
    });
    const result = service.getUserAgentInfo('agent');
    assert.equal(result.browserStr, 'Firefox/100');
    assert.equal(result.osStr, 'Linux/6');
});

test('client hints override platform information and identify Windows 11', function () {
    const service = createUserAgent({
        parse: function () { return { browser: { name: 'Edge' }, os: { name: 'Windows', version: '10' } }; },
        ClientHints: ClientHints
    });
    const result = service.getUserAgentInfo({ headers: { 'user-agent': 'agent', hints: { platform: 'Windows', platformVersion: '13.0.0' } } });
    assert.equal(result.osStr, 'Windows/11');
    assert.equal(result.platformVersion, '11');
});

test('parser failures return stable unknown values', function () {
    const service = createUserAgent({ parse: function () { throw new Error('bad agent'); }, ClientHints: ClientHints });
    assert.deepEqual(service.getUserAgentInfo('agent'), { browserStr: 'Unknown', osStr: 'Unknown' });
});
