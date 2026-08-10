/**
* @description Unit tests for session recording handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createRecordings = require('../../../webserver/files/recordings.js').createRecordings;

function createFixture(settings) {
    settings = settings || {};
    const userId = 'user/tenant/admin';
    const domain = { id: 'tenant', sessionrecording: settings.sessionrecording || { filepath: 'recordings' } };
    const state = {
        path: path,
        common: { IsFilenameValid: function (name) { return /^[a-zA-Z0-9_.-]+$/.test(name); } },
        users: { [userId]: { siteadmin: settings.siteadmin == null ? 512 : settings.siteadmin } },
        fs: {}
    };
    const service = createRecordings({
        state: state,
        parent: { recordpath: 'default-recordings', debug: function () { } },
        checkUserIpAddress: function () { return domain; },
        checkAgentIpAddress: function () { return domain; },
        setContentDispositionHeader: function (res, type, name) { res.disposition = { type: type, name: name }; },
        render: function (req, res, page, args) { res.rendered = { page: page, args: args }; },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; },
        recordingRight: 512
    });
    return { service: service, state: state, domain: domain, userId: userId };
}

function response() {
    return {
        sendStatus: function (status) { this.status = status; },
        sendFile: function (file) { this.file = file; },
        set: function (headers) { this.headers = headers; }
    };
}

test('recording downloads require valid names and the recording right', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.download({ query: { file: 'session.mcrec' }, session: { userid: fixture.userId } }, res);
    assert.equal(res.file, path.join('recordings', 'session.mcrec'));
    assert.deepEqual(res.disposition, { type: 'application/octet-stream', name: 'session.mcrec' });

    const denied = createFixture({ siteadmin: 0 });
    const deniedResponse = response();
    denied.service.download({ query: { file: 'session.mcrec' }, session: { userid: denied.userId } }, deniedResponse);
    assert.equal(deniedResponse.status, 401);
});

test('recording streams accept mcrec files but not text indexes', function () {
    const fixture = createFixture();
    const requestBase = { session: { userid: fixture.userId } };
    assert.equal(fixture.service.getRecordingContext(fixture.domain, { ...requestBase, query: { file: 'session.txt' } }, false), null);
    assert.equal(fixture.service.getRecordingContext(fixture.domain, { ...requestBase, query: { file: '../session.mcrec' } }, false), null);
    assert.equal(fixture.service.getRecordingContext(fixture.domain, { ...requestBase, query: { file: 'session.mcrec' } }, false).filePath, path.join('recordings', 'session.mcrec'));
});

test('the recording player is rendered without caching', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.player({}, res);
    assert.deepEqual(res.headers, { 'Cache-Control': 'no-store' });
    assert.deepEqual(res.rendered, { page: 'player', args: {} });
});
