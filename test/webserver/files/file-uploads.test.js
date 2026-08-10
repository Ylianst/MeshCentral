/**
* @description Unit tests for authenticated server file uploads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createFileUploads = require('../../../webserver/files/file-uploads.js').createFileUploads;
const prepareBatchUploadFiles = require('../../../webserver/files/file-uploads.js').prepareBatchUploadFiles;
const createUploadQuota = require('../../../webserver/files/upload-quota.js').createUploadQuota;

function createFixture(fields) {
    const writes = [], directories = [];
    function Form() { }
    Form.prototype.parse = function (req, callback) { callback(null, fields, { files: [] }); };
    const userId = 'user/tenant/alice';
    const state = {
        path: path,
        filespath: 'files',
        users: { [userId]: { _id: userId, siteadmin: 8 } },
        common: {
            IsFilenameValid: function (name) { return /^[a-zA-Z0-9_.-]+$/.test(name); },
            copyFile: function () { }
        },
        fs: {
            mkdirSync: function (dir) { directories.push(dir); },
            mkdir: function (dir, callback) { callback(); },
            writeFile: function (file, data, callback) { writes.push({ file: file, data: data }); callback(); },
            unlink: function () { },
            rename: function () { }
        },
        getServerFilePath: function () { return { fullpath: path.join('files', 'domain-tenant', 'user-alice'), quota: 100 }; }
    };
    const service = createFileUploads({
        state: state,
        parent: { loginCookieEncryptionKey: 'key', DispatchEvent: function () { }, decodeCookie: function () { return null; } },
        checkUserIpAddress: function () { return { id: 'tenant', userQuota: 100 }; },
        checkCookieIp: function () { return true; },
        resolveSafeUploadTempPath: function () { return null; },
        readTotalFileSize: function () { return 0; },
        createUploadQuota: createUploadQuota,
        multiparty: { Form: Form }
    });
    return { service: service, userId: userId, writes: writes, directories: directories };
}

function createBatchFixture(fields, files, rights) {
    const sent = [], events = [], renames = [], cookies = [];
    function Form() { }
    Form.prototype.parse = function (req, callback) { callback(null, fields, files); };
    const userId = 'user/tenant/alice';
    const parent = {
        args: {},
        filespath: 'files',
        loginCookieEncryptionKey: 'key',
        debug: function () { },
        decodeCookie: function () { return null; },
        encodeCookie: function (cookie) { cookies.push(cookie); return 'encoded'; },
        DispatchEvent: function (targets, state, event) { events.push({ targets: targets, event: event }); }
    };
    const state = {
        parent: parent,
        path: path,
        filespath: 'files',
        users: { [userId]: { _id: userId, name: 'Alice', realname: 'Alice Example', consent: 8, links: {} } },
        meshes: { 'mesh/tenant/one': { _id: 'mesh/tenant/one', consent: 2 } },
        userGroups: {},
        wsagents: { 'node/tenant/one': { send: function (message) { sent.push(JSON.parse(message)); } } },
        webCertificateFullHashs: {},
        common: {
            IsFilenameValid: function (name) { return /^[a-zA-Z0-9_.-]+$/.test(name); },
            copyFile: function () { }
        },
        fs: {
            mkdirSync: function () { },
            unlink: function () { },
            rename: function (source, target, callback) { renames.push({ source: source, target: target }); callback(); }
        },
        GetNodeWithRights: function (domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: 'mesh/tenant/one', agent: { id: 1 }, consent: 4 }, rights, true); },
        CreateNodeDispatchTargets: function () { return ['target']; }
    };
    const service = createFileUploads({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return { id: 'tenant', userconsentflags: 1 }; },
        checkCookieIp: function () { return true; },
        resolveSafeUploadTempPath: function () { return 'safe/temp/upload'; },
        readTotalFileSize: function () { return 0; },
        createUploadQuota: createUploadQuota,
        getRandomPassword: function () { return 'random'; },
        remoteControlRight: 8,
        multiparty: { Form: Form }
    });
    return { service: service, userId: userId, sent: sent, events: events, renames: renames, cookies: cookies };
}

function response() { return { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } }; }

test('embedded uploads reject missing companion fields', function () {
    const fixture = createFixture({ link: ['/'], name: ['file.txt'] });
    const res = response();
    fixture.service.handleUpload({ session: { userid: fixture.userId } }, res);
    assert.equal(res.status, 400);
    assert.equal(fixture.writes.length, 0);
});

test('embedded uploads reject malformed Base64 data URLs', function () {
    const fixture = createFixture({ link: ['/'], name: ['file.txt'], size: ['4'], type: ['text/plain'], data: ['not-a-data-url'] });
    const res = response();
    fixture.service.handleUpload({ session: { userid: fixture.userId } }, res);
    assert.equal(res.status, 400);
});

test('embedded uploads use the non-root domain directory and write validated data', function () {
    const encoded = Buffer.from('hello').toString('base64');
    const fixture = createFixture({ link: ['/'], name: ['file.txt'], size: ['5'], type: ['text/plain'], data: ['data:text/plain;base64,' + encoded] });
    const res = response();
    fixture.service.handleUpload({ session: { userid: fixture.userId } }, res);
    assert.equal(res.body, '');
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.writes[0].data.toString(), 'hello');
    assert.ok(fixture.directories.includes(path.join('files', 'domain-tenant')));
});

test('batch uploads reject requests without files', function () {
    const result = prepareBatchUploadFiles({ files: {}, path: path, common: { IsFilenameValid: function () { return true; } }, fs: {}, resolveSafeUploadTempPath: function () { return null; } });
    assert.equal(result.error, 'missing-files');
});

test('batch uploads reject traversal filenames and remove their temporary file', function () {
    const removed = [];
    const result = prepareBatchUploadFiles({
        files: { files: [{ originalFilename: '../escape.txt', path: 'temp/upload' }] },
        path: path,
        common: { IsFilenameValid: function () { return true; } },
        fs: { unlink: function (file, callback) { removed.push(file); callback(); } },
        resolveSafeUploadTempPath: function () { return 'temp/upload'; }
    });
    assert.equal(result.error, 'invalid-filename');
    assert.deepEqual(removed, ['temp/upload']);
});

test('batch uploads retain only validated safe filenames and temporary paths', function () {
    const result = prepareBatchUploadFiles({
        files: { files: [{ originalFilename: 'update.bin', path: 'temp/upload' }] },
        path: path,
        common: { IsFilenameValid: function (name) { return name === 'update.bin'; } },
        fs: {},
        resolveSafeUploadTempPath: function () { return 'safe/temp/upload'; }
    });
    assert.deepEqual(result, { files: [{ name: 'update.bin', tempPath: 'safe/temp/upload' }] });
});

test('batch upload handler ignores requests without a target path', function () {
    const fixture = createBatchFixture({ nodeIds: ['node/tenant/one'] }, { files: [{ originalFilename: 'update.bin', path: 'temp/upload' }] }, 8);
    const res = response();
    fixture.service.handleBatchUpload({ session: { userid: fixture.userId }, clientIp: '127.0.0.1' }, res);
    assert.equal(res.body, '');
    assert.equal(fixture.renames.length, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.sent.length, 0);
});

test('batch upload handler stages files and instructs authorized Windows agents', function () {
    const fixture = createBatchFixture({ nodeIds: ['node/tenant/one'], winpath: ['C:\\Target'], overwriteFiles: ['on'], createFolder: ['on'] }, { files: [{ originalFilename: 'update.bin', path: 'temp/upload' }] }, 8);
    const res = response();
    fixture.service.handleBatchUpload({ session: { userid: fixture.userId }, clientIp: '127.0.0.1' }, res);
    assert.equal(res.body, '');
    assert.deepEqual(fixture.renames, [{ source: 'safe/temp/upload', target: path.join('files', 'tmp', 'random-update.bin') }]);
    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0].action, 'wget');
    assert.equal(fixture.sent[0].path, path.join('C:\\Target', 'update.bin'));
    assert.equal(fixture.sent[0].consent, 15);
    assert.equal(fixture.sent[0].overwrite, true);
    assert.equal(fixture.sent[0].createFolder, true);
    assert.deepEqual(fixture.cookies, [{ a: 'tmpdl', d: 'tenant', nid: 'node/tenant/one', f: 'random-update.bin' }]);
});

test('batch upload handler does not instruct agents without remote-control rights', function () {
    const fixture = createBatchFixture({ nodeIds: ['node/tenant/one'], winpath: ['C:\\Target'] }, { files: [{ originalFilename: 'update.bin', path: 'temp/upload' }] }, 0);
    const res = response();
    fixture.service.handleBatchUpload({ session: { userid: fixture.userId }, clientIp: '127.0.0.1' }, res);
    assert.equal(res.body, '');
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.sent.length, 0);
});
