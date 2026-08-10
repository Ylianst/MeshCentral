/**
* @description Unit tests for web server request utilities
* @license Apache-2.0
*/

'use strict';

const assert = require('assert');
const path = require('path');
const requestUtilsModule = require('../../../webserver/shared/request-utils.js');

const ipcheck = {
    match: function (ip, pattern) {
        if (ip == pattern) return true;
        const split = pattern.split('/');
        if ((split.length != 2) || (ip.indexOf(':') >= 0)) return false;
        const bits = parseInt(split[1]);
        const toNumber = function (value) { return value.split('.').reduce(function (result, part) { return ((result << 8) | parseInt(part)) >>> 0; }, 0); };
        const mask = bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
        return ((toNumber(ip) & mask) >>> 0) == ((toNumber(split[0]) & mask) >>> 0);
    }
};

let policy = 'lax';
const randomValues = [
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    Buffer.from([0, 0, 0, 0])
];
const utils = requestUtilsModule.createRequestUtils({
    crypto: { randomBytes: function (size) { const value = randomValues.shift(); return value || Buffer.alloc(size, 1); } },
    ipcheck: ipcheck,
    path: path,
    getCookieIpCheck: function () { return policy; }
});

assert.strictEqual(utils.checkEmail('user@example.com'), true);
assert.strictEqual(utils.checkEmail('user@example'), false);
assert.strictEqual(utils.isMobileBrowser({ headers: { 'user-agent': 'Example Mobile Browser' } }), true);
assert.strictEqual(utils.isMobileBrowser({ headers: {} }), false);
assert.strictEqual(utils.getQueryPortion({ url: '/?a=1&state=secret&duo_code=code&b=2' }), '?a=1&b=2');
assert.strictEqual(utils.getQueryPortion({ url: '/', body: { urlargs: '?from=body' } }), '?from=body');
assert.strictEqual(utils.cleanRemoteAddr('::ffff:192.0.2.1'), '192.0.2.1');
assert.strictEqual(utils.cleanRemoteAddr(null), null);
assert.strictEqual(utils.safeDecodeURIComponent('https%3A%2F%2Fexample.com'), 'https://example.com');
assert.strictEqual(utils.safeDecodeURIComponent('%E0%A4%A'), null);
assert.strictEqual(utils.getRandomLowerCase(3), 'abc');
assert.strictEqual(utils.getRandomSixDigitInteger(), 0);
assert.strictEqual(utils.checkAgentColorString('foreground=', '#102030'), 'foreground=16,32,48\r\n');
assert.strictEqual(utils.checkAgentColorString('foreground=', '300,0,0'), '');
assert.strictEqual(utils.isIPMatch('192.168.1.3', ['10.0.0.0/8', '192.168.1.0/24']), true);
assert.strictEqual(utils.isPrivateAddress('10.1.2.3'), true);
assert.strictEqual(utils.isPrivateAddress('8.8.8.8'), false);
policy = 'none';
assert.strictEqual(utils.checkCookieIp('1.1.1.1', '8.8.8.8'), true);
policy = 'strict';
assert.strictEqual(utils.checkCookieIp('1.1.1.1', '1.1.1.1'), true);
assert.strictEqual(utils.checkCookieIp('1.1.1.1', '1.1.1.2'), false);
assert.strictEqual(utils.assembleStringFromObject('Hello {{{name}}}!', { name: 'MeshCentral' }), 'Hello MeshCentral!');
assert.strictEqual(utils.escapeHtml('<tag a="b">&\''), '&lt;tag a=&quot;b&quot;&gt;&amp;&apos;');
assert.strictEqual(utils.escapeHtml(42), 42);
assert.deepStrictEqual(utils.calcDelta({ requests: 4, nested: { bytes: 10 } }, { requests: 7, nested: { bytes: 16 }, ignored: 'text' }), { requests: 3, nested: { bytes: 6 } });

let headers;
utils.setContentDispositionHeader({ set: function (value) { headers = value; } }, 'text/plain', '../bad:name.txt', 4, 'file.txt');
assert.strictEqual(headers['Content-Disposition'], 'attachment; filename="badname.txt"');
assert.strictEqual(headers['Content-Length'], 4);

console.log('webserver request utilities tests passed');
