/**
* @description MeshCentral Intel AMT Hello server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

// Construct the Intel AMT hello server. This is used for Intel AMT bare-metal activation on the local LAN.
// This server can receive a notification from Intel AMT and attempt activation.
module.exports.CreateAmtHelloServer = function (parent, config) {
    var obj = {};

    // Start the Intel AMT hello server
    var port = 9971;
    if (typeof config.port == 'number') { port = config.port; }
    const net = require('net');
    obj.server = net.createServer(function (socket) {
        socket.ra = socket.remoteAddress;
        socket.data = null;
        socket.on('error', function (err) { })
        socket.on('close', function () { if (this.data != null) { processHelloData(this.data, this.ra); } delete this.ra; this.removeAllListeners(); })
        socket.on('data', function (data) {
            console.log('indata', data.toString('hex'));
            if (this.data == null) { this.data = data; } else { Buffer.concat([this.data, data]); }
            var str = this.data.toString();
            if (str.startsWith('GET ') && (str.indexOf('\r\n\r\n') >= 0)) {
                this.data = null;
                var content = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Intel&reg; AMT Hello Server</title></head><body>Intel AMT hello server.<br />Intel&reg; AMT devices should send notification to this port for activation.</body></html>";
                try { socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ' + content.length + '\r\nConnection: close\r\n\r\n' + content); } catch (ex) {}
            } else if (this.data.length > 16000) {
                try { this.end(); } catch (ex) { };
            }
        })
    });
    obj.server.listen(port);
    console.log('MeshCentral Intel(R) AMT provisioning server running on port ' + port + '.');

    // Example hello data for testing
    //processHelloData(Buffer.from('01000300000000004b529b93d413181de4871c697a6b7a2b170220c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4022045140b3247eb9cc8c5b4f0d7b53091f73292089e6e5a63e2749dd3aca9198eda0220d7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef402201465fa205397b876faa6f0a9958e5590e40fcc7faa4fb7c2c8677521fb5fb65802202ce1cb0bf9d2f9e102993fbe215152c3b2dd0cabde1c68e5319b839154dbb7f502209acfab7e43c8d880d06b262a94deeee4b4659989c3d0caf19baf6405e41ab7df022016af57a9f676b0ab126095aa5ebadef22ab31119d644ac95cd4b93dbf3f26aeb0220960adf0063e96356750c2965dd0a0867da0b9cbd6e77714aeafb2349ab393da3022068ad50909b04363c605ef13581a939ff2c96372e3f12325b0a6861e1d59f660302206dc47172e01cbcb0bf62580d895fe2b8ac9ad4f873801e0c10b9c837d21eb177022073c176434f1bc6d5adf45b0e76e727287c8de57616c1e6e6141a2b2cbc7d8e4c022043df5774b03e7fef5fe40d931a7bedf1bb2e6b42738c4e6d3841103d3aa7f33902202399561127a57125de8cefea610ddf2fa078b5c8067f4e828290bfb860e84b3c022070a73f7f376b60074248904534b11482d5bf0e698ecc498df52577ebf2e93b9a02204348a0e9444c78cb265e058d5e8944b4d84f9662bd26db257f8934a443c701610220cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f022031ad6648f8104138c738f39ea4320133393e3a18cc02296ef97c2ac9ef6731d00220552f7bdcf1a7af9e6ce672017f4f12abf77240c78e761ac203d1d9d20ac89988022067540a47aa5b9f34570a99723cfefa96a96ee3f0d9b8bf4def9440b8065d665d02207224395222cd588c4f2683716922addb41e39b581ac34fa87b39efa896fbb39e0220cbb522d7b7f127ad6a0113865bdf1cd4102e7d0759af635a7cf4720dc963c53b0220179fbc148a3dd00fd24ea13458cc43bfa7f59c8182d783a513f6ebec100c892402202cabeafe37d06ca22aba7391c0033d25982952c453647349763a3ab5ad6ccf69', 'hex'), '192.168.2.148');

    // Parse Intel AMT hello data
    function parseHelloData(data, addr) {
        try {
            if (addr.startsWith('::ffff:')) { addr = addr.substring(7); }
            var amtHello = { time: Date.now(), addr: addr };

            // Decode header
            if (data.length < 25) return; // Invalid data
            const firstBytes = data.readInt16LE(0);
            if (firstBytes > 1) return; // Invalid data
            amtHello.adminCredentialsSet = (firstBytes != 0);
            amtHello.version = data.readInt16LE(2);
            if (amtHello.version != 3) return null; // One touch PID not supported, only version 3 supported.
            amtHello.retryCount = data.readInt32LE(4);
            amtHello.guidhex = data.slice(8, 24).toString('hex');
            amtHello.guid = guidToStr(amtHello.guidhex);

            // Get the list of hashes
            const hashCount = data[24];
            amtHello.hashes = [];
            var ptr = 25;
            for (var i = 0; i < hashCount; i++)
            {
                const hashType = data[ptr]; // 1=SHA1 (20 byte hash); 2 = SHA256 (32 byte hash); 3 = SHA384 (48 byte hash)
                const hashSize = data[ptr + 1];
                if ((hashType < 1) || (hashType > 3)) return null; // Unexpected hash type
                if ((hashType == 1) && (hashSize != 20)) return null; // Unexpected SHA1 hash size
                if ((hashType == 2) && (hashSize != 32)) return null; // Unexpected SHA256 hash size
                if ((hashType == 3) && (hashSize != 48)) return null; // Unexpected SHA384 hash size
                const hash = data.slice(ptr + 2, ptr + 2 + hashSize);
                amtHello.hashes.push(hash.toString('hex'));
                ptr += (hashSize + 2);
            }
            if (amtHello.hashes.length != hashCount) return null; // Unexpected number of hashes
            return amtHello; // Everything looks good.
        } catch (ex) { return null; }
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }
    function strToGuid(s) { s = s.replace(/-/g, ''); var ret = s.substring(6, 8) + s.substring(4, 6) + s.substring(2, 4) + s.substring(0, 2) + s.substring(10, 12) + s.substring(8, 10) + s.substring(14, 16) + s.substring(12, 14) + s.substring(16, 20) + s.substring(20); return ret; }

    // Process incoming Intel AMT hello data
    function processHelloData(data, addr) {
        // Check if we can parse the incoming data
        const amtHello = parseHelloData(data, addr);
        if (amtHello == null) return; // Invalid Intel AMT hello

        console.log(JSON.stringify(amtHello, null, 2));
        // TODO: Compute the nodeid for this device using the device GUID
        // TODO: Get device group and assumed trusted FQDN
        // TODO: Get an activation certificate chain
        // TODO: Setup a connection to the Intel AMT device
    }

    return obj;
};
