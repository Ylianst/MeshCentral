/**
* @description Unit tests for CAPTCHA handlers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createCaptcha = require('../../../../webserver/auth/account/captcha.js').createCaptcha;

function createFixture(settings) {
    settings = settings || {};
    const domain = settings.domain || { id: 'tenant', newaccountscaptcha: true };
    const encoded = [];
    function svgCaptcha(text) { return '<svg>' + text + '</svg>'; }
    svgCaptcha.randomText = function (length) { assert.equal(length, 5); return 'ABCDE'; };
    const parent = {
        loginCookieEncryptionKey: 'key',
        encodeCookie: function (value, key) { encoded.push({ value: value, key: key }); return 'encoded'; },
        decodeCookie: settings.decodeCookie || function () { return { type: 'newAccount', captcha: 'ABCDE' }; },
        crowdSecBounser: settings.crowdSecBounser
    };
    const service = createCaptcha({ parent: parent, checkUserIpAddress: function () { return domain; }, svgCaptcha: svgCaptcha });
    return { service: service, parent: parent, domain: domain, encoded: encoded };
}

function response() {
    return {
        sendStatus: function (status) { this.statusCode = status; },
        type: function (type) { this.contentType = type; return this; },
        status: function (status) { this.statusCode = status; return this; },
        end: function (body) { this.body = body; },
        redirect: function (path) { this.redirectPath = path; }
    };
}

test('new-account CAPTCHA cookies contain a five-character challenge', function () {
    const fixture = createFixture();
    assert.equal(fixture.service.createNewAccountCookie(), 'encoded');
    assert.deepEqual(fixture.encoded, [{ value: { type: 'newAccount', captcha: 'ABCDE' }, key: 'key' }]);
});

test('new-account CAPTCHA renders only a valid signed challenge', function () {
    const fixture = createFixture();
    const res = response();
    fixture.service.handleNewAccount({ query: { x: 'cookie' } }, res);
    assert.equal(res.contentType, 'svg');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, '<svg>ABCDE</svg>');

    const invalid = createFixture({ decodeCookie: function () { return { type: 'other', captcha: 'ABCDE' }; } });
    const invalidResponse = response();
    invalid.service.handleNewAccount({ query: { x: 'cookie' } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 404);
});

test('CrowdSec CAPTCHA redirects to the current domain root', function () {
    const bouncer = { applyCaptcha: function (req, res, callback) { callback(); } };
    const fixture = createFixture({ crowdSecBounser: bouncer });
    const getResponse = response();
    fixture.service.handleGet({}, getResponse);
    assert.equal(getResponse.redirectPath, '/tenant');

    const postRequest = {};
    const postResponse = response();
    fixture.service.handlePost(postRequest, postResponse);
    assert.equal(postRequest.originalUrl, '/tenant');
    assert.equal(postResponse.redirectPath, '/tenant');
});

test('CAPTCHA service does not load the optional renderer until it is needed', function () {
    const service = createCaptcha({
        parent: {},
        checkUserIpAddress: function () { return { id: 'tenant' }; }
    });
    const res = response();
    service.handleGet({}, res);
    assert.equal(res.statusCode, 404);
});
