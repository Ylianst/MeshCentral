/**
* @description Unit tests for the duplex serial tunnel adapter
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSerialTunnel = require('../../../webserver/realtime/serial-tunnel.js').createSerialTunnel;

test('incoming transport buffers are exposed through the readable stream', async function () {
    const tunnel = createSerialTunnel();
    const chunks = [];
    tunnel.on('data', function (chunk) { chunks.push(chunk); });
    tunnel.updateBuffer(Buffer.from('hello'));
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(Buffer.concat(chunks).toString(), 'hello');
});

test('stream writes are forwarded to the embedded transport', async function () {
    const tunnel = createSerialTunnel();
    const forwarded = [];
    tunnel.forwardwrite = function (chunk) { forwarded.push(Buffer.from(chunk)); };
    await new Promise(function (resolve, reject) { tunnel.write(Buffer.from('outbound'), function (err) { if (err) reject(err); else resolve(); }); });
    assert.equal(Buffer.concat(forwarded).toString(), 'outbound');
});
