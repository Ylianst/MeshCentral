/**
* @description Unit tests for agent file transfer handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createAgentFileTransfer = require('../../../webserver/agents/agent-file-transfer.js').createAgentFileTransfer;

function createFixture(settings) {
    settings = settings || {};
    const sent = [], handlers = {};
    const ws = {
        send: function (message) { sent.push(message); },
        close: function () { this.closed = true; },
        on: function (event, callback) { handlers[event] = callback; }
    };
    const state = {
        path: path,
        common: { makeFilename: function (value) { return value.replace(/[\\/]/g, ''); } },
        fs: {
            existsSync: function () { return true; },
            mkdirSync: function () { },
            open: function (file, mode, callback) { callback(settings.openError || null, settings.openError ? null : 42); },
            write: function () { },
            close: function () { },
            rename: function () { },
            unlink: function () { }
        }
    };
    const parent = {
        datapath: 'data',
        loginCookieEncryptionKey: 'key',
        debug: function () { },
        decodeCookie: function () { return settings.cookie || null; }
    };
    const service = createAgentFileTransfer({ state: state, parent: parent, checkAgentIpAddress: function () { return settings.invalidDomain ? null : { id: 'tenant' }; } });
    const req = { query: { c: 'cookie' }, clientIp: '127.0.0.1' };
    return { service: service, ws: ws, req: req, sent: sent, handlers: handlers };
}

test('agent file transfers reject invalid cookies', function () {
    const fixture = createFixture();
    fixture.service.handleAgentFileTransfer(fixture.ws, fixture.req);
    assert.equal(fixture.ws.closed, true);
    assert.deepEqual(fixture.sent, []);
});

test('core dump transfers normalize path separators in filenames', function () {
    const fixture = createFixture({ cookie: { a: 'aft', b: 'coredump', c: 'agent-node/tenant/id.dmp' } });
    fixture.service.handleAgentFileTransfer(fixture.ws, fixture.req);
    assert.equal(path.basename(fixture.ws.xfilepath), 'agent-nodetenantid.dmp');
    assert.equal(fixture.sent[0], 'c');
    assert.equal(fixture.sent[1], '5');
    assert.equal(JSON.parse(fixture.sent[2]).sub, 'start');
});

test('core dump transfers close without acknowledging failed file opens', function () {
    const fixture = createFixture({ cookie: { a: 'aft', b: 'coredump', c: 'dump.dmp' }, openError: new Error('disk full') });
    fixture.service.handleAgentFileTransfer(fixture.ws, fixture.req);
    fixture.handlers.message.call(fixture.ws, JSON.stringify({ action: 'download', sub: 'start' }));
    assert.equal(fixture.ws.closed, true);
    assert.equal(fixture.sent.some(function (message) { try { return JSON.parse(message).sub == 'startack'; } catch (ex) { return false; } }), false);
});

test('core dump transfers acknowledge successful file opens', function () {
    const fixture = createFixture({ cookie: { a: 'aft', b: 'coredump', c: 'dump.dmp' } });
    fixture.service.handleAgentFileTransfer(fixture.ws, fixture.req);
    fixture.handlers.message.call(fixture.ws, JSON.stringify({ action: 'download', sub: 'start' }));
    assert.equal(fixture.ws.xfile, 42);
    assert.equal(JSON.parse(fixture.sent[3]).sub, 'startack');
});
