/**
* @description Unit tests for macOS MeshAgent installer downloads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handleArchiveError = require('../webserver/macos-agent-download.js').handleArchiveError;
const createMacOsAgentHandler = require('../webserver/macos-agent-download.js').createMacOsAgentHandler;

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

test('macOS agent downloads build customized flat installer archives', async function () {
    const meshId = Buffer.from('mesh-id').toString('base64');
    const appended = [], installerOptions = [], headers = [];
    const archive = {
        on: function (event, callback) { this.errorHandler = callback; },
        pipe: function (response) { this.response = response; },
        append: function (data, options) { appended.push([data, options]); },
        finalize: function () { this.finalized = true; }
    };
    const state = { meshes: { ['mesh/tenant/' + meshId]: { name: 'Main[Group]' } } };
    const parent = { config: { settings: {} }, meshAgentBinaries: { 6: { path: 'meshagent' } }, path: { join: function () { return Array.from(arguments).join('/'); } }, datapath: 'data', debug: function () { } };
    const domain = { id: 'tenant', agentcustomization: { filename: 'CompanyAgent', displayname: 'Company Agent', servicename: 'companyagent', companyname: 'Company' } };
    const handler = createMacOsAgentHandler({
        state: state,
        parent: parent,
        getDomain: function () { return domain; },
        getMshFromRequest: function (request) { assert.equal(request.query.id, meshId); return '\r\nMeshName=Main\r\n'; },
        setContentDispositionHeader: function (response, type, filename) { headers.push(filename); },
        isAgentDownloadLocked: function () { return false; },
        hasUserSession: function () { return false; },
        createArchive: function () { return archive; },
        createInstaller: function (options) { installerOptions.push(options); return Promise.resolve({ pkg: 'package', uninstall: 'uninstall' }); }
    });
    const res = { sendStatus: function (status) { this.status = status; } };
    handler({ query: { id: 6, meshid: meshId } }, res);
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.deepEqual(headers, ['CompanyAgent-Main[Group].zip']);
    assert.equal(installerOptions[0].meshName, 'MainGroup');
    assert.equal(installerOptions[0].packageName, 'CompanyAgent.pkg');
    assert.deepEqual(appended.map(function (item) { return item[1].name; }), ['CompanyAgent.pkg', 'Uninstall.command']);
    assert.equal(archive.finalized, true);
});

test('macOS agent downloads reject locked requests without sessions', function () {
    const handler = createMacOsAgentHandler({
        state: {},
        parent: { config: { settings: {} }, debug: function () { } },
        getDomain: function () { return { id: '' }; },
        isAgentDownloadLocked: function () { return true; },
        hasUserSession: function () { return false; }
    });
    const res = { sendStatus: function (status) { this.status = status; } };
    handler({ query: { id: 6 } }, res);
    assert.equal(res.status, 401);
});
