/**
* @description Meshcentral Mesh Agent Local Scanner
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a Mesh Scanner object
// TODO: We need once "server4" and "server6" per interface, or change the default multicast interface as we send.
module.exports.CreateMeshScanner = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.dgram = require('dgram');
    obj.common = require('./common.js');
    obj.server4 = null;
    obj.server6 = null;
    obj.mainTimer = null;
    var periodicScanTime = (60000 * 20); // Interval between scans, 20 minutes.
    var membershipIPv4 = '239.255.255.235';
    var membershipIPv6 = 'FF02:0:0:0:0:0:0:FE';
    obj.agentCertificatHashHex = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'hex' });
    obj.error = 0;

    // Start scanning for local network Mesh Agents
    obj.start = function () {
        if (obj.server4 != null) return;
        var url = (parent.args.notls ? 'ws' : 'wss') + '://%s:' + parent.args.port + '/agent.ashx';
        obj.multicastPacket4 = Buffer.from("MeshCentral2|" + obj.agentCertificatHashHex.toUpperCase() + '|' + url, 'ascii');
        url = (parent.args.notls ? 'ws' : 'wss') + '://[%s]:' + parent.args.port + '/agent.ashx';
        obj.multicastPacket6 = Buffer.from("MeshCentral2|" + obj.agentCertificatHashHex.toUpperCase() + '|' + url, 'ascii');
        obj.server4 = obj.dgram.createSocket("udp4");
        obj.server4.on('error', function(err) { if (obj.error++ == 0) { console.log("ERROR: Server port 16989 not available, check if server is running twice."); } obj.server4.close(); obj.server4 = null; });
        obj.server4.bind(16989, function () {
            obj.server4.setBroadcast(true)
            obj.server4.setMulticastTTL(128);
            obj.server4.addMembership(membershipIPv4);
            obj.server4.on('error', function (error) { console.log('Error: ' + error); });
            obj.server4.on('message', onUdpPacket); // TODO!!! We can't use this server for receive, instead we have to bind a seperate UDP server for each of the network interfaces.
            obj.performScan(4);
            obj.performScan(4);
        });
        obj.server6 = obj.dgram.createSocket("udp6");
        obj.server6.on('error', function(err) { obj.server6.close(); obj.server6 = null; }); // IPv6 may not be supported.
        obj.server6.bind(16989, function () {
            obj.server6.setBroadcast(true)
            obj.server6.setMulticastTTL(128);
            obj.server6.addMembership(membershipIPv6);
            obj.server6.on('error', function (error) { console.log('Error: ' + error); });
            obj.server6.on('message', onUdpPacket); // TODO!!! We can't use this server for receive, instead we have to bind a seperate UDP server for each of the network interfaces.
            obj.performScan(6);
            obj.performScan(6);
        });
        obj.mainTimer = setInterval(obj.performScan, periodicScanTime);
        return obj;
    }

    // Stop scanning for local network Mesh Agents
    obj.stop = function () {
        if (obj.mainTimer != null) { clearInterval(obj.mainTimer); obj.mainTimer = null; }
        if (obj.server4 != null) { obj.server4.close(); obj.server4 = null; }
        if (obj.server6 != null) { obj.server6.close(); obj.server6 = null; }
    }

    // Look for all Mesh Agents that may be locally reachable, indicating the presense of this server.
    obj.performScan = function (mode) {
        if ((mode != 6) && (obj.server4 != null)) { obj.server4.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, 16990, membershipIPv4); }
        if ((mode != 4) && (obj.server6 != null)) { obj.server6.send(obj.multicastPacket6, 0, obj.multicastPacket6.length, 16990, membershipIPv6); }
    }

    // Called when a UDP packet is received from an agent.
    function onUdpPacket(msg, info) {
        //console.log('Received ' + msg.length + ' bytes from ' + info.address + ':' + info.port + '\n');
        if ((msg.length == 64) && (msg.toString('ascii') == obj.agentCertificatHashHex.toUpperCase())) {
            if (info.family == 'IPv4') { obj.server4.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, info.port, info.address); }
            if (info.family == 'IPv6') { obj.server6.send(obj.multicastPacket6, 0, obj.multicastPacket6.length, info.port, info.address); }
        }
    }

    // As a side job, we also send server wake-on-lan packets
    obj.wakeOnLan = function (macs) {
        for (var i in macs) {
            var mac = macs[i];
            var hexpacket = 'FFFFFFFFFFFF';
            for (var i = 0; i < 16; i++) { hexpacket += mac; }
            var wakepacket = Buffer.from(hexpacket, 'hex');
            //console.log(wakepacket.toString('hex'));

            // Send the wake packet 3 times with small time intervals
            if (obj.server4) { obj.server4.send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.server4.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
            if (obj.server6) { obj.server6.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            setTimeout(function () {
                if (obj.server4) { obj.server4.send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.server4.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
                if (obj.server6) { obj.server6.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            }, 200);
            setTimeout(function () {
                if (obj.server4) { obj.server4.send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.server4.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
                if (obj.server6) { obj.server6.send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            }, 500);
        }
    }
    
    return obj;
}