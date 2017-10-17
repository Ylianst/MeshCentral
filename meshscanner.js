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
    obj.servers4 = {};
    obj.servers6 = {};
    obj.mainTimer = null;
    var periodicScanTime = (60000 * 20); // Interval between scans, 20 minutes.
    var membershipIPv4 = '239.255.255.235';
    var membershipIPv6 = 'FF02:0:0:0:0:0:0:FE';
    obj.agentCertificatHashHex = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'hex' }).toUpperCase();
    obj.error = 0;

    // Get a list of IPv4 and IPv6 interface addresses
    function getInterfaceList() {
        var ipv4 = ['*'], ipv6 = ['*']; // Bind to IN_ADDR_ANY always
        if (parent.platform == 'win32') { // On Windows, also bind to each interface seperatly
            var interfaces = require('os').networkInterfaces();
            for (var i in interfaces) {
                var interface = interfaces[i];
                for (var j in interface) {
                    var interface2 = interface[j];
                    if ((interface2.mac != '00:00:00:00:00:00') && (interface2.internal == false)) {
                        if (interface2.family == 'IPv4') { ipv4.push(interface2.address); }
                        if (interface2.family == 'IPv6') { ipv6.push(interface2.address + '%' + i); }
                    }
                }
            }
        }
        return { ipv4: ipv4, ipv6: ipv6 };
    }

    // Setup all IPv4 and IPv6 servers
    function setupServers() {
        var addresses = getInterfaceList();
        for (var i in obj.servers4) { obj.servers4[i].xxclear = true; }
        for (var i in obj.servers6) { obj.servers6[i].xxclear = true; }
        for (var i in addresses.ipv4) {
            var localAddress = addresses.ipv4[i];
            if (obj.servers4[localAddress] != null) {
                // Server already exists
                obj.servers4[localAddress].xxclear = false;
            } else {
                // Create a new IPv4 server
                try {
                    var server4 = obj.dgram.createSocket("udp4");
                    server4.xxclear = false;
                    server4.xxtype = 4;
                    server4.xxlocal = localAddress;
                    server4.on('error', function (err) { if (this.xxlocal == '*') { console.log("ERROR: Server port 16989 not available, check if server is running twice."); } this.close(); delete obj.servers6[this.xxlocal]; });
                    var bindOptions = { port: 16989, exclusive: false };
                    if (server4.xxlocal != '*') { bindOptions.address = server4.xxlocal; }
                    server4.bind(bindOptions, function () {
                        try {
                            this.setBroadcast(true);
                            this.setMulticastTTL(128);
                            this.addMembership(membershipIPv4);
                            server4.on('error', function (error) { console.log('Error: ' + error); });
                            server4.on('message', function (msg, info) { onUdpPacket(msg, info, server4); });
                            obj.performScan(this);
                            obj.performScan(this);
                        } catch (e) { }
                    });
                    obj.servers4[localAddress] = server4;
                } catch (e) {
                    console.log(e);
                }
            }
        }

        for (var i in addresses.ipv6) {
            var localAddress = addresses.ipv6[i];
            if (obj.servers6[localAddress] != null) {
                // Server already exists
                obj.servers6[localAddress].xxclear = false;
            } else {
                // Create a new IPv6 server
                var server6 = obj.dgram.createSocket("udp6", localAddress);
                server6.xxclear = false;
                server6.xxtype = 6;
                server6.xxlocal = localAddress;
                server6.on('error', function (err) { this.close(); delete obj.servers6[this.xxlocal]; });
                var bindOptions = { port: 16989, exclusive: false };
                if (server6.xxlocal != '*') { bindOptions.address = server6.xxlocal; }
                server6.bind(bindOptions, function () {
                    try {
                        this.setBroadcast(true);
                        this.setMulticastTTL(128);
                        this.addMembership(membershipIPv6);
                        this.on('error', function (error) { console.log('Error: ' + error); });
                        this.on('message', function (msg, info) { onUdpPacket(msg, info, this); });
                        obj.performScan(this);
                        obj.performScan(this);
                    } catch (e) { }
                });
                obj.servers6[localAddress] = server6;
            }
        }
        for (var i in obj.servers4) { if (obj.servers4[i].xxclear == true) { obj.servers4[i].close(); delete obj.servers4[i]; }; }
        for (var i in obj.servers6) { if (obj.servers6[i].xxclear == true) { obj.servers6[i].close(); delete obj.servers6[i]; }; }
    }

    // Clear all IPv4 and IPv6 servers
    function clearServers() {
        for (var i in obj.servers4) { obj.servers4[i].close(); delete obj.servers4[i]; }
        for (var i in obj.servers6) { obj.servers6[i].close(); delete obj.servers6[i]; }
    }

    // Start scanning for local network Mesh Agents
    obj.start = function () {
        if (obj.server4 != null) return;
        var url = (parent.args.notls ? 'ws' : 'wss') + '://%s:' + parent.args.port + '/agent.ashx';
        obj.multicastPacket4 = Buffer.from("MeshCentral2|" + obj.agentCertificatHashHex + '|' + url, 'ascii');
        url = (parent.args.notls ? 'ws' : 'wss') + '://[%s]:' + parent.args.port + '/agent.ashx';
        obj.multicastPacket6 = Buffer.from("MeshCentral2|" + obj.agentCertificatHashHex + '|' + url, 'ascii');
        setupServers();
        obj.mainTimer = setInterval(obj.performScan, periodicScanTime);
        return obj;
    }

    // Stop scanning for local network Mesh Agents
    obj.stop = function () {
        if (obj.mainTimer != null) { clearInterval(obj.mainTimer); obj.mainTimer = null; }
        clearServers();
    }

    // Look for all Mesh Agents that may be locally reachable, indicating the presense of this server.
    obj.performScan = function (server) {
        if (server != null) {
            if (server.xxtype == 4) { try { server.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, 16990, membershipIPv4); } catch (e) { } }
            if (server.xxtype == 6) { try { server.send(obj.multicastPacket6, 0, obj.multicastPacket6.length, 16990, membershipIPv6); } catch (e) { } }
            if ((server.xxtype == 4) && (server.xxlocal == '*')) { try { server.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, 16990, '127.0.0.1'); } catch (e) { } try { server.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, 16990, '255.255.255.255'); } catch (e) { } }
            if ((server.xxtype == 6) && (server.xxlocal == '*')) { try { server.send(obj.multicastPacket6, 0, obj.multicastPacket6.length, 16990, '::1'); } catch (e) { } }
        } else {
            for (var i in obj.servers4) { try { obj.servers4[i].send(obj.multicastPacket4, 0, obj.multicastPacket4.length, 16990, membershipIPv4); } catch (e) { } }
            for (var i in obj.servers6) { try { obj.servers6[i].send(obj.multicastPacket6, 0, obj.multicastPacket6.length, 16990, membershipIPv6); } catch (e) { } }
            setupServers(); // Check if any network interfaces where added or removed
        }
    }

    // Called when a UDP packet is received from an agent.
    function onUdpPacket(msg, info, server) {
        //console.log('Received ' + msg.length + ' bytes from ' + info.address + ':' + info.port + ', on interface: ' + server.xxlocal + '.');
        if ((msg.length == 96) && (msg.toString('ascii') == obj.agentCertificatHashHex)) {
            if (server.xxtype == 4) { try { server.send(obj.multicastPacket4, 0, obj.multicastPacket4.length, info.port, info.address); } catch (e) { } }
            if (server.xxtype == 6) { try { server.send(obj.multicastPacket6, 0, obj.multicastPacket6.length, info.port, info.address); } catch (e) { } }
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
            for (var i in obj.servers4) { obj.servers4[i].send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.servers4[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
            for (var i in obj.servers6) { obj.servers6[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            setTimeout(function () {
                for (var i in obj.servers4) { obj.servers4[i].send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.servers4[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
                for (var i in obj.servers6) { obj.servers6[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            }, 200);
            setTimeout(function () {
                for (var i in obj.servers4) { obj.servers4[i].send(wakepacket, 0, wakepacket.length, 7, "255.255.255.255"); obj.servers4[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv4); }
                for (var i in obj.servers6) { obj.servers6[i].send(wakepacket, 0, wakepacket.length, 16990, membershipIPv6); }
            }, 500);
        }
    }
    
    return obj;
}