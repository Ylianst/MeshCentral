/**
* @description Unit tests for authenticated remote-access pages
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRemotePages = require('../webserver/remote-pages.js').createRemotePages;

function createFixture(rights) {
    const renders = [], cookies = [];
    const userId = 'user/tenant/alice';
    const domain = { id: 'tenant', url: '/tenant/' };
    const state = {
        args: { port: 443 },
        users: { [userId]: { _id: userId, name: 'Alice' } },
        getWebServerName: function () { return 'server.example.com'; },
        GetNodeWithRights: function (requestDomain, user, nodeId, callback) { callback({ _id: nodeId, name: '<Terminal>' }, rights, true); }
    };
    const parent = {
        loginCookieEncryptionKey: 'key',
        debug: function () { },
        encodeCookie: function (value) { cookies.push(value); return 'cookie-' + cookies.length; }
    };
    const service = createRemotePages({
        state: state,
        parent: parent,
        args: { redirport: 80 },
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
    return { service: service, userId: userId, renders: renders, cookies: cookies };
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
