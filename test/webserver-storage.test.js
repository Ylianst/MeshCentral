/**
* @description Unit tests for web server storage paths and quotas
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createStorage = require('../webserver/storage.js').createStorage;

function createFixture(fs) {
    const users = {
        'user/domain/alice': { _id: 'user/domain/alice', siteadmin: 0, quota: 100 },
        'user/domain/admin': { _id: 'user/domain/admin', siteadmin: 0xFFFFFFFF }
    };
    const meshes = { 'mesh/domain/group': { _id: 'mesh/domain/group', quota: 200 } };
    return createStorage({
        fs: fs || {},
        path: path,
        filespath: path.resolve('files'),
        common: { IsFilenameValid: function (name) { return (name.length > 0) && !name.includes('..') && !name.includes('\\'); } },
        users: users,
        meshes: meshes,
        os: { platform: function () { return 'win32'; }, tmpdir: function () { return path.resolve('system-temp'); } },
        getMeshRights: function () { return 32; }
    });
}

test('storage quotas prefer object overrides and exempt administrators', function () {
    const storage = createFixture();
    assert.equal(storage.getQuota('user/domain/alice', { userquota: 50 }), 100);
    assert.equal(storage.getQuota('user/domain/admin', { userquota: 50 }), null);
    assert.equal(storage.getQuota('mesh/domain/group', { meshquota: 50 }), 200);
    assert.equal(storage.getQuota('user/domain/missing', {}), 0);
});

test('server file paths enforce ownership, domains and valid names', function () {
    const storage = createFixture();
    const user = { _id: 'user/domain/alice' };
    const result = storage.getServerFilePath(user, { id: 'domain' }, 'user/domain/alice/docs/file.txt');
    assert.equal(result.name, 'file.txt');
    assert.equal(result.quota, 100);
    assert.equal(storage.getServerFilePath(user, { id: 'other' }, 'user/domain/alice/file.txt'), null);
    assert.equal(storage.getServerFilePath(user, { id: 'domain' }, 'user/domain/bob/file.txt'), null);
    assert.equal(storage.getServerFilePath(user, { id: 'domain' }, 'user/domain/alice/../secret'), null);
});

test('root paths are available through the public storage API', function () {
    const storage = createFixture();
    assert.equal(storage.getServerRootFilePath({ _id: 'user/domain/alice', domain: 'domain' }), path.join(path.resolve('files'), 'domain-domain', 'user-alice'));
    assert.equal(storage.getServerRootFilePath({ _id: 'invalid', domain: 'domain' }), null);
});

test('upload temp paths are constrained to configured temporary roots', function () {
    const storage = createFixture();
    const systemTempFile = path.join(path.resolve('system-temp'), 'upload.tmp');
    const filesTempFile = path.join(path.resolve('files'), 'tmp', 'upload.tmp');
    assert.equal(storage.resolveSafeUploadTempPath(systemTempFile), path.normalize(systemTempFile));
    assert.equal(storage.resolveSafeUploadTempPath(filesTempFile), path.normalize(filesTempFile));
    assert.equal(storage.resolveSafeUploadTempPath(path.resolve('outside', 'upload.tmp')), null);
});

test('recursive size and deletion operate through the injected filesystem', function () {
    const entries = { root: ['a', 'sub'], [path.join('root', 'sub')]: ['b'] };
    const files = new Set([path.join('root', 'a'), path.join('root', 'sub', 'b')]);
    const removed = [];
    const fs = {
        readdirSync: function (folder) { return entries[folder]; },
        statSync: function (entry) { return files.has(entry) ? { mode: 0, size: entry.endsWith('a') ? 3 : 4 } : { mode: 0x004000, size: 0 }; },
        existsSync: function () { return true; },
        lstatSync: function (entry) { return { isDirectory: function () { return !files.has(entry); } }; },
        unlinkSync: function (entry) { removed.push(entry); },
        rmdirSync: function (entry) { removed.push(entry); }
    };
    const storage = createFixture(fs);
    assert.equal(storage.readTotalFileSize('root'), 7);
    storage.deleteFolderRec('root');
    assert.deepEqual(removed, [path.join('root', 'a'), path.join('root', 'sub', 'b'), path.join('root', 'sub'), 'root']);
});
