/**
* @description MeshCentral MSTSC relay
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2020
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
module.exports.CreateMstscRelay = function (parent, db, ws, req, args, domain, user) {
    const Net = require('net');
    const WebSocket = require('ws');

    var obj = {};
    obj.user = user;
    obj.domain = domain;
    obj.ws = ws;
    obj.wsClient = null;
    obj.tcpServer = null;
    obj.tcpServerPort = 0;
    obj.relaySocket = null;
    obj.relayActive = false;
    obj.infos = null;
    var rdpClient = null;

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        if (obj.wsClient) { obj.wsClient.close(); obj.wsClient = null; }
        if (obj.tcpServer) { obj.tcpServer.close(); obj.tcpServer = null; }
        if (rdpClient) { rdpClient.close(); rdpClient = null; }
        delete obj.user;
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
                obj.relaySocket.on('data', function (chunk) { if (obj.relayActive == true) { obj.wsClient.send(chunk); } });
                obj.relaySocket.on('end', function () { obj.close(0); });
                obj.relaySocket.on('error', function (err) { obj.close(0); });

                // Setup the correct URL with domain and use TLS only if needed.
                var options = { rejectUnauthorized: false };
                if (domain.dns != null) { options.servername = domain.dns; }
                var protocol = 'wss';
                if (args.notls || args.tlsoffload) { protocol = 'ws'; }
                var domainadd = '';
                if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
                obj.wsClient = new WebSocket(protocol + '://127.0.0.1/' + domainadd + 'meshrelay.ashx?auth=' + obj.infos.ip, options);

                obj.wsClient.on('open', function () { });
                obj.wsClient.on('message', function (data) { if ((obj.relayActive == false) && (data == 'c')) { obj.relayActive = true; obj.relaySocket.resume(); } else { obj.relaySocket.write(data); } });
                obj.wsClient.on('close', function () { obj.close(0); });
                obj.tcpServer.close();
                obj.tcpServer = null;
            }
        });
    }

    // Start the RDP client
    function startRdp(port) {
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
            obj.close(0);
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
                case 'disconnect': { obj.close(0); break; }
            }
        } catch (ex) {
            console.log('RdpMessageException', msg, ex);
            obj.close(0);
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { console.log(err); obj.close(0); });

    // If the web socket is closed
    ws.on('close', function (req) { obj.close(0); });

    // Send an object
    function send(obj) { try { ws.send(JSON.stringify(obj)); } catch (ex) { } }

    // We are all set, start receiving data
    ws._socket.resume();

    return obj;
};