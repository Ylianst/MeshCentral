/**
* @description Unit tests for main application session state
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const applicationSession = require('../../../webserver/ui/application-session.js');

test('session navigation state is consumed before query values', function () {
    const request = { session: { viewmode: 2, currentNode: 'node/tenant/saved' }, query: { viewmode: 3, node: 'query' } };
    assert.deepEqual(applicationSession.consumeNavigationState(request, { id: 'tenant' }), { viewmode: 2, currentNode: 'node/tenant/saved' });
    assert.equal(request.session.viewmode, undefined);
    assert.equal(request.session.currentNode, undefined);
});

test('query navigation state is used when the session has none', function () {
    const request = { session: {}, query: { viewmode: 3, node: 'query' } };
    assert.deepEqual(applicationSession.consumeNavigationState(request, { id: 'tenant' }), { viewmode: 3, currentNode: 'node/tenant/query' });
});

test('U2F challenges are removed from plain and encrypted session state', function () {
    const session = { u2f: 'plain', e: 'encrypted' };
    applicationSession.clearU2fChallenge(session, function () { return { u2f: 'secret', keep: true }; }, function (data) { return JSON.stringify(data); });
    assert.equal(session.u2f, undefined);
    assert.deepEqual(JSON.parse(session.e), { keep: true });
});

test('encrypted session state is left untouched without a U2F challenge', function () {
    const session = { e: 'encrypted' };
    applicationSession.clearU2fChallenge(session, function () { return { keep: true }; }, function () { throw new Error('must not encrypt'); });
    assert.equal(session.e, 'encrypted');
});
