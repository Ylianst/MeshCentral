/**
* @description Characterization tests for web server template rendering helpers
* @license Apache-2.0
*/

"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const renderingModule = require('../webserver/rendering.js');

function createFixture(existingPaths, mobile) {
    const existing = new Set(existingPaths || []);
    const path = { join: function () { return Array.prototype.join.call(arguments, '/'); } };
    const fs = { existsSync: function (filename) { return existing.has(filename); } };
    const rendering = renderingModule.createRendering({
        path: path,
        fs: fs,
        datapath: 'data',
        webViewsPath: 'views',
        webViewsOverridePath: 'override',
        isMobileBrowser: function () { return mobile === true; },
        isWebPageLengthRandomizationEnabled: function () { return false; },
        replacePlaceholders: function (template, values) {
            return template.replace(/\{(\w+)\}/g, function (match, key) { return values[key] !== undefined ? values[key] : match; });
        },
        randomBytes: function () { throw new Error('randomBytes should not be called when randomization is disabled'); },
        getCurrentVersion: function () { return '1.2.4'; },
        getWebServerName: function () { return 'mesh.example.com'; },
        getServerStats: function () {
            return { agentsessions: 2, connectedusers: 3, userssessions: 4, relaysessions: 5, relaycount: 6 };
        }
    });
    return rendering;
}

test('custom asset tags support scoped object configuration', function () {
    const customFiles = {
        global: { scope: ['all'], css: ['global.css'], js: ['global.js'] },
        login: { scope: ['login2'], css: ['login.css'], js: ['login.js'] },
        other: { scope: ['default3'], css: ['other.css'], js: ['other.js'] }
    };

    const css = renderingModule.generateCustomCSSTags(customFiles, 'login2');
    const js = renderingModule.generateCustomJSTags(customFiles, 'login2');

    assert.match(css, /styles\/custom\.css/);
    assert.match(css, /styles\/global\.css/);
    assert.match(css, /styles\/login\.css/);
    assert.doesNotMatch(css, /styles\/other\.css/);
    assert.match(js, /scripts\/custom\.js/);
    assert.match(js, /scripts\/global\.js/);
    assert.match(js, /scripts\/login\.js/);
    assert.doesNotMatch(js, /scripts\/other\.js/);
});

test('getRenderPage respects domain, mobile and minified precedence', function () {
    const rendering = createFixture([
        'domain/login-mobile-min.handlebars',
        'domain/login-min.handlebars',
        'views/login.handlebars'
    ], true);
    const domain = { minify: true, webviewspath: 'domain' };

    assert.equal(rendering.getRenderPage('login', { query: {} }, domain), 'domain/login-mobile-min');
    assert.equal(rendering.getRenderPage('login', { query: { mobile: '0' } }, domain), 'domain/login-min');
});

test('getRenderPage falls back to the default view and returns null when absent', function () {
    const rendering = createFixture(['views/default.handlebars'], false);
    const domain = { minify: false };

    assert.equal(rendering.getRenderPage('default', { query: {} }, domain), 'views/default');
    assert.equal(rendering.getRenderPage('missing', { query: {} }, domain), null);
});

test('getRenderArgs builds titles, custom assets and modern theme assets', function () {
    const rendering = createFixture([
        'data/theme-pack/dark/public/styles/theme.css',
        'data/theme-pack/dark/public/scripts/theme.js'
    ], false);
    const customFiles = encodeURIComponent(JSON.stringify({ login: { scope: ['default3'], css: ['extra.css'], js: ['extra.js'] } }));
    const domain = {
        url: '/domain/',
        title: "Mesh's Console",
        title2: '{serverversion} / {agentsessions}',
        minify: true,
        autocomplete: false,
        hide: 3,
        sitestyle: 3,
        themepack: 'dark'
    };

    const result = rendering.getRenderArgs({ customFiles: customFiles }, { query: {} }, domain, 'default3');

    assert.equal(result.min, '-min');
    assert.equal(result.title, "Mesh's Console");
    assert.equal(result.title2, '1.2.4 / 2');
    assert.equal(result.extitle, "Mesh\\'s%20Console");
    assert.equal(result.domainurl, '/domain/');
    assert.equal(result.autocomplete, 'autocomplete=off x');
    assert.equal(result.hide, 3);
    assert.equal(result.randomlength, '');
    assert.match(result.customCSSTags, /styles\/extra\.css/);
    assert.match(result.customCSSTags, /styles\/theme\.css/);
    assert.match(result.customJSTags, /scripts\/extra\.js/);
    assert.match(result.customJSTags, /scripts\/theme\.js/);
});
