/**
* @description Unit tests for MeshMessenger handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createMessenger = require('../webserver/messenger.js').createMessenger;

function createFixture(settings) {
    settings = settings || {};
    const existing = new Set(settings.existing || []);
    const domain = Object.assign({ id: 'tenant', url: '/tenant/' }, settings.domain);
    const state = {
        users: settings.users || {},
        path: path,
        common: { joinPath: function () { return Array.from(arguments).join('/'); } },
        fs: { exists: function (file, callback) { callback(existing.has(file)); } }
    };
    const parent = {
        datapath: 'data',
        webPublicPath: 'public',
        webPublicOverridePath: settings.overridePath,
        config: { settings: settings.serverSettings || {} },
        debug: function () { }
    };
    const service = createMessenger({
        state: state,
        parent: parent,
        args: settings.args || {},
        getDomain: function () { return domain; },
        render: function (req, res, page, args) { res.rendered = { page: page, args: args }; },
        getRenderPage: function (page) { return page; },
        getRenderArgs: function (args) { return args; }
    });
    return { service: service, domain: domain };
}

function response() {
    return {
        set: function (headers) { this.headers = headers; },
        sendStatus: function (status) { this.status = status; },
        redirect: function (url) { this.redirectUrl = url; },
        sendFile: function (file) { this.file = file; }
    };
}

test('user-to-user messenger links redirect anonymous visitors to login', function () {
    const fixture = createFixture();
    const id = 'meshmessenger/user/tenant/alice/user/tenant/bob';
    const res = response();
    fixture.service.handlePage({ query: { id: id, key: 'secret' } }, res);
    assert.equal(res.redirectUrl, '/tenant/?key=secret&meshmessengerid=' + encodeURIComponent(id));
});

test('messenger pages expose WebRTC and participant title data', function () {
    const userId = 'user/tenant/alice';
    const fixture = createFixture({
        domain: { meshmessengertitle: 'Chat with {0} ({1})' },
        users: { [userId]: { name: 'alice', realname: 'Alice Smith' } },
        serverSettings: { webrtcconfig: { iceServers: [] } }
    });
    const res = response();
    fixture.service.handlePage({ query: { id: 'meshmessenger/node/tenant/node1/user/tenant/alice' } }, res);
    assert.equal(res.rendered.page, 'messenger');
    assert.equal(res.rendered.args.username, 'Alice%20Smith');
    assert.equal(res.rendered.args.userid, 'alice');
    assert.equal(JSON.parse(decodeURIComponent(res.rendered.args.webrtcconfig)).iceServers.length, 0);
    assert.deepEqual(res.headers, { 'Cache-Control': 'no-store' });
});

test('messenger images fall back through domain and default assets', function () {
    const customFile = path.join('domain-public', 'images/messenger.png');
    const fixture = createFixture({ domain: { webpublicpath: 'domain-public' }, existing: [customFile] });
    const res = response();
    fixture.service.handleImage({}, res);
    assert.equal(res.file, customFile);

    const defaultFixture = createFixture();
    const defaultResponse = response();
    defaultFixture.service.handleImage({}, defaultResponse);
    assert.equal(defaultResponse.file, path.join('public', 'images/messenger.png'));
});
