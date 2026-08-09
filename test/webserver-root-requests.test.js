/**
* @description Unit tests for root page request handling
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createRootRequests = require('../webserver/root-requests.js').createRootRequests;

test('configured root redirects retain the request query portion', function () {
    const redirects = [];
    const service = createRootRequests({
        checkUserIpAddress: function () { return { rootredirect: 'https://portal.example/' }; },
        getQueryPortion: function () { return '?key=value'; }
    });
    service.handleRootRedirect({}, { redirect: function (url) { redirects.push(url); } });
    assert.deepEqual(redirects, ['https://portal.example/?key=value']);
});

test('root redirects stop when the request domain is rejected', function () {
    let redirected = false;
    const service = createRootRequests({ checkUserIpAddress: function () { return null; }, getQueryPortion: function () { return ''; } });
    service.handleRootRedirect({}, { redirect: function () { redirected = true; } });
    assert.equal(redirected, false);
});
