/*
Copyright 2020-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

@description Intel AMT redirection stack
@author Ylian Saint-Hilaire
@version v0.3.0
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a MeshServer object
module.exports.CreateAmtRedirect = function (module, domain, user, webserver, meshcentral) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.State = 0;
    obj.net = require('net');
    obj.tls = require('tls');
    obj.crypto = require('crypto');
    const constants = require('constants');
    obj.socket = null;
    obj.amtuser = null;
    obj.amtpass = null;
    obj.connectstate = 0;
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER
    obj.xtlsoptions = null;
    obj.redirTrace = false;
    obj.tls1only = 0; // TODO

    obj.amtaccumulator = '';
    obj.amtsequence = 1;
    obj.amtkeepalivetimer = null;
    obj.authuri = '/RedirectionService';

    obj.onStateChanged = null;
    obj.forwardclient = null;

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 1;
    const MESHRIGHT_MANAGEUSERS = 2;
    const MESHRIGHT_MANAGECOMPUTERS = 4;
    const MESHRIGHT_REMOTECONTROL = 8;
    const MESHRIGHT_AGENTCONSOLE = 16;
    const MESHRIGHT_SERVERFILES = 32;
    const MESHRIGHT_WAKEDEVICE = 64;
    const MESHRIGHT_SETNOTES = 128;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 1;
    const SITERIGHT_MANAGEUSERS = 2;
    const SITERIGHT_SERVERRESTORE = 4;
    const SITERIGHT_FILEACCESS = 8;
    const SITERIGHT_SERVERUPDATE = 16;
    const SITERIGHT_LOCKED = 32;

    function Debug(lvl) {
        if ((arguments.length < 2) || (meshcentral.debugLevel == null) || (lvl > meshcentral.debugLevel)) return;
        var a = []; for (var i = 1; i < arguments.length; i++) { a.push(arguments[i]); } console.log(...a);
    }

    // Older NodeJS does not support the keyword "class", so we do without using this syntax
    // TODO: Validate that it's the same as above and that it works.
    function SerialTunnel(options) {
        var obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err('Failed to fwd _write.'); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        return obj;
    }

    obj.Start = function (nodeid) {
        //console.log('Amt-Redir-Start', nodeid);
        obj.connectstate = 0;
        Debug(1, 'AMT redir for ' + user.name + ' to ' + nodeid + '.');
        obj.xxStateChange(1);

        // Fetch information about the target
        meshcentral.db.Get(nodeid, function (err, docs) {
            if (docs.length == 0) { console.log('ERR: Node not found'); obj.Stop(); return; }
            var node = docs[0];
            if (!node.intelamt) { console.log('ERR: Not AMT node'); obj.Stop(); return; }

            obj.amtuser = node.intelamt.user;
            obj.amtpass = node.intelamt.pass;

            // Check if this user has permission to manage this computer
            var meshlinks = user.links[node.meshid];
            if ((!meshlinks) || (!meshlinks.rights) || ((meshlinks.rights & MESHRIGHT_REMOTECONTROL) == 0)) { console.log('ERR: Access denied (2)'); obj.Stop(); return; }

            // Check what connectivity is available for this node
            var state = meshcentral.GetConnectivityState(nodeid);
            var conn = 0;
            if (!state || state.connectivity == 0) { Debug(1, 'ERR: No routing possible (1)'); obj.Stop(); return; } else { conn = state.connectivity; }

            /*
            // Check what server needs to handle this connection
            if ((meshcentral.multiServer != null) && (cookie == null)) { // If a cookie is provided, don't allow the connection to jump again to a different server
                var server = obj.parent.GetRoutingServerId(nodeid, 2); // Check for Intel CIRA connection
                if (server != null) {
                    if (server.serverid != obj.parent.serverId) {
                        // Do local Intel CIRA routing using a different server
                        Debug(1, 'Route Intel AMT CIRA connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                } else {
                    server = obj.parent.GetRoutingServerId(nodeid, 4); // Check for local Intel AMT connection
                    if ((server != null) && (server.serverid != obj.parent.serverId)) {
                        // Do local Intel AMT routing using a different server
                        Debug(1, 'Route Intel AMT direct connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                }
            }
            */

            // If Intel AMT CIRA connection is available, use it
            var ciraconn = meshcentral.mpsserver.GetConnectionToNode(nodeid, null, true); // Request an OOB connection
            if (ciraconn != null) {
                Debug(1, 'Opening Intel AMT CIRA transport connection to ' + nodeid + '.');

                // Compute target port, look at the CIRA port mappings, if non-TLS is allowed, use that, if not use TLS
                var port = 16995;
                if (ciraconn.tag.boundPorts.indexOf(16994) >= 0) port = 16994; // RELEASE: Always use non-TLS mode if available within CIRA

                // Setup a new CIRA channel
                if ((port == 16993) || (port == 16995)) {
                    // Perform TLS - ( TODO: THIS IS BROKEN on Intel AMT v7 but works on v10, Not sure why. Well, could be broken TLS 1.0 in firmware )
                    var ser = new SerialTunnel();
                    var chnl = meshcentral.mpsserver.SetupChannel(ciraconn, port);

                    // let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                    // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                    ser.forwardwrite = function (msg) {
                        // TLS ---> CIRA
                        chnl.write(msg.toString('binary'));
                    };

                    // When APF tunnel return something, update SerialTunnel buffer
                    chnl.onData = function (ciraconn, data) {
                        // CIRA ---> TLS
                        Debug(3, 'Relay TLS CIRA data', data.length);
                        if (data.length > 0) { try { ser.updateBuffer(Buffer.from(data, 'binary')); } catch (e) { } }
                    };

                    // Handle CIRA tunnel state change
                    chnl.onStateChange = function (ciraconn, state) {
                        Debug(2, 'Relay TLS CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                    };

                    // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                    const TLSSocket = require('tls').TLSSocket;
                    const tlsoptions = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                    if (obj.tls1only == 1) { tlsoptions.secureProtocol = 'TLSv1_method'; }
                    const tlsock = new TLSSocket(ser, tlsoptions);
                    tlsock.on('error', function (err) { Debug(1, "CIRA TLS Connection Error ", err); });
                    tlsock.on('secureConnect', function () { Debug(2, "CIRA Secure TLS Connection"); ws._socket.resume(); });

                    // Decrypted tunnel from TLS communcation to be forwarded to websocket
                    tlsock.on('data', function (data) {
                        // AMT/TLS ---> WS
                        try {
                            data = data.toString('binary');
                            //ws.send(Buffer.from(data, 'binary'));
                            ws.send(data);
                        } catch (e) { }
                    });

                    // If TLS is on, forward it through TLSSocket
                    obj.forwardclient = tlsock;
                    obj.forwardclient.xtls = 1;
                } else {
                    // Without TLS
                    obj.forwardclient = meshcentral.mpsserver.SetupChannel(ciraconn, port);
                    obj.forwardclient.xtls = 0;
                }

                obj.forwardclient.onStateChange = function (ciraconn, state) {
                    Debug(2, 'Intel AMT CIRA relay state change', state);
                    if (state == 0) { try { obj.Stop(); } catch (e) { } }
                    else if (state == 2) { obj.xxOnSocketConnected(); }
                };

                obj.forwardclient.onData = function (ciraconn, data) {
                    Debug(4, 'Intel AMT CIRA data', data.length);
                    if (data.length > 0) { obj.xxOnSocketData(data); } // TODO: Add TLS support
                };

                obj.forwardclient.onSendOk = function (ciraconn) {
                    // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                    Debug(4, 'Intel AMT CIRA sendok');
                };

                return;
            }

            // If Intel AMT direct connection is possible, option a direct socket
            if ((conn & 4) != 0) {   // We got a new web socket connection, initiate a TCP connection to the target Intel AMT host/port.
                Debug(1, 'Opening Intel AMT transport connection to ' + nodeid + '.');

                // Compute target port
                var port = 16994;
                if (node.intelamt.tls > 0) port = 16995; // This is a direct connection, use TLS when possible

                if (node.intelamt.tls != 1) {
                    // If this is TCP (without TLS) set a normal TCP socket
                    obj.forwardclient = new obj.net.Socket();
                    obj.forwardclient.setEncoding('binary');
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    var tlsoptions = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                    if (obj.tls1only == 1) { tlsoptions.secureProtocol = 'TLSv1_method'; }
                    obj.forwardclient = obj.tls.connect(port, node.host, tlsoptions, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        Debug(2, 'TLS Intel AMT transport connected to ' + node.host + ':' + port + '.');
                        obj.xxOnSocketConnected();
                    });
                    obj.forwardclient.setEncoding('binary');
                }

                // When we receive data on the TCP connection, forward it back into the web socket connection.
                obj.forwardclient.on('data', function (data) {
                    //if (obj.parent.debugLevel >= 1) { // DEBUG
                        Debug(1, 'Intel AMT transport data from ' + node.host + ', ' + data.length + ' bytes.');
                        Debug(4, '  ' + Buffer.from(data, 'binary').toString('hex'));
                        //if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + Buffer.from(data, 'binary').toString('hex')); }
                    //}
                    obj.xxOnSocketData(data);
                });

                // If the TCP connection closes, disconnect the associated web socket.
                obj.forwardclient.on('close', function () {
                    Debug(1, 'Intel AMT transport relay disconnected from ' + node.host + '.');
                    obj.Stop();
                });

                // If the TCP connection causes an error, disconnect the associated web socket.
                obj.forwardclient.on('error', function (err) {
                    Debug(1, 'Intel AMT transport relay error from ' + node.host + ': ' + err.errno);
                    obj.Stop();
                });

                if (node.intelamt.tls == 0) {
                    // A TCP connection to Intel AMT just connected, start forwarding.
                    obj.forwardclient.connect(port, node.host, function () {
                        Debug(1, 'Intel AMT transport connected to ' + node.host + ':' + port + '.');
                        obj.xxOnSocketConnected();
                    });
                }
                
                return;
            }

        });
    }

    // Get the certificate of Intel AMT
    obj.getPeerCertificate = function () { if (obj.xtls == true) { return obj.socket.getPeerCertificate(); } return null; }

    obj.xxOnSocketConnected = function () {
        //console.log('xxOnSocketConnected');
        if (!obj.xtlsoptions || !obj.xtlsoptions.meshServerConnect) {
            if (obj.xtls == true) {
                obj.xtlsCertificate = obj.socket.getPeerCertificate();
                if ((obj.xtlsFingerprint != 0) && (obj.xtlsCertificate.fingerprint.split(':').join('').toLowerCase() != obj.xtlsFingerprint)) { obj.Stop(); return; }
            }
        }

        if (obj.redirTrace) { console.log("REDIR-CONNECTED"); }
        //obj.Debug("Socket Connected");
        obj.xxStateChange(2);
        if (obj.protocol == 1) obj.xxSend(obj.RedirectStartSol); // TODO: Put these strings in higher level module to tighten code
        if (obj.protocol == 2) obj.xxSend(obj.RedirectStartKvm); // Don't need these is the feature if not compiled-in.
        if (obj.protocol == 3) obj.xxSend(obj.RedirectStartIder);
    }
   
    obj.xxOnSocketData = function (data) {
        if (!data || obj.connectstate == -1) return;
        if (obj.redirTrace) { console.log("REDIR-RECV(" + data.length + "): " + webserver.common.rstr2hex(data)); }
        //obj.Debug("Recv(" + data.length + "): " + webserver.common.rstr2hex(data));
        if ((obj.protocol > 1) && (obj.connectstate == 1)) { return obj.m.ProcessData(data); } // KVM traffic, forward it directly.
        obj.amtaccumulator += data;
        //obj.Debug("Recv(" + obj.amtaccumulator.length + "): " + webserver.common.rstr2hex(obj.amtaccumulator));
        while (obj.amtaccumulator.length >= 1) {
            var cmdsize = 0;
            switch (obj.amtaccumulator.charCodeAt(0)) {
                case 0x11: // StartRedirectionSessionReply (17)
                    if (obj.amtaccumulator.length < 4) return;
                    var statuscode = obj.amtaccumulator.charCodeAt(1);
                    switch (statuscode) {
                        case 0: // STATUS_SUCCESS
                            if (obj.amtaccumulator.length < 13) return;
                            var oemlen = obj.amtaccumulator.charCodeAt(12);
                            if (obj.amtaccumulator.length < 13 + oemlen) return;
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)); // Query authentication support
                            cmdsize = (13 + oemlen);
                            break;
                        default:
                            obj.Stop();
                            break;
                    }
                    break;
                case 0x14: // AuthenticateSessionReply (20)
                    if (obj.amtaccumulator.length < 9) return;
                    var authDataLen = webserver.common.ReadIntX(obj.amtaccumulator, 5);
                    if (obj.amtaccumulator.length < 9 + authDataLen) return;
                    var status = obj.amtaccumulator.charCodeAt(1);
                    var authType = obj.amtaccumulator.charCodeAt(4);
                    var authData = [];
                    for (var i = 0; i < authDataLen; i++) { authData.push(obj.amtaccumulator.charCodeAt(9 + i)); }
                    var authDataBuf = obj.amtaccumulator.substring(9, 9 + authDataLen);
                    cmdsize = 9 + authDataLen;
                    if (authType == 0) {
                        /*
                        // This is Kerberos code, not supported in MeshCentral.
                        if (obj.amtuser == '*') {
                            if (authData.indexOf(2) >= 0) {
                                // Kerberos Auth
                                var ticket;
                                if (kerberos && kerberos != null) {
                                    var ticketReturn = kerberos.getTicket('HTTP' + ((obj.tls == 1)?'S':'') + '/' + ((obj.amtpass == '') ? (obj.host + ':' + obj.port) : obj.amtpass));
                                    if (ticketReturn.returnCode == 0 || ticketReturn.returnCode == 0x90312) {
                                        ticket = ticketReturn.ticket;
                                        if (process.platform.indexOf('win') >= 0) {
                                            // Clear kerberos tickets on both 32 and 64bit Windows platforms
                                            try { require('child_process').exec('%windir%\\system32\\klist purge', function (error, stdout, stderr) { if (error) { require('child_process').exec('%windir%\\sysnative\\klist purge', function (error, stdout, stderr) { if (error) { console.error('Unable to purge kerberos tickets'); } }); } }); } catch (e) { console.log(e); }
                                        }
                                    } else {
                                        console.error('Unexpected Kerberos error code: ' + ticketReturn.returnCode);
                                    }
                                }
                                if (ticket) {
                                    obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x02) + webserver.common.IntToStrX(ticket.length) + ticket);
                                } else {
                                    obj.Stop();
                                }
                            }
                            else obj.Stop();
                        } else {
                        */
                            // Query
                            if (authData.indexOf(4) >= 0) {
                                // Good Digest Auth (With cnonce and all)
                                obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x04) + webserver.common.IntToStrX(obj.amtuser.length + obj.authuri.length + 8) + String.fromCharCode(obj.amtuser.length) + obj.amtuser + String.fromCharCode(0x00, 0x00) + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(0x00, 0x00, 0x00, 0x00));
                            }
                            /*
                            else if (authData.indexOf(3) >= 0) {
                                // Bad Digest Auth (Not sure why this is supported, cnonce is not used!)
                                obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x03) + webserver.common.IntToStrX(obj.amtuser.length + obj.authuri.length + 7) + String.fromCharCode(obj.amtuser.length) + obj.amtuser + String.fromCharCode(0x00, 0x00) + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(0x00, 0x00, 0x00));
                            }
                            else if (authData.indexOf(1) >= 0) {
                                // Basic Auth (Probably a good idea to not support this unless this is an old version of Intel AMT)
                                obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x01) + webserver.common.IntToStrX(obj.amtuser.length + obj.amtpass.length + 2) + String.fromCharCode(obj.amtuser.length) + obj.amtuser + String.fromCharCode(obj.amtpass.length) + obj.amtpass);
                            }
                            */
                            else obj.Stop();
                        /*
                        }
                        */
                    }
                    else if ((authType == 3 || authType == 4) && status == 1) {
                        var curptr = 0;

                        // Realm
                        var realmlen = authDataBuf.charCodeAt(curptr);
                        var realm = authDataBuf.substring(curptr + 1, curptr + 1 + realmlen);
                        curptr += (realmlen + 1);

                        // Nonce
                        var noncelen = authDataBuf.charCodeAt(curptr);
                        var nonce = authDataBuf.substring(curptr + 1, curptr + 1 + noncelen);
                        curptr += (noncelen + 1);

                        // QOP
                        var qoplen = 0;
                        var qop = null;
                        var cnonce = obj.xxRandomValueHex(32);
                        var snc = '00000002';
                        var extra = '';
                        if (authType == 4) {
                            qoplen = authDataBuf.charCodeAt(curptr);
                            qop = authDataBuf.substring(curptr + 1, curptr + 1 + qoplen);
                            curptr += (qoplen + 1);
                            extra = snc + ":" + cnonce + ":" + qop + ":";
                        }
                        var digest = hex_md5(hex_md5(obj.amtuser + ":" + realm + ":" + obj.amtpass) + ":" + nonce + ":" + extra + hex_md5("POST:" + obj.authuri));

                        var totallen = obj.amtuser.length + realm.length + nonce.length + obj.authuri.length + cnonce.length + snc.length + digest.length + 7;
                        if (authType == 4) totallen += (qop.length + 1);
                        var buf = String.fromCharCode(0x13, 0x00, 0x00, 0x00, authType) + webserver.common.IntToStrX(totallen) + String.fromCharCode(obj.amtuser.length) + obj.amtuser + String.fromCharCode(realm.length) + realm + String.fromCharCode(nonce.length) + nonce + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(cnonce.length) + cnonce + String.fromCharCode(snc.length) + snc + String.fromCharCode(digest.length) + digest;
                        if (authType == 4) buf += (String.fromCharCode(qop.length) + qop);
                        obj.xxSend(buf);
                    }
                    else if (status == 0) { // Success
                        /*
                        if (obj.protocol == 1) {
                            // Serial-over-LAN: Send Intel AMT serial settings...
                            var MaxTxBuffer = 10000;
                            var TxTimeout = 100;
                            var TxOverflowTimeout = 0;
                            var RxTimeout = 10000;
                            var RxFlushTimeout = 100;
                            var Heartbeat = 0;//5000;
                            obj.xxSend(String.fromCharCode(0x20, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + ToShortStr(MaxTxBuffer) + ToShortStr(TxTimeout) + ToShortStr(TxOverflowTimeout) + ToShortStr(RxTimeout) + ToShortStr(RxFlushTimeout) + ToShortStr(Heartbeat) + ToIntStr(0));
                        }
                        if (obj.protocol == 2) {
                            // Remote Desktop: Send traffic directly...
                            obj.xxSend(String.fromCharCode(0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00));
                        }
                        */
                        if (obj.protocol == 3) { // IDE-R
                            obj.connectstate = 1;
                            obj.m.Start();
                            if (obj.amtaccumulator.length > cmdsize) { obj.m.ProcessData(obj.amtaccumulator.substring(cmdsize)); }
                            cmdsize = obj.amtaccumulator.length;
                        }
                    } else obj.Stop();
                    break;
                case 0x21: // Response to settings (33)
                    if (obj.amtaccumulator.length < 23) break;
                    cmdsize = 23;
                    obj.xxSend(String.fromCharCode(0x27, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + String.fromCharCode(0x00, 0x00, 0x1B, 0x00, 0x00, 0x00));
                    if (obj.protocol == 1) { obj.amtkeepalivetimer = setInterval(obj.xxSendAmtKeepAlive, 2000); }
                    obj.connectstate = 1;
                    obj.xxStateChange(3);
                    break;
                case 0x29: // Serial Settings (41)
                    if (obj.amtaccumulator.length < 10) break;
                    cmdsize = 10;
                    break;
                case 0x2A: // Incoming display data (42)
                    if (obj.amtaccumulator.length < 10) break;
                    var cs = (10 + ((obj.amtaccumulator.charCodeAt(9) & 0xFF) << 8) + (obj.amtaccumulator.charCodeAt(8) & 0xFF));
                    if (obj.amtaccumulator.length < cs) break;
                    obj.m.ProcessData(obj.amtaccumulator.substring(10, cs));
                    cmdsize = cs;
                    break;
                case 0x2B: // Keep alive message (43)
                    if (obj.amtaccumulator.length < 8) break;
                    cmdsize = 8;
                    break;
                case 0x41:
                    if (obj.amtaccumulator.length < 8) break;
                    obj.connectstate = 1;
                    obj.m.Start();
                    // KVM traffic, forward rest of accumulator directly.
                    if (obj.amtaccumulator.length > 8) { obj.m.ProcessData(obj.amtaccumulator.substring(8)); }
                    cmdsize = obj.amtaccumulator.length;
                    break;
                default:
                    console.log("Unknown Intel AMT command: " + obj.amtaccumulator.charCodeAt(0) + " acclen=" + obj.amtaccumulator.length);
                    obj.Stop();
                    return;
            }
            if (cmdsize == 0) return;
            obj.amtaccumulator = obj.amtaccumulator.substring(cmdsize);
        }
    }
    
    obj.xxSend = function (x) {
        if (typeof x == 'string') {
            if (obj.redirTrace) { console.log("REDIR-SEND(" + x.length + "): " + Buffer.from(x, 'binary').toString('hex'), typeof x); }
            //obj.Debug("Send(" + x.length + "): " + webserver.common.rstr2hex(x));
            //obj.forwardclient.write(x); // FIXES CIRA
            obj.forwardclient.write(Buffer.from(x, 'binary'));
        } else {
            if (obj.redirTrace) { console.log("REDIR-SEND(" + x.length + "): " + x.toString('hex'), typeof x); }
            //obj.Debug("Send(" + x.length + "): " + webserver.common.rstr2hex(x));
            //obj.forwardclient.write(x); // FIXES CIRA
            obj.forwardclient.write(x);
        }
    }

    obj.Send = function (x) {
        if (obj.forwardclient == null || obj.connectstate != 1) return;
        if (obj.protocol == 1) { obj.xxSend(String.fromCharCode(0x28, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + ToShortStr(x.length) + x); } else { obj.xxSend(x); }
    }

    obj.xxSendAmtKeepAlive = function () {
        if (obj.forwardclient == null) return;
        obj.xxSend(String.fromCharCode(0x2B, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++));
    }

    obj.xxRandomValueHex = function(len) { return obj.crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len); }

    obj.xxOnSocketClosed = function () {
        if (obj.redirTrace) { console.log('REDIR-CLOSED'); }
        //obj.Debug("Socket Closed");
        obj.Stop();
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    obj.Stop = function () {
        if (obj.redirTrace) { console.log('REDIR-CLOSED'); }
        //obj.Debug("Socket Stopped");
        obj.xxStateChange(0);
        obj.connectstate = -1;
        obj.amtaccumulator = '';
        if (obj.forwardclient != null) { try { obj.forwardclient.destroy(); } catch (ex) { } delete obj.forwardclient; }
        if (obj.amtkeepalivetimer != null) { clearInterval(obj.amtkeepalivetimer); delete obj.amtkeepalivetimer; }
    }

    obj.RedirectStartSol = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x53, 0x4F, 0x4C, 0x20);
    obj.RedirectStartKvm = String.fromCharCode(0x10, 0x01, 0x00, 0x00, 0x4b, 0x56, 0x4d, 0x52);
    obj.RedirectStartIder = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x49, 0x44, 0x45, 0x52);

    function hex_md5(str) { return meshcentral.certificateOperations.forge.md.md5.create().update(str).digest().toHex(); }

    return obj;
}

function ToIntStr(v) { return String.fromCharCode((v & 0xFF), ((v >> 8) & 0xFF), ((v >> 16) & 0xFF), ((v >> 24) & 0xFF)); }
function ToShortStr(v) { return String.fromCharCode((v & 0xFF), ((v >> 8) & 0xFF)); }
