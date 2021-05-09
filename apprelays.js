/**
* @description MeshCentral MSTSC & SSH relay
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a MSTSC Relay object, called upon connection
// This is a bit of a hack as we are going to run the RDP connection thru a loopback connection.
// If the "node-rdpjs-2" module supported passing a socket, we would do something different.
module.exports.CreateMstscRelay = function (parent, db, ws, req, args, domain) {
    const Net = require('net');
    const WebSocket = require('ws');

    var obj = {};
    obj.ws = ws;
    obj.tcpServerPort = 0;
    obj.relayActive = false;
    var rdpClient = null;

    parent.parent.debug('relay', 'RDP: Request for RDP relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Collect how many raw bytes where received and sent.
        // We sum both the websocket and TCP client in this case.
        //var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
        //if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
        //console.log('WinRDP - in', inTraffc, 'out', outTraffc);

        if (obj.wsClient) { obj.wsClient.close(); delete obj.wsClient; }
        if (obj.tcpServer) { obj.tcpServer.close(); obj.tcpServer.destroy(); delete obj.tcpServer; }
        if (rdpClient) { rdpClient.close(); rdpClient = null; }
        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();
        obj.relayActive = false;
        delete obj.ws;
    };

    // Start the looppback server
    function startTcpServer() {
        obj.tcpServer = new Net.Server();
        obj.tcpServer.listen(0, '127.0.0.1', function () { obj.tcpServerPort = obj.tcpServer.address().port; startRdp(obj.tcpServerPort); });
        obj.tcpServer.on('connection', function (socket) {
            if (obj.relaySocket != null) {
                socket.close();
            } else {
                obj.relaySocket = socket;
                obj.relaySocket.pause();
                obj.relaySocket.on('data', function (chunk) { // Make sure to handle flow control.
                    if (obj.relayActive == true) { obj.relaySocket.pause(); obj.wsClient.send(chunk, function () { obj.relaySocket.resume(); }); }
                });
                obj.relaySocket.on('end', function () { obj.close(); });
                obj.relaySocket.on('error', function (err) { obj.close(); });

                // Decode the authentication cookie
                var cookie = parent.parent.decodeCookie(obj.infos.ip, parent.parent.loginCookieEncryptionKey);
                if (cookie == null) return;

                // Setup the correct URL with domain and use TLS only if needed.
                var options = { rejectUnauthorized: false };
                if (domain.dns != null) { options.servername = domain.dns; }
                var protocol = (args.tlsoffload) ? 'ws' : 'wss';
                var domainadd = '';
                if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
                var url = protocol + '://127.0.0.1:' + args.port + '/' + domainadd + ((cookie.lc == 1) ? 'local' : 'mesh') + 'relay.ashx?noping=1&p=10&auth=' + obj.infos.ip;  // Protocol 10 is Web-RDP
                parent.parent.debug('relay', 'RDP: Connection websocket to ' + url);
                obj.wsClient = new WebSocket(url, options);
                obj.wsClient.on('open', function () { parent.parent.debug('relay', 'RDP: Relay websocket open'); });
                obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                    if ((obj.relayActive == false) && (data == 'c')) {
                        obj.relayActive = true; obj.relaySocket.resume();
                    } else {
                        obj.wsClient._socket.pause();
                        obj.relaySocket.write(data, function () { obj.wsClient._socket.resume(); });
                    }
                });
                obj.wsClient.on('close', function () { parent.parent.debug('relay', 'RDP: Relay websocket closed'); obj.close(); });
                obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'RDP: Relay websocket error: ' + err); obj.close(); });
                obj.tcpServer.close();
                obj.tcpServer = null;
            }
        });
    }

    // Start the RDP client
    function startRdp(port) {
        parent.parent.debug('relay', 'RDP: Starting RDP client on loopback port ' + port);
        try {
            rdpClient = require('node-rdpjs-2').createClient({
                logLevel: 'ERROR',
                domain: obj.infos.domain,
                userName: obj.infos.username,
                password: obj.infos.password,
                enablePerf: true,
                autoLogin: true,
                screen: obj.infos.screen,
                locale: obj.infos.locale
            }).on('connect', function () {
                send(['rdp-connect']);
            }).on('bitmap', function (bitmap) {
                try { ws.send(bitmap.data); } catch (ex) { } // Send the bitmap data as binary
                delete bitmap.data;
                send(['rdp-bitmap', bitmap]); // Send the bitmap metadata seperately, without bitmap data.
            }).on('close', function () {
                send(['rdp-close']);
            }).on('error', function (err) {
                send(['rdp-error', err]);
            }).connect('127.0.0.1', obj.tcpServerPort);
        } catch (ex) {
            console.log('startRdpException', ex);
            obj.close();
        }
    }

    // When data is received from the web socket
    // RDP default port is 3389
    ws.on('message', function (msg) {
        try {
            msg = JSON.parse(msg);
            switch (msg[0]) {
                case 'infos': { obj.infos = msg[1]; startTcpServer(); break; }
                case 'mouse': { if (rdpClient) { rdpClient.sendPointerEvent(msg[1], msg[2], msg[3], msg[4]); } break; }
                case 'wheel': { if (rdpClient) { rdpClient.sendWheelEvent(msg[1], msg[2], msg[3], msg[4]); } break; }
                case 'scancode': { if (rdpClient) { rdpClient.sendKeyEventScancode(msg[1], msg[2]); } break; }
                case 'unicode': { if (rdpClient) { rdpClient.sendKeyEventUnicode(msg[1], msg[2]); } break; }
                case 'disconnect': { obj.close(); break; }
            }
        } catch (ex) {
            console.log('RdpMessageException', msg, ex);
            obj.close();
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'RDP: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'RDP: Browser websocket closed'); obj.close(); });

    // Send an object with flow control
    function send(obj) {
        try { rdpClient.bufferLayer.socket.pause(); } catch (ex) { }
        try { ws.send(JSON.stringify(obj), function () { try { rdpClient.bufferLayer.socket.resume(); } catch (ex) { } }); } catch (ex) { }
    }

    // We are all set, start receiving data
    ws._socket.resume();

    return obj;
};



// Construct a SSH Relay object, called upon connection
module.exports.CreateSshRelay = function (parent, db, ws, req, args, domain) {
    const Net = require('net');
    const WebSocket = require('ws');

    // SerialTunnel object is used to embed SSH within another connection.
    function SerialTunnel(options) {
        var obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        obj.destroy = function () { delete obj.forwardwrite; }
        return obj;
    }

    const obj = {};
    obj.ws = ws;
    obj.relayActive = false;

    parent.parent.debug('relay', 'SSH: Request for SSH relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Collect how many raw bytes where received and sent.
        // We sum both the websocket and TCP client in this case.
        //var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
        //if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
        //console.log('WinSSH - in', inTraffc, 'out', outTraffc);

        if (obj.sshShell) {
            obj.sshShell.destroy();
            obj.sshShell.removeAllListeners('data');
            obj.sshShell.removeAllListeners('close');
            try { obj.sshShell.end(); } catch (ex) { console.log(ex); }
            delete obj.sshShell;
        }
        if (obj.sshClient) {
            obj.sshClient.destroy();
            obj.sshClient.removeAllListeners('ready');
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); }
            delete obj.sshClient;
        }
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();

        obj.relayActive = false;
        delete obj.termSize;
        delete obj.cookie;
        delete obj.ws;
    };

    // Decode the authentication cookie
    obj.cookie = parent.parent.decodeCookie(req.query.auth, parent.parent.loginCookieEncryptionKey);
    if (obj.cookie == null) { obj.ws.send(JSON.stringify({ action: 'sessionerror' })); obj.close(); return; }
    console.log(obj.cookie);

    // Start the looppback server
    function startRelayConnection() {
        try {
            // Setup the correct URL with domain and use TLS only if needed.
            var options = { rejectUnauthorized: false };
            if (domain.dns != null) { options.servername = domain.dns; }
            var protocol = 'wss';
            if (args.tlsoffload) { protocol = 'ws'; }
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            var url = protocol + '://127.0.0.1:' + args.port + '/' + domainadd + ((obj.cookie.lc == 1) ? 'local' : 'mesh') + 'relay.ashx?noping=1&p=11&auth=' + req.query.auth; // Protocol 11 is Web-SSH
            parent.parent.debug('relay', 'SSH: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.debug('relay', 'SSH: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if ((obj.relayActive == false) && (data == 'c')) {
                    obj.relayActive = true;

                    // Create a serial tunnel && SSH module
                    obj.ser = new SerialTunnel();
                    const Client = require('ssh2').Client;
                    obj.sshClient = new Client();
                    obj.sshClient.on('ready', function () { // Authentication was successful.
                        obj.sshClient.shell(function (err, stream) { // Start a remote shell
                            if (err) { obj.close(); return; }
                            obj.sshShell = stream;
                            obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width);
                            obj.sshShell.on('close', function () { obj.close(); });
                            obj.sshShell.on('data', function (data) { obj.ws.send('~' + data.toString()); });
                        });
                        obj.ws.send(JSON.stringify({ action: 'connected' }));
                    });
                    obj.sshClient.on('error', function (err) {
                        if (err.level == 'client-authentication') { obj.ws.send(JSON.stringify({ action: 'autherror' })); }
                        obj.close();
                    });

                    // Setup the serial tunnel, SSH ---> Relay WS
                    obj.ser.forwardwrite = function (data) { if ((data.length > 0) && (obj.wsClient != null)) { try { obj.wsClient.send(data); } catch (ex) { } } };

                    // Connect the SSH module to the serial tunnel
                    var connectionOptions = { sock: obj.ser }
                    if (typeof obj.username == 'string') { connectionOptions.username = obj.username; delete obj.username; }
                    if (typeof obj.password == 'string') { connectionOptions.password = obj.password; delete obj.password; }
                    obj.sshClient.connect(connectionOptions);

                    // We are all set, start receiving data
                    ws._socket.resume();
                } else {
                    // Relay WS --> SSH
                    if ((data.length > 0) && (obj.ser != null)) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
                }
            });
            obj.wsClient.on('close', function () { parent.parent.debug('relay', 'SSH: Relay websocket closed'); obj.close(); });
            obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'SSH: Relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    // When data is received from the web socket
    // SSH default port is 22
    ws.on('message', function (msg) {
        try {
            if (typeof msg != 'string') return;
            if (msg[0] == '{') {
                // Control data
                msg = JSON.parse(msg);
                if (typeof msg.action != 'string') return;
                switch (msg.action) {
                    case 'connect': {
                        // Verify inputs
                        if ((typeof msg.username != 'string') || (typeof msg.password != 'string')) break;
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        obj.username = msg.username;
                        obj.password = msg.password;
                        startRelayConnection();
                        break;
                    }
                    case 'resize': {
                        // Verify inputs
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        if (obj.sshShell != null) { obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width); }
                        break;
                    }
                }
            } else if (msg[0] == '~') {
                // Terminal data
                if (obj.sshShell != null) { obj.sshShell.write(msg.substring(1)); }
            }
        } catch (ex) { obj.close(); }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });
    
    return obj;
};


// Construct a SSH Terminal Relay object, called upon connection
module.exports.CreateSshTerminalRelay = function (parent, db, ws, req, domain, user, cookie, args) {
    const Net = require('net');
    const WebSocket = require('ws');

    // SerialTunnel object is used to embed SSH within another connection.
    function SerialTunnel(options) {
        var obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        obj.destroy = function () { delete obj.forwardwrite; }
        return obj;
    }

    const obj = {};
    obj.ws = ws;
    obj.relayActive = false;

    parent.parent.debug('relay', 'SSH: Request for SSH relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Collect how many raw bytes where received and sent.
        // We sum both the websocket and TCP client in this case.
        //var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
        //if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
        //console.log('WinSSH - in', inTraffc, 'out', outTraffc);

        if (obj.sshShell) {
            obj.sshShell.destroy();
            obj.sshShell.removeAllListeners('data');
            obj.sshShell.removeAllListeners('close');
            try { obj.sshShell.end(); } catch (ex) { console.log(ex); }
            delete obj.sshShell;
        }
        if (obj.sshClient) {
            obj.sshClient.destroy();
            obj.sshClient.removeAllListeners('ready');
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); }
            delete obj.sshClient;
        }
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();

        obj.relayActive = false;
        delete obj.termSize;
        delete obj.cookie;
        delete obj.ws;
    };

    // Start the looppback server
    function startRelayConnection(authCookie) {
        try {
            // Setup the correct URL with domain and use TLS only if needed.
            var options = { rejectUnauthorized: false };
            if (domain.dns != null) { options.servername = domain.dns; }
            var protocol = 'wss';
            if (args.tlsoffload) { protocol = 'ws'; }
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            var url = protocol + '://127.0.0.1:' + args.port + '/' + domainadd + ((obj.mtype == 3) ? 'local' : 'mesh') + 'relay.ashx?noping=1&p=11&auth=' + authCookie // Protocol 11 is Web-SSH
            parent.parent.debug('relay', 'SSH: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.debug('relay', 'SSH: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if ((obj.relayActive == false) && (data == 'c')) {
                    obj.relayActive = true;

                    // Create a serial tunnel && SSH module
                    obj.ser = new SerialTunnel();
                    const Client = require('ssh2').Client;
                    obj.sshClient = new Client();
                    obj.sshClient.on('ready', function () { // Authentication was successful.
                        obj.sshClient.shell(function (err, stream) { // Start a remote shell
                            if (err) { obj.close(); return; }
                            obj.sshShell = stream;
                            obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width);
                            obj.sshShell.on('close', function () { obj.close(); });
                            obj.sshShell.on('data', function (data) { obj.ws.send('~' + data.toString()); });
                        });
                        obj.ws.send('c');
                    });
                    obj.sshClient.on('error', function (err) {
                        if (err.level == 'client-authentication') { obj.ws.send(JSON.stringify({ action: 'autherror' })); }
                        obj.close();
                    });

                    // Setup the serial tunnel, SSH ---> Relay WS
                    obj.ser.forwardwrite = function (data) { if ((data.length > 0) && (obj.wsClient != null)) { try { obj.wsClient.send(data); } catch (ex) { } } };

                    // Connect the SSH module to the serial tunnel
                    var connectionOptions = { sock: obj.ser }
                    if (typeof obj.username == 'string') { connectionOptions.username = obj.username; delete obj.username; }
                    if (typeof obj.password == 'string') { connectionOptions.password = obj.password; delete obj.password; }
                    obj.sshClient.connect(connectionOptions);

                    // We are all set, start receiving data
                    ws._socket.resume();
                } else {
                    // Relay WS --> SSH
                    if ((data.length > 0) && (obj.ser != null)) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
                }
            });
            obj.wsClient.on('close', function () { parent.parent.debug('relay', 'SSH: Relay websocket closed'); obj.close(); });
            obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'SSH: Relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    // When data is received from the web socket
    // SSH default port is 22
    ws.on('message', function (msg) {
        try {
            if (typeof msg != 'string') return;
            if (msg[0] == '{') {
                // Control data
                msg = JSON.parse(msg);
                if (typeof msg.action != 'string') return;
                switch (msg.action) {
                    case 'sshauth': {
                        // Verify inputs
                        if ((typeof msg.username != 'string') || (typeof msg.password != 'string')) break;
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        obj.username = msg.username;
                        obj.password = msg.password;

                        // Create a mesh relay authentication cookie
                        var cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                    case 'resize': {
                        // Verify inputs
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        if (obj.sshShell != null) { obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width); }
                        break;
                    }
                }
            } else if (msg[0] == '~') {
                // Terminal data
                if (obj.sshShell != null) { obj.sshShell.write(msg.substring(1)); }
            }
        } catch (ex) { obj.close(); }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });

    // Decode the authentication cookie
    var userCookie = parent.parent.decodeCookie(req.query.auth, parent.parent.loginCookieEncryptionKey);
    if ((userCookie == null) || (userCookie.a != null)) { obj.close(); return; } // Invalid cookie

    // Fetch the user
    var user = parent.users[userCookie.userid]
    if (user == null) { obj.close(); return; } // Invalid userid

    // Check that we have a nodeid
    if (req.query.nodeid == null) { obj.close(); return; } // Invalid nodeid
    parent.GetNodeWithRights(domain, user, req.query.nodeid, function (node, rights, visible) {
        // Check permissions
        if ((rights & 8) == 0) { obj.close(); return; } // No MESHRIGHT_REMOTECONTROL rights
        if ((rights != 0xFFFFFFFF) && (rights & 0x00000200)) { obj.close(); return; } // MESHRIGHT_NOTERMINAL is set
        obj.mtype = node.mtype; // Store the device group type
        obj.nodeid = node._id; // Store the NodeID

        // Check the SSH port
        obj.tcpport = 22;
        if (typeof node.sshport == 'number') { obj.tcpport = node.sshport; }

        // We are all set, start receiving data
        ws._socket.resume();

        // Send a request for SSH authentication
        try { ws.send(JSON.stringify({ action:'sshauth' })) } catch (ex) { }
    });

    return obj;
};
