/**
* @description Unit tests for agent invitation handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAgentInvitations = require('../webserver/agent-invitations.js').createAgentInvitations;

function createFixture() {
    const renders = [], cookies = [];
    const domain = { id: 'tenant', url: '/tenant/', agentinvitecodes: true };
    const meshId = 'mesh/tenant/one';
    const state = {
        args: { port: 443 },
        meshes: { [meshId]: { _id: meshId, domain: 'tenant', name: 'Main Group', invite: { codes: ['valid-code'], flags: 3, ag: 2 } } },
        agentCertificateHashBase64: 'certificate-hash',
        getWebServerName: function () { return 'server.example.com'; }
    };
    const parent = {
        invitationLinkEncryptionKey: 'key',
        debug: function () { },
        encodeCookie: function (value) { cookies.push(value); return 'encoded-cookie'; },
        decodeCookie: function () { return null; }
    };
    const service = createAgentInvitations({
        state: state,
        parent: parent,
        args: state.args,
        getDomain: function () { return domain; },
        nice404: function (req, res) { res.status = 404; },
        render: function (req, res, page, args) { renders.push({ page: page, args: args }); },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; }
    });
    return { service: service, state: state, parent: parent, domain: domain, renders: renders, cookies: cookies };
}

function response() {
    return {
        sendStatus: function (status) { this.status = status; },
        redirect: function (url) { this.redirectUrl = url; }
    };
}

test('invite-code page distinguishes empty and invalid codes', function () {
    const fixture = createFixture();
    fixture.service.handleInviteRequest({ query: {}, body: {} }, response());
    fixture.service.handleInviteRequest({ query: {}, body: { inviteCode: 'invalid' } }, response());
    assert.deepEqual(fixture.renders.map(function (entry) { return entry.args.messageid; }), [0, 100]);
});

test('valid invite codes redirect with a short-lived mesh invitation cookie', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.handleInviteRequest({ query: { key: 'login-key', hide: '1' }, body: { inviteCode: 'valid-code' } }, res);
    assert.deepEqual(fixture.cookies[0], { a: 4, mid: 'mesh/tenant/one', f: 3, ag: 2, expire: 1 });
    assert.equal(res.redirectUrl, '/tenant/agentinvite?c=encoded-cookie&key=login-key&hide=1');
});

test('agent invitation query parses show-agents independently from install flags', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.handleAgentInviteRequest({ query: { m: 'ONE', ag: '2' } }, res);
    assert.equal(fixture.renders.length, 1);
    assert.equal(fixture.renders[0].page, 'agentinvite');
    assert.equal(fixture.renders[0].args.installflags, 0);
    assert.equal(fixture.renders[0].args.showagents, 2);
    assert.equal(fixture.renders[0].args.magenturl, 'mc://server.example.com/tenant,certificate-hash,one');
    assert.deepEqual(fixture.cookies[0], { m: 'one' });
});
