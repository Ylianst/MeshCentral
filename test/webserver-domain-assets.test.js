/**
* @description Unit tests for domain redirects and static assets
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDomainAssets = require('../webserver/domain-assets.js').createDomainAssets;

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
        path: path,
        fs: { existsSync: function (value) { return existing.has(value); } }
    };
    const state = {
        path: path,
        fs: parent.fs,
        handleDomainRedirect: function () { },
        express: { static: function (folder) { return 'static:' + folder; } },
        app: {
            get: function () { routes.push(Array.from(arguments)); },
            use: function () { mounts.push(Array.from(arguments)); }
        }
    };
    const service = createDomainAssets({ state: state, parent: parent, getDomain: function () { return domain; } });
    return { service: service, routes: routes, mounts: mounts, state: state, domain: domain };
}

function findRoute(fixture, path) { return fixture.routes.find(function (route) { return route[0] === path; }); }
function response() { return { set: function (headers) { this.headers = headers; }, send: function (body) { this.body = body; }, sendFile: function (path) { this.file = path; }, sendStatus: function (status) { this.status = status; } }; }

test('registers public redirects and ignores metadata keys', function () {
    const fixture = createFixture();
    const domain = { id: 'tenant', url: '/tenant/', redirects: { docs: '/documentation', _notes: 'private' } };
    fixture.service.register(domain);
    assert.equal(findRoute(fixture, '/tenant/docs')[1], fixture.state.handleDomainRedirect);
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
