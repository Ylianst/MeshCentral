/**
* @description Unit tests for macOS MeshAgent installer downloads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handleArchiveError = require('../webserver/macos-agent-download.js').handleArchiveError;

test('macOS archive failures return server errors before transmission starts', function () {
    const logs = [];
    const res = { headersSent: false, sendStatus: function (status) { this.status = status; } };
    handleArchiveError({ debug: function (source, message) { logs.push([source, message]); } }, res, new Error('archive failed'));
    assert.equal(res.status, 500);
    assert.equal(logs[0][0], 'web');
    assert.match(logs[0][1], /archive failed/);
});

test('macOS archive failures destroy downloads already in progress', function () {
    const error = new Error('archive failed');
    const res = { headersSent: true, destroy: function (value) { this.error = value; } };
    handleArchiveError({ debug: function () { } }, res, error);
    assert.equal(res.error, error);
});
