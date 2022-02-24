/**
* @description MeshCentral connection relay module
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

// Mesh Rights
const MESHRIGHT_EDITMESH = 0x00000001;
const MESHRIGHT_MANAGEUSERS = 0x00000002;
const MESHRIGHT_MANAGECOMPUTERS = 0x00000004;
const MESHRIGHT_REMOTECONTROL = 0x00000008;
const MESHRIGHT_AGENTCONSOLE = 0x00000010;
const MESHRIGHT_SERVERFILES = 0x00000020;
const MESHRIGHT_WAKEDEVICE = 0x00000040;
const MESHRIGHT_SETNOTES = 0x00000080;
const MESHRIGHT_REMOTEVIEWONLY = 0x00000100;
const MESHRIGHT_NOTERMINAL = 0x00000200;
const MESHRIGHT_NOFILES = 0x00000400;
const MESHRIGHT_NOAMT = 0x00000800;
const MESHRIGHT_DESKLIMITEDINPUT = 0x00001000;
const MESHRIGHT_LIMITEVENTS = 0x00002000;
const MESHRIGHT_CHATNOTIFY = 0x00004000;
const MESHRIGHT_UNINSTALL = 0x00008000;
const MESHRIGHT_NODESKTOP = 0x00010000;
const MESHRIGHT_REMOTECOMMAND = 0x00020000;
const MESHRIGHT_RESETOFF = 0x00040000;
const MESHRIGHT_GUESTSHARING = 0x00080000;
const MESHRIGHT_ADMIN = 0xFFFFFFFF;

// Protocol:
// 1 = Terminal
// 2 = Desktop
// 5 = Files
// 10 = Web-RDP
// 11 = Web-SSH
// 12 = Web-VNC
// 100 = Intel AMT WSMAN
// 101 = Intel AMT Redirection
// 200 = Messenger

function checkDeviceSharePublicIdentifier(parent, domain, nodeid, pid, extraKey, func) {
    // Check the public id
    parent.db.GetAllTypeNodeFiltered([nodeid], domain.id, 'deviceshare', null, function (err, docs) {
        if ((err != null) || (docs.length == 0)) { func(false); return; }

        // Search for the device share public identifier
        var found = false;
        for (var i = 0; i < docs.length; i++) {
            for (var i = 0; i < docs.length; i++) { if ((docs[i].publicid == pid) && ((docs[i].extrakey == null) || (docs[i].extrakey === extraKey))) { found = true; } }
        }
        func(found);
    });
}

module.exports.CreateMeshRelay = function (parent, ws, req, domain, user, cookie) {
    if ((cookie != null) && (typeof cookie.nid == 'string') && (typeof cookie.pid == 'string')) {
        checkDeviceSharePublicIdentifier(parent, domain, cookie.nid, cookie.pid, cookie.k, function (result) {
            // If the identifier if not found, close the connection
            if (result == false) { try { ws.close(); } catch (e) { } return; }
            // Public device sharing identifier found, continue as normal.
            CreateMeshRelayEx(parent, ws, req, domain, user, cookie);
        });
    } else {
        CreateMeshRelayEx(parent, ws, req, domain, user, cookie);
    }
}

function CreateMeshRelayEx(parent, ws, req, domain, user, cookie) {
    const currentTime = Date.now();
    if (cookie) {
        if ((typeof cookie.expire == 'number') && (cookie.expire <= currentTime)) { try { ws.close(); parent.parent.debug('relay', 'Relay: Expires cookie (' + req.clientIp + ')'); } catch (e) { console.log(e); } return; }
        if (typeof cookie.nid == 'string') { req.query.nodeid = cookie.nid; }
    }
    var obj = {};
    obj.ws = ws;
    obj.id = req.query.id;
    obj.user = user;
    obj.ruserid = null;
    obj.req = req; // Used in multi-server.js
    if ((cookie != null) && (cookie.nouser == 1)) { obj.nouser = true; } // This is a relay without user authentication

    // Setup subscription for desktop sharing public identifier
    // If the identifier is removed, drop the connection
    if ((cookie != null) && (typeof cookie.pid == 'string')) {
        obj.pid = cookie.pid;
        parent.parent.AddEventDispatch([cookie.nid], obj);
        obj.HandleEvent = function (source, event, ids, id) { if ((event.action == 'removedDeviceShare') && (obj.pid == event.publicid)) { closeBothSides(); } }
    }

    // Check relay authentication
    if ((user == null) && (obj.req.query != null) && (obj.req.query.rauth != null)) {
        const rcookie = parent.parent.decodeCookie(obj.req.query.rauth, parent.parent.loginCookieEncryptionKey, 240); // Cookie with 4 hour timeout
        if (rcookie.ruserid != null) { obj.ruserid = rcookie.ruserid; } else if (rcookie.nouser === 1) { obj.rnouser = true; }
    }

    // If there is no authentication, drop this connection
    if ((obj.id != null) && (obj.id.startsWith('meshmessenger/') == false) && (obj.user == null) && (obj.ruserid == null) && (obj.nouser !== true) && (obj.rnouser !== true)) { try { ws.close(); parent.parent.debug('relay', 'Relay: Connection with no authentication (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } return; }

    // Relay session count (we may remove this in the future)
    obj.relaySessionCounted = true;
    parent.relaySessionCount++;

    // Setup slow relay is requested. This will show down sending any data to this peer.
    if ((req.query.slowrelay != null)) {
        var sr = null;
        try { sr = parseInt(req.query.slowrelay); } catch (ex) { }
        if ((typeof sr == 'number') && (sr > 0) && (sr < 1000)) { obj.ws.slowRelay = sr; }
    }

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
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug('relay', 'Relay: Soft disconnect (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug('relay', 'Relay: Hard disconnect (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.peer;
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }

        // Unsubscribe
        if (obj.pid != null) { parent.parent.RemoveAllEventDispatch(obj); }
    };

    obj.sendAgentMessage = function (command, userid, domainid) {
        var rights, mesh;
        if (command.nodeid == null) return false;
        var user = null;
        if (userid != null) { user = parent.users[userid]; if (user == null) return false; }
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domainid)) {
            // Get the user object
            // See if the node is connected
            var agent = parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                if (userid == null) { rights = MESHRIGHT_REMOTECONTROL; } else { rights = parent.GetNodeRights(user, agent.dbMeshKey, agent.dbNodeKey); }
                mesh = parent.meshes[agent.dbMeshKey];
                if ((rights != null) && (mesh != null) || ((rights & MESHRIGHT_REMOTECONTROL) != 0)) {
                    if (ws.sessionId) { command.sessionid = ws.sessionId; }   // Set the session id, required for responses.
                    command.rights = rights;            // Add user rights flags to the message
                    if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                    if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                    if (user != null) {
                        command.username = user.name;       // Add user name
                        command.realname = user.realname;   // Add real name
                    }
                    if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                    delete command.nodeid;              // Remove the nodeid since it's implyed.
                    agent.send(JSON.stringify(command));
                    return true;
                }
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerIdNotSelf(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    if (userid == null) { rights = MESHRIGHT_REMOTECONTROL; } else { rights = parent.GetNodeRights(user, routing.meshid, command.nodeid); }
                    mesh = parent.meshes[routing.meshid];
                    if (rights != null || ((rights & MESHRIGHT_REMOTECONTROL) != 0)) {
                        if (ws.sessionId) { command.fromSessionid = ws.sessionId; }   // Set the session id, required for responses.
                        command.rights = rights;                // Add user rights flags to the message
                        if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        if (user != null) {
                            command.username = user.name;           // Add user name
                            command.realname = user.realname;       // Add real name
                        }
                        if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                        parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Push any stored message to the peer
    obj.pushStoredMessages = function () {
        if ((obj.storedPushedMessages != null) && (obj.peer != null)) {
            for (var i in obj.storedPushedMessages) {
                try { obj.peer.ws.send(JSON.stringify({ action: 'chat', msg: obj.storedPushedMessages[i] })); } catch (ex) { console.log(ex); }
            }
        }
    }

    // Push any stored message to the peer
    obj.sendPeerImage = function () {
        if ((typeof obj.id == 'string') && obj.id.startsWith('meshmessenger/') && (obj.peer != null) && (obj.user != null) && (typeof obj.user.flags == 'number') && (obj.user.flags & 1)) {
            parent.db.Get('im' + obj.user._id, function (err, docs) {
                if ((err == null) && (docs != null) && (docs.length == 1) && (typeof docs[0].image == 'string')) {
                    try { obj.peer.ws.send(JSON.stringify({ ctrlChannel: '102938', type: 'image', image: docs[0].image })); } catch (ex) { }
                }
            });
        }
    }

    // Send a PING/PONG message
    function sendPing() {
        try { obj.ws.send('{"ctrlChannel":"102938","type":"ping"}'); } catch (ex) { }
        try { if (obj.peer != null) { obj.peer.ws.send('{"ctrlChannel":"102938","type":"ping"}'); } } catch (ex) { }
    }
    function sendPong() {
        try { obj.ws.send('{"ctrlChannel":"102938","type":"pong"}'); } catch (ex) { }
        try { if (obj.peer != null) { obj.peer.ws.send('{"ctrlChannel":"102938","type":"pong"}'); } } catch (ex) { }
    }

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
                        parent.parent.debug('relay', 'Relay without-auth: ' + obj.id + ' (' + obj.req.clientIp + ')');
                        delete obj.id;
                        delete obj.ws;
                        delete obj.peer;
                        return null;
                    }

                    // Check that both connection are for the same user
                    if (!obj.id.startsWith('meshmessenger/')) {
                        var u1 = obj.user ? obj.user._id : obj.ruserid;
                        var u2 = relayinfo.peer1.user ? relayinfo.peer1.user._id : relayinfo.peer1.ruserid;
                        if (parent.args.user != null) { // If the server is setup with a default user, correct the userid now.
                            if (u1 != null) { u1 = 'user/' + domain.id + '/' + parent.args.user.toLowerCase(); }
                            if (u2 != null) { u2 = 'user/' + domain.id + '/' + parent.args.user.toLowerCase(); }
                        }
                        if ((u1 != u2) && (obj.nouser !== true) && (relayinfo.peer1.nouser !== true)) {
                            ws.close();
                            parent.parent.debug('relay', 'Relay auth mismatch (' + u1 + ' != ' + u2 + '): ' + obj.id + ' (' + obj.req.clientIp + ')');
                            delete obj.id;
                            delete obj.ws;
                            delete obj.peer;
                            return null;
                        }
                    }

                    // Check that both sides have websocket connections, this should never happen.
                    if ((obj.ws == null) || (relayinfo.peer1.ws == null)) { relayinfo.peer1.close(); obj.close(); return null; }

                    // Connect to peer
                    obj.peer = relayinfo.peer1;
                    obj.peer.peer = obj;
                    relayinfo.peer2 = obj;
                    relayinfo.state = 2;
                    relayinfo.peer1.ws._socket.resume(); // Release the traffic
                    relayinfo.peer2.ws._socket.resume(); // Release the traffic
                    ws.time = relayinfo.peer1.ws.time = Date.now();

                    relayinfo.peer1.ws.peer = relayinfo.peer2.ws;
                    relayinfo.peer2.ws.peer = relayinfo.peer1.ws;
                    
                    // Remove the timeout
                    if (relayinfo.timeout) { clearTimeout(relayinfo.timeout); delete relayinfo.timeout; }

                    // Check the protocol in use
                    req.query.p = parseInt(req.query.p);
                    if (typeof req.query.p != 'number') { req.query.p = parseInt(obj.peer.req.query.p); if (typeof req.query.p != 'number') { req.query.p = 0; } }
                    obj.peer.req.query.p = req.query.p;

                    // Setup traffic accounting
                    obj.ws._socket.bytesReadEx = 0;
                    obj.ws._socket.bytesWrittenEx = 0;
                    obj.ws._socket.p = req.query.p;
                    obj.peer.ws._socket.bytesReadEx = 0;
                    obj.peer.ws._socket.bytesWrittenEx = 0;
                    obj.peer.ws._socket.p = req.query.p;
                    if (parent.trafficStats.relayIn[req.query.p] == null) { parent.trafficStats.relayIn[req.query.p] = 0; }
                    if (parent.trafficStats.relayOut[req.query.p] == null) { parent.trafficStats.relayOut[req.query.p] = 0; }
                    if (parent.trafficStats.relayCount[req.query.p] == null) { parent.trafficStats.relayCount[req.query.p] = 1; } else { parent.trafficStats.relayCount[req.query.p]++; }

                    // Setup the agent PING/PONG timers unless requested not to
                    if ((obj.req.query.noping != 1) && (obj.peer.req != null) && (obj.peer.req.query != null) && (obj.peer.req.query.noping != 1)) {
                        if ((typeof parent.parent.args.agentping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, parent.parent.args.agentping * 1000); }
                        else if ((typeof parent.parent.args.agentpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, parent.parent.args.agentpong * 1000); }
                    }

                    // Setup session recording
                    var sessionUser = obj.user;
                    if (sessionUser == null) { sessionUser = obj.peer.user; }

                    // If this is a MeshMessenger session, set the protocol to 200.
                    var xtextSession = 0;
                    var recordSession = false;
                    if ((obj.id.startsWith('meshmessenger/node/') == true) && (sessionUser != null) && (domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf(parseInt(200)) >= 0))))) {
                        var split = obj.id.split('/');
                        obj.req.query.nodeid = split[1] + '/' + split[2] + '/' + split[3];
                        recordSession = true;
                        xtextSession = 2; // 1 = Raw recording of all strings, 2 = Record chat session messages only.
                    }
                    // See if any other recording may occur
                    if ((obj.req.query.p != null) && (obj.req.query.nodeid != null) && (sessionUser != null) && (domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf(parseInt(obj.req.query.p)) >= 0))))) { recordSession = true; }

                    if (recordSession) {
                        // Get the computer name
                        parent.db.Get(obj.req.query.nodeid, function (err, nodes) {
                            var xusername = '', xdevicename = '', xdevicename2 = null, node = null, record = true;
                            if ((nodes != null) && (nodes.length == 1)) { node = nodes[0]; xdevicename2 = node.name; xdevicename = '-' + parent.common.makeFilename(node.name); }

                            // Check again if we need to do session recording
                            if ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.onlyselectedusers === true) || (domain.sessionrecording.onlyselectedusergroups === true) || (domain.sessionrecording.onlyselecteddevicegroups === true))) {
                                record = false;

                                // Check if this user needs to be recorded
                                if ((sessionUser != null) && (domain.sessionrecording.onlyselectedusers === true)) {
                                    if ((sessionUser.flags != null) && ((sessionUser.flags & 2) != 0)) { record = true; }
                                }

                                // Check if this device group needs to be recorded
                                if ((record == false) && (node != null) && (domain.sessionrecording.onlyselecteddevicegroups === true)) {
                                    var mesh = parent.meshes[node.meshid];
                                    if ((mesh != null) && (mesh.flags != null) && ((mesh.flags & 4) != 0)) { record = true; }
                                }

                                // Check if any user groups need to be recorded
                                if ((record == false) && (domain.sessionrecording.onlyselectedusergroups === true)) {
                                    // Check if there is a usergroup that requires recording of the session
                                    if ((sessionUser != null) && (sessionUser.links != null) && (sessionUser.links[node.meshid] == null) && (sessionUser.links[node._id] == null)) {
                                        // This user does not have a direct link to the device group or device. Find all user groups the would cause the link.
                                        for (var i in sessionUser.links) {
                                            var ugrp = parent.userGroups[i];
                                            if ((ugrp != null) && (typeof ugrp.flags == 'number') && ((ugrp.flags & 2) != 0) && (ugrp.links != null) && ((ugrp.links[node.meshid] != null) || (ugrp.links[node._id] != null))) { record = true; }
                                        }
                                    }
                                }
                            }

                            // Do not record the session, just send session start
                            if (record == false) {
                                try { ws.send('c'); } catch (ex) { } // Send connect to both peers
                                try { relayinfo.peer1.ws.send('c'); } catch (ex) { }

                                // Send any stored push messages
                                obj.pushStoredMessages();
                                relayinfo.peer1.pushStoredMessages();

                                // Send other peer's image
                                obj.sendPeerImage();
                                relayinfo.peer1.sendPeerImage();
                                return;
                            }

                            // Get the username and make it acceptable as a filename
                            if (sessionUser._id) { xusername = '-' + parent.common.makeFilename(sessionUser._id.split('/')[2]); }

                            var now = new Date(Date.now());
                            var xsessionid = obj.id;
                            if ((typeof xsessionid == 'string') && (xsessionid.startsWith('meshmessenger/node/') == true)) { xsessionid = 'Messenger' }
                            var recFilename = 'relaysession' + ((domain.id == '') ? '' : '-') + domain.id + '-' + now.getUTCFullYear() + '-' + parent.common.zeroPad(now.getUTCMonth() + 1, 2) + '-' + parent.common.zeroPad(now.getUTCDate(), 2) + '-' + parent.common.zeroPad(now.getUTCHours(), 2) + '-' + parent.common.zeroPad(now.getUTCMinutes(), 2) + '-' + parent.common.zeroPad(now.getUTCSeconds(), 2) + xusername + xdevicename + '-' + xsessionid + (xtextSession ? '.txt' : '.mcrec');
                            var recFullFilename = null;
                            if (domain.sessionrecording.filepath) {
                                try { parent.parent.fs.mkdirSync(domain.sessionrecording.filepath); } catch (e) { }
                                recFullFilename = parent.parent.path.join(domain.sessionrecording.filepath, recFilename);
                            } else {
                                try { parent.parent.fs.mkdirSync(parent.parent.recordpath); } catch (e) { }
                                recFullFilename = parent.parent.path.join(parent.parent.recordpath, recFilename);
                            }
                            parent.parent.fs.open(recFullFilename, 'w', function (err, fd) {
                                if (err != null) {
                                    // Unable to record
                                    parent.parent.debug('relay', 'Relay: Unable to record to file: ' + recFullFilename);
                                    try { ws.send('c'); } catch (ex) { } // Send connect to both peers
                                    try { relayinfo.peer1.ws.send('c'); } catch (ex) { }

                                    // Send any stored push messages
                                    obj.pushStoredMessages();
                                    relayinfo.peer1.pushStoredMessages();

                                    // Send other peer's image
                                    obj.sendPeerImage();
                                    relayinfo.peer1.sendPeerImage();
                                } else {
                                    // Write the recording file header
                                    parent.parent.debug('relay', 'Relay: Started recoding to file: ' + recFullFilename);
                                    var metadata = {
                                        magic: 'MeshCentralRelaySession',
                                        ver: 1,
                                        userid: sessionUser._id,
                                        username: sessionUser.name,
                                        sessionid: obj.id,
                                        ipaddr1: (obj.req == null) ? null : obj.req.clientIp,
                                        ipaddr2: ((obj.peer == null) || (obj.peer.req == null)) ? null : obj.peer.req.clientIp,
                                        time: new Date().toLocaleString(),
                                        protocol: (((obj.req == null) || (obj.req.query == null)) ? null : obj.req.query.p),
                                        nodeid: (((obj.req == null) || (obj.req.query == null)) ? null : obj.req.query.nodeid)
                                    };

                                    if (xdevicename2 != null) { metadata.devicename = xdevicename2; }
                                    var firstBlock = JSON.stringify(metadata);
                                    var logfile = { fd: fd, lock: false, filename: recFullFilename, startTime: Date.now(), size: 0, text: xtextSession };
                                    if (node != null) { logfile.nodeid = node._id; logfile.meshid = node.meshid; logfile.name = node.name; logfile.icon = node.icon; }
                                    recordingEntry(logfile, 1, 0, firstBlock, function () {
                                        try { relayinfo.peer1.ws.logfile = ws.logfile = logfile; } catch (ex) {
                                            try { ws.send('c'); } catch (ex) { } // Send connect to both peers, 'cr' indicates the session is being recorded.
                                            try { relayinfo.peer1.ws.send('c'); } catch (ex) { }
                                            // Send any stored push messages
                                            obj.pushStoredMessages();
                                            relayinfo.peer1.pushStoredMessages();

                                            // Send other peer's image
                                            obj.sendPeerImage();
                                            relayinfo.peer1.sendPeerImage();
                                            return;
                                        }
                                        try { ws.send('cr'); } catch (ex) { } // Send connect to both peers, 'cr' indicates the session is being recorded.
                                        try { relayinfo.peer1.ws.send('cr'); } catch (ex) { }

                                        // Send any stored push messages
                                        obj.pushStoredMessages();
                                        relayinfo.peer1.pushStoredMessages();

                                        // Send other peer's image
                                        obj.sendPeerImage();
                                        relayinfo.peer1.sendPeerImage();
                                    });
                                }
                            });
                        });
                    } else {
                        // Send session start
                        try { ws.send('c'); } catch (ex) { } // Send connect to both peers
                        try { relayinfo.peer1.ws.send('c'); } catch (ex) { }

                        // Send any stored push messages
                        obj.pushStoredMessages();
                        relayinfo.peer1.pushStoredMessages();

                        // Send other peer's image
                        obj.sendPeerImage();
                        relayinfo.peer1.sendPeerImage();
                    }

                    parent.parent.debug('relay', 'Relay connected: ' + obj.id + ' (' + obj.req.clientIp + ' --> ' + obj.peer.req.clientIp + ')');

                    // Log the connection
                    if (sessionUser != null) {
                        var msg = 'Started relay session', msgid = 13;
                        if (obj.req.query.p == 1) { msg = 'Started terminal session'; msgid = 14; }
                        else if (obj.req.query.p == 2) { msg = 'Started desktop session'; msgid = 15; }
                        else if (obj.req.query.p == 5) { msg = 'Started file management session'; msgid = 16; }
                        var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: sessionUser._id, username: sessionUser.name, msgid: msgid, msgArgs: [obj.id, obj.peer.req.clientIp, req.clientIp], msg: msg + ' \"' + obj.id + '\" from ' + obj.peer.req.clientIp + ' to ' + req.clientIp, protocol: req.query.p, nodeid: req.query.nodeid };
                        if (obj.guestname) { event.guestname = obj.guestname; } else if (relayinfo.peer1.guestname) { event.guestname = relayinfo.peer1.guestname; } // If this is a sharing session, set the guest name here.
                        parent.parent.DispatchEvent(['*', sessionUser._id], obj, event);

                        // Update user last access time
                        if ((obj.user != null) && (obj.guestname == null)) {
                            const timeNow = Math.floor(Date.now() / 1000);
                            if (obj.user.access < (timeNow - 300)) { // Only update user access time if longer than 5 minutes
                                obj.user.access = timeNow;
                                parent.db.SetUser(obj.user);

                                // Event the change
                                var message = { etype: 'user', userid: obj.user._id, username: obj.user.name, account: parent.CloneSafeUser(obj.user), action: 'accountchange', domain: domain.id, nolog: 1 };
                                if (parent.db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                var targets = ['*', 'server-users', obj.user._id];
                                if (obj.user.groups) { for (var i in obj.user.groups) { targets.push('server-users:' + i); } }
                                parent.parent.DispatchEvent(targets, obj, message);
                            }
                        }
                    }
                } else {
                    // Connected already, drop (TODO: maybe we should re-connect?)
                    ws.close();
                    parent.parent.debug('relay', 'Relay duplicate: ' + obj.id + ' (' + obj.req.clientIp + ')');
                    delete obj.id;
                    delete obj.ws;
                    delete obj.peer;
                    return null;
                }
            } else {
                // Set authenticated side as browser side for messenger sessions
                if ((obj.id.startsWith('meshmessenger/node/') == true) && obj.authenticated) { obj.req.query.browser = 1; }

                // Wait for other relay connection
                if ((obj.id.startsWith('meshmessenger/node/') == true) && obj.authenticated && (parent.parent.firebase != null)) {
                    // This is an authenticated messenger session, push messaging may be allowed. Don't hold traffic.
                    ws._socket.resume(); // Don't hold traffic, process push messages
                    parent.parent.debug('relay', 'Relay messenger waiting: ' + obj.id + ' (' + obj.req.clientIp + ') ' + (obj.authenticated ? 'Authenticated' : ''));

                    // Fetch the Push Messaging Token
                    const idsplit = obj.id.split('/');
                    const nodeid = idsplit[1] + '/' + idsplit[2] + '/' + idsplit[3];
                    parent.db.Get(nodeid, function (err, nodes) {
                        if ((err == null) && (nodes != null) && (nodes.length == 1) && (typeof nodes[0].pmt == 'string')) {
                            if ((parent.GetNodeRights(obj.user, nodes[0].meshid, nodes[0]._id) & MESHRIGHT_CHATNOTIFY) != 0) {
                                obj.node = nodes[0];
                                // Create the peer connection URL, we will include that in push messages
                                obj.msgurl = req.headers.origin + (req.url.split('/.websocket')[0].split('/meshrelay.ashx').join('/messenger')) + '?id=' + req.query.id
                            }
                        }
                    });
                    parent.wsrelays[obj.id] = { peer1: obj, state: 1 }; // No timeout on connections with push notification.
                } else {
                    ws._socket.pause(); // Hold traffic until the other connection
                    parent.parent.debug('relay', 'Relay holding: ' + obj.id + ' (' + obj.req.clientIp + ') ' + (obj.authenticated ? 'Authenticated' : ''));
                    parent.wsrelays[obj.id] = { peer1: obj, state: 1, timeout: setTimeout(closeBothSides, 60000) };
                }

                // Check if a peer server has this connection
                if (parent.parent.multiServer != null) {
                    var rsession = parent.wsPeerRelays[obj.id];
                    if ((rsession != null) && (rsession.serverId > parent.parent.serverId)) {
                        // We must initiate the connection to the peer
                        parent.parent.multiServer.createPeerRelay(ws, req, rsession.serverId, obj.req.session.userid);
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
        // Perform traffic accounting
        parent.trafficStats.relayIn[this._socket.p] += (this._socket.bytesRead - this._socket.bytesReadEx);
        parent.trafficStats.relayOut[this._socket.p] += (this._socket.bytesWritten - this._socket.bytesWrittenEx);

        if (this.peer != null) {
            //if (typeof data == 'string') { console.log('Relay: ' + data); } else { console.log('Relay:' + data.length + ' byte(s)'); }
            if (this.peer.slowRelay == null) {
                try {
                    this._socket.pause();
                    if (this.logfile != null) {
                        // Write data to log file then perform relay
                        var xthis = this;
                        recordingEntry(this.logfile, 2, ((obj.req.query.browser) ? 2 : 0), data, function () { xthis.peer.send(data, ws.flushSink); });
                    } else {
                        // Perform relay
                        this.peer.send(data, ws.flushSink);
                    }
                } catch (ex) { console.log(ex); }
            } else {
                try {
                    this._socket.pause();
                    if (this.logfile != null) {
                        // Write data to log file then perform slow relay
                        var xthis = this;
                        recordingEntry(this.logfile, 2, ((obj.req.query.browser) ? 2 : 0), data, function () {
                            setTimeout(function () { xthis.peer.send(data, ws.flushSink); }, xthis.peer.slowRelay);
                        });
                    } else {
                        // Perform slow relay
                        var xthis = this;
                        setTimeout(function () { xthis.peer.send(data, ws.flushSink); }, xthis.peer.slowRelay);
                    }
                } catch (ex) { console.log(ex); }
            }
        } else {
            if ((typeof data == 'string') && (obj.node != null) && (obj.node.pmt != null)) {
                var command = null;
                try { command = JSON.parse(data); } catch (ex) { return; }
                if ((typeof command != 'object') || (command.action != 'chat') || (typeof command.msg != 'string') || (command.msg == '')) return;

                // Store pushed messages
                if (obj.storedPushedMessages == null) { obj.storedPushedMessages = []; }
                obj.storedPushedMessages.push(command.msg);
                while (obj.storedPushedMessages.length > 50) { obj.storedPushedMessages.shift(); } // Only keep last 50 notifications

                // Send out a push message to the device
                command.title = (domain.title ? domain.title : 'MeshCentral');
                var payload = { notification: { title: command.title, body: command.msg }, data: { url: obj.msgurl } };
                var options = { priority: 'High', timeToLive: 5 * 60 }; // TTL: 5 minutes, priority 'Normal' or 'High'
                parent.parent.firebase.sendToDevice(obj.node, payload, options, function (id, err, errdesc) {
                    if (err == null) {
                        parent.parent.debug('email', 'Successfully send push message to device ' + obj.node.name + ', title: ' + command.title + ', msg: ' + command.msg);
                        try { ws.send(JSON.stringify({ action: 'ctrl', value: 1 })); } catch (ex) { } // Push notification success
                    } else {
                        parent.parent.debug('email', 'Failed to send push message to device ' + obj.node.name + ', title: ' + command.title + ', msg: ' + command.msg + ', error: ' + errdesc);
                        try { ws.send(JSON.stringify({ action: 'ctrl', value: 2 })); } catch (ex) { } // Push notification failed
                    }
                });
            }
        }
    });

    // If error, close both sides of the relay.
    ws.on('error', function (err) {
        parent.relaySessionErrorCount++;
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }
        console.log('Relay error from ' + obj.req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
        closeBothSides();
    });

    // If the relay web socket is closed, close both sides.
    ws.on('close', function (req) {
        // Perform traffic accounting
        parent.trafficStats.relayIn[this._socket.p] += (this._socket.bytesRead - this._socket.bytesReadEx);
        parent.trafficStats.relayOut[this._socket.p] += (this._socket.bytesWritten - this._socket.bytesWrittenEx);

        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }
        closeBothSides();
    });

    // Set the session expire timer
    function setExpireTimer() {
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }
        if (cookie && (typeof cookie.expire == 'number')) {
            const timeToExpire = (cookie.expire - Date.now());
            if (timeToExpire < 1) {
                closeBothSides();
            } else if (timeToExpire >= 0x7FFFFFFF) {
                obj.expireTimer = setTimeout(setExpireTimer, 0x7FFFFFFF); // Since expire timer can't be larger than 0x7FFFFFFF, reset timer after that time.
            } else {
                obj.expireTimer = setTimeout(closeBothSides, timeToExpire);
            }
        }
    }

    // Close both our side and the peer side.
    function closeBothSides() {
        if (obj.id != null) {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo != null) {
                if (relayinfo.state == 2) {
                    var peer = (relayinfo.peer1 == obj) ? relayinfo.peer2 : relayinfo.peer1;

                    // Compute traffic
                    var inTraffc, outTraffc;
                    try { inTraffc = ws._socket.bytesRead + peer.ws._socket.bytesRead; } catch (ex) { }
                    try { outTraffc = ws._socket.bytesWritten + peer.ws._socket.bytesWritten; } catch (ex) { }

                    // Disconnect the peer
                    try { if (peer.relaySessionCounted) { parent.relaySessionCount--; delete peer.relaySessionCounted; } } catch (ex) { console.log(ex); }
                    parent.parent.debug('relay', 'Relay disconnect: ' + obj.id + ' (' + obj.req.clientIp + ' --> ' + peer.req.clientIp + ')');
                    try { peer.ws.close(); } catch (e) { } // Soft disconnect
                    try { peer.ws._socket._parent.end(); } catch (e) { } // Hard disconnect

                    // Log the disconnection
                    if (ws.time) {
                        var msg = 'Ended relay session', msgid = 9;
                        if (obj.req.query.p == 1) { msg = 'Ended terminal session', msgid = 10; }
                        else if (obj.req.query.p == 2) { msg = 'Ended desktop session', msgid = 11; }
                        else if (obj.req.query.p == 5) { msg = 'Ended file management session', msgid = 12; }
                        else if (obj.req.query.p == 200) { msg = 'Ended messenger session', msgid = 112; }

                        // Get the nodeid and meshid of this device
                        var nodeid = (obj.nodeid == null) ? peer.nodeid : obj.nodeid;
                        var meshid = (obj.meshid == null) ? peer.meshid : obj.meshid;

                        if (user) {
                            var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [obj.id, obj.req.clientIp, obj.peer.req.clientIp, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + obj.id + '\" from ' + obj.req.clientIp + ' to ' + obj.peer.req.clientIp + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: obj.req.query.p, nodeid: obj.req.query.nodeid, bytesin: inTraffc, bytesout: outTraffc };
                            if (obj.guestname) { event.guestname = obj.guestname; } else if (peer.guestname) { event.guestname = peer.guestname; } // If this is a sharing session, set the guest name here.
                            parent.parent.DispatchEvent(['*', user._id, nodeid, meshid], obj, event);
                        } else if (peer.user) {
                            var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: peer.user._id, username: peer.user.name, msgid: msgid, msgArgs: [obj.id, obj.req.clientIp, obj.peer.req.clientIp, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + obj.id + '\" from ' + obj.req.clientIp + ' to ' + obj.peer.req.clientIp + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: obj.req.query.p, nodeid: obj.req.query.nodeid, bytesin: inTraffc, bytesout: outTraffc };
                            if (obj.guestname) { event.guestname = obj.guestname; } else if (peer.guestname) { event.guestname = peer.guestname; } // If this is a sharing session, set the guest name here.
                            parent.parent.DispatchEvent(['*', peer.user._id, nodeid, meshid], obj, event);
                        }
                    }

                    // Aggressive peer cleanup
                    delete peer.id;
                    delete peer.ws;
                    delete peer.peer;
                    delete peer.nodeid;
                    delete peer.meshid;
                    if (peer.pingtimer != null) { clearInterval(peer.pingtimer); delete peer.pingtimer; }
                    if (peer.pongtimer != null) { clearInterval(peer.pongtimer); delete peer.pongtimer; }
                } else {
                    parent.parent.debug('relay', 'Relay disconnect: ' + obj.id + ' (' + obj.req.clientIp + ')');
                }

                // Close the recording file if needed
                if (ws.logfile != null) {
                    var logfile = ws.logfile;
                    delete ws.logfile;
                    if (peer.ws) { delete peer.ws.logfile; }
                    recordingEntry(logfile, 3, 0, 'MeshCentralMCREC', function (logfile, tag) {
                        parent.parent.fs.close(logfile.fd);

                        // Now that the recording file is closed, check if we need to index this file.
                        if (domain.sessionrecording.index !== false) { parent.parent.certificateOperations.acceleratorPerformOperation('indexMcRec', tag.logfile.filename); }

                        // Compute session length
                        var sessionLength = null;
                        if (tag.logfile.startTime != null) { sessionLength = Math.round((Date.now() - tag.logfile.startTime) / 1000); }

                        // Add a event entry about this recording
                        var basefile = parent.parent.path.basename(tag.logfile.filename);
                        var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: tag.logfile.nodeid, msg: "Finished recording session" + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: basefile, size: tag.logfile.size };
                        if (user) { event.userids = [user._id]; } else if (peer.user) { event.userids = [peer.user._id]; }
                        var xprotocol = (((obj.req == null) || (obj.req.query == null)) ? null : obj.req.query.p);
                        if ((xprotocol == null) && (logfile.text == 2)) { xprotocol = 200; }
                        if (xprotocol != null) { event.protocol = parseInt(xprotocol); }
                        var mesh = parent.meshes[tag.logfile.meshid];
                        if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
                        if (tag.logfile.startTime) { event.startTime = tag.logfile.startTime; event.lengthTime = sessionLength; }
                        if (tag.logfile.name) { event.name = tag.logfile.name; }
                        if (tag.logfile.icon) { event.icon = tag.logfile.icon; }
                        parent.parent.DispatchEvent(['*', 'recording', tag.logfile.nodeid, tag.logfile.meshid], obj, event);

                        cleanUpRecordings();
                    }, { ws: ws, pws: peer.ws, logfile: logfile });
                }

                try { ws.close(); } catch (ex) { }
                delete parent.wsrelays[obj.id];
            }
        }

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.peer;
        delete obj.nodeid;
        delete obj.meshid;
        if (obj.pingtimer != null) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer != null) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Unsubscribe
        if (obj.pid != null) { parent.parent.RemoveAllEventDispatch(obj); }
    }

    // Record a new entry in a recording log
    function recordingEntry(logfile, type, flags, data, func, tag) {
        try {
            if (logfile.text) {
                // Text recording format
                var out = '';
                const utcDate = new Date(Date.now());
                if (type == 1) {
                    // End of start
                    out = data + '\r\n' + utcDate.toUTCString() + ', ' + "<<<START>>>" + '\r\n';
                } else if (type == 3) {
                    // End of log
                    out = utcDate.toUTCString() + ', ' + "<<<END>>>" + '\r\n';
                } else if (typeof data == 'string') {
                    // Log message
                    if (logfile.text == 1) {
                        out = utcDate.toUTCString() + ', ' + data + '\r\n';
                    } else if (logfile.text == 2) {
                        try {
                            var x = JSON.parse(data);
                            if (typeof x.action == 'string') {
                                if ((x.action == 'chat') && (typeof x.msg == 'string')) { out = utcDate.toUTCString() + ', ' + (((flags & 2) ? '--> ' : '<-- ') + x.msg + '\r\n'); }
                                else if ((x.action == 'file') && (typeof x.name == 'string') && (typeof x.size == 'number')) { out = utcDate.toUTCString() + ', ' + (((flags & 2) ? '--> ' : '<-- ') + "File Transfer" + ', \"' + x.name + '\" (' + x.size + ' ' + "bytes" + ')\r\n'); }
                            } else if (x.ctrlChannel == null) { out = utcDate.toUTCString() + ', ' + data + '\r\n'; }
                        } catch (ex) {
                            out = utcDate.toUTCString() + ', ' + data + '\r\n';
                        }
                    }
                }
                if (out != null) {
                    // Log this event
                    const block = Buffer.from(out);
                    parent.parent.fs.write(logfile.fd, block, 0, block.length, function () { func(logfile, tag); });
                    logfile.size += block.length;
                } else {
                    // Skip logging this.
                    func(logfile, tag);
                }
            } else {
                // Binary recording format
                if (typeof data == 'string') {
                    // String write
                    var blockData = Buffer.from(data), header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                    header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                    header.writeInt16BE(flags, 2); // Flags (1 = Binary, 2 = User)
                    header.writeInt32BE(blockData.length, 4); // Size
                    header.writeIntBE(new Date(), 10, 6); // Time
                    var block = Buffer.concat([header, blockData]);
                    parent.parent.fs.write(logfile.fd, block, 0, block.length, function () { func(logfile, tag); });
                    logfile.size += block.length;
                } else {
                    // Binary write
                    var header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                    header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                    header.writeInt16BE(flags | 1, 2); // Flags (1 = Binary, 2 = User)
                    header.writeInt32BE(data.length, 4); // Size
                    header.writeIntBE(new Date(), 10, 6); // Time
                    var block = Buffer.concat([header, data]);
                    parent.parent.fs.write(logfile.fd, block, 0, block.length, function () { func(logfile, tag); });
                    logfile.size += block.length;
                }
            }
        } catch (ex) { console.log(ex); func(logfile, tag); }
    }

    // If this session has a expire time, setup the expire timer now.
    setExpireTimer();

    // Mark this relay session as authenticated if this is the user end.
    obj.authenticated = ((user != null) || (obj.nouser === true));
    if (obj.authenticated) {
        // To build the connection URL, if we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';

        // Kick off the routing, if we have agent routing instructions, process them here.
        // Routing instructions can only be given by a authenticated user
        if ((cookie != null) && (cookie.nodeid != null) && (cookie.tcpport != null) && (cookie.domainid != null)) {
            // We have routing instructions in the cookie, but first, check user access for this node.
            parent.db.Get(cookie.nodeid, function (err, docs) {
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (1)'); try { obj.close(); } catch (e) { } return; }

                // Set nodeid and meshid
                obj.nodeid = node._id;
                obj.meshid = node.meshid;

                // Send connection request to agent
                const rcookie = parent.parent.encodeCookie({ ruserid: user._id }, parent.parent.loginCookieEncryptionKey);
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                const command = { nodeid: cookie.nodeid, action: 'msg', type: 'tunnel', userid: user._id, value: '*/' + xdomain + 'meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, tcpport: cookie.tcpport, tcpaddr: cookie.tcpaddr, soptions: {} };
                if (typeof domain.consentmessages == 'object') {
                    if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                    if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                    if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                    if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                    if ((typeof domain.consentmessages.consenttimeout == 'number') && (domain.consentmessages.consenttimeout > 0)) { command.soptions.consentTimeout = domain.consentmessages.consenttimeout; }
                    if (domain.consentmessages.autoacceptontimeout === true) { command.soptions.consentAutoAccept = true; }
                }
                if (typeof domain.notificationmessages == 'object') {
                    if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                    if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                    if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                    if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                }
                parent.parent.debug('relay', 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user._id, cookie.domainid) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                performRelay();
            });
            return obj;
        } else if ((obj.req.query.nodeid != null) && ((obj.req.query.tcpport != null) || (obj.req.query.udpport != null))) {
            // We have routing instructions in the URL arguments, but first, check user access for this node.
            parent.db.Get(obj.req.query.nodeid, function (err, docs) {
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Set nodeid and meshid
                obj.nodeid = node._id;
                obj.meshid = node.meshid;

                // Send connection request to agent
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                const rcookie = parent.parent.encodeCookie({ ruserid: user._id }, parent.parent.loginCookieEncryptionKey);

                if (obj.req.query.tcpport != null) {
                    const command = { nodeid: obj.req.query.nodeid, action: 'msg', type: 'tunnel', userid: user._id, value: '*/' + xdomain + 'meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, tcpport: obj.req.query.tcpport, tcpaddr: ((obj.req.query.tcpaddr == null) ? '127.0.0.1' : obj.req.query.tcpaddr), soptions: {} };
                    if (typeof domain.consentmessages == 'object') {
                        if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                        if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                        if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                        if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                        if ((typeof domain.consentmessages.consenttimeout == 'number') && (domain.consentmessages.consenttimeout > 0)) { command.soptions.consentTimeout = domain.consentmessages.consenttimeout; }
                        if (domain.consentmessages.autoacceptontimeout === true) { command.soptions.consentAutoAccept = true; }
                    }
                    if (typeof domain.notificationmessages == 'object') {
                        if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                        if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                        if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                        if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                    }
                    parent.parent.debug('relay', 'Relay: Sending agent TCP tunnel command: ' + JSON.stringify(command));
                    if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                } else if (obj.req.query.udpport != null) {
                    const command = { nodeid: obj.req.query.nodeid, action: 'msg', type: 'tunnel', userid: user._id, value: '*/' + xdomain + 'meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, udpport: obj.req.query.udpport, udpaddr: ((obj.req.query.udpaddr == null) ? '127.0.0.1' : obj.req.query.udpaddr), soptions: {} };
                    if (typeof domain.consentmessages == 'object') {
                        if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                        if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                        if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                        if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                        if ((typeof domain.consentmessages.consenttimeout == 'number') && (domain.consentmessages.consenttimeout > 0)) { command.soptions.consentTimeout = domain.consentmessages.consenttimeout; }
                        if (domain.consentmessages.autoacceptontimeout === true) { command.soptions.consentAutoAccept = true; }
                    }
                    if (typeof domain.notificationmessages == 'object') {
                        if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                        if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                        if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                        if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                    }
                    parent.parent.debug('relay', 'Relay: Sending agent UDP tunnel command: ' + JSON.stringify(command));
                    if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                }
                performRelay();
            });
            return obj;
        } else if ((cookie != null) && (cookie.nid != null) && (typeof cookie.r == 'number') && (typeof cookie.p == 'number') && (typeof cookie.cf == 'number') && (typeof cookie.gn == 'string')) {
            // We have routing instructions in the cookie, but first, check user access for this node.
            parent.db.Get(cookie.nid, function (err, docs) {
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((obj.nouser !== true) && ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0)) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Set nodeid and meshid
                obj.nodeid = node._id;
                obj.meshid = node.meshid;

                // Send connection request to agent
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); }
                const rcookieData = { nodeid: node._id };
                if (user != null) { rcookieData.ruserid = user._id; } else if (obj.nouser === true) { rcookieData.nouser = 1; }
                const rcookie = parent.parent.encodeCookie(rcookieData, parent.parent.loginCookieEncryptionKey);
                const command = { nodeid: node._id, action: 'msg', type: 'tunnel', value: '*/' + xdomain + 'meshrelay.ashx?p=' + obj.req.query.p + '&id=' + obj.id + '&rauth=' + rcookie + '&nodeid=' + node._id, soptions: {}, rights: cookie.r, guestuserid: user._id, guestname: cookie.gn, consent: cookie.cf, remoteaddr: cleanRemoteAddr(obj.req.clientIp) };
                obj.guestname = cookie.gn;

                // Limit what this relay connection can do
                if (typeof cookie.p == 'number') {
                    var usages = [];
                    if (cookie.p & 1) { usages.push(1); usages.push(6); usages.push(8); usages.push(9); } // Terminal
                    if (cookie.p & 2) { usages.push(2); } // Desktop
                    if (cookie.p & 4) { usages.push(5); usages.push(10); } // Files
                    command.soptions.usages = usages;
                }
                if (usages.indexOf(parseInt(obj.req.query.p)) < 0) { console.log('ERR: Invalid protocol usage'); try { obj.close(); } catch (e) { } return; }

                if (typeof domain.consentmessages == 'object') {
                    if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                    if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                    if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                    if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                    if ((typeof domain.consentmessages.consenttimeout == 'number') && (domain.consentmessages.consenttimeout > 0)) { command.soptions.consentTimeout = domain.consentmessages.consenttimeout; }
                    if (domain.consentmessages.autoacceptontimeout === true) { command.soptions.consentAutoAccept = true; }
                }
                if (typeof domain.notificationmessages == 'object') {
                    if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                    if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                    if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                    if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                }
                parent.parent.debug('relay', 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user?user._id:null, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }

                performRelay(0);
            });
            return obj;
        } else {
            // No routing needed. Just check permissions and fill in the device nodeid and meshid.
            if ((obj.req.query.nodeid != null) && (obj.req.query.nodeid.startsWith('node/'))) {
                var nodeSplit = obj.req.query.nodeid.split('/');
                if ((nodeSplit.length != 3) || (nodeSplit[1] != domain.id)) { console.log('ERR: Invalid NodeID'); try { obj.close(); } catch (e) { } return; }
                parent.db.Get(obj.req.query.nodeid, function (err, docs) {
                    if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                    const node = docs[0];

                    // Check if this user has permission to manage this computer
                    if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                    // Set nodeid and meshid
                    obj.nodeid = node._id;
                    obj.meshid = node.meshid;
                });
            }
        }
    }

    // If there is a recording quota, remove any old recordings if needed
    function cleanUpRecordings() {
        if ((parent.cleanUpRecordingsActive !== true) && domain.sessionrecording && ((typeof domain.sessionrecording.maxrecordings == 'number') || (typeof domain.sessionrecording.maxrecordingsizemegabytes == 'number') || (typeof domain.sessionrecording.maxrecordingdays == 'number'))) {
            parent.cleanUpRecordingsActive = true;
            setTimeout(function () {
                var recPath = null, fs = require('fs'), now = Date.now();
                if (domain.sessionrecording.filepath) { recPath = domain.sessionrecording.filepath; } else { recPath = parent.parent.recordpath; }
                fs.readdir(recPath, function (err, files) {
                    if ((err != null) || (files == null)) { delete parent.cleanUpRecordingsActive; return; }
                    var recfiles = [];
                    for (var i in files) {
                        if (files[i].endsWith('.mcrec')) {
                            var j = files[i].indexOf('-');
                            if (j > 0) {
                                var stats = null;
                                try { stats = fs.statSync(parent.parent.path.join(recPath, files[i])); } catch (ex) { }
                                if (stats != null) { recfiles.push({ n: files[i], r: files[i].substring(j + 1), s: stats.size, t: stats.mtimeMs }); }
                            }
                        }
                    }
                    recfiles.sort(function (a, b) { if (a.r < b.r) return 1; if (a.r > b.r) return -1; return 0; });
                    var totalFiles = 0, totalSize = 0;
                    for (var i in recfiles) {
                        var overQuota = false;
                        if ((typeof domain.sessionrecording.maxrecordings == 'number') && (domain.sessionrecording.maxrecordings > 0) && (totalFiles >= domain.sessionrecording.maxrecordings)) { overQuota = true; }
                        else if ((typeof domain.sessionrecording.maxrecordingsizemegabytes == 'number') && (domain.sessionrecording.maxrecordingsizemegabytes > 0) && (totalSize >= (domain.sessionrecording.maxrecordingsizemegabytes * 1048576))) { overQuota = true; }
                        else if ((typeof domain.sessionrecording.maxrecordingdays == 'number') && (domain.sessionrecording.maxrecordingdays > 0) && (((now - recfiles[i].t) / 1000 / 60 / 60 / 24) >= domain.sessionrecording.maxrecordingdays)) { overQuota = true; }
                        if (overQuota) { fs.unlinkSync(parent.parent.path.join(recPath, recfiles[i].n)); }
                        totalFiles++;
                        totalSize += recfiles[i].s;
                    }
                    delete parent.cleanUpRecordingsActive;
                });
            }, 500);
        }
    }

    // If this is not an authenticated session, or the session does not have routing instructions, just go ahead an connect to existing session.
    performRelay();
    return obj;
};

/*
Relay session recording required that "SessionRecording":true be set in the domain section of the config.json.
Once done, a folder "meshcentral-recordings" will be created next to "meshcentral-data" that will contain all
of the recording files with the .mcrec extension.

The recording files are binary and contain a set of:

    <HEADER><DATABLOCK><HEADER><DATABLOCK><HEADER><DATABLOCK><HEADER><DATABLOCK>...

The header is always 16 bytes long and is encoded like this:

    TYPE   2 bytes, 1 = Header, 2 = Network Data, 3 = EndBlock
    FLAGS  2 bytes, 0x0001 = Binary, 0x0002 = User
    SIZE   4 bytes, Size of the data following this header.
    TIME   8 bytes, Time this record was written, number of milliseconds since 1 January, 1970 UTC.

All values are BigEndian encoded. The first data block is of TYPE 1 and contains a JSON string with information
about this recording. It looks something like this:

{
    magic: 'MeshCentralRelaySession',
    ver: 1,
    userid: "user\domain\userid",
    username: "username",
    sessionid: "RandomValue",
    ipaddr1: 1.2.3.4,
    ipaddr2: 1.2.3.5,
    time: new Date().toLocaleString()
}

The rest of the data blocks are all network traffic that was relayed thru the server. They are of TYPE 2 and have
a given size and timestamp. When looking at network traffic the flags are important:

- If traffic has the first (0x0001) flag set, the data is binary otherwise it's a string.
- If the traffic has the second (0x0002) flag set, traffic is coming from the user's browser, if not, it's coming from the MeshAgent.
*/




module.exports.CreateLocalRelay = function (parent, ws, req, domain, user, cookie) {
    CreateLocalRelayEx(parent, ws, req, domain, user, cookie);
}

function CreateLocalRelayEx(parent, ws, req, domain, user, cookie) {
    const net = require('net');
    var obj = {};
    obj.id = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64');
    obj.req = req;
    obj.ws = ws;
    obj.user = user;

    // Check the protocol in use
    var protocolInUse = parseInt(req.query.p);
    if (typeof protocolInUse != 'number') { protocolInUse = 0; }

    // If there is no authentication, drop this connection
    if (obj.user == null) { try { ws.close(); parent.parent.debug('relay', 'LocalRelay: Connection with no authentication'); } catch (e) { console.log(e); } return; }

    // Use cookie values when present
    if (cookie != null) {
        if (cookie.nodeid) { req.query.nodeid = cookie.nodeid; }
        if (cookie.tcpport) { req.query.tcpport = cookie.tcpport; }
    }

    // Check for nodeid and tcpport
    if ((req.query == null) || (req.query.nodeid == null) || (req.query.tcpport == null)) { try { ws.close(); parent.parent.debug('relay', 'LocalRelay: Connection with invalid arguments'); } catch (e) { console.log(e); } return; }
    const tcpport = parseInt(req.query.tcpport);
    if ((typeof tcpport != 'number') || (tcpport < 1) || (tcpport > 65535)) { try { ws.close(); parent.parent.debug('relay', 'LocalRelay: Connection with invalid arguments'); } catch (e) { console.log(e); } return; }
    var nodeidsplit = req.query.nodeid.split('/');
    if ((nodeidsplit.length != 3) || (nodeidsplit[0] != 'node') || (nodeidsplit[1] != domain.id) || (nodeidsplit[2].length < 10)) { try { ws.close(); parent.parent.debug('relay', 'LocalRelay: Connection with invalid arguments'); } catch (e) { console.log(e); } return; }
    obj.nodeid = req.query.nodeid;
    obj.tcpport = tcpport;

    // Relay session count (we may remove this in the future)
    obj.relaySessionCounted = true;
    parent.relaySessionCount++;

    // Setup slow relay is requested. This will show down sending any data to this peer.
    if ((req.query.slowrelay != null)) {
        var sr = null;
        try { sr = parseInt(req.query.slowrelay); } catch (ex) { }
        if ((typeof sr == 'number') && (sr > 0) && (sr < 1000)) { obj.ws.slowRelay = sr; }
    }

    // Hold traffic until we connect to the target
    ws._socket.pause();
    ws._socket.bytesReadEx = 0;
    ws._socket.bytesWrittenEx = 0;

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

    // Perform data accounting
    function dataAccounting() {
        const datain = ((obj.client.bytesRead - obj.client.bytesReadEx) + (ws._socket.bytesRead - ws._socket.bytesReadEx));
        const dataout = ((obj.client.bytesWritten - obj.client.bytesWrittenEx) + (ws._socket.bytesWritten - ws._socket.bytesWrittenEx));
        obj.client.bytesReadEx = obj.client.bytesRead;
        obj.client.bytesWrittenEx = obj.client.bytesWritten;
        ws._socket.bytesReadEx = ws._socket.bytesRead;
        ws._socket.bytesWrittenEx = ws._socket.bytesWritten;

        // Add to counters
        if (parent.trafficStats.localRelayIn[protocolInUse]) { parent.trafficStats.localRelayIn[protocolInUse] += datain; } else { parent.trafficStats.localRelayIn[protocolInUse] = datain; }
        if (parent.trafficStats.localRelayOut[protocolInUse]) { parent.trafficStats.localRelayOut[protocolInUse] += dataout; } else { parent.trafficStats.localRelayOut[protocolInUse] = dataout; }
    }

    // Disconnect
    obj.close = function (arg) {
        // If the web socket is already closed, stop here.
        if (obj.ws == null) return;

        // Perform data accounting
        dataAccounting();

        // Collect how many raw bytes where received and sent.
        // We sum both the websocket and TCP client in this case.
        var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
        if (obj.client != null) { inTraffc += obj.client.bytesRead; outTraffc += obj.client.bytesWritten; }

        // Close the web socket
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); parent.parent.debug('relay', 'LocalRelay: Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); parent.parent.debug('relay', 'LocalRelay: Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket

        // Update the relay session count
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }

        // Log the disconnection, traffic will be credited to the authenticated user
        if (obj.time) {
            var protocolStr = req.query.p;
            if (req.query.p == 10) { protocolStr = 'RDP'; }
            else if (req.query.p == 11) { protocolStr = 'SSH-TERM'; }
            else if (req.query.p == 12) { protocolStr = 'VNC'; }
            else if (req.query.p == 13) { protocolStr = 'SSH-FILES'; }
            var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: obj.user._id, username: obj.user.name, msgid: 121, msgArgs: [obj.id, protocolStr, obj.host, Math.floor((Date.now() - obj.time) / 1000)], msg: 'Ended local relay session \"' + obj.id + '\", protocol ' + protocolStr + ' to ' + obj.host + ', ' + Math.floor((Date.now() - obj.time) / 1000) + ' second(s)', nodeid: obj.req.query.nodeid, protocol: req.query.p, in: inTraffc, out: outTraffc };
            if (obj.guestname) { event.guestname = obj.guestname; } // If this is a sharing session, set the guest name here.
            parent.parent.DispatchEvent(['*', user._id], obj, event);
        }

        // Aggressive cleanup
        delete obj.ws;
        delete obj.req;
        delete obj.time;
        delete obj.nodeid;
        delete obj.meshid;
        delete obj.tcpport;
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }
        if (obj.client != null) { obj.client.destroy(); delete obj.client; } // Close the client socket
        if (obj.pingtimer != null) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer != null) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Unsubscribe
        if (obj.pid != null) { parent.parent.RemoveAllEventDispatch(obj); }
    };

    // Send a PING/PONG message
    function sendPing() { try { obj.ws.send('{"ctrlChannel":"102938","type":"ping"}'); } catch (ex) { } }
    function sendPong() { try { obj.ws.send('{"ctrlChannel":"102938","type":"pong"}'); } catch (ex) { } }

    function performRelay() {
        ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive

        // Setup the agent PING/PONG timers unless requested not to
        if (obj.req.query.noping != 1) {
            if ((typeof parent.parent.args.agentping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, parent.parent.args.agentping * 1000); }
            else if ((typeof parent.parent.args.agentpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, parent.parent.args.agentpong * 1000); }
        }

        parent.db.Get(obj.nodeid, function (err, docs) {
            if ((err != null) || (docs == null) || (docs.length != 1)) { try { obj.close(); } catch (e) { } return; } // Disconnect websocket
            const node = docs[0];
            obj.host = node.host;
            obj.meshid = node.meshid;

            // Check if this user has permission to manage this computer
            if ((parent.GetNodeRights(obj.user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

            // Setup TCP client
            obj.client = new net.Socket();
            obj.client.bytesReadEx = 0;
            obj.client.bytesWrittenEx = 0;
            obj.client.connect(obj.tcpport, node.host, function () {
                // Log the start of the connection
                var protocolStr = req.query.p;
                if (req.query.p == 10) { protocolStr = 'RDP'; }
                else if (req.query.p == 11) { protocolStr = 'SSH-TERM'; }
                else if (req.query.p == 12) { protocolStr = 'VNC'; }
                else if (req.query.p == 13) { protocolStr = 'SSH-FILES'; }
                obj.time = Date.now();
                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: obj.user._id, username: obj.user.name, msgid: 120, msgArgs: [obj.id, protocolStr, obj.host], msg: 'Started local relay session \"' + obj.id + '\", protocol ' + protocolStr + ' to ' + obj.host, nodeid: req.query.nodeid, protocol: req.query.p };
                if (obj.guestname) { event.guestname = obj.guestname; } // If this is a sharing session, set the guest name here.
                parent.parent.DispatchEvent(['*', obj.user._id, obj.meshid, obj.nodeid], obj, event);

                // Count the session
                if (parent.trafficStats.localRelayCount[protocolInUse]) { parent.trafficStats.localRelayCount[protocolInUse] += 1; } else { parent.trafficStats.localRelayCount[protocolInUse] = 1; }

                // Start the session
                ws.send('c');
                ws._socket.resume();
            });
            obj.client.on('data', function (data) {
                // Perform data accounting
                dataAccounting();
                // Perform relay
                try { this.pause(); ws.send(data, this.clientResume); } catch (ex) { console.log(ex); }
            }); 
            obj.client.on('close', function () { obj.close(); });
            obj.client.on('error', function (err) { obj.close(); });
            obj.client.clientResume = function () { try { obj.client.resume(); } catch (ex) { console.log(ex); } };
        });
    }

    ws.flushSink = function () { try { ws._socket.resume(); } catch (ex) { console.log(ex); } };

    // When data is received from the mesh relay web socket
    ws.on('message', function (data) { if (typeof data != 'string') { try { ws._socket.pause(); obj.client.write(data, ws.flushSink); } catch (ex) { } } }); // Perform relay

    // If error, close both sides of the relay.
    ws.on('error', function (err) { parent.relaySessionErrorCount++; obj.close(); });

    // Relay web socket is closed
    ws.on('close', function (req) { obj.close(); });

    // If this is not an authenticated session, or the session does not have routing instructions, just go ahead an connect to existing session.
    performRelay();
    return obj;
};