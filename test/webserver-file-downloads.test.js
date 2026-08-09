/**
* @description Unit tests for authorized file download handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createFileDownloads = require('../webserver/file-downloads.js').createFileDownloads;

function createFixture(settings) {
    settings = settings || {};
    const domain = { id: 'tenant', userQuota: 1024, sitestyle: 1 };
    const transfers = [];
    const state = {
        path: path,
        filespath: 'files',
        users: settings.users || {},
        common: {
            validateString: function (value) { return typeof value === 'string'; },
            IsFilenameValid: function (value) { return /^[a-zA-Z0-9_.-]+$/.test(value) && (value !== '..'); }
        },
        fs: { statSync: function () { return { mode: 0, size: 42 }; } },
        GetNodeWithRights: settings.getNodeWithRights || function (d, user, nodeId, callback) { callback({ _id: nodeId, meshid: 'mesh/tenant/1' }, 8, true); },
        meshDeviceFileHandler: { CreateMeshDeviceFile: function () { transfers.push(Array.from(arguments)); } }
    };
    const parent = {
        loginCookieEncryptionKey: 'key',
        decodeCookie: settings.decodeCookie || function () { return null; }
    };
    const service = createFileDownloads({
        state: state,
        parent: parent,
        serverRoot: 'server',
        checkUserIpAddress: function () { return domain; },
        getDomain: function () { return domain; },
        checkAgentIpAddress: function () { return domain; },
        getRandomLowerCase: function () { return 'abcdefghijkl'; },
        setContentDispositionHeader: function (res, type, name) { res.disposition = { type: type, name: name }; },
        render: function (req, res, page, args) { res.rendered = { page: page, args: args }; },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; },
        getRootCertLink: function () { return 'certificate'; },
        remoteControlRight: 8
    });
    return { service: service, state: state, domain: domain, transfers: transfers };
}

function response() {
    return {
        sendStatus: function (status) { this.status = status; },
        sendFile: function (file) { this.file = file; }
    };
}

test('public user files are constrained to valid path segments', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.downloadUserFile({ path: '/userfiles/alice/report.txt', query: { download: 1 } }, res);
    assert.deepEqual(res.disposition, { type: 'application/octet-stream', name: 'report.txt' });
    assert.equal(res.file, path.resolve('server', path.join('files', 'domain-tenant/user-alice/Public') + '/report.txt'));

    const invalidResponse = response();
    fixture.service.downloadUserFile({ path: '/userfiles/alice/../secret.txt', query: {} }, invalidResponse);
    assert.equal(invalidResponse.status, 404);
});

test('device downloads require a real user and remote-control rights', function () {
    const missingUser = createFixture({ decodeCookie: function () { return { domainid: 'tenant', userid: 'user/tenant/alice' }; } });
    const missingResponse = response();
    missingUser.service.downloadDeviceFile({ query: { c: 'cookie', f: 'file', n: 'node1' } }, missingResponse);
    assert.equal(missingResponse.status, 404);

    const userId = 'user/tenant/alice';
    const valid = createFixture({ users: { [userId]: { _id: userId } }, decodeCookie: function () { return { domainid: 'tenant', userid: userId, nid: 'node/tenant/node1', usages: [10] }; } });
    const req = { query: { c: 'cookie', f: 'file' } };
    valid.service.downloadDeviceFile(req, response());
    assert.equal(req.query.id, 'abcdefghijkl');
    assert.equal(valid.transfers.length, 1);
});

test('agent downloads accept only scoped temporary-file cookies', function () {
    const valid = createFixture({ decodeCookie: function () { return { a: 'tmpdl', d: 'tenant', nid: 'node1', f: 'update.bin' }; } });
    const res = response();
    valid.service.downloadAgentFile({ query: { c: 'cookie' } }, res);
    assert.equal(res.file, path.join('files', 'tmp', 'update.bin'));

    const invalid = createFixture({ decodeCookie: function () { return { a: 'tmpdl', d: 'tenant', nid: 'node1', f: '../update.bin' }; } });
    const invalidResponse = response();
    invalid.service.downloadAgentFile({ query: { c: 'cookie' } }, invalidResponse);
    assert.equal(invalidResponse.status, 404);
});
