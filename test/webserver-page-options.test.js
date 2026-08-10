/**
* @description Unit tests for shared web-page option encoding
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const pageOptions = require('../webserver/page-options.js');

test('AMT scan option arrays are normalized and encoded', function () {
    const domain = { amtscanoptions: ['range one', 'range/two'] };
    const result = pageOptions.getAmtScanOptions(domain, Array.isArray);
    assert.equal(result, 'range%20one%2Crange%2Ftwo');
    assert.equal(domain.amtscanoptions, 'range one,range/two');
});

test('custom page settings prefer the camel-case file option', function () {
    const domain = { customui: { toolbar: false }, customFiles: { css: ['new.css'] }, customfiles: { css: ['old.css'] } };
    assert.deepEqual(JSON.parse(decodeURIComponent(pageOptions.encodeCustomUi(domain))), { toolbar: false });
    assert.deepEqual(JSON.parse(decodeURIComponent(pageOptions.encodeCustomFiles(domain))), { css: ['new.css'] });
});

test('server WebRTC settings take precedence over command-line settings', function () {
    const encoded = pageOptions.getWebRtcConfig({ webrtcconfig: { source: "server's" } }, { webrtcconfig: { source: 'args' } });
    assert.equal(encoded.includes("'"), false);
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), { source: "server's" });
    assert.equal(pageOptions.getWebRtcConfig({}, {}), null);
});
