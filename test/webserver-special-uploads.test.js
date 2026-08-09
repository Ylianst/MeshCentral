/**
* @description Unit tests for MeshCore and recovery uploads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSpecialUploads = require('../webserver/special-uploads.js').createSpecialUploads;

function createFixture(settings) {
    settings = settings || {};
    const userId = 'user//admin';
    const coreCalls = [];
    const events = [];
    const removed = [];
    function Form() { }
    Form.prototype.parse = function (req, callback) { callback(null, settings.fields || { attrib: ['node//node1'] }, settings.files || { files: [{ path: 'temp/core.js' }] }); };
    const state = {
        users: { [userId]: { _id: userId, name: 'Admin' } },
        common: { IntToStr: function () { return 'HEAD'; } },
        fs: {
            readFile: function (file, encoding, callback) { callback(null, 'CORE'); },
            unlinkSync: function (file) { removed.push(file); }
        },
        GetNodeWithRights: function (domain, user, nodeId, callback) { callback({ _id: nodeId }, 0xFFFFFFFF, true); },
        sendMeshAgentCore: function () { coreCalls.push(Array.from(arguments)); }
    };
    const parent = {
        loginCookieEncryptionKey: 'key',
        decodeCookie: settings.decodeCookie || function () { return null; },
        DispatchEvent: function () { events.push(Array.from(arguments)); }
    };
    const service = createSpecialUploads({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return settings.domain || { id: '' }; },
        checkCookieIp: function () { return true; },
        resolveSafeUploadTempPath: function (file) { return file.startsWith('temp/') ? file : null; },
        multiparty: { Form: Form }
    });
    return { service: service, userId: userId, coreCalls: coreCalls, events: events, removed: removed };
}

function response() { return { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } }; }

test('MeshCore uploads require the root domain and full node rights', function () {
    const denied = createFixture({ domain: { id: 'tenant' } });
    const deniedResponse = response();
    denied.service.uploadMeshCore({ session: { userid: denied.userId } }, deniedResponse);
    assert.equal(deniedResponse.status, 401);

    const fixture = createFixture();
    const res = response();
    fixture.service.uploadMeshCore({ session: { userid: fixture.userId } }, res);
    assert.equal(res.body, '');
    assert.equal(fixture.coreCalls.length, 1);
    assert.equal(fixture.coreCalls[0][4], 'HEADCORE');
    assert.deepEqual(fixture.removed, ['temp/core.js']);
});

test('One Click Recovery dispatches the validated temporary path', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.uploadOneClickRecovery({ session: { userid: fixture.userId } }, res);
    assert.equal(res.body, '');
    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0][2].action, 'oneclickrecovery');
    assert.equal(fixture.events[0][2].file, 'temp/core.js');
});

test('multipart authentication cookies remain bound to the request IP', function () {
    const fixture = createFixture({
        fields: { attrib: ['node//node1'], auth: ['cookie'] },
        decodeCookie: function () { return { userid: 'user//admin', domainid: '', ip: '10.0.0.1' }; }
    });
    const userId = fixture.service.getAuthenticatedUserId({ clientIp: '10.0.0.1' }, { auth: ['cookie'] }, { id: '' });
    assert.equal(userId, 'user//admin');
});
