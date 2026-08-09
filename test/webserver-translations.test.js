/**
* @description Unit tests for the administrative translation handler
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createTranslations = require('../webserver/translations.js').createTranslations;

function createFixture(settings) {
    settings = settings || {};
    const userId = 'user/tenant/admin';
    const existing = new Set(settings.existing || []);
    const writes = [];
    const state = {
        path: path,
        args: {},
        users: { [userId]: { _id: userId, siteadmin: settings.siteadmin == null ? 0xFFFFFFFF : settings.siteadmin } },
        common: { translationsToJson: function (value) { return JSON.stringify(value); } },
        fs: {
            existsSync: function (file) { return existing.has(file); },
            writeFile: function (file, data, callback) { writes.push({ file: file, data: data }); callback(settings.writeError || null); }
        }
    };
    const service = createTranslations({
        state: state,
        parent: { datapath: 'data', debug: function () { } },
        serverRoot: 'server',
        checkUserIpAddress: function () { return { id: 'tenant' }; },
        checkIpAddressEx: function () { return true; },
        runtime: { version: 'v20.0', argv: ['node'] }
    });
    return { service: service, state: state, userId: userId, writes: writes };
}

function request(userId, body) {
    return {
        session: { userid: userId },
        setEncoding: function () { },
        on: function (event, callback) {
            if (event === 'data') callback(JSON.stringify(body));
            if (event === 'end') callback();
        }
    };
}

function response() {
    return {
        sendStatus: function (status) { this.status = status; },
        sendFile: function (file) { this.file = file; },
        send: function (body) { this.body = body; }
    };
}

test('translation downloads prefer the data-path override', function () {
    const customFile = path.join('data', 'translate.json');
    const fixture = createFixture({ existing: [customFile, path.join('server', 'translate', 'translate.json')] });
    const res = response();
    fixture.service.handleRequest(request(fixture.userId, { action: 'getTranslations' }), res);
    assert.equal(res.file, customFile);
});

test('translation updates serialize strings into the data path', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.handleRequest(request(fixture.userId, { action: 'setTranslations', strings: ['one'] }), res);
    assert.deepEqual(fixture.writes, [{ file: path.join('data', 'translate.json'), data: JSON.stringify({ strings: ['one'] }) }]);
    assert.deepEqual(JSON.parse(res.body), { response: 'ok' });
});

test('translation administration requires a full site administrator', function () {
    const fixture = createFixture({ siteadmin: 1 });
    const res = response();
    fixture.service.handleRequest(request(fixture.userId, { action: 'getTranslations' }), res);
    assert.equal(res.status, 401);
});
