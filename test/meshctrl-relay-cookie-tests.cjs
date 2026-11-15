const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const cli = path.join(__dirname, '../meshctrl.js');
const realRequire = Module.createRequire(cli);
function setup(command, cookie, base = 'wss://example.test/domain/') {
    const sockets = [];
    class Socket extends EventEmitter {
        constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; sockets.push(this); }
        send(data) { this.sent.push(data); }
    }
    const args = [process.execPath, cli, command, '--id', 'sample-node', '--url', base,
        '--loginuser', 'test-user', '--loginpass', 'synthetic-password'];
    if (command !== 'shell') args.push('--file', 'fixture.bin', '--target', 'output.bin');
    const fakeFs = { existsSync: () => true, statSync: () => ({ size: 1 }), openSync: () => 1 };
    const mockRequire = name => name === 'ws' ? Socket : name === 'fs' ? fakeFs : realRequire(name);
    const fakeProcess = { argv: args, platform: process.platform, env: {}, exit: code => { throw Error('Unexpected exit: ' + code); } };
    const context = vm.createContext({ Buffer, console: { log() {} }, process: fakeProcess, setTimeout, clearTimeout });
    const source = fs.readFileSync(cli, 'utf8').replace(/^#![^\r\n]*[\r\n]+/, '');
    vm.runInContext(Module.wrap(source), context)({}, mockRequire, { exports: {} }, cli, path.dirname(cli));
    assert.equal(sockets.length, 1);
    const control = sockets[0];
    control.emit('open');
    control.emit('message', Buffer.from(JSON.stringify({ action: 'serverinfo', serverinfo: { domain: 'domain' } })));
    control.emit('message', Buffer.from(JSON.stringify({ action: 'authcookie', cookie, rcookie: 'synthetic-agent-cookie' })));
    assert.equal(sockets.length, 2);
    return { control, relay: sockets[1] };
}
function check(command, cookie) {
    const { control, relay } = setup(command, cookie);
    const url = new URL(relay.url);
    assert.equal(url.searchParams.get('auth'), cookie, 'Relay authentication cookie bytes must survive URL construction');
    assert.equal(url.protocol, 'wss:');
    assert.equal(url.pathname, '/domain/meshrelay.ashx');
    assert.equal(url.searchParams.get('p'), command === 'shell' ? '1' : '5');
    assert.equal(url.searchParams.get('browser'), '1');
    const request = control.sent.map(x => { try { return JSON.parse(x); } catch {} }).find(x => x && x.type === 'tunnel');
    assert.ok(request);
    assert.equal(new URL(request.value.slice(1), 'https://example.test').searchParams.get('rauth'), 'synthetic-agent-cookie');
    assert.equal(request.nodeid, 'node/domain/sample-node');
    assert.equal(new URL(request.value.slice(1), 'https://example.test').searchParams.get('id'), url.searchParams.get('id'));
    return url.searchParams.get('auth');
}
let cases = 0;
for (const command of ['shell', 'upload', 'download']) {
    for (const cookie of ['plain-cookie', 'aa$$bb', '$$leading', 'trailing$$', 'aa$$$$bb', '@$$@$$==']) { check(command, cookie); cases++; }
}
// Real AES-GCM cookie layout: IV + authentication tag + encrypted JSON, with the
// server's URL-safe alphabet. A modified byte must fail authentication.
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
iv.fill(0xff, 0, 3); // Test fixture: force consecutive / bytes in the base64 IV.
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ userid: 'user/domain/test', domainid: 'domain', time: 1 })), cipher.final()]);
const bytes = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
const cookie = bytes.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
assert.ok(cookie.includes('$$'));
const arrived = check('download', cookie); cases++;
const decoded = Buffer.from(arrived.replace(/@/g, '+').replace(/\$/g, '/'), 'base64');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, decoded.subarray(0, 12)); decipher.setAuthTag(decoded.subarray(12, 28));
assert.equal(JSON.parse(Buffer.concat([decipher.update(decoded.subarray(28)), decipher.final()]).toString()).userid, 'user/domain/test');
const tampered = Buffer.from(decoded); tampered[tampered.length - 1] ^= 1;
assert.throws(() => { const d = crypto.createDecipheriv('aes-256-gcm', key, tampered.subarray(0, 12)); d.setAuthTag(tampered.subarray(12, 28)); d.update(tampered.subarray(28)); d.final(); });
console.log('PASS: ' + cases + ' CLI relay-cookie cases; tampered AES-GCM cookie rejected');
