/**
* @description Unit tests for authenticated remote-access pages
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRemotePages = require('../webserver/remote-pages.js').createRemotePages;
const getRemoteCredentialType = require('../webserver/remote-pages.js').getRemoteCredentialType;

test('remote credential detection safely handles null and supported credential forms', function () {
    const userId = 'user/tenant/alice';
    assert.equal(getRemoteCredentialType({ ssh: null }, userId, 'ssh'), 0);
    assert.equal(getRemoteCredentialType({ rdp: null }, userId, 'rdp'), 0);
    assert.equal(getRemoteCredentialType({ ssh: { u: 'user', p: 'pass' } }, userId, 'ssh'), 1);
    assert.equal(getRemoteCredentialType({ ssh: { k: 'key', kp: 'pass' } }, userId, 'ssh'), 2);
    assert.equal(getRemoteCredentialType({ ssh: { k: 'key' } }, userId, 'ssh'), 3);
    assert.equal(getRemoteCredentialType({ ssh: { [userId]: null } }, userId, 'ssh'), 0);
    assert.equal(getRemoteCredentialType({ rdp: { [userId]: { d: 'domain', u: 'user', p: 'pass' } } }, userId, 'rdp'), 1);
});

function createFixture(rights) {
    const renders = [], cookies = [];
    const userId = 'user/tenant/alice';
    const domain = { id: 'tenant', url: '/tenant/' };
    const node = { _id: 'node/tenant/one', meshid: 'mesh/tenant/one', name: '<Terminal>', ssh: null, rdp: null };
    const state = {
        args: { port: 443 },
        users: { [userId]: { _id: userId, name: 'Alice', domain: 'tenant' } },
        db: { Get: function (id, callback) { callback(null, [node]); } },
        getWebServerName: function () { return 'server.example.com'; },
        GetNodeWithRights: function (requestDomain, user, nodeId, callback) { callback(node, rights, true); },
        GetNodeRights: function () { return rights; }
    };
    const parent = {
        config: { settings: {} },
        loginCookieEncryptionKey: 'key',
        debug: function () { },
        decodeCookie: function () { return null; },
        encodeCookie: function (value) { cookies.push(value); return 'cookie-' + cookies.length; }
    };
    const service = createRemotePages({
        state: state,
        parent: parent,
        args: { redirport: 80 },
        getDomain: function () { return domain; },
        checkUserIpAddress: function () { return domain; },
        getQueryPortion: function () { return '?key=value'; },
        render: function (req, res, page, renderArgs) { renders.push({ page: page, args: renderArgs }); },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (renderArgs) { return renderArgs; },
        escapeHtml: function (value) { return value.replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
        remoteControlRight: 8,
        noTerminalRight: 512,
        random: function () { return 0.5; }
    });
    return { service: service, userId: userId, node: node, parent: parent, renders: renders, cookies: cookies };
}

function response() {
    return {
        set: function (headers) { this.headers = headers; },
        redirect: function (url) { this.redirectUrl = url; },
        sendStatus: function (status) { this.status = status; }
    };
}

test('xterm page redirects requests without an authenticated session', function () {
    const fixture = createFixture(8);
    const res = response();
    fixture.service.handleXTermRequest({ query: {} }, res);
    assert.equal(res.redirectUrl, '/tenant/?key=value');
    assert.deepEqual(res.headers, { 'Cache-Control': 'no-store' });
    assert.equal(fixture.renders.length, 0);
});

test('xterm page rejects nodes without terminal permissions', function () {
    const fixture = createFixture(8 | 512);
    const res = response();
    fixture.service.handleXTermRequest({ session: { userid: fixture.userId }, query: { nodeid: 'node/tenant/one' } }, res);
    assert.equal(res.redirectUrl, '/tenant/?key=value');
    assert.equal(fixture.renders.length, 0);
});

test('xterm page renders authorized nodes with scoped authentication cookies', function () {
    const fixture = createFixture(8);
    const res = response();
    fixture.service.handleXTermRequest({ session: { userid: fixture.userId }, query: { nodeid: 'node/tenant/one', key: 'login-key' }, clientIp: '127.0.0.1' }, res);
    assert.deepEqual(fixture.cookies, [
        { userid: fixture.userId, domainid: 'tenant', ip: '127.0.0.1' },
        { ruserid: fixture.userId, domainid: 'tenant' }
    ]);
    assert.equal(fixture.renders[0].page, 'xterm');
    assert.equal(fixture.renders[0].args.serverDnsName, 'server.example.com');
    assert.equal(fixture.renders[0].args.authCookie, 'cookie-1');
    assert.equal(fixture.renders[0].args.authRelayCookie, 'cookie-2');
    assert.equal(fixture.renders[0].args.name, '&lt;Terminal&gt;');
    assert.deepEqual(JSON.parse(decodeURIComponent(fixture.renders[0].args.logoutControls)), { name: 'Alice', logoutUrl: '/tenant/logout?0.5&key=login-key' });
});

test('remote desktop pages render an empty selector when no node is requested', function () {
    const fixture = createFixture(8);
    const res = response();
    fixture.service.handleMSTSCRequest({ session: { userid: fixture.userId }, query: {} }, res, 'ssh');
    assert.equal(fixture.renders[0].page, 'ssh');
    assert.deepEqual(fixture.renders[0].args, { cookie: '', name: '', features: 0 });
});

test('remote desktop pages normalize node IDs and issue scoped relay cookies', function () {
    const fixture = createFixture(8);
    const res = response();
    const req = { session: { userid: fixture.userId }, query: { node: 'one' } };
    fixture.service.handleMSTSCRequest(req, res, 'ssh');
    assert.equal(req.query.node, 'node/tenant/one');
    assert.deepEqual(fixture.cookies[0], { userid: fixture.userId, domainid: 'tenant', nodeid: 'node/tenant/one', tcpport: 22 });
    assert.equal(fixture.renders[0].args.cookie, 'cookie-1');
    assert.equal(fixture.renders[0].args.serverCredentials, 0);
    assert.equal(fixture.renders[0].args.name, '%3CTerminal%3E');
});
