/**
* @description Compatibility tests for JavaScript executed by the embedded agent engine
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('node:vm');

const meshCoreSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'meshcore.js'), 'utf8');
const urlValidatorSource = meshCoreSource.match(/function isValidHttpUrl\(value\) \{[\s\S]*?\n\}/);

test('MeshCore URL validation uses agent-compatible exception syntax', function () {
    assert.ok(urlValidatorSource);
    assert.doesNotMatch(urlValidatorSource[0], /catch\s*\{/);
});

test('MeshCore accepts only valid HTTP and HTTPS URLs', function () {
    const context = { URL: URL, Boolean: Boolean };
    vm.runInNewContext(urlValidatorSource[0], context);
    assert.equal(context.isValidHttpUrl('https://example.com/path'), true);
    assert.equal(context.isValidHttpUrl('http://example.com'), true);
    assert.equal(context.isValidHttpUrl('ftp://example.com/file'), false);
    assert.equal(context.isValidHttpUrl('not a URL'), false);
    assert.equal(context.isValidHttpUrl(' https://example.com'), false);
});
