/**
* @description Unit tests for authenticated server file uploads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createFileUploads = require('../webserver/file-uploads.js').createFileUploads;
const createUploadQuota = require('../webserver/upload-quota.js').createUploadQuota;

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
