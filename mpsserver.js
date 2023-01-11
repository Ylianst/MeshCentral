/**
* @description MeshCentral Intel(R) AMT MPS server
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
'use strict';

// Construct a Intel AMT MPS server object
module.exports.CreateMpsServer = function (parent, db, args, certificates) {
    var obj = {};
    obj.fs = require('fs');
    obj.path = require('path');
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = certificates;
    obj.ciraConnections = {};       // NodeID --> [ Socket ]
    var tlsSessionStore = {};       // Store TLS session information for quick resume.
    var tlsSessionStoreCount = 0;   // Number of cached TLS session information in store.
    const constants = (require('crypto').constants ? require('crypto').constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.
    const common = require('./common.js');
    const net = require('net');
    const tls = require('tls');
    const MAX_IDLE = 90000;         // 90 seconds max idle time, higher than the typical KEEP-ALIVE periode of 60 seconds
    const KEEPALIVE_INTERVAL = 30;  // 30 seconds is typical keepalive interval for AMT CIRA connection

    // This MPS server is also a tiny HTTPS server. HTTP responses are here.
    obj.httpResponses = {
        '/': '<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>MeshCentral MPS server.<br />Intel&reg; AMT computers should connect here.</body></html>'
        //'/text.ico': { file: 'c:\\temp\\test.iso', maxserve: 3, maxtime: Date.now() + 15000 }
    };

    // Set the MPS external port only if it's not set to zero and we are not in LAN mode.
    if ((args.lanonly != true) && (args.mpsport !== 0)) {
        if (obj.args.mpstlsoffload) {
            obj.server = net.createServer(onConnection);
        } else {
            if (obj.args.mpshighsecurity) {
                // Higher security TLS 1.2 and 1.3 only, some older Intel AMT CIRA connections will fail.
                obj.server = tls.createServer({ key: certificates.mps.key, cert: certificates.mps.cert, requestCert: true, rejectUnauthorized: false, ciphers: "HIGH:TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_CCM_SHA256:TLS_CHACHA20_POLY1305_SHA256", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 }, onConnection)
            } else {
                // Lower security MPS in order to support older Intel AMT CIRA connections, we have to turn on TLSv1.
                obj.server = tls.createServer({ key: certificates.mps.key, cert: certificates.mps.cert, minVersion: 'TLSv1', requestCert: true, rejectUnauthorized: false, ciphers: "HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION }, onConnection)
            }
            //obj.server.on('error', function () { console.log('MPS tls server error'); });
            obj.server.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
            obj.server.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
        }

        obj.server.listen(args.mpsport, args.mpsportbind, function () {
            console.log("MeshCentral Intel(R) AMT server running on " + certificates.AmtMpsName + ":" + args.mpsport + ((args.mpsaliasport != null) ? (", alias port " + args.mpsaliasport) : "") + ".");
            obj.parent.authLog('mps', 'Server listening on ' + ((args.mpsportbind != null) ? args.mpsportbind : '0.0.0.0') + ' port ' + args.mpsport + '.');
        }).on("error", function (err) { console.error("ERROR: MeshCentral Intel(R) AMT server port " + args.mpsport + " is not available. Check if the MeshCentral is already running."); if (args.exactports) { process.exit(); } });

        obj.server.on('tlsClientError', function (err, tlssocket) { if (args.mpsdebug) { var remoteAddress = tlssocket.remoteAddress; if (tlssocket.remoteFamily == 'IPv6') { remoteAddress = '[' + remoteAddress + ']'; } console.log('MPS:Invalid TLS connection from ' + remoteAddress + ':' + tlssocket.remotePort + '.'); } });
    }

    obj.parent.updateServerState('mps-port', args.mpsport);
    obj.parent.updateServerState('mps-name', certificates.AmtMpsName);
    if (args.mpsaliasport != null) { obj.parent.updateServerState('mps-alias-port', args.mpsaliasport); }

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
        KEEPALIVE_OPTIONS_REPLY: 211,
        JSON_CONTROL: 250 // This is a Mesh specific command that sends JSON to and from the MPS server.
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

    // Add a CIRA connection to the connection list
    function addCiraConnection(socket) {
        // Check if there is already a connection of the same type
        var sameType = false, connections = obj.ciraConnections[socket.tag.nodeid];
        if (connections != null) { for (var i in connections) { var conn = connections[i]; if (conn.tag.connType === socket.tag.connType) { sameType = true; } } }

        // Add this connection to the connections list
        if (connections == null) { obj.ciraConnections[socket.tag.nodeid] = [socket]; } else { obj.ciraConnections[socket.tag.nodeid].push(socket); }

        // Update connectivity state
        // Report the new state of a CIRA/Relay/LMS connection after a short delay. This is to wait for the connection to have the bounded ports setup before we advertise this new connection.
        socket.xxStartHold = 1;
        var f = function setConnFunc() {
            delete setConnFunc.socket.xxStartHold;
            const ciraArray = obj.ciraConnections[setConnFunc.socket.tag.nodeid];
            if ((ciraArray != null) && ((ciraArray.indexOf(setConnFunc.socket) >= 0))) { // Check if this connection is still present
                if (setConnFunc.socket.tag.connType == 0) {
                    // Intel AMT CIRA connection. This connection indicates the remote device is present.
                    obj.parent.SetConnectivityState(setConnFunc.socket.tag.meshid, setConnFunc.socket.tag.nodeid, setConnFunc.socket.tag.connectTime, 2, 7, null, { name: socket.tag.name }); // 7 = Present
                } else if (setConnFunc.socket.tag.connType == 1) {
                    // Intel AMT Relay connection. This connection does not give any information about the remote device's power state.
                    obj.parent.SetConnectivityState(setConnFunc.socket.tag.meshid, setConnFunc.socket.tag.nodeid, setConnFunc.socket.tag.connectTime, 8, 0, null, { name: socket.tag.name }); // 0 = Unknown
                }
                // Intel AMT LMS connection (connType == 2), we don't notify of these connections except telling the Intel AMT manager about them.
                // If the AMT manager is present, start management of this device
                if (obj.parent.amtManager != null) { obj.parent.amtManager.startAmtManagement(setConnFunc.socket.tag.nodeid, setConnFunc.socket.tag.connType, setConnFunc.socket); }
            }
        }
        f.socket = socket;
        setTimeout(f, 300);
    }

    // Remove a CIRA connection from the connection list
    function removeCiraConnection(socket) {
        // If the AMT manager is present, stop management of this device
        if (obj.parent.amtManager != null) { obj.parent.amtManager.stopAmtManagement(socket.tag.nodeid, socket.tag.connType, socket); }

        // Remove the connection from the list if present.
        const ciraArray = obj.ciraConnections[socket.tag.nodeid];
        if (ciraArray == null) return;
        var i = ciraArray.indexOf(socket);
        if (i == -1) return;
        ciraArray.splice(i, 1);
        if (ciraArray.length == 0) { delete obj.ciraConnections[socket.tag.nodeid]; } else { obj.ciraConnections[socket.tag.nodeid] = ciraArray; }

        // If we are removing a connection during the hold period, don't clear any state since it was never set.
        if (socket.xxStartHold == 1) return;

        // Check if there is already a connection of the same type
        var sameType = false, connections = obj.ciraConnections[socket.tag.nodeid];
        if (connections != null) { for (var i in connections) { var conn = connections[i]; if (conn.tag.connType === socket.tag.connType) { sameType = true; } } }
        if (sameType == true) return; // if there is a connection of the same type, don't change the connection state.

        // Update connectivity state
        if (socket.tag.connType == 0) {
            obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2, null, { name: socket.tag.name }); // CIRA
        } else if (socket.tag.connType == 1) {
            obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 8, null, { name: socket.tag.name }); // Relay
        }
    }

    // Return statistics about this MPS server
    obj.getStats = function () {
        var ciraConnectionCount = 0;
        for (var i in obj.ciraConnections) { ciraConnectionCount += obj.ciraConnections[i].length; }
        return {
            ciraConnections: ciraConnectionCount,
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
            maxDomainDevicesReached: maxDomainDevicesReached
        };
    }

    // Required for TLS piping to MQTT broker
    function SerialTunnel(options) {
        var obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        return obj;
    }

    // Return's the length of an MQTT packet
    function getMQTTPacketLength(chunk) {
        var packet_len = 0;
        if (chunk.readUInt8(0) == 16) {
            if (chunk.readUInt8(1) < 128) {
                packet_len += chunk.readUInt8(1) + 2;
            } else {
                // continuation bit, get real value and do next
                packet_len += (chunk.readUInt8(1) & 0x7F) + 2;
                if (chunk.readUInt8(2) < 128) {
                    packet_len += 1 + chunk.readUInt8(2) * 128;
                } else {
                    packet_len += 1 + (chunk.readUInt8(2) & 0x7F) * 128;
                    if (chunk.readUInt8(3) < 128) {
                        packet_len += 1 + chunk.readUInt8(3) * 128 * 128;
                    } else {
                        packet_len += 1 + (chunk.readUInt8(3) & 0x7F) * 128 * 128;
                        if (chunk.readUInt8(4) < 128) {
                            packet_len += 1 + chunk.readUInt8(4) * 128 * 128 * 128;
                        } else {
                            packet_len += 1 + (chunk.readUInt8(4) & 0x7F) * 128 * 128 * 128;
                        }
                    }
                }
            }
        }
        return packet_len;
    }

    obj.onWebSocketConnection = function (socket, req) {
        connectionCount++;
        // connType: 0 = CIRA, 1 = Relay, 2 = LMS
        socket.tag = { first: true, connType: 0, clientCert: null, accumulator: '', activetunnels: 0, boundPorts: [], websocket: true, socket: socket, host: null, nextchannelid: 4, channels: {}, nextsourceport: 0, meiState: {} };
        socket.SetupChannel = function SetupChannel(targetport) { return SetupChannel.parent.SetupChannel(SetupChannel.conn, targetport); }
        socket.SetupChannel.parent = obj;
        socket.SetupChannel.conn = socket;
        socket.websocket = 1;
        socket.ControlMsg = function ControlMsg(message) { return ControlMsg.parent.SendJsonControl(ControlMsg.conn, message); }
        socket.ControlMsg.parent = obj;
        socket.ControlMsg.conn = socket;
        socket.remoteAddr = req.clientIp;
        socket.remotePort = socket._socket.remotePort;
        socket._socket.bytesReadEx = 0;
        socket._socket.bytesWrittenEx = 0;
        parent.debug('mps', "New CIRA websocket connection");

        socket.on('message', function (data) {
            if (args.mpsdebug) { var buf = Buffer.from(data, 'binary'); console.log("MPS <-- (" + buf.length + "):" + buf.toString('hex')); } // Print out received bytes

            // Traffic accounting
            parent.webserver.trafficStats.LMSIn += (this._socket.bytesRead - this._socket.bytesReadEx);
            parent.webserver.trafficStats.LMSOut += (this._socket.bytesWritten - this._socket.bytesWrittenEx);
            this._socket.bytesReadEx = this._socket.bytesRead;
            this._socket.bytesWrittenEx = this._socket.bytesWritten;

            this.tag.accumulator += data.toString('binary'); // Append as binary string
            try {
                // Parse all of the APF data we can
                var l = 0;
                do { l = ProcessCommand(this); if (l > 0) { this.tag.accumulator = this.tag.accumulator.substring(l); } } while (l > 0);
                if (l < 0) { this.terminate(); }
            } catch (e) {
                console.log(e);
            }
        });

        socket.addListener('close', function () {
            // Traffic accounting
            parent.webserver.trafficStats.LMSIn += (this._socket.bytesRead - this._socket.bytesReadEx);
            parent.webserver.trafficStats.LMSOut += (this._socket.bytesWritten - this._socket.bytesWrittenEx);
            this._socket.bytesReadEx = this._socket.bytesRead;
            this._socket.bytesWrittenEx = this._socket.bytesWritten;

            socketClosedCount++;
            parent.debug('mps', "CIRA websocket closed", this.tag.meshid, this.tag.nodeid);
            removeCiraConnection(socket);
        });

        socket.addListener('error', function (e) {
            socketErrorCount++;
            parent.debug('mps', "CIRA websocket connection error", e);
        });
    }

    // Called when a new TLS/TCP connection is accepted
    function onConnection(socket) {
        connectionCount++;
        // connType: 0 = CIRA, 1 = Relay, 2 = LMS
        if (obj.args.mpstlsoffload) {
            socket.tag = { first: true, connType: 0, clientCert: null, accumulator: '', activetunnels: 0, boundPorts: [], socket: socket, host: null, nextchannelid: 4, channels: {}, nextsourceport: 0, meiState: {} };
        } else {
            socket.tag = { first: true, connType: 0, clientCert: socket.getPeerCertificate(true), accumulator: '', activetunnels: 0, boundPorts: [], socket: socket, host: null, nextchannelid: 4, channels: {}, nextsourceport: 0, meiState: {} };
        }
        socket.SetupChannel = function SetupChannel(targetport) { return SetupChannel.parent.SetupChannel(SetupChannel.conn, targetport); }
        socket.SetupChannel.parent = obj;
        socket.SetupChannel.conn = socket;
        socket.ControlMsg = function ControlMsg(message) { return ControlMsg.parent.SendJsonControl(ControlMsg.conn, message); }
        socket.ControlMsg.parent = obj;
        socket.ControlMsg.conn = socket;
        socket.bytesReadEx = 0;
        socket.bytesWrittenEx = 0;
        socket.remoteAddr = cleanRemoteAddr(socket.remoteAddress);
        //socket.remotePort is already present, no need to set it.
        socket.setEncoding('binary');
        parent.debug('mps', "New CIRA connection");

        // Setup the CIRA keep alive timer
        socket.setTimeout(MAX_IDLE);
        socket.on('timeout', () => { ciraTimeoutCount++; parent.debug('mps', "CIRA timeout, disconnecting."); obj.close(socket); });

        socket.addListener('close', function () {
            // Traffic accounting
            parent.webserver.trafficStats.CIRAIn += (this.bytesRead - this.bytesReadEx);
            parent.webserver.trafficStats.CIRAOut += (this.bytesWritten - this.bytesWrittenEx);
            this.bytesReadEx = this.bytesRead;
            this.bytesWrittenEx = this.bytesWritten;

            socketClosedCount++;
            parent.debug('mps', 'CIRA connection closed');
            removeCiraConnection(socket);
        });

        socket.addListener('error', function (e) {
            socketErrorCount++;
            parent.debug('mps', 'CIRA connection error', e);
            //console.log("MPS Error: " + socket.remoteAddress);
        });

        socket.addListener('data', function (data) {
            if (args.mpsdebug) { var buf = Buffer.from(data, 'binary'); console.log("MPS <-- (" + buf.length + "):" + buf.toString('hex')); } // Print out received bytes

            // Traffic accounting
            parent.webserver.trafficStats.CIRAIn += (this.bytesRead - this.bytesReadEx);
            parent.webserver.trafficStats.CIRAOut += (this.bytesWritten - this.bytesWrittenEx);
            this.bytesReadEx = this.bytesRead;
            this.bytesWrittenEx = this.bytesWritten;

            socket.tag.accumulator += data;

            // Detect if this is an HTTPS request, if it is, return a simple answer and disconnect. This is useful for debugging access to the MPS port.
            if (socket.tag.first == true) {
                if (socket.tag.accumulator.length < 5) return;
                //if (!socket.tag.clientCert.subject) { console.log("MPS Connection, no client cert: " + socket.remoteAddress); socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMeshCentral2 MPS server.\r\nNo client certificate given.'); obj.close(socket); return; }
                if ((socket.tag.accumulator.substring(0, 4) == 'GET ') || (socket.tag.accumulator.substring(0, 5) == 'HEAD ')) {
                    if (args.mpsdebug) { console.log("MPS Connection, HTTP request detected: " + socket.remoteAddress); }
                    socket.removeAllListeners('data');
                    socket.removeAllListeners('close');
                    socket.on('data', onHttpData);
                    socket.on('close', onHttpClose);
                    obj.httpSocket = socket;
                    onHttpData.call(socket, data);
                    return;
                }

                // If the MQTT broker is active, look for inbound MQTT connections
                if (parent.mqttbroker != null) {
                    var chunk = Buffer.from(socket.tag.accumulator, 'binary');
                    var packet_len = 0;
                    if (chunk.readUInt8(0) == 16) { packet_len = getMQTTPacketLength(chunk); }
                    if (chunk.readUInt8(0) == 16 && (socket.tag.accumulator.length < packet_len)) return; // Minimum MQTT detection

                    // check if it is MQTT, need more initial packet to probe
                    if (chunk.readUInt8(0) == 16 && ((chunk.slice(4, 8).toString() === 'MQTT') || (chunk.slice(5, 9).toString() === 'MQTT')
                        || (chunk.slice(6, 10).toString() === 'MQTT') || (chunk.slice(7, 11).toString() === 'MQTT'))) {
                        parent.debug('mps', "MQTT connection detected.");
                        socket.removeAllListeners('data');
                        socket.removeAllListeners('close');
                        socket.setNoDelay(true);
                        socket.serialtunnel = SerialTunnel();
                        socket.serialtunnel.xtransport = 'mps';
                        socket.serialtunnel.xip = socket.remoteAddress;
                        socket.on('data', function (b) { socket.serialtunnel.updateBuffer(Buffer.from(b, 'binary')) });
                        socket.serialtunnel.forwardwrite = function (b) { socket.write(b, 'binary') }
                        socket.on('close', function () { socket.serialtunnel.emit('end'); });

                        // Pass socket wrapper to the MQTT broker
                        parent.mqttbroker.handle(socket.serialtunnel);
                        socket.unshift(socket.tag.accumulator);
                        return;
                    }
                }

                socket.tag.first = false;

                // Setup this node with certificate authentication
                if (socket.tag.clientCert && socket.tag.clientCert.subject && socket.tag.clientCert.subject.O && socket.tag.clientCert.subject.O.length == 64) {
                    // This is a node where the MeshID is indicated within the CIRA certificate
                    var domainid = '', meshid;
                    var xx = socket.tag.clientCert.subject.O.split('/');
                    if (xx.length == 1) { meshid = xx[0]; } else { domainid = xx[0].toLowerCase(); meshid = xx[1]; }

                    // Check the incoming domain
                    var domain = obj.parent.config.domains[domainid];
                    if (domain == null) { console.log('CIRA connection for invalid domain. meshid: ' + meshid); obj.close(socket); return; }

                    socket.tag.domain = domain;
                    socket.tag.domainid = domainid;
                    socket.tag.meshid = 'mesh/' + domainid + '/' + meshid;
                    socket.tag.nodeid = 'node/' + domainid + '/' + require('crypto').createHash('sha384').update(common.hex2rstr(socket.tag.clientCert.modulus, 'binary')).digest('base64').replace(/\+/g, '@').replace(/\//g, '$');
                    socket.tag.name = socket.tag.clientCert.subject.CN;
                    socket.tag.connectTime = Date.now();
                    socket.tag.host = '';

                    // Fetch the node
                    obj.db.Get(socket.tag.nodeid, function (err, nodes) {
                        if ((nodes == null) || (nodes.length !== 1)) {
                            var mesh = obj.parent.webserver.meshes[socket.tag.meshid];
                            if (mesh == null) {
                                unknownTlsMeshIdCount++;
                                console.log('ERROR: Intel AMT CIRA connected with unknown groupid: ' + socket.tag.meshid);
                                obj.close(socket);
                                return;
                            } else if (mesh.mtype == 1) {
                                // Check if we already have too many devices for this domain
                                if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                                    db.isMaxType(domain.limits.maxdevices, 'node', domain.id, function (ismax, count) {
                                        if (ismax == true) {
                                            // Too many devices in this domain.
                                            maxDomainDevicesReached++;
                                            console.log('Too many devices on this domain to accept the CIRA connection. meshid: ' + socket.tag.meshid);
                                            obj.close(socket);
                                        } else {
                                            // Attempts reverse DNS loopup on the device IP address
                                            require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                                var hostname = socket.remoteAddr;
                                                if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                                // We are under the limit, create the new device.
                                                // Node is not in the database, add it. Credentials will be empty until added by the user.
                                                var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, icon: (socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: domainid, intelamt: { user: (typeof socket.tag.meiState.amtuser == 'string') ? socket.tag.meiState.amtuser : '', pass: (typeof socket.tag.meiState.amtpass == 'string') ? socket.tag.meiState.amtpass : '', tls: 0, state: 2 } };
                                                if (socket.tag.meiState != null) {
                                                    if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                                    if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                                }
                                                obj.db.Set(device);

                                                // Event the new node
                                                addedTlsDeviceCount++;
                                                var change = 'CIRA added device ' + socket.tag.name + ' to mesh ' + mesh.name;
                                                obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: domainid });

                                                // Add the connection to the MPS connection list
                                                addCiraConnection(socket);
                                            });
                                        }
                                    });
                                    return;
                                } else {
                                    // Attempts reverse DNS loopup on the device IP address
                                    require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                        var hostname = socket.remoteAddr;
                                        if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                        // Node is not in the database, add it. Credentials will be empty until added by the user.
                                        var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, icon: (socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: domainid, intelamt: { user: (typeof socket.tag.meiState.amtuser == 'string') ? socket.tag.meiState.amtuser : '', pass: (typeof socket.tag.meiState.amtpass == 'string') ? socket.tag.meiState.amtpass : '', tls: 0, state: 2 } };
                                        if (socket.tag.meiState != null) {
                                            if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                            if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                        }
                                        obj.db.Set(device);

                                        // Event the new node
                                        addedTlsDeviceCount++;
                                        var change = 'CIRA added device ' + socket.tag.name + ' to mesh ' + mesh.name;
                                        obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: domainid });
                                    });
                                }
                            } else {
                                // New CIRA connection for unknown node, disconnect.
                                unknownTlsNodeCount++;
                                console.log('CIRA connection for unknown node with incorrect group type. meshid: ' + socket.tag.meshid);
                                obj.close(socket);
                                return;
                            }
                        } else {
                            // Node is already present
                            var node = nodes[0];
                            socket.tag.meshid = node.meshid; // Correct the MeshID if the node has moved.
                            socket.tag.name = node.name;
                            if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                        }

                        // Add the connection to the MPS connection list
                        addCiraConnection(socket);
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
                if (l < 0) { obj.close(socket); }
            } catch (e) {
                console.log(e);
            }
        });
    }

    // Process one APF command
    function ProcessCommand(socket) {
        var cmd = socket.tag.accumulator.charCodeAt(0);
        var len = socket.tag.accumulator.length;
        var data = socket.tag.accumulator;
        if (len == 0) { return 0; }

        switch (cmd) {
            case APFProtocol.KEEPALIVE_REQUEST: {
                if (len < 5) return 0;
                parent.debug('mpscmd', '--> KEEPALIVE_REQUEST');
                SendKeepAliveReply(socket, common.ReadInt(data, 1));
                return 5;
            }
            case APFProtocol.KEEPALIVE_REPLY: {
                if (len < 5) return 0;
                parent.debug('mpscmd', '--> KEEPALIVE_REPLY');
                return 5;
            }
            case APFProtocol.KEEPALIVE_OPTIONS_REPLY: {
                if (len < 9) return 0;
                const keepaliveInterval = common.ReadInt(data, 1);
                const timeout = common.ReadInt(data, 5);
                parent.debug('mpscmd', '--> KEEPALIVE_OPTIONS_REPLY', keepaliveInterval, timeout);
                return 9;
            }
            case APFProtocol.PROTOCOLVERSION: {
                if (len < 93) return 0;
                protocolVersionCount++;
                socket.tag.MajorVersion = common.ReadInt(data, 1);
                socket.tag.MinorVersion = common.ReadInt(data, 5);
                socket.tag.SystemId = guidToStr(common.rstr2hex(data.substring(13, 29))).toLowerCase();
                parent.debug('mpscmd', '--> PROTOCOLVERSION', socket.tag.MajorVersion, socket.tag.MinorVersion, socket.tag.SystemId);
                return 93;
            }
            case APFProtocol.USERAUTH_REQUEST: {
                if (len < 13) return 0;
                userAuthRequestCount++;
                var usernameLen = common.ReadInt(data, 1);
                if ((usernameLen > 2048) || (len < (5 + usernameLen))) return -1;
                var username = data.substring(5, 5 + usernameLen);
                var serviceNameLen = common.ReadInt(data, 5 + usernameLen);
                if ((serviceNameLen > 2048) || (len < (9 + usernameLen + serviceNameLen))) return -1;
                var serviceName = data.substring(9 + usernameLen, 9 + usernameLen + serviceNameLen);
                var methodNameLen = common.ReadInt(data, 9 + usernameLen + serviceNameLen);
                if ((methodNameLen > 2048) || (len < (13 + usernameLen + serviceNameLen + methodNameLen))) return -1;
                var methodName = data.substring(13 + usernameLen + serviceNameLen, 13 + usernameLen + serviceNameLen + methodNameLen);
                var passwordLen = 0, password = null;
                if (methodName == 'password') {
                    passwordLen = common.ReadInt(data, 14 + usernameLen + serviceNameLen + methodNameLen);
                    if ((passwordLen > 2048) || (len < (18 + usernameLen + serviceNameLen + methodNameLen + passwordLen))) return -1;
                    password = data.substring(18 + usernameLen + serviceNameLen + methodNameLen, 18 + usernameLen + serviceNameLen + methodNameLen + passwordLen);
                }
                //console.log('MPS:USERAUTH_REQUEST user=' + username + ', service=' + serviceName + ', method=' + methodName + ', password=' + password);
                parent.debug('mpscmd', '--> USERAUTH_REQUEST user=' + username + ', service=' + serviceName + ', method=' + methodName + ', password=' + password);

                // If the login uses a cookie, check this now
                if ((username == '**MeshAgentApfTunnel**') && (password != null)) {
                    const cookie = parent.decodeCookie(password, parent.loginCookieEncryptionKey);
                    if ((cookie == null) || (cookie.a !== 'apf')) {
                        incorrectPasswordCount++;
                        socket.ControlMsg({ action: 'console', msg: 'Invalid login username/password' });
                        parent.debug('mps', 'Incorrect password', username, password);
                        SendUserAuthFail(socket);
                        return -1;
                    }
                    if (obj.parent.webserver.meshes[cookie.m] == null) {
                        meshNotFoundCount++;
                        socket.ControlMsg({ action: 'console', msg: 'Device group not found (1): ' + cookie.m });
                        parent.debug('mps', 'Device group not found (1): ' + cookie.m, username, password);
                        SendUserAuthFail(socket);
                        return -1;
                    }

                    // Setup the connection
                    socket.tag.nodeid = cookie.n;
                    socket.tag.meshid = cookie.m;
                    socket.tag.connectTime = Date.now();

                    // Add the connection to the MPS connection list
                    addCiraConnection(socket);
                    SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                    return 18 + usernameLen + serviceNameLen + methodNameLen + passwordLen;
                } else {
                    // Check the CIRA password
                    if ((args.mpspass != null) && (password != args.mpspass)) {
                        incorrectPasswordCount++;
                        socket.ControlMsg({ action: 'console', msg: 'Invalid login username/password' });
                        parent.debug('mps', 'Incorrect password', username, password);
                        SendUserAuthFail(socket);
                        return -1;
                    }

                    // Check the CIRA username, which should be the start of the MeshID.
                    if (usernameLen != 16) {
                        badUserNameLengthCount++;
                        socket.ControlMsg({ action: 'console', msg: 'Username length not 16' });
                        parent.debug('mps', 'Username length not 16', username, password);
                        SendUserAuthFail(socket);
                        return -1;
                    }
                    // Find the initial device group for this CIRA connection. Since Intel AMT does not allow @ or $ in the username, we escape these.
                    // For possible for CIRA-LMS connections to still send @ or $, so we need to escape both sides.
                    // The initial device group will tell us what device group type and domain this connection is for
                    var initialMesh = null;
                    const meshIdStart = ('/' + username).replace(/\@/g, 'X').replace(/\$/g, 'X');
                    if (obj.parent.webserver.meshes) {
                        for (var i in obj.parent.webserver.meshes) {
                            if (obj.parent.webserver.meshes[i]._id.replace(/\@/g, 'X').replace(/\$/g, 'X').indexOf(meshIdStart) > 0) {
                                initialMesh = obj.parent.webserver.meshes[i]; break;
                            }
                        }
                    }
                    if (initialMesh == null) {
                        meshNotFoundCount++;
                        socket.ControlMsg({ action: 'console', msg: 'Device group not found (2): ' + meshIdStart + ', u: ' + username + ', p: ' + password });
                        parent.debug('mps', 'Device group not found (2)', meshIdStart, username, password);
                        SendUserAuthFail(socket);
                        return -1;
                    }
                }

                // If this is a agent-less mesh, use the device guid 3 times as ID.
                if (initialMesh.mtype == 1) {
                    // Intel AMT GUID (socket.tag.SystemId) will be used as NodeID
                    const systemid = socket.tag.SystemId.split('-').join('');
                    const nodeid = Buffer.from(systemid + systemid + systemid, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                    const domain = obj.parent.config.domains[initialMesh.domain];
                    if (domain == null) return;
                    socket.tag.domain = domain;
                    socket.tag.domainid = initialMesh.domain;
                    if (socket.tag.name == null) { socket.tag.name = ''; }
                    socket.tag.nodeid = 'node/' + initialMesh.domain + '/' + nodeid; // Turn 16bit systemid guid into 48bit nodeid that is base64 encoded
                    socket.tag.connectTime = Date.now();

                    obj.db.Get(socket.tag.nodeid, function (err, nodes) {
                        if ((nodes == null) || (nodes.length !== 1)) {
                            // Check if we already have too many devices for this domain
                            if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                                db.isMaxType(domain.limits.maxdevices, 'node', initialMesh.domain, function (ismax, count) {
                                    if (ismax == true) {
                                        // Too many devices in this domain.
                                        maxDomainDevicesReached++;
                                        console.log('Too many devices on this domain to accept the CIRA connection. meshid: ' + socket.tag.meshid);
                                        obj.close(socket);
                                    } else {
                                        // Attempts reverse DNS loopup on the device IP address
                                        require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                            var hostname = socket.remoteAddr;
                                            if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                            // Set the device group
                                            socket.tag.meshid = initialMesh._id;

                                            // We are under the limit, create the new device.
                                            // Node is not in the database, add it. Credentials will be empty until added by the user.
                                            var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, icon: (socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: initialMesh.domain, intelamt: { user: (typeof socket.tag.meiState.amtuser == 'string') ? socket.tag.meiState.amtuser : '', pass: (typeof socket.tag.meiState.amtpass == 'string') ? socket.tag.meiState.amtpass : '', tls: 0, state: 2 } };
                                            if (socket.tag.meiState != null) {
                                                if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                                if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                            }
                                            obj.db.Set(device);

                                            // Event the new node
                                            addedDeviceCount++;
                                            var change = 'Added CIRA device ' + socket.tag.name + ' to group ' + initialMesh.name;
                                            obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: initialMesh.domain });

                                            // Add the connection to the MPS connection list
                                            addCiraConnection(socket);
                                            SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                                        });
                                    }
                                });
                                return;
                            } else {
                                // Attempts reverse DNS loopup on the device IP address
                                require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                    var hostname = socket.remoteAddr;
                                    if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                    // Set the device group
                                    socket.tag.meshid = initialMesh._id;

                                    // Node is not in the database, add it. Credentials will be empty until added by the user.
                                    var device = { type: 'node', mtype: 1, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: socket.tag.name, icon: (socket.tag.meiState && socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: initialMesh.domain, intelamt: { user: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtuser == 'string')) ? socket.tag.meiState.amtuser : '', pass: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtpass == 'string')) ? socket.tag.meiState.amtpass : '', tls: 0, state: 2 } };
                                    if (socket.tag.meiState != null) {
                                        if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                        if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                    }
                                    obj.db.Set(device);

                                    // Event the new node
                                    addedDeviceCount++;
                                    var change = 'Added CIRA device ' + socket.tag.name + ' to group ' + initialMesh.name;
                                    obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: initialMesh.domain });
                                });
                            }
                        } else {
                            // Node is already present
                            var node = nodes[0];
                            socket.tag.meshid = node.meshid;
                            socket.tag.name = node.name;
                            if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                        }

                        // Add the connection to the MPS connection list
                        addCiraConnection(socket);
                        SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                    });
                } else if (initialMesh.mtype == 2) { // If this is a agent mesh, search the mesh for this device UUID
                    // Intel AMT GUID (socket.tag.SystemId) will be used to search the node
                    obj.db.getAmtUuidMeshNode(initialMesh.domain, initialMesh.mtype, socket.tag.SystemId, function (err, nodes) { // TODO: Need to optimize this request with indexes
                        if ((nodes == null) || (nodes.length === 0) || (obj.parent.webserver.meshes == null)) {
                            // New CIRA connection for unknown node, create a new device.
                            unknownNodeCount++;
                            console.log('CIRA connection for unknown node. groupid: ' + initialMesh._id + ', uuid: ' + socket.tag.SystemId);
                            //obj.close(socket);
                            //return;
                            var domain = obj.parent.config.domains[initialMesh.domain];
                            if (domain == null) return;

                            // Check if we already have too many devices for this domain
                            if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                                db.isMaxType(domain.limits.maxdevices, 'node', initialMesh.domain, function (ismax, count) {
                                    if (ismax == true) {
                                        // Too many devices in this domain.
                                        maxDomainDevicesReached++;
                                        console.log('Too many devices on this domain to accept the CIRA connection. meshid: ' + socket.tag.meshid);
                                        obj.close(socket);
                                    } else {
                                        // Attempts reverse DNS loopup on the device IP address
                                        require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                            var hostname = socket.remoteAddr;
                                            if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                            // Set the device group
                                            socket.tag.meshid = initialMesh._id;

                                            const systemid = socket.tag.SystemId.split('-').join('');
                                            const nodeid = Buffer.from(systemid + systemid + systemid, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                                            socket.tag.domain = domain;
                                            socket.tag.domainid = initialMesh.domain;
                                            socket.tag.name = hostname;
                                            socket.tag.nodeid = 'node/' + initialMesh.domain + '/' + nodeid; // Turn 16bit systemid guid into 48bit nodeid that is base64 encoded
                                            socket.tag.connectTime = Date.now();

                                            // Node is not in the database, add it. Credentials will be empty until added by the user.
                                            var device = { type: 'node', mtype: 2, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: hostname, icon: (socket.tag.meiState && socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: initialMesh.domain, intelamt: { user: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtuser == 'string')) ? socket.tag.meiState.amtuser : '', pass: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtpass == 'string')) ? socket.tag.meiState.amtpass : '', tls: 0, state: 2, agent: { id: 0, caps: 0 } } };
                                            if (socket.tag.meiState != null) {
                                                if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                                if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                            }
                                            obj.db.Set(device);

                                            // Event the new node
                                            addedDeviceCount++;
                                            var change = 'Added CIRA device ' + socket.tag.name + ' to group ' + initialMesh.name;
                                            obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: initialMesh.domain });

                                            // Add the connection to the MPS connection list
                                            addCiraConnection(socket);
                                            SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                                        });
                                    }
                                });
                                return;
                            } else {
                                // Attempts reverse DNS loopup on the device IP address
                                require('dns').reverse(socket.remoteAddr, function (err, hostnames) {
                                    var hostname = socket.remoteAddr;
                                    if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }

                                    // Set the device group
                                    socket.tag.meshid = initialMesh._id;

                                    const systemid = socket.tag.SystemId.split('-').join('');
                                    const nodeid = Buffer.from(systemid + systemid + systemid, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                                    socket.tag.domain = domain;
                                    socket.tag.domainid = initialMesh.domain;
                                    socket.tag.name = hostname;
                                    socket.tag.nodeid = 'node/' + initialMesh.domain + '/' + nodeid; // Turn 16bit systemid guid into 48bit nodeid that is base64 encoded
                                    socket.tag.connectTime = Date.now();

                                    // Node is not in the database, add it. Credentials will be empty until added by the user.
                                    var device = { type: 'node', mtype: 2, _id: socket.tag.nodeid, meshid: socket.tag.meshid, name: hostname, icon: (socket.tag.meiState && socket.tag.meiState.isBatteryPowered) ? 2 : 1, host: hostname, domain: initialMesh.domain, agent: { ver: 0, id: 0, caps: 0 }, intelamt: { uuid: socket.tag.SystemId, user: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtuser == 'string')) ? socket.tag.meiState.amtuser : '', pass: ((socket.tag.meiState) && (typeof socket.tag.meiState.amtpass == 'string')) ? socket.tag.meiState.amtpass : '', tls: 0, state: 2 } };
                                    if (socket.tag.meiState != null) {
                                        if ((typeof socket.tag.meiState.desc == 'string') && (socket.tag.meiState.desc.length > 0) && (socket.tag.meiState.desc.length < 1024)) { device.desc = socket.tag.meiState.desc; }
                                        if ((typeof socket.tag.meiState.Versions == 'object') && (typeof socket.tag.meiState.Versions.Sku == 'string')) { device.intelamt.sku = parseInt(socket.tag.meiState.Versions.Sku); }
                                    }
                                    obj.db.Set(device);

                                    // Event the new node
                                    addedDeviceCount++;
                                    var change = 'Added CIRA device ' + socket.tag.name + ' to group ' + initialMesh.name;
                                    obj.parent.DispatchEvent(['*', socket.tag.meshid], obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msg: change, domain: initialMesh.domain });

                                    // Add the connection to the MPS connection list
                                    addCiraConnection(socket);
                                    SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                                });
                            }
                            return;
                        }

                        // Looking at nodes that match this UUID, select one in the same domain and mesh type.
                        var node = null;
                        for (var i in nodes) {
                            if (initialMesh.domain == nodes[i].domain) {
                                var nodemesh = obj.parent.webserver.meshes[nodes[i].meshid];
                                if ((nodemesh != null) && (nodemesh.mtype == 2)) { node = nodes[i]; }
                            }
                        }

                        if (node == null) {
                            // New CIRA connection for unknown node, disconnect.
                            unknownNodeCount++;
                            console.log('CIRA connection for unknown node. candidate(s): ' + nodes.length + ', groupid: ' + initialMesh._id + ', uuid: ' + socket.tag.SystemId);
                            obj.close(socket);
                            return;
                        }

                        // Node is present
                        if ((node.intelamt != null) && (node.intelamt.state == 2)) { socket.tag.host = node.intelamt.host; }
                        socket.tag.nodeid = node._id;
                        socket.tag.meshid = node.meshid;
                        socket.tag.connectTime = Date.now();

                        // Add the connection to the MPS connection list
                        addCiraConnection(socket);
                        SendUserAuthSuccess(socket); // Notify the auth success on the CIRA connection
                    });
                } else { // Unknown mesh type
                    // New CIRA connection for unknown node, disconnect.
                    unknownMeshIdCount++;
                    console.log('CIRA connection to a unknown group type. groupid: ' + socket.tag.meshid);
                    obj.close(socket);
                    return;
                }
                return 18 + usernameLen + serviceNameLen + methodNameLen + passwordLen;
            }
            case APFProtocol.SERVICE_REQUEST: {
                if (len < 5) return 0;
                var xserviceNameLen = common.ReadInt(data, 1);
                if (xserviceNameLen > 2048) return -1;
                if (len < 5 + xserviceNameLen) return 0;
                var xserviceName = data.substring(5, 5 + xserviceNameLen);
                parent.debug('mpscmd', '--> SERVICE_REQUEST', xserviceName);
                if (xserviceName == "pfwd@amt.intel.com") { SendServiceAccept(socket, "pfwd@amt.intel.com"); }
                if (xserviceName == "auth@amt.intel.com") { SendServiceAccept(socket, "auth@amt.intel.com"); }
                return 5 + xserviceNameLen;
            }
            case APFProtocol.GLOBAL_REQUEST: {
                if (len < 14) return 0;
                var requestLen = common.ReadInt(data, 1);
                if (requestLen > 2048) return -1;
                if (len < 14 + requestLen) return 0;
                var request = data.substring(5, 5 + requestLen);
                //var wantResponse = data.charCodeAt(5 + requestLen);

                if (request == 'tcpip-forward') {
                    var addrLen = common.ReadInt(data, 6 + requestLen);
                    if (len < 14 + requestLen + addrLen) return 0;
                    var addr = data.substring(10 + requestLen, 10 + requestLen + addrLen);
                    var port = common.ReadInt(data, 10 + requestLen + addrLen);
                    parent.debug('mpscmd', '--> GLOBAL_REQUEST', request, addr + ':' + port);
                    if (socket.tag.boundPorts.indexOf(port) == -1) { socket.tag.boundPorts.push(port); }
                    SendTcpForwardSuccessReply(socket, port);
                    //5900 port is the last TCP port on which connections for forwarding are to be cancelled. Ports order: 16993, 16992, 664, 623, 16995, 16994, 5900
                    //Request keepalive interval time
                    if (port === 5900) { SendKeepaliveOptionsRequest(socket, KEEPALIVE_INTERVAL, 0); }
                    return 14 + requestLen + addrLen;
                }

                if (request == 'cancel-tcpip-forward') {
                    var addrLen = common.ReadInt(data, 6 + requestLen);
                    if (len < 14 + requestLen + addrLen) return 0;
                    var addr = data.substring(10 + requestLen, 10 + requestLen + addrLen);
                    var port = common.ReadInt(data, 10 + requestLen + addrLen);
                    parent.debug('mpscmd', '--> GLOBAL_REQUEST', request, addr + ':' + port);
                    var portindex = socket.tag.boundPorts.indexOf(port);
                    if (portindex >= 0) { socket.tag.boundPorts.splice(portindex, 1); }
                    SendTcpForwardCancelReply(socket);
                    return 14 + requestLen + addrLen;
                }

                if (request == 'udp-send-to@amt.intel.com') {
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
                    parent.debug('mpscmd', '--> GLOBAL_REQUEST', request, addr + ':' + port, oaddr + ':' + oport, datalen);
                    // TODO
                    return 26 + requestLen + addrLen + oaddrLen + datalen;
                }

                return 6 + requestLen;
            }
            case APFProtocol.CHANNEL_OPEN: {
                if (len < 33) return 0;
                var ChannelTypeLength = common.ReadInt(data, 1);
                if (ChannelTypeLength > 2048) return -1;
                if (len < (33 + ChannelTypeLength)) return 0;

                // Decode channel identifiers and window size
                var ChannelType = data.substring(5, 5 + ChannelTypeLength);
                var SenderChannel = common.ReadInt(data, 5 + ChannelTypeLength);
                var WindowSize = common.ReadInt(data, 9 + ChannelTypeLength);

                // Decode the target
                var TargetLen = common.ReadInt(data, 17 + ChannelTypeLength);
                if (TargetLen > 2048) return -1;
                if (len < (33 + ChannelTypeLength + TargetLen)) return 0;
                var Target = data.substring(21 + ChannelTypeLength, 21 + ChannelTypeLength + TargetLen);
                var TargetPort = common.ReadInt(data, 21 + ChannelTypeLength + TargetLen);

                // Decode the source
                var SourceLen = common.ReadInt(data, 25 + ChannelTypeLength + TargetLen);
                if (SourceLen > 2048) return -1;
                if (len < (33 + ChannelTypeLength + TargetLen + SourceLen)) return 0;
                var Source = data.substring(29 + ChannelTypeLength + TargetLen, 29 + ChannelTypeLength + TargetLen + SourceLen);
                var SourcePort = common.ReadInt(data, 29 + ChannelTypeLength + TargetLen + SourceLen);

                channelOpenCount++;
                parent.debug('mpscmd', '--> CHANNEL_OPEN', ChannelType, SenderChannel, WindowSize, Target + ':' + TargetPort, Source + ':' + SourcePort);

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
                    parent.debug('mpscmd', '--> CHANNEL_OPEN_CONFIRMATION', RecipientChannel, SenderChannel, WindowSize);
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
                                SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer.slice(0, cirachannel.sendcredits));
                                cirachannel.sendBuffer = cirachannel.sendBuffer.slice(cirachannel.sendcredits);
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
                    parent.debug('mpscmd', '--> CHANNEL_OPEN_FAILURE', RecipientChannel, ReasonCode);
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
                    parent.debug('mpscmd', '--> CHANNEL_CLOSE', RecipientChannel);
                    var cirachannel = socket.tag.channels[RecipientChannel];
                    if (cirachannel == null) { console.log("MPS Error in CHANNEL_CLOSE: Unable to find channelid " + RecipientChannel); return 5; }
                    socket.tag.activetunnels--;
                    if (cirachannel.state > 0) {
                        cirachannel.state = 0;
                        if (cirachannel.onStateChange) { cirachannel.onStateChange(cirachannel, cirachannel.state); }
                        SendChannelClose(cirachannel.socket, cirachannel.amtchannelid);
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
                    parent.debug('mpscmd', '--> CHANNEL_WINDOW_ADJUST', RecipientChannel, ByteToAdd, cirachannel.sendcredits);
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
                            SendChannelData(cirachannel.socket, cirachannel.amtchannelid, cirachannel.sendBuffer.slice(0, cirachannel.sendcredits));
                            cirachannel.sendBuffer = cirachannel.sendBuffer.slice(cirachannel.sendcredits);
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
                    if (SourceLen > 1048576) return -1;
                    if (len < (9 + LengthOfData)) return 0;
                    parent.debug('mpscmddata', '--> CHANNEL_DATA', RecipientChannel, LengthOfData);
                    var cirachannel = socket.tag.channels[RecipientChannel];
                    if (cirachannel == null) { console.log("MPS Error in CHANNEL_DATA: Unable to find channelid " + RecipientChannel); return 9 + LengthOfData; }
                    if (cirachannel.state > 0) {
                        cirachannel.amtpendingcredits += LengthOfData;
                        if (cirachannel.onData) { cirachannel.onData(cirachannel, Buffer.from(data.substring(9, 9 + LengthOfData), 'binary')); }
                        if (cirachannel.amtpendingcredits > (cirachannel.ciraWindow / 2)) {
                            SendChannelWindowAdjust(cirachannel.socket, cirachannel.amtchannelid, cirachannel.amtpendingcredits); // Adjust the buffer window
                            cirachannel.amtpendingcredits = 0;
                        }
                    }
                    return 9 + LengthOfData;
                }
            case APFProtocol.DISCONNECT:
                {
                    if (len < 7) return 0;
                    var ReasonCode = common.ReadInt(data, 1);
                    disconnectCommandCount++;
                    parent.debug('mpscmd', '--> DISCONNECT', ReasonCode);
                    removeCiraConnection(socket);
                    return 7;
                }
            case APFProtocol.JSON_CONTROL: // This is a Mesh specific command that sends JSON to and from the MPS server.
                {
                    if (len < 5) return 0;
                    var jsondatalen = common.ReadInt(data, 1);
                    if (jsondatalen > 1048576) return -1;
                    if (len < (5 + jsondatalen)) return 0;
                    var jsondata = null, jsondatastr = data.substring(5, 5 + jsondatalen);
                    try { jsondata = JSON.parse(jsondatastr); } catch (ex) { }
                    if ((jsondata == null) || (typeof jsondata.action != 'string')) return;
                    parent.debug('mpscmd', '--> JSON_CONTROL', jsondata.action);
                    switch (jsondata.action) {
                        case 'connType':
                            if ((socket.tag.connType != 0) || (socket.tag.SystemId != null)) return; // Once set, the connection type can't be changed.
                            if (typeof jsondata.value != 'number') return;
                            socket.tag.connType = jsondata.value; // 0 = CIRA, 1 = Relay, 2 = LMS
                            //obj.SendJsonControl(socket, { action: 'mestate' }); // Request an MEI state refresh
                            break;
                        case 'meiState':
                            if (socket.tag.connType != 2) break; // Only accept MEI state on CIRA-LMS connection
                            socket.tag.meiState = jsondata.value;
                            if (((socket.tag.name == '') || (socket.tag.name == null)) && (typeof jsondata.value.OsHostname == 'string')) { socket.tag.name = jsondata.value.OsHostname; }
                            if (obj.parent.amtManager != null) { obj.parent.amtManager.mpsControlMessage(socket.tag.nodeid, socket, socket.tag.connType, jsondata); }
                            break;
                        case 'deactivate':
                        case 'startTlsHostConfig':
                        case 'stopConfiguration':
                            if (socket.tag.connType != 2) break; // Only accept MEI state on CIRA-LMS connection
                            if (obj.parent.amtManager != null) { obj.parent.amtManager.mpsControlMessage(socket.tag.nodeid, socket, socket.tag.connType, jsondata); }
                            break;
                    }
                    return 5 + jsondatalen;
                }
            default:
                {
                    parent.debug('mpscmd', '--> Unknown CIRA command: ' + cmd);
                    return -1;
                }
        }
    }

    // Disconnect CIRA tunnel
    obj.close = function (socket) {
        try { socket.end(); } catch (e) { try { socket.close(); } catch (e) { } }
        removeCiraConnection(socket);
    };

    // Disconnect all CIRA tunnel for a given NodeId
    obj.closeAllForNode = function (nodeid) {
        var connections = obj.ciraConnections[nodeid];
        if (connections == null) return;
        for (var i in connections) { obj.close(connections[i]); }
    };

    obj.SendJsonControl = function (socket, data) {
        if (socket.tag.connType == 0) return; // This command is valid only for connections that are not really CIRA.
        if (typeof data == 'object') { parent.debug('mpscmd', '<-- JSON_CONTROL', data.action); data = JSON.stringify(data); } else { parent.debug('mpscmd', '<-- JSON_CONTROL'); }
        Write(socket, String.fromCharCode(APFProtocol.JSON_CONTROL) + common.IntToStr(data.length) + data);
    }

    function SendServiceAccept(socket, service) {
        parent.debug('mpscmd', '<-- SERVICE_ACCEPT', service);
        Write(socket, String.fromCharCode(APFProtocol.SERVICE_ACCEPT) + common.IntToStr(service.length) + service);
    }

    function SendTcpForwardSuccessReply(socket, port) {
        parent.debug('mpscmd', '<-- REQUEST_SUCCESS', port);
        Write(socket, String.fromCharCode(APFProtocol.REQUEST_SUCCESS) + common.IntToStr(port));
    }

    function SendTcpForwardCancelReply(socket) {
        parent.debug('mpscmd', '<-- REQUEST_SUCCESS');
        Write(socket, String.fromCharCode(APFProtocol.REQUEST_SUCCESS));
    }

    /*
    function SendKeepAliveRequest(socket, cookie) {
        parent.debug('mpscmd', '<-- KEEPALIVE_REQUEST', cookie);
        Write(socket, String.fromCharCode(APFProtocol.KEEPALIVE_REQUEST) + common.IntToStr(cookie));
    }
    */

    function SendKeepAliveReply(socket, cookie) {
        parent.debug('mpscmd', '<-- KEEPALIVE_REPLY', cookie);
        Write(socket, String.fromCharCode(APFProtocol.KEEPALIVE_REPLY) + common.IntToStr(cookie));
    }

    function SendKeepaliveOptionsRequest(socket, keepaliveTime, timeout) {
        parent.debug('mpscmd', '<-- KEEPALIVE_OPTIONS_REQUEST', keepaliveTime, timeout);
        Write(socket, String.fromCharCode(APFProtocol.KEEPALIVE_OPTIONS_REQUEST) + common.IntToStr(keepaliveTime) + common.IntToStr(timeout));
    }

    function SendChannelOpenFailure(socket, senderChannel, reasonCode) {
        parent.debug('mpscmd', '<-- CHANNEL_OPEN_FAILURE', senderChannel, reasonCode);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN_FAILURE) + common.IntToStr(senderChannel) + common.IntToStr(reasonCode) + common.IntToStr(0) + common.IntToStr(0));
    }

    /*
    function SendChannelOpenConfirmation(socket, recipientChannelId, senderChannelId, initialWindowSize) {
        parent.debug('mpscmd', '<-- CHANNEL_OPEN_CONFIRMATION', recipientChannelId, senderChannelId, initialWindowSize);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN_CONFIRMATION) + common.IntToStr(recipientChannelId) + common.IntToStr(senderChannelId) + common.IntToStr(initialWindowSize) + common.IntToStr(-1));
    }
    */

    function SendChannelOpen(socket, direct, channelid, windowsize, target, targetport, source, sourceport) {
        var connectionType = ((direct == true) ? 'direct-tcpip' : 'forwarded-tcpip');
        if ((target == null) || (target == null)) target = ''; // TODO: Reports of target being undefined that causes target.length to fail. This is a hack.
        parent.debug('mpscmd', '<-- CHANNEL_OPEN', connectionType, channelid, windowsize, target + ':' + targetport, source + ':' + sourceport);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_OPEN) + common.IntToStr(connectionType.length) + connectionType + common.IntToStr(channelid) + common.IntToStr(windowsize) + common.IntToStr(-1) + common.IntToStr(target.length) + target + common.IntToStr(targetport) + common.IntToStr(source.length) + source + common.IntToStr(sourceport));
    }

    function SendChannelClose(socket, channelid) {
        parent.debug('mpscmd', '<-- CHANNEL_CLOSE', channelid);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_CLOSE) + common.IntToStr(channelid));
    }

    // Send a buffer to a given channel
    function SendChannelData(socket, channelid, data) {
        parent.debug('mpscmddata', '<-- CHANNEL_DATA', channelid, data.length);
        const buf = Buffer.alloc(9 + data.length);
        buf[0] = APFProtocol.CHANNEL_DATA;  // CHANNEL_DATA
        buf.writeInt32BE(channelid, 1);     // ChannelID
        buf.writeInt32BE(data.length, 5);   // Data Length
        data.copy(buf, 9, 0);
        WriteBuffer(socket, buf);
    }

    function SendChannelWindowAdjust(socket, channelid, bytestoadd) {
        parent.debug('mpscmd', '<-- CHANNEL_WINDOW_ADJUST', channelid, bytestoadd);
        Write(socket, String.fromCharCode(APFProtocol.CHANNEL_WINDOW_ADJUST) + common.IntToStr(channelid) + common.IntToStr(bytestoadd));
    }

    /*
    function SendDisconnect(socket, reasonCode) {
        parent.debug('mpscmd', '<-- DISCONNECT', reasonCode);
        Write(socket, String.fromCharCode(APFProtocol.DISCONNECT) + common.IntToStr(reasonCode) + common.ShortToStr(0));
    }
    */

    function SendUserAuthFail(socket) {
        parent.debug('mpscmd', '<-- USERAUTH_FAILURE');
        Write(socket, String.fromCharCode(APFProtocol.USERAUTH_FAILURE) + common.IntToStr(8) + 'password' + common.ShortToStr(0));
    }

    function SendUserAuthSuccess(socket) {
        parent.debug('mpscmd', '<-- USERAUTH_SUCCESS');
        Write(socket, String.fromCharCode(APFProtocol.USERAUTH_SUCCESS));
    }

    // Send a string or buffer
    function Write(socket, data) {
        try {
            if (args.mpsdebug) {
                // Print out sent bytes
                var buf = Buffer.from(data, 'binary');
                console.log('MPS --> (' + buf.length + '):' + buf.toString('hex'));
                if (socket.websocket == 1) { socket.send(buf); } else { socket.write(buf); }
            } else {
                if (socket.websocket == 1) { socket.send(Buffer.from(data, 'binary')); } else { socket.write(Buffer.from(data, 'binary')); }
            }
        } catch (ex) { }
    }

    // Send a buffer
    function WriteBuffer(socket, data) {
        try {
            if (args.mpsdebug) { console.log('MPS --> (' + buf.length + '):' + data.toString('hex')); } // Print out sent bytes
            if (socket.websocket == 1) { socket.send(data); } else { socket.write(data); }
        } catch (ex) { }
    }

    // Returns a CIRA/Relay/LMS connection to a nodeid, use the best possible connection, CIRA first, Relay second, LMS third.
    // if oob is set to true, don't allow an LMS connection.
    obj.GetConnectionToNode = function (nodeid, targetport, oob) {
        var connectionArray = obj.ciraConnections[nodeid];
        if (connectionArray == null) return null;
        var selectConn = null;
        // Select the best connection, which is the one with the lowest connType value.
        for (var i in connectionArray) {
            var conn = connectionArray[i];
            if ((oob === true) && (conn.tag.connType == 2)) continue; // If an OOB connection is required, don't allow LMS connections.
            if ((typeof oob === 'number') && (conn.tag.connType !== oob)) continue; // if OOB specifies an exact connection type, filter on this type.
            if ((targetport != null) && (conn.tag.boundPorts.indexOf(targetport) == -1)) continue; // This connection does not route to the target port.
            if ((selectConn == null) || (conn.tag.connType < selectConn.tag.connType)) { selectConn = conn; }
        }
        return selectConn;
    }

    // Setup a new channel to a nodeid, use the best possible connection, CIRA first, Relay second, LMS third.
    // if oob is set to true, don't allow an LMS connection.
    obj.SetupChannelToNode = function (nodeid, targetport, oob) {
        var conn = obj.GetConnectionToNode(nodeid, targetport, oob);
        if (conn == null) return null;
        return obj.SetupChannel(conn, targetport);
    }

    // Setup a new channel
    obj.SetupChannel = function (socket, targetport) {
        var sourceport = (socket.tag.nextsourceport++ % 30000) + 1024;
        var cirachannel = { targetport: targetport, channelid: socket.tag.nextchannelid++, socket: socket, state: 1, sendcredits: 0, amtpendingcredits: 0, amtCiraWindow: 0, ciraWindow: 32768 };
        SendChannelOpen(socket, false, cirachannel.channelid, cirachannel.ciraWindow, socket.tag.host, targetport, '1.2.3.4', sourceport);

        // This function writes data to this CIRA channel
        cirachannel.write = function (data) {
            if (cirachannel.state == 0) return false;
            if (typeof data == 'string') { data = Buffer.from(data, 'binary'); } // Make sure we always handle buffers when sending data.
            if (cirachannel.state == 1 || cirachannel.sendcredits == 0 || cirachannel.sendBuffer != null) {
                // Channel is connected, but we are out of credits. Add the data to the outbound buffer.
                if (cirachannel.sendBuffer == null) { cirachannel.sendBuffer = data; } else { cirachannel.sendBuffer = Buffer.concat([cirachannel.sendBuffer, data]); }
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
            cirachannel.sendBuffer = data.slice(cirachannel.sendcredits);
            SendChannelData(cirachannel.socket, cirachannel.amtchannelid, data.slice(0, cirachannel.sendcredits));
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

    // Change a node to a new meshid, this is called when a node changes groups.
    obj.changeDeviceMesh = function (nodeid, newMeshId) {
        var connectionArray = obj.ciraConnections[nodeid];
        if (connectionArray == null) return;
        for (var i in connectionArray) {
            var socket = connectionArray[i];
            if ((socket != null) && (socket.tag != null)) { socket.tag.meshid = newMeshId; }
        }
    }

    // Called when handling incoming HTTP data
    function onHttpData(data) {
        if (this.xdata == null) { this.xdata = data; } else { this.xdata += data; }
        var headersize = this.xdata.indexOf('\r\n\r\n');
        if (headersize < 0) { if (this.xdata.length > 4096) { this.end(); } return; }
        var headers = this.xdata.substring(0, headersize).split('\r\n');
        if (headers.length < 1) { this.end(); return; }
        var headerObj = {};
        for (var i = 1; i < headers.length; i++) { var j = headers[i].indexOf(': '); if (i > 0) { headerObj[headers[i].substring(0, j).toLowerCase()] = headers[i].substring(j + 2); } }
        var hostHeader = (headerObj['host'] != null) ? ('Host: ' + headerObj['host'] + '\r\n') : '';
        var directives = headers[0].split(' ');
        if ((directives.length != 3) || ((directives[0] != 'GET') && (directives[0] != 'HEAD'))) { this.end(); return; }
        //console.log('WebServer, request', directives[0], directives[1]);
        var responseCode = 404, responseType = 'application/octet-stream', responseData = '', r = null;

        // Check if this is a cookie request
        if (directives[1].startsWith('/c/')) {
            var cookie = obj.parent.decodeCookie(directives[1].substring(3).split('.')[0], obj.parent.loginCookieEncryptionKey, 30); // 30 minute timeout
            if ((cookie != null) && (cookie.a == 'f') && (typeof cookie.f == 'string')) {
                // Send the file header and pipe the rest of the file
                var filestats = null;
                try { filestats = obj.fs.statSync(cookie.f); } catch (ex) { }
                if ((filestats == null) || (typeof filestats.size != 'number') || (filestats.size <= 0)) {
                    responseCode = 404; responseType = 'text/html'; responseData = 'File not found';
                } else {
                    this.write('HTTP/1.1 200 OK\r\n' + hostHeader + 'Content-Type: ' + responseType + '\r\nConnection: keep-alive\r\nCache-Control: no-cache\r\nContent-Length: ' + filestats.size + '\r\n\r\n');
                    if (directives[0] == 'GET') { obj.fs.createReadStream(cookie.f, { flags: 'r' }).pipe(this); }
                    delete this.xdata;
                    return;
                }
            }
        } else {
            // Check if we have a preset response
            if (obj.httpResponses != null) { r = obj.httpResponses[directives[1]]; }
            if ((r != null) && (r.maxtime != null) && (r.maxtime < Date.now())) { r = null; delete obj.httpResponses[directives[1]]; } // Check if this entry is expired.
            if (r != null) {
                if (typeof r == 'string') {
                    responseCode = 200; responseType = 'text/html'; responseData = r;
                } else if (typeof r == 'object') {
                    responseCode = 200;
                    if (r.type) { responseType = r.type; }
                    if (r.data) { responseData = r.data; }
                    if (r.shortfile) { try { responseData = obj.fs.readFileSync(r.shortfile); } catch (ex) { responseCode = 404; responseType = 'text/html'; responseData = 'File not found'; } }
                    if (r.file) {
                        // Send the file header and pipe the rest of the file
                        var filestats = null;
                        try { filestats = obj.fs.statSync(r.file); } catch (ex) { }
                        if ((filestats == null) || (typeof filestats.size != 'number') || (filestats.size <= 0)) {
                            responseCode = 404; responseType = 'text/html'; responseData = 'File not found';
                        } else {
                            this.write('HTTP/1.1 200 OK\r\n' + hostHeader + 'Content-Type: ' + responseType + '\r\nConnection: keep-alive\r\nCache-Control: no-cache\r\nContent-Length: ' + filestats.size + '\r\n\r\n');
                            if (directives[0] == 'GET') {
                                obj.fs.createReadStream(r.file, { flags: 'r' }).pipe(this);
                                if (typeof r.maxserve == 'number') { r.maxserve--; if (r.maxserve == 0) { delete obj.httpResponses[directives[1]]; } } // Check if this entry was server the maximum amount of times.
                            }
                            delete this.xdata;
                            return;
                        }
                    }
                }
            } else {
                responseType = 'text/html';
                responseData = 'Invalid request';
            }
        }
        this.write('HTTP/1.1 ' + responseCode + ' OK\r\n' + hostHeader + 'Connection: keep-alive\r\nCache-Control: no-cache\r\nContent-Type: ' + responseType + '\r\nContent-Length: ' + responseData.length + '\r\n\r\n');
        this.write(responseData);
        delete this.xdata;
    }

    // Called when handling HTTP data and the socket closes
    function onHttpClose() { }

    // Add a HTTP file response
    obj.addHttpFileResponse = function (path, file, maxserve, minutes) {
        var r = { file: file };
        if (typeof maxserve == 'number') { r.maxserve = maxserve; }
        if (typeof minutes == 'number') { r.maxtime = Date.now() + (60000 * minutes); }
        obj.httpResponses[path] = r;

        // Clean up any expired files
        const now = Date.now();
        for (var i in obj.httpResponses) { if ((obj.httpResponses[i].maxtime != null) && (obj.httpResponses[i].maxtime < now)) { delete obj.httpResponses[i]; } }
    }

    // Drop all CIRA connections
    obj.dropAllConnections = function () {
        var dropCount = 0;
        for (var nodeid in obj.ciraConnections) {
            const connections = obj.ciraConnections[nodeid];
            for (var i in connections) { if (connections[i].end) { connections[i].end(); dropCount++; } } // This will drop all TCP CIRA connections
        }
        return dropCount;
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (typeof addr != 'string') { return null; } if (addr.indexOf('::ffff:') == 0) { return addr.substring(7); } else { return addr; } }

    // Example, this will add a file to stream, served 2 times max and 3 minutes max.
    //obj.addHttpFileResponse('/a.png', 'c:\\temp\\MC2-LetsEncrypt.png', 2, 3);

    return obj;
};
