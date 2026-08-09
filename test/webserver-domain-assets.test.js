/**
* @description Unit tests for domain redirects and static assets
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDomainAssets = require('../webserver/domain-assets.js').createDomainAssets;
const canAccessOtherUserImage = require('../webserver/domain-assets.js').canAccessOtherUserImage;

test('only user administrators can request another user image', function () {
    assert.equal(canAccessOtherUserImage(null), false);
    assert.equal(canAccessOtherUserImage({ siteadmin: 0 }), false);
    assert.equal(canAccessOtherUserImage({ siteadmin: 1 }), false);
    assert.equal(canAccessOtherUserImage({ siteadmin: 2 }), true);
    assert.equal(canAccessOtherUserImage({ siteadmin: 3 }), true);
});

function createFixture(settings) {
    settings = settings || {};
    const routes = [];
    const mounts = [];
    const existing = new Set(settings.existing || []);
    const domain = settings.requestDomain || { id: 'tenant', url: '/tenant/' };
    const path = { join: function () { return Array.from(arguments).join('/'); } };
    const parent = {
        datapath: 'data',
        webPublicPath: 'public',
        webPublicOverridePath: settings.overridePath,
        configurationFiles: settings.configurationFiles,
        currentVer: '1.2.3',
        debug: function () { },
        path: path,
        fs: {
            existsSync: function (value) { return existing.has(value); },
            exists: function (value, callback) { callback(existing.has(value)); }
        }
    };
    const state = {
        path: path,
        fs: parent.fs,
        certificates: { root: { cert: settings.rootCertificate || '' } },
        common: { joinPath: function () { return Array.from(arguments).join('/'); } },
        express: { static: function (folder) { return 'static:' + folder; } },
        app: {
            get: function () { routes.push(Array.from(arguments)); },
            use: function () { mounts.push(Array.from(arguments)); }
        }
    };
    const service = createDomainAssets({
        state: state,
        parent: parent,
        getDomain: function () { return domain; },
        checkUserIpAddress: function () { return domain; },
        checkIpAddressEx: function () { return true; },
        certificates: { RootName: settings.rootName || 'MeshRoot' },
        setContentDispositionHeader: function (res, type, name) { res.disposition = { type: type, name: name }; },
        getQueryPortion: function () { return '&key=value'; }
    });
    return { service: service, routes: routes, mounts: mounts, state: state, domain: domain };
}

function findRoute(fixture, path) { return fixture.routes.find(function (route) { return route[0] === path; }); }
function response() { return { set: function (headers) { this.headers = headers; }, send: function (body) { this.body = body; }, sendFile: function (path) { this.file = path; }, sendStatus: function (status) { this.status = status; } }; }

test('registers public redirects and ignores metadata keys', function () {
    const fixture = createFixture();
    const domain = { id: 'tenant', url: '/tenant/', redirects: { docs: '/documentation', _notes: 'private' } };
    fixture.service.register(domain);
    assert.equal(findRoute(fixture, '/tenant/docs')[1], fixture.service.handleRedirect);
    assert.equal(findRoute(fixture, '/tenant/_notes'), undefined);
});

test('mounts an existing domain-specific well-known folder', function () {
    const fixture = createFixture({ existing: ['data/.well-known-tenant'] });
    fixture.service.register(fixture.domain);
    assert.deepEqual(fixture.mounts, [['/tenant/.well-known', 'static:data/.well-known-tenant']]);
});

test('configured server image bytes take precedence over filesystem assets', function () {
    const image = Buffer.from('image');
    const fixture = createFixture({ configurationFiles: { 'server.png': image }, existing: ['data/server.png'] });
    fixture.service.register(fixture.domain);
    const res = response();
    findRoute(fixture, '/tenant/serverpic.ashx')[1]({}, res);
    assert.deepEqual(res.headers, { 'Content-Type': 'image/png' });
    assert.equal(res.body, image);
    assert.equal(res.file, undefined);
});

test('server image falls through domain, override and default locations', function () {
    const requestDomain = { id: 'tenant', url: '/tenant/', webpublicpath: 'domain-public' };
    const domainFixture = createFixture({ requestDomain: requestDomain, existing: ['domain-public/images/server-256.png'], overridePath: 'override' });
    domainFixture.service.register(requestDomain);
    const domainResponse = response();
    findRoute(domainFixture, '/tenant/serverpic.ashx')[1]({}, domainResponse);
    assert.equal(domainResponse.file, 'domain-public/images/server-256.png');

    const defaultFixture = createFixture();
    defaultFixture.service.register(defaultFixture.domain);
    const defaultResponse = response();
    findRoute(defaultFixture, '/tenant/serverpic.ashx')[1]({}, defaultResponse);
    assert.equal(defaultResponse.file, 'public/images/server-256.png');
});

test('configured domain logos use stored bytes and inferred image types', function () {
    const image = Buffer.from('logo');
    const fixture = createFixture({
        requestDomain: { titlepicture: 'brand.png', loginpicture: 'login.jpg', pwalogo: 'pwa.png' },
        configurationFiles: { 'brand.png': image, 'login.jpg': image, 'pwa.png': image }
    });

    const logoResponse = response();
    fixture.service.handleLogo({}, logoResponse);
    assert.deepEqual(logoResponse.headers, { 'Content-Type': 'image/png' });
    assert.equal(logoResponse.body, image);

    const loginResponse = response();
    fixture.service.handleLoginLogo({}, loginResponse);
    assert.deepEqual(loginResponse.headers, { 'Content-Type': 'image/jpeg' });

    const pwaResponse = response();
    fixture.service.handlePwaLogo({}, pwaResponse);
    assert.equal(pwaResponse.body, image);
});

test('domain logos and welcome images fall back through public folders', function () {
    const fixture = createFixture({
        requestDomain: { webpublicpath: 'domain-public', sitestyle: 2 },
        overridePath: 'override',
        existing: ['override/images/logoback.png', 'domain-public/images/login/back.png']
    });

    const logoResponse = response();
    fixture.service.handleLogo({}, logoResponse);
    assert.equal(logoResponse.file, 'override/images/logoback.png');

    const welcomeResponse = response();
    fixture.service.handleWelcomeImage({}, welcomeResponse);
    assert.equal(welcomeResponse.file, 'domain-public/images/login/back.png');
});

test('root certificate responses decode PEM data and set a download name', function () {
    const encoded = Buffer.from('certificate-bytes').toString('base64');
    const fixture = createFixture({
        rootName: 'ExampleRoot',
        rootCertificate: '-----BEGIN CERTIFICATE-----\r\n' + encoded + '\r\n-----END CERTIFICATE-----'
    });
    const res = response();
    fixture.service.handleRootCertificate({ query: {} }, res);
    assert.equal(res.body.toString(), 'certificate-bytes');
    assert.deepEqual(res.disposition, { type: 'application/octet-stream', name: 'ExampleRoot.cer' });
});

test('PWA manifests use the domain title and stable application metadata', function () {
    const fixture = createFixture({ requestDomain: { title: 'Example Console' } });
    const res = response();
    res.json = function (value) { this.body = value; };
    fixture.service.handleManifest({}, res);
    assert.equal(res.body.name, 'Example Console');
    assert.equal(res.body.short_name, 'Example Console');
    assert.deepEqual(res.body.icons, [{ src: 'pwalogo.png', sizes: '512x512', type: 'image/png' }]);
});

test('domain redirects preserve URL arguments and support version responses', function () {
    const redirects = { docs: '/documentation', version: '~showversion', _private: '/hidden' };
    const fixture = createFixture({ requestDomain: { redirects: redirects } });
    const redirected = response();
    redirected.redirect = function (url) { this.redirectUrl = url; };
    fixture.service.handleRedirect({ originalUrl: '/docs?section=api' }, redirected);
    assert.equal(redirected.redirectUrl, '/documentation?section=api&key=value');

    const version = response();
    version.end = function (body) { this.body = body; };
    fixture.service.handleRedirect({ originalUrl: '/version' }, version);
    assert.equal(version.body, 'MeshCentral v1.2.3');

    const hidden = response();
    fixture.service.handleRedirect({ originalUrl: '/_private' }, hidden);
    assert.equal(hidden.status, 404);
});
