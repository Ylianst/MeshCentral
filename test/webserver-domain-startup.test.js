/**
* @description Unit tests for shared-domain and SSO startup orchestration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createDomainStartup = require('../webserver/domain-startup.js').createDomainStartup;

test('shared folders are mounted only for path-based domains', function () {
    const mounts = [];
    let finalized = 0;
    const domains = {
        '': { id: '', url: '/', share: 'root-share' },
        dns: { id: 'dns', url: '/dns/', dns: 'dns.example.com', share: 'dns-share' }
    };
    const service = createDomainStartup({
        domains: domains,
        app: { use: function (url, middleware) { mounts.push([url, middleware]); } },
        staticMiddleware: function (folder) { return 'static:' + folder; },
        setupDomainAuthStrategy: async function () { return 0; },
        finalizeWebserver: function () { finalized++; }
    });
    service.setup();
    assert.deepEqual(mounts, [['/', 'static:root-share']]);
    assert.equal(finalized, 1);
});

test('SSO flags from DNS domains aggregate into the default domain', async function () {
    let finalized = 0;
    const domains = {
        '': { id: '', url: '/', authstrategies: { authStrategyFlags: 0 } },
        sales: { id: 'sales', dns: 'sales.example.com', authstrategies: { provider: {} } },
        path: { id: 'path', url: '/path/' }
    };
    const service = createDomainStartup({
        domains: domains,
        app: { use: function () { } },
        staticMiddleware: function () { },
        setupDomainAuthStrategy: async function (domain) { return domain.id == 'sales' ? 2 : 1; },
        finalizeWebserver: function () { finalized++; }
    });
    await service.setup();
    assert.equal(domains[''].authstrategies.authStrategyFlags, 3);
    assert.equal(domains.path.authstrategies.authStrategyFlags, 1);
    assert.equal(finalized, 1);
});
