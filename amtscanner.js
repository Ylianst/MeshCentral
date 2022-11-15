/**
* @description MeshCentral Intel(R) AMT Local Scanner
* @author Ylian Saint-Hilaire & Joko Sastriawan
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

// Construct a Intel AMT Scanner object
module.exports.CreateAmtScanner = function (parent) {
    var obj = {};
    obj.active = false;
    obj.parent = parent;
    obj.net = require('net');
    obj.tls = require('tls');
    obj.dns = require('dns');
    obj.dgram = require('dgram');
    obj.common = require('./common.js');
    obj.servers = {};
    obj.rserver = {};
    obj.rpacket = null;
    obj.tagToId = {}; // Tag --> { lastpong: time, id: NodeId }
    obj.scanTable = {}; // NodeId --> ScanInfo : { lastping: time, lastpong: time, nodeinfo:{node} }
    obj.scanTableTags = {}; // Tag --> ScanInfo
    obj.pendingSends = []; // We was to stagger the sends using a 10ms timer
    obj.pendingSendTimer = null;
    obj.mainTimer = null;
    obj.nextTag = 0;
    const PeriodicScanTime = 30000; // Interval between scan sweeps
    const PeriodicScanTimeout = 65000; // After this time, timeout the device.
    const constants = (require('crypto').constants ? require('crypto').constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Build a RMCP packet with a given tag field
    obj.buildRmcpPing = function (tag) {
        var packet = Buffer.from(obj.common.hex2rstr('06000006000011BE80000000'), 'ascii');
        packet[9] = tag;
        return packet;
    };

    // Start scanning for local network Intel AMT computers
    obj.start = function () {
        obj.active = true;
        obj.performScan();
        obj.mainTimer = setInterval(obj.performScan, PeriodicScanTime);
        return obj;
    };

    // Stop scanning for local network Intel AMT computers
    obj.stop = function () {
        obj.active = false;
        for (var i in obj.servers) { obj.servers[i].close(); } // Stop all servers
        obj.servers = {};
        if (obj.mainTimer != null) { clearInterval(obj.mainTimer); obj.mainTimer = null; }
    };

    // Scan for Intel AMT computers using network multicast
    obj.performRangeScan = function (userid, rangestr) {
        if (obj.rpacket == null) { obj.rpacket = obj.buildRmcpPing(0); }
        var range = obj.parseIpv4Range(rangestr);
        //console.log(obj.IPv4NumToStr(range.min), obj.IPv4NumToStr(range.max));
        if (range == null || (range.min > range.max)) return false;
        var rangeinfo = { id: userid, range: rangestr, min: range.min, max: range.max, results: {} };
        obj.rserver[userid] = rangeinfo;
        rangeinfo.server = obj.dgram.createSocket("udp4");
        rangeinfo.server.bind(0);
        rangeinfo.server.on('error', (err) => { console.log(err); });
        rangeinfo.server.on('message', function (data, rinfo) { obj.parseRmcpPacket(data, rinfo, 0, obj.reportMachineState, rangeinfo); });
        rangeinfo.server.on('listening', function() { for (var i = rangeinfo.min; i <= rangeinfo.max; i++) { rangeinfo.server.send(obj.rpacket, 623, obj.IPv4NumToStr(i)); } });
        rangeinfo.timer = setTimeout(function () { // ************************* USE OF OUTER VARS!!!!!!!!!!!!!!!
            obj.parent.DispatchEvent(['*', userid], obj, { action: 'scanamtdevice', range: rangeinfo.range, results: rangeinfo.results, nolog: 1 });
            rangeinfo.server.close();
            delete rangeinfo.server;
        }, 3000);
        return true;
    };

    // Parse range, used to parse "ip", "ip/mask" or "ip-ip" notation.
    // Return the start and end value of the scan
    obj.parseIpv4Range = function (range) {
        if (range == undefined || range == null) return null;
        var x = range.split('-');
        if (x.length == 2) { return { min: obj.parseIpv4Addr(x[0]), max: obj.parseIpv4Addr(x[1]) }; }
        x = range.split('/');
        if (x.length == 2) {
            var ip = obj.parseIpv4Addr(x[0]), masknum = parseInt(x[1]), mask = 0;
            if (masknum <= 16 || masknum > 32) return null;
            masknum = 32 - masknum;
            for (var i = 0; i < masknum; i++) { mask = (mask << 1); mask++; }
            return { min: ip & (0xFFFFFFFF - mask), max: (ip & (0xFFFFFFFF - mask)) + mask };
        }
        x = obj.parseIpv4Addr(range);
        if (x == null) return null;
        return { min: x, max: x };
    };

    // Parse IP address. Takes a 
    obj.parseIpv4Addr = function (addr) {
        var x = addr.split('.');
        if (x.length == 4) { return (parseInt(x[0]) << 24) + (parseInt(x[1]) << 16) + (parseInt(x[2]) << 8) + (parseInt(x[3]) << 0); }
        return null;
    };

    // IP address number to string
    obj.IPv4NumToStr = function (num) {
        return ((num >> 24) & 0xFF) + '.' + ((num >> 16) & 0xFF) + '.' + ((num >> 8) & 0xFF) + '.' + (num & 0xFF);
    };

    /*
    // Sample we could use to optimize DNS resolving, may not be needed at all.
    obj.BatchResolvePendingMax = 1;
    obj.BatchResolvePendingCount = 0;
    obj.BatchResolveResults = {};
    obj.BatchResolve = function (hostname) {
        var r = null;
        hostname = hostname.toLowerCase();
        if ((hostname == '127.0.0.1') || (hostname == '::1') || (hostname == 'localhost')) return null; // Don't scan localhost
        if (obj.net.isIP(hostname) > 0) return hostname; // This is an IP address, already resolved.
        if (obj.BatchResolveResults[hostname]) {
            if ((obj.BatchResolveResults[hostname].f == 0) || (obj.BatchResolveResults[hostname].f == -1)) {
                // Already resolving this one or an error occured during resolve, re-check every 30 minutes.
                if (((Date.now() - obj.BatchResolveResults[hostname].t) < 1800000) || (obj.BatchResolvePendingCount >= obj.BatchResolvePendingMax)) { return null; }
            } else {
                // We are to try to re-resolve every 30 minutes
                if (((Date.now() - obj.BatchResolveResults[hostname].t) < 1800000) || (obj.BatchResolvePendingCount >= obj.BatchResolvePendingMax)) { return obj.BatchResolveResults[hostname].a; }
                r = obj.BatchResolveResults[hostname].a;
            }
        }
        if (obj.BatchResolvePendingCount >= obj.BatchResolvePendingMax) return null; // Don't resolve more than 10 names at any given time.
        console.log('Resolve: ' + hostname);
        obj.BatchResolvePendingCount++;
        obj.BatchResolveResults[hostname] = { f: 0, t: Date.now() }; // Mark are resolving
        obj.dns.lookup(hostname, (err, address, family) => {
            obj.BatchResolvePendingCount--;
            if (err != null) {
                console.log('Resolve error: ' + hostname);
                obj.BatchResolveResults[hostname] = { f: -1 }; // Mark this as a resolve error
            } else {
                console.log('Resolved: %s = %j, family: IPv%s', hostname, address, family);
                obj.BatchResolveResults[hostname] = { a: address, f: family, t: Date.now() };
            }
        });
        return r;
    };
    */

    obj.ResolveName = function (hostname, func) {
        if ((hostname == '127.0.0.1') || (hostname == '::1') || (hostname == 'localhost')) { func(hostname, null); } // Don't scan localhost
        if (obj.net.isIP(hostname) > 0) { func(hostname, hostname); return; } // This is an IP address, already resolved.
        obj.dns.lookup(hostname, function (err, address, family) { if (err == null) { func(hostname, address); } else { func(hostname, null); } });
    };

    // Look for all Intel AMT computers that may be locally reachable and poll their presence
    obj.performScan = function () {
        if (obj.active == false) { return false; }
        obj.parent.db.getLocalAmtNodes(function (err, docs) { // TODO: handler more than 10 computer scan at the same time. DNS resolved may need to be a seperate module.
            for (var i in obj.scanTable) { obj.scanTable[i].present = false; }
            if (err == null && docs.length > 0) {
                for (var i in docs) {
                    var doc = docs[i], host = doc.host.toLowerCase();
                    const ciraConnections = obj.parent.mpsserver ? obj.parent.mpsserver.GetConnectionToNode(doc._id, null, true) : null; // See if any OOB connections are present
                    if ((host != '127.0.0.1') && (host != '::1') && (host.toLowerCase() != 'localhost') && (ciraConnections == null)) {
                        var scaninfo = obj.scanTable[doc._id];
                        if (scaninfo == null) {
                            var tag = obj.nextTag++;
                            obj.scanTableTags[tag] = obj.scanTable[doc._id] = scaninfo = { nodeinfo: doc, present: true, tag: tag, state: 0 };
                            //console.log('Scan ' + host + ', state=' + scaninfo.state + ', delta=' + delta);
                        } else {
                            scaninfo.present = true;
                            var delta = Date.now() - scaninfo.lastpong;
                            //console.log('Rescan ' + host + ', state=' + scaninfo.state + ', delta=' + delta);
                            if ((scaninfo.state == 1) && (delta >= PeriodicScanTimeout)) {
                                // More than 2 minutes without a response, mark the node as unknown state
                                scaninfo.state = 0;
                                obj.parent.ClearConnectivityState(scaninfo.nodeinfo.meshid, scaninfo.nodeinfo._id, 4, null, { name: doc.name }); // Clear connectivity state
                                if (obj.parent.amtManager != null) { obj.parent.amtManager.stopAmtManagement(scaninfo.nodeinfo._id, 3, scaninfo.nodeinfo.host); }
                            } else if ((scaninfo.tcp == null) && ((scaninfo.state == 0) || isNaN(delta) || (delta > PeriodicScanTime))) {
                                // More than 30 seconds without a response, try TCP detection
                                obj.checkTcpPresence(host, (doc.intelamt.tls == 1) ? 16993 : 16992, scaninfo, function (tag, result, version) {
                                    // TODO: It is bad that "obj" is being accessed within this function.
                                    if (result == false) return;
                                    tag.lastpong = Date.now();
                                    if (tag.state == 0) {
                                        tag.state = 1;
                                        obj.parent.SetConnectivityState(tag.nodeinfo.meshid, tag.nodeinfo._id, tag.lastpong, 4, 7, null, { name: doc.name }); // Report power state as "present" (7).
                                        if (version != null) { obj.changeAmtState(tag.nodeinfo._id, version, 2, tag.nodeinfo.intelamt.tls); }
                                        if (obj.parent.amtManager != null) { obj.parent.amtManager.startAmtManagement(tag.nodeinfo._id, 3, tag.nodeinfo.host); }
                                    }
                                });
                            }
                        }
                        // Start scanning this node
                        scaninfo.lastping = Date.now();
                        obj.checkAmtPresence(host, scaninfo.tag);
                    }
                }
            }
            for (var i in obj.scanTable) {
                if (obj.scanTable[i].present == false) {
                    // Stop scanning this node
                    delete obj.scanTableTags[obj.scanTable[i].tag];
                    delete obj.scanTable[i];
                }
            }
        });
        return true;
    };

    // Look for all Intel AMT computers that may be locally reachable and poll their presence
    obj.performSpecificScan = function (node) {
        if ((node == null) || (node.host == null)) return;
        var host = node.host.toLowerCase();
        const ciraConnections = obj.parent.mpsserver ? obj.parent.mpsserver.GetConnectionToNode(node._id, null, true) : null; // See if any OOB connections are present
        if ((host != '127.0.0.1') && (host != '::1') && (host.toLowerCase() != 'localhost') && (ciraConnections == null)) {
            obj.checkTcpPresence(host, (node.intelamt.tls == 1) ? 16993 : 16992, { nodeinfo: node }, function (tag, result, version) {
                if ((result == true) && (obj.parent.amtManager != null)) { obj.parent.amtManager.startAmtManagement(tag.nodeinfo._id, 3, tag.nodeinfo.host); }
            });
        }
    };

    // Check the presense of a specific Intel AMT computer using RMCP
    obj.checkAmtPresence = function (host, tag) { obj.ResolveName(host, function (hostname, ip) { obj.checkAmtPresenceEx(ip, tag); }); };

    // Check the presense of a specific Intel AMT computer using RMCP
    obj.checkAmtPresenceEx = function (host, tag) {
        if (host == null) return;
        var serverid = Math.floor(tag / 255);
        var servertag = (tag % 255);
        var packet = obj.buildRmcpPing(servertag);
        var server = obj.servers[serverid];
        if (server == undefined) {
            // Start new server
            server = obj.dgram.createSocket('udp4');
            server.on('error', (err) => { });
            server.on('message', (data, rinfo) => { obj.parseRmcpPacket(data, rinfo, serverid, obj.changeConnectState, null); });
            server.on('listening', () => {
                obj.pendingSends.push([server, packet, host]);
                if (obj.pendingSendTimer == null) { obj.pendingSendTimer = setInterval(obj.sendPendingPacket, 10); }
            });
            server.bind(0);
            obj.servers[serverid] = server;
        } else {
            // Use existing server
            obj.pendingSends.push([server, packet, host]);
            if (obj.pendingSendTimer == null) { obj.pendingSendTimer = setInterval(obj.sendPendingPacket, 10); }
        }
    };

    // Send a pending RMCP packet
    obj.sendPendingPacket = function () {
        try {
            var p = obj.pendingSends.shift();
            if (p != undefined) {
                p[0].send(p[1], 623, p[2]);
                p[0].send(p[1], 623, p[2]);
            } else {
                clearInterval(obj.pendingSendTimer);
                obj.pendingSendTimer = null;
            }
        } catch (e) { }
    };

    // Parse RMCP packet
    obj.parseRmcpPacket = function (data, rinfo, serverid, func, user) {
        if (data == null || data.length < 20) return;
        if (((data[12] == 0) || (data[13] != 0) || (data[14] != 1) || (data[15] != 0x57)) && (data[21] & 32)) {
            var servertag = data[9];
            var tag = (serverid * 255) + servertag;
            var minorVersion = data[18] & 0x0F;
            var majorVersion = (data[18] >> 4) & 0x0F;
            var provisioningState = data[19] & 0x03; // Pre = 0, In = 1, Post = 2

            var openPort = (data[16] * 256) + data[17];
            var dualPorts = ((data[19] & 0x04) != 0) ? true : false;
            var openPorts = [openPort];
            if (dualPorts == true) { openPorts = [16992, 16993]; }
            if (provisioningState <= 2) { func(tag, minorVersion, majorVersion, provisioningState, openPort, dualPorts, rinfo, user); }
        }
    };

    // Use the RMCP packet to change the computer state
    obj.changeConnectState = function (tag, minorVersion, majorVersion, provisioningState, openPort, dualPorts, rinfo, user) {
        //var provisioningStates = { 0: 'Pre', 1: 'in', 2: 'Post' };
        //var provisioningStateStr = provisioningStates[provisioningState];
        //console.log('Intel AMT ' + majorVersion + '.' + minorVersion + ', ' + provisioningStateStr + '-Provisioning at ' + rinfo.address + ', Open Ports: [' + openPort + '], tag: ' + tag + ', dualPorts: ' + dualPorts);
        var scaninfo = obj.scanTableTags[tag];
        if (scaninfo != undefined) {
            scaninfo.lastpong = Date.now();
            if (scaninfo.state == 0) {
                scaninfo.state = 1;
                if ((openPort == 16993) || (dualPorts == true)) { scaninfo.nodeinfo.intelamt.tls = 1; }
                else if (openPort == 16992) { scaninfo.nodeinfo.intelamt.tls = 0; }
                if (majorVersion > 0) { // Older versions of Intel AMT report the AMT version.
                    scaninfo.nodeinfo.intelamt.ver = majorVersion + '.' + minorVersion;
                    scaninfo.nodeinfo.intelamt.state = provisioningState;
                }
                obj.parent.SetConnectivityState(scaninfo.nodeinfo.meshid, scaninfo.nodeinfo._id, scaninfo.lastpong, 4, 7, null, { name: scaninfo.nodeinfo.name }); // Report power state as "present" (7).
                obj.changeAmtState(scaninfo.nodeinfo._id, scaninfo.nodeinfo.intelamt.ver, provisioningState, scaninfo.nodeinfo.intelamt.tls);
                if (obj.parent.amtManager != null) { obj.parent.amtManager.startAmtManagement(scaninfo.nodeinfo._id, 3, scaninfo.nodeinfo.host); }
            }
        }
    };

    // Use the RMCP packet to change the computer state
    obj.reportMachineState = function (tag, minorVersion, majorVersion, provisioningState, openPort, dualPorts, rinfo, user) {
        //var provisioningStates = { 0: 'Pre', 1: 'in', 2: 'Post' };
        //var provisioningStateStr = provisioningStates[provisioningState];
        //console.log(rinfo.address + ': Intel AMT ' + majorVersion + '.' + minorVersion + ', ' + provisioningStateStr + '-Provisioning, Open Ports: [' + openPorts.join(', ') + ']');
        obj.dns.reverse(rinfo.address, function (err, hostnames) {
            if ((err == null) && (hostnames != null) && (hostnames.length > 0)) {
                user.results[rinfo.address] = { ver: majorVersion + '.' + minorVersion, tls: (((openPort == 16993) || (dualPorts == true)) ? 1 : 0), state: provisioningState, hostname: hostnames[0], hosttype: 'host' };
            } else {
                user.results[rinfo.address] = { ver: majorVersion + '.' + minorVersion, tls: (((openPort == 16993) || (dualPorts == true)) ? 1 : 0), state: provisioningState, hostname: rinfo.address, hosttype: 'addr' };
            }
        });
    };

    // Change Intel AMT information in the database and event the changes
    obj.changeAmtState = function (nodeid, version, provisioningState, tls) {
        //console.log('changeAmtState', nodeid, version, provisioningState, tls);
        obj.parent.db.Get(nodeid, function (err, nodes) {
            if (nodes.length != 1) return;
            var node = nodes[0];

            // Get the mesh for this device
            obj.parent.db.Get(node.meshid, function (err, meshes) {
                if (meshes.length != 1) return;
                var mesh = meshes[0];

                // Ready the node change event
                var changes = [], event = { etype: 'node', action: 'changenode', nodeid: node._id };
                event.msg = +": ";

                // Make the change & save
                var change = false;
                if (node.intelamt == undefined) { node.intelamt = {}; }
                if (node.intelamt.tls != tls) { node.intelamt.tls = tls; change = true; changes.push(tls == 1 ? 'TLS' : 'NoTLS'); }
                if (obj.compareAmtVersionStr(node.intelamt.ver, version)) { node.intelamt.ver = version; change = true; changes.push('AMT Version ' + version); }
                if (node.intelamt.state != provisioningState) { node.intelamt.state = provisioningState; change = true; changes.push('AMT State'); }
                if (change == true) {
                    // Make the change in the database
                    obj.parent.db.Set(node);

                    // Event the node change
                    event.msg = 'Intel&reg; AMT changed device ' + node.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ');
                    event.node = obj.parent.webserver.CloneSafeNode(node);
                    if (obj.parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    obj.parent.DispatchEvent(['*', node.meshid], obj, event);
                }
            });
        });
    };

    // Return true if we should change the Intel AMT version number
    obj.compareAmtVersionStr = function (oldVer, newVer) {
        if (oldVer == newVer) return false; // Versions are same already, don't update.
        if (newVer == undefined || newVer == null) return false; // New version is bad, don't update it.
        if (oldVer == undefined || oldVer == null) return true; // Old version is no good anyway, update it.
        var oldVerArr = oldVer.toString().split('.');
        var newVerArr = newVer.toString().split('.');
        if ((oldVerArr.length < 2) || (newVerArr.length < 2)) return false;
        if ((oldVerArr[0] != newVerArr[0]) || (oldVerArr[1] != newVerArr[1])) return true;
        if (newVerArr.length > oldVerArr.length) return true;
        if ((newVerArr.length == 3) && (oldVerArr.length == 3) && (oldVerArr[2] != newVerArr[2])) return true;
        return false;
    };

    // Check the presense of a specific Intel AMT computer using RMCP
    obj.checkTcpPresence = function (host, port, scaninfo, func) { obj.ResolveName(host, function (hostname, ip) { obj.checkTcpPresenceEx(ip, port, scaninfo, func); }); };

    // Check that we can connect TCP to a given port
    obj.checkTcpPresenceEx = function (host, port, scaninfo, func) {
        if (host == null) return;
        //console.log('checkTcpPresence(' + host + ':' + port + ')');
        try {
            var client;
            if (port == 16992) {
                // Connect using TCP
                client = new obj.net.Socket();
                client.connect(port, host, function () { this.write('GET / HTTP/1.1\r\nhost: ' + host + '\r\n\r\n'); });
            } else {
                // Connect using TLS, we will switch from default TLS to TLS1-only and back if we get a connection error to support older Intel AMT.
                if (scaninfo.tlsoption == null) { scaninfo.tlsoption = 0; }
                const tlsOptions = { rejectUnauthorized: false, ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE };
                if (scaninfo.tlsoption == 1) { tlsOptions.secureProtocol = 'TLSv1_method'; }
                client = obj.tls.connect(port, host, tlsOptions, function () { this.write('GET / HTTP/1.1\r\nhost: ' + host + '\r\n\r\n'); });
            }
            client.scaninfo = scaninfo;
            client.func = func;
            client.port = port;
            client.setTimeout(10000);
            client.on('data', function (data) { var version = obj.getIntelAmtVersionFromHeaders(data.toString()); if (this.scaninfo.tcp != null) { delete this.scaninfo.tcp; try { this.destroy(); } catch (ex) { } this.func(this.scaninfo, version != null, version); } });
            client.on('error', function () { if (this.scaninfo.tlsoption == 0) { this.scaninfo.tlsoption = 1; } else if (this.scaninfo.tlsoption == 1) { this.scaninfo.tlsoption = 0; } if (this.scaninfo.tcp != null) { delete this.scaninfo.tcp; try { this.destroy(); } catch (ex) { } this.func(this.scaninfo, false); } });
            client.on('timeout', function () { if (this.scaninfo.tcp != null) { delete this.scaninfo.tcp; try { this.destroy(); } catch (ex) { } this.func(this.scaninfo, false); } });
            client.on('close', function () { if (this.scaninfo.tcp != null) { delete this.scaninfo.tcp; try { this.destroy(); } catch (ex) { } this.func(this.scaninfo, false); } });
            client.on('end', function () { if (this.scaninfo.tcp != null) { delete this.scaninfo.tcp; try { this.destroy(); } catch (ex) { } this.func(this.scaninfo, false); } });
            scaninfo.tcp = client;
        } catch (ex) { console.log(ex); }
    };

    // Return the Intel AMT version from the HTTP headers. Return null if nothing is found.
    obj.getIntelAmtVersionFromHeaders = function (headers) {
        if (headers == null || headers.length == 0) return null;
        var lines = headers.split('\r\n');
        for (var i in lines) {
            // Look for the Intel AMT version
            if (lines[i].substring(0, 46) == 'Server: Intel(R) Active Management Technology ') {
                // We need to check that the Intel AMT version is correct, in the "a.b.c" format
                var ver = lines[i].substring(46), splitver = ver.split('.');
                if ((splitver.length == 3 || splitver.length == 4) && ('' + parseInt(splitver[0]) === splitver[0]) && ('' + parseInt(splitver[1]) === splitver[1]) && ('' + parseInt(splitver[2]) === splitver[2])) { return (splitver[0] + '.' + splitver[1] + '.' + splitver[2]); }
            }
        }
        return null;
    };

    //console.log(obj.getIntelAmtVersionFromHeaders("HTTP/1.1 303 See Other\r\nLocation: /logon.htm\r\nContent-Length: 0\r\nServer: Intel(R) Active Management Technology 7.1.91\r\n\r\n"));

    return obj;
};