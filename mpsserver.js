/**
* @description MeshCentral Intel(R) AMT MPS server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a Intel AMT MPS server object
module.exports.CreateMpsServer = function (parent, db, args, certificates) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = certificates;
    obj.ciraConnections = {};
    var tlsSessionStore = {};       // Store TLS session information for quick resume.
    var tlsSessionStoreCount = 0;   // Number of cached TLS session information in store.
    const constants = (require('crypto').constants ? require('crypto').constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.
    const common = require("./common.js");
    const net = require("net");
    const tls = require("tls");
    const MAX_IDLE = 90000;         // 90 seconds max idle time, higher than the typical KEEP-ALIVE periode of 60 seconds

    if (obj.args.mpstlsoffload) {
        obj.server = net.createServer(onConnection);
    } else {
        // Note that in oder to support older Intel AMT CIRA connections, we have to turn on TLSv1.
        obj.server = tls.createServer({ key: certificates.mps.key, cert: certificates.mps.cert, minVersion: 'TLSv1', requestCert: true, rejectUnauthorized: false, ciphers: "HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION }, onConnection);
        //obj.server.on('secureConnection', function () { /*console.log('tlsServer secureConnection');*/ });
        //obj.server.on('error', function () { console.log('MPS tls server error'); });
        obj.server.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
        obj.server.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
    }

    obj.server.listen(args.mpsport, function () { console.log("MeshCentral Intel(R) AMT server running on " + certificates.AmtMpsName + ":" + args.mpsport + ((args.mpsaliasport != null) ? (", alias port " + args.mpsaliasport) : "") + "."); }).on("error", function (err) { console.error("ERROR: MeshCentral Intel(R) AMT server port " + args.mpsport + " is not available."); if (args.exactports) { process.exit(); } });
    obj.server.on('tlsClientError', function (err, tlssocket) { if (args.mpsdebug) { var remoteAddress = tlssocket.remoteAddress; if (tlssocket.remoteFamily == 'IPv6') { remoteAddress = '[' + remoteAddress + ']'; } console.log('MPS:Invalid TLS connection from ' + remoteAddress + ':' + tlssocket.remotePort + '.'); } });
    obj.parent.updateServerState("mps-port", args.mpsport);
    obj.parent.updateServerState("mps-name", certificates.AmtMpsName);
    if (args.mpsaliasport != null) { obj.parent.updateServerState("mps-alias-port", args.mpsaliasport); }

    const APFProtocol = {
        UNKNOWN: 0,
        DISCONNECT: 1,
        SERVICE_REQUEST: 5,
        SERVICE_ACCEPT: 6,
        USERAUTH_REQUEST: 50,
        USERAUTH_FAILURE: 51,
        USERAUTH_SUCCESS: 52,
        GLOBAL_REQUEST: 80,
        REQUEST_SUCCESS: 81,
        REQUEST_FAILURE: 82,
        CHANNEL_OPEN: 90,
        CHANNEL_OPEN_CONFIRMATION: 91,
        CHANNEL_OPEN_FAILURE: 92,
        CHANNEL_WINDOW_ADJUST: 93,
        CHANNEL_DATA: 94,
        CHANNEL_CLOSE: 97,
        PROTOCOLVERSION: 192,
        KEEPALIVE_REQUEST: 208,
        KEEPALIVE_REPLY: 209,
        KEEPALIVE_OPTIONS_REQUEST: 210,
        KEEPALIVE_OPTIONS_REPLY: 211
    };

    /*
    const APFDisconnectCode = {
        HOST_NOT_ALLOWED_TO_CONNECT: 1,
        PROTOCOL_ERROR: 2,
        KEY_EXCHANGE_FAILED: 3,
        RESERVED: 4,
        MAC_ERROR: 5,
        COMPRESSION_ERROR: 6,
        SERVICE_NOT_AVAILABLE: 7,
        PROTOCOL_VERSION_NOT_SUPPORTED: 8,
        HOST_KEY_NOT_VERIFIABLE: 9,
        CONNECTION_LOST: 10,
        BY_APPLICATION: 11,
        TOO_MANY_CONNECTIONS: 12,
        AUTH_CANCELLED_BY_USER: 13,
        NO_MORE_AUTH_METHODS_AVAILABLE: 14,
        INVALID_CREDENTIALS: 15,
        CONNECTION_TIMED_OUT: 16,
        BY_POLICY: 17,
        TEMPORARILY_UNAVAILABLE: 18
    };

    const APFChannelOpenFailCodes = {
        ADMINISTRATIVELY_PROHIBITED: 1,
        CONNECT_FAILED: 2,
        UNKNOWN_CHANNEL_TYPE: 3,
        RESOURCE_SHORTAGE: 4,
    };
    */

    const APFChannelOpenFailureReasonCode = {
        AdministrativelyProhibited: 1,
        ConnectFailed: 2,
        UnknownChannelType: 3,
        ResourceShortage: 4,
    };

    // Stat counters
    var connectionCount = 0;
    var userAuthRequestCount = 0;
    var incorrectPasswordCount = 0;
    var meshNotFoundCount = 0;
    var unknownTlsNodeCount = 0;
    var unknownTlsMeshIdCount = 0;
    var addedTlsDeviceCount = 0;
    var unknownNodeCount = 0;
    var unknownMeshIdCount = 0;
    var addedDeviceCount = 0;
    var ciraTimeoutCount = 0;
    var protocolVersionCount = 0;
    var badUserNameLengthCount = 0;
    var channelOpenCount = 0;
    var channelOpenConfirmCount = 0;
    var channelOpenFailCount = 0;
    var channelCloseCount = 0;
    var disconnectCommandCount = 0;
    var socketClosedCount = 0;
    var socketErrorCount = 0;
    var maxDomainDevicesReached = 0;

    // Return statistics about this MPS server
    obj.getStats = function () {
        return {
            ciraConnections: Object.keys(obj.ciraConnections).length,
            tlsSessionStore: Object.keys(tlsSessionStore).length,
            connectionCount: connectionCount,
            userAuthRequestCount: userAuthRequestCount,
            incorrectPasswordCount: incorrectPasswordCount,
            meshNotFoundCount: meshNotFoundCount,
            unknownTlsNodeCount: unknownTlsNodeCount,
            unknownTlsMeshIdCount: unknownTlsMeshIdCount,
            addedTlsDeviceCount: addedTlsDeviceCount,
            unknownNodeCount: unknownNodeCount,
            unknownMeshIdCount: unknownMeshIdCount,
            addedDeviceCount: addedDeviceCount,
            ciraTimeoutCount: ciraTimeoutCount,
            protocolVersionCount: protocolVersionCount,
            badUserNameLengthCount: badUserNameLengthCount,
            channelOpenCount: channelOpenCount,
            channelOpenConfirmCount: channelOpenConfirmCount,
            channelOpenFailCount: channelOpenFailCount,
            channelCloseCount: channelCloseCount,
            disconnectCommandCount: disconnectCommandCount,
            socketClosedCount: socketClosedCount,
            socketErrorCount: socketErrorCount,
            maxDomainDevicesReached : maxDomainDevicesReached
        };
    }

    function onConnection(socket) {
        connectionCount++;
        if (obj.args.mpstlsoffload) {
            socket.tag = { first: true, clientCert: null, accumulator: "", activetunnels: 0, boundPorts: [], socket: socket, host: null, nextchannelid: 4, channels: {}, nextsourceport: 0 };
        } else {
            socket.tag = { first: true, clientCert: socket.getPeerCertificate(true), accumulator: "", activetunnels: 0, boundPorts: [], socket: socket, host: null, nextchannelid: 4, channels: {}, nextsourceport: 0 };
        }
        socket.setEncoding("binary");
        Debug(1, "MPS:New CIRA connection");

        // Setup the CIRA keep alive timer
        socket.setTimeout(MAX_IDLE);
        socket.on("timeout", () => { ciraTimeoutCount++; Debug(1, "MPS:CIRA timeout, disconnecting."); try { socket.end(); } catch (e) { } });

        socket.addListener("data", function (data) {
            if (args.mpsdebug) { var buf = Buffer.from(data, "binary"); console.log("MPS <-- (" + buf.length + "):" + buf.toString('hex')); } // Print out received bytes
            socket.tag.accumulator += data;

            // Detect if this is an HTTPS request, if it is, return a simple answer and disconnect. This is useful for debugging access to the MPS port.
            if (socket.tag.first == true) {
                if (socket.tag.accumulator.length < 3) return;
                //if (!socket.tag.clientCert.subject) { console.log("MPS Connection, no client cert: " + socket.remoteAddress); socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMeshCentral2 MPS server.\r\nNo client certificate given.'); socket.end(); return; }
                if (socket.tag.accumulator.substring(0, 3) == "GET") { if (args.mpsdebug) { console.log("MPS Connection, HTTP GET detected: " + socket.remoteAddress); } socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>MeshCentral2 MPS server.<br />Intel&reg; AMT computers should connect here.</body></html>"); socket.end(); return; }
                socket.tag.first = false;

                // Setup this node with certificate authentication
                if (socket.tag.clientCert && socket.tag.clientCert.subject && socket.tag.clientCert.subject.O && socket.tag.clientCert.subject.O.length == 64) {
                    // This is a node where the MeshID is indicated within the CIRA certificate
                    var domainid = '', meshid;
                    var xx = socket.tag.clientCert.subject.O.split('/');
                    if (xx.length == 1) { meshid = xx[0]; } else { domainid = xx[0].toLowerCase(); meshid = xx[1]; }

                    // Check the incoming domain
                    var domain = obj.parent.config.domains[domainid];
                    if (domain == null) { console.log('CIRA connection for invalid domain. meshid: ' + meshid); socket.end(); return; }

                    socket.tag.domain = domain;
                    socket.tag.domainid = domainid;
                    socket.tag.meshid = 'mesh/' + domainid + '/' + meshid;
                    socket.tag.nodeid = 'node/' + domainid + '/' + require('crypto').createHash('sha384').update(common.hex2rstr(socket.tag.clientCert.modulus, 'binary')).digest('base64').replace(/\+/g, '@').replace(/\//g, '$');
                    socket.tag.name = socket.tag.clientCert.subject.CN;
                    socket.tag.connectTime = Date.now();
                    socket.tag.host = '';

                    // Fetch the mesh
                    obj.db.Get(socket.tag.meshid, function (err, meshes) {
                        if ((meshes != null) && (meshes.length === 1)) {
                            var mesh = meshes[0];
                            obj.db.Get(socket.tag.nodeid, function (err, nodes) {
                                if ((nodes == null) || (nodes.length !== 1)) {
                                    if (mesh.mtype == 1) {
                                        // Check if we already have too many devices for this domain
                                        if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                                            db.isMaxType(domain.limits.maxdevices, 'node', domain.id, function (ismax, count) {
                                                if (ismax == true) {
                                                    // Too many devices in this domain.
                                                    maxDomainDevicesReached++;
                                                    console.log('Too many devices on this domain to accept the CIRA connection. meshid: ' + socket.tag.meshid);
                                                    socket.end();
                                                } else {
                                                    // We are under the limit, create the new device.
                                                    // Node is not in the database, add it. Credentials will be empty until added by the user.
                                                    var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, host: null, domain: domainid, intelamt: { user: '', pass: '', tls: 0, state: 2 } };
                                                    obj.db.Set(device);

                                                    // Event the new node
                                                    addedTlsDeviceCount++;
                                                    var device2 = common.Clone(device);
                                                    if (device2.intelamt.pass != null) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                                    var change = 'CIRA added device ' + socket.tag.name + ' to mesh ' + mesh.name;
                                                    obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: device2, msg: change, domain: domainid });

                                                    // Add the connection to the MPS connection list
                                                    obj.ciraConnections[socket.tag.nodeid] = socket;
                                                    obj.parent.SetConnectivityState(socket.tag.meshid, socket.tag.nodeid, socket.tag.connectTime, 2, 7); // TODO: Right now report power state as "present" (7) until we can poll.
                                                }
                                            });
                                            return;
                                        } else {
                                            // Node is not in the database, add it. Credentials will be empty until added by the user.
                                            var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, host: null, domain: domainid, intelamt: { user: '', pass: '', tls: 0, state: 2 } };
                                            obj.db.Set(device);

                                            // Event the new node
                                            addedTlsDeviceCount++;
                                            var device2 = common.Clone(device);
                                            if (device2.intelamt.pass != null) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                            var change = 'CIRA added device ' + socket.tag.name + ' to mesh ' + mesh.name;
                                            obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: device2, msg: change, domain: domainid });
                                        }
                                    } else {
                                        // New CIRA connection for unknown node, disconnect.
                                        unknownTlsNodeCount++;
                                        console.log('CIRA connection for unknown node with incorrect group type. meshid: ' + socket.tag.meshid);
                                        socket.end();
                                        return;
                                    }
                                } else {
                                    // Node is already present
                                    var node = nodes[0];
                                    if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                                }

                                // Add the connection to the MPS connection list
                                obj.ciraConnections[socket.tag.nodeid] = socket;
                                obj.parent.SetConnectivityState(socket.tag.meshid, socket.tag.nodeid, socket.tag.connectTime, 2, 7); // TODO: Right now report power state as "present" (7) until we can poll.
                            });
                        } else {
                            unknownTlsMeshIdCount++;
                            console.log('ERROR: Intel AMT CIRA connected with unknown groupid: ' + socket.tag.meshid);
                            socket.end();
                            return;
                        }
                    });
                } else {
                    // This node connected without certificate authentication, use password auth
                    //console.log('Intel AMT CIRA connected without certificate authentication');
                }
            }

            try {
                // Parse all of the APF data we can
                var l = 0;
                do { l = ProcessCommand(socket); if (l > 0) { socket.tag.accumulator = socket.tag.accumulator.substring(l); } } while (l > 0);
                if (l < 0) { socket.end(); }
            } catch (e) {
                console.log(e);
            }
        });

        // Process one AFP command
        function ProcessCommand(socket) {
            var cmd = socket.tag.accumulator.charCodeAt(0);
            var len = socket.tag.accumulator.length;
            var data = socket.tag.accumulator;
            if (len == 0) { return 0; }

            switch (cmd) {
                case APFProtocol.KEEPALIVE_REQUEST: {
                    if (len < 5) return 0;
                    Debug(3, 'MPS:KEEPALIVE_REQUEST');
                    SendKeepAliveReply(socket, common.ReadInt(data, 1));
                    return 5;
                }
                case APFProtocol.KEEPALIVE_REPLY: {
                    if (len < 5) return 0;
                    Debug(3, 'MPS:KEEPALIVE_REPLY');
                    return 5;
                }
                case APFProtocol.PROTOCOLVERSION: {
                    if (len < 93) return 0;
                    protocolVersionCount++;
                    socket.tag.MajorVersion = common.ReadInt(data, 1);
                    socket.tag.MinorVersion = common.ReadInt(data, 5);
                    socket.tag.SystemId = guidToStr(common.rstr2hex(data.substring(13, 29))).toLowerCase();
                    Debug(3, 'MPS:PROTOCOLVERSION', socket.tag.MajorVersion, socket.tag.MinorVersion, socket.tag.SystemId);
                    return 93;
                }
                case APFProtocol.USERAUTH_REQUEST: {
                    if (len < 13) return 0;
                    userAuthRequestCount++;
                    var usernameLen = common.ReadInt(data, 1);
                    var username = data.substring(5, 5 + usernameLen);
                    var serviceNameLen = common.ReadInt(data, 5 + usernameLen);
                    var serviceName = data.substring(9 + usernameLen, 9 + usernameLen + serviceNameLen);
                    var methodNameLen = common.ReadInt(data, 9 + usernameLen + serviceNameLen);
                    var methodName = data.substring(13 + usernameLen + serviceNameLen, 13 + usernameLen + serviceNameLen + methodNameLen);
                    var passwordLen = 0, password = null;
                    if (methodName == 'password') {
                        passwordLen = common.ReadInt(data, 14 + usernameLen + serviceNameLen + methodNameLen);
                        password = data.substring(18 + usernameLen + serviceNameLen + methodNameLen, 18 + usernameLen + serviceNameLen + methodNameLen + passwordLen);
                    }
                    //console.log('MPS:USERAUTH_REQUEST user=' + username + ', service=' + serviceName + ', method=' + methodName + ', password=' + password);
                    Debug(3, 'MPS:USERAUTH_REQUEST user=' + username + ', service=' + serviceName + ', method=' + methodName + ', password=' + password);

                    // Check the CIRA password
                    if ((args.mpspass != null) && (password != args.mpspass)) { incorrectPasswordCount++; Debug(1, 'MPS:Incorrect password', username, password); SendUserAuthFail(socket); return -1; }

                    // Check the CIRA username, which should be the start of the MeshID.
                    if (usernameLen != 16) { badUserNameLengthCount++; Debug(1, 'MPS:Username length not 16', username, password); SendUserAuthFail(socket); return -1; }
                    var meshIdStart = '/' + username, mesh = null;
                    if (obj.parent.webserver.meshes) { for (var i in obj.parent.webserver.meshes) { if (obj.parent.webserver.meshes[i]._id.replace(/\@/g, 'X').replace(/\$/g, 'X').indexOf(meshIdStart) > 0) { mesh = obj.parent.webserver.meshes[i]; break; } } }
                    if (mesh == null) { meshNotFoundCount++; Debug(1, 'MPS:Mesh not found', username, password); SendUserAuthFail(socket); return -1; }

                    // If this is a agent-less mesh, use the device guid 3 times as ID.
                    if (mesh.mtype == 1) {
                        // Intel AMT GUID (socket.tag.SystemId) will be used as NodeID
                        var systemid = socket.tag.SystemId.split('-').join('');
                        var nodeid = Buffer.from(systemid + systemid + systemid, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                        var domain = obj.parent.config.domains[mesh.domain];
                        socket.tag.domain = domain;
                        socket.tag.domainid = mesh.domain;
                        socket.tag.name = '';
                        socket.tag.nodeid = 'node/' + mesh.domain + '/' + nodeid; // Turn 16bit systemid guid into 48bit nodeid that is base64 encoded
                        socket.tag.meshid = mesh._id;
                        socket.tag.connectTime = Date.now();

                        obj.db.Get(socket.tag.nodeid, function (err, nodes) {
                            if ((nodes == null) || (nodes.length !== 1)) {
                                // Check if we already have too many devices for this domain
                                if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                                    db.isMaxType(domain.limits.maxdevices, 'node', mesh.domain, function (ismax, count) {
                                        if (ismax == true) {
                                            // Too many devices in this domain.
                                            maxDomainDevicesReached++;
                                            console.log('Too many devices on this domain to accept the CIRA connection. meshid: ' + socket.tag.meshid);
                                            socket.end();
                                        } else {
                                            // We are under the limit, create the new device.
                                            // Node is not in the database, add it. Credentials will be empty until added by the user.
                                            var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, host: null, domain: mesh.domain, intelamt: { user: '', pass: '', tls: 0, state: 2 } };
                                            obj.db.Set(device);

                                            // Event the new node
                                            addedDeviceCount++;
                                            var device2 = common.Clone(device);
                                            if (device2.intelamt.pass != null) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                            var change = 'CIRA added device ' + socket.tag.name + ' to group ' + mesh.name;
                                            obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: device2, msg: change, domain: mesh.domain });

                                            // Add the connection to the MPS connection list
                                            obj.ciraConnections[socket.tag.nodeid] = socket;
                                            obj.parent.SetConnectivityState(socket.tag.meshid, socket.tag.nodeid, socket.tag.connectTime, 2, 7); // TODO: Right now report power state as "present" (7) until we can poll.
                                            SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                                        }
                                    });
                                    return;
                                } else {
                                    // Node is not in the database, add it. Credentials will be empty until added by the user.
                                    var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, host: null, domain: mesh.domain, intelamt: { user: '', pass: '', tls: 0, state: 2 } };
                                    obj.db.Set(device);

                                    // Event the new node
                                    addedDeviceCount++;
                                    var device2 = common.Clone(device);
                                    if (device2.intelamt.pass != null) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                    var change = 'CIRA added device ' + socket.tag.name + ' to group ' + mesh.name;
                                    obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: device2, msg: change, domain: mesh.domain });
                                }
                            } else {
                                // Node is already present
                                var node = nodes[0];
                                if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                            }

                            // Add the connection to the MPS connection list
                            obj.ciraConnections[socket.tag.nodeid] = socket;
                            obj.parent.SetConnectivityState(socket.tag.meshid, socket.tag.nodeid, socket.tag.connectTime, 2, 7); // TODO: Right now report power state as "present" (7) until we can poll.
                            SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                        });
                    } else if (mesh.mtype == 2) { // If this is a agent mesh, search the mesh for this device UUID
                        // Intel AMT GUID (socket.tag.SystemId) will be used to search the node
                        obj.db.getAmtUuidNode(mesh._id, socket.tag.SystemId, function (err, nodes) { // TODO: May need to optimize this request with indexes
                            if ((nodes == null) || (nodes.length !== 1)) {
                                // New CIRA connection for unknown node, disconnect.
                                unknownNodeCount++;
                                console.log('CIRA connection for unknown node. groupid: ' + mesh._id + ', uuid: ' + socket.tag.SystemId);
                                socket.end();
                                return;
                            }

                            // Node is present
                            var node = nodes[0];
                            if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                            socket.tag.nodeid = node._id;
                            socket.tag.meshid = mesh._id;
                            socket.tag.connectTime = Date.now();

                            // Add the connection to the MPS connection list
                            obj.ciraConnections[socket.tag.nodeid] = socket;
                            obj.parent.SetConnectivityState(socket.tag.meshid, socket.tag.nodeid, socket.tag.connectTime, 2, 7); // TODO: Right now report power state as "present" (7) until we can poll.
                            SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                        });
                    } else { // Unknown mesh type
                        // New CIRA connection for unknown node, disconnect.
                        unknownMeshIdCount++;
                        console.log('CIRA connection to a unknown group type. groupid: ' + socket.tag.meshid);
                        socket.end();
                        return;
                    }
                    return 18 + usernameLen + serviceNameLen + methodNameLen + passwordLen;
                }
                case APFProtocol.SERVICE_REQUEST: {
                    if (len < 5) return 0;
                    var xserviceNameLen = common.ReadInt(data, 1);
                    if (len < 5 + xserviceNameLen) return 0;
                    var xserviceName = data.substring(5, 5 + xserviceNameLen);
                    Debug(3, 'MPS:SERVICE_REQUEST', xserviceName);
                    if (xserviceName == "pfwd@amt.intel.com") { SendServiceAccept(socket, "pfwd@amt.intel.com"); }
                    if (xserviceName == "auth@amt.intel.com") { SendServiceAccept(socket, "auth@amt.intel.com"); }
                    return 5 + xserviceNameLen;
                }
                case APFProtocol.GLOBAL_REQUEST: {
                    if (len < 14) return 0;
                    var requestLen = common.ReadInt(data, 1);
                    if (len < 14 + requestLen) return 0;
                    var request = data.substring(5, 5 + requestLen);
                    //var wantResponse = data.charCodeAt(5 + requestLen);

                    if (request == "tcpip-forward") {
                        var addrLen = common.ReadInt(data, 6 + requestLen);
                        if (len < 14 + requestLen + addrLen) return 0;
                        var addr = data.substring(10 + requestLen, 10 + requestLen + addrLen);
                        var port = common.ReadInt(data, 10 + requestLen + addrLen);
                        Debug(2, 'MPS:GLOBAL_REQUEST', request, addr + ':' + port);
                        ChangeHostname(socket, addr, socket.tag.SystemId);
                        if (socket.tag.boundPorts.indexOf(port) == -1) { socket.tag.boundPorts.push(port); }
                        SendTcpForwardSuccessReply(socket, port);
                        return 14 + requestLen + addrLen;
                    }

                    if (request == "cancel-tcpip-forward") {
                        var addrLen = common.ReadInt(data, 6 + requestLen);
                        if (len < 14 + requestLen + addrLen) return 0;
                        var addr = data.substring(10 + requestLen, 10 + requestLen + addrLen);
                        var port = common.ReadInt(data, 10 + requestLen + addrLen);
                        Debug(2, 'MPS:GLOBAL_REQUEST', request, addr + ':' + port);
                        var portindex = socket.tag.boundPorts.indexOf(port);
                        if (portindex >= 0) { socket.tag.boundPorts.splice(portindex, 1); }
                        SendTcpForwardCancelReply(socket);
                        return 14 + requestLen + addrLen;
                    }

                    if (request == "udp-send-to@amt.intel.com") {
                        var addrLen = common.ReadInt(data, 6 + requestLen);
                        if (len < 26 + requestLen + addrLen) return 0;
                        var addr = data.substring(10 + requestLen, 10 + requestLen + addrLen);
                        var port = common.ReadInt(data, 10 + requestLen + addrLen);
                        var oaddrLen = common.ReadInt(data, 14 + requestLen + addrLen);
                        if (len < 26 + requestLen + addrLen + oaddrLen) return 0;
                        var oaddr = data.substring(18 + requestLen, 18 + requestLen + addrLen);
                        var oport = common.ReadInt(data, 18 + requestLen + addrLen + oaddrLen);
                        var datalen = common.ReadInt(data, 22 + requestLen + addrLen + oaddrLen);
                        if (len < 26 + requestLen + addrLen + oaddrLen + datalen) return 0;
                        Debug(2, 'MPS:GLOBAL_REQUEST', request, addr + ':' + port, oaddr + ':' + oport, datalen);
                        // TODO
                        return 26 + requestLen + addrLen + oaddrLen + datalen;
                    }

                    return 6 + requestLen;
                }
                case APFProtocol.CHANNEL_OPEN: {
                    if (len < 33) return 0;
                    var ChannelTypeLength = common.ReadInt(data, 1);
                    if (len < (33 + ChannelTypeLength)) return 0;

                    // Decode channel identifiers and window size
                    var ChannelType = data.substring(5, 5 + ChannelTypeLength);
                    var SenderChannel = common.ReadInt(data, 5 + ChannelTypeLength);
                    var WindowSize = common.ReadInt(data, 9 + ChannelTypeLength);

                    // Decode the target
                    var TargetLen = common.ReadInt(data, 17 + ChannelTypeLength);
                    if (len < (33 + ChannelTypeLength + TargetLen)) return 0;
                    var Target = data.substring(21 + ChannelTypeLength, 21 + ChannelTypeLength + TargetLen);
                    var TargetPort = common.ReadInt(data, 21 + ChannelTypeLength + TargetLen);

                    // Decode the source
                    var SourceLen = common.ReadInt(data, 25 + ChannelTypeLength + TargetLen);
                    if (len < (33 + ChannelTypeLength + TargetLen + SourceLen)) return 0;
                    var Source = data.substring(29 + ChannelTypeLength + TargetLen, 29 + ChannelTypeLength + TargetLen + SourceLen);
                    var SourcePort = common.ReadInt(data, 29 + ChannelTypeLength + TargetLen + SourceLen);

                    channelOpenCount++;
                    Debug(3, 'MPS:CHANNEL_OPEN', ChannelType, SenderChannel, WindowSize, Target + ':' + TargetPort, Source + ':' + SourcePort);

                    // Check if we understand this channel type
                    //if (ChannelType.toLowerCase() == "direct-tcpip")
                    {
                        // We don't understand this channel type, send an error back
                        SendChannelOpenFailure(socket, SenderChannel, APFChannelOpenFailureReasonCode.UnknownChannelType);
                        return 33 + ChannelTypeLength + TargetLen + SourceLen;
                    }

                    /*
                    // This is a correct connection. Lets get it setup
                    var MeshAmtEventEndpoint = { ServerChannel: GetNextBindId(), AmtChannel: SenderChannel, MaxWindowSize: 2048, CurrentWindowSize:2048, SendWindow: WindowSize, InfoHeader: "Target: " + Target + ":" + TargetPort + ", Source: " + Source + ":" + SourcePort};
                    // TODO: Connect this socket for a WSMAN event
                    SendChannelOpenConfirmation(socket, SenderChannel, MeshAmtEventEndpoint.ServerChannel, MeshAmtEventEndpoint.MaxWindowSize);
                    */

                    return 33 + ChannelTypeLength + TargetLen + SourceLen;
                }
                case APFProtocol.CHANNEL_OPEN_CONFIRMATION:
                    {
                        if (len < 17) return 0;
                        var RecipientChannel = common.ReadInt(data, 1);
                        var SenderChannel = common.ReadInt(data, 5);
                        var WindowSize = common.ReadInt(data, 9);
                        socket.tag.activetunnels++;
                        var cirachannel = socket.tag.channels[RecipientChannel];
                        if (cirachannel == null) { /*console.log("MPS Error in CHANNEL_OPEN_CONFIRMATION: Unable to find channelid " + RecipientChannel);*/ return 17; }
                        cirachannel.amtchannelid = SenderChannel;
                        cirachannel.sendcredits = cirachannel.amtCiraWindow = WindowSize;
                        channelOpenConfirmCount++;
                        Debug(3, 'MPS:CHANNEL_OPEN_CONFIRMATION', RecipientChannel, SenderChannel, WindowSize);
                        if (cirachannel.closing == 1) {
                            // Close this channel
                            SendChannelClose(cirachannel.socket, cirachannel.amtchannelid);
                        } else {
                            cirachannel.state = 2;
                            // Send any pending data
                            if (cirachannel.sendBuffer != null) {
                                if (cirachannel.sendBuffer.length <= cirachannel.sendcredits) {
                                    // Send the entire pending buffer
                                    SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer);
                                    cirachannel.sendcredits -= cirachannel.sendBuffer.length;
                                    delete cirachannel.sendBuffer;
                                    if (cirachannel.onSendOk) { cirachannel.onSendOk(cirachannel); }
                                } else {
                                    // Send a part of the pending buffer
                                    SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer.substring(0, cirachannel.sendcredits));
                                    cirachannel.sendBuffer = cirachannel.sendBuffer.substring(cirachannel.sendcredits);
                                    cirachannel.sendcredits = 0;
                                }
                            }
                            // Indicate the channel is open
                            if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); }
                        }
                        return 17;
                    }
                case APFProtocol.CHANNEL_OPEN_FAILURE:
                    {
                        if (len < 17) return 0;
                        var RecipientChannel = common.ReadInt(data, 1);
                        var ReasonCode = common.ReadInt(data, 5);
                        channelOpenFailCount++;
                        Debug(3, 'MPS:CHANNEL_OPEN_FAILURE', RecipientChannel, ReasonCode);
                        var cirachannel = socket.tag.channels[RecipientChannel];
                        if (cirachannel == null) { console.log("MPS Error in CHANNEL_OPEN_FAILURE: Unable to find channelid " + RecipientChannel); return 17; }
                        if (cirachannel.state > 0) {
                            cirachannel.state = 0;
                            if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); }
                            delete socket.tag.channels[RecipientChannel];
                        }
                        return 17;
                    }
                case APFProtocol.CHANNEL_CLOSE:
                    {
                        if (len < 5) return 0;
                        var RecipientChannel = common.ReadInt(data, 1);
                        channelCloseCount++;
                        Debug(3, 'MPS:CHANNEL_CLOSE', RecipientChannel);
                        var cirachannel = socket.tag.channels[RecipientChannel];
                        if (cirachannel == null) { console.log("MPS Error in CHANNEL_CLOSE: Unable to find channelid " + RecipientChannel); return 5; }
                        socket.tag.activetunnels--;
                        if (cirachannel.state > 0) {
                            cirachannel.state = 0;
                            if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); }
                            delete socket.tag.channels[RecipientChannel];
                        }
                        return 5;
                    }
                case APFProtocol.CHANNEL_WINDOW_ADJUST:
                    {
                        if (len < 9) return 0;
                        var RecipientChannel = common.ReadInt(data, 1);
                        var ByteToAdd = common.ReadInt(data, 5);
                        var cirachannel = socket.tag.channels[RecipientChannel];
                        if (cirachannel == null) { console.log("MPS Error in CHANNEL_WINDOW_ADJUST: Unable to find channelid " + RecipientChannel); return 9; }
                        cirachannel.sendcredits += ByteToAdd;
                        Debug(3, 'MPS:CHANNEL_WINDOW_ADJUST', RecipientChannel, ByteToAdd, cirachannel.sendcredits);
                        if (cirachannel.state == 2 && cirachannel.sendBuffer != null) {
                            // Compute how much data we can send                
                            if (cirachannel.sendBuffer.length <= cirachannel.sendcredits) {
                                // Send the entire pending buffer
                                SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer);
                                cirachannel.sendcredits -= cirachannel.sendBuffer.length;
                                delete cirachannel.sendBuffer;
                                if (cirachannel.onSendOk) { cirachannel.onSendOk(cirachannel); }
                            } else {
                                // Send a part of the pending buffer
                                SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer.substring(0, cirachannel.sendcredits));
                                cirachannel.sendBuffer = cirachannel.sendBuffer.substring(cirachannel.sendcredits);
                                cirachannel.sendcredits = 0;
                            }
                        }
                        return 9;
                    }
                case APFProtocol.CHANNEL_DATA:
                    {
                        if (len < 9) return 0;
                        var RecipientChannel = common.ReadInt(data, 1);
                        var LengthOfData = common.ReadInt(data, 5);
                        if (len < (9 + LengthOfData)) return 0;
                        Debug(4, 'MPS:CHANNEL_DATA', RecipientChannel, LengthOfData);
                        var cirachannel = socket.tag.channels[RecipientChannel];
                        if (cirachannel == null) { console.log("MPS Error in CHANNEL_DATA: Unable to find channelid " + RecipientChannel); return 9 + LengthOfData; }
                        cirachannel.amtpendingcredits += LengthOfData;
                        if (cirachannel.onData) cirachannel.onData(cirachannel, data.substring(9, 9 + LengthOfData));
                        if (cirachannel.amtpendingcredits > (cirachannel.ciraWindow / 2)) {
                            SendChannelWindowAdjust(cirachannel.socket, cirachannel.amtchannelid, cirachannel.amtpendingcredits); // Adjust the buffer window
                            cirachannel.amtpendingcredits = 0;
                        }
                        return 9 + LengthOfData;
                    }
                case APFProtocol.DISCONNECT:
                    {
                        if (len < 7) return 0;
                        var ReasonCode = common.ReadInt(data, 1);
                        disconnectCommandCount++;
                        Debug(3, 'MPS:DISCONNECT', ReasonCode);
                        try { delete obj.ciraConnections[socket.tag.nodeid]; } catch (e) { }
                        obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2);
                        return 7;
                    }
                default:
                    {
                        Debug(1, 'MPS:Unknown CIRA command: ' + cmd);
                        return -1;
                    }
            }
        }

        socket.addListener("close", function () {
            socketClosedCount++;
            Debug(1, 'MPS:CIRA connection closed');
            try { delete obj.ciraConnections[socket.tag.nodeid]; } catch (e) { }
            obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2);
        });

        socket.addListener("error", function () {
            socketErrorCount++;
            //console.log("MPS Error: " + socket.remoteAddress);
        });

    }

    // Disconnect CIRA tunnel
    obj.close = function (socket) {
        try { socket.end(); } catch (e) { }
        try { delete obj.ciraConnections[socket.tag.nodeid]; } catch (e) { }
        obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2);
    };

    function SendServiceAccept(socket, service) {
        Write(socket, String.fromCharCode(APFProtocol.SERVICE_ACCEPT) + common.IntToStr(service.length) + service);
    }

    function SendTcpForwardSuccessReply(socket, port) {
        Write(socket, String.fromCharCode(APFProtocol.REQUEST_SUCCESS) + common.IntToStr(port));
    }

    function SendTcpForwardCancelReply(socket) {
        Write(socket, String.fromCharCode(APFProtocol.REQUEST_SUCCESS));
    }

    /*
    function SendKeepAliveRequest(socket, cookie) {
        Write(socket, String.fromCharCode(APFProtocol.KEEPALIVE_REQUEST) + common.IntToStr(cookie));
    }
    */

    function SendKeepAliveReply(socket, cookie) {
        Write(socket, String.fromCharCode(APFProtocol.KEEPALIVE_REPLY) + common.IntToStr(cookie));
    }

    function SendChannelOpenFailure(socket, senderChannel, reasonCode) {
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN_FAILURE) + common.IntToStr(senderChannel) + common.IntToStr(reasonCode) + common.IntToStr(0) + common.IntToStr(0));
    }

    /*
    function SendChannelOpenConfirmation(socket, recipientChannelId, senderChannelId, initialWindowSize) {
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN_CONFIRMATION) + common.IntToStr(recipientChannelId) + common.IntToStr(senderChannelId) + common.IntToStr(initialWindowSize) + common.IntToStr(-1));
    }
    */

    function SendChannelOpen(socket, direct, channelid, windowsize, target, targetport, source, sourceport) {
        var connectionType = ((direct == true) ? "direct-tcpip" : "forwarded-tcpip");
        if ((target == null) || (target == null)) target = ''; // TODO: Reports of target being undefined that causes target.length to fail. This is a hack.
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN) + common.IntToStr(connectionType.length) + connectionType + common.IntToStr(channelid) + common.IntToStr(windowsize) + common.IntToStr(-1) + common.IntToStr(target.length) + target + common.IntToStr(targetport) + common.IntToStr(source.length) + source + common.IntToStr(sourceport));
    }

    function SendChannelClose(socket, channelid) {
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_CLOSE) + common.IntToStr(channelid));
    }

    function SendChannelData(socket, channelid, data) {
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_DATA) + common.IntToStr(channelid) + common.IntToStr(data.length) + data);
    }

    function SendChannelWindowAdjust(socket, channelid, bytestoadd) {
        Debug(3, 'MPS:SendChannelWindowAdjust', channelid, bytestoadd);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_WINDOW_ADJUST) + common.IntToStr(channelid) + common.IntToStr(bytestoadd));
    }

    /*
    function SendDisconnect(socket, reasonCode) {
        Write(socket, String.fromCharCode(APFProtocol.DISCONNECT) + common.IntToStr(reasonCode) + common.ShortToStr(0));
    }
    */

    function SendUserAuthFail(socket) {
        Write(socket, String.fromCharCode(APFProtocol.USERAUTH_FAILURE) + common.IntToStr(8) + 'password' + common.ShortToStr(0));
    }

    function SendUserAuthSuccess(socket) {
        Write(socket, String.fromCharCode(APFProtocol.USERAUTH_SUCCESS));
    }

    function Write(socket, data) {
        if (args.mpsdebug) {
            // Print out sent bytes
            var buf = Buffer.from(data, "binary");
            console.log('MPS --> (' + buf.length + '):' + buf.toString('hex'));
            socket.write(buf);
        } else {
            socket.write(Buffer.from(data, "binary"));
        }
    }

    obj.SetupCiraChannel = function (socket, targetport) {
        var sourceport = (socket.tag.nextsourceport++ % 30000) + 1024;
        var cirachannel = { targetport: targetport, channelid: socket.tag.nextchannelid++, socket: socket, state: 1, sendcredits: 0, amtpendingcredits: 0, amtCiraWindow: 0, ciraWindow: 32768 };
        SendChannelOpen(socket, false, cirachannel.channelid, cirachannel.ciraWindow, socket.tag.host, targetport, "1.2.3.4", sourceport);

        // This function writes data to this CIRA channel
        cirachannel.write = function (data) {
            if (cirachannel.state == 0) return false;
            if (cirachannel.state == 1 || cirachannel.sendcredits == 0 || cirachannel.sendBuffer != null) {
                // Channel is connected, but we are out of credits. Add the data to the outbound buffer.
                if (cirachannel.sendBuffer == null) { cirachannel.sendBuffer = data; } else { cirachannel.sendBuffer += data; }
                return true;
            }
            // Compute how much data we can send                
            if (data.length <= cirachannel.sendcredits) {
                // Send the entire message
                SendChannelData(cirachannel.socket, cirachannel.amtchannelid, data);
                cirachannel.sendcredits -= data.length;
                return true;
            }
            // Send a part of the message
            cirachannel.sendBuffer = data.substring(cirachannel.sendcredits);
            SendChannelData(cirachannel.socket, cirachannel.amtchannelid, data.substring(0, cirachannel.sendcredits));
            cirachannel.sendcredits = 0;
            return false;
        };

        // This function closes this CIRA channel
        cirachannel.close = function () {
            if (cirachannel.state == 0 || cirachannel.closing == 1) return;
            if (cirachannel.state == 1) { cirachannel.closing = 1; cirachannel.state = 0; if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); } return; }
            cirachannel.state = 0;
            cirachannel.closing = 1;
            SendChannelClose(cirachannel.socket, cirachannel.amtchannelid);
            if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); }
        };

        socket.tag.channels[cirachannel.channelid] = cirachannel;
        return cirachannel;
    };

    function ChangeHostname(socket, host, systemid) {
        if (socket.tag.host === host) return; // Nothing to change
        socket.tag.host = host;

        // Change the device
        obj.db.Get(socket.tag.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length !== 1)) return;
            var node = nodes[0];

            // See if any changes need to be made
            if ((node.intelamt != null) && (node.intelamt.host == host) && (node.name != null) && (node.name != '') && (node.intelamt.state == 2)) return;

            // Get the mesh for this device
            obj.db.Get(node.meshid, function (err, meshes) {
                if ((meshes == null) || (meshes.length !== 1)) return;
                var mesh = meshes[0];

                // Ready the node change event
                var changes = ['host'], event = { etype: 'node', action: 'changenode', nodeid: node._id };
                event.msg = +": ";

                // Make the change & save
                if (node.intelamt == null) node.intelamt = {};
                node.intelamt.host = host;
                node.intelamt.state = 2; // Set the state to activated, since this is pretty obvious, we have a CIRA connection.
                if (((node.name == null) || (node.name == '')) && (host != null) && (host != '')) { node.name = host.split('.')[0]; } // If this system has no name, set it to the start of the domain name.
                if (((node.name == null) || (node.name == '')) && (systemid != null)) { node.name = systemid; } // If this system still has no name, set it to the system GUID.
                obj.db.Set(node);

                // Event the node change
                event.msg = 'CIRA changed device ' + node.name + ' from group ' + mesh.name + ': ' + changes.join(', ');
                var node2 = common.Clone(node);
                if (node2.intelamt && node2.intelamt.pass) delete node2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                event.node = node2;
                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                obj.parent.DispatchEvent(['*', node.meshid], obj, event);
            });
        });
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }

    // Debug
    function Debug(lvl) {
        if (lvl > obj.parent.debugLevel) return;
        if (arguments.length == 2) { console.log(arguments[1]); }
        else if (arguments.length == 3) { console.log(arguments[1], arguments[2]); }
        else if (arguments.length == 4) { console.log(arguments[1], arguments[2], arguments[3]); }
        else if (arguments.length == 5) { console.log(arguments[1], arguments[2], arguments[3], arguments[4]); }
        else if (arguments.length == 6) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]); }
        else if (arguments.length == 7) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]); }
    }

    return obj;
};
