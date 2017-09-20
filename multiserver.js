/**
* @description Meshcentral Multi-Server Support
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a Mesh Multi-Server object. This is used for MeshCentral-to-MeshCentral communication.
module.exports.CreateMultiServer = function (parent, args) {
    var obj = {};
    obj.parent = parent;
    obj.crypto = require('crypto');
    obj.peerConfig = parent.config.peers;
    obj.forge = require('node-forge');
    obj.outPeerServers = {}; // Outgoing peer servers
    obj.peerServers = {}; // All connected servers (in & out). Only present in this list if the connection is setup
    obj.serverid = null;

    // Create a mesh server module that will connect to other servers
    obj.CreatePeerOutServer = function (parent, serverid, url) {
        var obj = {};
        obj.parent = parent;
        obj.serverid = serverid;
        obj.url = url;
        obj.ws = null;
        obj.conn = null;
        obj.certificates = parent.parent.certificates;
        obj.common = require('./common.js');
        obj.forge = require('node-forge');
        obj.crypto = require('crypto');
        obj.pki = obj.forge.pki;
        obj.connectionState = 0;
        obj.retryTimer = null;
        obj.retryBackoff = 0;
        obj.connectHandler = null;
        obj.webCertificatHash = obj.parent.parent.webserver.webCertificatHash;
        obj.agentCertificatHashHex = obj.parent.parent.webserver.agentCertificatHashHex;
        obj.agentCertificatAsn1 = obj.parent.parent.webserver.agentCertificatAsn1;
        obj.peerServerId = null;
        obj.authenticated = 0;
        obj.serverCertHash = null;

        // Disconnect from the server and/or stop trying
        obj.stop = function () {
            obj.connectionState = 0;
            disconnect();
        }

        // Make one attempt at connecting to the server
        function connect() {
            obj.retryTimer = null;
            obj.connectionState = 1;

            // Get the web socket setup
            const WebSocket = require('websocket');
            var WebSocketClient = require('websocket').client;
            obj.ws = new WebSocketClient();
            obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Connecting to: ' + url + 'meshserver.ashx');

            // Register the connection failed event
            obj.ws.on('connectFailed', function (error) { obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Failed connection'); disconnect(); });

            // Register the connection event
            obj.ws.on('connect', function (connection) {
                obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Connected');
                obj.connectionState |= 2;
                obj.conn = connection;
                obj.nonce = obj.forge.random.getBytesSync(32);

                // If the connection has an error or closes
                obj.conn.on('error', function (error) { obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Error: ' + error); disconnect(); });
                obj.conn.on('close', function () { obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Disconnected'); disconnect(); });

                // Get the peer server's certificate and compute the server public key hash
                if (obj.ws.socket == null) return;
                var rawcertbuf = obj.ws.socket.getPeerCertificate().raw, rawcert = '';
                for (var i = 0; i < rawcertbuf.length; i++) { rawcert += String.fromCharCode(rawcertbuf[i]); }
                var serverCert = obj.forge.pki.certificateFromAsn1(obj.forge.asn1.fromDer(rawcert));
                obj.serverCertHash = obj.forge.pki.getPublicKeyFingerprint(serverCert.publicKey, { encoding: 'binary', md: obj.forge.md.sha256.create() });

                // If a message is received
                obj.conn.on('message', function (msg) {
                    if (msg.type == 'binary') { var msg2 = ""; for (var i = 0; i < msg.binaryData.length; i++) { msg2 += String.fromCharCode(msg.binaryData[i]); } msg = msg2; }
                    else if (msg.type == 'utf8') { msg = msg.utf8Data; }
                    if (msg.length < 2) return;

                    if (msg.charCodeAt(0) == 123) {
                        if (obj.connectionState == 15) { processServerData(msg); }
                    } else {
                        var cmd = obj.common.ReadShort(msg, 0);
                        switch (cmd) {
                            case 1: {
                                // Server authentication request
                                if (msg.length != 66) { obj.parent.parent.debug(1, 'OutPeer: BAD MESSAGE(A1)'); return; }

                                // Check that the server hash matches the TLS server certificate public key hash
                                if (obj.serverCertHash != msg.substring(2, 34)) { obj.parent.parent.debug(1, 'OutPeer: Server hash mismatch.'); disconnect(); return; }
                                obj.servernonce = msg.substring(34);

                                // Use our agent root private key to sign the ServerHash + ServerNonce + AgentNonce
                                var privateKey = obj.forge.pki.privateKeyFromPem(obj.certificates.agent.key);
                                var md = obj.forge.md.sha256.create();
                                md.update(msg.substring(2), 'binary');
                                md.update(obj.nonce, 'binary');

                                // Send back our certificate + signature
                                agentRootCertificatAsn1 = obj.forge.asn1.toDer(obj.forge.pki.certificateToAsn1(obj.forge.pki.certificateFromPem(obj.certificates.agent.cert))).getBytes();
                                obj.conn.send(obj.common.ShortToStr(2) + obj.common.ShortToStr(agentRootCertificatAsn1.length) + agentRootCertificatAsn1 + privateKey.sign(md)); // Command 3, signature
                                break;
                            }
                            case 2: {
                                // Server certificate
                                var certlen = obj.common.ReadShort(msg, 2), serverCert = null;
                                try { serverCert = obj.forge.pki.certificateFromAsn1(obj.forge.asn1.fromDer(msg.substring(4, 4 + certlen))); } catch (e) { }
                                if (serverCert == null) { obj.parent.parent.debug(1, 'OutPeer: Invalid server certificate.'); disconnect(); return; }
                                var serverid = obj.forge.pki.getPublicKeyFingerprint(serverCert.publicKey, { encoding: 'hex', md: obj.forge.md.sha256.create() });
                                if (serverid !== obj.agentCertificatHashHex) { obj.parent.parent.debug(1, 'OutPeer: Server hash mismatch.'); disconnect(); return; }

                                // Server signature, verify it
                                var md = obj.forge.md.sha256.create();
                                md.update(obj.serverCertHash, 'binary');
                                md.update(obj.nonce, 'binary');
                                md.update(obj.servernonce, 'binary');
                                if (serverCert.publicKey.verify(md.digest().bytes(), msg.substring(4 + certlen)) == false) { obj.parent.parent.debug(1, 'OutPeer: Server sign check failed.'); disconnect(); return; }

                                // Connection is a success, clean up
                                delete obj.nonce;
                                delete obj.servernonce;
                                obj.serverCertHash = obj.common.rstr2hex(obj.serverCertHash).toLowerCase(); // Change this value to hex
                                obj.connectionState |= 4;
                                obj.retryBackoff = 0; // Set backoff connection timer back to fast.
                                obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Verified peer connection to ' + obj.url);

                                // Send information about our server to the peer
                                if (obj.connectionState == 15) { obj.conn.send(JSON.stringify({ action: 'info', serverid: obj.parent.serverid, dbid: obj.parent.parent.db.identifier, key: obj.parent.serverKey, serverCertHash: obj.parent.parent.webserver.webCertificatHashHex })); }
                                //if ((obj.connectionState == 15) && (obj.connectHandler != null)) { obj.connectHandler(1); }
                                break;
                            }
                            case 4: {
                                // Server confirmed authentication, we are allowed to send commands to the server
                                obj.connectionState |= 8;
                                if (obj.connectionState == 15) { obj.conn.send(JSON.stringify({ action: 'info', serverid: obj.parent.serverid, dbid: obj.parent.parent.db.identifier, key: obj.parent.serverKey, serverCertHash: obj.parent.parent.webserver.webCertificatHashHex })); }
                                //if ((obj.connectionState == 15) && (obj.connectHandler != null)) { obj.connectHandler(1); }
                                break;
                            }
                            default: {
                                obj.parent.parent.debug(1, 'OutPeer ' + obj.serverid + ': Un-handled command: ' + cmd);
                                break;
                            }
                        }
                    }
                });

                // Not sure why, but we need to delay the first send
                setTimeout(function () {
                    if ((obj.ws == null) || (obj.conn == null)) return;
                    // Start authenticate the mesh agent by sending a auth nonce & server TLS cert hash.
                    // Send 256 bits SHA256 hash of TLS cert public key + 256 bits nonce
                    obj.conn.send(obj.common.ShortToStr(1) + obj.serverCertHash + obj.nonce); // Command 1, hash + nonce
                }, 10);
            });

            obj.ws.connect(obj.url + 'meshserver.ashx', null, null, null, { rejectUnauthorized: false, cert: obj.certificates.agent.cert, key: obj.certificates.agent.key });
        }

        // Disconnect from the server, if we need to, try again with a delay.
        function disconnect() {
            if (obj.authenticated == 3) { obj.parent.ClearPeerServer(obj, obj.peerServerId); obj.authenticated = 0; }
            if ((obj.connectionState == 15) && (obj.connectHandler != null)) { obj.connectHandler(0); }
            if (obj.conn != null) { obj.conn.close(); obj.conn = null; }
            if (obj.ws != null) { obj.ws = null; }
            if (obj.retryTimer != null) { clearTimeout(obj.retryTimer); obj.retryTimer = null; }
            // Re-try connection
            if (obj.connectionState >= 1) { obj.connectionState = 1; if (obj.retryTimer == null) { obj.retryTimer = setTimeout(connect, getConnectRetryTime()); } }
        }

        // Get the next retry time in milliseconds
        function getConnectRetryTime() {
            if (obj.retryBackoff < 30000) { obj.retryBackoff += Math.floor((Math.random() * 3000) + 1000); }
            return obj.retryBackoff;
        }

        // Send a JSON message to the peer server
        obj.send = function (msg) {
            try {
                if (obj.ws == null || obj.conn == null || obj.connectionState != 15) { return; }
                if (typeof msg == 'object') { obj.conn.send(JSON.stringify(msg)); return; }
                if (typeof msg == 'string') { obj.conn.send(msg); return; }
            } catch (e) { }
        }

        // Process incoming peer server JSON data
        function processServerData(msg) {
            var str = msg.toString('utf8');
            if (str[0] == '{') {
                try { command = JSON.parse(str) } catch (e) { obj.parent.parent.debug(1, 'Unable to parse JSON (' + obj.remoteaddr + ').'); return; } // If the command can't be parsed, ignore it.
                if (command.action == 'info') {
                    if (obj.authenticated != 3) {
                        // We get the peer's serverid and database identifier.
                        if ((command.serverid != null) && (command.dbid != null)) {
                            if (command.serverid == obj.parent.serverid) { console.log('ERROR: Same server ID, trying to peer with self. (' + obj.url + ', ' + command.serverid + ').'); return; }
                            if (command.dbid != obj.parent.parent.db.identifier) { console.log('ERROR: Database ID mismatch. Trying to peer to a server with the wrong database. (' + obj.url + ', ' + command.serverid + ').'); return; }
                            if (obj.serverCertHash != command.serverCertHash) { console.log('ERROR: Outer certificate hash mismatch. (' + obj.url + ', ' + command.serverid + ').'); return; }
                            obj.peerServerId = command.serverid;
                            obj.peerServerKey = command.key;
                            obj.authenticated = 3;
                            obj.parent.SetupPeerServer(obj, obj.peerServerId);
                        }
                    }
                } else if (obj.authenticated == 3) {
                    // Pass the message to the parent object for processing.
                    obj.parent.ProcessPeerServerMessage(obj, obj.peerServerId, command);
                }
            }
        }

        connect();
        return obj;
    }

    // Create a mesh server module that received a connection to another server
    obj.CreatePeerInServer = function (parent, ws, req) {
        var obj = {};
        obj.ws = ws;
        obj.parent = parent;
        obj.common = require('./common.js');
        obj.forge = require('node-forge');
        obj.crypto = require('crypto');
        obj.authenticated = 0;
        obj.remoteaddr = obj.ws._socket.remoteAddress;
        obj.receivedCommands = 0;
        obj.webCertificatHash = obj.parent.parent.webserver.webCertificatHash;
        obj.agentCertificatHashHex = obj.parent.parent.webserver.agentCertificatHashHex;
        obj.agentCertificatAsn1 = obj.parent.parent.webserver.agentCertificatAsn1;
        obj.infoSent = 0;
        obj.peerServerId = null;
        obj.serverCertHash = null;
        if (obj.remoteaddr.startsWith('::ffff:')) { obj.remoteaddr = obj.remoteaddr.substring(7); }

        // Send a message to the peer server
        obj.send = function (data) {
            try {
                if (typeof data == 'string') { obj.ws.send(new Buffer(data, 'binary')); return; }
                if (typeof data == 'object') { obj.ws.send(JSON.stringify(data)); return; }
                obj.ws.send(data);
            } catch (e) { }
        }

        // Disconnect this server
        obj.close = function (arg) {
            if ((arg == 1) || (arg == null)) { try { obj.ws.close(); obj.parent.parent.debug(1, 'InPeer: Soft disconnect ' + obj.peerServerId + ' (' + obj.remoteaddr + ')'); } catch (e) { console.log(e); } } // Soft close, close the websocket
            if (arg == 2) { try { obj.ws._socket._parent.end(); obj.parent.parent.debug(1, 'InPeer: Hard disconnect ' + obj.peerServerId + ' (' + obj.remoteaddr + ')'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
            if (obj.authenticated == 3) { obj.parent.ClearPeerServer(obj, obj.peerServerId); obj.authenticated = 0; }
        }

        // When data is received from the mesh agent web socket
        ws.on('message', function (msg) {
            if (msg.type == 'binary') { var msg2 = ""; for (var i = 0; i < msg.binaryData.length; i++) { msg2 += String.fromCharCode(msg.binaryData[i]); } msg = msg2; }
            else if (msg.type == 'utf8') { msg = msg.utf8Data; }
            if (msg.length < 2) return;

            if (obj.authenticated >= 2) { // We are authenticated
                if (msg.charCodeAt(0) == 123) { processServerData(msg); }
                if (msg.length < 2) return;
                var cmdid = obj.common.ReadShort(msg, 0);
                // Process binary commands (if any). None right now.
            }
            else if (obj.authenticated < 2) { // We are not authenticated
                var cmd = obj.common.ReadShort(msg, 0);
                if (cmd == 1) {
                    // Agent authentication request
                    if ((msg.length != 66) || ((obj.receivedCommands & 1) != 0)) return;
                    obj.receivedCommands += 1; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                    // Check that the server hash matches out own web certificate hash
                    if (obj.webCertificatHash != msg.substring(2, 34)) { obj.close(); return; }

                    // Use our server private key to sign the ServerHash + AgentNonce + ServerNonce
                    var privateKey = obj.forge.pki.privateKeyFromPem(obj.parent.parent.certificates.agent.key);
                    var md = obj.forge.md.sha256.create();
                    md.update(msg.substring(2), 'binary');
                    md.update(obj.nonce, 'binary');
                    obj.agentnonce = msg.substring(34);

                    // Send back our certificate + signature
                    obj.send(obj.common.ShortToStr(2) + obj.common.ShortToStr(obj.agentCertificatAsn1.length) + obj.agentCertificatAsn1 + privateKey.sign(md)); // Command 2, certificate + signature

                    // Check the agent signature if we can
                    if (obj.unauthsign != null) {
                        if (processAgentSignature(obj.unauthsign) == false) { disconnect(); return; } else { completePeerServerConnection(); }
                    }
                }
                else if (cmd == 2) {
                    // Agent certificate
                    if ((msg.length < 4) || ((obj.receivedCommands & 2) != 0)) return;
                    obj.receivedCommands += 2; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                    // Decode the certificate
                    var certlen = obj.common.ReadShort(msg, 2);
                    obj.unauth = {};
                    obj.unauth.nodeCert = null;
                    try { obj.unauth.nodeCert = obj.forge.pki.certificateFromAsn1(obj.forge.asn1.fromDer(msg.substring(4, 4 + certlen))); } catch (e) { return; }
                    obj.unauth.nodeid = obj.forge.pki.getPublicKeyFingerprint(obj.unauth.nodeCert.publicKey, { encoding: 'hex', md: obj.forge.md.sha256.create() });

                    // Check the agent signature if we can
                    if (obj.agentnonce == null) { obj.unauthsign = msg.substring(4 + certlen); } else { if (processAgentSignature(msg.substring(4 + certlen)) == false) { disconnect(); return; } }
                    completePeerServerConnection();
                }
                else if (cmd == 3) {
                    // Agent meshid
                    if ((msg.length < 56) || ((obj.receivedCommands & 4) != 0)) return;
                    obj.receivedCommands += 4; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.
                    completePeerServerConnection();
                }
            }
        });

        // If error, do nothing
        ws.on('error', function (err) { obj.parent.parent.debug(1, 'InPeer: Connection Error: ' + err); });

        // If the mesh agent web socket is closed, clean up.
        ws.on('close', function (req) { obj.parent.parent.debug(1, 'InPeer disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); obj.close(0); });
        // obj.ws._socket._parent.on('close', function (req) { obj.parent.parent.debug(1, 'Agent TCP disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); });

        // Start authenticate the mesh agent by sending a auth nonce & server TLS cert hash.
        // Send 256 bits SHA256 hash of TLS cert public key + 256 bits nonce
        obj.nonce = obj.forge.random.getBytesSync(32);
        obj.send(obj.common.ShortToStr(1) + obj.webCertificatHash + obj.nonce); // Command 1, hash + nonce

        // Once we get all the information about an agent, run this to hook everything up to the server
        function completePeerServerConnection() {
            if (obj.authenticated != 1) return;
            obj.send(obj.common.ShortToStr(4));
            obj.send(JSON.stringify({ action: 'info', serverid: obj.parent.serverid, dbid: obj.parent.parent.db.identifier, key: obj.parent.serverKey, serverCertHash: obj.parent.parent.webserver.webCertificatHashHex }));
            obj.authenticated = 2;
        }

        // Verify the agent signature
        function processAgentSignature(msg) {
            var md = obj.forge.md.sha256.create(); // TODO: Switch this to SHA256 on node instead of forge.
            md.update(obj.parent.parent.webserver.webCertificatHash, 'binary');
            md.update(obj.nonce, 'binary');
            md.update(obj.agentnonce, 'binary');
            if (obj.unauth.nodeCert.publicKey.verify(md.digest().bytes(), msg) == false) { return false; }
            if (obj.unauth.nodeid !== obj.agentCertificatHashHex) { return false; }

            // Connection is a success, clean up
            obj.nodeid = obj.unauth.nodeid.toUpperCase();
            delete obj.nonce;
            delete obj.agentnonce;
            delete obj.unauth;
            if (obj.unauthsign) delete obj.unauthsign;
            obj.authenticated = 1;
            return true;
        }

        // Process incoming peer server JSON data
        function processServerData(msg) {
            var str = msg.toString('utf8');
            if (str[0] == '{') {
                try { command = JSON.parse(str) } catch (e) { obj.parent.parent.debug(1, 'Unable to parse JSON (' + obj.remoteaddr + ').'); return; } // If the command can't be parsed, ignore it.
                if (command.action == 'info') {
                    if (obj.authenticated != 3) {
                        // We get the peer's serverid and database identifier.
                        if ((command.serverid != null) && (command.dbid != null)) {
                            if (command.serverid == obj.parent.serverid) { console.log('ERROR: Same server ID, trying to peer with self. (' + obj.remoteaddr + ', ' + command.serverid + ').'); return; }
                            if (command.dbid != obj.parent.parent.db.identifier) { console.log('ERROR: Database ID mismatch. Trying to peer to a server with the wrong database. (' + obj.remoteaddr + ', ' + command.serverid + ').'); return; }
                            if (obj.parent.peerConfig.servers[command.serverid] == null) { console.log('ERROR: Unknown peer serverid: ' + command.serverid + ' (' + obj.remoteaddr + ').'); return; }
                            obj.peerServerId = command.serverid;
                            obj.peerServerKey = command.key;
                            obj.serverCertHash = command.serverCertHash;
                            obj.authenticated = 3;
                            obj.parent.SetupPeerServer(obj, obj.peerServerId);
                        }
                    }
                } else if (obj.authenticated == 3) {
                    // Pass the message to the parent object for processing.
                    obj.parent.ProcessPeerServerMessage(obj, obj.peerServerId, command);
                }
            }
        }

        return obj;
    }

    // If we have no peering configuration, don't setup this object
    if (obj.peerConfig == null) { return null; }
    obj.serverid = obj.parent.config.peers.serverId;
    if (obj.serverid == null) { obj.serverid = require("os").hostname(); }
    if (obj.parent.config.peers.servers[obj.serverid] == null) { console.log("Error: Unable to peer with other servers, \"" + obj.serverid + "\" not present in peer servers list."); return null; }

    // Generate a cryptographic key used to encode and decode cookies
    obj.generateCookieKey = function () {
        return new Buffer(obj.crypto.randomBytes(32), 'binary').toString('hex');
    }

    // Return the private key of a peer server
    obj.getServerCookieKey = function (serverid) {
        var server = obj.peerServers[serverid];
        if (server && server.peerServerKey) return server.peerServerKey;
        return null;
    }

    // Encode an object as a cookie using a key
    obj.encodeCookie = function (o, key) {
        try {
            if (key == null) { key = obj.serverKey; }
            key = require('./common.js').hex2rstr(key);
            o.time = Math.floor(Date.now() / 1000); // Add the cookie creation time
            var msg = JSON.stringify(o);
            msg = obj.crypto.createHmac('sha256', key.substring(16)).update(msg, 'binary', 'binary').digest('binary') + msg;
            var iv = new Buffer(obj.crypto.randomBytes(16), 'binary');
            var cipher = obj.crypto.createCipheriv('aes-128-cbc', new Buffer(key.substring(0, 16), 'binary'), iv);
            crypted = cipher.update(msg, 'binary', 'binary');
            crypted += cipher.final('binary');
            var total = new Buffer(iv, 'binary').toString('hex') + new Buffer(crypted, 'binary').toString('hex'); // HEX: This is not an efficient concat, but it's very compatible.
            var cookie = new Buffer(total, 'hex').toString('base64');
            return cookie.replace(/\+/g, '@').replace(/\//g, '$');
        } catch (e) { return null; }
    }

    // Decode a cookie back into an object using a key. Return null if it's not a valid cookie.
    obj.decodeCookie = function (cookie, key) {
        try {
            if (key == null) { key = obj.serverKey; }
            key = require('./common.js').hex2rstr(key);
            cookie = new Buffer(cookie.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex'); // HEX: This is not an efficient split, but it's very compatible.
            var iv = new Buffer(cookie.substring(0, 32), 'hex');
            var msg = new Buffer(cookie.substring(32), 'hex');
            var decipher = obj.crypto.createDecipheriv('aes-128-cbc', new Buffer(key.substring(0, 16), 'binary'), iv)
            var dec = decipher.update(msg, 'binary', 'binary')
            dec += decipher.final('binary');
            var msg = dec.substring(32);
            var hash1 = dec.substring(0, 32);
            var hash2 = obj.crypto.createHmac('sha256', key.substring(16)).update(msg, 'binary', 'binary').digest('binary');
            if (hash1 !== hash2) { return null; }
            var o = JSON.parse(msg);
            if ((o.time == null) || (o.time == null) || (typeof o.time != 'number')) { return null; }
            o.time = o.time * 1000; // Decode the cookie creation time
            o.dtime = Date.now() - o.time; // Decode how long ago the cookie was created
            return o;
        } catch (e) { return null; }
    }

    // Dispatch an event to all other MeshCentral2 peer servers
    obj.DispatchEvent = function (ids, source, event) {
        var busmsg = JSON.stringify({ action: 'bus', ids: ids, event: event });
        for (var serverid in obj.peerServers) { obj.peerServers[serverid].send(busmsg); }
    }

    // Dispatch a message to other MeshCentral2 peer servers
    obj.DispatchMessage = function (msg) {
        for (var serverid in obj.peerServers) { obj.peerServers[serverid].send(msg); }
    }

    // Dispatch a message to other MeshCentral2 peer servers
    obj.DispatchMessageSingleServer = function (msg, serverid) {
        var server = obj.peerServers[serverid];
        if (server != null) { server.send(msg); }
    }

    // Attempt to connect to all peers
    obj.ConnectToPeers = function () {
        for (serverId in obj.peerConfig.servers) {
            // We will only connect to names that are larger then ours. This way, eveyone has one connection to everyone else (no cross-connections).
            if ((serverId > obj.serverid) && (obj.peerConfig.servers[serverId].url != null) && (obj.outPeerServers[serverId] == null)) {
                obj.outPeerServers[serverId] = obj.CreatePeerOutServer(obj, serverId, obj.peerConfig.servers[serverId].url);
            }
        }
    }

    // We connected to a peer server, setup everything
    obj.SetupPeerServer = function (server, peerServerId) {
        console.log('Connected to peer server ' + peerServerId + '.');
        obj.peerServers[peerServerId] = server;

        // Send the list of connections to the peer
        server.send(JSON.stringify({ action: 'connectivityTable', connectivityTable: obj.parent.peerConnectivityByNode[obj.parent.serverId] }));

        // Send a list of user sessions to the peer
        server.send(JSON.stringify({ action: 'sessionsTable', sessionsTable: Object.keys(obj.parent.webserver.wssessions2) }));
    }

    // We disconnected to a peer server, clean up everything
    obj.ClearPeerServer = function (server, peerServerId) {
        console.log('Disconnected from peer server ' + peerServerId + '.');

        // Clean up the connectivity state
        delete obj.peerServers[peerServerId];
        var oldList = obj.parent.peerConnectivityByNode[peerServerId];
        obj.parent.peerConnectivityByNode[peerServerId] = {};
        obj.parent.UpdateConnectivityState(oldList);

        // Clean up the sessions list
        for (var i in obj.parent.webserver.wsPeerSessions[peerServerId]) { delete obj.parent.webserver.wsPeerSessions2[obj.parent.webserver.wsPeerSessions[peerServerId][i]]; }
        delete obj.parent.webserver.wsPeerSessions[peerServerId];
        delete obj.parent.webserver.wsPeerSessions3[peerServerId];
        obj.parent.webserver.recountSessions(); // Recount all sessions
    }

    // Process a message coming from a peer server
    obj.ProcessPeerServerMessage = function (server, peerServerId, msg) {
        //console.log('ProcessPeerServerMessage', peerServerId, msg);
        switch (msg.action) {
            case 'bus': {
                obj.parent.DispatchEvent(msg.ids, null, msg.event, true); // Dispatch the peer event
                break;
            }
            case 'connectivityTable': {
                obj.parent.peerConnectivityByNode[peerServerId] = msg.connectivityTable;
                obj.parent.UpdateConnectivityState(msg.connectivityTable);
                break;
            }
            case 'sessionsTable': {
                obj.parent.webserver.wsPeerSessions[peerServerId] = msg.sessionsTable;
                var userToSession = {};
                for (var i in msg.sessionsTable) {
                    var sessionid = msg.sessionsTable[i];
                    obj.parent.webserver.wsPeerSessions2[sessionid] = peerServerId;
                    var userid = sessionid.split('/').slice(0, 3).join('/'); // Take the sessionid and keep only the userid partion
                    if (userToSession[userid] == null) { userToSession[userid] = [sessionid]; } else { userToSession[userid].push(sessionid); } // UserId -> [ SessionId ]
                }
                obj.parent.webserver.wsPeerSessions3[peerServerId] = userToSession; // ServerId --> UserId --> SessionId
                obj.parent.webserver.recountSessions(); // Recount all sessions
                break;
            }
            case 'sessionStart': {
                obj.parent.webserver.wsPeerSessions[peerServerId].push(msg.sessionid);
                obj.parent.webserver.wsPeerSessions2[msg.sessionid] = peerServerId;
                var userid = msg.sessionid.split('/').slice(0, 3).join('/');
                if (obj.parent.webserver.wsPeerSessions3[peerServerId] == null) { obj.parent.webserver.wsPeerSessions3[peerServerId] = {}; }
                if (obj.parent.webserver.wsPeerSessions3[peerServerId][userid] == null) { obj.parent.webserver.wsPeerSessions3[peerServerId][userid] = [ msg.sessionid ]; } else { obj.parent.webserver.wsPeerSessions3[peerServerId][userid].push(msg.sessionid); }
                obj.parent.webserver.recountSessions(msg.sessionid); // Recount a specific user
                break;
            }
            case 'sessionEnd': {
                var i = obj.parent.webserver.wsPeerSessions[peerServerId].indexOf(msg.sessionid);
                if (i >= 0) { obj.parent.webserver.wsPeerSessions[peerServerId].splice(i, 1); }
                delete obj.parent.webserver.wsPeerSessions2[msg.sessionid];
                var userid = msg.sessionid.split('/').slice(0, 3).join('/');
                if (obj.parent.webserver.wsPeerSessions3[peerServerId][userid] != null) {
                    i = obj.parent.webserver.wsPeerSessions3[peerServerId][userid].indexOf(msg.sessionid);
                    if (i >= 0) {
                        obj.parent.webserver.wsPeerSessions3[peerServerId][userid].splice(i, 1);
                        if (obj.parent.webserver.wsPeerSessions3[peerServerId][userid].length == 0) { delete obj.parent.webserver.wsPeerSessions3[peerServerId][userid]; }
                    }
                }
                obj.parent.webserver.recountSessions(msg.sessionid); // Recount a specific user
                break;
            }
            case 'SetConnectivityState': {
                obj.parent.SetConnectivityState(msg.meshid, msg.nodeid, msg.connectTime, msg.connectType, msg.powerState, peerServerId);
                break;
            }
            case 'ClearConnectivityState': {
                obj.parent.ClearConnectivityState(msg.meshid, msg.nodeid, msg.connectType, peerServerId);
                break;
            }
            case 'relay': {
                // Check if there is a waiting session
                var rsession = obj.parent.webserver.wsrelays[msg.id];
                if (rsession != null) {
                    // Yes, there is a waiting session, see if we must initiate.
                    if (peerServerId > obj.parent.serverId) {
                        // We must initiate the connection to the peer
                        var userid = null;
                        if (rsession.peer1.req.session != null) { userid = rsession.peer1.req.session.userid; }
                        obj.createPeerRelay(rsession.peer1.ws, rsession.peer1.req, peerServerId, userid);
                        delete obj.parent.webserver.wsrelays[msg.id];
                    }
                } else {
                    // Add this relay session to the peer relay list
                    obj.parent.webserver.wsPeerRelays[msg.id] = { serverId: peerServerId, time: Date.now() };

                    // Clear all relay sessions that are more than 1 minute
                    var oneMinuteAgo = Date.now() - 60000;
                    for (var id in obj.parent.webserver.wsPeerRelays) { if (obj.parent.webserver.wsPeerRelays[id].time < oneMinuteAgo) { delete obj.parent.webserver.wsPeerRelays[id]; } }
                }
                break;
            }
            case 'msg': {
                if (msg.sessionid != null) {
                    // Route this message to a connected user session
                    if (command.fromNodeid != null) { command.nodeid = command.fromNodeid; delete command.fromNodeid; }
                    var ws = obj.parent.webserver.wssessions2[command.sessionid];
                    if (ws != null) { ws.send(JSON.stringify(command)); }
                } else if (msg.nodeid != null) {
                    // Route this message to a connected agent
                    if (command.fromSessionid != null) { command.sessionid = command.fromSessionid; delete command.fromSessionid; }
                    var agent = obj.parent.webserver.wsagents[msg.nodeid];
                    if (agent != null) { delete msg.nodeid; agent.send(JSON.stringify(msg)); } // Remove the nodeid since it's implyed and send the message to the agent
                } else if (msg.meshid != null) {
                    // Route this message to all users of this mesh
                    if (command.fromNodeid != null) { command.nodeid = command.fromNodeid; delete command.fromNodeid; }
                    var cmdstr = JSON.stringify(command);
                    for (var userid in obj.parent.webserver.wssessions) { // Find all connected users for this mesh and send the message
                        var user = obj.parent.webserver.users[userid];
                        if (user) {
                            var rights = user.links[msg.meshid];
                            if (rights != null) { // TODO: Look at what rights are needed for message routing
                                var sessions = obj.parent.webserver.wssessions[userid];
                                // Send the message to all users on this server
                                for (var i in sessions) { sessions[i].send(cmdstr); }
                            }
                        }
                    }
                }
                break;
            }
        }
    }

    // Create a tunnel connection to a peer server
    obj.createPeerRelay = function (ws, req, serverid, user) {
        var server = obj.peerServers[serverid];
        if ((server == null) || (server.peerServerKey == null)) { return null; }
        var cookieKey = server.peerServerKey;

        // Parse the user if needed
        if (typeof user == 'string') { user = { _id: user, domain: user.split('/')[1] }; }

        // Build the connection URL
        var path = req.path;
        if (path[0] == '/') path = path.substring(1);
        if (path.substring(path.length - 11) == '/.websocket') { path = path.substring(0, path.length - 11); }
        var queryStr = ''
        for (var i in req.query) { queryStr += ((queryStr == '') ? '?' : '&') + i + '=' + req.query[i]; }
        if (user != null) { queryStr += ((queryStr == '') ? '?' : '&') + 'auth=' + obj.encodeCookie({ userid: user._id, domainid: user.domain }, cookieKey); }
        var url = obj.peerConfig.servers[serverid].url + path + queryStr;

        // Setup an connect the web socket
        var tunnel = obj.createPeerRelayEx(ws, url, serverid);
        tunnel.connect();
    }

    // Create a tunnel connection to a peer server
    // We assume that "ws" is paused already.
    obj.createPeerRelayEx = function (ws, url, serverid) {
        var peerTunnel = { parent: obj, ws1: ws, ws2: null, url: url, serverid: serverid };

        peerTunnel.connect = function () {
            // Get the web socket setup
            var WebSocketClient = require('websocket').client;
            peerTunnel.wsclient = new WebSocketClient();

            // Register the connection failed event
            peerTunnel.wsclient.on('connectFailed', function (error) { peerTunnel.parent.parent.debug(1, 'FTunnel ' + obj.serverid + ': Failed connection'); peerTunnel.ws1.close(); });

            // Register the connection event
            peerTunnel.wsclient.on('connect', function (connection) {
                // Get the peer server's certificate and compute the server public key hash
                var rawcertbuf = connection.socket.getPeerCertificate().raw, rawcert = '';
                for (var i = 0; i < rawcertbuf.length; i++) { rawcert += String.fromCharCode(rawcertbuf[i]); }
                var serverCert = obj.forge.pki.certificateFromAsn1(obj.forge.asn1.fromDer(rawcert));
                var serverCertHashHex = obj.forge.pki.getPublicKeyFingerprint(serverCert.publicKey, { encoding: 'hex', md: obj.forge.md.sha256.create() });

                // Check if the peer certificate is the expected one for this serverid
                if (obj.peerServers[serverid] == null || obj.peerServers[serverid].serverCertHash != serverCertHashHex) { console.log('ERROR: Outer certificate hash mismatch. (' + peerTunnel.url + ', ' + peerTunnel.serverid + ').'); peerTunnel.ws1.close(); return; }

                // Connection accepted.
                peerTunnel.ws2 = connection;

                // If error, do nothing
                peerTunnel.ws2.on('error', function (err) { peerTunnel.parent.parent.debug(1, 'FTunnel: Connection Error: ' + err); peerTunnel.close(); });

                // If the mesh agent web socket is closed, clean up.
                peerTunnel.ws2.on('close', function (req) { peerTunnel.parent.parent.debug(1, 'FTunnel disconnect ' + peerTunnel.nodeid); peerTunnel.close(); });

                // If a message is received from the peer, Peer ---> Browser
                peerTunnel.ws2.on('message', function (msg) {
                    try {
                        if (msg.type == 'utf8') { peerTunnel.ws2.pause(); peerTunnel.ws1.send(msg.utf8Data, function () { peerTunnel.ws2.resume(); }); }
                        else if (msg.type == 'binary') { peerTunnel.ws2.pause(); peerTunnel.ws1.send(msg.binaryData, function () { peerTunnel.ws2.resume(); }); }
                    } catch (e) { }
                });

                // Resume the web socket to start the data flow
                peerTunnel.ws1.resume();
            });

            // If a message is received from the browser, Browser ---> Peer
            peerTunnel.ws1.on('message', function (msg) { try { peerTunnel.ws1.pause(); peerTunnel.ws2.send(msg, function () { peerTunnel.ws1.resume(); }); } catch (e) { } });

            // If error, do nothing
            peerTunnel.ws1.on('error', function (err) { console.log(err); peerTunnel.close(); });

            // If the web socket is closed, close the associated TCP connection.
            peerTunnel.ws1.on('close', function (req) { peerTunnel.parent.parent.debug(1, 'FTunnel disconnect ' + peerTunnel.nodeid); peerTunnel.close(); });

            peerTunnel.wsclient.connect(peerTunnel.url, null, null, null, { rejectUnauthorized: false });
        }

        // Disconnect both sides of the tunnel
        peerTunnel.close = function (arg) {
            if (arg == 2) {
                // Hard close, close the TCP socket
                if (peerTunnel.ws1 != null) { try { peerTunnel.ws1._socket._parent.end(); peerTunnel.parent.parent.debug(1, 'FTunnel1: Hard disconnect'); } catch (e) { console.log(e); } }
                if (peerTunnel.ws2 != null) { try { peerTunnel.ws2._socket._parent.end(); peerTunnel.parent.parent.debug(1, 'FTunnel2: Hard disconnect'); } catch (e) { console.log(e); } }
            } else {
                // Soft close, close the websocket
                if (peerTunnel.ws1 != null) { try { peerTunnel.ws1.close(); peerTunnel.parent.parent.debug(1, 'FTunnel1: Soft disconnect '); } catch (e) { console.log(e); } }
                if (peerTunnel.ws2 != null) { try { peerTunnel.ws2.close(); peerTunnel.parent.parent.debug(1, 'FTunnel2: Soft disconnect '); } catch (e) { console.log(e); } }
            }
        }

        return peerTunnel;
    }

    obj.serverKey = obj.generateCookieKey();
    setTimeout(function () { obj.ConnectToPeers(); }, 1000); // Delay this a little to make sure we are ready on our side.
    return obj;
}
