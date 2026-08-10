/**
* @description Unit tests for main application access validation
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const validateApplicationAccess = require('../webserver/application-access.js').validateApplicationAccess;

function createResponse() {
    return { redirects: [], redirect: function (url) { this.redirects.push(url); } };
}

test('sessions from another domain are cleared and redirected', function () {
    const request = { session: { userid: 'user/other/alice' } }, response = createResponse();
    const result = validateApplicationAccess(request, response, { id: 'tenant', url: '/tenant/' }, {}, { debug: function () { } }, function () { return '?key=value'; });
    assert.equal(result, false);
    assert.equal(request.session, null);
    assert.deepEqual(response.redirects, ['/tenant/?key=value']);
});

test('locked accounts retain only the login error state', function () {
    const request = { session: { userid: 'user/tenant/alice', currentNode: 'node', passhint: 'hint', cuserid: 'change', keep: true } }, response = createResponse();
    const result = validateApplicationAccess(request, response, { id: 'tenant', url: '/tenant/' }, { siteadmin: 32 }, { debug: function () { } }, function () { return ''; });
    assert.equal(result, false);
    assert.deepEqual(request.session, { keep: true, messageid: 110 });
    assert.deepEqual(response.redirects, ['/tenant/']);
});

test('full administrators and ordinary unlocked users retain access', function () {
    const parent = { debug: function () { } }, query = function () { return ''; }, domain = { id: 'tenant', url: '/' };
    assert.equal(validateApplicationAccess({ session: { userid: 'user/tenant/admin' } }, createResponse(), domain, { siteadmin: 0xFFFFFFFF }, parent, query), true);
    assert.equal(validateApplicationAccess({ session: { userid: 'user/tenant/alice' } }, createResponse(), domain, { siteadmin: 0 }, parent, query), true);
});
