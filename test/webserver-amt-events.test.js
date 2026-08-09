/**
* @description Unit tests for Intel AMT event requests
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hasDatabaseFailure = require('../webserver/amt-events.js').hasDatabaseFailure;
const hasRandomBytesFailure = require('../webserver/amt-events.js').hasRandomBytesFailure;
const createAmtEventHandler = require('../webserver/amt-events.js').createAmtEventHandler;

test('AMT event node lookups safely reject database failures', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('AMT authentication challenges reject random byte generation failures', function () {
    assert.equal(hasRandomBytesFailure(new Error('entropy unavailable'), null), true);
    assert.equal(hasRandomBytesFailure(null, null), true);
    assert.equal(hasRandomBytesFailure(null, Buffer.alloc(48)), false);
});

test('AMT event requests return a digest authentication challenge', function () {
    const state = {
        httpAuthRealm: 'MeshCentral',
        httpAuthRandom: 'secret',
        crypto: {
            randomBytes: function (length, callback) { callback(null, Buffer.alloc(length, 1)); },
            createHmac: function () { return { update: function () { return { digest: function () { return 'opaque'; } }; } }; }
        }
    };
    const handler = createAmtEventHandler({ state: state, parent: {}, getDomain: function () { return { id: '' }; } });
    const res = { set: function (headers) { this.headers = headers; }, sendStatus: function (status) { this.status = status; } };
    handler({ headers: {}, url: '/amtevents.ashx' }, res);
    assert.equal(res.status, 401);
    assert.match(res.headers['WWW-Authenticate'], /^Digest realm="MeshCentral"/);
});
