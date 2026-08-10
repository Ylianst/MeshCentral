/**
* @description Unit tests for terms-of-service rendering
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const createTerms = require('../../../webserver/ui/terms.js').createTerms;

function createFixture(settings) {
    settings = settings || {};
    const domain = { id: 'tenant', url: '/tenant/' };
    const termsPath = path.join('data', 'terms.txt');
    const state = {
        path: path,
        args: {},
        users: settings.users || {},
        fs: {
            existsSync: function (file) { return settings.fileTerms != null && file === termsPath; },
            readFile: function (file, encoding, callback) { callback(null, settings.fileTerms); }
        }
    };
    const parent = { datapath: 'data', configurationFiles: settings.configurationFiles, debug: function () { } };
    const service = createTerms({
        state: state,
        parent: parent,
        checkUserIpAddress: function () { return domain; },
        getQueryPortion: function () { return '?return=1'; },
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
        redirect: function (url) { this.redirectUrl = url; }
    };
}

test('configured terms are rendered without caching', function () {
    const fixture = createFixture({ configurationFiles: { 'terms.txt': Buffer.from("Terms' text") } });
    const res = response();
    fixture.service.handleRequest({ query: {} }, res);
    assert.deepEqual(res.headers, { 'Cache-Control': 'no-store' });
    assert.equal(res.rendered.page, 'terms');
    assert.equal(res.rendered.args.terms, encodeURIComponent('Terms text').replace('Terms%20text', "Terms\\'%20text"));
    assert.deepEqual(JSON.parse(decodeURIComponent(res.rendered.args.logoutControls)), {});
});

test('data-path terms include logout controls for active users', function () {
    const userId = 'user/tenant/alice';
    const fixture = createFixture({ fileTerms: 'File terms', users: { [userId]: { name: 'Alice' } } });
    const res = response();
    fixture.service.handleRequest({ query: { key: 'abc' }, session: { userid: userId } }, res);
    assert.equal(res.rendered.args.terms, 'File%20terms');
    const controls = JSON.parse(decodeURIComponent(res.rendered.args.logoutControls));
    assert.equal(controls.name, 'Alice');
    assert.match(controls.logoutUrl, /^\/tenant\/logout\?/);
    assert.match(controls.logoutUrl, /&key=abc$/);
});

test('sessions from another domain are cleared and redirected', function () {
    const fixture = createFixture({ configurationFiles: { 'terms.txt': Buffer.from('Terms') } });
    const req = { query: {}, session: { userid: 'user/other/alice' } };
    const res = response();
    fixture.service.handleRequest(req, res);
    assert.equal(req.session, null);
    assert.equal(res.redirectUrl, '/tenant/?return=1');
});
