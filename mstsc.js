/**
* @description MeshCentral MSTSC relay
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
    obj.domain = domain;
    obj.ws = ws;
    obj.wsClient = null;
    obj.tcpServer = null;
    obj.tcpServerPort = 0;
    obj.relaySocket = null;
    obj.relayActive = false;
    obj.infos = null;
    var rdpClient = null;

    parent.parent.debug('relay', 'RDP: Request for RDP relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        if (obj.wsClient) { obj.wsClient.close(); obj.wsClient = null; }
        if (obj.tcpServer) { obj.tcpServer.close(); obj.tcpServer = null; }
        if (rdpClient) { rdpClient.close(); rdpClient = null; }
        delete obj.domain;
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

                // Setup the correct URL with domain and use TLS only if needed.
                var options = { rejectUnauthorized: false };
                if (domain.dns != null) { options.servername = domain.dns; }
                var protocol = 'wss';
                if (args.tlsoffload) { protocol = 'ws'; }
                var domainadd = '';
                if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
                var url = protocol + '://127.0.0.1:' + args.port + '/' + domainadd + 'meshrelay.ashx?noping=1&auth=' + obj.infos.ip;
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