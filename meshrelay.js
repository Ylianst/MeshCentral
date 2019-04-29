/**
* @description MeshCentral connection relay module
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

module.exports.CreateMeshRelay = function (parent, ws, req, domain, user, cookie) {
    var obj = {};
    obj.ws = ws;
    obj.id = req.query.id;

    // Relay session count (we may remove this in the future)
    obj.relaySessionCounted = true;
    parent.relaySessionCount++;

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 1;
    const MESHRIGHT_MANAGEUSERS = 2;
    const MESHRIGHT_MANAGECOMPUTERS = 4;
    const MESHRIGHT_REMOTECONTROL = 8;
    const MESHRIGHT_AGENTCONSOLE = 16;
    const MESHRIGHT_SERVERFILES = 32;
    const MESHRIGHT_WAKEDEVICE = 64;
    const MESHRIGHT_SETNOTES = 128;
    const MESHRIGHT_REMOTEVIEW = 256;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 1;
    const SITERIGHT_MANAGEUSERS = 2;
    const SITERIGHT_SERVERRESTORE = 4;
    const SITERIGHT_FILEACCESS = 8;
    const SITERIGHT_SERVERUPDATE = 16;
    const SITERIGHT_LOCKED = 32;

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (addr.startsWith('::ffff:')) { return addr.substring(7); } else { return addr; } }

    // Disconnect this agent
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug(1, 'Relay: Soft disconnect (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug(1, 'Relay: Hard disconnect (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.peer;
    };

    obj.sendAgentMessage = function (command, userid, domainid) {
        var rights, mesh;
        if (command.nodeid == null) return false;
        var user = parent.users[userid];
        if (user == null) return false;
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domainid)) {
            // Get the user object
            // See if the node is connected
            var agent = parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                rights = user.links[agent.dbMeshKey];
                mesh = parent.meshes[agent.dbMeshKey];
                if ((rights != null) && (mesh != null) || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                    command.sessionid = ws.sessionId;   // Set the session id, required for responses.
                    command.rights = rights.rights;     // Add user rights flags to the message
                    command.consent = mesh.consent;     // Add user consent
                    if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                    command.username = user.name;       // Add user name
                    delete command.nodeid;              // Remove the nodeid since it's implyed.
                    agent.send(JSON.stringify(command));
                    return true;
                }
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerId(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    rights = user.links[routing.meshid];
                    mesh = parent.meshes[routing.meshid];
                    if (rights != null || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                        command.fromSessionid = ws.sessionId;   // Set the session id, required for responses.
                        command.rights = rights.rights;         // Add user rights flags to the message
                        command.consent = mesh.consent;         // Add user consent
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        command.username = user.name;           // Add user name
                        parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        return true;
                    }
                }
            }
        }
        return false;
    };
    
    function performRelay() {
        if (obj.id == null) { try { obj.close(); } catch (e) { } return null; } // Attempt to connect without id, drop this.
        ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive

        // If this is a MeshMessenger session, the ID is the two userid's and authentication must match one of them.
        if (obj.id.startsWith('meshmessenger/')) {
            if ((obj.id.startsWith('meshmessenger/user/') == true) && (user == null)) { try { obj.close(); } catch (e) { } return null; } // If user-to-user, both sides need to be authenticated.
            var x = obj.id.split('/'), user1 = x[1] + '/' + x[2] + '/' + x[3], user2 = x[4] + '/' + x[5] + '/' + x[6];
            if ((x[1] != 'user') && (x[4] != 'user')) { try { obj.close(); } catch (e) { } return null; } // MeshMessenger session must have at least one authenticated user
            if ((x[1] == 'user') && (x[4] == 'user')) {
                // If this is a user-to-user session, you must be authenticated to join.
                if ((user._id != user1) && (user._id != user2)) { try { obj.close(); } catch (e) { } return null; }
            } else {
                // If only one side of the session is a user
                // !!!!! TODO: Need to make sure that one of the two sides is the correct user. !!!!!
            }
        }

        // Validate that the id is valid, we only need to do this on non-authenticated sessions.
        // TODO: Figure out when this needs to be done.
        /*
        if (!parent.args.notls) {
            // Check the identifier, if running without TLS, skip this.
            var ids = obj.id.split(':');
            if (ids.length != 3) { ws.close(); delete obj.id; return null; } // Invalid ID, drop this.
            if (parent.crypto.createHmac('SHA384', parent.relayRandom).update(ids[0] + ':' + ids[1]).digest('hex') != ids[2]) { ws.close(); delete obj.id; return null; } // Invalid HMAC, drop this.
            if ((Date.now() - parseInt(ids[1])) > 120000) { ws.close(); delete obj.id; return null; } // Expired time, drop this.
            obj.id = ids[0];
        }
        */

        // Check the peer connection status
        {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo) {
                if (relayinfo.state == 1) {
                    // Check that at least one connection is authenticated
                    if ((obj.authenticated != true) && (relayinfo.peer1.authenticated != true)) {
                        ws.close();
                        parent.parent.debug(1, 'Relay without-auth: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')');
                        delete obj.id;
                        delete obj.ws;
                        delete obj.peer;
                        return null;
                    }

                    // Connect to peer
                    obj.peer = relayinfo.peer1;
                    obj.peer.peer = obj;
                    relayinfo.peer2 = obj;
                    relayinfo.state = 2;
                    ws.send('c'); // Send connect to both peers
                    relayinfo.peer1.ws.send('c');
                    relayinfo.peer1.ws._socket.resume(); // Release the traffic
                    relayinfo.peer2.ws._socket.resume(); // Release the traffic

                    relayinfo.peer1.ws.peer = relayinfo.peer2.ws;
                    relayinfo.peer2.ws.peer = relayinfo.peer1.ws;

                    parent.parent.debug(1, 'Relay connected: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ' --> ' + cleanRemoteAddr(obj.peer.ws._socket.remoteAddress) + ')');
                } else {
                    // Connected already, drop (TODO: maybe we should re-connect?)
                    ws.close();
                    parent.parent.debug(1, 'Relay duplicate: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')');
                    delete obj.id;
                    delete obj.ws;
                    delete obj.peer;
                    return null;
                }
            } else {
                // Wait for other relay connection
                ws._socket.pause(); // Hold traffic until the other connection
                parent.wsrelays[obj.id] = { peer1: obj, state: 1 };
                parent.parent.debug(1, 'Relay holding: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ') ' + (obj.authenticated ? 'Authenticated' : ''));

                // Check if a peer server has this connection
                if (parent.parent.multiServer != null) {
                    var rsession = parent.wsPeerRelays[obj.id];
                    if ((rsession != null) && (rsession.serverId > parent.parent.serverId)) {
                        // We must initiate the connection to the peer
                        parent.parent.multiServer.createPeerRelay(ws, req, rsession.serverId, req.session.userid);
                        delete parent.wsrelays[obj.id];
                    } else {
                        // Send message to other peers that we have this connection
                        parent.parent.multiServer.DispatchMessage(JSON.stringify({ action: 'relay', id: obj.id }));
                    }
                }
            }
        }
    }

    ws.flushSink = function () { try { ws._socket.resume(); } catch (ex) { console.log(ex); } };

    // When data is received from the mesh relay web socket
    ws.on('message', function (data) {
        //console.log(typeof data, data.length);
        if (this.peer != null) {
            //if (typeof data == 'string') { console.log('Relay: ' + data); } else { console.log('Relay:' + data.length + ' byte(s)'); }
            try {
                this._socket.pause();
                this.peer.send(data, ws.flushSink);
            } catch (ex) { console.log(ex); }
        }
    });

    // If error, close both sides of the relay.
    ws.on('error', function (err) {
        parent.relaySessionErrorCount++;
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }
        console.log('Relay error from ' + cleanRemoteAddr(ws._socket.remoteAddress) + ', ' + err.toString().split('\r')[0] + '.');
        closeBothSides();
    });

    // If the relay web socket is closed, close both sides.
    ws.on('close', function (req) {
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }
        closeBothSides();
    });

    // Close both our side and the peer side.
    function closeBothSides() {
        if (obj.id != null) {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo != null) {
                if (relayinfo.state == 2) {
                    // Disconnect the peer
                    var peer = (relayinfo.peer1 == obj) ? relayinfo.peer2 : relayinfo.peer1;
                    try { if (peer.relaySessionCounted) { parent.relaySessionCount--; delete peer.relaySessionCounted; } } catch (ex) { console.log(ex); }
                    parent.parent.debug(1, 'Relay disconnect: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ' --> ' + cleanRemoteAddr(peer.ws._socket.remoteAddress) + ')');
                    try { peer.ws.close(); } catch (e) { } // Soft disconnect
                    try { peer.ws._socket._parent.end(); } catch (e) { } // Hard disconnect

                    // Aggressive peer cleanup
                    delete peer.id;
                    delete peer.ws;
                    delete peer.peer;
                } else {
                    parent.parent.debug(1, 'Relay disconnect: ' + obj.id + ' (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')');
                }
                delete parent.wsrelays[obj.id];
            }
        }

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.peer;
    }

    // Mark this relay session as authenticated if this is the user end.
    obj.authenticated = (user != null);
    if (obj.authenticated) {
        // Kick off the routing, if we have agent routing instructions, process them here.
        // Routing instructions can only be given by a authenticated user
        if ((cookie != null) && (cookie.nodeid != null) && (cookie.tcpport != null) && (cookie.domainid != null)) {
            // We have routing instructions in the cookie, but first, check user access for this node.
            parent.db.Get(cookie.nodeid, function (err, docs) {
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                var node = docs[0];

                // Check if this user has permission to manage this computer
                var meshlinks = user.links[node.meshid];
                if ((!meshlinks) || (!meshlinks.rights) || ((meshlinks.rights & MESHRIGHT_REMOTECONTROL) == 0)) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Send connection request to agent
                if (obj.id == undefined) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                var command = { nodeid: cookie.nodeid, action: 'msg', type: 'tunnel', value: '*/meshrelay.ashx?id=' + obj.id, tcpport: cookie.tcpport, tcpaddr: cookie.tcpaddr };
                parent.parent.debug(1, 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user._id, cookie.domainid) == false) { delete obj.id; parent.parent.debug(1, 'Relay: Unable to contact this agent (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')'); }
                performRelay();
            });
            return obj;
        } else if ((req.query.nodeid != null) && (req.query.tcpport != null)) {
            // We have routing instructions in the URL arguments, but first, check user access for this node.
            parent.db.Get(req.query.nodeid, function (err, docs) {
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                var node = docs[0];

                // Check if this user has permission to manage this computer
                var meshlinks = user.links[node.meshid];
                if ((!meshlinks) || (!meshlinks.rights) || ((meshlinks.rights & MESHRIGHT_REMOTECONTROL) == 0)) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Send connection request to agent
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                var command = { nodeid: req.query.nodeid, action: 'msg', type: 'tunnel', value: '*/meshrelay.ashx?id=' + obj.id, tcpport: req.query.tcpport, tcpaddr: ((req.query.tcpaddr == null) ? '127.0.0.1' : req.query.tcpaddr) };
                parent.parent.debug(1, 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug(1, 'Relay: Unable to contact this agent (' + cleanRemoteAddr(ws._socket.remoteAddress) + ')'); }
                performRelay();
            });
            return obj;
        }
    }

    // If this is not an authenticated session, or the session does not have routing instructions, just go ahead an connect to existing session.
    performRelay();
    return obj;
};
