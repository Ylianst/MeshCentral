/**
* @description Unit tests for web server domain selection and network access
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createNetworkAccess = require('../webserver/network-access.js').createNetworkAccess;

function matches(ip, range) {
    if (ip == range) return true;
    const parts = range.split('/');
    if ((parts.length != 2) || ip.includes(':')) return false;
    const toNumber = function (value) { return value.split('.').reduce(function (result, part) { return ((result << 8) | parseInt(part)) >>> 0; }, 0); };
    const bits = parseInt(parts[1]);
    const mask = bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return ((toNumber(ip) & mask) >>> 0) == ((toNumber(parts[0]) & mask) >>> 0);
}

function createFixture(settings) {
    const domains = {
        '': { id: '', name: 'default' },
        sales: { id: 'sales', name: 'sales' },
        dnsdomain: { id: 'dnsdomain', dns: 'mesh.example.com' }
    };
    let blockedUsers = 0;
    let blockedAgents = 0;
    const access = createNetworkAccess({
        config: { settings: settings || {}, domains: domains },
        ipcheck: { match: matches },
        getDnsDomains: function () { return { 'mesh.example.com': domains.dnsdomain }; },
        onBlockedUser: function () { blockedUsers++; },
        onBlockedAgent: function () { blockedAgents++; },
        debug: function () { }
    });
    return { access: access, domains: domains, getBlockedUsers: function () { return blockedUsers; }, getBlockedAgents: function () { return blockedAgents; } };
}

test('domain selection supports localhost, DNS and URL domains', function () {
    const fixture = createFixture();
    assert.equal(fixture.access.getDomain({ hostname: 'localhost', query: { domainid: 'sales' }, url: '/' }), fixture.domains.sales);
    assert.equal(fixture.access.getDomain({ hostname: 'MESH.EXAMPLE.COM', query: {}, url: '/' }), fixture.domains.dnsdomain);
    assert.equal(fixture.access.getDomain({ query: {}, url: '/sales/login' }), fixture.domains.sales);
    assert.equal(fixture.access.getDomain({ query: {}, url: '/dnsdomain/login' }), fixture.domains['']);
});

test('HTTP user filtering rejects blocked addresses and responds', function () {
    const fixture = createFixture({ userblockedip: ['192.0.2.0/24'] });
    let status;
    const result = fixture.access.checkUserIpAddress({ connection: {}, clientIp: '192.0.2.5', query: {}, url: '/' }, { sendStatus: function (value) { status = value; } });
    assert.equal(result, null);
    assert.equal(status, 401);
    assert.equal(fixture.getBlockedUsers(), 1);
});

test('WebSocket allow lists close rejected connections', function () {
    const fixture = createFixture({ userallowedip: ['10.0.0.0/8'] });
    let closed = false;
    const result = fixture.access.checkUserIpAddress({ close: function () { closed = true; } }, { clientIp: '192.0.2.5', query: {}, url: '/' });
    assert.equal(result, null);
    assert.equal(closed, true);
    assert.equal(fixture.getBlockedUsers(), 1);
});

test('framing origins are normalized and unsafe schemes discarded', function () {
    const fixture = createFixture();
    assert.deepEqual(fixture.access.parseAllowedFramingOrigins(' https://one.example///, javascript:bad, http://two.example/ '), ['https://one.example', 'http://two.example']);
});
