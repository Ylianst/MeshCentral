/**
* @description Duplex stream adapter used to embed TLS and MQTT in another transport
* @license Apache-2.0
*/

'use strict';

module.exports.createSerialTunnel = function (options) {
    const stream = options && options.stream ? options.stream : require('stream');
    const duplexOptions = options && options.duplexOptions;
    const tunnel = new stream.Duplex(duplexOptions);
    tunnel.forwardwrite = null;
    tunnel.updateBuffer = function (chunk) { this.push(chunk); };
    tunnel._write = function (chunk, encoding, callback) {
        if (tunnel.forwardwrite != null) tunnel.forwardwrite(chunk);
        else console.error('Failed to fwd _write.');
        if (callback) callback();
    };
    tunnel._read = function () { };
    return tunnel;
};
