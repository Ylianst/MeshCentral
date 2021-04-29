/**
* @description MeshCentral SSH relay
* @author Ylian Saint-Hilaire
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

// Construct a SSH Relay object, called upon connection
module.exports.CreateSshRelay = function (parent, db, ws, req, args, domain) {
    const Net = require('net');
    const WebSocket = require('ws');

    var obj = {};
    obj.domain = domain;
    obj.ws = ws;
    obj.relaySocket = null;
    obj.relayActive = false;
    obj.infos = null;
    obj.sshClient = null;
    obj.sshShell = null;
    obj.termSize = null;

    parent.parent.debug('relay', 'SSH: Request for SSH relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        //if (obj.wsClient) { obj.wsClient.close(); obj.wsClient = null; }
        //if (obj.tcpServer) { obj.tcpServer.close(); obj.tcpServer = null; }
        //if (sshClient) { sshClient.close(); sshClient = null; }

        if (obj.sshClient != null) {
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); } 
            delete obj.sshClient;
        }
        if (obj.sshShell != null) {
            try { obj.sshShell.end(); } catch (ex) { console.log(ex); } 
            delete obj.sshShell;
        }

        delete obj.domain;
        delete obj.ws;
    };

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
                        obj.termSize = msg;
                        const Client = require('ssh2').Client;
                        obj.sshClient = new Client();

                        obj.sshClient.on('ready', function () { // Authentication was successful.
                            obj.sshClient.shell(function (err, stream) {
                                if (err) { obj.close(); return; }
                                obj.sshShell = stream;
                                obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width);
                                obj.sshShell.on('close', function () { obj.close(); });
                                obj.sshShell.on('data', function (data) { obj.ws.send('~' + data); });
                            });
                            obj.ws.send(JSON.stringify({ action: 'connected' }));
                        });
                        obj.sshClient.on('error', function (err) {
                            if (err.level == 'client-authentication') { obj.ws.send(JSON.stringify({ action: 'autherror' })); }
                            obj.close();
                        });

                        var connectionOptions = {
                            //debug: function (msg) { console.log(msg); },
                            // sock: // TODO
                            host: '192.168.2.205',
                            port: 22
                        }

                        if (typeof msg.username == 'string') { connectionOptions.username = msg.username; }
                        if (typeof msg.password == 'string') { connectionOptions.password = msg.password; }

                        obj.sshClient.connect(connectionOptions);
                        break;
                    }
                    case 'resize': {
                        obj.termSize = msg;
                        if (obj.sshShell != null) { obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width); }
                        break;
                    }
                }
            } else if (msg[0] == '~') {
                // Terminal data
                if (obj.sshShell != null) { obj.sshShell.write(msg.substring(1)); }
            }
        } catch (ex) {
            console.log('SSHMessageException', msg, ex);
            obj.close();
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });

    // Send an object with flow control
    function send(obj) {
        //try { sshClient.bufferLayer.socket.pause(); } catch (ex) { }
        //try { ws.send(JSON.stringify(obj), function () { try { sshClient.bufferLayer.socket.resume(); } catch (ex) { } }); } catch (ex) { }

        try { ws.send(JSON.stringify(obj), function () { }); } catch (ex) { }
    }

    // We are all set, start receiving data
    ws._socket.resume();

    return obj;
};