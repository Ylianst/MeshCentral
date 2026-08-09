/**
* @description Unit tests for Mesh agent settings generation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAgentSettings = require('../webserver/agent-settings.js').createAgentSettings;

function createFixture(locked) {
    const meshId = Buffer.from('mesh-id').toString('base64');
    const domain = { id: 'tenant', lockagentdownload: locked };
    const state = {
        args: { port: 443 },
        meshes: { ['mesh/tenant/' + meshId]: { name: 'Main', mtype: 2, domain: 'tenant' } },
        agentCertificateHashBase64: Buffer.from('server-id').toString('base64'),
        common: { isAlphaNumeric: function (value) { return /^[a-z0-9]+$/i.test(value); } },
        getWebServerName: function () { return 'server.example.com'; },
        GetMeshRights: function () { return 1; }
    };
    const parent = { config: { settings: { lockagentdownload: locked } }, decodeCookie: function () { return null; } };
    return { service: createAgentSettings({ state: state, parent: parent, checkAgentColorString: function () { return ''; } }), meshId: meshId, domain: domain };
}

test('locked agent settings reject requests without a session', function () {
    const fixture = createFixture(true);
    assert.equal(fixture.service.getMshFromRequest({ query: { id: fixture.meshId } }, {}, fixture.domain), null);
});

test('agent settings include mesh identity, server URL and validated options', function () {
    const fixture = createFixture(false);
    const result = fixture.service.getMshFromRequest({ query: { id: fixture.meshId, tag: 'branch1', installflags: '2' }, session: {} }, {}, fixture.domain);
    assert.match(result, /MeshName=Main/);
    assert.match(result, /MeshServer=wss:\/\/server\.example\.com:443\/tenant\/agent\.ashx/);
    assert.match(result, /Tag=branch1/);
    assert.match(result, /InstallFlags=2/);
});
