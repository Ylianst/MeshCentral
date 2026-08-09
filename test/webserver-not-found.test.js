/**
* @description Unit tests for domain-aware not-found responses
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createNotFound = require('../webserver/not-found.js').createNotFound;

function createResponse() {
    return {
        sendStatus: function (status) { this.sentStatus = status; },
        set: function (headers) { this.headers = headers; },
        status: function (status) { this.responseStatus = status; return this; },
        render: function (page, args) { this.rendered = [page, args]; }
    };
}

test('nice 404 renders the modern domain template with a CSP nonce', function () {
    const domain = { sitestyle: 2 };
    const service = createNotFound({
        args: {},
        crypto: { randomBytes: function () { return Buffer.from('nonce'); } },
        getDomain: function () { return domain; },
        getRenderPage: function (name) { return name; },
        getRenderArgs: function (args) { return args; },
        debug: function () { }
    });
    const res = createResponse();
    service.nice404({ url: '/missing', query: {} }, res);
    assert.equal(res.responseStatus, 404);
    assert.equal(res.rendered[0], 'error4042');
    assert.ok(res.headers['Content-Security-Policy'].includes(res.rendered[1].cspNonce));
});

test('SSPI domains and disabled nice pages return a plain 404', function () {
    const req = { url: '/missing', query: {} };
    let domain = { auth: 'sspi' };
    const options = { args: {}, crypto: {}, getDomain: function () { return domain; }, getRenderPage: function () { }, getRenderArgs: function () { }, debug: function () { } };
    const service = createNotFound(options);
    const first = createResponse();
    service.nice404(req, first);
    assert.equal(first.sentStatus, 404);
    domain = {};
    options.args.nice404 = false;
    const second = createResponse();
    service.nice404(req, second);
    assert.equal(second.sentStatus, 404);
});

test('login-key domains hide the nice page without a valid key', function () {
    const service = createNotFound({ args: {}, crypto: {}, getDomain: function () { return { loginkey: ['valid'] }; }, getRenderPage: function () { }, getRenderArgs: function () { }, debug: function () { } });
    const res = createResponse();
    service.nice404({ url: '/missing', query: { key: 'invalid' } }, res);
    assert.equal(res.sentStatus, 404);
});
