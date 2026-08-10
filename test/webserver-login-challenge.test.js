/**
* @description Unit tests for login-page challenge selection
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLoginChallengeHandler = require('../webserver/login-challenge.js').createLoginChallengeHandler;

function createHandler(overrides) {
    const rendered = [], redirects = [];
    const options = {
        state: { users: {}, db: {} },
        parent: { decryptSessionData: function () { return null; }, debug: function () { } },
        getQueryPortion: function () { return '?key=value'; },
        getHardwareKeyChallenge: function (req, domain, user, callback) { callback('challenge'); },
        renderLogin: function () { rendered.push(Array.from(arguments)); },
        hasDatabaseFailure: function (error, users) { return (error != null) || !Array.isArray(users); }
    };
    Object.assign(options, overrides);
    return { handler: createLoginChallengeHandler(options), rendered: rendered, redirects: redirects, response: { redirect: function (url) { redirects.push(url); } } };
}

test('normal two-factor sessions render their hardware challenge', function () {
    const user = { _id: 'user/tenant/alice' };
    const context = createHandler({
        state: { users: { 'user/tenant/alice': user }, db: {} },
        parent: { decryptSessionData: function () { return { tuserid: user._id }; }, debug: function () { } }
    });
    const request = { session: { loginmode: 4, e: 'encrypted' } };
    context.handler(request, context.response, { id: 'tenant', url: '/' }, 'requirements');
    assert.equal(context.rendered.length, 1);
    assert.equal(context.rendered[0][3], 'challenge');
    assert.equal(context.rendered[0][4], 'requirements');
});

test('recovery lookup failures clear the session and redirect', function () {
    const context = createHandler({ state: { users: {}, db: { GetUserWithVerifiedEmail: function (domainId, email, callback) { callback(null, null); } } } });
    const request = { session: { loginmode: 5, temail: 'alice@example.com' } };
    context.handler(request, context.response, { id: 'tenant', url: '/tenant/' }, null);
    assert.equal(request.session, null);
    assert.deepEqual(context.redirects, ['/tenant/?key=value']);
    assert.equal(context.rendered.length, 0);
});

test('recovery sessions render the challenge for the matching user', function () {
    const user = { _id: 'user/tenant/alice' };
    const context = createHandler({ state: { users: { 'user/tenant/alice': user }, db: { GetUserWithVerifiedEmail: function (domainId, email, callback) { callback(null, [{ _id: user._id }]); } } } });
    context.handler({ session: { loginmode: 5, temail: 'alice@example.com' } }, context.response, { id: 'tenant', url: '/tenant/' }, null);
    assert.equal(context.rendered.length, 1);
    assert.equal(context.rendered[0][3], 'challenge');
});

test('ordinary login requests render without a hardware challenge', function () {
    const context = createHandler();
    context.handler({ session: {} }, context.response, { id: 'tenant', url: '/' }, 'requirements');
    assert.equal(context.rendered.length, 1);
    assert.equal(context.rendered[0][3], '');
});
