/**
* @description Unit tests for main application entry redirects
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handleApplicationEntry = require('../../../webserver/ui/application-entry.js').handleApplicationEntry;

function createResponse() {
    return { redirects: [], redirect: function (url) { this.redirects.push(url); } };
}

test('maintenance mode redirects non-administrators to the login page', function () {
    const request = { session: {}, query: {} }, response = createResponse();
    assert.equal(handleApplicationEntry(request, response, { url: '/tenant/' }, { siteadmin: 0 }, true), true);
    assert.deepEqual(request.session, { messageid: 115, loginmode: 1 });
    assert.deepEqual(response.redirects, ['/tenant/']);
});

test('full administrators can enter during maintenance', function () {
    const request = { session: {}, query: {} }, response = createResponse();
    assert.equal(handleApplicationEntry(request, response, { url: '/tenant/' }, { siteadmin: 4294967295 }, true), false);
    assert.deepEqual(response.redirects, []);
});

test('messenger notifications redirect with encoded identifiers and keys', function () {
    const request = { session: {}, query: { meshmessengerid: 'user/tenant/a b', key: 'a&b' } }, response = createResponse();
    assert.equal(handleApplicationEntry(request, response, { url: '/tenant/' }, {}, null), true);
    assert.deepEqual(response.redirects, ['/tenant/messenger?id=user%2Ftenant%2Fa%20b&key=a%26b']);
});
