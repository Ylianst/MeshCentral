/**
* @description MeshCentral MeshAgent
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

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshUser = function (parent, db, ws, req, args, domain, user) {
    const fs = require('fs');
    const path = require('path');
    const common = parent.common;
    // Cross domain messages, for cross-domain administrators only.
    const allowedCrossDomainMessages = ['accountcreate', 'accountremove', 'accountchange', 'createusergroup', 'deleteusergroup', 'usergroupchange'];

    // User Consent Flags
    const USERCONSENT_DesktopNotifyUser = 1;
    const USERCONSENT_TerminalNotifyUser = 2;
    const USERCONSENT_FilesNotifyUser = 4;
    const USERCONSENT_DesktopPromptUser = 8;
    const USERCONSENT_TerminalPromptUser = 16;
    const USERCONSENT_FilesPromptUser = 32;
    const USERCONSENT_ShowConnectionToolbar = 64;

    // Mesh Rights
    const MESHRIGHT_EDITMESH            = 0x00000001;
    const MESHRIGHT_MANAGEUSERS         = 0x00000002;
    const MESHRIGHT_MANAGECOMPUTERS     = 0x00000004;
    const MESHRIGHT_REMOTECONTROL       = 0x00000008;
    const MESHRIGHT_AGENTCONSOLE        = 0x00000010;
    const MESHRIGHT_SERVERFILES         = 0x00000020;
    const MESHRIGHT_WAKEDEVICE          = 0x00000040;
    const MESHRIGHT_SETNOTES            = 0x00000080;
    const MESHRIGHT_REMOTEVIEWONLY      = 0x00000100;
    const MESHRIGHT_NOTERMINAL          = 0x00000200;
    const MESHRIGHT_NOFILES             = 0x00000400;
    const MESHRIGHT_NOAMT               = 0x00000800;
    const MESHRIGHT_DESKLIMITEDINPUT    = 0x00001000;
    const MESHRIGHT_LIMITEVENTS         = 0x00002000;
    const MESHRIGHT_CHATNOTIFY          = 0x00004000;
    const MESHRIGHT_UNINSTALL           = 0x00008000;
    const MESHRIGHT_NODESKTOP           = 0x00010000;
    const MESHRIGHT_REMOTECOMMAND       = 0x00020000;
    const MESHRIGHT_RESETOFF            = 0x00040000;
    const MESHRIGHT_GUESTSHARING        = 0x00080000;
    const MESHRIGHT_ADMIN               = 0xFFFFFFFF;

    // Site rights
    const SITERIGHT_SERVERBACKUP        = 0x00000001;
    const SITERIGHT_MANAGEUSERS         = 0x00000002;
    const SITERIGHT_SERVERRESTORE       = 0x00000004;
    const SITERIGHT_FILEACCESS          = 0x00000008;
    const SITERIGHT_SERVERUPDATE        = 0x00000010;
    const SITERIGHT_LOCKED              = 0x00000020;
    const SITERIGHT_NONEWGROUPS         = 0x00000040;
    const SITERIGHT_NOMESHCMD           = 0x00000080;
    const SITERIGHT_USERGROUPS          = 0x00000100;
    const SITERIGHT_RECORDINGS          = 0x00000200;
    const SITERIGHT_LOCKSETTINGS        = 0x00000400;
    const SITERIGHT_ALLEVENTS           = 0x00000800;
    const SITERIGHT_ADMIN               = 0xFFFFFFFF;

    // Events
    /*
    var eventsMessageId = {
        1: "Account login",
        2: "Account logout",
        3: "Changed language from {1} to {2}",
        4: "Joined desktop multiplex session",
        5: "Left the desktop multiplex session",
        6: "Started desktop multiplex session",
        7: "Finished recording session, {0} second(s)",
        8: "Closed desktop multiplex session, {0} second(s)"
    };
    */

    var obj = {};
    obj.user = user;
    obj.domain = domain;
    obj.ws = ws;

    // Check if we are a cross-domain administrator
    if (parent.parent.config.settings.managecrossdomain && (parent.parent.config.settings.managecrossdomain.indexOf(user._id) >= 0)) { obj.crossDomain = true; }

    // Server side Intel AMT stack
    const WsmanComm = require('./amt/amt-wsman-comm.js');
    const Wsman = require('./amt/amt-wsman.js');
    const Amt = require('./amt/amt.js');

    // Send a message to the user
    //obj.send = function (data) { try { if (typeof data == 'string') { ws.send(Buffer.from(data, 'binary')); } else { ws.send(data); } } catch (e) { } }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (addr.startsWith('::ffff:')) { return addr.substring(7); } else { return addr; } }

    // Send a PING/PONG message
    function sendPing() { obj.ws.send('{"action":"ping"}'); }
    function sendPong() { obj.ws.send('{"action":"pong"}'); }

    // Setup the agent PING/PONG timers
    if ((typeof args.browserping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, args.browserping * 1000); }
    else if ((typeof args.browserpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, args.browserpong * 1000); }

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug('user', 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug('user', 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket

        // Perform timer cleanup
        if (obj.pingtimer) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Perform cleanup
        parent.parent.RemoveAllEventDispatch(ws);
        if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); delete obj.serverStatsTimer; }
        if (req.session && req.session.ws && req.session.ws == ws) { delete req.session.ws; }
        if (parent.wssessions2[ws.sessionId]) { delete parent.wssessions2[ws.sessionId]; }
        if ((obj.user != null) && (parent.wssessions[obj.user._id])) {
            var i = parent.wssessions[obj.user._id].indexOf(ws);
            if (i >= 0) {
                parent.wssessions[obj.user._id].splice(i, 1);
                var user = parent.users[obj.user._id];
                if (user) {
                    if (parent.parent.multiServer == null) {
                        var targets = ['*', 'server-users'];
                        if (obj.user.groups) { for (var i in obj.user.groups) { targets.push('server-users:' + i); } }
                        parent.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', userid: user._id, username: user.name, count: parent.wssessions[obj.user._id].length, nolog: 1, domain: domain.id });
                    } else {
                        parent.recountSessions(ws.sessionId); // Recount sessions
                    }
                }
                if (parent.wssessions[obj.user._id].length == 0) { delete parent.wssessions[obj.user._id]; }
            }
        }

        // If we have peer servers, inform them of the disconnected session
        if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'sessionEnd', sessionid: ws.sessionId }); }

        // Aggressive cleanup
        if (obj.user) { delete obj.user; }
        if (obj.domain) { delete obj.domain; }
        if (ws.userid) { delete ws.userid; }
        if (ws.domainid) { delete ws.domainid; }
        if (ws.sessionId) { delete ws.sessionId; }
        if (ws.HandleEvent) { delete ws.HandleEvent; }
        ws.removeAllListeners(['message', 'close', 'error']);
    };

    // Convert a mesh path array into a real path on the server side
    function meshPathToRealPath(meshpath, user) {
        if (common.validateArray(meshpath, 1) == false) return null;
        var splitid = meshpath[0].split('/');
        if (splitid[0] == 'user') {
            // Check user access
            if (meshpath[0] != user._id) return null; // Only allow own user folder
        } else if (splitid[0] == 'mesh') {
            // Check mesh access
            if ((parent.GetMeshRights(user, meshpath[0]) & MESHRIGHT_SERVERFILES) == 0) return null; // This user must have mesh rights to "server files"
        } else return null;
        var rootfolder = meshpath[0], rootfoldersplit = rootfolder.split('/'), domainx = 'domain';
        if (rootfoldersplit[1].length > 0) domainx = 'domain-' + rootfoldersplit[1];
        var path = parent.path.join(parent.filespath, domainx, rootfoldersplit[0] + '-' + rootfoldersplit[2]);
        for (var i = 1; i < meshpath.length; i++) { if (common.IsFilenameValid(meshpath[i]) == false) { path = null; break; } path += ("/" + meshpath[i]); }
        return path;
    }

    // Copy a file using the best technique available
    function copyFile(src, dest, func, tag) {
        if (fs.copyFile) {
            // NodeJS v8.5 and higher
            fs.copyFile(src, dest, function (err) { func(tag); })
        } else {
            // Older NodeJS
            try {
                var ss = fs.createReadStream(src), ds = fs.createWriteStream(dest);
                ss.on('error', function () { func(tag); });
                ds.on('error', function () { func(tag); });
                ss.pipe(ds);
                ds.ss = ss;
                if (arguments.length == 3 && typeof arguments[2] === 'function') { ds.on('close', arguments[2]); }
                else if (arguments.length == 4 && typeof arguments[3] === 'function') { ds.on('close', arguments[3]); }
                ds.on('close', function () { func(tag); });
            } catch (ex) { }
        }
    }

    // Route a command to a target node
    function routeCommandToNode(command, requiredRights, requiredNonRights, func) {
        if (common.validateString(command.nodeid, 8, 128) == false) { if (func) { func(false); } return false; }
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domain.id)) {
            // See if the node is connected
            var agent = parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                parent.GetNodeWithRights(domain, user, agent.dbNodeKey, function (node, rights, visible) {
                    var mesh = parent.meshes[agent.dbMeshKey];
                    if ((node != null) && (mesh != null) && ((rights & MESHRIGHT_REMOTECONTROL) || (rights & MESHRIGHT_REMOTEVIEWONLY))) { // 8 is remote control permission, 256 is desktop read only
                        if ((requiredRights != null) && ((rights & requiredRights) == 0)) { if (func) { func(false); return; } } // Check Required Rights
                        if ((requiredNonRights != null) && (rights != MESHRIGHT_ADMIN) && ((rights & requiredNonRights) != 0)) { if (func) { func(false); return; } } // Check Required None Rights

                        command.sessionid = ws.sessionId;   // Set the session id, required for responses
                        command.rights = rights;            // Add user rights flags to the message
                        command.consent = 0;
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        if (typeof mesh.consent == 'number') { command.consent |= mesh.consent; } // Add device group user consent
                        if (typeof node.consent == 'number') { command.consent |= node.consent; } // Add node user consent
                        if (typeof user.consent == 'number') { command.consent |= user.consent; } // Add user consent

                        // Check if we need to add consent flags because of a user group link
                        if ((user.links != null) && (user.links[mesh._id] == null) && (user.links[node._id] == null)) {
                            // This user does not have a direct link to the device group or device. Find all user groups the would cause the link.
                            for (var i in user.links) {
                                var ugrp = parent.userGroups[i];
                                if ((ugrp != null) && (ugrp.consent != null) && (ugrp.links != null) && ((ugrp.links[mesh._id] != null) || (ugrp.links[node._id] != null))) {
                                    command.consent |= ugrp.consent; // Add user group consent flags
                                }
                            }
                        }

                        command.username = user.name;       // Add user name
                        command.realname = user.realname;   // Add real name
                        command.userid = user._id;          // Add user id
                        command.remoteaddr = req.clientIp;  // User's IP address
                        if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                        delete command.nodeid;              // Remove the nodeid since it's implied
                        try { agent.send(JSON.stringify(command)); } catch (ex) { }
                    } else { if (func) { func(false); } }
                });
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerIdNotSelf(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if ((requiredRights != null) && ((rights & requiredRights) == 0)) { if (func) { func(false); return; } } // Check Required Rights
                        if ((requiredNonRights != null) && (rights != MESHRIGHT_ADMIN) && ((rights & requiredNonRights) != 0)) { if (func) { func(false); return; } } // Check Required None Rights

                        var mesh = parent.meshes[routing.meshid];
                        if ((node != null) && (mesh != null) && ((rights & MESHRIGHT_REMOTECONTROL) || (rights & MESHRIGHT_REMOTEVIEWONLY))) { // 8 is remote control permission
                            command.fromSessionid = ws.sessionId;   // Set the session id, required for responses
                            command.rights = rights;                // Add user rights flags to the message
                            command.consent = 0;
                            if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                            if (typeof mesh.consent == 'number') { command.consent |= mesh.consent; } // Add device group user consent
                            if (typeof node.consent == 'number') { command.consent |= node.consent; } // Add node user consent
                            if (typeof user.consent == 'number') { command.consent |= user.consent; } // Add user consent

                            // Check if we need to add consent flags because of a user group link
                            if ((user.links != null) && (user.links[mesh._id] == null) && (user.links[node._id] == null)) {
                                // This user does not have a direct link to the device group or device. Find all user groups the would cause the link.
                                for (var i in user.links) {
                                    var ugrp = parent.userGroups[i];
                                    if ((ugrp != null) && (ugrp.consent != null) && (ugrp.links != null) && ((ugrp.links[mesh._id] != null) || (ugrp.links[node._id] != null))) {
                                        command.consent |= ugrp.consent; // Add user group consent flags
                                    }
                                }
                            }

                            command.username = user.name;           // Add user name
                            command.realname = user.realname;       // Add real name
                            command.userid = user._id;              // Add user id
                            command.remoteaddr = req.clientIp;      // User's IP address
                            if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                            parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        } else { if (func) { func(false); } }
                    });
                } else { if (func) { func(false); } return false; }
            }
        } else { if (func) { func(false); } return false; }
        if (func) { func(true); }
        return true;
    }

    // Route a command to all targets in a mesh
    function routeCommandToMesh(meshid, command) {
        // If we have peer servers, inform them of this command to send to all agents of this device group
        if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'agentMsgByMeshId', meshid: meshid, command: command }); }

        // See if the node is connected
        for (var nodeid in parent.wsagents) {
            var agent = parent.wsagents[nodeid];
            if (agent.dbMeshKey == meshid) { try { agent.send(JSON.stringify(command)); } catch (ex) { } }
        }
        return true;
    }

    try {
        // Check if the user is logged in
        if (user == null) { try { ws.close(); } catch (e) { } return; }

        // Check if we have exceeded the user session limit
        if ((typeof domain.limits.maxusersessions == 'number') || (typeof domain.limits.maxsingleusersessions == 'number')) {
            // Count the number of user sessions for this domain
            var domainUserSessionCount = 0, selfUserSessionCount = 0;
            for (var i in parent.wssessions2) {
                if (parent.wssessions2[i].domainid == domain.id) {
                    domainUserSessionCount++; if (parent.wssessions2[i].userid == user._id) { selfUserSessionCount++; }
                }
            }

            // Check if we have too many user sessions
            if (((typeof domain.limits.maxusersessions == 'number') && (domainUserSessionCount >= domain.limits.maxusersessions)) || ((typeof domain.limits.maxsingleusersessions == 'number') && (selfUserSessionCount >= domain.limits.maxsingleusersessions))) {
                ws.send(JSON.stringify({ action: 'stopped', msg: 'Session count exceed' }));
                try { ws.close(); } catch (e) { }
                return;
            }
        }

        // Associate this websocket session with the web session
        ws.userid = user._id;
        ws.domainid = domain.id;

        // Create a new session id for this user.
        parent.crypto.randomBytes(20, function (err, randombuf) {
            ws.sessionId = user._id + '/' + randombuf.toString('hex');

            // Add this web socket session to session list
            parent.wssessions2[ws.sessionId] = ws;
            if (!parent.wssessions[user._id]) { parent.wssessions[user._id] = [ws]; } else { parent.wssessions[user._id].push(ws); }
            if (parent.parent.multiServer == null) {
                var targets = ['*', 'server-users'];
                if (obj.user.groups) { for (var i in obj.user.groups) { targets.push('server-users:' + i); } }
                parent.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', userid: user._id, username: user.name, count: parent.wssessions[user._id].length, nolog: 1, domain: domain.id });
            } else {
                parent.recountSessions(ws.sessionId); // Recount sessions
            }

            // If we have peer servers, inform them of the new session
            if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'sessionStart', sessionid: ws.sessionId }); }

            // Handle events
            ws.HandleEvent = function (source, event, ids, id) {
                // Normally, only allow this user to receive messages from it's own domain.
                // If the user is a cross domain administrator, allow some select messages from different domains.
                if ((event.domain == null) || (event.domain == domain.id) || ((obj.crossDomain === true) && (allowedCrossDomainMessages.indexOf(event.action) >= 0))) {
                    try {
                        if (event == 'close') { try { delete req.session; } catch (ex) { } obj.close(); }
                        else if (event == 'resubscribe') { user.subscriptions = parent.subscribe(user._id, ws); }
                        else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                        else {
                            // Because of the device group "Show Self Events Only", we need to do more checks here.
                            if (id.startsWith('mesh/')) {
                                // Check if we have rights to get this message. If we have limited events on this mesh, don't send the event to the user.
                                var meshrights = parent.GetMeshRights(user, id);
                                if ((meshrights === MESHRIGHT_ADMIN) || ((meshrights & MESHRIGHT_LIMITEVENTS) == 0) || (ids.indexOf(user._id) >= 0)) {
                                    // We have the device group rights to see this event or we are directly targetted by the event
                                    ws.send(JSON.stringify({ action: 'event', event: event }));
                                } else {
                                    // Check if no other users are targeted by the event, if not, we can get this event.
                                    var userTarget = false;
                                    for (var i in ids) { if (ids[i].startsWith('user/')) { userTarget = true; } }
                                    if (userTarget == false) { ws.send(JSON.stringify({ action: 'event', event: event })); }
                                }
                            } else if (event.ugrpid != null) {
                                if ((user.siteadmin & SITERIGHT_USERGROUPS) != 0) {
                                    // If we have the rights to see users in a group, send the group as is.
                                    ws.send(JSON.stringify({ action: 'event', event: event }));
                                } else {
                                    // We don't have the rights to see otehr users in the user group, remove the links that are not for ourselves.
                                    var links = {};
                                    if (event.links) { for (var i in event.links) { if ((i == user._id) || i.startsWith('mesh/') || i.startsWith('node/')) { links[i] = event.links[i]; } } }
                                    ws.send(JSON.stringify({ action: 'event', event: { ugrpid: event.ugrpid, domain: event.domain, time: event.time, name: event.name, action: event.action, username: event.username, links: links, h: event.h } }));
                                }
                            } else {
                                // This is not a device group event, we can get this event.
                                ws.send(JSON.stringify({ action: 'event', event: event }));
                            }
                        }
                    } catch (e) { }
                }
            };

            user.subscriptions = parent.subscribe(user._id, ws); // Subscribe to events
            try { ws._socket.setKeepAlive(true, 240000); } catch (ex) { } // Set TCP keep alive

            // Send current server statistics
            obj.SendServerStats = function () {
                // Take a look at server stats
                var os = require('os');
                var stats = { action: 'serverstats', totalmem: os.totalmem(), freemem: os.freemem() };
                if (parent.parent.platform != 'win32') {
                    stats.cpuavg = os.loadavg();
                    try { stats.availablemem = 1024 * Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]); } catch (ex) { }
                }

                // Count the number of device groups that are not deleted
                var activeDeviceGroups = 0;
                for (var i in parent.meshes) { if (parent.meshes[i].deleted == null) { activeDeviceGroups++; } } // This is not ideal for performance, we want to dome something better.
                var serverStats = {
                    UserAccounts: Object.keys(parent.users).length,
                    DeviceGroups: activeDeviceGroups,
                    AgentSessions: Object.keys(parent.wsagents).length,
                    ConnectedUsers: Object.keys(parent.wssessions).length,
                    UsersSessions: Object.keys(parent.wssessions2).length,
                    RelaySessions: parent.relaySessionCount,
                    RelayCount: Object.keys(parent.wsrelays).length
                };
                if (parent.relaySessionErrorCount != 0) { serverStats.RelayErrors = parent.relaySessionErrorCount; }
                if (parent.parent.mpsserver != null) {
                    serverStats.ConnectedIntelAMT = 0;
                    for (var i in parent.parent.mpsserver.ciraConnections) { serverStats.ConnectedIntelAMT += parent.parent.mpsserver.ciraConnections[i].length; }
                }

                // Take a look at agent errors
                var agentstats = parent.getAgentStats();
                var errorCounters = {}, errorCountersCount = 0;
                if (agentstats.meshDoesNotExistCount > 0) { errorCountersCount++; errorCounters.UnknownGroup = agentstats.meshDoesNotExistCount; }
                if (agentstats.invalidPkcsSignatureCount > 0) { errorCountersCount++; errorCounters.InvalidPKCSsignature = agentstats.invalidPkcsSignatureCount; }
                if (agentstats.invalidRsaSignatureCount > 0) { errorCountersCount++; errorCounters.InvalidRSAsignature = agentstats.invalidRsaSignatureCount; }
                if (agentstats.invalidJsonCount > 0) { errorCountersCount++; errorCounters.InvalidJSON = agentstats.invalidJsonCount; }
                if (agentstats.unknownAgentActionCount > 0) { errorCountersCount++; errorCounters.UnknownAction = agentstats.unknownAgentActionCount; }
                if (agentstats.agentBadWebCertHashCount > 0) { errorCountersCount++; errorCounters.BadWebCertificate = agentstats.agentBadWebCertHashCount; }
                if ((agentstats.agentBadSignature1Count + agentstats.agentBadSignature2Count) > 0) { errorCountersCount++; errorCounters.BadSignature = (agentstats.agentBadSignature1Count + agentstats.agentBadSignature2Count); }
                if (agentstats.agentMaxSessionHoldCount > 0) { errorCountersCount++; errorCounters.MaxSessionsReached = agentstats.agentMaxSessionHoldCount; }
                if ((agentstats.invalidDomainMeshCount + agentstats.invalidDomainMesh2Count) > 0) { errorCountersCount++; errorCounters.UnknownDeviceGroup = (agentstats.invalidDomainMeshCount + agentstats.invalidDomainMesh2Count); }
                if ((agentstats.invalidMeshTypeCount + agentstats.invalidMeshType2Count) > 0) { errorCountersCount++; errorCounters.InvalidDeviceGroupType = (agentstats.invalidMeshTypeCount + agentstats.invalidMeshType2Count); }
                //if (agentstats.duplicateAgentCount > 0) { errorCountersCount++; errorCounters.DuplicateAgent = agentstats.duplicateAgentCount; }

                // Send out the stats
                stats.values = { ServerState: serverStats }
                if (errorCountersCount > 0) { stats.values.AgentErrorCounters = errorCounters; }
                try { ws.send(JSON.stringify(stats)); } catch (ex) { }
            }

            // When data is received from the web socket
            ws.on('message', processWebSocketData);

            // If error, do nothing
            ws.on('error', function (err) { console.log(err); obj.close(0); });

            // If the web socket is closed
            ws.on('close', function (req) { obj.close(0); });

            // Figure out the MPS port, use the alias if set
            var mpsport = ((args.mpsaliasport != null) ? args.mpsaliasport : args.mpsport);
            var httpport = ((args.aliasport != null) ? args.aliasport : args.port);

            // Build server information object
            var serverinfo = { domain: domain.id, name: domain.dns ? domain.dns : parent.certificates.CommonName, mpsname: parent.certificates.AmtMpsName, mpsport: mpsport, mpspass: args.mpspass, port: httpport, emailcheck: ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (args.lanonly != true) && (parent.certificates.CommonName != null) && (parent.certificates.CommonName.indexOf('.') != -1) && (user._id.split('/')[2].startsWith('~') == false)), domainauth: (domain.auth == 'sspi'), serverTime: Date.now() };
            serverinfo.languages = parent.renderLanguages;
            serverinfo.tlshash = Buffer.from(parent.webCertificateFullHashs[domain.id], 'binary').toString('hex').toUpperCase(); // SHA384 of server HTTPS certificate
            serverinfo.agentCertHash = parent.agentCertificateHashBase64;
            if ((domain.sessionrecording) && (domain.sessionrecording.onlyselecteddevicegroups === true)) { serverinfo.devGroupSessionRecording = 1; } // Allow enabling of session recording
            if ((parent.parent.config.domains[domain.id].amtacmactivation != null) && (parent.parent.config.domains[domain.id].amtacmactivation.acmmatch != null)) {
                var matchingDomains = [];
                for (var i in parent.parent.config.domains[domain.id].amtacmactivation.acmmatch) {
                    var cn = parent.parent.config.domains[domain.id].amtacmactivation.acmmatch[i].cn;
                    if ((cn != '*') && (matchingDomains.indexOf(cn) == -1)) { matchingDomains.push(cn); }
                }
                if (matchingDomains.length > 0) { serverinfo.amtAcmFqdn = matchingDomains; }
            }
            if ((typeof domain.altmessenging == 'object') && (typeof domain.altmessenging.name == 'string') && (typeof domain.altmessenging.url == 'string')) { serverinfo.altmessenging = [{ name: domain.altmessenging.name, url: domain.altmessenging.url }]; }
            if (typeof domain.devicemeshrouterlinks == 'object') { serverinfo.devicemeshrouterlinks = domain.devicemeshrouterlinks; }
            if (Array.isArray(domain.altmessenging)) { serverinfo.altmessenging = []; for (var i in domain.altmessenging) { if ((typeof domain.altmessenging[i] == 'object') && (typeof domain.altmessenging[i].name == 'string') && (typeof domain.altmessenging[i].url == 'string')) { serverinfo.altmessenging.push({ name: domain.altmessenging[i].name, url: domain.altmessenging[i].url }); } } }
            serverinfo.https = true;
            serverinfo.redirport = args.redirport;
            if (parent.parent.webpush != null) { serverinfo.vapidpublickey = parent.parent.webpush.vapidPublicKey; } // Web push public key

            // Build the mobile agent URL, this is used to connect mobile devices
            var agentServerName = parent.getWebServerName(domain);
            if (typeof parent.args.agentaliasdns == 'string') { agentServerName = parent.args.agentaliasdns; }
            var xdomain = (domain.dns == null) ? domain.id : '';
            var agentHttpsPort = ((parent.args.aliasport == null) ? parent.args.port : parent.args.aliasport); // Use HTTPS alias port is specified
            if (parent.args.agentport != null) { agentHttpsPort = parent.args.agentport; } // If an agent only port is enabled, use that.
            if (parent.args.agentaliasport != null) { agentHttpsPort = parent.args.agentaliasport; } // If an agent alias port is specified, use that.
            serverinfo.magenturl = 'mc://' + agentServerName + ((agentHttpsPort != 443)?(':' + agentHttpsPort):'') + ((xdomain != '')?('/' + xdomain):'');

            if (domain.guestdevicesharing === false) { serverinfo.guestdevicesharing = false; }
            if (typeof domain.userconsentflags == 'number') { serverinfo.consent = domain.userconsentflags; }
            if ((typeof domain.usersessionidletimeout == 'number') && (domain.usersessionidletimeout > 0)) { serverinfo.timeout = (domain.usersessionidletimeout * 60 * 1000); }
            if (user.siteadmin === SITERIGHT_ADMIN) {
                if (parent.parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) { serverinfo.manageAllDeviceGroups = true; }
                if (obj.crossDomain === true) { serverinfo.crossDomain = []; for (var i in parent.parent.config.domains) { serverinfo.crossDomain.push(i); } }
            }
            if (typeof domain.terminal == 'object') { // Settings used for remote terminal feature
                if ((typeof domain.terminal.linuxshell == 'string') && (domain.terminal.linuxshell != 'any')) { serverinfo.linuxshell = domain.terminal.linuxshell; }
            }

            // Send server information
            try { ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: serverinfo })); } catch (ex) { }

            // Send user information to web socket, this is the first thing we send
            try { ws.send(JSON.stringify({ action: 'userinfo', userinfo: parent.CloneSafeUser(parent.users[user._id]) })); } catch (ex) { }

            if (user.siteadmin === SITERIGHT_ADMIN) {
                // Check if tracing is allowed for this domain
                if ((domain.myserver !== false) && ((domain.myserver == null) || (domain.myserver.trace === true))) {
                    // Send server tracing information
                    try { ws.send(JSON.stringify({ action: 'traceinfo', traceSources: parent.parent.debugRemoteSources })); } catch (ex) { }
                }

                // Send any server warnings if any
                var serverWarnings = parent.parent.getServerWarnings();
                if (serverWarnings.length > 0) { try { ws.send(JSON.stringify({ action: 'serverwarnings', warnings: serverWarnings })); } catch (ex) { } }
            }

            // See how many times bad login attempts where made since the last login
            const lastLoginTime = parent.users[user._id].pastlogin;
            if (lastLoginTime != null) {
                db.GetFailedLoginCount(user.name, user.domain, new Date(lastLoginTime * 1000), function (count) {
                    if (count > 0) { try { ws.send(JSON.stringify({ action: 'msg', type: 'notify', title: "Security Warning", tag: 'ServerNotify', id: Math.random(), value: "There has been " + count + " failed login attempts on this account since the last login.", titleid: 3, msgid: 12, args: [count] })); } catch (ex) { } delete user.pastlogin; }
                });
            }

            // If we are site administrator and Google Drive backup is setup, send out the status.
            if ((user.siteadmin === SITERIGHT_ADMIN) && (domain.id == '') && (typeof parent.parent.config.settings.autobackup == 'object') && (typeof parent.parent.config.settings.autobackup.googledrive == 'object')) {
                db.Get('GoogleDriveBackup', function (err, docs) {
                    if (err != null) return;
                    if (docs.length == 0) { try { ws.send(JSON.stringify({ action: 'serverBackup', service: 'googleDrive', state: 1 })); } catch (ex) { } }
                    else { try { ws.send(JSON.stringify({ action: 'serverBackup', service: 'googleDrive', state: docs[0].state })); } catch (ex) { } }
                });
            }

            // We are all set, start receiving data
            ws._socket.resume();
            if (parent.parent.pluginHandler != null) parent.parent.pluginHandler.callHook('hook_userLoggedIn', user);
        });
    } catch (e) { console.log(e); }

    // Process incoming web socket data from the browser
    function processWebSocketData(msg) {
        var command, i = 0, mesh = null, meshid = null, nodeid = null, meshlinks = null, change = 0;
        try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
        if (common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

        switch (command.action) {
            case 'pong': { break; } // NOP
            case 'ping': { try { ws.send('{action:"pong"}'); } catch (ex) { } break; }
            case 'intersession':
                {
                    // Sends data between sessions of the same user
                    var sessions = parent.wssessions[obj.user._id];
                    if (sessions == null) break;

                    // Create the notification message and send on all sessions except our own (no echo back).
                    var notification = JSON.stringify(command);
                    for (var i in sessions) { if (sessions[i] != obj.ws) { try { sessions[i].send(notification); } catch (ex) { } } }

                    // TODO: Send the message of user sessions connected to other servers.

                    break;
                }
            case 'authcookie':
                {
                    // Renew the authentication cookie
                    try {
                        ws.send(JSON.stringify({
                            action: 'authcookie',
                            cookie: parent.parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: req.clientIp }, parent.parent.loginCookieEncryptionKey),
                            rcookie: parent.parent.encodeCookie({ ruserid: user._id }, parent.parent.loginCookieEncryptionKey)
                        }));
                    } catch (ex) { }
                    break;
                }
            case 'logincookie':
                {
                    // If allowed, return a login cookie
                    if (parent.parent.config.settings.allowlogintoken === true) {
                        try { ws.send(JSON.stringify({ action: 'logincookie', cookie: parent.parent.encodeCookie({ u: user._id, a: 3 }, parent.parent.loginCookieEncryptionKey) })); } catch (ex) { }
                    }
                    break;
                }
            case 'servertimelinestats':
                {
                    // Only accept if the "My Server" tab is allowed for this domain
                    if (domain.myserver === false) break;

                    if ((user.siteadmin & 21) == 0) return; // Only site administrators with "site backup" or "site restore" or "site update" permissions can use this.
                    if (common.validateInt(command.hours, 0, 24 * 30) == false) return;
                    db.GetServerStats(command.hours, function (err, docs) {
                        if (err == null) { try { ws.send(JSON.stringify({ action: 'servertimelinestats', events: docs })); } catch (ex) { } }
                    });
                    break;
                }
            case 'serverstats':
                {
                    // Only accept if the "My Server" tab is allowed for this domain
                    if (domain.myserver === false) break;

                    if ((user.siteadmin & 21) == 0) return; // Only site administrators with "site backup" or "site restore" or "site update" permissions can use this.
                    if (common.validateInt(command.interval, 1000, 1000000) == false) {
                        // Clear the timer
                        if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); delete obj.serverStatsTimer; }
                    } else {
                        // Set the timer
                        obj.SendServerStats();
                        obj.serverStatsTimer = setInterval(obj.SendServerStats, command.interval);
                    }
                    break;
                }
            case 'meshes':
                {
                    // Request a list of all meshes this user as rights to
                    try { ws.send(JSON.stringify({ action: 'meshes', meshes: parent.GetAllMeshWithRights(user).map(parent.CloneSafeMesh), tag: command.tag })); } catch (ex) { }
                    break;
                }
            case 'nodes':
                {
                    var links = [], extraids = null, err = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                        if (command.meshid == null) { err = 'Invalid group id'; }
                    }

                    if (err == null) {
                        try {
                            if (command.meshid == null) {
                                // Request a list of all meshes this user as rights to
                                links = parent.GetAllMeshIdWithRights(user);

                                // Add any nodes with direct rights or any nodes with user group direct rights
                                if (obj.user.links != null) {
                                    for (var i in obj.user.links) {
                                        if (i.startsWith('node/')) { if (extraids == null) { extraids = []; } extraids.push(i); }
                                        else if (i.startsWith('ugrp/')) {
                                            const g = parent.userGroups[i];
                                            if ((g != null) && (g.links != null)) {
                                                for (var j in g.links) { if (j.startsWith('node/')) { if (extraids == null) { extraids = []; } extraids.push(j); } }
                                            }
                                        }
                                    }
                                }
                            } else {
                                // Request list of all nodes for one specific meshid
                                meshid = command.meshid;
                                if (common.validateString(meshid, 0, 128) == false) { err = 'Invalid group id'; } else {
                                    if (meshid.split('/').length == 1) { meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                                    if (parent.IsMeshViewable(user, meshid)) { links.push(meshid); } else { err = 'Invalid group id'; }
                                }
                            }
                        } catch (ex) { err = 'Validation exception: ' + ex; }
                    }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'nodes', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Request a list of all nodes
                    db.GetAllTypeNoTypeFieldMeshFiltered(links, extraids, domain.id, 'node', command.id, function (err, docs) {
                        if (docs == null) { docs = []; }
                        parent.common.unEscapeAllLinksFieldName(docs);

                        var r = {};
                        for (i in docs) {
                            // Check device links, if a link points to an unknown user, remove it.
                            parent.cleanDevice(docs[i]);

                            // Remove any connectivity and power state information, that should not be in the database anyway.
                            // TODO: Find why these are sometimes saved in the db.
                            if (docs[i].conn != null) { delete docs[i].conn; }
                            if (docs[i].pwr != null) { delete docs[i].pwr; }
                            if (docs[i].agct != null) { delete docs[i].agct; }
                            if (docs[i].cict != null) { delete docs[i].cict; }

                            // Add the connection state
                            var state = parent.parent.GetConnectivityState(docs[i]._id);
                            if (state) {
                                docs[i].conn = state.connectivity;
                                docs[i].pwr = state.powerState;
                                if ((state.connectivity & 1) != 0) { var agent = parent.wsagents[docs[i]._id]; if (agent != null) { docs[i].agct = agent.connectTime; } }

                                // Use the connection time of the CIRA/Relay connection
                                if ((state.connectivity & 2) != 0) {
                                    var ciraConnection = parent.parent.mpsserver.GetConnectionToNode(docs[i]._id, null, true);
                                    if ((ciraConnection != null) && (ciraConnection.tag != null)) { docs[i].cict = ciraConnection.tag.connectTime; }
                                }
                            }

                            // Compress the meshid's
                            meshid = docs[i].meshid;
                            if (!r[meshid]) { r[meshid] = []; }
                            delete docs[i].meshid;

                            // Remove push messaging token if present
                            if (docs[i].pmt != null) { docs[i].pmt = 1; }

                            // Remove Intel AMT credential if present
                            if (docs[i].intelamt != null) {
                                if (docs[i].intelamt.pass != null) { docs[i].intelamt.pass = 1; }
                                if (docs[i].intelamt.mpspass != null) { docs[i].intelamt.mpspass = 1; }
                            }

                            // If GeoLocation not enabled, remove any node location information
                            if (domain.geolocation != true) {
                                if (docs[i].iploc != null) { delete docs[i].iploc; }
                                if (docs[i].wifiloc != null) { delete docs[i].wifiloc; }
                                if (docs[i].gpsloc != null) { delete docs[i].gpsloc; }
                                if (docs[i].userloc != null) { delete docs[i].userloc; }
                            }

                            // Add device sessions
                            const xagent = parent.wsagents[docs[i]._id];
                            if ((xagent != null) && (xagent.sessions != null)) { docs[i].sessions = xagent.sessions; }

                            r[meshid].push(docs[i]);
                        }
                        try { ws.send(JSON.stringify({ action: 'nodes', responseid: command.responseid, nodes: r, tag: command.tag })); } catch (ex) { }
                    });
                    break;
                }
            case 'powertimeline':
                {
                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) return;
                        // Query the database for the power timeline for a given node
                        // The result is a compacted array: [ startPowerState, startTimeUTC, powerState ] + many[ deltaTime, powerState ]
                        db.getPowerTimeline(node._id, function (err, docs) {
                            if ((err == null) && (docs != null) && (docs.length > 0)) {
                                var timeline = [], time = null, previousPower;
                                for (i in docs) {
                                    var doc = docs[i], j = parseInt(i);
                                    doc.time = Date.parse(doc.time);
                                    if (time == null) { // First element
                                        // Skip all starting power 0 events.
                                        if ((doc.power == 0) && ((doc.oldPower == null) || (doc.oldPower == 0))) continue;
                                        time = doc.time;
                                        if (doc.oldPower) { timeline.push(doc.oldPower, time / 1000, doc.power); } else { timeline.push(0, time / 1000, doc.power); }
                                    } else if (previousPower != doc.power) { // Delta element
                                        // If this event is of a short duration (2 minutes or less), skip it.
                                        if ((docs.length > (j + 1)) && ((Date.parse(docs[j + 1].time) - doc.time) < 120000)) continue;
                                        timeline.push((doc.time - time) / 1000, doc.power);
                                        time = doc.time;
                                    }
                                    previousPower = doc.power;
                                }
                                try { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: node._id, timeline: timeline, tag: command.tag })); } catch (ex) { }
                            } else {
                                // No records found, send current state if we have it
                                var state = parent.parent.GetConnectivityState(command.nodeid);
                                if (state != null) { try { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: node._id, timeline: [state.powerState, Date.now(), state.powerState], tag: command.tag })); } catch (ex) { } }
                            }
                        });
                    });
                    break;
                }
            case 'getsysinfo':
                {
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check the nodeid
                    if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) { try { ws.send(JSON.stringify({ action: 'getsysinfo', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' })); } catch (ex) { } return; }
                        // Query the database system information
                        db.Get('si' + command.nodeid, function (err, docs) {
                            if ((docs != null) && (docs.length > 0)) {
                                var doc = docs[0];
                                doc.action = 'getsysinfo';
                                doc.nodeid = node._id;
                                doc.tag = command.tag;
                                delete doc.type;
                                delete doc.domain;
                                delete doc._id;
                                if (command.nodeinfo === true) { doc.node = node; doc.rights = rights; }
                                try { ws.send(JSON.stringify(doc)); } catch (ex) { }
                            } else {
                                try { ws.send(JSON.stringify({ action: 'getsysinfo', nodeid: node._id, tag: command.tag, noinfo: true, result: 'Invalid device id' })); } catch (ex) { }
                            }
                        });
                    });
                    break;
                }
            case 'lastconnect':
                {
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check the nodeid
                    if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) { try { ws.send(JSON.stringify({ action: 'lastconnect', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' })); } catch (ex) { } return; }

                        // Query the database for the last time this node connected
                        db.Get('lc' + command.nodeid, function (err, docs) {
                            if ((docs != null) && (docs.length > 0)) {
                                try { ws.send(JSON.stringify({ action: 'lastconnect', nodeid: command.nodeid, time: docs[0].time, addr: docs[0].addr })); } catch (ex) { }
                            } else {
                                try { ws.send(JSON.stringify({ action: 'lastconnect', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'No data' })); } catch (ex) { }
                            }
                        });
                    });
                    break;
                }
            case 'files':
                {
                    // Send the full list of server files to the browser app
                    updateUserFiles(user, ws, domain);
                    break;
                }
            case 'fileoperation':
                {
                    // Check permissions
                    if ((user.siteadmin & 8) != 0) {
                        // Perform a file operation (Create Folder, Delete Folder, Delete File...)
                        if (common.validateString(command.fileop, 4, 16) == false) return;
                        var sendUpdate = true, path = meshPathToRealPath(command.path, user); // This will also check access rights
                        if (path == null) break;

                        if ((command.fileop == 'createfolder') && (common.IsFilenameValid(command.newfolder) == true)) {
                            // Create a new folder
                            try { fs.mkdirSync(path + '/' + command.newfolder); } catch (ex) {
                                try { fs.mkdirSync(path); } catch (ex) { }
                                try { fs.mkdirSync(path + '/' + command.newfolder); } catch (ex) { }
                            }
                        }
                        else if (command.fileop == 'delete') {
                            // Delete a file
                            if (common.validateArray(command.delfiles, 1) == false) return;
                            for (i in command.delfiles) {
                                if (common.IsFilenameValid(command.delfiles[i]) == true) {
                                    var fullpath = parent.path.join(path, command.delfiles[i]);
                                    if (command.rec == true) {
                                        try { deleteFolderRecursive(fullpath); } catch (ex) { } // TODO, make this an async function
                                    } else {
                                        try { fs.rmdirSync(fullpath); } catch (ex) { try { fs.unlinkSync(fullpath); } catch (xe) { } }
                                    }
                                }
                            }

                            // If we deleted something in the mesh root folder and the entire mesh folder is empty, remove it.
                            if (command.path.length == 1) {
                                try {
                                    if (command.path[0].startsWith('mesh//')) {
                                        path = meshPathToRealPath([command.path[0]], user);
                                        fs.readdir(path, function (err, dir) { if ((err == null) && (dir.length == 0)) { fs.rmdir(path, function (err) { }); } });
                                    }
                                } catch (ex) { }
                            }
                        }
                        else if ((command.fileop == 'rename') && (common.IsFilenameValid(command.oldname) === true) && (common.IsFilenameValid(command.newname) === true)) {
                            // Rename
                            try { fs.renameSync(path + '/' + command.oldname, path + '/' + command.newname); } catch (e) { }
                        }
                        else if ((command.fileop == 'copy') || (command.fileop == 'move')) {
                            // Copy or move of one or many files
                            if (common.validateArray(command.names, 1) == false) return;
                            var scpath = meshPathToRealPath(command.scpath, user); // This will also check access rights
                            if (scpath == null) break;
                            // TODO: Check quota if this is a copy!!!!!!!!!!!!!!!!
                            for (i in command.names) {
                                if (common.IsFilenameValid(command.names[i]) === true) {
                                    var s = parent.path.join(scpath, command.names[i]), d = parent.path.join(path, command.names[i]);
                                    sendUpdate = false;
                                    copyFile(s, d, function (op) { if (op != null) { fs.unlink(op, function (err) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); }); } else { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } }, ((command.fileop == 'move') ? s : null));
                                }
                            }
                        }

                        if (sendUpdate == true) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } // Fire an event causing this user to update this files
                    }
                    break;
                }
            case 'serverconsole':
                {
                    // This is a server console message, only process this if full administrator
                    if (user.siteadmin != SITERIGHT_ADMIN) break;

                    // Only accept if the console is allowed for this domain
                    if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.console !== true))) break;

                    var r = '';
                    var cmdargs = splitArgs(command.value);
                    if (cmdargs.length == 0) break;
                    const cmd = cmdargs[0].toLowerCase();
                    cmdargs = parseArgs(cmdargs);

                    switch (cmd) {
                        case 'help': {
                            var fin = '', f = '', availcommands = 'help,maintenance,info,versions,resetserver,usersessions,closeusersessions,tasklimiter,setmaxtasks,cores,migrationagents,agentstats,agentissues,webstats,mpsstats,swarmstats,acceleratorsstats,updatecheck,serverupdate,nodeconfig,heapdump,relays,autobackup,backupconfig,dupagents,dispatchtable,badlogins,showpaths,le,lecheck,leevents,dbstats,dbcounters,sms,amtacm,certhashes,watchdog,amtmanager';
                            if (parent.parent.config.settings.heapdump === true) { availcommands += ',heapdump'; }
                            availcommands = availcommands.split(',').sort();
                            while (availcommands.length > 0) { if (f.length > 80) { fin += (f + ',\r\n'); f = ''; } f += (((f != '') ? ', ' : ' ') + availcommands.shift()); }
                            if (f != '') { fin += f; }
                            if (cmdargs['_'].length == 0) {
                                r = 'Available commands: \r\n' + fin + '\r\nType help <command> for details.';
                            } else {
                                var cmd2 = cmdargs['_'][0].toLowerCase();
                                switch (cmd2) {
                                    case 'info': { r = "info: Returns the most immidiatly useful information about this server, including MeshCentral and NodeJS versions. This is often information required to file a bug."; break; }
                                    case 'versions': { r = "versions: Returns all internal versions for NodeJS running this server."; break; }
                                    case 'resetserver': { r = "resetserver: Causes the server to reset, this is sometimes useful is the config.json file was changed."; break; }
                                    case 'usersessions': { r = "usersessions: Returns a list of active sessions grouped by user."; break; }
                                    case 'closeusersessions': { r = "closeusersessions: Disconnects all sessions for a specified user."; break; }
                                    case 'tasklimiter': { r = "tasklimiter: Returns the internal status of the tasklimiter. This is a system used to smooth out work done by the server. It's used by, for example, agent updates so that not all agents are updated at the same time."; break; }
                                    default: { r = 'No help information about this command.'; break; }
                                }
                            }
                            break;
                        }
                        case 'webpush': {
                            if (parent.parent.webpush == null) {
                                r = "Web push not supported.";
                            } else {
                                if (cmdargs['_'].length != 1) {
                                    r = "Usage: WebPush \"Message\"";
                                } else {
                                    const pushSubscription = { "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABgIkO9hjXHWhMPiuk-ppNRw7r_pUZitddwCEK4ykdzeIxOIjFnYhIt_nr-qUca2mpZziwQsSEhYTUCiuYrhWnVDRweMtiUj16yJJq8V5jneaEaUYjEIe5jp3DOMNpoTm1aHgX74gCR8uTXSITcM97bNi-hRxcQ4f6Ie4WSAmoXpd89B_g", "keys": { "auth": "UB2sbLVK7ALnSHw5P1dahg", "p256dh": "BIoRbcNSxBuTjN39CCCUCHo1f4NxBJ1YDdu_k4MbPW_q3NK1_RufnydUzLPDp8ibBVItSI72-s48QJvOjQ_S8Ok" } }
                                    parent.parent.webpush.sendNotification(pushSubscription, cmdargs['_'][0]).then(
                                        function (value) { try { ws.send(JSON.stringify({ action: 'OK', value: r, tag: command.tag })); } catch (ex) { } },
                                        function (error) { try { ws.send(JSON.stringify({ action: 'Error', value: r, tag: command.tag })); } catch (ex) { } }
                                    );
                                }
                            }
                            break;
                        }
                        case 'amtmanager': {
                            if (parent.parent.amtManager == null) { r = 'Intel AMT Manager not active.'; } else { r = parent.parent.amtManager.getStatusString(); }
                            break;
                        }
                        case 'certhashes': {
                            r += 'AgentCertHash: ' + parent.agentCertificateHashHex;
                            for (var i in parent.webCertificateHashs) { r += '\r\nwebCertificateHash (' + i + '): ' + common.rstr2hex(parent.webCertificateHashs[i]); }
                            for (var i in parent.webCertificateFullHashs) { r += '\r\nwebCertificateFullHash (' + i + '): ' + common.rstr2hex(parent.webCertificateFullHashs[i]); }
                            r += '\r\ndefaultWebCertificateHash: ' + common.rstr2hex(parent.defaultWebCertificateHash);
                            r += '\r\ndefaultWebCertificateFullHash: ' + common.rstr2hex(parent.defaultWebCertificateFullHash);
                            break;
                        }
                        case 'amtacm': {
                            if ((domain.amtacmactivation == null) || (domain.amtacmactivation.acmmatch == null) || (domain.amtacmactivation.acmmatch.length == 0)) {
                                r = 'No Intel AMT activation certificates.';
                            } else {
                                if (domain.amtacmactivation.log != null) { r += '--- Activation Log ---\r\nFile  : ' + domain.amtacmactivation.log + '\r\n'; }
                                for (var i in domain.amtacmactivation.acmmatch) {
                                    var acmcert = domain.amtacmactivation.acmmatch[i];
                                    r += '--- Activation Certificate ' + (parseInt(i) + 1) + ' ---\r\nName  : ' + acmcert.cn + '\r\nSHA1  : ' + acmcert.sha1 + '\r\nSHA256: ' + acmcert.sha256 + '\r\n';
                                }
                            }
                            break;
                        }
                        case 'heapdump': {
                            // Heapdump support, see example at:
                            // https://www.arbazsiddiqui.me/a-practical-guide-to-memory-leaks-in-nodejs/
                            if (parent.parent.config.settings.heapdump === true) {
                                var dumpFileName = parent.path.join(parent.parent.datapath, `heapDump-${Date.now()}.heapsnapshot`);
                                try { ws.send(JSON.stringify({ action: 'serverconsole', value: "Generating dump file at: " + dumpFileName, tag: command.tag })); } catch (ex) { }
                                require('heapdump').writeSnapshot(dumpFileName, (err, filename) => {
                                    try { ws.send(JSON.stringify({ action: 'serverconsole', value: "Done.", tag: command.tag })); } catch (ex) { }
                                });
                            } else {
                                r = "Heapdump not supported, add \"heapdump\":true to settings section of config.json.";
                            }
                            break;
                        }
                        case 'sms': {
                            if (parent.parent.smsserver == null) {
                                r = "No SMS gateway in use.";
                            } else {
                                if (cmdargs['_'].length != 2) {
                                    r = "Usage: SMS \"PhoneNumber\" \"Message\".";
                                } else {
                                    parent.parent.smsserver.sendSMS(cmdargs['_'][0], cmdargs['_'][1], function (status, msg) {
                                        if (typeof msg == 'string') {
                                            try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? ('Success: ' + msg) : ('Failed: ' + msg), tag: command.tag })); } catch (ex) { }
                                        } else {
                                            try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? 'Success' : 'Failed', tag: command.tag })); } catch (ex) { }
                                        }
                                    });
                                }
                            }
                            break;
                        }
                        case 'email': {
                            if (domain.mailserver == null) {
                                r = "No email service enabled.";
                            } else {
                                if (cmdargs['_'].length != 3) {
                                    r = "Usage: email \"user@sample.com\" \"Subject\" \"Message\".";
                                } else {
                                    domain.mailserver.sendMail(cmdargs['_'][0], cmdargs['_'][1], cmdargs['_'][2]);
                                    r = "Done.";
                                }
                            }
                            break;
                        }
                        case 'le': {
                            if (parent.parent.letsencrypt == null) {
                                r = "Let's Encrypt not in use.";
                            } else {
                                r = JSON.stringify(parent.parent.letsencrypt.getStats(), null, 4);
                            }
                            break;
                        }
                        case 'lecheck': {
                            if (parent.parent.letsencrypt == null) {
                                r = "Let's Encrypt not in use.";
                            } else {
                                r = ["CertOK", "Request:NoCert", "Request:Expire", "Request:MissingNames"][parent.parent.letsencrypt.checkRenewCertificate()];
                            }
                            break;
                        }
                        case 'leevents': {
                            if (parent.parent.letsencrypt == null) {
                                r = "Let's Encrypt not in use.";
                            } else {
                                r = parent.parent.letsencrypt.events.join('\r\n');
                            }
                            break;
                        }
                        case 'badlogins': {
                            if (parent.parent.config.settings.maxinvalidlogin == false) {
                                r = 'Bad login filter is disabled.';
                            } else {
                                if (cmdargs['_'] == 'reset') {
                                    // Reset bad login table
                                    parent.badLoginTable = {};
                                    parent.badLoginTableLastClean = 0;
                                    r = 'Done.'
                                } else if (cmdargs['_'] == '') {
                                    // Show current bad login table
                                    if (typeof parent.parent.config.settings.maxinvalidlogin.coolofftime == 'number') {
                                        r = "Max is " + parent.parent.config.settings.maxinvalidlogin.count + " bad login(s) in " + parent.parent.config.settings.maxinvalidlogin.time + " minute(s), " + parent.parent.config.settings.maxinvalidlogin.coolofftime + " minute(s) cooloff.\r\n";
                                    } else {
                                        r = "Max is " + parent.parent.config.settings.maxinvalidlogin.count + " bad login(s) in " + parent.parent.config.settings.maxinvalidlogin.time + " minute(s).\r\n";
                                    }
                                    var badLoginCount = 0;
                                    parent.cleanBadLoginTable();
                                    for (var i in parent.badLoginTable) {
                                        badLoginCount++;
                                        if (typeof parent.badLoginTable[i] == 'number') {
                                            r += "Cooloff for " + Math.floor((parent.badLoginTable[i] - Date.now()) / 60000) + " minute(s)\r\n";
                                        } else {
                                            if (parent.badLoginTable[i].length > 1) {
                                                r += (i + ' - ' + parent.badLoginTable[i].length + " records\r\n");
                                            } else {
                                                r += (i + ' - ' + parent.badLoginTable[i].length + " record\r\n");
                                            }
                                        }
                                    }
                                    if (badLoginCount == 0) { r += 'No bad logins.'; }
                                } else {
                                    r = 'Usage: badlogin [reset]';
                                }
                            }
                            break;
                        }
                        case 'dispatchtable': {
                            r = '';
                            for (var i in parent.parent.eventsDispatch) { r += (i + ', ' + parent.parent.eventsDispatch[i].length + '\r\n'); }
                            break;
                        }
                        case 'dupagents': {
                            for (var i in parent.duplicateAgentsLog) { r += JSON.stringify(parent.duplicateAgentsLog[i]) + '\r\n'; }
                            if (r == '') { r = 'No duplicate agents in log.'; }
                            break;
                        }
                        case 'agentstats': {
                            var stats = parent.getAgentStats();
                            for (var i in stats) {
                                if (typeof stats[i] == 'object') { r += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { r += (i + ': ' + stats[i] + '\r\n'); }
                            }
                            break;
                        }
                        case 'agentissues': {
                            var stats = parent.getAgentIssues();
                            if (stats.length == 0) {
                                r = "No agent issues.";
                            } else {
                                for (var i in stats) { r += stats[i].join(', ') + '\r\n'; }
                            }
                            break;
                        }
                        case 'webstats': {
                            var stats = parent.getStats();
                            for (var i in stats) {
                                if (typeof stats[i] == 'object') { r += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { r += (i + ': ' + stats[i] + '\r\n'); }
                            }
                            break;
                        }
                        case 'watchdog': {
                            if (parent.parent.watchdog == null) {
                                r = 'Server watchdog not active.';
                            } else {
                                r = 'Server watchdog active.\r\n';
                                if (parent.parent.watchdogmaxtime != null) { r += 'Largest timeout was ' + parent.parent.watchdogmax + 'ms on ' + parent.parent.watchdogmaxtime + '\r\n'; }
                                for (var i in parent.parent.watchdogtable) { r += parent.parent.watchdogtable[i] + '\r\n'; }
                            }
                            break;
                        }
                        case 'acceleratorsstats': {
                            var stats = parent.parent.certificateOperations.getAcceleratorStats();
                            for (var i in stats) {
                                if (typeof stats[i] == 'object') { r += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { r += (i + ': ' + stats[i] + '\r\n'); }
                            }
                            break;
                        }
                        case 'mpsstats': {
                            if (parent.parent.mpsserver == null) {
                                r = 'MPS not enabled.';
                            } else {
                                var stats = parent.parent.mpsserver.getStats();
                                for (var i in stats) {
                                    if (typeof stats[i] == 'object') { r += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { r += (i + ': ' + stats[i] + '\r\n'); }
                                }
                            }
                            break;
                        }
                        case 'mps': { // List all MPS connections and types.
                            if (parent.parent.mpsserver == null) {
                                r = 'MPS not enabled.';
                            } else {
                                const connectionTypes = ['CIRA', 'Relay', 'LMS'];
                                for (var nodeid in parent.parent.mpsserver.ciraConnections) {
                                    r += nodeid;
                                    var connections = parent.parent.mpsserver.ciraConnections[nodeid];
                                    for (var i in connections) { r += ', ' + connectionTypes[connections[i].tag.connType]; }
                                    r += '\r\n';
                                }
                                if (r == '') { r = 'MPS has not connections.'; }
                            }
                            break;
                        }
                        case 'dbstats': {
                            parent.parent.db.getStats(function (stats) {
                                var r2 = '';
                                for (var i in stats) { r2 += (i + ': ' + stats[i] + '\r\n'); }
                                try { ws.send(JSON.stringify({ action: 'serverconsole', value: r2, tag: command.tag })); } catch (ex) { }
                            });
                            break;
                        }
                        case 'dbcounters': {
                            try { ws.send(JSON.stringify({ action: 'serverconsole', value: JSON.stringify(parent.parent.db.dbCounters, null, 2), tag: command.tag })); } catch (ex) { }
                            break;
                        }
                        case 'serverupdate': {
                            r = 'Performing server update...';
                            if (parent.parent.performServerUpdate() == false) { r = 'Server self-update not possible.'; }
                            break;
                        }
                        case 'print': {
                            console.log(cmdargs['_'][0]);
                            break;
                        }
                        case 'updatecheck': {
                            parent.parent.getServerTags(function (tags, error) {
                                var r2 = '';
                                if (error != null) { r2 += 'Exception: ' + error + '\r\n'; }
                                else { for (var i in tags) { r2 += i + ': ' + tags[i] + '\r\n'; } }
                                try { ws.send(JSON.stringify({ action: 'serverconsole', value: r2, tag: command.tag })); } catch (ex) { }
                            });
                            r = "Checking server update...";
                            break;
                        }
                        case 'maintenance': {
                            var arg = null, changed = false;
                            if ((cmdargs['_'] != null) && (cmdargs['_'][0] != null)) { arg = cmdargs['_'][0].toLowerCase(); }
                            if (arg == 'enabled') { parent.parent.config.settings.maintenancemode = 1; changed = true; }
                            else if (arg == 'disabled') { delete parent.parent.config.settings.maintenancemode; changed = true; }
                            r = 'Maintenance mode: ' + ((parent.parent.config.settings.maintenancemode == null) ? 'Disabled' : 'Enabled');
                            if (changed == false) { r += '\r\nTo change type: maintenance [enabled|disabled]'; }
                            break;
                        }
                        case 'info': {
                            var info = process.memoryUsage();
                            info.dbType = ['None', 'NeDB', 'MongoJS', 'MongoDB'][parent.db.databaseType];
                            try { if (parent.parent.multiServer != null) { info.serverId = parent.parent.multiServer.serverid; } } catch (ex) { }
                            if (parent.db.databaseType == 3) { info.dbChangeStream = parent.db.changeStream; }
                            if (parent.parent.pluginHandler != null) { info.plugins = []; for (var i in parent.parent.pluginHandler.plugins) { info.plugins.push(i); } }
                            try { info.nodeVersion = process.version; } catch (ex) { }
                            try { info.meshVersion = parent.parent.currentVer; } catch (ex) { }
                            try { info.platform = process.platform; } catch (ex) { }
                            try { info.arch = process.arch; } catch (ex) { }
                            try { info.pid = process.pid; } catch (ex) { }
                            try { info.uptime = process.uptime(); } catch (ex) { }
                            try { info.cpuUsage = process.cpuUsage(); } catch (ex) { }
                            try { info.warnings = parent.parent.getServerWarnings(); } catch (ex) { }
                            try { info.database = ["Unknown", "NeDB", "MongoJS", "MongoDB", "MariaDB", "MySQL"][parent.parent.db.databaseType]; } catch (ex) { }
                            try { info.productionMode = ((process.env.NODE_ENV != null) && (process.env.NODE_ENV == 'production')); } catch (ex) { }
                            try { info.allDevGroupManagers = parent.parent.config.settings.managealldevicegroups; } catch (ex) { }
                            r = JSON.stringify(info, null, 4);
                            break;
                        }
                        case 'nodeconfig': {
                            r = JSON.stringify(process.config, null, 4);
                            break;
                        }
                        case 'versions': {
                            r = JSON.stringify(process.versions, null, 4);
                            break;
                        }
                        case 'args': {
                            r = cmd + ': ' + JSON.stringify(cmdargs);
                            break;
                        }
                        case 'usersessions': {
                            var userSessionCount = 0;
                            var filter = null;
                            var arg = cmdargs['_'][0];
                            if (typeof arg == 'string') { if (arg.indexOf('/') >= 0) { filter = arg; } else { filter = ('user/' + domain.id + '/' + arg); } }
                            for (var i in parent.wssessions) {
                                if ((filter == null) || (filter == i)) {
                                    userSessionCount++;
                                    r += (i + ', ' + parent.wssessions[i].length + ' session' + ((parent.wssessions[i].length > 1) ? 's' : '') + '.\r\n');
                                    for (var j in parent.wssessions[i]) {
                                        var addr = parent.wssessions[i][j]._socket.remoteAddress;
                                        if (addr.startsWith('::ffff:')) { addr = addr.substring(7); }
                                        r += '    ' + addr + ' --> ' + parent.wssessions[i][j].sessionId + '\r\n';
                                    }
                                }
                            }
                            if (userSessionCount == 0) { r = 'None.'; }
                            break;
                        }
                        case 'closeusersessions': {
                            var userSessionCount = 0;
                            var filter = null;
                            var arg = cmdargs['_'][0];
                            if (typeof arg == 'string') { if (arg.indexOf('/') >= 0) { filter = arg; } else { filter = ('user/' + domain.id + '/' + arg); } }
                            if (filter == null) {
                                r += "Usage: closeusersessions <username>";
                            } else {
                                r += "Closing user sessions for: " + filter + '\r\n';
                                for (var i in parent.wssessions) {
                                    if (filter == i) {
                                        userSessionCount++;
                                        for (var j in parent.wssessions[i]) {
                                            parent.wssessions[i][j].send(JSON.stringify({ action: 'stopped', msg: "Administrator forced disconnection" }));
                                            parent.wssessions[i][j].close();
                                        }
                                    }
                                }
                                if (userSessionCount < 2) { r += 'Disconnected ' + userSessionCount + ' session.'; } else { r += 'Disconnected ' + userSessionCount + ' sessions.'; };
                            }
                            break;
                        }
                        case 'resetserver': {
                            console.log("Server restart...");
                            process.exit(0);
                            break;
                        }
                        case 'tasklimiter': {
                            if (parent.parent.taskLimiter != null) {
                                //var obj = { maxTasks: maxTasks, maxTaskTime: (maxTaskTime * 1000), nextTaskId: 0, currentCount: 0, current: {}, pending: [[], [], []], timer: null };
                                const tl = parent.parent.taskLimiter;
                                r += 'MaxTasks: ' + tl.maxTasks + ', NextTaskId: ' + tl.nextTaskId + '\r\n';
                                r += 'MaxTaskTime: ' + (tl.maxTaskTime / 1000) + ' seconds, Timer: ' + (tl.timer != null) + '\r\n';
                                var c = [];
                                for (var i in tl.current) { c.push(i); }
                                r += 'Current (' + tl.currentCount + '): [' + c.join(', ') + ']\r\n';
                                r += 'Pending (High/Med/Low): ' + tl.pending[0].length + ', ' + tl.pending[1].length + ', ' + tl.pending[2].length + '\r\n';
                            }
                            break;
                        }
                        case 'setmaxtasks': {
                            if ((cmdargs["_"].length != 1) || (parseInt(cmdargs["_"][0]) < 1) || (parseInt(cmdargs["_"][0]) > 1000)) {
                                r = 'Usage: setmaxtasks [1 to 1000]';
                            } else {
                                parent.parent.taskLimiter.maxTasks = parseInt(cmdargs["_"][0]);
                                r = 'MaxTasks set to ' + parent.parent.taskLimiter.maxTasks + '.';
                            }
                            break;
                        }
                        case 'cores': {
                            if (parent.parent.defaultMeshCores != null) { for (var i in parent.parent.defaultMeshCores) { r += i + ': ' + parent.parent.defaultMeshCores[i].length + ' bytes\r\n'; } }
                            break;
                        }
                        case 'showpaths': {
                            r =  'Parent:     ' + parent.parent.parentpath + '\r\n';
                            r += 'Data:       ' + parent.parent.datapath + '\r\n';
                            r += 'Files:      ' + parent.parent.filespath + '\r\n';
                            r += 'Backup:     ' + parent.parent.backuppath + '\r\n';
                            r += 'Record:     ' + parent.parent.recordpath + '\r\n';
                            r += 'WebPublic:  ' + parent.parent.webPublicPath + '\r\n';
                            r += 'WebViews:   ' + parent.parent.webViewsPath + '\r\n';
                            if (parent.parent.webViewsOverridePath) { r += 'XWebPublic: ' + parent.parent.webViewsOverridePath + '\r\n'; }
                            if (parent.parent.webViewsOverridePath) { r += 'XWebViews:  ' + parent.parent.webPublicOverridePath + '\r\n'; }
                            break;
                        }
                        case 'migrationagents': {
                            if (parent.parent.swarmserver == null) {
                                r = 'Swarm server not running.';
                            } else {
                                for (var i in parent.parent.swarmserver.migrationAgents) {
                                    var arch = parent.parent.swarmserver.migrationAgents[i];
                                    for (var j in arch) { var agent = arch[j]; r += 'Arch ' + agent.arch + ', Ver ' + agent.ver + ', Size ' + ((agent.binary == null) ? 0 : agent.binary.length) + '<br />'; }
                                }
                            }
                            break;
                        }
                        case 'swarmstats': {
                            if (parent.parent.swarmserver == null) {
                                r = 'Swarm server not running.';
                            } else {
                                for (var i in parent.parent.swarmserver.stats) {
                                    if (typeof parent.parent.swarmserver.stats[i] == 'object') {
                                        r += i + ': ' + JSON.stringify(parent.parent.swarmserver.stats[i]) + '\r\n';
                                    } else {
                                        r += i + ': ' + parent.parent.swarmserver.stats[i] + '\r\n';
                                    }
                                }
                            }
                            break;
                        }
                        case 'heapdump': {
                            var heapdump = null;
                            try { heapdump = require('heapdump'); } catch (ex) { }
                            if (heapdump == null) {
                                r = 'Heapdump module not installed, run "npm install heapdump".';
                            } else {
                                heapdump.writeSnapshot(function (err, filename) {
                                    if (err != null) {
                                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: 'Unable to write heapdump: ' + err })); } catch (ex) { }
                                    } else {
                                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: 'Wrote heapdump at ' + filename })); } catch (ex) { }
                                    }
                                });
                            }
                            break;
                        }
                        case 'relays': {
                            for (var i in parent.wsrelays) {
                                r += 'id: ' + i + ', ' + ((parent.wsrelays[i].state == 2)?'connected':'pending');
                                if (parent.wsrelays[i].peer1 != null) {
                                    r += ', ' + cleanRemoteAddr(parent.wsrelays[i].peer1.req.clientIp);
                                    if (parent.wsrelays[i].peer1.user) { r += ' (User:' + parent.wsrelays[i].peer1.user.name + ')' }
                                }
                                if (parent.wsrelays[i].peer2 != null) {
                                    r += ' to ' + cleanRemoteAddr(parent.wsrelays[i].peer2.req.clientIp);
                                    if (parent.wsrelays[i].peer2.user) { r += ' (User:' + parent.wsrelays[i].peer2.user.name + ')' }
                                }
                                r += '\r\n';
                            }
                            if (r == '') { r = 'No relays.'; }
                            break;
                        }
                        case 'autobackup': {
                            var backupResult = parent.db.performBackup(function (msg) {
                                try { ws.send(JSON.stringify({ action: 'serverconsole', value: msg, tag: command.tag })); } catch (ex) { }
                            });
                            if (backupResult == 0) { r = 'Starting auto-backup...'; } else { r = 'Backup alreay in progress.'; }
                            break;
                        }
                        case 'backupconfig': {
                            r = parent.db.getBackupConfig();
                            break;
                        }
                        case 'firebase': {
                            if (parent.parent.firebase == null) {
                                r = "Firebase push messaging not supported";
                            } else {
                                r = JSON.stringify(parent.parent.firebase.stats, null, 2);
                            }
                            break;
                        }
                        default: { // This is an unknown command, return an error message
                            r = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.';
                            break;
                        }
                    }

                    if (r != '') { try { ws.send(JSON.stringify({ action: 'serverconsole', value: r, tag: command.tag })); } catch (ex) { } }
                    break;
                }
            case 'msg':
                {
                    // Check the nodeid
                    if (common.validateString(command.nodeid, 1, 1024) == false) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'msg', result: 'Unable to route', tag: command.tag, responseid: command.responseid })); } catch (ex) { } }
                        return;
                    }

                    // Rights check
                    var requiredRights = null, requiredNonRights = null;

                    // Complete the nodeid if needed
                    if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }

                    // Before routing this command, let's do some security checking.
                    // If this is a tunnel request, we need to make sure the NodeID in the URL matches the NodeID in the command.
                    if (command.type == 'tunnel') {
                        if ((typeof command.value != 'string') || (typeof command.nodeid != 'string')) break;
                        var url = null;
                        try { url = require('url').parse(command.value, true); } catch (ex) { }
                        if (url == null) break; // Bad URL
                        if (url.query && url.query.nodeid && (url.query.nodeid != command.nodeid)) break; // Bad NodeID in URL query string

                        // Check rights
                        if (url.query.p == '1') { requiredNonRights = MESHRIGHT_NOTERMINAL; }
                        else if ((url.query.p == '4') || (url.query.p == '5')) { requiredNonRights = MESHRIGHT_NOFILES; }

                        // Add server TLS cert hash
                        var tlsCertHash = null;
                        if ((parent.parent.args.ignoreagenthashcheck == null) || (parent.parent.args.ignoreagenthashcheck === false)) { // TODO: If ignoreagenthashcheck is an array of IP addresses, not sure how to handle this.
                            tlsCertHash = parent.webCertificateFullHashs[domain.id];
                            if (tlsCertHash != null) { command.servertlshash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
                        }

                        // Add user consent messages
                        command.soptions = {};
                        if (typeof domain.consentmessages == 'object') {
                            if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                            if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                            if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                            if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                        }
                        if (typeof domain.notificationmessages == 'object') {
                            if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                            if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                            if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                            if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                        }

                        // Add userid
                        command.userid = user._id;

                        // Add tunnel pre-message deflate
                        if (typeof parent.parent.config.settings.agentwscompression == 'boolean') { command.perMessageDeflate = parent.parent.config.settings.agentwscompression; }
                    }

                    // If a response is needed, set a callback function
                    var func = null;
                    if (command.responseid != null) { func = function (r) { try { ws.send(JSON.stringify({ action: 'msg', result: r ? 'OK' : 'Unable to route', tag: command.tag, responseid: command.responseid })); } catch (ex) { } } }

                    // Route this command to a target node
                    routeCommandToNode(command, requiredRights, requiredNonRights, func);
                    break;
                }
            case 'events':
                {
                    // User filtered events
                    if ((command.user != null) && ((user.siteadmin & 2) != 0)) { // SITERIGHT_MANAGEUSERS
                        // TODO: Add the meshes command.user has access to (???)
                        var filter = ['user/' + domain.id + '/' + command.user];

                        const userSplit = command.user.split('/');
                        if (userSplit.length == 3) { filter = []; if ((userSplit[0] == 'user') && (userSplit[1] == domain.id)) { filter = [command.user]; } }

                        if ((command.limit == null) || (typeof command.limit != 'number')) {
                            // Send the list of all events for this session
                            db.GetUserEvents(filter, domain.id, command.user, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { }
                            });
                        } else {
                            // Send the list of most recent events for this session, up to 'limit' count
                            db.GetUserEventsWithLimit(filter, domain.id, command.user, command.limit, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { }
                            });
                        }
                    } else if (command.nodeid != null) { // Device filtered events
                        // Check that the user has access to this nodeid

                        const nodeSplit = command.nodeid.split('/');
                        if (nodeSplit.length == 1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }

                        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                            if (node == null) { try { ws.send(JSON.stringify({ action: 'events', events: [], nodeid: command.nodeid, tag: command.tag })); } catch (ex) { } return; }

                            // Put a limit on the number of returned entries if present
                            var limit = 10000;
                            if (common.validateInt(command.limit, 1, 1000000) == true) { limit = command.limit; }

                            if (((rights & MESHRIGHT_LIMITEVENTS) != 0) && (rights != MESHRIGHT_ADMIN)) {
                                // Send the list of most recent events for this nodeid that only apply to us, up to 'limit' count
                                db.GetNodeEventsSelfWithLimit(node._id, domain.id, user._id, limit, function (err, docs) {
                                    if (err != null) return;
                                    try { ws.send(JSON.stringify({ action: 'events', events: docs, nodeid: node._id, tag: command.tag })); } catch (ex) { }
                                });
                            } else {
                                // Send the list of most recent events for this nodeid, up to 'limit' count
                                db.GetNodeEventsWithLimit(node._id, domain.id, limit, function (err, docs) {
                                    if (err != null) return;
                                    try { ws.send(JSON.stringify({ action: 'events', events: docs, nodeid: node._id, tag: command.tag })); } catch (ex) { }
                                });
                            }
                        });
                    } else {
                        // Create a filter for device groups
                        if ((obj.user == null) || (obj.user.links == null)) return;

                        // All events
                        var exGroupFilter2 = [], filter = [], filter2 = user.subscriptions;

                        // Add all meshes for groups this user is part of
                        // TODO (UserGroups)

                        // Remove MeshID's that we do not have rights to see events for
                        for (var link in obj.user.links) { if (((obj.user.links[link].rights & MESHRIGHT_LIMITEVENTS) != 0) && ((obj.user.links[link].rights != MESHRIGHT_ADMIN))) { exGroupFilter2.push(link); } }
                        for (var i in filter2) { if (exGroupFilter2.indexOf(filter2[i]) == -1) { filter.push(filter2[i]); } }

                        if ((command.limit == null) || (typeof command.limit != 'number')) {
                            // Send the list of all events for this session
                            db.GetEvents(filter, domain.id, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { }
                            });
                        } else {
                            // Send the list of most recent events for this session, up to 'limit' count
                            db.GetEventsWithLimit(filter, domain.id, command.limit, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { }
                            });
                        }
                    }
                    break;
                }
            case 'recordings': {
                if (((user.siteadmin & SITERIGHT_RECORDINGS) == 0) || (domain.sessionrecording == null)) return; // Check if recordings is enabled and we have rights to do this.
                var recordingsPath = null;
                if (domain.sessionrecording.filepath) { recordingsPath = domain.sessionrecording.filepath; } else { recordingsPath = parent.parent.recordpath; }
                if (recordingsPath == null) return;
                fs.readdir(recordingsPath, function (err, files) {
                    if (err != null) return;
                    if ((command.limit == null) || (typeof command.limit != 'number')) {
                        // Send the list of all recordings
                        db.GetEvents(['recording'], domain.id, function (err, docs) {
                            if (err != null) return;
                            for (var i in docs) {
                                delete docs[i].action; delete docs[i].etype; delete docs[i].msg; // TODO: We could make a more specific query in the DB and never have these.
                                if (files.indexOf(docs[i].filename) >= 0) { docs[i].present = 1; }
                            }
                            try { ws.send(JSON.stringify({ action: 'recordings', events: docs, tag: command.tag })); } catch (ex) { }
                        });
                    } else {
                        // Send the list of most recent recordings, up to 'limit' count
                        db.GetEventsWithLimit(['recording'], domain.id, command.limit, function (err, docs) {
                            if (err != null) return;
                            for (var i in docs) {
                                delete docs[i].action; delete docs[i].etype; delete docs[i].msg; // TODO: We could make a more specific query in the DB and never have these.
                                if (files.indexOf(docs[i].filename) >= 0) { docs[i].present = 1; }
                            }
                            try { ws.send(JSON.stringify({ action: 'recordings', events: docs, tag: command.tag })); } catch (ex) { }
                        });
                    }
                });
                break;
            }
            case 'users':
                {
                    // Request a list of all users
                    if ((user.siteadmin & 2) == 0) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'users', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } } break; }
                    var docs = [];
                    for (i in parent.users) {
                        if (((obj.crossDomain === true) || (parent.users[i].domain == domain.id)) && (parent.users[i].name != '~')) {
                            // If we are part of a user group, we can only see other members of our own group
                            if ((obj.crossDomain === true) || (user.groups == null) || (user.groups.length == 0) || ((parent.users[i].groups != null) && (findOne(parent.users[i].groups, user.groups)))) {
                                docs.push(parent.CloneSafeUser(parent.users[i]));
                            }
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'users', users: docs, tag: command.tag })); } catch (ex) { }
                    break;
                }
            case 'changelang':
                {
                    // If this account is settings locked, return here.
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;

                    if (common.validateString(command.lang, 1, 6) == false) return;

                    // Always lowercase the language
                    command.lang = command.lang.toLowerCase();

                    // Update the user's language
                    var oldlang = user.lang;
                    if (command.lang == '*') { delete user.lang; } else { user.lang = command.lang; }
                    parent.db.SetUser(user);

                    // Event the change
                    var message = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id, msgid: 2, msgArgs: [(oldlang ? oldlang : 'default'), (user.lang ? user.lang : 'default')] };
                    if (db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    message.msg = 'Changed language from ' + (oldlang ? oldlang : 'default') + ' to ' + (user.lang ? user.lang : 'default');

                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    parent.parent.DispatchEvent(targets, obj, message);

                    break;
                }
            case 'changeemail':
                {
                    // If the email is the username, this command is not allowed.
                    if (domain.usernameisemail) return;

                    // If this account is settings locked, return here.
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;

                    // Change our own email address
                    if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) return;
                    if (common.validateEmail(command.email, 1, 1024) == false) return;

                    // Always lowercase the email address
                    command.email = command.email.toLowerCase();

                    if (obj.user.email != command.email) {
                        // Check if this email is already validated on a different account
                        db.GetUserWithVerifiedEmail(domain.id, command.email, function (err, docs) {
                            if ((docs != null) && (docs.length > 0)) {
                                // Notify the duplicate email error
                                try { ws.send(JSON.stringify({ action: 'msg', type: 'notify', title: 'Account Settings', id: Math.random(), tag: 'ServerNotify', value: 'Failed to change email address, another account already using: ' + command.email + '.', titleid: 4, msgid: 13, args: [command.email] })); } catch (ex) { }
                            } else {
                                // Update the user's email
                                var oldemail = user.email;
                                user.email = command.email;
                                user.emailVerified = false;
                                parent.db.SetUser(user);

                                // Event the change
                                var message = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id };
                                if (db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                if (oldemail != null) {
                                    message.msg = 'Changed email of user ' + user.name + ' from ' + oldemail + ' to ' + user.email;
                                } else {
                                    message.msg = 'Set email of user ' + user.name + ' to ' + user.email;
                                }

                                var targets = ['*', 'server-users', user._id];
                                if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                                parent.parent.DispatchEvent(targets, obj, message);

                                // Log in the auth log
                                if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' changed email from ' + oldemail + ' to ' + user.email); }

                                // Send the verification email
                                if (domain.mailserver != null) { domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, parent.getLanguageCodes(req)); }
                            }
                        });
                    }
                    break;
                }
            case 'verifyemail':
                {
                    // If this account is settings locked, return here.
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;

                    // Send a account email verification email
                    if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) return;
                    if (common.validateString(command.email, 3, 1024) == false) return;

                    // Always lowercase the email address
                    command.email = command.email.toLowerCase();

                    if ((domain.mailserver != null) && (obj.user.email.toLowerCase() == command.email)) {
                        // Send the verification email
                        domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, parent.getLanguageCodes(req));
                    }
                    break;
                }
            case 'wssessioncount':
                {
                    // Request a list of all web socket user session count
                    var wssessions = {};
                    if ((user.siteadmin & 2) == 0) { try { ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: {}, tag: command.tag })); } catch (ex) { } break; }
                    if (parent.parent.multiServer == null) {
                        // No peering, use simple session counting
                        for (i in parent.wssessions) {
                            if ((obj.crossDomain === true) || (parent.wssessions[i][0].domainid == domain.id)) {
                                if ((user.groups == null) || (user.groups.length == 0)) {
                                    // No user groups, count everything
                                    wssessions[i] = parent.wssessions[i].length;
                                } else {
                                    // Only count if session is for a user in our user groups
                                    var sessionUser = parent.users[parent.wssessions[i][0].userid];
                                    if ((sessionUser != null) && findOne(sessionUser.groups, user.groups)) {
                                        wssessions[i] = parent.wssessions[i].length;
                                    }
                                }
                            }
                        }
                    } else {
                        // We have peer servers, use more complex session counting
                        for (i in parent.sessionsCount) {
                            if ((obj.crossDomain === true) || (i.split('/')[1] == domain.id)) {
                                if ((user.groups == null) || (user.groups.length == 0)) {
                                    // No user groups, count everything
                                    wssessions[i] = parent.sessionsCount[i];
                                } else {
                                    // Only count if session is for a user in our user groups
                                    var sessionUser = parent.users[i];
                                    if ((sessionUser != null) && findOne(sessionUser.groups, user.groups)) {
                                        wssessions[i] = parent.sessionsCount[i];
                                    }
                                }
                            }
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: wssessions, tag: command.tag })); } catch (ex) { } // wssessions is: userid --> count
                    break;
                }
            case 'deleteuser':
                {
                    // Delete a user account
                    var err = null, delusersplit, deluserid, deluser, deluserdomain;
                    try {
                        if ((user.siteadmin & 2) == 0) { err = 'Permission denied'; }
                        else if (common.validateString(command.userid, 1, 2048) == false) { err = 'Invalid userid'; }
                        else {
                            if (command.userid.indexOf('/') < 0) { command.userid = 'user/' + domain.id + '/' + command.userid; }
                            delusersplit = command.userid.split('/');
                            deluserid = command.userid;
                            deluser = parent.users[deluserid];
                            if (deluser == null) { err = 'User does not exists'; }
                            else if ((obj.crossDomain !== true) && ((delusersplit.length != 3) || (delusersplit[1] != domain.id))) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                            else if ((deluser.siteadmin === SITERIGHT_ADMIN) && (user.siteadmin != SITERIGHT_ADMIN)) { err = 'Permission denied'; } // Need full admin to remote another administrator
                            else if ((obj.crossDomain !== true) && (user.groups != null) && (user.groups.length > 0) && ((deluser.groups == null) || (findOne(deluser.groups, user.groups) == false))) { err = 'Invalid user group'; } // Can only perform this operation on other users of our group.
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Get domain
                    deluserdomain = domain;
                    if (obj.crossDomain === true) { deluserdomain = parent.parent.config.domains[delusersplit[1]]; }
                    if (deluserdomain == null) { err = 'Invalid domain'; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deleteuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Remove all links to this user
                    if (deluser.links != null) {
                        for (var i in deluser.links) {
                            if (i.startsWith('mesh/')) {
                                // Get the device group
                                mesh = parent.meshes[i];
                                if (mesh) {
                                    // Remove user from the mesh
                                    if (mesh.links[deluser._id] != null) { delete mesh.links[deluser._id]; parent.db.Set(mesh); }

                                    // Notify mesh change
                                    change = 'Removed user ' + deluser.name + ' from device group ' + mesh.name;
                                    var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msgid: 72, msgArgs: [deluser.name, mesh.name], msg: change, domain: deluserdomain.id, invite: mesh.invite };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [deluser._id, user._id]), obj, event);
                                }
                            } else if (i.startsWith('node/')) {
                                // Get the node and the rights for this node
                                parent.GetNodeWithRights(deluserdomain, deluser, i, function (node, rights, visible) {
                                    if ((node == null) || (node.links == null) || (node.links[deluser._id] == null)) return;

                                    // Remove the link and save the node to the database
                                    delete node.links[deluser._id];
                                    if (Object.keys(node.links).length == 0) { delete node.links; }
                                    db.Set(parent.cleanDevice(node));

                                    // Event the node change
                                    var event;
                                    if (command.rights == 0) {
                                        event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: deluserdomain.id, msgid: 60, msgArgs: [node.name], msg: 'Removed user device rights for ' + node.name, node: parent.CloneSafeNode(node) }
                                    } else {
                                        event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: deluserdomain.id, msgid: 61, msgArgs: [node.name], msg: 'Changed user device rights for ' + node.name, node: parent.CloneSafeNode(node) }
                                    }
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                    parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id), obj, event);
                                });
                            } else if (i.startsWith('ugrp/')) {
                                // Get the device group
                                var ugroup = parent.userGroups[i];
                                if (ugroup) {
                                    // Remove user from the user group
                                    if (ugroup.links[deluser._id] != null) { delete ugroup.links[deluser._id]; parent.db.Set(ugroup); }

                                    // Notify user group change
                                    change = 'Removed user ' + deluser.name + ' from user group ' + ugroup.name;
                                    var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msgid: 62, msgArgs: [deluser.name, ugroup.name], msg: 'Removed user ' + deluser.name + ' from user group ' + ugroup.name, addUserDomain: deluserdomain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                    parent.parent.DispatchEvent(['*', ugroup._id, user._id, deluser._id], obj, event);
                                }
                            }
                        }
                    }

                    db.Remove('ws' + deluser._id); // Remove user web state
                    db.Remove('nt' + deluser._id); // Remove notes for this user

                    // Delete all files on the server for this account
                    try {
                        var deluserpath = parent.getServerRootFilePath(deluser);
                        if (deluserpath != null) { parent.deleteFolderRec(deluserpath); }
                    } catch (e) { }

                    db.Remove(deluserid);
                    delete parent.users[deluserid];

                    var targets = ['*', 'server-users'];
                    if (deluser.groups) { for (var i in deluser.groups) { targets.push('server-users:' + i); } }
                    parent.parent.DispatchEvent(targets, obj, { etype: 'user', userid: deluserid, username: deluser.name, action: 'accountremove', msgid: 63, msg: 'Account removed', domain: deluserdomain.id });
                    parent.parent.DispatchEvent([deluserid], obj, 'close');

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deleteuser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }

                    // Log in the auth log
                    if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' deleted user account ' + deluser.name); }

                    break;
                }
            case 'userbroadcast':
                {
                    var err = null;
                    try {
                        // Broadcast a message to all currently connected users.
                        if ((user.siteadmin & 2) == 0) { err = "Permission denied"; }
                        else if (common.validateString(command.msg, 1, 512) == false) { err = "Message is too long"; } // Notification message is between 1 and 256 characters
                    } catch (ex) { err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'userbroadcast', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Create the notification message
                    var notification = { action: 'msg', type: 'notify', domain: domain.id, value: command.msg, title: user.name, icon: 0, tag: 'broadcast', id: Math.random() };
                    if ((typeof command.maxtime == 'number') && (command.maxtime > 0)) { notification.maxtime = command.maxtime; }

                    // Send the notification on all user sessions for this server
                    for (var i in parent.wssessions2) {
                        try {
                            if (parent.wssessions2[i].domainid == domain.id) {
                                var sessionUser = parent.users[parent.wssessions2[i].userid];
                                if ((command.userid != null) && (command.userid != sessionUser._id) && (command.userid != sessionUser._id.split('/')[2])) { continue; }
                                if ((command.target == null) || ((sessionUser.links) != null && (sessionUser.links[command.target] != null))) {
                                    if ((user.groups == null) || (user.groups.length == 0)) {
                                        // We are part of no user groups, send to everyone.
                                        parent.wssessions2[i].send(JSON.stringify(notification));
                                    } else {
                                        // We are part of user groups, only send to sessions of users in our groups.
                                        if ((sessionUser != null) && findOne(sessionUser.groups, user.groups)) {
                                            parent.wssessions2[i].send(JSON.stringify(notification));
                                        }
                                    }
                                }
                            }
                        } catch (ex) { }
                    }

                    // TODO: Notify all sessions on other peers.

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'userbroadcast', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'adduserbatch':
                {
                    var err = null;
                    
                    // Add many new user accounts
                    if ((user.siteadmin & 2) == 0) { err = 'Access denied'; }
                    else if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { err = 'Unable to create users when in SSPI or LDAP mode'; }
                    else if (!Array.isArray(command.users)) { err = 'Invalid users'; }
                    else {
                        var userCount = 0;
                        for (var i in command.users) {
                            if (domain.usernameisemail) { if (command.users[i].email) { command.users[i].user = command.users[i].email; } else { command.users[i].email = command.users[i].user; } } // If the email is the username, set this here.
                            if (common.validateUsername(command.users[i].user, 1, 256) == false) { err = 'Invalid username'; break; } // Username is between 1 and 64 characters, no spaces
                            if ((command.users[i].user[0] == '~') || (command.users[i].user.indexOf('/') >= 0)) { err = 'Invalid username'; break; } // This is a reserved user name or invalid name
                            if (common.validateString(command.users[i].pass, 1, 256) == false) { err = 'Invalid password'; break; } // Password is between 1 and 256 characters
                            if (common.checkPasswordRequirements(command.users[i].pass, domain.passwordrequirements) == false) { err = 'Invalid password'; break; } // Password does not meet requirements
                            if ((command.users[i].email != null) && (common.validateEmail(command.users[i].email, 1, 1024) == false)) { err = 'Invalid email'; break; } // Check if this is a valid email address
                            userCount++;
                        }
                    }
                    
                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adduserbatch', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }
                    
                    // Check if we exceed the maximum number of user accounts
                    db.isMaxType(domain.limits.maxuseraccounts + userCount, 'user', domain.id, function (maxExceed) {
                        if (maxExceed) {
                            // Account count exceed, do notification

                            // Create the notification message
                            var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: domain.id, titleid: 2, msgid: 10 };

                            // Get the list of sessions for this user
                            var sessions = parent.wssessions[user._id];
                            if (sessions != null) { for (i in sessions) { try { if (sessions[i].domainid == domain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
                            // TODO: Notify all sessions on other peers.
                        } else {
                            for (var i in command.users) {
                                // Check if this is an existing user
                                var newuserid = 'user/' + domain.id + '/' + command.users[i].user;
                                var newuser = { type: 'user', _id: newuserid, name: command.users[i].user, creation: Math.floor(Date.now() / 1000), domain: domain.id };
                                if (domain.newaccountsrights) { newuser.siteadmin = domain.newaccountsrights; }
                                if (command.users[i].email != null) { newuser.email = command.users[i].email.toLowerCase(); if (command.users[i].emailVerified === true) { newuser.emailVerified = true; } } // Email, always lowercase
                                if (command.users[i].resetNextLogin === true) { newuser.passchange = -1; } else { newuser.passchange = Math.floor(Date.now() / 1000); }
                                if (user.groups) { newuser.groups = user.groups; } // New accounts are automatically part of our groups (Realms).

                                if (parent.users[newuserid] == null) {
                                    parent.users[newuserid] = newuser;

                                    // Create a user, generate a salt and hash the password
                                    require('./pass').hash(command.users[i].pass, function (err, salt, hash, newuser) {
                                        if (err) throw err;
                                        newuser.salt = salt;
                                        newuser.hash = hash;
                                        db.SetUser(newuser);

                                        var event, targets = ['*', 'server-users'];
                                        if (newuser.groups) { for (var i in newuser.groups) { targets.push('server-users:' + i); } }
                                        if (newuser.email == null) {
                                            event = { etype: 'user', userid: newuser._id, username: newuser.name, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msgid: 64, msgArgs: [newuser.name], msg: 'Account created, username is ' + newuser.name, domain: domain.id };
                                        } else {
                                            event = { etype: 'user', userid: newuser._id, username: newuser.name, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msgid: 65, msgArgs: [newuser.email], msg: 'Account created, email is ' + newuser.email, domain: domain.id };
                                        }
                                        if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                        parent.parent.DispatchEvent(targets, obj, event);

                                        // Log in the auth log
                                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created user account ' + newuser.name); }
                                    }, newuser);
                                }
                            }
                        }
                    });

                    break;
                }
            case 'adduser':
                {
                    // If the email is the username, set this here.
                    if (domain.usernameisemail) { if (command.email) { command.username = command.email; } else { command.email = command.username; } }

                    // Randomize the password if needed
                    if (command.randomPassword === true) { command.pass = getRandomPassword(); }

                    // Add a new user account
                    var err = null, errid = 0, newusername, newuserid, newuserdomain;
                    try {
                        if ((user.siteadmin & 2) == 0) { err = "Permission denied"; errid = 1; }
                        else if (common.validateUsername(command.username, 1, 256) == false) { err = "Invalid username"; errid = 2; } // Username is between 1 and 64 characters, no spaces
                        else if ((command.username[0] == '~') || (command.username.indexOf('/') >= 0)) { err = "Invalid username"; errid = 2; } // Usernames cant' start with ~ and can't have '/'
                        else if (common.validateString(command.pass, 1, 256) == false) { err = "Invalid password"; errid = 3; } // Password is between 1 and 256 characters
                        else if ((command.randomPassword !== true) && (common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false)) { err = "Invalid password"; errid = 3; } // Password does not meet requirements
                        else if ((command.email != null) && (common.validateEmail(command.email, 1, 1024) == false)) { err = "Invalid email"; errid = 4; } // Check if this is a valid email address
                        else if ((obj.crossDomain === true) && (command.domain != null) && ((typeof command.domain != 'string') || (parent.parent.config.domains[command.domain] == null))) { err = "Invalid domain"; errid = 5; } // Check if this is a valid domain
                        else {
                            newuserdomain = domain;
                            if ((obj.crossDomain === true) && (command.domain != null)) { newuserdomain = parent.parent.config.domains[command.domain]; }
                            newusername = command.username;
                            newuserid = 'user/' + newuserdomain.id + '/' + command.username.toLowerCase();
                            if (command.siteadmin != null) {
                                if ((typeof command.siteadmin != 'number') || (Number.isInteger(command.siteadmin) == false)) { err = "Invalid site permissions"; errid = 6; } // Check permissions
                                else if ((user.siteadmin != SITERIGHT_ADMIN) && ((command.siteadmin & (SITERIGHT_ADMIN - 224)) != 0)) { err = "Invalid site permissions"; errid = 6; }
                            }
                            if (parent.users[newuserid]) { err = "User already exists"; errid = 7; } // Account already exists
                            else if ((newuserdomain.auth == 'sspi') || (newuserdomain.auth == 'ldap')) { err = "Unable to add user in this mode"; errid = 8; }
                        }
                    } catch (ex) { err = "Validation exception"; errid = 9; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) {
                            try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: err, msgid: errid })); } catch (ex) { }
                        } else {
                            // Send error back, user not found.
                            displayNotificationMessage(err, "New Account", 'ServerNotify', null, 1, errid);
                        }
                        break;
                    }

                    // Check if we exceed the maximum number of user accounts
                    db.isMaxType(newuserdomain.limits.maxuseraccounts, 'user', newuserdomain.id, function (maxExceed) {
                        if (maxExceed) {
                            // Account count exceed, do notification
                            if (command.responseid != null) {
                                // Respond privately if requested
                                try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: 'maxUsersExceed' })); } catch (ex) { }
                            } else {
                                // Create the notification message
                                var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: newuserdomain.id, titleid: 2, msgid: 10 };

                                // Get the list of sessions for this user
                                var sessions = parent.wssessions[user._id];
                                if (sessions != null) { for (i in sessions) { try { if (sessions[i].domainid == newuserdomain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
                                // TODO: Notify all sessions on other peers.
                            }
                        } else {
                            // Remove any events for this userid
                            if (command.removeEvents === true) { db.RemoveAllUserEvents(newuserdomain.id, newuserid); }

                            // Create a new user
                            var newuser = { type: 'user', _id: newuserid, name: newusername, creation: Math.floor(Date.now() / 1000), domain: newuserdomain.id };
                            if (command.siteadmin != null) { newuser.siteadmin = command.siteadmin; }
                            else if (newuserdomain.newaccountsrights) { newuser.siteadmin = newuserdomain.newaccountsrights; }
                            if (command.email != null) { newuser.email = command.email.toLowerCase(); if (command.emailVerified === true) { newuser.emailVerified = true; } } // Email
                            if (command.resetNextLogin === true) { newuser.passchange = -1; } else { newuser.passchange = Math.floor(Date.now() / 1000); }
                            if (user.groups) { newuser.groups = user.groups; } // New accounts are automatically part of our groups (Realms).
                            if (common.validateString(command.realname, 1, 256)) { newuser.realname = command.realname; }
                            if ((command.consent != null) && (typeof command.consent == 'number')) { if (command.consent == 0) { delete chguser.consent; } else { newuser.consent = command.consent; } change = 1; }
                            if ((command.phone != null) && (typeof command.phone == 'string') && ((command.phone == '') || isPhoneNumber(command.phone))) { if (command.phone == '') { delete newuser.phone; } else { newuser.phone = command.phone; } change = 1; }

                            // Auto-join any user groups
                            if (typeof newuserdomain.newaccountsusergroups == 'object') {
                                for (var i in newuserdomain.newaccountsusergroups) {
                                    var ugrpid = newuserdomain.newaccountsusergroups[i];
                                    if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + newuserdomain.id + '/' + ugrpid; }
                                    var ugroup = parent.userGroups[ugrpid];
                                    if (ugroup != null) {
                                        // Add group to the user
                                        if (newuser.links == null) { newuser.links = {}; }
                                        newuser.links[ugroup._id] = { rights: 1 };

                                        // Add user to the group
                                        ugroup.links[newuser._id] = { userid: newuser._id, name: newuser.name, rights: 1 };
                                        db.Set(ugroup);

                                        // Notify user group change
                                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msgid: 80, msgArgs: [newuser.name, ugroup.name], msg: 'Added user ' + newuser.name + ' to user group ' + ugroup.name, addUserDomain: newuserdomain.id };
                                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                        parent.parent.DispatchEvent(['*', ugroup._id, user._id, newuser._id], obj, event);
                                    }
                                }
                            }

                            parent.users[newuserid] = newuser;

                            // Create a user, generate a salt and hash the password
                            require('./pass').hash(command.pass, function (err, salt, hash, tag) {
                                if (err == null) {
                                    newuser.salt = salt;
                                    newuser.hash = hash;
                                    db.SetUser(newuser);

                                    var event, targets = ['*', 'server-users'];
                                    if (newuser.groups) { for (var i in newuser.groups) { targets.push('server-users:' + i); } }
                                    if (command.email == null) {
                                        event = { etype: 'user', userid: newuser._id, username: newusername, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msgid: 64, msgArgs: [command.username], msg: 'Account created, username is ' + command.username, domain: newuserdomain.id };
                                    } else {
                                        event = { etype: 'user', userid: newuser._id, username: newusername, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msgid: 65, msgArgs: [command.email.toLowerCase()], msg: 'Account created, email is ' + command.email.toLowerCase(), domain: newuserdomain.id };
                                    }
                                    if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                    parent.parent.DispatchEvent(targets, obj, event);

                                    // Perform email invitation
                                    if ((command.emailInvitation == true) && (command.emailVerified == true) && command.email && domain.mailserver) {
                                        domain.mailserver.sendAccountInviteMail(newuserdomain, (user.realname ? user.realname : user.name), newusername, command.email.toLowerCase(), command.pass, parent.getLanguageCodes(req));
                                    }

                                    // Log in the auth log
                                    if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created a user account ' + newuser.name); }

                                    // OK Response
                                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                                } else {
                                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: 'passwordHashError' })); } catch (ex) { } }
                                }
                            }, 0);
                        }
                    });
                    break;
                }
            case 'edituser':
                {
                    // Must be user administrator or edit self.
                    if (((user.siteadmin & 2) == 0) && (user._id != command.id)) break;

                    // User the username as userid if needed
                    if ((typeof command.username == 'string') && (command.userid == null)) { command.userid = command.username; }
                    if ((typeof command.id == 'string') && (command.userid == null)) { command.userid = command.id; }

                    // Edit a user account
                    var err = null, editusersplit, edituserid, edituser, edituserdomain;
                    try {
                        if ((user.siteadmin & 2) == 0) { err = 'Permission denied'; }
                        else if (common.validateString(command.userid, 1, 2048) == false) { err = 'Invalid userid'; }
                        else {
                            if (command.userid.indexOf('/') < 0) { command.userid = 'user/' + domain.id + '/' + command.userid; }
                            editusersplit = command.userid.split('/');
                            edituserid = command.userid;
                            edituser = parent.users[edituserid];
                            if (edituser == null) { err = 'User does not exists'; }
                            else if ((obj.crossDomain !== true) && ((editusersplit.length != 3) || (editusersplit[1] != domain.id))) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                            else if ((edituser.siteadmin === SITERIGHT_ADMIN) && (user.siteadmin != SITERIGHT_ADMIN)) { err = 'Permission denied'; } // Need full admin to remote another administrator
                            else if ((obj.crossDomain !== true) && (user.groups != null) && (user.groups.length > 0) && ((edituser.groups == null) || (findOne(edituser.groups, user.groups) == false))) { err = 'Invalid user group'; } // Can only perform this operation on other users of our group.
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) {
                            try { ws.send(JSON.stringify({ action: 'edituser', responseid: command.responseid, result: err })); } catch (ex) { }
                        }
                        break;
                    }

                    // Edit a user account, may involve changing email or administrator permissions
                    var chguser = parent.users[edituserid];
                    change = 0;
                    if (chguser) {
                        // If the target user is admin and we are not admin, no changes can be made.
                        if ((chguser.siteadmin === SITERIGHT_ADMIN) && (user.siteadmin != SITERIGHT_ADMIN)) return;

                        // Can only perform this operation on other users of our group.
                        if (user.siteadmin != SITERIGHT_ADMIN) {
                            if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) return;
                        }

                        // Fetch and validate the user domain
                        var edituserdomainid = edituserid.split('/')[1];
                        if ((obj.crossDomain !== true) && (edituserdomainid != domain.id)) break;
                        var edituserdomain = parent.parent.config.domains[edituserdomainid];
                        if (edituserdomain == null) break;

                        // Validate and change email
                        if (edituserdomain.usernameisemail !== true) {
                            if (common.validateString(command.email, 0, 1024) && (chguser.email != command.email)) {
                                if (command.email == '') { command.emailVerified = false; delete chguser.email; } else { chguser.email = command.email.toLowerCase(); }
                                change = 1;
                            }
                        }

                        // Validate and change real name
                        if (common.validateString(command.realname, 0, 256) && (chguser.realname != command.realname)) {
                            if (command.realname == '') { delete chguser.realname; } else { chguser.realname = command.realname; }
                            change = 1;
                        }

                        // Make changes
                        if ((command.emailVerified === true || command.emailVerified === false) && (chguser.emailVerified != command.emailVerified)) { chguser.emailVerified = command.emailVerified; change = 1; }
                        if ((common.validateInt(command.quota, 0) || command.quota == null) && (command.quota != chguser.quota)) { chguser.quota = command.quota; if (chguser.quota == null) { delete chguser.quota; } change = 1; }
                        if (command.resetNextLogin === true) { chguser.passchange = -1; }
                        if ((command.consent != null) && (typeof command.consent == 'number')) { if (command.consent == 0) { delete chguser.consent; } else { chguser.consent = command.consent; } change = 1; }
                        if ((command.phone != null) && (typeof command.phone == 'string') && ((command.phone == '') || isPhoneNumber(command.phone))) { if (command.phone == '') { delete chguser.phone; } else { chguser.phone = command.phone; } change = 1; }

                        // Site admins can change any server rights, user managers can only change AccountLock, NoMeshCmd and NoNewGroups
                        if (common.validateInt(command.siteadmin) && (chguser._id !== user._id) && (chguser.siteadmin != command.siteadmin)) { // We can't change our own siteadmin permissions.
                            var chgusersiteadmin = chguser.siteadmin ? chguser.siteadmin : 0;
                            if (user.siteadmin === SITERIGHT_ADMIN) { chguser.siteadmin = command.siteadmin; change = 1; }
                            else if (user.siteadmin & 2) {
                                var mask = 0xFFFFFF1D; // Mask: 2 (User Mangement) + 32 (Account locked) + 64 (No New Groups) + 128 (No Tools)
                                if ((user.siteadmin & 256) != 0) { mask -= 256; } // Mask: Manage User Groups
                                if ((user.siteadmin & 512) != 0) { mask -= 512; } // Mask: Manage Recordings
                                if (((chgusersiteadmin ^ command.siteadmin) & mask) == 0) { chguser.siteadmin = command.siteadmin; change = 1; }
                            }
                        }

                        // When sending a notification about a group change, we need to send to all the previous and new groups.
                        var allTargetGroups = chguser.groups;
                        if ((Array.isArray(command.groups)) && ((user._id != command.id) || (user.siteadmin === SITERIGHT_ADMIN))) {
                            if (command.groups.length == 0) {
                                // Remove the user groups
                                if (chguser.groups != null) { delete chguser.groups; change = 1; }
                            } else {
                                // Arrange the user groups
                                var groups2 = [];
                                for (var i in command.groups) {
                                    if (typeof command.groups[i] == 'string') {
                                        var gname = command.groups[i].trim().toLowerCase();
                                        if ((gname.length > 0) && (gname.length <= 64) && (groups2.indexOf(gname) == -1)) { groups2.push(gname); }
                                    }
                                }
                                groups2.sort();

                                // Set the user groups (Realms)
                                if (chguser.groups != groups2) { chguser.groups = groups2; change = 1; }

                                // Add any missing groups in the target list
                                if (allTargetGroups == null) { allTargetGroups = []; }
                                for (var i in groups2) { if (allTargetGroups.indexOf(i) == -1) { allTargetGroups.push(i); } }
                            }
                        }

                        if (change == 1) {
                            // Update the user
                            db.SetUser(chguser);
                            parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');

                            var targets = ['*', 'server-users', user._id, chguser._id];
                            if (allTargetGroups) { for (var i in allTargetGroups) { targets.push('server-users:' + i); } }
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 66, msgArgs: [chguser.name], msg: 'Account changed: ' + chguser.name, domain: edituserdomain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.parent.DispatchEvent(targets, obj, event);
                        }
                        if ((chguser.siteadmin) && (chguser.siteadmin !== SITERIGHT_ADMIN) && (chguser.siteadmin & 32)) {
                            // If the user is locked out of this account, disconnect now
                            parent.parent.DispatchEvent([chguser._id], obj, 'close'); // Disconnect all this user's sessions
                        }
                    }

                    // OK Response
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'edituser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'usergroups':
                {
                    // Return only groups in the same administrative domain
                    if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) {
                        // We are not user group administrator, return a list with limited data for our domain.
                        var groups = {}, groupCount = 0;
                        for (var i in parent.userGroups) { if (parent.userGroups[i].domain == domain.id) { groupCount++; groups[i] = { name: parent.userGroups[i].name }; } }
                        try { ws.send(JSON.stringify({ action: 'usergroups', ugroups: groupCount?groups:null, tag: command.tag })); } catch (ex) { }
                    } else {
                        // We are user group administrator, return a full user group list for our domain.
                        var groups = {}, groupCount = 0;
                        for (var i in parent.userGroups) { if ((obj.crossDomain == true) || (parent.userGroups[i].domain == domain.id)) { groupCount++; groups[i] = parent.userGroups[i]; } }
                        try { ws.send(JSON.stringify({ action: 'usergroups', ugroups: groupCount ? groups : null, tag: command.tag })); } catch (ex) { }
                    }
                    break;
                }
            case 'createusergroup':
                {
                    var ugrpdomain, err = null;
                    try {
                        // Check if we have new group restriction
                        if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { err = "Permission denied"; }

                        // Create user group validation
                        else if (common.validateString(command.name, 1, 64) == false) { err = "Invalid group name"; } // User group name is between 1 and 64 characters
                        else if ((command.desc != null) && (common.validateString(command.desc, 0, 1024) == false)) { err = "Invalid group description"; } // User group description is between 0 and 1024 characters

                        // If we are cloning from an existing user group, check that.
                        if (command.clone) {
                            if (common.validateString(command.clone, 1, 256) == false) { err = "Invalid clone groupid"; }
                            else {
                                var clonesplit = command.clone.split('/');
                                if ((clonesplit.length != 3) || (clonesplit[0] != 'ugrp') || ((command.domain == null) && (clonesplit[1] != domain.id))) { err = "Invalid clone groupid"; }
                                else if (parent.userGroups[command.clone] == null) { err = "Invalid clone groupid"; }
                            }

                            if (err == null) {
                                // Get new user group domain
                                ugrpdomain = parent.parent.config.domains[clonesplit[1]];
                                if (ugrpdomain == null) { err = "Invalid domain"; }
                            }
                        } else {
                            // Get new user group domain
                            ugrpdomain = domain;
                            if ((obj.crossDomain === true) && (command.domain != null)) { ugrpdomain = parent.parent.config.domains[command.domain]; }
                            if (ugrpdomain == null) { err = "Invalid domain"; }
                        }

                        // In some situations, we need a verified email address to create a device group.
                        if ((err == null) && (domain.mailserver != null) && (ugrpdomain.auth != 'sspi') && (ugrpdomain.auth != 'ldap') && (user.emailVerified !== true) && (user.siteadmin != SITERIGHT_ADMIN)) { err = "Email verification required"; } // User must verify it's email first.
                    } catch (ex) { err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createusergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // We only create Agent-less Intel AMT mesh (Type1), or Agent mesh (Type2)
                    parent.crypto.randomBytes(48, function (err, buf) {
                        // Create new device group identifier
                        var ugrpid = 'ugrp/' + ugrpdomain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');

                        // Create the new device group
                        var ugrp = { type: 'ugrp', _id: ugrpid, name: command.name, desc: command.desc, domain: ugrpdomain.id, links: {} };

                        // Clone the existing group if required
                        var pendingDispatchEvents = [];
                        if (command.clone != null) {
                            var cgroup = parent.userGroups[command.clone];
                            if (cgroup.links) {
                                for (var i in cgroup.links) {
                                    if (i.startsWith('user/')) {
                                        var xuser = parent.users[i];
                                        if ((xuser != null) && (xuser.links != null)) {
                                            ugrp.links[i] = { rights: cgroup.links[i].rights };
                                            xuser.links[ugrpid] = { rights: cgroup.links[i].rights };
                                            db.SetUser(xuser);
                                            parent.parent.DispatchEvent([xuser._id], obj, 'resubscribe');

                                            // Notify user change
                                            var targets = ['*', 'server-users', user._id, xuser._id];
                                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msgid: 67, msgArgs: [xuser.name], msg: 'User group membership changed: ' + xuser.name, domain: ugrpdomain.id };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                            //parent.parent.DispatchEvent(targets, obj, event);
                                            pendingDispatchEvents.push([targets, obj, event]);
                                        }
                                    } else if (i.startsWith('mesh/')) {
                                        var xmesh = parent.meshes[i];
                                        if (xmesh && xmesh.links) {
                                            ugrp.links[i] = { rights: cgroup.links[i].rights };
                                            xmesh.links[ugrpid] = { rights: cgroup.links[i].rights };
                                            db.Set(xmesh);

                                            // Notify mesh change
                                            var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: xmesh._id, name: xmesh.name, mtype: xmesh.mtype, desc: xmesh.desc, action: 'meshchange', links: xmesh.links, msgid: 68, msgArgs: [ugrp.name, xmesh.name], msg: 'Added user group ' + ugrp.name + ' to device group ' + xmesh.name, domain: ugrpdomain.id, invite: mesh.invite };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                            //parent.parent.DispatchEvent(['*', xmesh._id, user._id], obj, event);
                                            pendingDispatchEvents.push([parent.CreateMeshDispatchTargets(xmesh, [user._id]), obj, event]);
                                        }
                                    }
                                }
                            }
                        }

                        // Save the new group
                        db.Set(ugrp);
                        if (db.changeStream == false) { parent.userGroups[ugrpid] = ugrp; }

                        // Event the device group creation
                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugrpid, name: ugrp.name, desc: ugrp.desc, action: 'createusergroup', links: ugrp.links, msgid: 69, msgArgv: [ugrp.name], msg: 'User group created: ' + ugrp.name, ugrpdomain: domain.id };
                        parent.parent.DispatchEvent(['*', ugrpid, user._id], obj, event); // Even if DB change stream is active, this event must be acted upon.

                        // Event any pending events, these must be sent out after the group creation event is displatched.
                        for (var i in pendingDispatchEvents) { var ev = pendingDispatchEvents[i]; parent.parent.DispatchEvent(ev[0], ev[1], ev[2]); }

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created user group ' + ugrp.name); }

                        try { ws.send(JSON.stringify({ action: 'createusergroup', responseid: command.responseid, result: 'ok', ugrpid: ugrpid, links: ugrp.links })); } catch (ex) { }
                    });
                    break;
                }
            case 'deleteusergroup':
                {
                    var err = null;

                    if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { err = "Permission denied"; }

                    // Change the name or description of a user group
                    else if (common.validateString(command.ugrpid, 1, 1024) == false) { err = "Invalid group id"; } // Check the user group id
                    else {
                        var ugroupidsplit = command.ugrpid.split('/');
                        if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || ((obj.crossDomain !== true) && (ugroupidsplit[1] != domain.id))) { err = "Invalid domain id"; }
                    }

                    // Get the domain
                    var delGroupDomain = parent.parent.config.domains[ugroupidsplit[1]];
                    if (delGroupDomain == null) { err = "Invalid domain id"; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deleteusergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    db.Get(command.ugrpid, function (err, groups) {
                        if ((err != null) || (groups.length != 1)) {
                            try { ws.send(JSON.stringify({ action: 'deleteusergroup', responseid: command.responseid, result: 'Unknown device group' })); } catch (ex) { }
                            return;
                        }
                        var group = groups[0];

                        // Unlink any user and meshes that have a link to this group
                        if (group.links) {
                            for (var i in group.links) {
                                if (i.startsWith('user/')) {
                                    var xuser = parent.users[i];
                                    if ((xuser != null) && (xuser.links != null)) {
                                        delete xuser.links[group._id];
                                        db.SetUser(xuser);
                                        parent.parent.DispatchEvent([xuser._id], obj, 'resubscribe');

                                        // Notify user change
                                        var targets = ['*', 'server-users', user._id, xuser._id];
                                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msgid: 67, msgArgs: [xuser.name], msg: 'User group membership changed: ' + xuser.name, delGroupDomain: domain.id };
                                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                        parent.parent.DispatchEvent(targets, obj, event);
                                    }
                                } else if (i.startsWith('mesh/')) {
                                    var xmesh = parent.meshes[i];
                                    if (xmesh && xmesh.links) {
                                        delete xmesh.links[group._id];
                                        db.Set(xmesh);

                                        // Notify mesh change
                                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: xmesh._id, name: xmesh.name, mtype: xmesh.mtype, desc: xmesh.desc, action: 'meshchange', links: xmesh.links, msgid: 70, msgArgs: [group.name, xmesh.name], msg: 'Removed user group ' + group.name + ' from device group ' + xmesh.name, domain: delGroupDomain.id };
                                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(xmesh, [user._id]), obj, event);
                                    }
                                }
                            }
                        }

                        // Remove the user group from the database
                        db.Remove(group._id);
                        if (db.changeStream == false) { delete parent.userGroups[group._id]; }

                        // Event the user group being removed
                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, action: 'deleteusergroup', msg: change, domain: delGroupDomain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(['*', group._id, user._id], obj, event);

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' deleted user group ' + group.name); }

                        try { ws.send(JSON.stringify({ action: 'deleteusergroup', responseid: command.responseid, result: 'ok', ugrpid: group._id })); } catch (ex) { }
                    });
                    break;
                }
            case 'editusergroup':
                {
                    if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { return; }

                    // Change the name or description of a user group
                    if (common.validateString(command.ugrpid, 1, 1024) == false) break; // Check the user group id
                    var ugroupidsplit = command.ugrpid.split('/');
                    if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || (ugroupidsplit[1] != domain.id)) break;

                    // Get the user group
                    var group = parent.userGroups[command.ugrpid];
                    if (group != null) {
                        if ((common.validateString(command.name, 1, 64) == true) && (command.name != group.name)) { change = 'User group name changed from "' + group.name + '" to "' + command.name + '"'; group.name = command.name; }
                        if ((common.validateString(command.desc, 0, 1024) == true) && (command.desc != group.desc)) { if (change != '') change += ' and description changed'; else change += 'User group "' + group.name + '" description changed'; group.desc = command.desc; }
                        if ((typeof command.consent == 'number') && (command.consent != group.consent)) { if (change != '') change += ' and consent changed'; else change += 'User group "' + group.name + '" consent changed'; group.consent = command.consent; }
                        if (change != '') {
                            db.Set(group);
                            var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, consent: group.consent, action: 'usergroupchange', links: group.links, msg: change, domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                            parent.parent.DispatchEvent(['*', group._id, user._id], obj, event);
                        }
                    }
                    break;
                }
            case 'addusertousergroup':
                {
                    var err = null;
                    try {
                        if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { err = 'Permission denied'; }
                        else if (common.validateString(command.ugrpid, 1, 1024) == false) { err = 'Invalid groupid'; } // Check the meshid
                        else if (common.validateStrArray(command.usernames, 1, 64) == false) { err = 'Invalid usernames'; } // Username is between 1 and 64 characters
                        else {
                            var ugroupidsplit = command.ugrpid.split('/');
                            if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || ((obj.crossDomain !== true) && (ugroupidsplit[1] != domain.id))) { err = 'Invalid groupid'; }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Fetch the domain
                    var addUserDomain = domain;
                    if (obj.crossDomain === true) { addUserDomain = parent.parent.config.domains[ugroupidsplit[1]]; }
                    if (addUserDomain == null) { err = 'Invalid domain'; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addusertousergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Get the user group
                    var group = parent.userGroups[command.ugrpid];
                    if (group != null) {
                        if (group.links == null) { group.links = {}; }

                        var unknownUsers = [], addedCount = 0, failCount = 0;
                        for (var i in command.usernames) {
                            // Check if the user exists
                            var chguserid = 'user/' + addUserDomain.id + '/' + command.usernames[i].toLowerCase();
                            var chguser = parent.users[chguserid];
                            if (chguser == null) { chguserid = 'user/' + addUserDomain.id + '/' + command.usernames[i]; chguser = parent.users[chguserid]; }
                            if (chguser != null) {
                                // Add mesh to user
                                if (chguser.links == null) { chguser.links = {}; }
                                chguser.links[group._id] = { rights: 1 };
                                db.SetUser(chguser);
                                parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');

                                // Notify user change
                                var targets = ['*', 'server-users', user._id, chguser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 67, msgArgs: [chguser.name], msg: 'User group membership changed: ' + chguser.name, domain: addUserDomain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);

                                // Add a user to the user group
                                group.links[chguserid] = { userid: chguser._id, name: chguser.name, rights: 1 };
                                addedCount++;
                            } else {
                                unknownUsers.push(command.usernames[i]);
                                failCount++;
                            }
                        }

                        if (addedCount > 0) {
                            // Save the new group to the database
                            db.Set(group);

                            // Notify user group change
                            var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msgid: 71, msgArgs: [chguser.name, group.name], msg: 'Added user ' + chguser.name + ' to user group ' + group.name, addUserDomain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                            parent.parent.DispatchEvent(['*', group._id, user._id, chguserid], obj, event);
                        }

                        if (unknownUsers.length > 0) {
                            // Send error back, user not found.
                            displayNotificationMessage('User' + ((unknownUsers.length > 1) ? 's' : '') + ' ' + EscapeHtml(unknownUsers.join(', ')) + ' not found.', "Device Group", 'ServerNotify', 5, (unknownUsers.length > 1) ? 16 : 15, [EscapeHtml(unknownUsers.join(', '))]);
                        }
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addusertousergroup', responseid: command.responseid, result: 'ok', added: addedCount, failed: failCount })); } catch (ex) { } }

                    break;
                }
            case 'removeuserfromusergroup':
                {
                    var err = null;
                    try {
                        if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { err = 'Permission denied'; }
                        else if (common.validateString(command.ugrpid, 1, 1024) == false) { err = 'Invalid groupid'; }
                        else if (common.validateString(command.userid, 1, 256) == false) { err = 'Invalid userid'; }
                        else {
                            var ugroupidsplit = command.ugrpid.split('/');
                            if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || ((obj.crossDomain !== true) && (ugroupidsplit[1] != domain.id))) { err = 'Invalid groupid'; }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Fetch the domain
                    var removeUserDomain = domain;
                    if (obj.crossDomain !== true) { removeUserDomain = parent.parent.config.domains[ugroupidsplit[1]]; }
                    if (removeUserDomain == null) { err = 'Invalid domain'; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeuserfromusergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Check if the user exists
                    if (command.userid.startsWith('user/') == false) {
                        if (parent.users['user/' + removeUserDomain.id + '/' + command.userid.toLowerCase()] != null) { command.userid = 'user/' + removeUserDomain.id + '/' + command.userid.toLowerCase(); }
                        else if (parent.users['user/' + removeUserDomain.id + '/' + command.userid] != null) { command.userid = 'user/' + removeUserDomain.id + '/' + command.userid; }
                    }

                    var chguser = parent.users[command.userid];
                    if (chguser != null) {
                        var change = false;
                        if ((chguser.links != null) && (chguser.links[command.ugrpid] != null)) {
                            change = true;
                            delete chguser.links[command.ugrpid];

                            // Notify user change
                            var targets = ['*', 'server-users', user._id, chguser._id];
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 67, msgArgs: [chguser.name], msg: 'User group membership changed: ' + chguser.name, domain: removeUserDomain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.parent.DispatchEvent(targets, obj, event);

                            db.SetUser(chguser);
                            parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
                        }

                        // Get the user group
                        var group = parent.userGroups[command.ugrpid];
                        if (group != null) {
                            // Remove the user from the group
                            if ((group.links != null) && (group.links[command.userid] != null)) {
                                change = true;
                                delete group.links[command.userid];
                                db.Set(group);

                                // Notify user group change
                                if (change) {
                                    var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msgid: 72, msgArgs: [chguser.name, group.name], msg: 'Removed user ' + chguser.name + ' from user group ' + group.name, domain: removeUserDomain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                    parent.parent.DispatchEvent(['*', group._id, user._id, chguser._id], obj, event);
                                }
                            }
                        }
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeuserfromusergroup', responseid: command.responseid, result: 'ok', added: addedCount, failed: failCount })); } catch (ex) { } }

                    break;
                }
            case 'changemeshnotify':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    var err = null;
                    try {
                        // Change the current user's notification flags for a meshid
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid group identifier'; } // Check the meshid
                        else if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                        if (common.validateInt(command.notify) == false) { err = 'Invalid notification flags'; }
                        if (parent.IsMeshViewable(user, command.meshid) == false) err = 'Access denied';
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changemeshnotify', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                    // Change the notification (TODO: Add user group support, not sure how to do this here)
                    // TODO (UserGroups)
                    if (user.links[command.meshid]) {
                        if (command.notify == 0) {
                            delete user.links[command.meshid].notify;
                        } else {
                            user.links[command.meshid].notify = command.notify;
                        }
                    }

                    // Save the user
                    parent.db.SetUser(user);

                    // Notify change
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 73, msg: 'Device group notification changed', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);

                    break;
                }
            case 'changepassword':
                {
                    // If this account is settings locked, return here.
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;

                    // Change our own password
                    if (common.validateString(command.oldpass, 1, 256) == false) break;
                    if (common.validateString(command.newpass, 1, 256) == false) break;
                    if ((command.hint != null) && (common.validateString(command.hint, 0, 256) == false)) break;
                    if (common.checkPasswordRequirements(command.newpass, domain.passwordrequirements) == false) break; // Password does not meet requirements

                    // Start by checking the old password
                    parent.checkUserPassword(domain, user, command.oldpass, function (result) {
                        if (result == true) {
                            parent.checkOldUserPasswords(domain, user, command.newpass, function (result) {
                                if (result == 1) {
                                    // Send user notification of error
                                    displayNotificationMessage("Error, unable to change to previously used password.", "Account Settings", 'ServerNotify', 4, 17);
                                } else if (result == 2) {
                                    // Send user notification of error
                                    displayNotificationMessage("Error, unable to change to commonly used password.", "Account Settings", 'ServerNotify', 4, 18);
                                } else {
                                    // Update the password
                                    require('./pass').hash(command.newpass, function (err, salt, hash, tag) {
                                        if (err) {
                                            // Send user notification of error
                                            displayNotificationMessage("Error, password not changed.", "Account Settings", 'ServerNotify', 4, 19);
                                        } else {
                                            const nowSeconds = Math.floor(Date.now() / 1000);

                                            // Change the password
                                            if (domain.passwordrequirements != null) {
                                                // Save password hint if this feature is enabled
                                                if ((domain.passwordrequirements.hint === true) && (command.hint != null)) { var hint = command.hint; if (hint.length > 250) { hint = hint.substring(0, 250); } user.passhint = hint; } else { delete user.passhint; }

                                                // Save previous password if this feature is enabled
                                                if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                                    if (user.oldpasswords == null) { user.oldpasswords = []; }
                                                    user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                                    const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                                    if (extraOldPasswords > 0) { user.oldpasswords.splice(0, extraOldPasswords); }
                                                }
                                            }
                                            user.salt = salt;
                                            user.hash = hash;
                                            user.passchange = nowSeconds;
                                            delete user.passtype;
                                            db.SetUser(user);

                                            var targets = ['*', 'server-users'];
                                            if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 74, msgArgs: [user.name], msg: 'Account password changed: ' + user.name, domain: domain.id };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                            parent.parent.DispatchEvent(targets, obj, event);

                                            // Send user notification of password change
                                            displayNotificationMessage("Password changed.", "Account Settings", 'ServerNotify', 4, 20);

                                            // Log in the auth log
                                            if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' changed this password'); }
                                        }
                                    }, 0);
                                }
                            });
                        } else {
                            // Send user notification of error
                            displayNotificationMessage("Current password not correct.", "Account Settings", 'ServerNotify', 4, 21);
                        }
                    });
                    break;
                }
            case 'changeuserpass':
                {
                    // Change a user's password
                    if ((user.siteadmin & 2) == 0) break;
                    if (common.validateString(command.userid, 1, 256) == false) break;
                    if (common.validateString(command.pass, 0, 256) == false) break;
                    if ((command.hint != null) && (common.validateString(command.hint, 0, 256) == false)) break;
                    if (typeof command.removeMultiFactor != 'boolean') break;
                    if ((command.pass != '') && (common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false)) break; // Password does not meet requirements

                    var chguser = parent.users[command.userid];
                    if (chguser) {
                        // If we are not full administrator, we can't change anything on a different full administrator
                        if ((user.siteadmin != SITERIGHT_ADMIN) & (chguser.siteadmin === SITERIGHT_ADMIN)) break;

                        // Can only perform this operation on other users of our group.
                        if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) break;

                        // Compute the password hash & save it
                        require('./pass').hash(command.pass, function (err, salt, hash, tag) {
                            if (!err) {
                                if (command.pass != '') { chguser.salt = salt; chguser.hash = hash; }
                                if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (command.hint != null)) {
                                    var hint = command.hint;
                                    if (hint.length > 250) { hint = hint.substring(0, 250); }
                                    chguser.passhint = hint;
                                }
                                if (command.resetNextLogin === true) { chguser.passchange = -1; } else { chguser.passchange = Math.floor(Date.now() / 1000); }
                                delete chguser.passtype; // Remove the password type if one was present.
                                if (command.removeMultiFactor == true) {
                                    if (chguser.otpekey != null) { delete chguser.otpekey; }
                                    if (chguser.otpsecret != null) { delete chguser.otpsecret; }
                                    if (chguser.otphkeys != null) { delete chguser.otphkeys; }
                                    if (chguser.otpkeys != null) { delete chguser.otpkeys; }
                                    if ((chguser.otpekey != null) && (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null))) { delete chguser.otpekey; }
                                    if ((chguser.phone != null) && (parent.parent.smsserver != null)) { delete chguser.phone; }
                                }
                                db.SetUser(chguser);

                                var targets = ['*', 'server-users', user._id, chguser._id];
                                if (chguser.groups) { for (var i in chguser.groups) { targets.push('server-users:' + i); } }
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 75, msg: 'Changed account credentials', domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);

                                // Log in the auth log
                                if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' changed account password of user ' + chguser.name); }
                            } else {
                                // Report that the password change failed
                                // TODO
                            }
                        }, 0);
                    }
                    break;
                }
            case 'notifyuser':
                {
                    // Send a notification message to a user
                    if ((user.siteadmin & 2) == 0) break;
                    if (common.validateString(command.userid, 1, 2048) == false) break;
                    if (common.validateString(command.msg, 1, 4096) == false) break;

                    // Can only perform this operation on other users of our group.
                    var chguser = parent.users[command.userid];
                    if (chguser == null) break; // This user does not exists
                    if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) break;

                    // Create the notification message
                    var notification = { action: 'msg', type: 'notify', id: Math.random(), value: command.msg, title: user.name, icon: 8, userid: user._id, username: user.name };
                    if (typeof command.url == 'string') { notification.url = command.url; }
                    if ((typeof command.maxtime == 'number') && (command.maxtime > 0)) { notification.maxtime = command.maxtime; }
                    if (command.msgid == 11) { notification.value = "Chat Request, Click here to accept."; notification.msgid = 11; } // Chat request

                    // Get the list of sessions for this user
                    var sessions = parent.wssessions[command.userid];
                    if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                    if (parent.parent.multiServer != null) {
                        // TODO: Add multi-server support
                    }

                    // If the user is not connected, use web push if available.
                    if ((parent.wssessions[chguser._id] == null) && (parent.sessionsCount[chguser._id] == null)) {
                        // Perform web push notification
                        var payload = { body: command.msg, icon: 8 }; // Icon 8 is the user icon.
                        if (command.url) { payload.url = command.url; }
                        if (domain.title != null) { payload.title = domain.title; } else { payload.title = "MeshCentral"; }
                        payload.title += ' - ' + user.name;
                        parent.performWebPush(domain, chguser, payload, { TTL: 60 }); // For now, 1 minute TTL
                    }

                    break;
                }
            case 'meshmessenger':
                {
                    // Setup a user-to-user session
                    if (common.validateString(command.userid, 1, 2048)) {
                        // Send a notification message to a user
                        if ((user.siteadmin & 2) == 0) break;

                        // Can only perform this operation on other users of our group.
                        var chguser = parent.users[command.userid];
                        if (chguser == null) break; // This user does not exists
                        if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) break;

                        // Create the notification message
                        var notification = {
                            'action': 'msg', 'type': 'notify', id: Math.random(), 'value': "Chat Request, Click here to accept.", 'title': user.name, 'userid': user._id, 'username': user.name, 'tag': 'meshmessenger/' + encodeURIComponent(command.userid) + '/' + encodeURIComponent(user._id), msgid: 11
                        };

                        // Get the list of sessions for this user
                        var sessions = parent.wssessions[command.userid];
                        if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                        if (parent.parent.multiServer != null) {
                            // TODO: Add multi-server support
                        }

                        // If the user is not connected, use web push if available.
                        if ((parent.wssessions[chguser._id] == null) && (parent.sessionsCount[chguser._id] == null)) {
                            // Create the server url
                            var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                            var xdomain = (domain.dns == null) ? domain.id : '';
                            if (xdomain != '') xdomain += "/";
                            var url = "https://" + parent.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.userid) + "/" + encodeURIComponent(user._id);

                            // Perform web push notification
                            var payload = { body: "Chat Request, Click here to accept.", icon: 8, url: url }; // Icon 8 is the user icon.
                            if (domain.title != null) { payload.title = domain.title; } else { payload.title = "MeshCentral"; }
                            payload.title += ' - ' + user.name;
                            parent.performWebPush(domain, chguser, payload, { TTL: 60 }); // For now, 1 minute TTL
                        }
                        return;
                    }

                    // User-to-device chat is not support in LAN-only mode yet. We need the agent to replace the IP address of the server??
                    if (args.lanonly == true) { return; }

                    // Setup a user-to-node session
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        // Check if this user has rights to do this
                        if ((rights & MESHRIGHT_CHATNOTIFY) == 0) return;

                        // Create the server url
                        var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                        var xdomain = (domain.dns == null) ? domain.id : '';
                        if (xdomain != '') xdomain += "/";
                        var url = "https://" + parent.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.nodeid) + "/" + encodeURIComponent(user._id);

                        // Open a web page on the remote device
                        routeCommandToNode({ 'action': 'openUrl', 'nodeid': command.nodeid, 'userid': user._id, 'username': user.name, 'url': url });
                    });
                    break;
                }
            case 'serverversion':
                {
                    // Check the server version
                    if ((user.siteadmin & 16) == 0) break;
                    if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.upgrade !== true))) break;
                    //parent.parent.getLatestServerVersion(function (currentVersion, latestVersion) { try { ws.send(JSON.stringify({ action: 'serverversion', current: currentVersion, latest: latestVersion })); } catch (ex) { } });
                    parent.parent.getServerTags(function (tags, err) { try { ws.send(JSON.stringify({ action: 'serverversion', tags: tags })); } catch (ex) { } });
                    break;
                }
            case 'serverupdate':
                {
                    // Perform server update
                    if ((user.siteadmin & 16) == 0) break;
                    if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.upgrade !== true))) break;
                    if ((command.version != null) && (typeof command.version != 'string')) break;
                    parent.parent.performServerUpdate(command.version);
                    break;
                }
            case 'servererrors':
                {
                    // Load the server error log
                    if ((user.siteadmin & 16) == 0) break;
                    if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.errorlog !== true))) break;
                    fs.readFile(parent.parent.getConfigFilePath('mesherrors.txt'), 'utf8', function (err, data) { try { ws.send(JSON.stringify({ action: 'servererrors', data: data })); } catch (ex) { } });
                    break;
                }
            case 'serverclearerrorlog':
                {
                    // Clear the server error log
                    if ((user.siteadmin & 16) == 0) break;
                    fs.unlink(parent.parent.getConfigFilePath('mesherrors.txt'), function (err) { });
                    break;
                }
            case 'createmesh':
                {
                    var err = null;
                    try {
                        // Check if we have new group restriction
                        if ((user.siteadmin != SITERIGHT_ADMIN) && ((user.siteadmin & 64) != 0)) { err = 'Permission denied'; }

                        // In some situations, we need a verified email address to create a device group.
                        else if ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (user.emailVerified !== true) && (user.siteadmin != SITERIGHT_ADMIN)) { err = 'Email verification required'; } // User must verify it's email first.

                        // Create mesh
                        else if (common.validateString(command.meshname, 1, 128) == false) { err = 'Invalid group name'; } // Meshname is between 1 and 64 characters
                        else if ((command.desc != null) && (common.validateString(command.desc, 0, 1024) == false)) { err = 'Invalid group description'; } // Mesh description is between 0 and 1024 characters
                        else if ((command.meshtype !== 1) && (command.meshtype !== 2)) { err = 'Invalid group type'; }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createmesh', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // We only create Agent-less Intel AMT mesh (Type1), or Agent mesh (Type2)
                    parent.crypto.randomBytes(48, function (err, buf) {
                        // Create new device group identifier
                        meshid = 'mesh/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');

                        // Create the new device group
                        var links = {};
                        links[user._id] = { name: user.name, rights: 4294967295 };
                        mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links, creation: Date.now(), creatorid: user._id, creatorname: user.name };

                        // Add flags and consent if present
                        if (typeof command.flags == 'number') { mesh.flags = command.flags; }
                        if (typeof command.consent == 'number') { mesh.consent = command.consent; }

                        // Save the new device group
                        db.Set(mesh);
                        parent.meshes[meshid] = mesh;
                        parent.parent.AddEventDispatch([meshid], ws);

                        // Change the user to make him administration of the new device group
                        if (user.links == null) user.links = {};
                        user.links[meshid] = { rights: 4294967295 };
                        user.subscriptions = parent.subscribe(user._id, ws);
                        db.SetUser(user);

                        // Event the user change
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);

                        // Event the device group creation
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msgid: 76, msgArgs: [command.meshname], msg: 'Device group created: ' + command.meshname, domain: domain.id, creation: mesh.creation, creatorid: mesh.creatorid, creatorname: mesh.creatorname, flags: mesh.flags, consent: mesh.consent };
                        parent.parent.DispatchEvent(['*', meshid, user._id], obj, event); // Even if DB change stream is active, this event must be acted upon.

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created device group ' + mesh.name); }

                        try { ws.send(JSON.stringify({ action: 'createmesh', responseid: command.responseid, result: 'ok', meshid: meshid, links: links })); } catch (ex) { }
                    });
                    break;
                }
            case 'deletemesh':
                {
                    // Delete a mesh and all computers within it
                    var err = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    // Validate input
                    try {
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid group identifier'; } // Check the meshid
                        else if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deletemesh', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                    // Get the device group reference we are going to delete
                    var mesh = parent.meshes[command.meshid];
                    if (mesh == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deletemesh', responseid: command.responseid, result: 'Unknown device group' })); } catch (ex) { } } return; }

                    // Check if this user has rights to do this
                    var err = null;
                    if (parent.GetMeshRights(user, mesh) != MESHRIGHT_ADMIN) { err = 'Access denied'; }
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = 'Invalid group'; } // Invalid domain, operation only valid for current domain

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deletemesh', responseid: command.responseid, result: err })); } catch (ex) { } } return; }

                    // Fire the removal event first, because after this, the event will not route
                    var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msgid: 77, msgArgs: [command.meshname], msg: 'Device group deleted: ' + command.meshname, domain: domain.id };
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid), obj, event); // Even if DB change stream is active, this event need to be acted on.

                    // Remove all user links to this mesh
                    for (var j in mesh.links) {
                        if (j.startsWith('user/')) {
                            var xuser = parent.users[j];
                            if (xuser && xuser.links) {
                                delete xuser.links[mesh._id];
                                db.SetUser(xuser);
                                parent.parent.DispatchEvent([xuser._id], obj, 'resubscribe');

                                // Notify user change
                                var targets = ['*', 'server-users', user._id, xuser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msgid: 78, msgArgs: [xuser.name], msg: 'Device group membership changed: ' + xuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }
                        } else if (j.startsWith('ugrp/')) {
                            var xgroup = parent.userGroups[j];
                            if (xgroup && xgroup.links) {
                                delete xgroup.links[mesh._id];
                                db.Set(xgroup);

                                // Notify user group change
                                var targets = ['*', 'server-ugroups', user._id, xgroup._id];
                                var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: xgroup._id, name: xgroup.name, desc: xgroup.desc, action: 'usergroupchange', links: xgroup.links, msgid: 79, msgArgs: [xgroup.name], msg: 'User group changed: ' + xgroup.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }
                        }
                    }

                    // Delete all files on the server for this mesh
                    try {
                        var meshpath = parent.getServerRootFilePath(mesh);
                        if (meshpath != null) { parent.deleteFolderRec(meshpath); }
                    } catch (e) { }

                    parent.parent.RemoveEventDispatchId(command.meshid); // Remove all subscriptions to this mesh

                    // Mark the mesh as deleted
                    mesh.deleted = new Date(); // Mark the time this mesh was deleted, we can expire it at some point.
                    db.Set(mesh); // We don't really delete meshes because if a device connects to is again, we will un-delete it.

                    // Delete all devices attached to this mesh in the database
                    db.RemoveMeshDocuments(command.meshid);
                    // TODO: We are possibly deleting devices that users will have links to. We need to clean up the broken links from on occasion.

                    // Log in the auth log
                    if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' deleted device group ' + mesh.name); }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deletemesh', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'editmesh':
                {
                    // Change the name or description of a device group (mesh)
                    var err = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshidname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshidname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    // Validate input
                    try {
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid group identifier'; } // Check the meshid
                        else if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                        if (err == null) {
                            mesh = parent.meshes[command.meshid];
                            if (mesh == null) { err = 'Invalid group identifier '; }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'editmesh', responseid: command.responseid, result: err })); } catch (ex) { } } break; }
                    
                    change = '';

                    // Check if this user has rights to do this
                    if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return;
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    if ((common.validateString(command.meshname, 1, 128) == true) && (command.meshname != mesh.name)) { change = 'Group name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }
                    if ((common.validateString(command.desc, 0, 1024) == true) && (command.desc != mesh.desc)) { if (change != '') change += ' and description changed'; else change += 'Group "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
                    if ((common.validateInt(command.flags) == true) && (command.flags != mesh.flags)) { if (change != '') change += ' and flags changed'; else change += 'Group "' + mesh.name + '" flags changed'; mesh.flags = command.flags; }
                    if ((common.validateInt(command.consent) == true) && (command.consent != mesh.consent)) { if (change != '') change += ' and consent changed'; else change += 'Group "' + mesh.name + '" consent changed'; mesh.consent = command.consent; }

                    // See if we need to change device group invitation codes
                    if (mesh.mtype == 2) {
                        if (command.invite === '*') {
                            // Clear invite codes
                            if (mesh.invite != null) { delete mesh.invite; }
                            if (change != '') { change += ' and invite code changed'; } else { change += 'Group "' + mesh.name + '" invite code changed'; }
                        } else if ((typeof command.invite == 'object') && (Array.isArray(command.invite.codes)) && (typeof command.invite.flags == 'number')) {
                            // Set invite codes
                            if ((mesh.invite == null) || (mesh.invite.codes != command.invite.codes) || (mesh.invite.flags != command.invite.flags)) {
                                // Check if an invite code is not already in use.
                                var dup = null;
                                for (var i in command.invite.codes) {
                                    for (var j in parent.meshes) {
                                        if ((j != command.meshid) && (parent.meshes[j].domain == domain.id) && (parent.meshes[j].invite != null) && (parent.meshes[j].invite.codes.indexOf(command.invite.codes[i]) >= 0)) { dup = command.invite.codes[i]; break; }
                                    }
                                }
                                if (dup != null) {
                                    // A duplicate was found, don't allow this change.
                                    displayNotificationMessage("Error, invite code \"" + dup + "\" already in use.", "Invite Codes", null, 6, 22, [ dup ]);
                                    return;
                                }
                                mesh.invite = { codes: command.invite.codes, flags: command.invite.flags };
                                if (change != '') { change += ' and invite code changed'; } else { change += 'Group "' + mesh.name + '" invite code changed'; }
                            }
                        }
                    }

                    if (change != '') {
                        db.Set(mesh);
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, flags: mesh.flags, consent: mesh.consent, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id, invite: mesh.invite };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id]), obj, event);
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'editmesh', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'addmeshuser':
                {
                    var err = null, mesh, meshIdSplit;
                    if (typeof command.userid == 'string') { command.userids = [command.userid]; }

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    var selfMeshRights = 0;
                    try {
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid groupid'; } // Check the meshid
                        else if (common.validateInt(command.meshadmin) == false) { err = 'Invalid group rights'; } // Mesh rights must be an integer
                        else if ((common.validateStrArray(command.usernames, 1, 64) == false) && (common.validateStrArray(command.userids, 1, 128) == false)) { err = 'Invalid usernames'; } // Username is between 1 and 64 characters
                        else {
                            if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            mesh = parent.meshes[command.meshid];
                            meshIdSplit = command.meshid.split('/');
                            if (mesh == null) { err = 'Unknown group'; }
                            else if (((selfMeshRights = parent.GetMeshRights(user, mesh)) & MESHRIGHT_MANAGEUSERS) == 0) { err = 'Permission denied'; }
                            else if ((meshIdSplit.length != 3) || (meshIdSplit[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addmeshuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Convert user names to userid's
                    if (command.userids == null) {
                        command.userids = [];
                        for (var i in command.usernames) {
                            if (parent.users['user/' + domain.id + '/' + command.usernames[i].toLowerCase()] != null) { command.userids.push('user/' + domain.id + '/' + command.usernames[i].toLowerCase()); }
                            else if (parent.users['user/' + domain.id + '/' + command.usernames[i]] != null) { command.userids.push('user/' + domain.id + '/' + command.usernames[i]); }
                        }
                    }
                    var unknownUsers = [], successCount = 0, failCount = 0, msgs = [];
                    for (var i in command.userids) {
                        // Check if the user exists
                        var newuserid = command.userids[i], newuser = null;
                        if (newuserid.startsWith('user/')) { newuser = parent.users[newuserid]; }
                        else if (newuserid.startsWith('ugrp/')) { newuser = parent.userGroups[newuserid]; }

                        // Search for a user name in that windows domain is the username starts with *\
                        if ((newuser == null) && (newuserid.startsWith('user/' + domain.id + '/*\\')) == true) {
                            var search = newuserid.split('/')[2].substring(1);
                            for (var i in parent.users) { if (i.endsWith(search) && (parent.users[i].domain == domain.id)) { newuser = parent.users[i]; command.userids[i] = newuserid = parent.users[i]._id; break; } }
                        }

                        // Make sure this user is in the same domain as the device group
                        if (meshIdSplit[1] != newuserid.split('/')[1]) { msgs.push("Mismatch domains"); continue; }

                        if (newuser != null) {
                            // Can't add or modify self
                            if (newuserid == obj.user._id) { msgs.push("Can't change self"); continue; }

                            var targetMeshRights = 0;
                            if ((newuser.links != null) && (newuser.links[command.meshid] != null) && (newuser.links[command.meshid].rights != null)) { targetMeshRights = newuser.links[command.meshid].rights; }
                            if ((targetMeshRights === MESHRIGHT_ADMIN) && (selfMeshRights != MESHRIGHT_ADMIN)) { msgs.push("Can't change rights of device group administrator"); continue; } // A non-admin can't kick out an admin

                            if (command.remove === true) {
                                // Remove mesh from user or user group
                                delete newuser.links[command.meshid];
                            } else {
                                // Adjust rights since we can't add more rights that we have outself for MESHRIGHT_MANAGEUSERS
                                if ((selfMeshRights != MESHRIGHT_ADMIN) && (command.meshadmin == MESHRIGHT_ADMIN)) { msgs.push("Can't set device group administrator, if not administrator"); continue; }
                                if (((selfMeshRights & 2) == 0) && ((command.meshadmin & 2) != 0) && ((targetMeshRights & 2) == 0)) { command.meshadmin -= 2; }

                                // Add mesh to user or user group
                                if (newuser.links == null) { newuser.links = {}; }
                                if (newuser.links[command.meshid]) { newuser.links[command.meshid].rights = command.meshadmin; } else { newuser.links[command.meshid] = { rights: command.meshadmin }; }
                            }
                            if (newuserid.startsWith('user/')) { db.SetUser(newuser); }
                            else if (newuserid.startsWith('ugrp/')) { db.Set(newuser); }
                            parent.parent.DispatchEvent([newuser._id], obj, 'resubscribe');

                            if (newuserid.startsWith('user/')) {
                                // Notify user change
                                var targets = ['*', 'server-users', user._id, newuser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(newuser), action: 'accountchange', msgid: 78, msgArgs: [newuser.name], msg: 'Device group membership changed: ' + newuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (newuserid.startsWith('ugrp/')) {
                                // Notify user group change
                                var targets = ['*', 'server-ugroups', user._id, newuser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: newuser._id, name: newuser.name, desc: newuser.desc, action: 'usergroupchange', links: newuser.links, msgid: 79, msgArgs: [newuser.name], msg: 'User group changed: ' + newuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }

                            var event;
                            if (command.remove === true) {
                                // Remove userid from the mesh
                                delete mesh.links[newuserid];
                                db.Set(mesh);
                                event = { etype: 'mesh', username: newuser.name, userid: user._id, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + newuser.name + ' from device group ' + mesh.name, domain: domain.id, invite: mesh.invite };
                            } else {
                                // Add userid to the mesh
                                mesh.links[newuserid] = { name: newuser.name, rights: command.meshadmin };
                                db.Set(mesh);
                                event = { etype: 'mesh', username: newuser.name, userid: user._id, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Added user ' + newuser.name + ' to device group ' + mesh.name, domain: domain.id, invite: mesh.invite };
                            }

                            // Notify mesh change
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id, newuserid]), obj, event);
                            if (command.remove === true) { msgs.push("Removed user " + newuserid.split('/')[2]); } else { msgs.push("Added user " + newuserid.split('/')[2]); }
                            successCount++;
                        } else {
                            msgs.push("Unknown user " + newuserid.split('/')[2]);
                            unknownUsers.push(newuserid.split('/')[2]);
                            failCount++;
                        }
                    }

                    if ((successCount == 0) && (failCount == 0)) { msgs.push("Nothing done"); }

                    if (unknownUsers.length > 0) {
                        // Send error back, user not found.
                        displayNotificationMessage('User' + ((unknownUsers.length > 1) ? 's' : '') + ' ' + EscapeHtml(unknownUsers.join(', ')) + ' not found.', "Device Group", 'ServerNotify', 5, (unknownUsers.length > 1) ? 16 : 15, [EscapeHtml(unknownUsers.join(', '))]);
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addmeshuser', responseid: command.responseid, result: msgs.join(', '), success: successCount, failed: failCount })); } catch (ex) { } }
                    break;
                }
            case 'adddeviceuser': {
                if (typeof command.userid == 'string') { command.userids = [command.userid]; }
                var err = null, nodeIdSplit;
                try {
                    if (common.validateString(command.nodeid, 1, 1024) == false) { err = 'Invalid nodeid'; } // Check the nodeid
                    else if (common.validateInt(command.rights) == false) { err = 'Invalid rights'; } // Device rights must be an integer
                    else if ((command.rights & 7) != 0) { err = 'Invalid rights'; } // EDITMESH, MANAGEUSERS or MANAGECOMPUTERS rights can't be assigned to a user to device link
                    else if ((common.validateStrArray(command.usernames, 1, 64) == false) && (common.validateStrArray(command.userids, 1, 128) == false)) { err = 'Invalid usernames'; } // Username is between 1 and 64 characters
                    else {
                        if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                        else if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                    }
                } catch (ex) { err = 'Validation exception: ' + ex; }

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adddeviceuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Convert user names to userid's
                if (command.userids == null) {
                    command.userids = [];
                    for (var i in command.usernames) {
                        if (command.usernames[i] != null) {
                            if (parent.users['user/' + domain.id + '/' + command.usernames[i].toLowerCase()] != null) { command.userids.push('user/' + domain.id + '/' + command.usernames[i].toLowerCase()); }
                            else if (parent.users['user/' + domain.id + '/' + command.usernames[i]] != null) { command.userids.push('user/' + domain.id + '/' + command.usernames[i]); }
                        }
                    }
                }

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    // Check if already in the right mesh
                    if ((node == null) || (node.meshid == command.meshid)) return;
                    var dispatchTargets = ['*', node.meshid, node._id];

                    // Check that we have rights to manage users on this device
                    if ((rights & MESHRIGHT_MANAGEUSERS) == 0) return;

                    // Add the new link to the users
                    var nodeChanged = false;
                    for (var i in command.userids) {
                        var newuserid = command.userids[i];

                        // Add a user
                        var newuser = null;
                        if (newuserid.startsWith('ugrp/')) { newuser = parent.userGroups[newuserid]; }
                        if (newuserid.startsWith('user/')) {
                            newuser = parent.users[newuserid];

                            // Search for a user name in that windows domain is the username starts with *\
                            if ((newuser == null) && (newuserid.startsWith('user/' + domain.id + '/*\\')) == true) {
                                var search = newuserid.split('/')[2].substring(1);
                                for (var i in parent.users) { if (i.endsWith(search) && (parent.users[i].domain == domain.id)) { newuser = parent.users[i]; command.userids[i] = newuserid = newuser._id; break; } }
                            }
                        }

                        // Check the the user and device are in the same domain
                        if (command.nodeid.split('/')[1] != newuserid.split('/')[1]) return; // Domain mismatch

                        if (newuser != null) {
                            // Add this user to the dispatch target list
                            dispatchTargets.push(newuser._id);

                            if (command.remove === true) {
                                // Remove link to this user
                                if (newuser.links != null) {
                                    delete newuser.links[command.nodeid];
                                    if (Object.keys(newuser.links).length == 0) { delete newuser.links; }
                                }

                                // Remove link to this device
                                if (node.links != null) {
                                    delete node.links[newuserid];
                                    nodeChanged = true;
                                    if (Object.keys(node.links).length == 0) { delete node.links; }
                                }
                            } else {
                                // Add the new link to this user
                                if (newuser.links == null) { newuser.links = {}; }
                                newuser.links[command.nodeid] = { rights: command.rights };

                                // Add the new link to the device
                                if (node.links == null) { node.links = {}; }
                                node.links[newuserid] = { rights: command.rights }
                                nodeChanged = true;
                            }
                            
                            // Save the user to the database
                            if (newuserid.startsWith('user/')) {
                                db.SetUser(newuser);
                                parent.parent.DispatchEvent([newuser], obj, 'resubscribe');

                                // Notify user change
                                var targets = ['*', 'server-users', newuserid];
                                var event;
                                if (command.rights == 0) {
                                    event = { etype: 'user', userid: user._id, username: user.name, action: 'accountchange', msgid: 81, msgArgs: [newuser.name], msg: 'Removed user device rights for ' + newuser.name, domain: domain.id, account: parent.CloneSafeUser(newuser), nodeListChange: newuserid };
                                } else {
                                    event = { etype: 'user', userid: user._id, username: user.name, action: 'accountchange', msgid: 82, msgArgs: [newuser.name], msg: 'Changed user device rights for ' + newuser.name, domain: domain.id, account: parent.CloneSafeUser(newuser), nodeListChange: newuserid };
                                }
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (newuserid.startsWith('ugrp/')) {
                                db.Set(newuser);

                                // Notify user group change
                                var targets = ['*', 'server-ugroups', newuser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: newuser._id, name: newuser.name, action: 'usergroupchange', links: newuser.links, msgid: 79, msgArgs: [newuser.name], msg: 'User group changed: ' + newuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }
                        }
                    }

                    // Save the device
                    if (nodeChanged == true) {
                        // Save the node to the database
                        db.Set(parent.cleanDevice(node));

                        // Event the node change
                        var event;
                        if (command.rights == 0) {
                            event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msgid: 81, msgArgs: [node.name], msg: 'Removed user device rights for ' + node.name, node: parent.CloneSafeNode(node) }
                        } else {
                            event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msgid: 82, msgArgs: [node.name], msg: 'Changed user device rights for ' + node.name, node: parent.CloneSafeNode(node) }
                        }
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(dispatchTargets, obj, event);
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adddeviceuser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                });

                break;
            }
            case 'removemeshuser':
                {
                    var xdomain, err = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    try {
                        if (common.validateString(command.userid, 1, 1024) == false) { err = "Invalid userid"; } // Check userid
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = "Invalid groupid"; } // Check meshid
                        if (command.userid.indexOf('/') == -1) { command.userid = 'user/' + domain.id + '/' + command.userid; }
                        if (command.userid == obj.user._id) { err = "Can't remove self"; } // Can't add of modify self
                        if ((command.userid.split('/').length != 3) || ((obj.crossDomain !== true) && (command.userid.split('/')[1] != domain.id))) { err = "Invalid userid"; } // Invalid domain, operation only valid for current domain
                        else {
                            if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            mesh = parent.meshes[command.meshid];
                            var meshIdSplit = command.meshid.split('/');
                            if (mesh == null) { err = "Unknown device group"; }
                            else if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_MANAGEUSERS) == 0) { err = "Permission denied"; }
                            else if (meshIdSplit.length != 3) { err = "Invalid domain"; } // Invalid domain, operation only valid for current domain
                            else {
                                xdomain = domain;
                                if (obj.crossDomain !== true) { xdomain = parent.parent.config.domains[meshIdSplit[1]]; }
                                if (xdomain == null) { err = "Invalid domain"; }
                            }
                        }
                    } catch (ex) { err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        console.log(err);
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removemeshuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Check if the user exists - Just in case we need to delete a mesh right for a non-existant user, we do it this way. Technically, it's not possible, but just in case.
                    var deluserid = command.userid, deluser = null;
                    if (deluserid.startsWith('user/')) { deluser = parent.users[deluserid]; }
                    else if (deluserid.startsWith('ugrp/')) { deluser = parent.userGroups[deluserid]; }

                    // Search for a user name in that windows domain is the username starts with *\
                    if ((deluser == null) && (deluserid.startsWith('user/' + xdomain.id + '/*\\')) == true) {
                        var search = deluserid.split('/')[2].substring(1);
                        for (var i in parent.users) { if (i.endsWith(search) && (parent.users[i].domain == xdomain.id)) { deluser = parent.users[i]; command.userid = deluserid = deluser._id; break; } }
                    }

                    if (deluser != null) {
                        // Remove mesh from user
                        if (deluser.links != null && deluser.links[command.meshid] != null) {
                            var delmeshrights = deluser.links[command.meshid].rights;
                            if ((delmeshrights == MESHRIGHT_ADMIN) && (parent.GetMeshRights(user, mesh) != MESHRIGHT_ADMIN)) return; // A non-admin can't kick out an admin
                            delete deluser.links[command.meshid];
                            if (deluserid.startsWith('user/')) { db.SetUser(deluser); }
                            else if (deluserid.startsWith('ugrp/')) { db.Set(deluser); }
                            parent.parent.DispatchEvent([deluser._id], obj, 'resubscribe');

                            if (deluserid.startsWith('user/')) {
                                // Notify user change
                                var targets = ['*', 'server-users', user._id, deluser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(deluser), action: 'accountchange', msgid: 78, msgArgs: [deluser.name], msg: 'Device group membership changed: ' + deluser.name, domain: xdomain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (deluserid.startsWith('ugrp/')) {
                                // Notify user group change
                                var targets = ['*', 'server-ugroups', user._id, deluser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: deluser._id, name: deluser.name, desc: deluser.desc, action: 'usergroupchange', links: deluser.links, msgid: 79, msgArgs: [deluser.name], msg: 'User group changed: ' + deluser.name, domain: xdomain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }
                        }
                    }

                    // Remove user from the mesh
                    if (mesh.links[command.userid] != null) {
                        delete mesh.links[command.userid];
                        db.Set(mesh);

                        // Notify mesh change
                        var event;
                        if (deluser != null) {
                            event = { etype: 'mesh', username: user.name, userid: deluser.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msgid: 83, msgArgs: [deluser.name, mesh.name], msg: 'Removed user ' + deluser.name + ' from device group ' + mesh.name, domain: xdomain.id, invite: mesh.invite };
                        } else {
                            event = { etype: 'mesh', username: user.name, userid: (deluserid.split('/')[2]), meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msgid: 83, msgArgs: [(deluserid.split('/')[2]), mesh.name], msg: 'Removed user ' + (deluserid.split('/')[2]) + ' from device group ' + mesh.name, domain: xdomain.id, invite: mesh.invite };
                        }
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id, command.userid]), obj, event);
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removemeshuser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    } else {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removemeshuser', responseid: command.responseid, result: 'User not in group' })); } catch (ex) { } }
                    }
                    break;
                }
            case 'meshamtpolicy':
                {
                    // Change a mesh Intel AMT policy
                    if (common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    if (common.validateObject(command.amtpolicy) == false) break; // Check the amtpolicy
                    if (common.validateInt(command.amtpolicy.type, 0, 4) == false) break; // Check the amtpolicy.type
                    if (command.amtpolicy.type === 2) {
                        if ((command.amtpolicy.password != null) && (common.validateString(command.amtpolicy.password, 0, 32) == false)) break; // Check the amtpolicy.password
                        if ((command.amtpolicy.badpass != null) && common.validateInt(command.amtpolicy.badpass, 0, 1) == false) break; // Check the amtpolicy.badpass
                        if (common.validateInt(command.amtpolicy.cirasetup, 0, 2) == false) break; // Check the amtpolicy.cirasetup
                    } else if (command.amtpolicy.type === 3) {
                        if ((command.amtpolicy.password != null) && (common.validateString(command.amtpolicy.password, 0, 32) == false)) break; // Check the amtpolicy.password
                        if ((command.amtpolicy.badpass != null) && common.validateInt(command.amtpolicy.badpass, 0, 1) == false) break; // Check the amtpolicy.badpass
                        if ((command.amtpolicy.ccm != null) && common.validateInt(command.amtpolicy.ccm, 0, 2) == false) break; // Check the amtpolicy.ccm
                        if (common.validateInt(command.amtpolicy.cirasetup, 0, 2) == false) break; // Check the amtpolicy.cirasetup
                    }

                    mesh = parent.meshes[command.meshid];
                    change = '';
                    if (mesh) {
                        // Check if this user has rights to do this
                        if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // TODO: Check if this is a change from the existing policy

                        // Perform the Intel AMT policy change
                        change = 'Intel AMT policy change';
                        var amtpolicy = { type: command.amtpolicy.type };
                        if ((command.amtpolicy.type === 2) || (command.amtpolicy.type === 3)) {
                            amtpolicy = { type: command.amtpolicy.type, badpass: command.amtpolicy.badpass, cirasetup: command.amtpolicy.cirasetup };
                            if (command.amtpolicy.type === 3) { amtpolicy.ccm = command.amtpolicy.ccm; }
                            if ((command.amtpolicy.password == null) && (mesh.amt != null) && (typeof mesh.amt.password == 'string')) { amtpolicy.password = mesh.amt.password; } // Keep the last password
                            if ((typeof command.amtpolicy.password == 'string') && (command.amtpolicy.password.length >= 8)) { amtpolicy.password = command.amtpolicy.password; } // Set a new password
                        }
                        mesh.amt = amtpolicy;
                        db.Set(mesh);
                        var amtpolicy2 = Object.assign({}, amtpolicy); // Shallow clone
                        if (amtpolicy2.password != null) { amtpolicy2.password = 1; }
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, amt: amtpolicy2, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id, invite: mesh.invite };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id]), obj, event);

                        // If we have peer servers, inform them of the new Intel AMT policy for this device group
                        if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'newIntelAmtPolicy', meshid: command.meshid, amtpolicy: amtpolicy }); }

                        // See if any agents for the affected device group is connected, if so, update the Intel AMT policy
                        for (var nodeid in parent.wsagents) {
                            const agent = parent.wsagents[nodeid];
                            if (agent.dbMeshKey == command.meshid) { agent.sendUpdatedIntelAmtPolicy(amtpolicy); }
                        }
                    }
                    break;
                }
            case 'addamtdevice':
                {
                    if (args.wanonly == true) return; // This is a WAN-only server, local Intel AMT computers can't be added
                    if (common.validateString(command.meshid, 1, 1024) == false) break; // Check meshid
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    if (common.validateString(command.devicename, 1, 256) == false) break; // Check device name
                    if (common.validateString(command.hostname, 1, 256) == false) break; // Check hostname
                    if (common.validateString(command.amtusername, 0, 16) == false) break; // Check username
                    if (common.validateString(command.amtpassword, 0, 16) == false) break; // Check password
                    if (command.amttls == '0') { command.amttls = 0; } else if (command.amttls == '1') { command.amttls = 1; } // Check TLS flag
                    if ((command.amttls != 1) && (command.amttls != 0)) break;

                    // If we are in WAN-only mode, hostname is not used
                    if ((args.wanonly == true) && (command.hostname)) { delete command.hostname; }

                    // Get the mesh
                    mesh = parent.meshes[command.meshid];
                    if (mesh) {
                        if (mesh.mtype != 1) return; // This operation is only allowed for mesh type 1, Intel AMT agentless mesh.

                        // Check if this user has rights to do this
                        if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_MANAGECOMPUTERS) == 0) return;

                        // Create a new nodeid
                        parent.crypto.randomBytes(48, function (err, buf) {
                            // create the new node
                            nodeid = 'node/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            var device = { type: 'node', _id: nodeid, meshid: command.meshid, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: command.amttls } };
                            db.Set(device);

                            // Event the new node
                            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, [nodeid]), obj, { etype: 'node', userid: user._id, username: user.name, action: 'addnode', node: parent.CloneSafeNode(device), msgid: 84, msgArgs: [command.devicename, mesh.name], msg: 'Added device ' + command.devicename + ' to device group ' + mesh.name, domain: domain.id });
                        });
                    }
                    break;
                }
            case 'scanamtdevice':
                {
                    if (args.wanonly == true) return; // This is a WAN-only server, this type of scanning is not allowed.
                    if (common.validateString(command.range, 1, 256) == false) break; // Check range string

                    // Ask the RMCP scanning to scan a range of IP addresses
                    if (parent.parent.amtScanner) {
                        if (parent.parent.amtScanner.performRangeScan(user._id, command.range) == false) {
                            parent.parent.DispatchEvent(['*', user._id], obj, { action: 'scanamtdevice', range: command.range, results: null, nolog: 1 });
                        }
                    }
                    break;
                }
            case 'changeDeviceMesh':
                {
                    var err = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    // Perform input validation
                    try {
                        if (common.validateStrArray(command.nodeids, 1, 256) == false) { err = "Invalid nodeids"; } // Check nodeids
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = "Invalid groupid"; } // Check meshid
                        else {
                            if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            mesh = parent.meshes[command.meshid];
                            if (mesh == null) { err = "Unknown device group"; }
                            else if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_MANAGECOMPUTERS) == 0) { err = "Permission denied"; }
                            else if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = "Invalid domain"; } // Invalid domain, operation only valid for current domain
                        }
                    } catch (ex) { console.log(ex); err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // For each nodeid, change the group
                    for (var i = 0; i < command.nodeids.length; i++) {
                        var xnodeid = command.nodeids[i];
                        if (xnodeid.indexOf('/') == -1) { xnodeid = 'node/' + domain.id + '/' + xnodeid; }

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, xnodeid, function (node, rights, visible) {
                            // Check if we found this device
                            if (node == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device not found' })); } catch (ex) { } } return; }

                            // Check if already in the right mesh
                            if (node.meshid == command.meshid) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device already in correct group' })); } catch (ex) { } } return; }

                            // Make sure both source and target mesh are the same type
                            try { if (parent.meshes[node.meshid].mtype != parent.meshes[command.meshid].mtype) return; } catch (e) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device groups are of different types' })); } catch (ex) { } }
                                return;
                            };

                            // Make sure that we have rights on both source and destination mesh
                            const targetMeshRights = parent.GetMeshRights(user, command.meshid);
                            if (((rights & MESHRIGHT_EDITMESH) == 0) || ((targetMeshRights & MESHRIGHT_EDITMESH) == 0)) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Permission denied' })); } catch (ex) { } }
                                return;
                            }

                            // Perform the switch, start by saving the node with the new meshid.
                            const oldMeshId = node.meshid;
                            node.meshid = command.meshid;
                            db.Set(parent.cleanDevice(node));

                            // If the device is connected on this server, switch it now.
                            var agentSession = parent.wsagents[node._id];
                            if (agentSession != null) {
                                agentSession.dbMeshKey = command.meshid; // Switch the agent mesh
                                agentSession.meshid = command.meshid.split('/')[2]; // Switch the agent mesh
                                agentSession.sendUpdatedIntelAmtPolicy(); // Send the new Intel AMT policy
                            }

                            // If any MQTT sessions are connected on this server, switch it now.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.changeDeviceMesh(node._id, command.meshid); }

                            // If any CIRA sessions are connected on this server, switch it now.
                            if (parent.parent.mpsserver != null) { parent.parent.mpsserver.changeDeviceMesh(node._id, command.meshid); }

                            // Add the connection state
                            const state = parent.parent.GetConnectivityState(node._id);
                            if (state) {
                                node.conn = state.connectivity;
                                node.pwr = state.powerState;
                                if ((state.connectivity & 1) != 0) { var agent = parent.wsagents[node._id]; if (agent != null) { node.agct = agent.connectTime; } }

                                // Uuse the connection time of the CIRA/Relay connection
                                if ((state.connectivity & 2) != 0) {
                                    var ciraConnection = parent.parent.mpsserver.GetConnectionToNode(node._id, null, true);
                                    if ((ciraConnection != null) && (ciraConnection.tag != null)) { node.cict = ciraConnection.tag.connectTime; }
                                }
                            }

                            // Event the node change
                            var newMesh = parent.meshes[command.meshid];
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'nodemeshchange', nodeid: node._id, node: node, oldMeshId: oldMeshId, newMeshId: command.meshid, msgid: 85, msgArgs: [node.name, newMesh.name], msg: 'Moved device ' + node.name + ' to group ' + newMesh.name, domain: domain.id };
                            // Even if change stream is enabled on this server, we still make the nodemeshchange actionable. This is because the DB can't send out a change event that will match this.
                            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, [oldMeshId, node._id]), obj, event);

                            // Send response if required
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                        });
                    }
                    break;
                }
            case 'removedevices':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_UNINSTALL) == 0) return;

                            // Delete this node including network interface information, events and timeline
                            db.Remove(node._id);                                 // Remove node with that id
                            db.Remove('if' + node._id);                          // Remove interface information
                            db.Remove('nt' + node._id);                          // Remove notes
                            db.Remove('lc' + node._id);                          // Remove last connect time
                            db.Remove('si' + node._id);                          // Remove system information
                            if (db.RemoveSMBIOS) { db.RemoveSMBIOS(node._id); }  // Remove SMBios data
                            db.RemoveAllNodeEvents(node._id);                    // Remove all events for this node
                            db.removeAllPowerEventsForNode(node._id);            // Remove all power events for this node
                            if (typeof node.pmt == 'string') { db.Remove('pmt_' + node.pmt); } // Remove Push Messaging Token
                            db.Get('ra' + node._id, function (err, nodes) {
                                if ((nodes != null) && (nodes.length == 1)) { db.Remove('da' + nodes[0].daid); } // Remove diagnostic agent to real agent link
                                db.Remove('ra' + node._id); // Remove real agent to diagnostic agent link
                            });

                            // Remove any user node links
                            if (node.links != null) {
                                for (var i in node.links) {
                                    if (i.startsWith('user/')) {
                                        var cuser = parent.users[i];
                                        if ((cuser != null) && (cuser.links != null) && (cuser.links[node._id] != null)) {
                                            // Remove the user link & save the user
                                            delete cuser.links[node._id];
                                            if (Object.keys(cuser.links).length == 0) { delete cuser.links; }
                                            db.SetUser(cuser);

                                            // Notify user change
                                            var targets = ['*', 'server-users', cuser._id];
                                            var event = { etype: 'user', userid: cuser._id, username: cuser.name, action: 'accountchange', msgid: 86, msgArgs: [cuser.name], msg: 'Removed user device rights for ' + cuser.name, domain: domain.id, account: parent.CloneSafeUser(cuser) };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                            parent.parent.DispatchEvent(targets, obj, event);
                                        }
                                    }
                                }
                            }

                            // Event node deletion
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'removenode', nodeid: node._id, msgid: 87, msgArgs: [node.name, parent.meshes[node.meshid].name], msg: 'Removed device ' + node.name + ' from device group ' + parent.meshes[node.meshid].name, domain: domain.id };
                            // TODO: We can't use the changeStream for node delete because we will not know the meshid the device was in.
                            //if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to remove the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id), obj, event);

                            // Disconnect all connections if needed
                            var state = parent.parent.GetConnectivityState(nodeid);
                            if ((state != null) && (state.connectivity != null)) {
                                if ((state.connectivity & 1) != 0) { parent.wsagents[nodeid].close(); } // Disconnect mesh agent
                                if ((state.connectivity & 2) != 0) { parent.parent.mpsserver.closeAllForNode(nodeid); } // Disconnect CIRA/Relay/LMS connections
                            }
                        });
                    }
                    break;
                }
            case 'wakedevices':
                {
                    // TODO: We can optimize this a lot.
                    // - We should get a full list of all MAC's to wake first.
                    // - We should try to only have one agent per subnet (using Gateway MAC) send a wake-on-lan.
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's

                    // Event wakeup, this will cause Intel AMT wake operations on this and other servers.
                    parent.parent.DispatchEvent('*', obj, { action: 'wakedevices', userid: user._id, username: user.name, nodeids: command.nodeids, domain: domain.id, nolog: 1 });

                    // Perform wake-on-lan
                    for (i in command.nodeids) {
                        var nodeid = command.nodeids[i];

                        // Argument validation
                        if (common.validateString(nodeid, 8, 128) == false) { continue; } // Check the nodeid
                        else if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
                        else if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) { continue; } // Invalid domain, operation only valid for current domain

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_WAKEDEVICE) == 0) return;

                            // If this device is connected on MQTT, send a wake action.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.publish(node._id, 'powerAction', 'wake'); }

                            // Get the device interface information
                            db.Get('if' + node._id, function (err, nodeifs) {
                                if ((nodeifs != null) && (nodeifs.length == 1)) {
                                    var macs = [], nodeif = nodeifs[0];
                                    if (nodeif.netif) {
                                        for (var j in nodeif.netif) { if (nodeif.netif[j].mac && (nodeif.netif[j].mac != '00:00:00:00:00:00') && (macs.indexOf(nodeif.netif[j].mac) == -1)) { macs.push(nodeif.netif[j].mac); } }
                                    } else if (nodeif.netif2) {
                                        for (var j in nodeif.netif2) { for (var k in nodeif.netif2[j]) { if (nodeif.netif2[j][k].mac && (nodeif.netif2[j][k].mac != '00:00:00:00:00:00') && (macs.indexOf(nodeif.netif2[j][k].mac) == -1)) { macs.push(nodeif.netif2[j][k].mac); } } }
                                    }
                                    if (macs.length == 0) return;

                                    // Have the server send a wake-on-lan packet (Will not work in WAN-only)
                                    if (parent.parent.meshScanner != null) { parent.parent.meshScanner.wakeOnLan(macs, node.host); }

                                    // Get the list of device groups this user as wake permissions on
                                    var targets = [], targetDeviceGroups = parent.GetAllMeshWithRights(user, MESHRIGHT_WAKEDEVICE);
                                    for (j in targetDeviceGroups) { targets.push(targetDeviceGroups[j]._id); }
                                    for (j in user.links) { if ((j.startsWith('node/')) && (typeof user.links[j].rights == 'number') && ((user.links[j].rights & MESHRIGHT_WAKEDEVICE) != 0)) { targets.push(j); } }

                                    // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                    for (j in parent.wsagents) {
                                        var agent = parent.wsagents[j];
                                        if ((agent.authenticated == 2) && ((targets.indexOf(agent.dbMeshKey) >= 0) || (targets.indexOf(agent.dbNodeKey) >= 0))) {
                                            //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                            try { agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs })); } catch (ex) { }
                                        }
                                    }
                                }
                            });
                        });

                        // Confirm we may be doing something (TODO)
                        if (command.responseid != null) {
                            try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'ok' })); } catch (ex) { }
                        } else {
                            try { ws.send(JSON.stringify({ action: 'wakedevices' })); } catch (ex) { }
                        }
                    }
                    break;
                }
            case 'runcommands':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    if (typeof command.type != 'number') break; // Check command type
                    if (typeof command.cmds != 'string') break; // Check commands
                    if (typeof command.runAsUser != 'number') { command.runAsUser = 0; } // Check runAsUser

                    for (i in command.nodeids) {
                        var nodeid = command.nodeids[i], err = null;

                        // Argument validation
                        if (common.validateString(nodeid, 1, 1024) == false) { err = 'Invalid nodeid'; }  // Check nodeid
                        else {
                            if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
                            if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                        }
                        if (err != null) {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: err })); } catch (ex) { } }
                            continue;
                        }

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                            // Check if this node was found
                            if (node == null) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Invalid nodeid' })); } catch (ex) { } }
                                return;
                            }

                            // Check we have the rights to run commands on this device
                            if ((rights & MESHRIGHT_REMOTECOMMAND) == 0) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                                return;
                            }

                            // Get the agent and run the commands
                            var agent = parent.wsagents[node._id];
                            if ((agent != null) && (agent.authenticated == 2) && (agent.agentInfo != null)) {
                                // Check if this agent is correct for this command type
                                // command.type 1 = Windows Command, 2 = Windows PowerShell, 3 = Linux/BSD/macOS
                                var commandsOk = false;
                                if ((agent.agentInfo.agentId > 0) && (agent.agentInfo.agentId < 5)) {
                                    // Windows Agent
                                    if ((command.type == 1) || (command.type == 2)) { commandsOk = true; }
                                    else if (command.type === 0) { command.type = 1; commandsOk = true; } // Set the default type of this agent
                                } else {
                                    // Non-Windows Agent
                                    if (command.type == 3) { commandsOk = true; }
                                    else if (command.type === 0) { command.type = 3; commandsOk = true; } // Set the default type of this agent
                                }
                                if (commandsOk == true) {
                                    // Send the commands to the agent
                                    try { agent.send(JSON.stringify({ action: 'runcommands', type: command.type, cmds: command.cmds, runAsUser: command.runAsUser })); } catch (ex) { }
                                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'OK' })); } catch (ex) { } }

                                    // Send out an event that these commands where run on this device
                                    var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                                    var msgid = 24; // "Running commands"
                                    if (command.type == 1) { msgid = 99; } // "Running commands as user"
                                    if (command.type == 2) { msgid = 100; } // "Running commands as user if possible"
                                    var event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'runcommands', msg: 'Running commands', msgid: msgid, cmds: command.cmds, cmdType: command.type, runAsUser: command.runAsUser, domain: domain.id };
                                    parent.parent.DispatchEvent(targets, obj, event);
                                } else {
                                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Invalid command type' })); } catch (ex) { } }
                                }
                            } else {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Agent not connected' })); } catch (ex) { } }
                            }
                        });
                    }
                    break;
                }
            case 'uninstallagent':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_UNINSTALL) == 0) return;

                            // Send uninstall command to connected agent
                            const agent = parent.wsagents[node._id];
                            if (agent != null) {
                                //console.log('Asking agent ' + agent.dbNodeKey + ' to uninstall.');
                                try { agent.send(JSON.stringify({ action: 'uninstallagent' })); } catch (ex) { }
                            }
                        });
                    }
                    break;
                }
            case 'poweraction':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    if (common.validateInt(command.actiontype, 2, 4) == false) break; // Check actiontype
                    for (i in command.nodeids) {
                        var nodeid = command.nodeids[i];

                        // Argument validation
                        if (common.validateString(nodeid, 8, 128) == false) { continue; } // Check the nodeid
                        else if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
                        else if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) { continue; } // Invalid domain, operation only valid for current domain

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_RESETOFF) == 0) return;

                            // If this device is connected on MQTT, send a power action.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.publish(node._id, 'powerAction', ['', '', 'poweroff', 'reset', 'sleep'][command.actiontype]); }

                            // Get this device and send the power command
                            const agent = parent.wsagents[node._id];
                            if (agent != null) {
                                try { agent.send(JSON.stringify({ action: 'poweraction', actiontype: command.actiontype })); } catch (ex) { }
                            }
                        });

                        // Confirm we may be doing something (TODO)
                        if (command.responseid != null) {
                            try { ws.send(JSON.stringify({ action: 'poweraction', responseid: command.responseid, result: 'ok' })); } catch (ex) { }
                        } else {
                            try { ws.send(JSON.stringify({ action: 'poweraction' })); } catch (ex) { }
                        }
                    }
                    break;
                }
            case 'toast':
                {
                    var err = null;

                    // Perform input validation
                    try {
                        if (common.validateStrArray(command.nodeids, 1, 256) == false) { err = "Invalid nodeids"; } // Check nodeids
                        else if (common.validateString(command.title, 1, 512) == false) { err = "Invalid title"; } // Check title
                        else if (common.validateString(command.msg, 1, 4096) == false) { err = "Invalid message"; } // Check message
                        else {
                            var nodeids = [];
                            for (i in command.nodeids) { if (command.nodeids[i].indexOf('/') == -1) { nodeids.push('node/' + domain.id + '/' + command.nodeids[i]); } else { nodeids.push(command.nodeids[i]); } }
                            command.nodeids = nodeids;
                        }
                    } catch (ex) { console.log(ex); err = "Validation exception: " + ex; }
                    
                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'toast', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }
                    
                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to notify this device
                            if ((rights & MESHRIGHT_CHATNOTIFY) == 0) return;

                            // Get this device and send toast command
                            const agent = parent.wsagents[node._id];
                            if (agent != null) {
                                try { agent.send(JSON.stringify({ action: 'toast', title: command.title, msg: command.msg, sessionid: ws.sessionId, username: user.name, userid: user._id })); } catch (ex) { }
                            }
                        });
                    }

                    // Send response if required
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'toast', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'getnetworkinfo':
                {
                    // Argument validation
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' })); } catch (ex) { } return; }

                        // Get network information about this node
                        db.Get('if' + node._id, function (err, netinfos) {
                            if ((netinfos == null) || (netinfos.length != 1)) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: node._id, netif: null, netif2: null })); } catch (ex) { } return; }
                            var netinfo = netinfos[0];

                            // Unescape any field names that have special characters if needed
                            if (netinfo.netif2 != null) {
                                for (var i in netinfo.netif2) {
                                    var esc = common.unEscapeFieldName(i);
                                    if (esc !== i) { netinfo.netif2[esc] = netinfo.netif2[i]; delete netinfo.netif2[i]; }
                                }
                            }

                            try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: node._id, updateTime: netinfo.updateTime, netif: netinfo.netif, netif2: netinfo.netif2 })); } catch (ex) { }
                        });
                    });
                    break;
                }
            case 'changedevice':
                {
                    // Argument validation
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if ((command.userloc) && (command.userloc.length != 2) && (command.userloc.length != 0)) return;

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if ((rights & MESHRIGHT_MANAGECOMPUTERS) == 0) return;
                        var mesh = parent.meshes[node.meshid], amtchange = 0;

                        // Ready the node change event
                        var changes = [], event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id };
                        change = 0;
                        event.msg = ': ';

                        // If we are in WAN-only mode, host is not used
                        if ((args.wanonly == true) && (command.host)) { delete command.host; }

                        // Look for a change
                        if ((typeof command.icon == 'number') && (command.icon != node.icon)) { change = 1; node.icon = command.icon; changes.push('icon'); }
                        if ((typeof command.name == 'string') && (command.name != node.name)) { change = 1; node.name = command.name; changes.push('name'); }
                        if ((typeof command.host == 'string') && (command.host != node.host)) { change = 1; node.host = command.host; changes.push('host'); }
                        if (typeof command.consent == 'number') {
                            var oldConsent = node.consent;
                            if (command.consent != node.consent) { node.consent = command.consent; }
                            if (command.consent == 0) { delete node.consent; }
                            if (oldConsent != node.consent) { change = 1; changes.push('consent'); }
                        }

                        if ((typeof command.rdpport == 'number') && (command.rdpport > 0) && (command.rdpport < 65536)) {
                            if ((command.rdpport == 3389) && (node.rdpport != null)) {
                                delete node.rdpport; change = 1; changes.push('rdpport'); // Delete the RDP port
                            } else {
                                node.rdpport = command.rdpport; change = 1; changes.push('rdpport'); // Set the RDP port
                            }
                        }

                        if ((typeof command.rfbport == 'number') && (command.rfbport > 0) && (command.rfbport < 65536)) {
                            if ((command.rfbport == 5900) && (node.rfbport != null)) {
                                delete node.rfbport; change = 1; changes.push('rfbport'); // Delete the RFB port
                            } else {
                                node.rfbport = command.rfbport; change = 1; changes.push('rfbport'); // Set the RFB port
                            }
                        }

                        if (domain.geolocation && command.userloc && ((node.userloc == null) || (command.userloc[0] != node.userloc[0]) || (command.userloc[1] != node.userloc[1]))) {
                            change = 1;
                            if ((command.userloc.length == 0) && (node.userloc)) {
                                delete node.userloc;
                                changes.push('location removed');
                            } else {
                                command.userloc.push((Math.floor((new Date()) / 1000)));
                                node.userloc = command.userloc.join(',');
                                changes.push('location');
                            }
                        }
                        if (command.desc != null && (command.desc != node.desc)) { change = 1; node.desc = command.desc; changes.push('description'); }
                        if (command.intelamt != null) {
                            if ((parent.parent.amtManager == null) || (node.intelamt.user == null) || (node.intelamt.user == '') || ((node.intelamt.warn != null) && (((node.intelamt.warn) & 9) != 0))) { // Only allow changes to Intel AMT credentials if AMT manager is not running, or manager warned of unknown/trying credentials.
                                if ((command.intelamt.user != null) && (command.intelamt.pass != null) && ((command.intelamt.user != node.intelamt.user) || (command.intelamt.pass != node.intelamt.pass))) {
                                    change = 1;
                                    node.intelamt.user = command.intelamt.user;
                                    node.intelamt.pass = command.intelamt.pass;
                                    node.intelamt.warn |= 8; // Change warning to "Trying". Bit flags: 1 = Unknown credentials, 2 = Realm Mismatch, 4 = TLS Cert Mismatch, 8 = Trying credentials
                                    changes.push('Intel AMT credentials');
                                    amtchange = 1;
                                }
                            }
                            // Only allow the user to set Intel AMT TLS state if AMT Manager is not active. AMT manager will auto-detect TLS state.
                            if ((parent.parent.amtManager != null) && (command.intelamt.tls != null) && (command.intelamt.tls != node.intelamt.tls)) { change = 1; node.intelamt.tls = command.intelamt.tls; changes.push('Intel AMT TLS'); }
                        }
                        if (command.tags) { // Node grouping tag, this is a array of strings that can't be empty and can't contain a comma
                            var ok = true, group2 = [];
                            if (common.validateString(command.tags, 0, 4096) == true) { command.tags = command.tags.split(','); }
                            for (var i in command.tags) { var tname = command.tags[i].trim(); if ((tname.length > 0) && (tname.length < 64) && (group2.indexOf(tname) == -1)) { group2.push(tname); } }
                            group2.sort();
                            if (node.tags != group2) { node.tags = group2; change = 1; }
                        } else if ((command.tags === '') && node.tags) { delete node.tags; change = 1; }

                        if (change == 1) {
                            // Save the node
                            db.Set(parent.cleanDevice(node));

                            // Event the node change. Only do this if the database will not do it.
                            event.msg = 'Changed device ' + node.name + ' from group ' + mesh.name + ': ' + changes.join(', ');
                            event.node = parent.CloneSafeNode(node);
                            if (amtchange == 1) { event.amtchange = 1; } // This will give a hint to the AMT Manager to reconnect using new AMT credentials
                            if (command.rdpport == 3389) { event.node.rdpport = 3389; }
                            if (command.rfbport == 5900) { event.node.rfbport = 5900; }
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        }
                    });
                    break;
                }
            case 'uploadagentcore':
                {
                    if (common.validateString(command.type, 1, 40) == false) break; // Check path

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if ((node == null) || (((rights & MESHRIGHT_AGENTCONSOLE) == 0) && (user.siteadmin != SITERIGHT_ADMIN))) return;

                        // TODO: If we have peer servers, inform...
                        //if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'uploadagentcore', sessionid: ws.sessionId }); }

                        if (command.type == 'default') {
                            // Send the default core to the agent
                            parent.parent.updateMeshCore(function () { parent.sendMeshAgentCore(user, domain, node._id, 'default'); });
                        } else if (command.type == 'clear') {
                            // Clear the mesh agent core on the mesh agent
                            parent.sendMeshAgentCore(user, domain, node._id, 'clear');
                        } else if (command.type == 'recovery') {
                            // Send the recovery core to the agent
                            parent.sendMeshAgentCore(user, domain, node._id, 'recovery');
                        } else if (command.type == 'tiny') {
                            // Send the tiny core to the agent
                            parent.sendMeshAgentCore(user, domain, node._id, 'tiny');
                        } else if ((command.type == 'custom') && (common.validateString(command.path, 1, 2048) == true)) {
                            // Send a mesh agent core to the mesh agent
                            var file = parent.getServerFilePath(user, domain, command.path);
                            if (file != null) {
                                fs.readFile(file.fullpath, 'utf8', function (err, data) {
                                    if (err != null) {
                                        data = common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                                        parent.sendMeshAgentCore(user, domain, node._id, 'custom', data);
                                    }
                                });
                            }
                        }
                    });
                    break;
                }
            case 'agentdisconnect':
                {
                    if (common.validateInt(command.disconnectMode) == false) return; // Check disconnect mode

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if ((node == null) || (((rights & MESHRIGHT_AGENTCONSOLE) == 0) && (user.siteadmin != SITERIGHT_ADMIN))) return;

                        // Force mesh agent disconnection
                        parent.forceMeshAgentDisconnect(user, domain, node._id, command.disconnectMode);
                    });
                    break;
                }
            case 'close':
                {
                    // Close the web socket session
                    if (obj.req.session && obj.req.session.ws && obj.req.session.ws == ws) { delete obj.req.session.ws; }
                    try { ws.close(); } catch (e) { }
                    break;
                }
            case 'getcookie':
                {
                    // Check if this user has rights on this nodeid
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                        if ((err == null) && (nodes.length == 1)) {
                            if ((parent.GetMeshRights(user, nodes[0].meshid) & MESHRIGHT_REMOTECONTROL) != 0) {
                                // Add a user authentication cookie to a url
                                var cookieContent = { userid: user._id, domainid: user.domain };
                                if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
                                if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want to agent to TCP connect to a remote address
                                if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want to agent to TCP connect to a remote port
                                if (command.ip) { cookieContent.ip = command.ip; } // Indicates the browser want to agent to relay a TCP connection to a IP:port
                                command.cookie = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
                                command.trustedCert = parent.isTrustedCert(domain);
                                try { ws.send(JSON.stringify(command)); } catch (ex) { }
                            }
                        }
                    });
                    break;
                }
            case 'inviteAgent':
                {
                    var err = null, mesh = null;

                    // Resolve the device group name if needed
                    if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                        for (var i in parent.meshes) {
                            var m = parent.meshes[i];
                            if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                                if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                            }
                        }
                    }

                    try {
                        if ((domain.mailserver == null) || (args.lanonly == true)) { err = 'Unsupported feature'; } // This operation requires the email server
                        else if ((parent.parent.certificates.CommonName == null) || (parent.parent.certificates.CommonName.indexOf('.') == -1)) { err = 'Unsupported feature'; } // Server name must be configured
                        else if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid group identifier'; } // Check meshid
                        else {
                            if (command.meshid.split('/').length == 1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = 'Invalid group identifier'; } // Invalid domain, operation only valid for current domain
                            else if (common.validateString(command.email, 4, 1024) == false) { err = 'Invalid email'; } // Check email
                            else if (command.email.split('@').length != 2) { err = 'Invalid email'; } // Check email
                            else {
                                mesh = parent.meshes[command.meshid];
                                if (mesh == null) { err = 'Unknown device group'; } // Check if the group exists
                                else if (mesh.mtype != 2) { err = 'Invalid group type'; } // Check if this is the correct group type
                                else if (parent.IsMeshViewable(user, mesh) == false) { err = 'Not allowed'; } // Check if this user has rights to do this
                            }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'inviteAgent', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Perform email invitation
                    domain.mailserver.sendAgentInviteMail(domain, (user.realname ? user.realname : user.name), command.email.toLowerCase(), command.meshid, command.name, command.os, command.msg, command.flags, command.expire, parent.getLanguageCodes(req), req.query.key);

                    // Send a response if needed
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'inviteAgent', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    break;
                }
            case 'setDeviceEvent':
                {
                    // Argument validation
                    if (common.validateString(command.msg, 1, 4096) == false) break; // Check event

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (rights == 0) return;

                        // Add an event for this device
                        var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                        var event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'manual', msg: decodeURIComponent(command.msg), domain: domain.id };
                        parent.parent.DispatchEvent(targets, obj, event);
                    });
                    break;
                }
            case 'setNotes':
                {
                    // Argument validation
                    if (common.validateString(command.id, 1, 1024) == false) break; // Check id
                    var splitid = command.id.split('/');
                    if ((splitid.length != 3) || (splitid[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    var idtype = splitid[0];
                    if ((idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

                    if (idtype == 'node') {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.id, function (node, rights, visible) {
                            if ((rights & MESHRIGHT_SETNOTES) != 0) {
                                // Set the id's notes
                                if (common.validateString(command.notes, 1) == false) {
                                    db.Remove('nt' + node._id); // Delete the note for this node
                                } else {
                                    db.Set({ _id: 'nt' + node._id, type: 'note', value: command.notes }); // Set the note for this node
                                }
                            }
                        });
                    } else if (idtype == 'mesh') {
                        // Get the mesh for this device
                        mesh = parent.meshes[command.id];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return; // Must have rights to edit the mesh

                            // Set the id's notes
                            if (common.validateString(command.notes, 1) == false) {
                                db.Remove('nt' + command.id); // Delete the note for this node
                            } else {
                                db.Set({ _id: 'nt' + command.id, type: 'note', value: command.notes }); // Set the note for this mesh
                            }
                        }
                    } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                        // Set the id's notes
                        if (common.validateString(command.notes, 1) == false) {
                            db.Remove('nt' + command.id); // Delete the note for this node
                        } else {
                            // Can only perform this operation on other users of our group.
                            var chguser = parent.users[command.id];
                            if (chguser == null) break; // This user does not exists
                            if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) break;
                            db.Set({ _id: 'nt' + command.id, type: 'note', value: command.notes }); // Set the note for this user
                        }
                    }

                    break;
                }
            case 'otpemail':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check input
                    if (typeof command.enabled != 'boolean') return;
                    
                    // See if we really need to change the state
                    if ((command.enabled === true) && (user.otpekey != null)) return;
                    if ((command.enabled === false) && (user.otpekey == null)) return;

                    // Change the email 2FA of this user
                    if (command.enabled === true) { user.otpekey = {}; } else { delete user.otpekey; }
                    parent.db.SetUser(user);
                    ws.send(JSON.stringify({ action: 'otpemail', success: true, enabled: command.enabled })); // Report success

                    // Notify change
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: command.enabled ? 88 : 89, msg: command.enabled ? "Enabled email two-factor authentication." :"Disabled email two-factor authentication.", domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                    break;
                }
            case 'otpauth-request':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Request a one time password to be setup
                        var otplib = null;
                        try { otplib = require('otplib'); } catch (ex) { }
                        if (otplib == null) { break; }
                        const secret = otplib.authenticator.generateSecret(); // TODO: Check the random source of this value.

                        var domainName = parent.certificates.CommonName;
                        if (domain.dns != null) { domainName = domain.dns; }
                        ws.send(JSON.stringify({ action: 'otpauth-request', secret: secret, url: otplib.authenticator.keyuri(user.name, domainName, secret) }));
                    }
                    break;
                }
            case 'otpauth-setup':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Perform the one time password setup
                        var otplib = null;
                        try { otplib = require('otplib'); } catch (ex) { }
                        if (otplib == null) { break; }
                        otplib.authenticator.options = { window: 2 }; // Set +/- 1 minute window
                        if (otplib.authenticator.check(command.token, command.secret) === true) {
                            // Token is valid, activate 2-step login on this account.
                            user.otpsecret = command.secret;
                            parent.db.SetUser(user);
                            ws.send(JSON.stringify({ action: 'otpauth-setup', success: true })); // Report success

                            // Notify change
                            var targets = ['*', 'server-users', user._id];
                            if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 90, msg: 'Added authentication application', domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.parent.DispatchEvent(targets, obj, event);
                        } else {
                            ws.send(JSON.stringify({ action: 'otpauth-setup', success: false })); // Report fail
                        }
                    }
                    break;
                }
            case 'otpauth-clear':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Clear the one time password secret
                        if (user.otpsecret) {
                            delete user.otpsecret;
                            parent.db.SetUser(user);
                            ws.send(JSON.stringify({ action: 'otpauth-clear', success: true })); // Report success

                            // Notify change
                            var targets = ['*', 'server-users', user._id];
                            if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 91, msg: 'Removed authentication application', domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.parent.DispatchEvent(targets, obj, event);
                        } else {
                            ws.send(JSON.stringify({ action: 'otpauth-clear', success: false })); // Report fail
                        }
                    }
                    break;
                }
            case 'otpauth-getpasswords':
                {
                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported == false) break;

                    var actionTaken = false, actionText = null, actionId = 0;
                    if ((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 1024) == 0)) { // Don't allow generation of tokens if the account is settings locked
                        // Perform a sub-action
                        if (command.subaction == 1) { // Generate a new set of tokens
                            var randomNumbers = [], v;
                            for (var i = 0; i < 10; i++) { do { v = getRandomEightDigitInteger(); } while (randomNumbers.indexOf(v) >= 0); randomNumbers.push(v); }
                            user.otpkeys = { keys: [] };
                            for (var i = 0; i < 10; i++) { user.otpkeys.keys[i] = { p: randomNumbers[i], u: true } }
                            actionTaken = true;
                            actionId = 92;
                            actionText = "New 2FA backup codes generated";
                        } else if (command.subaction == 2) { // Clear all tokens
                            actionTaken = (user.otpkeys != null);
                            delete user.otpkeys;
                            if (actionTaken) {
                                actionId = 93;
                                actionText = "2FA backup codes cleared";
                            }
                        }

                        // Save the changed user
                        if (actionTaken) { parent.db.SetUser(user); }
                    }

                    // Return one time passwords for this user
                    if (count2factoraAuths() > 0) {
                        ws.send(JSON.stringify({ action: 'otpauth-getpasswords', passwords: user.otpkeys ? user.otpkeys.keys : null }));
                    }

                    // Notify change
                    if (actionText != null) {
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: actionId, msg: actionText, domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);
                    }
                    break;
                }
            case 'otp-hkey-get':
                {
                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported == false) break;

                    // Send back the list of keys we have, just send the list of names and index
                    var hkeys = [];
                    if (user.otphkeys != null) { for (var i = 0; i < user.otphkeys.length; i++) { hkeys.push({ i: user.otphkeys[i].keyIndex, name: user.otphkeys[i].name, type: user.otphkeys[i].type }); } }

                    ws.send(JSON.stringify({ action: 'otp-hkey-get', keys: hkeys }));
                    break;
                }
            case 'otp-hkey-remove':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported == false || command.index == null) break;

                    // Remove a key
                    var foundAtIndex = -1;
                    if (user.otphkeys != null) { for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].keyIndex == command.index) { foundAtIndex = i; } } }
                    if (foundAtIndex != -1) {
                        user.otphkeys.splice(foundAtIndex, 1);
                        parent.db.SetUser(user);
                    }

                    // Notify change
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 94, msg: 'Removed security key', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                    break;
                }
            case 'otp-hkey-yubikey-add':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Yubico API id and signature key can be requested from https://upgrade.yubico.com/getapikey/
                    var yubikeyotp = null;
                    try { yubikeyotp = require('yubikeyotp'); } catch (ex) { }

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if ((yubikeyotp == null) || (twoStepLoginSupported == false) || (typeof command.otp != 'string')) {
                        ws.send(JSON.stringify({ action: 'otp-hkey-yubikey-add', result: false, name: command.name }));
                        break;
                    }

                    // Check if Yubikey support is present or OTP no exactly 44 in length
                    if ((typeof domain.yubikey != 'object') || (typeof domain.yubikey.id != 'string') || (typeof domain.yubikey.secret != 'string') || (command.otp.length != 44)) {
                        ws.send(JSON.stringify({ action: 'otp-hkey-yubikey-add', result: false, name: command.name }));
                        break;
                    }

                    // TODO: Check if command.otp is modhex encoded, reject if not.

                    // Query the YubiKey server to validate the OTP
                    var request = { otp: command.otp, id: domain.yubikey.id, key: domain.yubikey.secret, timestamp: true }
                    if (domain.yubikey.proxy) { request.requestParams = { proxy: domain.yubikey.proxy }; }
                    yubikeyotp.verifyOTP(request, function (err, results) {
                        if ((results != null) && (results.status == 'OK')) {
                            var keyIndex = parent.crypto.randomBytes(4).readUInt32BE(0);
                            var keyId = command.otp.substring(0, 12);
                            if (user.otphkeys == null) { user.otphkeys = []; }

                            // Check if this key was already registered, if so, remove it.
                            var foundAtIndex = -1;
                            for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].keyid == keyId) { foundAtIndex = i; } }
                            if (foundAtIndex != -1) { user.otphkeys.splice(foundAtIndex, 1); }

                            // Add the new key and notify
                            user.otphkeys.push({ name: command.name, type: 2, keyid: keyId, keyIndex: keyIndex });
                            parent.db.SetUser(user);
                            ws.send(JSON.stringify({ action: 'otp-hkey-yubikey-add', result: true, name: command.name, index: keyIndex }));

                            // Notify change TODO: Should be done on all sessions/servers for this user.
                            var targets = ['*', 'server-users', user._id];
                            if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 95, msg: 'Added security key', domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.parent.DispatchEvent(targets, obj, event);
                        } else {
                            ws.send(JSON.stringify({ action: 'otp-hkey-yubikey-add', result: false, name: command.name }));
                        }
                    });

                    break;
                }
            case 'webauthn-startregister':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if ((twoStepLoginSupported == false) || (command.name == null)) break;

                    // Send the registration request
                    var registrationOptions = parent.webauthn.generateRegistrationChallenge("Anonymous Service", { id: Buffer(user._id, 'binary').toString('base64'), name: user._id, displayName: user._id.split('/')[2] });
                    obj.webAuthnReqistrationRequest = { action: 'webauthn-startregister', keyname: command.name, request: registrationOptions };
                    ws.send(JSON.stringify(obj.webAuthnReqistrationRequest));
                    break;
                }
            case 'webauthn-endregister':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if ((twoStepLoginSupported == false) || (obj.webAuthnReqistrationRequest == null)) return;

                    // Figure out the origin
                    var httpport = ((args.aliasport != null) ? args.aliasport : args.port);
                    var origin = "https://" + (domain.dns ? domain.dns : parent.certificates.CommonName);
                    if (httpport != 443) { origin += ':' + httpport; }

                    // Use internal WebAuthn module to check the response
                    var regResult = null;
                    try { regResult = parent.webauthn.verifyAuthenticatorAttestationResponse(command.response.response); } catch (ex) { regResult = { verified: false, error: ex }; }
                    if (regResult.verified === true) {
                        // Since we are registering a WebAuthn/FIDO2 key, remove all U2F keys (Type 1).
                        var otphkeys2 = [];
                        if (user.otphkeys && Array.isArray(user.otphkeys)) { for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type != 1) { otphkeys2.push(user.otphkeys[i]); } } }
                        user.otphkeys = otphkeys2;

                        // Add the new WebAuthn/FIDO2 keys
                        var keyIndex = parent.crypto.randomBytes(4).readUInt32BE(0);
                        if (user.otphkeys == null) { user.otphkeys = []; }
                        user.otphkeys.push({ name: obj.webAuthnReqistrationRequest.keyname, type: 3, publicKey: regResult.authrInfo.publicKey, counter: regResult.authrInfo.counter, keyIndex: keyIndex, keyId: regResult.authrInfo.keyId });
                        parent.db.SetUser(user);
                        ws.send(JSON.stringify({ action: 'otp-hkey-setup-response', result: true, name: command.name, index: keyIndex }));

                        // Notify change
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 95, msg: 'Added security key', domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);
                    } else {
                        //console.log('webauthn-endregister-error', regResult.error);
                        ws.send(JSON.stringify({ action: 'otp-hkey-setup-response', result: false, error: regResult.error, name: command.name, index: keyIndex }));
                    }

                    delete obj.hardwareKeyRegistrationRequest;
                    break;
                }
            case 'verifyPhone': {
                if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                if (parent.parent.smsserver == null) return;
                if (common.validateString(command.phone, 1, 18) == false) break; // Check phone length
                if (isPhoneNumber(command.phone) == false) break; // Check phone

                const code = common.zeroPad(getRandomSixDigitInteger(), 6)
                const phoneCookie = parent.parent.encodeCookie({ a: 'verifyPhone', c: code, p: command.phone, s: ws.sessionId });
                parent.parent.smsserver.sendPhoneCheck(domain, command.phone, code, parent.getLanguageCodes(req), function (success) {
                    ws.send(JSON.stringify({ action: 'verifyPhone', cookie: phoneCookie, success: success }));
                });
                break;
            }
            case 'confirmPhone': {
                if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                if ((parent.parent.smsserver == null) || (typeof command.cookie != 'string') || (typeof command.code != 'string') || (obj.failedSmsCookieCheck == 1)) break; // Input checks
                var cookie = parent.parent.decodeCookie(command.cookie);
                if (cookie == null) break; // Invalid cookie
                if (cookie.s != ws.sessionId) break; // Invalid session
                if (cookie.c != command.code) {
                    obj.failedSmsCookieCheck = 1;
                    // Code does not match, delay the response to limit how many guesses we can make and don't allow more than 1 guess at any given time.
                    setTimeout(function () {
                        ws.send(JSON.stringify({ action: 'verifyPhone', cookie: command.cookie, success: true }));
                        delete obj.failedSmsCookieCheck;
                    }, 2000 + (parent.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                    break;
                }

                // Set the user's phone
                user.phone = cookie.p;
                db.SetUser(user);

                // Event the change
                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 96, msgArgs: [user.name], msg: 'Verified phone number of user ' + EscapeHtml(user.name), domain: domain.id };
                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                break;
            }
            case 'removePhone': {
                if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                if (user.phone == null) break;

                // Clear the user's phone
                delete user.phone;
                db.SetUser(user);

                // Event the change
                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 97, msgArgs: [user.name], msg: 'Removed phone number of user ' + EscapeHtml(user.name), domain: domain.id };
                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                break;
            }
            case 'smsuser': { // Send a SMS message to a user
                var errMsg = null, errId = 0, smsuser = null;
                if (parent.parent.smsserver == null) { errMsg = "SMS gateway not enabled"; errId = 23; }
                else if ((user.siteadmin & 2) == 0) { errMsg = "No user management rights"; errId = 24; }
                else if (common.validateString(command.userid, 1, 2048) == false) { errMsg = "Invalid username"; errId = 2; }
                else if (common.validateString(command.msg, 1, 160) == false) { errMsg = "Invalid SMS message"; errId = 25; }
                else {
                    smsuser = parent.users[command.userid];
                    if (smsuser == null) { errMsg = "Invalid username"; errId = 2; }
                    else if (smsuser.phone == null) { errMsg = "No phone number for this user"; errId = 26; }
                }

                if (errMsg != null) { displayNotificationMessage(errMsg); break; }

                parent.parent.smsserver.sendSMS(smsuser.phone, command.msg, function (success, msg) {
                    if (success) {
                        displayNotificationMessage("SMS succesfuly sent.", null, null, null, 27);
                    } else {
                        if (typeof msg == 'string') { displayNotificationMessage("SMS error: " + msg, null, null, null, 29, [msg]); } else { displayNotificationMessage("SMS error", null, null, null, 28); }
                    }
                });
                break;
            }
            case 'emailuser': { // Send a email message to a user
                var errMsg = null, emailuser = null;
                if (domain.mailserver == null) { errMsg = 'Email server not enabled'; }
                else if ((user.siteadmin & 2) == 0) { errMsg = 'No user management rights'; }
                else if (common.validateString(command.userid, 1, 2048) == false) { errMsg = 'Invalid userid'; }
                else if (common.validateString(command.subject, 1, 1000) == false) { errMsg = 'Invalid subject message'; }
                else if (common.validateString(command.msg, 1, 10000) == false) { errMsg = 'Invalid message'; }
                else {
                    emailuser = parent.users[command.userid];
                    if (emailuser == null) { errMsg = 'Invalid userid'; }
                    else if (emailuser.email == null) { errMsg = 'No validated email address for this user'; }
                    else if (emailuser.emailVerified !== true) { errMsg = 'No validated email address for this user'; }
                }

                if (errMsg != null) { displayNotificationMessage(errMsg); break; }
                domain.mailserver.sendMail(emailuser.email, command.subject, command.msg);
                displayNotificationMessage("Email sent.", null, null, null, 14);
                break;
            }
            case 'getClip': {
                if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    if ((rights & MESHRIGHT_AGENTCONSOLE) == 0) return;

                    // Ask for clipboard data from agent
                    var agent = parent.wsagents[node._id];
                    if (agent != null) { try { agent.send(JSON.stringify({ action: 'getClip' })); } catch (ex) { } }
                });
                break;
            }
            case 'setClip': {
                if (common.validateString(command.data, 1, 65535) == false) break; // Check 

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    if ((rights & MESHRIGHT_AGENTCONSOLE) == 0) return;

                    // Send clipboard data to the agent
                    var agent = parent.wsagents[node._id];
                    if (agent != null) { try { agent.send(JSON.stringify({ action: 'setClip', data: command.data })); } catch (ex) { } }
                });
                break;
            }
            case 'userWebState': {
                if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                if (common.validateString(command.state, 1, 10000) == false) break; // Check state size, no more than 10k
                command.state = parent.filterUserWebState(command.state); // Filter the state to remove anything bad
                if ((command.state == null) || (typeof command.state !== 'string')) break; // If state did not validate correctly, quit here.
                db.Set({ _id: 'ws' + user._id, state: command.state });
                parent.parent.DispatchEvent([user._id], obj, { action: 'userWebState', nolog: 1, domain: domain.id, state: command.state });
                break;
            }
            case 'getNotes':
                {
                    // Argument validation
                    if (common.validateString(command.id, 1, 1024) == false) break; // Check id
                    var splitid = command.id.split('/');
                    if ((splitid.length != 3) || (splitid[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    var idtype = splitid[0];
                    if ((idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

                    if (idtype == 'node') {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.id, function (node, rights, visible) {
                            if (visible == false) return;

                            // Get the notes about this node
                            db.Get('nt' + command.id, function (err, notes) {
                                try {
                                    if ((notes == null) || (notes.length != 1)) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                    ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                } catch (ex) { }
                            });
                        });
                    } else if (idtype == 'mesh') {
                        // Get the mesh for this device
                        mesh = parent.meshes[command.id];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return; // Must have rights to edit the mesh

                            // Get the notes about this node
                            db.Get('nt' + command.id, function (err, notes) {
                                try {
                                    if ((notes == null) || (notes.length != 1)) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                    ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                } catch (ex) { }
                            });
                        }
                    } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                        // Get the notes about this node
                        db.Get('nt' + command.id, function (err, notes) {
                            try {
                                if ((notes == null) || (notes.length != 1)) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                            } catch (ex) { }
                        });
                    }

                    break;
                }
            case 'createInviteLink': {
                var err = null;

                // Resolve the device group name if needed
                if ((typeof command.meshname == 'string') && (command.meshid == null)) {
                    for (var i in parent.meshes) {
                        var m = parent.meshes[i];
                        if ((m.mtype == 2) && (m.name == command.meshname) && parent.IsMeshViewable(user, m)) {
                            if (command.meshid == null) { command.meshid = m._id; } else { err = 'Duplicate device groups found'; }
                        }
                    }
                }

                if (common.validateString(command.meshid, 8, 128) == false) { err = 'Invalid group id'; } // Check the meshid
                else if (common.validateInt(command.expire, 0, 99999) == false) { err = 'Invalid expire time'; } // Check the expire time in hours
                else if (common.validateInt(command.flags, 0, 256) == false) { err = 'Invalid flags'; } // Check the flags
                else if (common.validateString(command.meshid, 1, 1024) == false) { err = 'Invalid group identifier'; } // Check meshid
                else {
                    if (command.meshid.split('/').length == 1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                    var smesh = command.meshid.split('/');
                    if ((smesh.length != 3) || (smesh[0] != 'mesh') || (smesh[1] != domain.id)) { err = 'Invalid group id'; }
                    mesh = parent.meshes[command.meshid];
                    if ((mesh == null) || (parent.IsMeshViewable(user, mesh) == false)) { err = 'Invalid group id'; }
                }
                var serverName = parent.getWebServerName(domain);

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createInviteLink', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                const inviteCookie = parent.parent.encodeCookie({ a: 4, mid: command.meshid, f: command.flags, expire: command.expire * 60 }, parent.parent.invitationLinkEncryptionKey);
                if (inviteCookie == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createInviteLink', responseid: command.responseid, result: 'Unable to generate invitation cookie' })); } catch (ex) { } } break; }

                // Create the server url
                var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                var xdomain = (domain.dns == null) ? domain.id : '';
                if (xdomain != '') xdomain += '/';
                var url = 'https://' + serverName + ':' + httpsPort + '/' + xdomain + 'agentinvite?c=' + inviteCookie;
                if (serverName.split('.') == 1) { url = '/' + xdomain + 'agentinvite?c=' + inviteCookie; }

                ws.send(JSON.stringify({ action: 'createInviteLink', meshid: command.meshid, url: url, expire: command.expire, cookie: inviteCookie, responseid: command.responseid, tag: command.tag }));
                break;
            }
            case 'deviceShares': {
                if (domain.guestdevicesharing === false) return; // This feature is not allowed.
                var err = null;

                // Argument validation
                if (common.validateString(command.nodeid, 8, 128) == false) { err = 'Invalid node id'; } // Check the nodeid
                else if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                else if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Get the device rights
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    // If node not found or we don't have remote control, reject.
                    if (node == null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Invalid node id' })); } catch (ex) { } }
                        return;
                    }

                    // If there is MESHRIGHT_DESKLIMITEDINPUT or we don't have MESHRIGHT_GUESTSHARING on this account, reject this request.
                    if (rights != MESHRIGHT_ADMIN) {
                        // If we don't have remote control, or have limited input, or don't have guest sharing permission, fail here.
                        if (((rights & MESHRIGHT_REMOTECONTROL) == 0) || ((rights & MESHRIGHT_DESKLIMITEDINPUT) != 0) || ((rights & MESHRIGHT_GUESTSHARING) == 0)) {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                            return;
                        }
                    }

                    parent.db.GetAllTypeNodeFiltered([command.nodeid], domain.id, 'deviceshare', null, function (err, docs) {
                        if (err != null) return;
                        var now = Date.now(), removed = false, okDocs = [];
                        for (var i = 0; i < docs.length; i++) {
                            const doc = docs[i];
                            if (doc.expireTime < now) {
                                // This share is expired.
                                parent.db.Remove(doc._id, function () { }); delete docs[i]; removed = true;
                            } else {
                                // This share is ok, remove extra data we don't need to send.
                                delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type;
                                okDocs.push(doc);
                            }
                        }
                        try { ws.send(JSON.stringify({ action: 'deviceShares', nodeid: command.nodeid, deviceShares: okDocs })); } catch (ex) { }

                        // If we removed any shares, send device share update
                        if (removed == true) {
                            var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                            parent.parent.DispatchEvent(targets, obj, { etype: 'node', nodeid: node._id, action: 'deviceShareUpdate', domain: domain.id, deviceShares: okDocs, nolog: 1 });
                        }
                    });
                });

                break;
            }
            case 'removeDeviceShare': {
                if (domain.guestdevicesharing === false) return; // This feature is not allowed.
                var err = null;

                // Argument validation
                if (common.validateString(command.nodeid, 8, 128) == false) { err = 'Invalid node id'; } // Check the nodeid
                else if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                else if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                if (common.validateString(command.publicid, 1, 128) == false) { err = 'Invalid public id'; } // Check the public identifier

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeDeviceShare', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Get the device rights
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    // If node not found or we don't have remote control, reject.
                    if (node == null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Invalid node id' })); } catch (ex) { } }
                        return;
                    }

                    // If there is MESHRIGHT_DESKLIMITEDINPUT or we don't have MESHRIGHT_GUESTSHARING on this account, reject this request.
                    if (rights != MESHRIGHT_ADMIN) {
                        // If we don't have remote control, or have limited input, or don't have guest sharing permission, fail here.
                        if (((rights & MESHRIGHT_REMOTECONTROL) == 0) || ((rights & MESHRIGHT_DESKLIMITEDINPUT) != 0) || ((rights & MESHRIGHT_GUESTSHARING) == 0)) {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                            return;
                        }
                    }

                    parent.db.GetAllTypeNodeFiltered([command.nodeid], domain.id, 'deviceshare', null, function (err, docs) {
                        if (err != null) return;

                        // Remove device sharing
                        var now = Date.now(), removedExact = null, removed = false, okDocs = [];
                        for (var i = 0; i < docs.length; i++) {
                            const doc = docs[i];
                            if (doc.publicid == command.publicid) { parent.db.Remove(doc._id, function () { }); removedExact = doc; removed = true; }
                            else if (doc.expireTime < now) { parent.db.Remove(doc._id, function () { }); removed = true; } else {
                                // This share is ok, remove extra data we don't need to send.
                                delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type;
                                okDocs.push(doc);
                            }
                        }

                        // Confirm removal if requested
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeDeviceShare', responseid: command.responseid, nodeid: command.nodeid, publicid: doc.publicid, removed: removedExact })); } catch (ex) { } }

                        // Event device share removal
                        if (removedExact != null) {
                            // Send out an event that we removed a device share
                            var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                            var event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'removedDeviceShare', msg: 'Removed Device Share', msgid: 102, msgArgs: [removedExact.guestName], domain: domain.id, publicid: command.publicid };
                            parent.parent.DispatchEvent(targets, obj, event);
                        }

                        // If we removed any shares, send device share update
                        if (removed == true) {
                            var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                            parent.parent.DispatchEvent(targets, obj, { etype: 'node', nodeid: node._id, action: 'deviceShareUpdate', domain: domain.id, deviceShares: okDocs, nolog: 1 });
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeDeviceShare', responseid: command.responseid, result: 'OK' })); } catch (ex) { } }
                        } else {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeDeviceShare', responseid: command.responseid, result: 'Invalid device share identifier.' })); } catch (ex) { } }
                        }
                    });
                });
                break;
            }
            case 'createDeviceShareLink': {
                if (domain.guestdevicesharing === false) return; // This feature is not allowed.
                var err = null;

                // Argument validation
                if (common.validateString(command.nodeid, 8, 128) == false) { err = 'Invalid node id'; } // Check the nodeid
                else if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                else if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                if (common.validateString(command.guestname, 1, 128) == false) { err = 'Invalid guest name'; } // Check the guest name
                else if ((command.expire != null) && (typeof command.expire != 'number')) { err = 'Invalid expire time'; } // Check the expire time in hours
                else if ((command.start != null) && (typeof command.start != 'number')) { err = 'Invalid start time'; } // Check the start time in seconds
                else if ((command.end != null) && (typeof command.end != 'number')) { err = 'Invalid end time'; } // Check the end time in seconds
                else if (common.validateInt(command.consent, 0, 256) == false) { err = 'Invalid flags'; } // Check the flags
                else if (common.validateInt(command.p, 1, 2) == false) { err = 'Invalid protocol'; } // Check the protocol, 1 = Terminal, 2 = Desktop
                else if ((command.expire == null) && ((command.start == null) || (command.end == null) || (command.start > command.end))) { err = 'No time specified'; } // Check that a time range is present
                else {
                    if (command.nodeid.split('/').length == 1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                    var snode = command.nodeid.split('/');
                    if ((snode.length != 3) || (snode[0] != 'node') || (snode[1] != domain.id)) { err = 'Invalid node id'; }
                }

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createDeviceShareLink', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Get the device rights
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    // If node not found or we don't have remote control, reject.
                    if (node == null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Invalid node id' })); } catch (ex) { } }
                        return;
                    }

                    // If there is MESHRIGHT_DESKLIMITEDINPUT or we don't have MESHRIGHT_GUESTSHARING on this account, reject this request.
                    if (rights != MESHRIGHT_ADMIN) {
                        // If we don't have remote control, or have limited input, or don't have guest sharing permission, fail here.
                        if (((rights & MESHRIGHT_REMOTECONTROL) == 0) || ((rights & MESHRIGHT_DESKLIMITEDINPUT) != 0) || ((rights & MESHRIGHT_GUESTSHARING) == 0)) {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                            return;
                        }
                    }

                    // If we are limited to no terminal, don't allow terminal sharing
                    if ((command.p == 1) && (rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_NOTERMINAL) != 0)) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                        return;                        
                    }

                    // If we have view only remote desktop rights, force view-only on the guest share.
                    if ((rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_REMOTEVIEWONLY) != 0)) { command.viewOnly = true; }

                    // Create cookie
                    var publicid = getRandomPassword(), startTime, expireTime;
                    if (command.expire != null) {
                        // Now until expire in hours
                        startTime = Date.now();
                        expireTime = Date.now() + (60000 * command.expire);
                    } else {
                        // Time range in seconds
                        startTime = command.start * 1000;
                        expireTime = command.end * 1000;
                    }

                    var cookie = { a: 5, p: command.p, uid: user._id, gn: command.guestname, nid: node._id, cf: command.consent, start: startTime, expire: expireTime, pid: publicid };
                    if (command.viewOnly === true) { cookie.vo = 1; }
                    const inviteCookie = parent.parent.encodeCookie(cookie, parent.parent.invitationLinkEncryptionKey);
                    if (inviteCookie == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createDeviceShareLink', responseid: command.responseid, result: 'Unable to generate shareing cookie' })); } catch (ex) { } } return; }
                    command.start = startTime;
                    command.expire = expireTime;

                    // Create the server url
                    var serverName = parent.getWebServerName(domain);
                    var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                    var xdomain = (domain.dns == null) ? domain.id : '';
                    if (xdomain != '') xdomain += '/';
                    var page = (command.p == 1) ? 'terminal' : 'desktop';
                    var url = 'https://' + serverName + ':' + httpsPort + '/' + xdomain + page + '?c=' + inviteCookie;
                    if (serverName.split('.') == 1) { url = '/' + xdomain + page + '?c=' + inviteCookie; }
                    command.url = url;
                    if (command.responseid != null) { command.result = 'OK'; }
                    try { ws.send(JSON.stringify(command)); } catch (ex) { }

                    // Create a device sharing database entry
                    var shareEntry = { _id: 'deviceshare-' + publicid, type: 'deviceshare', nodeid: node._id, p: command.p, domain: node.domain, publicid: publicid, startTime: startTime, expireTime: expireTime, userid: user._id, guestName: command.guestname, consent: command.consent, url: url };
                    if (command.viewOnly === true) { shareEntry.viewOnly = true; }
                    parent.db.Set(shareEntry);

                    // Send out an event that we added a device share
                    var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                    var event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'addedDeviceShare', msg: 'Added Device Share', msgid: 101, msgArgs: [command.guestname, 'DATETIME:' + startTime, 'DATETIME:' + expireTime], domain: domain.id };
                    parent.parent.DispatchEvent(targets, obj, event);

                    // Send device share update
                    parent.db.GetAllTypeNodeFiltered([command.nodeid], domain.id, 'deviceshare', null, function (err, docs) {
                        if (err != null) return;

                        // Check device sharing
                        var now = Date.now();
                        for (var i = 0; i < docs.length; i++) {
                            const doc = docs[i];
                            if (doc.expireTime < now) { parent.db.Remove(doc._id, function () { }); delete docs[i]; } else {
                                // This share is ok, remove extra data we don't need to send.
                                delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type;
                            }
                        }

                        // Send device share update
                        var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                        parent.parent.DispatchEvent(targets, obj, { etype: 'node', nodeid: node._id, action: 'deviceShareUpdate', domain: domain.id, deviceShares: docs, nolog: 1 });
                    });
                });
                break;
            }
            case 'traceinfo': {
                // Only accept if the tracing tab is allowed for this domain
                if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.trace !== true))) break;

                if ((user.siteadmin === SITERIGHT_ADMIN) && (typeof command.traceSources == 'object')) {
                    parent.parent.debugRemoteSources = command.traceSources;
                    parent.parent.DispatchEvent(['*'], obj, { action: 'traceinfo', userid: user._id, username: user.name, traceSources: command.traceSources, nolog: 1, domain: domain.id });
                }
                break;
            }
            case 'sendmqttmsg': {
                if (parent.parent.mqttbroker == null) { err = 'MQTT not supported on this server'; }; // MQTT not available
                if (common.validateArray(command.nodeids, 1) == false) { err = 'Invalid nodeids'; }; // Check nodeid's
                if (common.validateString(command.topic, 1, 64) == false) { err = 'Invalid topic'; } // Check the topic
                if (common.validateString(command.msg, 1, 4096) == false) { err = 'Invalid msg'; } // Check the message

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'sendmqttmsg', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Send the MQTT message
                for (i in command.nodeids) {
                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                        // If this device is connected on MQTT, send a wake action.
                        if (rights != 0) { parent.parent.mqttbroker.publish(node._id, command.topic, command.msg); }
                    });
                }

                break;
            }
            case 'getmqttlogin': {
                var err = null;
                if (parent.parent.mqttbroker == null) { err = 'MQTT not supported on this server'; }
                if (common.validateString(command.nodeid, 1, 1024) == false) { err = 'Invalid nodeid'; } // Check the nodeid

                // Handle any errors
                if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'getmqttlogin', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    // Check if this user has rights to do this
                    if (rights == MESHRIGHT_ADMIN) {
                        var token = parent.parent.mqttbroker.generateLogin(node.meshid, node._id);
                        var r = { action: 'getmqttlogin', responseid: command.responseid, nodeid: node._id, user: token.user, pass: token.pass };
                        const serverName = parent.getWebServerName(domain);

                        // Add MPS URL
                        if (parent.parent.mpsserver != null) {
                            r.mpsCertHashSha384 = parent.parent.certificateOperations.getCertHash(parent.parent.mpsserver.certificates.mps.cert);
                            r.mpsCertHashSha1 = parent.parent.certificateOperations.getCertHashSha1(parent.parent.mpsserver.certificates.mps.cert);
                            r.mpsUrl = 'mqtts://' + serverName + ':' + ((args.mpsaliasport != null) ? args.mpsaliasport : args.mpsport) + '/';
                        }

                        // Add WS URL
                        var xdomain = (domain.dns == null) ? domain.id : '';
                        if (xdomain != '') xdomain += '/';
                        var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                        r.wsUrl = 'wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'mqtt.ashx';
                        r.wsTrustedCert = parent.isTrustedCert(domain);

                        try { ws.send(JSON.stringify(r)); } catch (ex) { }
                    } else {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'getmqttlogin', responseid: command.responseid, result: 'Unable to perform this operation' })); } catch (ex) { } }
                    }
                });
                break;
            }
            case 'amt': {
                if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                if (common.validateInt(command.mode, 0, 3) == false) break; // Check connection mode
                // Validate if communication mode is possible                
                if (command.mode == null || command.mode == 0) {
                    break; //unsupported
                } else if (command.mode == 1) {
                    var state = parent.parent.GetConnectivityState(command.nodeid);
                    if ((state == null) || (state.connectivity & 4) == 0) break;
                } else if (command.mode == 2) {
                    if (parent.parent.mpsserver.ciraConnections[command.nodeid] == null) break;
                }
                /*
                else if (command.mode == 3) {
                    if (parent.parent.apfserver.apfConnections[command.nodeid] == null) break;
                }
                */

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    if ((rights & MESHRIGHT_REMOTECONTROL) == 0) return;
                    handleAmtCommand(command, node);
                });
                break;
            }
            case 'distributeCore': {
                // This is only available when plugins are enabled since it could cause stress on the server
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                for (var i in command.nodes) {
                    parent.sendMeshAgentCore(user, domain, command.nodes[i]._id, 'default');
                }
                break;
            }
            case 'plugins': {
                // Since plugin actions generally require a server restart, use the Full admin permission
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.db.getPlugins(function(err, docs) {
                    try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                });
                break;
            }
            case 'pluginLatestCheck': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.parent.pluginHandler.getPluginLatest()
                .then(function(latest) {
                    try { ws.send(JSON.stringify({ action: 'pluginVersionsAvailable', list: latest })); } catch (ex) { } 
                });
                break;
            }
            case 'addplugin': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                try {
                    parent.parent.pluginHandler.getPluginConfig(command.url)
                    .then(parent.parent.pluginHandler.addPlugin)
                    .then(function(docs){
                        var targets = ['*', 'server-users'];
                        parent.parent.DispatchEvent(targets, obj, { action: 'updatePluginList', list: docs });
                    })
                    .catch(function(err) {
                        if (typeof err == 'object') err = err.message;
                        try { ws.send(JSON.stringify({ action: 'pluginError', msg: err })); } catch (er) { }
                    }); 
                    
                } catch(e) { console.log('Cannot add plugin: ' + e); }
                break;
            }
            case 'installplugin': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.parent.pluginHandler.installPlugin(command.id, command.version_only, null, function(){
                    parent.db.getPlugins(function(err, docs) {
                        try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                    });
                    var targets = ['*', 'server-users'];
                    parent.parent.DispatchEvent(targets, obj, { action: 'pluginStateChange' });
                });
                break;
            }
            case 'disableplugin': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.parent.pluginHandler.disablePlugin(command.id, function(){
                    parent.db.getPlugins(function(err, docs) {
                        try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                        var targets = ['*', 'server-users'];
                        parent.parent.DispatchEvent(targets, obj, { action: 'pluginStateChange' });
                    });
                });
                break;
            }
            case 'removeplugin': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.parent.pluginHandler.removePlugin(command.id, function(){
                    parent.db.getPlugins(function(err, docs) {
                        try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                    });
                });
                break;
            }
            case 'getpluginversions': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (parent.parent.pluginHandler == null)) break; // Must be full admin with plugins enabled
                parent.parent.pluginHandler.getPluginVersions(command.id)
                .then(function (versionInfo) {
                    try { ws.send(JSON.stringify({ action: 'downgradePluginVersions', info: versionInfo, error: null })); } catch (ex) { } 
                })
                .catch(function (e) {
                  try { ws.send(JSON.stringify({ action: 'pluginError', msg: e })); } catch (ex) { } 
                });
                
                break;
            }
            case 'plugin': {
                if (parent.parent.pluginHandler == null) break; // If the plugin's are not supported, reject this command.
                command.userid = user._id;
                if (command.routeToNode === true) {
                    routeCommandToNode(command);
                } else {
                    try {
                        parent.parent.pluginHandler.plugins[command.plugin].serveraction(command, obj, parent);
                    } catch (e) { console.log('Error loading plugin handler (' + e + ')'); }
                }
                break;
            }
            case 'uicustomevent': {
                // Event the change
                var message = { etype: 'user', userid: user._id, username: user.name, action: 'uicustomevent', domain: domain.id, uisection: command.section, element: command.element  };
                if (command.selectedDevices != null) { message.selectedDevices = command.selectedDevices; }
                if (command.src != null) { message.src = command.src; }
                if (command.values != null) { message.values = command.values; }
                if (typeof command.logmsg == 'string') { message.msg = command.logmsg; } else { message.nolog = 1; }
                parent.parent.DispatchEvent(['*', user._id], obj, message);
                break;
            }
            case 'serverBackup': {
                if ((user.siteadmin != SITERIGHT_ADMIN) || (typeof parent.parent.config.settings.autobackup.googledrive != 'object')) return;
                if (command.service == 'googleDrive') {
                    if (command.state == 0) {
                        parent.db.Remove('GoogleDriveBackup', function () { try { ws.send(JSON.stringify({ action: 'serverBackup', service: 'googleDrive', state: 1 })); } catch (ex) { } });
                    } else if (command.state == 1) {
                        const {google} = require('googleapis');
                        obj.oAuth2Client = new google.auth.OAuth2(command.clientid, command.clientsecret, "urn:ietf:wg:oauth:2.0:oob");
                        obj.oAuth2Client.xxclientid = command.clientid;
                        obj.oAuth2Client.xxclientsecret = command.clientsecret;
                        const authUrl = obj.oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/drive.file'] });
                        try { ws.send(JSON.stringify({ action: 'serverBackup', service: 'googleDrive', state: 2, url: authUrl })); } catch (ex) { }
                    } else if ((command.state == 2) && (obj.oAuth2Client != null)) {
                        obj.oAuth2Client.getToken(command.code, function (err, token) {
                            if (err != null) { console.log('GoogleDrive (getToken) error: ', err); return; }
                            parent.db.Set({ _id: 'GoogleDriveBackup', state: 3, clientid: obj.oAuth2Client.xxclientid, clientsecret: obj.oAuth2Client.xxclientsecret, token: token });
                            try { ws.send(JSON.stringify({ action: 'serverBackup', service: 'googleDrive', state: 3 })); } catch (ex) { }
                        });
                    }
                }
                break;
            }
            case 'twoFactorCookie': {
                // Generate a two-factor cookie
                if (((domain.twofactorcookiedurationdays == null) || (domain.twofactorcookiedurationdays > 0))) {
                    var maxCookieAge = domain.twofactorcookiedurationdays;
                    if (typeof maxCookieAge != 'number') { maxCookieAge = 30; }
                    const twoFactorCookie = parent.parent.encodeCookie({ userid: user._id, expire: maxCookieAge * 24 * 60 /*, ip: req.clientIp*/ }, parent.parent.loginCookieEncryptionKey);
                    try { ws.send(JSON.stringify({ action: 'twoFactorCookie', cookie: twoFactorCookie })); } catch (ex) { }
                }
                break;
            }
            case 'amtsetupbin': {
                if ((command.oldmebxpass != 'admin') && (common.validateString(command.oldmebxpass, 8, 16) == false)) break; // Check password
                if (common.validateString(command.newmebxpass, 8, 16) == false) break; // Check password
                var bin = parent.parent.certificateOperations.GetSetupBinFile(domain.amtacmactivation, command.oldmebxpass, command.newmebxpass, domain, user);
                try { ws.send(JSON.stringify({ action: 'amtsetupbin', file: Buffer.from(bin, 'binary').toString('base64') })); } catch (ex) { }
                break;
            }
            case 'meshToolInfo': {
                if (typeof command.name != 'string') break;
                var info = parent.parent.meshToolsBinaries[command.name];
                var responseCmd = { action: 'meshToolInfo', name: command.name, hash: info.hash, size: info.size, url: info.url };
                if (parent.webCertificateHashs[domain.id] != null) { responseCmd.serverhash = Buffer.from(parent.webCertificateHashs[domain.id], 'binary').toString('hex'); }
                try { ws.send(JSON.stringify(responseCmd)); } catch (ex) { }
                break;
            }
            case 'pushmessage': {
                // Check if this user has rights on this nodeid
                if (parent.parent.firebase == null) return;
                if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                if (common.validateString(command.title, 1, 1024) == false) break; // Check title
                if (common.validateString(command.msg, 1, 1024) == false) break; // Check message
                db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                    if ((err == null) && (nodes.length == 1)) {
                        const node = nodes[0];
                        if (((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_CHATNOTIFY) != 0) && (typeof node.pmt == 'string')) {
                            // Send out a push message to the device
                            var payload = { notification: { title: command.title, body: command.msg } };
                            var options = { priority: "Normal", timeToLive: 5 * 60 }; // TTL: 5 minutes
                            parent.parent.firebase.sendToDevice(node, payload, options, function (id, err, errdesc) {
                                if (err == null) {
                                    parent.parent.debug('email', 'Successfully send push message to device ' + node.name + ', title: ' + command.title + ', msg: ' + command.msg);
                                } else {
                                    parent.parent.debug('email', 'Failed to send push message to device ' + node.name + ', title: ' + command.title + ', msg: ' + command.msg + ', error: ' + errdesc);
                                }
                            });
                        }
                    }
                });
                break;
            }
            case 'pushconsole': {
                // Check if this user has rights on this nodeid
                if (parent.parent.firebase == null) return;
                if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                if (common.validateString(command.console, 1, 3000) == false) break; // Check console command
                db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                    if ((err == null) && (nodes.length == 1)) {
                        const node = nodes[0];
                        if ((parent.GetNodeRights(user, node.meshid, node._id) == MESHRIGHT_ADMIN) && (typeof node.pmt == 'string')) {
                            // Send out a push message to the device
                            var payload = { data: { con: command.console, s: ws.sessionId } };
                            var options = { priority: "Normal", timeToLive: 60 }; // TTL: 1 minutes, priority 'Normal' or 'High'
                            parent.parent.firebase.sendToDevice(node, payload, options, function (id, err, errdesc) {
                                if (err != null) {
                                    try { ws.send(JSON.stringify({ action: 'msg', type: 'console', nodeid: node._id, value: 'Failed: ' + errdesc })); } catch (ex) { }
                                    parent.parent.debug('email', 'Failed to send push console message to device ' + node.name + ', command: ' + command.console + ', error: ' + errdesc);
                                }
                            });
                        }
                    }
                });
                break;
            }
            case 'webpush': {
                // Check if web push is enabled
                if (parent.parent.webpush == null) break;

                // Adds a web push session to the user. Start by sanitizing the input.
                if ((typeof command.sub != 'object') && (typeof command.sub.keys != 'object') && (typeof command.sub.endpoint != 'string')) break;
                if (common.validateString(command.sub.endpoint, 1, 1024) == false) break; // Check endpoint
                if (common.validateString(command.sub.keys.auth, 1, 64) == false) break; // Check key auth
                if (common.validateString(command.sub.keys.p256dh, 1, 256) == false) break; // Check key dh
                var newWebPush = { endpoint: command.sub.endpoint, keys: { auth: command.sub.keys.auth, p256dh: command.sub.keys.p256dh } }
                
                // See if we need to add this session
                var changed = false;
                if (user.webpush == null) {
                    changed = true;
                    user.webpush = [newWebPush];
                } else {
                    var found = false;
                    for (var i in user.webpush) {
                        if ((user.webpush[i].endpoint == newWebPush.endpoint) && (user.webpush[i].keys.auth == newWebPush.keys.auth) && (user.webpush[i].keys.p256dh == newWebPush.keys.p256dh)) { found = true; }
                    }
                    if (found == true) break;
                    changed = true;
                    user.webpush.push(newWebPush);
                    while (user.webpush.length > 5) { user.webpush.shift(); }
                }

                // If we added the session, update the user
                if (changed == true) {
                    // Update the database
                    parent.db.SetUser(user);

                    // Event the change
                    var message = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
                    if (db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    parent.parent.DispatchEvent(targets, obj, message);
                }

                break;
            }
            case 'updateAgents': {
                // Update agents for selected devices
                if (common.validateStrArray(command.nodeids, 1) == false) break; // Check nodeids
                for (var i in command.nodeids) { routeCommandToNode({ action: 'msg', type: 'console', nodeid: command.nodeids[i], value: 'agentupdate' }, MESHRIGHT_ADMIN, 0); }
                break;
            }
            case 'print': {
                console.log(command.value);
                break;
            }
            case 'previousLogins': {
                // TODO: Make a better database call to get filtered data.
                if (command.userid == null) {
                    // Get previous logins for self
                    if (db.GetUserLoginEvents) {
                        // New way
                        db.GetUserLoginEvents(domain.id, user._id.split('/')[2], function (err, docs) {
                            if (err != null) return;
                            var e = [];
                            for (var i in docs) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); }
                            try { ws.send(JSON.stringify({ action: 'previousLogins', events: e })); } catch (ex) { }
                        });
                    } else {
                        // Old way
                        db.GetUserEvents([user._id], domain.id, user._id.split('/')[2], function (err, docs) {
                            console.log(docs);
                            if (err != null) return;
                            var e = [];
                            for (var i in docs) { if ((docs[i].msgArgs) && ((docs[i].action == 'authfail') || (docs[i].action == 'login'))) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); } }
                            try { ws.send(JSON.stringify({ action: 'previousLogins', events: e })); } catch (ex) { }
                        });
                    }
                } else {
                    // Get previous logins for specific userid
                    if (user.siteadmin === SITERIGHT_ADMIN) {
                        var splitUser = command.userid.split('/');
                        if ((obj.crossDomain === true) || (splitUser[1] === domain.id)) {
                            if (db.GetUserLoginEvents) {
                                // New way
                                db.GetUserLoginEvents(splitUser[1], splitUser[2], function (err, docs) {
                                    if (err != null) return;
                                    var e = [];
                                    for (var i in docs) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); }
                                    try { ws.send(JSON.stringify({ action: 'previousLogins', userid: command.userid, events: e })); } catch (ex) { }
                                });
                            } else {
                                // Old way
                                db.GetUserEvents([command.userid], splitUser[1], splitUser[2], function (err, docs) {
                                    if (err != null) return;
                                    var e = [];
                                    for (var i in docs) { if ((docs[i].msgArgs) && ((docs[i].action == 'authfail') || (docs[i].action == 'login'))) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); } }
                                    try { ws.send(JSON.stringify({ action: 'previousLogins', userid: command.userid, events: e })); } catch (ex) { }
                                });
                            }
                        }
                    }
                }
                break;
            }
            default: {
                // Unknown user action
                console.log('Unknown action from user ' + user.name + ': ' + command.action + '.');
                break;
            }
        }
    }

    // Display a notification message for this session only.
    function displayNotificationMessage(msg, title, tag, titleid, msgid, args) {
        ws.send(JSON.stringify({ 'action': 'msg', 'type': 'notify', id: Math.random(), 'value': msg, 'title': title, 'userid': user._id, 'username': user.name, 'tag': tag, 'titleid': titleid, 'msgid': msgid, 'args': args }));
    }

    // Read the folder and all sub-folders and serialize that into json.
    function readFilesRec(path) {
        var r = {}, dir = fs.readdirSync(path);
        for (var i in dir) {
            var f = { t: 3, d: 111 };
            var stat = fs.statSync(path + '/' + dir[i]);
            if ((stat.mode & 0x004000) == 0) { f.s = stat.size; f.d = stat.mtime.getTime(); } else { f.t = 2; f.f = readFilesRec(path + '/' + dir[i]); }
            r[dir[i]] = f;
        }
        return r;
    }

    // Delete a directory with a files and directories within it
    // TODO, make this an async function
    function deleteFolderRecursive(path) {
        if (fs.existsSync(path)) {
            fs.readdirSync(path).forEach(function (file, index) {
                var curPath = parent.path.join(path, file);;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(path);
        }
    };

    function updateUserFiles(user, ws, domain) {
        if ((user == null) || (user.siteadmin == null) || ((user.siteadmin & 8) == 0)) return;

        // Request the list of server files
        var files = { action: 'files', filetree: { n: 'Root', f: {} } };

        // Add user files
        files.filetree.f[user._id] = { t: 1, n: 'My Files', f: {} };
        files.filetree.f[user._id].maxbytes = parent.getQuota(user._id, domain);
        var usersplit = user._id.split('/'), domainx = 'domain';
        if (usersplit[1].length > 0) domainx = 'domain-' + usersplit[1];

        // Read all files recursively
        try {
            files.filetree.f[user._id].f = readFilesRec(parent.path.join(parent.filespath, domainx + '/user-' + usersplit[2]));
        } catch (e) {
            // TODO: We may want to fake this file structure until it's needed.
            // Got an error, try to create all the folders and try again...
            try { fs.mkdirSync(parent.filespath); } catch (e) { }
            try { fs.mkdirSync(parent.path.join(parent.filespath, domainx)); } catch (e) { }
            try { fs.mkdirSync(parent.path.join(parent.filespath, domainx + '/user-' + usersplit[2])); } catch (e) { }
            try { fs.mkdirSync(parent.path.join(parent.filespath, domainx + '/user-' + usersplit[2] + '/Public')); } catch (e) { }
            try { files.filetree.f[user._id].f = readFilesRec(parent.path.join(parent.filespath, domainx + '/user-' + usersplit[2])); } catch (e) { }
        }

        // Add files for each mesh // TODO: Get all meshes including groups!!
        for (var i in user.links) {
            if ((user.links[i].rights & 32) != 0) { // Check that we have file permissions
                var mesh = parent.meshes[i];
                if (mesh) {
                    var meshsplit = mesh._id.split('/');
                    files.filetree.f[mesh._id] = { t: 4, n: mesh.name, f: {} };
                    files.filetree.f[mesh._id].maxbytes = parent.getQuota(mesh._id, domain);

                    // Read all files recursively
                    try {
                        files.filetree.f[mesh._id].f = readFilesRec(parent.path.join(parent.filespath, domainx + '/mesh-' + meshsplit[2]));
                    } catch (e) {
                        files.filetree.f[mesh._id].f = {}; // Got an error, return empty folder. We will create the folder only when needed.
                    }
                }
            }
        }

        // Respond
        try { ws.send(JSON.stringify(files)); } catch (ex) { }
    }

    function EscapeHtml(x) { if (typeof x == 'string') return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    // Split a string taking into account the quoats. Used for command line parsing
    function splitArgs(str) { var myArray = [], myRegexp = /[^\s"]+|"([^"]*)"/gi; do { var match = myRegexp.exec(str); if (match != null) { myArray.push(match[1] ? match[1] : match[0]); } } while (match != null); return myArray; }
    function toNumberIfNumber(x) { if ((typeof x == 'string') && (+parseInt(x) === x)) { x = parseInt(x); } return x; }

    function isPhoneNumber(x) {
        var ok = true;
        if (x.startsWith('+')) { x = x.substring(1); }
        for (var i = 0; i < x.length; i++) { var c = x.charCodeAt(i); if (((c < 48) || (c > 57)) && (c != 32) && (c != 45) && (c != 46)) { ok = false; } }
        return ok && (x.length >= 10);
    }

    function removeAllUnderScore(obj) {
        if (typeof obj != 'object') return obj;
        for (var i in obj) { if (i.startsWith('_')) { delete obj[i]; } else if (typeof obj[i] == 'object') { removeAllUnderScore(obj[i]); } }
        return obj;
    }

    // Generate a 8 digit integer with even random probability for each value.
    function getRandomEightDigitInteger() { var bigInt; do { bigInt = parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 100000000; }
    function getRandomSixDigitInteger() { var bigInt; do { bigInt = parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 1000000; }

    // Parse arguments string array into an object
    function parseArgs(argv) {
        var results = { '_': [] }, current = null;
        for (var i = 1, len = argv.length; i < len; i++) {
            var x = argv[i];
            if (x.length > 2 && x[0] == '-' && x[1] == '-') {
                if (current != null) { results[current] = true; }
                current = x.substring(2);
            } else {
                if (current != null) { results[current] = toNumberIfNumber(x); current = null; } else { results['_'].push(toNumberIfNumber(x)); }
            }
        }
        if (current != null) { results[current] = true; }
        return results;
    }

    // Return true if at least one element of arr2 is in arr1
    function findOne(arr1, arr2) { if ((arr1 == null) || (arr2 == null)) return false; return arr2.some(function (v) { return arr1.indexOf(v) >= 0; }); };

    function getRandomPassword() { return Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); }

    function handleAmtCommand(cmd, node) {
        if (cmd == null) return;
        var host = cmd.nodeid;
        if (cmd.mode == 1) { host = node.host; }
        var tlsoptions = null;
        var wsman = new Wsman(WsmanComm, host, node.intelamt.tls ? 16993 : 16992, node.intelamt.user, node.intelamt.pass,
            node.intelamt.tls, tlsoptions, parent.parent, cmd.mode);
        var amt = new Amt(wsman);
        switch (cmd.command) {
            case 'Get-GeneralSettings': {
                amt.Get('AMT_GeneralSettings', function (obj, name, response, status) {
                    if (status == 200) {
                        var resp = { action: 'amt', nodeid: cmd.nodeid, command: 'Get-GeneralSettings', value: response.Body }
                        ws.send(JSON.stringify(resp));
                    } else {
                        ws.send(JSON.stringify({ 'error': error }));
                    }
                });
                break;
            }
            default: {
                // Do nothing
            }
        }
    }

    // Return the number of 2nd factor for this account
    function count2factoraAuths() {
        var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null));
        var sms2fa = ((parent.parent.smsserver != null) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)));
        var authFactorCount = 0;
        if (typeof user.otpsecret == 'string') { authFactorCount++; } // Authenticator time factor
        if (email2fa && (user.otpekey != null)) { authFactorCount++; } // EMail factor
        if (sms2fa && (user.phone != null)) { authFactorCount++; } // SMS factor
        if (user.otphkeys != null) { authFactorCount += user.otphkeys.length; } // FIDO hardware factor
        if ((authFactorCount > 0) && (user.otpkeys != null)) { authFactorCount++; } // Backup keys
        return authFactorCount;
    }

    return obj;
};
