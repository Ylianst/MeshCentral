/**
* @description MeshCentral device file download relay module
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
"use strict";

module.exports.CreateMeshDeviceFile = function (parent, ws, res, req, domain, user, meshid, nodeid) {
    var obj = {};
    obj.ws = ws;
    obj.res = res;
    obj.user = user;
    obj.ruserid = null;
    obj.req = req; // Used in multi-server.js
    obj.id = req.query.id;
    obj.file = req.query.f;

    // Check relay authentication
    if ((user == null) && (obj.req.query != null) && (obj.req.query.rauth != null)) {
        const rcookie = parent.parent.decodeCookie(obj.req.query.rauth, parent.parent.loginCookieEncryptionKey, 240); // Cookie with 4 hour timeout
        if (rcookie.ruserid != null) { obj.ruserid = rcookie.ruserid; }
    }

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

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws != null) {
            if ((arg == 1) || (arg == null)) { try { obj.ws.close(); parent.parent.debug('relay', 'FileRelay: Soft disconnect (' + obj.req.clientIp + ')'); } catch (ex) { console.log(e); } } // Soft close, close the websocket
            if (arg == 2) { try { obj.ws._socket._parent.end(); parent.parent.debug('relay', 'FileRelay: Hard disconnect (' + obj.req.clientIp + ')'); } catch (ex) { console.log(e); } } // Hard close, close the TCP socket
        } else if (obj.res != null) {
            try { res.sendStatus(404); } catch (ex) { }
        }

        // Aggressive cleanup
        delete obj.ws;
        delete obj.res;
        delete obj.peer;
    };

    // If there is no authentication, drop this connection
    if ((obj.id == null) || ((obj.user == null) && (obj.ruserid == null))) { try { obj.close(); parent.parent.debug('relay', 'FileRelay: Connection with no authentication (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } return; }

    obj.sendAgentMessage = function (command, user, domainid) {
        var rights, mesh;
        if (command.nodeid == null) return false;
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domainid)) {
            // Get the user object
            // See if the node is connected
            var agent = parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                rights = parent.GetNodeRights(user, agent.dbMeshKey, agent.dbNodeKey);
                mesh = parent.meshes[agent.dbMeshKey];
                if ((rights != null) && (mesh != null) || ((rights & MESHRIGHT_REMOTECONTROL) != 0)) { // 8 is device remote control
                    command.rights = rights;                    // Add user rights flags to the message
                    if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                    if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                    command.username = user.name;               // Add user name
                    command.realname = user.realname;           // Add real name
                    if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                    delete command.nodeid;                      // Remove the nodeid since it's implyed.
                    agent.send(JSON.stringify(command));
                    return true;
                }
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerIdNotSelf(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    rights = parent.GetNodeRights(user, routing.meshid, command.nodeid);
                    mesh = parent.meshes[routing.meshid];
                    if (rights != null || ((rights & MESHRIGHT_REMOTECONTROL) != 0)) { // 8 is device remote control
                        command.rights = rights;                // Add user rights flags to the message
                        if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        command.username = user.name;           // Add user name
                        command.realname = user.realname;       // Add real name
                        if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                        parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        return true;
                    }
                }
            }
        }
        return false;
    };

    function performRelay() {
        if (obj.id == null) { try { obj.close(); } catch (e) { } return; } // Attempt to connect without id, drop this.
        if (obj.ws != null) { obj.ws._socket.setKeepAlive(true, 240000); } // Set TCP keep alive

        // Check the peer connection status
        {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo) {
                if (relayinfo.state == 1) {

                    // Check that at least one connection is authenticated
                    if ((obj.authenticated != true) && (relayinfo.peer1.authenticated != true)) {
                        if (ws) { ws.close(); }
                        parent.parent.debug('relay', 'FileRelay without-auth: ' + obj.id + ' (' + obj.req.clientIp + ')');
                        delete obj.id;
                        delete obj.ws;
                        delete obj.peer;
                        return;
                    }

                    // Connect to peer
                    obj.peer = relayinfo.peer1;
                    obj.peer.peer = obj;
                    relayinfo.peer2 = obj;
                    relayinfo.state = 2;

                    // Remove the timeout
                    if (relayinfo.timeout) { clearTimeout(relayinfo.timeout); delete relayinfo.timeout; }

                    var agentws = null, file = null;
                    if (relayinfo.peer1.ws) { relayinfo.peer1.ws.res = relayinfo.peer2.res; relayinfo.peer1.ws.res = relayinfo.peer2.res; relayinfo.peer1.ws.file = relayinfo.peer2.file; agentws = relayinfo.peer1.ws; file = relayinfo.peer2.file; }
                    if (relayinfo.peer2.ws) { relayinfo.peer2.ws.res = relayinfo.peer1.res; relayinfo.peer2.ws.res = relayinfo.peer1.res; relayinfo.peer2.ws.file = relayinfo.peer1.file; agentws = relayinfo.peer2.ws; file = relayinfo.peer1.file; }
                    agentws._socket.resume(); // Release the traffic
                    try { agentws.send('c'); } catch (ex) { } // Send connect to agent
                    try { agentws.send(JSON.stringify({ type: 'options', file: file })); } catch (ex) { } // Send options to agent
                    try { agentws.send('10'); } catch (ex) { } // Send file transfer protocol to agent

                    parent.parent.debug('relay', 'FileRelay connected: ' + obj.id + ' (' + obj.req.clientIp + ' --> ' + obj.peer.req.clientIp + ')');

                    // Log the connection
                    if (obj.user != null) {
                        var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: obj.user._id, username: obj.user.name, msg: "Started file transfer session" + ' \"' + obj.id + '\" from ' + obj.peer.req.clientIp + ' to ' + req.clientIp, protocol: req.query.p, nodeid: req.query.nodeid };
                        parent.parent.DispatchEvent(['*', obj.user._id], obj, event);
                    }
                } else {
                    // Connected already, drop this connection.
                    if (obj.ws) { obj.ws.close(); }
                    parent.parent.debug('relay', 'FileRelay duplicate: ' + obj.id + ' (' + obj.req.clientIp + ')');
                    delete obj.id;
                    delete obj.ws;
                    delete obj.peer;
                    return;
                }
            } else {
                // Wait for other relay connection
                parent.wsrelays[obj.id] = { peer1: obj, state: 1, timeout: setTimeout(closeBothSides, 30000) };
                parent.parent.debug('relay', 'FileRelay holding: ' + obj.id + ' (' + obj.req.clientIp + ') ' + (obj.authenticated ? 'Authenticated' : ''));
                if (obj.ws != null) {
                    // Websocket connection
                    obj.ws._socket.pause();

                    // Check if a peer server has this connection
                    if (parent.parent.multiServer != null) {
                        var rsession = parent.wsPeerRelays[obj.id];
                        if ((rsession != null) && (rsession.serverId > parent.parent.serverId)) {
                            // We must initiate the connection to the peer
                            parent.parent.multiServer.createPeerRelay(ws, req, rsession.serverId, obj.req.session.userid);
                            delete parent.wsrelays[obj.id];
                            return;
                        } else {

                            // Unexpected connection, drop it
                            if (obj.ws) { obj.ws.close(); }
                            parent.parent.debug('relay', 'FileRelay unexpected connection: ' + obj.id + ' (' + obj.req.clientIp + ')');
                            delete obj.id;
                            delete obj.ws;
                            delete obj.peer;
                            return;
                        }
                    }
                } else {
                    // HTTP connection, Send message to other peers that we have this connection
                    if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage(JSON.stringify({ action: 'relay', id: obj.id })); }
                    return;
                }
            }
        }

        // Websocket handling
        if (obj.ws != null) {
            // When data is received from the mesh relay web socket
            obj.ws.on('message', function (data) {
                if (this.res == null) { return; } // File download websocket does not have an HTTP peer, should not happen.
                if (typeof data == 'string') {
                    var cmd = null;
                    try { cmd = JSON.parse(data); } catch (ex) { }
                    if ((cmd == null) || (typeof cmd.op == 'string')) {
                        if (cmd.op == 'ok') {
                            setContentDispositionHeader(this.res, 'application/octet-stream', this.file, cmd.size, 'file.bin');
                        } else {
                            try { this.res.sendStatus(401); } catch (ex) { }
                        }
                    }
                } else {
                    var unpause = function unpauseFunc(err) { try { unpauseFunc.s.resume(); } catch (ex) { } }
                    unpause.s = this._socket;
                    this._socket.pause();
                    try { this.res.write(data, unpause); } catch (ex) { }
                }
            });

            // If error, close both sides of the relay.
            obj.ws.on('error', function (err) {
                parent.relaySessionErrorCount++;
                //console.log('FileRelay error from ' + obj.req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
                closeBothSides();
            });

            // If the relay web socket is closed, close both sides.
            obj.ws.on('close', function (req) { closeBothSides(); });
        }
    }

    // Close both our side and the peer side.
    function closeBothSides() {
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }

        if (obj.id != null) {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo != null) {
                if (relayinfo.state == 2) {
                    var peer = (relayinfo.peer1 == obj) ? relayinfo.peer2 : relayinfo.peer1;

                    // Disconnect the peer
                    try { if (peer.relaySessionCounted) { parent.relaySessionCount--; delete peer.relaySessionCounted; } } catch (ex) { console.log(ex); }
                    parent.parent.debug('relay', 'FileRelay disconnect: ' + obj.id + ' (' + obj.req.clientIp + ' --> ' + peer.req.clientIp + ')');
                    if (peer.ws) { try { peer.ws.close(); } catch (e) { } try { peer.ws._socket._parent.end(); } catch (e) { } }
                    if (peer.res) { try { peer.res.end(); } catch (ex) { } }

                    // Aggressive peer cleanup
                    delete peer.id;
                    delete peer.ws;
                    delete peer.res;
                    delete peer.peer;
                } else {
                    parent.parent.debug('relay', 'FileRelay disconnect: ' + obj.id + ' (' + obj.req.clientIp + ')');
                }

                if (obj.ws) { try { obj.ws.close(); } catch (ex) { } }
                if (obj.res) { try { obj.res.end(); } catch (ex) { } }
                delete parent.wsrelays[obj.id];
            }
        }

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.res;
        delete obj.peer;
    }

    // Mark this relay session as authenticated if this is the user end.
    obj.authenticated = (user != null);
    if (obj.authenticated) {
        // Send connection request to agent
        const rcookie = parent.parent.encodeCookie({ ruserid: user._id }, parent.parent.loginCookieEncryptionKey);
        const command = { nodeid: nodeid, action: 'msg', type: 'tunnel', userid: user._id, value: '*/devicefile.ashx?id=' + obj.id + '&rauth=' + rcookie, soptions: {} };
        parent.parent.debug('relay', 'FileRelay: Sending agent tunnel command: ' + JSON.stringify(command));
        if (obj.sendAgentMessage(command, user, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'FileRelay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
    }

    // Set the content disposition header for a HTTP response.
    // Because the filename can't have any special characters in it, we need to be extra careful.
    function setContentDispositionHeader(res, type, name, size, altname) {
        if (name != null) { name = require('path').basename(name).split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split('\'').join(''); } else { name = altname; }
        try {
            var x = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + encodeURIComponent(name) + '"' };
            if (typeof size == 'number') { x['Content-Length'] = size; }
            res.set(x);
        } catch (ex) {
            var x = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + altname + '"' };
            if (typeof size == 'number') { x['Content-Length'] = size; }
            try { res.set(x); } catch (ex) { }
        }
    }

    // If this is not an authenticated session, or the session does not have routing instructions, just go ahead an connect to existing session.
    performRelay();
    return obj;
};
