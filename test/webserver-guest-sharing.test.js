/**
* @description Unit tests for guest device-sharing handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createGuestSharing = require('../webserver/guest-sharing.js').createGuestSharing;

function createFixture(settings) {
    settings = settings || {};
    const domain = { id: 'tenant', url: '/tenant/' };
    const encoded = [];
    const shareCookie = settings.cookie || { a: 6, pid: 'share1' };
    const shareDocument = { p: 1, userid: 'user/tenant/alice', nodeid: 'node/tenant/node1', guestName: 'Guest', consent: 1, publicid: 'share1' };
    const state = {
        args: { port: 443, allowhighqualitydesktop: true },
        getWebServerName: function () { return 'console.example.com'; },
        db: {
            Get: function (id, callback) {
                if (id.startsWith('deviceshare-')) callback(null, settings.shareDocuments || [shareDocument]);
                else callback(null, [{ _id: id, name: 'Workstation' }]);
            },
            GetAllTypeNodeFiltered: function (nodes, domainId, type, filter, callback) { callback(null, [{ publicid: shareDocument.publicid }]); }
        }
    };
    const parent = {
        invitationLinkEncryptionKey: 'invite-key',
        loginCookieEncryptionKey: 'login-key',
        decodeCookie: function () { return shareCookie; },
        encodeCookie: function (value) { encoded.push(value); return 'auth-cookie'; },
        debug: function () { }
    };
    const service = createGuestSharing({
        state: state,
        parent: parent,
        args: { port: 443, redirport: 80 },
        getDomain: function () { return domain; },
        render: function (req, res, page, args) { res.rendered = { page: page, args: args }; },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; }
    });
    return { service: service, domain: domain, encoded: encoded };
}

function response() {
    return {
        set: function (headers) { this.headers = headers; },
        status: function (status) { this.statusCode = status; return this; },
        sendStatus: function (status) { this.statusCode = status; },
        redirect: function (url) { this.redirectUrl = url; }
    };
}

test('recurring shares advance to the next daily validity window', function () {
    const fixture = createFixture();
    const day = 24 * 60 * 60 * 1000;
    const doc = { recurring: 1, startTime: 1000, duration: 30 };
    fixture.service.advanceRecurringShare(doc, 1000 + day + (31 * 60000));
    assert.equal(doc.startTime, 1000 + (2 * day));
});

test('share documents use userid and mark only anonymous links as anonymous', function () {
    const fixture = createFixture();
    const named = fixture.service.createShareContext({ p: 1, guestName: 'Guest', nodeid: 'node/tenant/1', consent: 1, publicid: 'AS:node/1', userid: 'user/tenant/alice' });
    assert.equal(named.userid, 'user/tenant/alice');
    assert.equal(named.nouser, undefined);
    const anonymous = fixture.service.createShareContext({ p: 1, guestName: 'Guest', nodeid: 'node/tenant/1', consent: 1, publicid: 'AS:node/1' });
    assert.equal(anonymous.nouser, 1);
});

test('valid sharing documents render the guest viewer', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.handleRequest({ query: { c: 'cookie' }, clientIp: '127.0.0.1' }, res);
    assert.equal(res.rendered.page, 'sharing');
    assert.equal(res.rendered.args.authCookie, 'auth-cookie');
    assert.equal(res.rendered.args.nodeName, 'Workstation');
    assert.equal(res.rendered.args.features2, 1);
    assert.deepEqual(res.headers, { 'Cache-Control': 'no-store' });
});

test('expired guest links render the expiration message', function () {
    const fixture = createFixture({ cookie: { a: 6, pid: 'share1', e: 1 } });
    const res = response();
    fixture.service.handleRequest({ query: { c: 'cookie' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.rendered.args.msgid, 12);
});
