/**
* @description MeshCentral Mesh Agent Local Scanner
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a Mesh Scanner object
// TODO: We need once "server4" and "server6" per interface, or change the default multicast interface as we send.
module.exports.CreateMeshScanner = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.dgram = require('dgram');
    obj.common = require('./common.js');
    obj.servers4 = {};
    obj.servers6 = {};
    obj.mainTimer = null;
    const periodicScanTime = (60000 * 20); // Interval between scans, 20 minutes.
    const membershipIPv4 = '239.255.255.235';
    const membershipIPv6 = 'FF02:0:0:0:0:0:0:FE';
    obj.agentCertificateHashHex = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'hex' }).toUpperCase();
    obj.error = 0;
    obj.pendingOutboundPackets = [];
    obj.pendingOutboundTimer = null;

    // Setup the multicast key if present
    if ((typeof obj.parent.args.localdiscovery == 'object') && (typeof obj.parent.args.localdiscovery.key == 'string') && (obj.parent.args.localdiscovery.key.length > 0)) {
        obj.multicastKey = parent.crypto.createHash('sha384').update(obj.parent.args.localdiscovery.key).digest('raw').slice(0, 32);
    }

    // Encrypt UDP packet
    function encryptPacket(plainPacket) {
        if (obj.multicastKey == null) { return plainPacket; }
        const iv = parent.crypto.randomBytes(16), aes = parent.crypto.createCipheriv('aes-256-cbc', obj.multicastKey, iv);
        var ciphertext = aes.update(plainPacket);
        return Buffer.concat([iv, ciphertext, aes.final()]);
    }

    // Decrypt UDP packet
    function decryptPacket(packet) {
        if (obj.multicastKey == null) { return packet; }
        if (packet.length < 17) { return null; }
        try {
            const iv = packet.slice(0, 16), data = packet.slice(16);
            const aes = parent.crypto.createDecipheriv('aes-256-cbc', obj.multicastKey, iv);
            var plaintextBytes = Buffer.from(aes.update(data));
            return Buffer.concat([plaintextBytes, aes.final()]);
        } catch (ex) { return null; }
    }

    // Get a list of IPv4 and IPv6 interface addresses
    function getInterfaceList() {
        var i;
        var ipv4 = ['*'], ipv6 = ['*']; // Bind to IN_ADDR_ANY always
        var interfaces = require('os').networkInterfaces();
        for (i in interfaces) {
            var xinterface = interfaces[i];
            for (var j in xinterface) {
                var interface2 = xinterface[j];
                if ((interface2.mac != '00:00:00:00:00:00') && (interface2.internal == false)) {
                    if (interface2.family == 'IPv4') { ipv4.push(interface2.address); }
                    if (interface2.family == 'IPv6') { ipv6.push(interface2.address + '%' + i); }
                }
            }
        }
        return { ipv4: ipv4, ipv6: ipv6 };
    }

    // Setup all IPv4 and IPv6 servers
    function setupServers() {
        var addresses = getInterfaceList(), i, localAddress, bindOptions;
        for (i in obj.servers4) { obj.servers4[i].xxclear = true; }
        for (i in obj.servers6) { obj.servers6[i].xxclear = true; }
        for (i in addresses.ipv4) {
            localAddress = addresses.ipv4[i];
            if (obj.servers4[localAddress] != null) {
                // Server already exists
                obj.servers4[localAddress].xxclear = false;
            } else {
                // Create a new IPv4 server
                try {
                    var server4 = obj.dgram.createSocket({ type: 'udp4', reuseAddr: true });
                    server4.xxclear = false;
                    server4.xxtype = 4;
                    server4.xxlocal = localAddress;
                    server4.on('error', function (err) { /*if (this.xxlocal == '*') { console.log("ERROR: Server port 16989 not available, check if server is running twice."); } this.close(); delete obj.servers6[this.xxlocal];*/ });
                    bindOptions = { port: 16989, exclusive: true };
                    if (server4.xxlocal != '*') { bindOptions.address = server4.xxlocal; }
                    server4.bind(bindOptions, function () {
                        try {
                            var doscan = true;
                            try { this.setBroadcast(true); this.setMulticastTTL(128); this.addMembership(membershipIPv4, this.xxlocal); } catch (e) { doscan = false; }
                            this.on('error', function (error) { /*console.log('Error: ' + error);*/ });
                            this.on('message', function (msg, info) { onUdpPacket(msg, info, this); });
                            if (doscan == true) { obj.performScan(this); obj.performScan(this); }
                        } catch (e) { console.log(e); }
                    });
                    obj.servers4[localAddress] = server4;
                } catch (e) {
                    console.log(e);
                }
            }
        }

        for (i in addresses.ipv6) {
            localAddress = addresses.ipv6[i];
            if (obj.servers6[localAddress] != null) {
                // Server already exists
                obj.servers6[localAddress].xxclear = false;
            } else {
                // Create a new IPv6 server
                try {
                    var server6 = obj.dgram.createSocket({ type: 'udp6', reuseAddr: true });
                    server6.xxclear = false;
                    server6.xxtype = 6;
                    server6.xxlocal = localAddress;
                    server6.on('error', function (err) { /*this.close(); delete obj.servers6[this.xxlocal];*/ });
                    bindOptions = { port: 16989, exclusive: true };
                    if (server6.xxlocal != '*') { bindOptions.address = server6.xxlocal; }
                    server6.bind(bindOptions, function () {
                        try {
                            var doscan = true;
                            try { this.setBroadcast(true); this.setMulticastTTL(128); this.addMembership(membershipIPv6, this.xxlocal); } catch (e) { doscan = false; }
                            this.on('error', function (error) { console.log('Error: ' + error); });
                            this.on('message', function (msg, info) { onUdpPacket(msg, info, this); });
                            if (doscan == true) { obj.performScan(this); obj.performScan(this); }
                        } catch (e) { console.log(e); }
                    });
                    obj.servers6[localAddress] = server6;
                } catch (e) {
                    console.log(e);
                }
            }
        }

        for (i in obj.servers4) { if (obj.servers4[i].xxclear == true) { obj.servers4[i].close(); delete obj.servers4[i]; } }
        for (i in obj.servers6) { if (obj.servers6[i].xxclear == true) { obj.servers6[i].close(); delete obj.servers6[i]; } }
    }

    // Clear all IPv4 and IPv6 servers
    function clearServers() {
        var i;
        for (i in obj.servers4) { obj.servers4[i].close(); delete obj.servers4[i]; }
        for (i in obj.servers6) { obj.servers6[i].close(); delete obj.servers6[i]; }
    }

    // Start scanning for local network Mesh Agents
    obj.start = function () {
        if (obj.server4 != null) return;

        // Setup the local discovery values
        var name = 'MeshCentral';
        var info = '';
        try {
            if ((typeof obj.parent.config.domains[''].title == 'string') && (obj.parent.config.domains[''].title.length > 0)) {
                name = obj.parent.config.domains[''].title; info = '';
                try { if ((typeof obj.parent.config.domains[''].title2 == 'string') && (obj.parent.config.domains[''].title2.length > 0)) { info = obj.parent.config.domains[''].title2; } } catch (ex) { }
            }
        } catch (ex) { }
        try {
            if ((typeof obj.parent.args.localdiscovery.name == 'string') && (obj.parent.args.localdiscovery.name.length > 0)) {
                name = obj.parent.args.localdiscovery.name; info = '';
                try { if ((typeof obj.parent.args.localdiscovery.info == 'string') && (obj.parent.args.localdiscovery.info.length > 0)) { info = obj.parent.args.localdiscovery.info; } } catch (ex) { }
            }
        } catch (ex) { }
        if (info == '') { info = parent.certificates.CommonName; }

        // Figure out the correct websocket port
        var port = (parent.args.aliasport)?parent.args.aliasport:parent.args.port;

        // Build the IPv4 response
        var url = 'wss://%s:' + port + '/agent.ashx';
        obj.multicastPacket4 = Buffer.from("MeshCentral2|" + obj.agentCertificateHashHex + '|' + url, 'ascii');
        if (parent.certificates.CommonName.indexOf('.') != -1) { url = 'wss://' + parent.certificates.CommonName + ':' + port + '/agent.ashx'; }
        obj.multicastPacket4x = Buffer.from("MeshCentral2|" + obj.agentCertificateHashHex + '|' + url + '|' + name + '|' + info, 'ascii');

        // Build the IPv6 response
        url = 'wss://[%s]:' + port + '/agent.ashx';
        obj.multicastPacket6 = Buffer.from("MeshCentral2|" + obj.agentCertificateHashHex + '|' + url, 'ascii');
        if (parent.certificates.CommonName.indexOf('.') != -1) { url = 'wss://' + parent.certificates.CommonName + ':' + port + '/agent.ashx'; }
        obj.multicastPacket6x = Buffer.from("MeshCentral2|" + obj.agentCertificateHashHex + '|' + url + '|' + name + '|' + info, 'ascii');

        setupServers();
        obj.mainTimer = setInterval(obj.performScan, periodicScanTime);
        return obj;
    };

    // Stop scanning for local network Mesh Agents
    obj.stop = function () {
        if (obj.mainTimer != null) { clearInterval(obj.mainTimer); obj.mainTimer = null; }
        clearServers();
    };

    // Look for all Mesh Agents that may be locally reachable, indicating the presense of this server.
    obj.performScan = function (server) {
        var i;
        if (server != null) {
            if (server.xxtype == 4) { var p = encryptPacket(obj.multicastPacket4); try { server.send(p, 0, p.length, 16990, membershipIPv4); } catch (e) { } }
            if (server.xxtype == 6) { var p = encryptPacket(obj.multicastPacket6); try { server.send(p, 0, p.length, 16990, membershipIPv6); } catch (e) { } }
            if ((server.xxtype == 4) && (server.xxlocal == '*')) { var p = encryptPacket(obj.multicastPacket4); try { server.send(p, 0, p.length, 16990, '127.0.0.1'); } catch (e) { } try { server.send(p, 0, p.length, 16990, '255.255.255.255'); } catch (e) { } }
            if ((server.xxtype == 6) && (server.xxlocal == '*')) { var p = encryptPacket(obj.multicastPacket6); try { server.send(p, 0, p.length, 16990, '::1'); } catch (e) { } }
        } else {
            for (i in obj.servers4) { var p = encryptPacket(obj.multicastPacket4); try { obj.servers4[i].send(p, 0, p.length, 16990, membershipIPv4); } catch (e) { } }
            for (i in obj.servers6) { var p = encryptPacket(obj.multicastPacket6); try { obj.servers6[i].send(p, 0, p.length, 16990, membershipIPv6); } catch (e) { } }
            setupServers(); // Check if any network interfaces where added or removed
        }
    };

    // Called when a UDP packet is received from an agent.
    function onUdpPacket(msg, info, server) {
        // Decrypt the packet if needed
        if ((msg = decryptPacket(msg)) == null) return;

        //console.log('Received ' + msg.length + ' bytes from ' + info.address + ':' + info.port + ', on interface: ' + server.xxlocal + '.');
        if ((msg.length == 96) && (msg.toString('ascii') == obj.agentCertificateHashHex)) {
            if (server.xxtype == 4) { var p = encryptPacket(obj.multicastPacket4); try { server.send(p, 0, p.length, info.port, info.address); } catch (e) { } }
            if (server.xxtype == 6) { var p = encryptPacket(obj.multicastPacket6); try { server.send(p, 0, p.length, info.port, info.address); } catch (e) { } }
        } else if (msg.toString('ascii') == 'MeshServerScan') {
            if (server.xxtype == 4) { var p = encryptPacket(obj.multicastPacket4x); try { server.send(p, 0, p.length, info.port, info.address); } catch (e) { } }
            if (server.xxtype == 6) { var p = encryptPacket(obj.multicastPacket6x); try { server.send(p, 0, p.length, info.port, info.address); } catch (e) { } }
        }
    }

    // Send the next packet in the pending list, stop the timer if we are done.
    function sendPendingPacket() {
        if (obj.pendingOutboundPackets.length == 0) { if (obj.pendingOutboundTimer != null) { clearInterval(obj.pendingOutboundTimer); obj.pendingOutboundTimer = null; } return; }
        var packet = obj.pendingOutboundPackets.shift();
        if (packet != null) { packet[0].send(packet[1], 0, packet[1].length, packet[2], packet[3]); }
    }

    // As a side job, we also send server wake-on-lan packets
    obj.wakeOnLan = function (macs, host) {
        var i, j, futureTime = 0;
        for (i in macs) {
            var mac = macs[i].split(':').join('');
            var hexpacket = 'FFFFFFFFFFFF';
            for (j = 0; j < 16; j++) { hexpacket += mac; }
            var wakepacket = Buffer.from(hexpacket, 'hex');

            // Add all wake packets to the pending list
            for (var k = 0; k < 5; k++) {
                for (j in obj.servers4) {
                    obj.pendingOutboundPackets.push([obj.servers4[j], wakepacket, 7, '255.255.255.255']); // IPv4 Broadcast
                    obj.pendingOutboundPackets.push([obj.servers4[j], wakepacket, 16990, membershipIPv4]); // IPv4 Multicast
                    if (host != null) { obj.pendingOutboundPackets.push([obj.servers4[j], wakepacket, 7, host]); } // IPv4 Directed
                }
                for (j in obj.servers6) {
                    obj.pendingOutboundPackets.push([obj.servers6[j], wakepacket, 16990, membershipIPv6]); // IPv6 Multicast
                }
            }

            // Send each packet at 10ms interval
            // This packet spacing is absolutly required, otherwise the outbound buffer gets filled up and packets get lost which often causes the machine not to wake.
            if (obj.pendingOutboundTimer == null) { obj.pendingOutboundTimer = setInterval(sendPendingPacket, 10); }
        }
    };

    return obj;
};