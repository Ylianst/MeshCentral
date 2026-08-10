/**
* @description Unit tests for per-domain HTTP route registration
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registerDomainRoutes = require('../webserver/domain-route-registration.js').registerDomainRoutes;

test('path-based domains are registered with every route group in order', function () {
    const calls = [];
    const first = { register: function (domain) { calls.push('first:' + domain.id); } };
    const second = { register: function (domain) { calls.push('second:' + domain.id); } };
    registerDomainRoutes({ tenant: { id: 'tenant' }, other: { id: 'other' } }, [first, second]);
    assert.deepEqual(calls, ['first:tenant', 'second:tenant', 'first:other', 'second:other']);
});

test('DNS and shared domains do not add path route bindings', function () {
    const registered = [];
    registerDomainRoutes({ dns: { id: 'dns', dns: 'dns.example.com' }, share: { id: 'share', share: 'public' }, path: { id: 'path' } }, [{ register: function (domain) { registered.push(domain.id); } }]);
    assert.deepEqual(registered, ['path']);
});
