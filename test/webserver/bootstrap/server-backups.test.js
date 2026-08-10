/**
* @description Unit tests for server backup and restore handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createServerBackups = require('../../../webserver/bootstrap/server-backups.js').createServerBackups;

function createFixture(settings) {
    settings = settings || {};
    const stopped = [];
    const userId = 'user/tenant/admin';
    const domain = { id: 'tenant', url: '/tenant/', myserver: { backup: true, restore: true } };
    function Form() { }
    Form.prototype.parse = function (req, callback) { callback(settings.parseError || null, settings.fields || {}, settings.files || {}); };
    const state = {
        users: { [userId]: { _id: userId, siteadmin: settings.siteadmin == null ? 5 : settings.siteadmin } },
        fs: { existsSync: function () { return true; } },
        db: {
            performingBackup: false,
            newAutoBackupFile: 'backup.zip',
            performBackup: function () { this.performed = true; }
        }
    };
    const parent = {
        config: { settings: { autobackup: { backupintervalhours: 24 } } },
        loginCookieEncryptionKey: 'key',
        decodeCookie: function () { return settings.cookie || null; },
        Stop: function (path) { stopped.push(path); },
        addServerWarning: function () { }
    };
    const service = createServerBackups({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return domain; },
        checkCookieIp: function () { return true; },
        resolveSafeUploadTempPath: function (path) { return path == 'temp/upload' ? 'safe/temp/upload' : null; },
        multiparty: { Form: Form },
        wait: function () { return Promise.resolve(); }
    });
    return { service: service, state: state, userId: userId, stopped: stopped };
}

function response() {
    return {
        sendStatus: function (status) { this.statusCode = status; },
        status: function (status) { this.statusCode = status; return this; },
        send: function (body) { this.body = body; },
        set: function (name, value) { this.contentType = value; },
        setHeader: function (name, value) { this.headers = { name: name, value: value }; },
        download: function (path) { this.downloadPath = path; },
        end: function (body) { this.body = body; }
    };
}

test('authorized backup requests create and download the generated archive', async function () {
    const fixture = createFixture({ siteadmin: 1 });
    const res = response();
    await fixture.service.handleBackupRequest({ query: {}, session: { userid: fixture.userId } }, res);
    assert.equal(fixture.state.db.performed, true);
    assert.equal(res.downloadPath, 'backup.zip');
    assert.deepEqual(res.headers, { name: 'Content-Type', value: 'application/x-zip-compressed' });
});

test('restore requests accept cookie authentication and validated temporary files', function () {
    const fixture = createFixture({ cookie: { userid: 'user/tenant/admin', domainid: 'tenant' }, fields: { auth: ['cookie'] }, files: { datafile: [{ path: 'temp/upload' }] } });
    const res = response();
    fixture.service.handleRestoreRequest({ query: {}, protocol: 'https', clientIp: '127.0.0.1', get: function () { return 'server.example.com'; } }, res);
    assert.deepEqual(fixture.stopped, ['safe/temp/upload']);
    assert.equal(res.contentType, 'text/html');
});

test('restore requests reject missing files without restarting the server', function () {
    const fixture = createFixture({ files: {} });
    const res = response();
    fixture.service.handleRestoreRequest({ query: {}, session: { userid: fixture.userId }, protocol: 'https', get: function () { return 'server.example.com'; } }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(fixture.stopped, []);
});
