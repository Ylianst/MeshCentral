/**
* @description Unit tests for login-page rendering
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginPageRenderer = require('../webserver/login-page-render.js').createLoginPageRenderer;

test('login page renderer assembles and consumes page state', function () {
    const rendered = [];
    const common = {
        uniqueArray: function (values) { return Array.from(new Set(values)); },
        validateObject: function (value) { return (value != null) && (typeof value == 'object') && !Array.isArray(value); },
        validateString: function (value) { return typeof value == 'string'; },
        validateUrl: function () { return false; },
        replacePlaceholders: function (value) { return value; }
    };
    const state = { users: {}, common: common, getWebServerName: function () { return 'server.example.com'; }, renderLanguages: ['en'] };
    const parent = {
        config: { settings: {} }, certificates: { CommonName: 'server.example.com' }, currentVer: '1.0', debug: function () { },
        webserver: { wsagents: {}, wssessions: {}, wssessions2: {}, relaySessionCount: 0, wsrelays: {} }
    };
    const renderLoginPage = createLoginPageRenderer({
        state: state, parent: parent, args: { port: 443 }, captcha: { createNewAccountCookie: function () { return 'captcha'; } },
        render: function () { rendered.push(Array.from(arguments)); }, getRenderPage: function (page) { return page; }, getRenderArgs: function (value) { return value; },
        getRootCertLink: function () { return 'certificate'; }, escapeHtml: function (value) { return value; }
    });
    const request = { session: { loginmode: 1, messageid: 2, flash: { error: ['denied', 'denied'] } }, query: {} };
    renderLoginPage(request, {}, { id: 'tenant', sitestyle: 3, url: '/tenant/' }, '', 'requirements');

    assert.equal(rendered.length, 1);
    assert.equal(rendered[0][2], 'login2');
    assert.equal(rendered[0][3].loginmode, 1);
    assert.equal(rendered[0][3].messageid, 2);
    assert.equal(rendered[0][3].flashErrors, '[\\"denied\\"]');
    assert.equal(rendered[0][3].rootCertLink, 'certificate');
    assert.equal(rendered[0][3].passRequirements, 'requirements');
    assert.deepEqual(rendered[0][3].renderLanguages, ['en']);
    assert.equal(request.session.loginmode, undefined);
    assert.equal(request.session.flash, null);
});
