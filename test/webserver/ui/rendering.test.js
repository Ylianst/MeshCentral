/**
* @description Characterization tests for web server template rendering helpers
* @license Apache-2.0
*/

"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const renderingModule = require('../../../webserver/ui/rendering.js');

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

function createLanguageFixture() {
    const existing = new Set([
        'root/views/translations',
        'override/translations',
        'root/emails/translations',
        'email-override/translations',
        'override/translations/default_fr.handlebars',
        'root/views/translations/default_zh-chs.handlebars'
    ]);
    const directoryFiles = {
        'root/views/translations': ['default_fr.handlebars', 'default_zh-chs.handlebars', 'ignored.txt'],
        'override/translations': ['default_fr.handlebars'],
        'root/emails/translations': ['account_fr.html', 'account_de.html', 'ignored.txt'],
        'email-override/translations': ['account_es.html']
    };
    const path = {
        join: function () { return Array.prototype.join.call(arguments, '/'); },
        basename: function (filename) { return filename.substring(filename.lastIndexOf('/') + 1); }
    };
    const fs = {
        existsSync: function (filename) { return existing.has(filename); },
        readdirSync: function (directory) { return directoryFiles[directory] || []; },
        exists: function (filename, callback) { callback(existing.has(filename)); }
    };
    const users = { 'user/domain/alice': { _id: 'user/domain/alice', lang: 'ES' } };
    const savedUsers = [];
    const state = {};
    const rendering = renderingModule.createRendering({
        path: path,
        fs: fs,
        datapath: 'data',
        serverRoot: 'root',
        webViewsPath: 'views',
        webViewsOverridePath: 'override',
        webEmailsOverridePath: 'email-override',
        domains: { domain: { id: 'domain' } },
        users: users,
        db: { SetUser: function (user) { savedUsers.push(user); } },
        isMobileBrowser: function () { return false; },
        isWebPageLengthRandomizationEnabled: function () { return false; },
        getDomain: function () { return { id: 'domain' }; },
        replacePlaceholders: function (template) { return template; },
        randomBytes: function () { return Buffer.alloc(0); },
        getCurrentVersion: function () { return '1.2.4'; },
        getWebServerName: function () { return 'mesh.example.com'; },
        getServerStats: function () { return { agentsessions: 0, connectedusers: 0, userssessions: 0, relaysessions: 0, relaycount: 0 }; },
        setRenderState: function (pages, languages) { state.pages = pages; state.languages = languages; },
        setEmailLanguages: function (languages) { state.emailLanguages = languages; }
    });
    return { rendering: rendering, users: users, savedUsers: savedUsers, state: state };
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

test('getLanguageCodes prefers query and saved user languages', function () {
    const fixture = createLanguageFixture();

    assert.deepEqual(fixture.rendering.getLanguageCodes({ query: { lang: 'FR-CA' }, headers: {} }), ['fr-ca']);
    const request = { query: {}, session: { userid: 'user/domain/alice' }, headers: { 'accept-language': 'de-DE,de;q=0.9' } };
    assert.deepEqual(fixture.rendering.getLanguageCodes(request), ['es']);
    assert.equal(request.query.lang, 'ES');
    assert.deepEqual(fixture.rendering.getLanguageCodes({ query: {}, headers: { 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' } }), ['fr-ca', 'fr', 'en']);
});

test('translation discovery applies overrides and renders regional fallbacks', function () {
    const fixture = createLanguageFixture();
    fixture.rendering.getRenderList();
    const calls = [];
    const response = { render: function (filename, args) { calls.push({ filename: filename, args: Object.assign({}, args) }); } };
    const user = fixture.users['user/domain/alice'];

    fixture.rendering.render({ query: { lang: 'fr-ca' }, headers: {} }, response, 'views/default', {}, user);

    assert.deepEqual(fixture.state.languages.sort(), ['en', 'fr', 'zh-chs'].sort());
    assert.equal(fixture.state.pages.domain.default.fr, 'override/translations/default_fr');
    assert.deepEqual(calls, [{ filename: 'override/translations/default_fr', args: { lang: 'fr' } }]);
    assert.equal(user.llang, 'fr');
    assert.equal(fixture.savedUsers.length, 1);
});

test('translated rendering maps modern Chinese codes and falls back to English', function () {
    const fixture = createLanguageFixture();
    fixture.rendering.getRenderList();
    const calls = [];
    const response = { render: function (filename, args) { calls.push({ filename: filename, lang: args.lang }); } };

    fixture.rendering.render({ query: { lang: 'zh-cn' }, headers: {} }, response, 'views/default', {});
    fixture.rendering.render({ query: { lang: 'en-us' }, headers: {} }, response, 'views/default', {});

    assert.deepEqual(calls, [
        { filename: 'root/views/translations/default_zh-chs', lang: 'zh-chs' },
        { filename: 'views/default', lang: 'en' }
    ]);
});

test('email language discovery combines default and override templates', function () {
    const fixture = createLanguageFixture();

    fixture.rendering.getEmailLanguageList();

    assert.deepEqual(fixture.state.emailLanguages.sort(), ['de', 'en', 'es', 'fr'].sort());
});
