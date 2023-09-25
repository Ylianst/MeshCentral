/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire & Bryan Roe
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
    const MESHRIGHT_EDITMESH            = 0x00000001; // 1
    const MESHRIGHT_MANAGEUSERS         = 0x00000002; // 2
    const MESHRIGHT_MANAGECOMPUTERS     = 0x00000004; // 4
    const MESHRIGHT_REMOTECONTROL       = 0x00000008; // 8
    const MESHRIGHT_AGENTCONSOLE        = 0x00000010; // 16
    const MESHRIGHT_SERVERFILES         = 0x00000020; // 32
    const MESHRIGHT_WAKEDEVICE          = 0x00000040; // 64
    const MESHRIGHT_SETNOTES            = 0x00000080; // 128
    const MESHRIGHT_REMOTEVIEWONLY      = 0x00000100; // 256
    const MESHRIGHT_NOTERMINAL          = 0x00000200; // 512
    const MESHRIGHT_NOFILES             = 0x00000400; // 1024
    const MESHRIGHT_NOAMT               = 0x00000800; // 2048
    const MESHRIGHT_DESKLIMITEDINPUT    = 0x00001000; // 4096
    const MESHRIGHT_LIMITEVENTS         = 0x00002000; // 8192
    const MESHRIGHT_CHATNOTIFY          = 0x00004000; // 16384
    const MESHRIGHT_UNINSTALL           = 0x00008000; // 32768
    const MESHRIGHT_NODESKTOP           = 0x00010000; // 65536
    const MESHRIGHT_REMOTECOMMAND       = 0x00020000; // 131072
    const MESHRIGHT_RESETOFF            = 0x00040000; // 262144
    const MESHRIGHT_GUESTSHARING        = 0x00080000; // 524288
    const MESHRIGHT_DEVICEDETAILS       = 0x00100000; // 1048576
    const MESHRIGHT_RELAY               = 0x00200000; // 2097152
    const MESHRIGHT_ADMIN               = 0xFFFFFFFF;

    // Site rights
    const SITERIGHT_SERVERBACKUP        = 0x00000001; // 1
    const SITERIGHT_MANAGEUSERS         = 0x00000002; // 2
    const SITERIGHT_SERVERRESTORE       = 0x00000004; // 4
    const SITERIGHT_FILEACCESS          = 0x00000008; // 8
    const SITERIGHT_SERVERUPDATE        = 0x00000010; // 16
    const SITERIGHT_LOCKED              = 0x00000020; // 32
    const SITERIGHT_NONEWGROUPS         = 0x00000040; // 64
    const SITERIGHT_NOMESHCMD           = 0x00000080; // 128
    const SITERIGHT_USERGROUPS          = 0x00000100; // 256
    const SITERIGHT_RECORDINGS          = 0x00000200; // 512
    const SITERIGHT_LOCKSETTINGS        = 0x00000400; // 1024
    const SITERIGHT_ALLEVENTS           = 0x00000800; // 2048
    const SITERIGHT_NONEWDEVICES        = 0x00001000; // 4096
    const SITERIGHT_ADMIN               = 0xFFFFFFFF;

    // Protocol Numbers
    const PROTOCOL_TERMINAL             = 1;
    const PROTOCOL_DESKTOP              = 2;
    const PROTOCOL_FILES                = 5;
    const PROTOCOL_AMTWSMAN             = 100;
    const PROTOCOL_AMTREDIR             = 101;
    const PROTOCOL_MESSENGER            = 200;
    const PROTOCOL_WEBRDP               = 201;
    const PROTOCOL_WEBSSH               = 202;
    const PROTOCOL_WEBSFTP              = 203;
    const PROTOCOL_WEBVNC               = 204;

    // MeshCentral Satellite
    const SATELLITE_PRESENT = 1;     // This session is a MeshCentral Salellite session
    const SATELLITE_802_1x = 2;      // This session supports 802.1x profile checking and creation

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

    // Information related to the current page the user is looking at
    obj.deviceSkip = 0; // How many devices to skip
    obj.deviceLimit = 0; // How many devices to view
    obj.visibleDevices = null; // An object of visible nodeid's if the user is in paging mode
    if (domain.maxdeviceview != null) { obj.deviceLimit = domain.maxdeviceview; }

    // Check if we are a cross-domain administrator
    if (parent.parent.config.settings.managecrossdomain && (parent.parent.config.settings.managecrossdomain.indexOf(user._id) >= 0)) { obj.crossDomain = true; }

    // Server side Intel AMT stack
    const WsmanComm = require('./amt/amt-wsman-comm.js');
    const Wsman = require('./amt/amt-wsman.js');
    const Amt = require('./amt/amt.js');

    // If this session has an expire time, setup a timer now.
    if ((req.session != null) && (typeof req.session.expire == 'number')) {
        var delta = (req.session.expire - Date.now());
        if (delta <= 0) { req.session = {}; try { ws.close(); } catch (ex) { } return; } // Session is already expired, close now.
        obj.expireTimer = setTimeout(function () { for (var i in req.session) { delete req.session[i]; } obj.close(); }, delta);
    }

    // Send data through the websocket
    obj.send = function (object) { try { ws.send(JSON.stringify(object)); } catch(ex) {} }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (addr.startsWith('::ffff:')) { return addr.substring(7); } else { return addr; } }

    // Send a PING/PONG message
    function sendPing() { try { obj.ws.send('{"action":"ping"}'); } catch (ex) { } }
    function sendPong() { try { obj.ws.send('{"action":"pong"}'); } catch (ex) { } }

    // Setup the agent PING/PONG timers
    if ((typeof args.browserping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, args.browserping * 1000); }
    else if ((typeof args.browserpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, args.browserpong * 1000); }

    // Disconnect this user
    obj.close = function (arg) {
        obj.ws.xclosed = 1; // This is for testing. Will be displayed when running "usersessions" server console command.

        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); parent.parent.debug('user', 'Soft disconnect'); } catch (ex) { console.log(ex); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); parent.parent.debug('user', 'Hard disconnect'); } catch (ex) { console.log(ex); } } // Hard close, close the TCP socket

        obj.ws.xclosed = 2; // DEBUG

        // Perform timer cleanup
        if (obj.pingtimer) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        obj.ws.xclosed = 3; // DEBUG

        // Clear expire timeout
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }

        obj.ws.xclosed = 4; // DEBUG

        // Perform cleanup
        parent.parent.RemoveAllEventDispatch(obj.ws);
        if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); delete obj.serverStatsTimer; }
        if (req.session && req.session.ws && req.session.ws == obj.ws) { delete req.session.ws; }
        if (parent.wssessions2[ws.sessionId]) { delete parent.wssessions2[ws.sessionId]; }

        obj.ws.xclosed = 5; // DEBUG

        if ((obj.user != null) && (parent.wssessions[obj.user._id])) {
            obj.ws.xclosed = 6; // DEBUG
            var i = parent.wssessions[obj.user._id].indexOf(obj.ws);
            if (i >= 0) {
                obj.ws.xclosed = 7; // DEBUG
                parent.wssessions[obj.user._id].splice(i, 1);
                var user = parent.users[obj.user._id];
                if (user) {
                    obj.ws.xclosed = 8; // DEBUG
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

        obj.ws.xclosed = 9; // DEBUG

        // If we have peer servers, inform them of the disconnected session
        if (parent.parent.multiServer != null) { parent.parent.multiServer.DispatchMessage({ action: 'sessionEnd', sessionid: ws.sessionId }); }

        obj.ws.xclosed = 10; // DEBUG

        // Update user last access time
        if (obj.user != null) {
            const timeNow = Math.floor(Date.now() / 1000);
            if (obj.user.access < (timeNow - 300)) { // Only update user access time if longer than 5 minutes
                obj.user.access = timeNow;
                parent.db.SetUser(user);

                // Event the change
                var message = { etype: 'user', userid: obj.user._id, username: obj.user.name, account: parent.CloneSafeUser(obj.user), action: 'accountchange', domain: domain.id, nolog: 1 };
                if (parent.db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                var targets = ['*', 'server-users', obj.user._id];
                if (obj.user.groups) { for (var i in obj.user.groups) { targets.push('server-users:' + i); } }
                parent.parent.DispatchEvent(targets, obj, message);
            }
        }

        // Aggressive cleanup
        delete obj.user;
        delete obj.domain;
        delete obj.ws.userid;
        delete obj.ws.domainid;
        delete obj.ws.clientIp;
        delete obj.ws.sessionId;
        delete obj.ws.HandleEvent;
        obj.ws.removeAllListeners(['message', 'close', 'error']);

        obj.ws.xclosed = 11; // DEBUG
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
    function routeCommandToNode(command, requiredRights, requiredNonRights, func, options) {
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
                        if ((options != null) && (options.removeViewOnlyLimitation === true) && (command.rights != 0xFFFFFFFF) && ((command.rights & 0x100) != 0)) { command.rights -= 0x100; } // Since the multiplexor will enforce view-only, remove MESHRIGHT_REMOTEVIEWONLY
                        command.consent = 0;
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        if (typeof mesh.consent == 'number') { command.consent |= mesh.consent; } // Add device group user consent
                        if (typeof node.consent == 'number') { command.consent |= node.consent; } // Add node user consent
                        if (typeof user.consent == 'number') { command.consent |= user.consent; } // Add user consent

                        // If desktop is viewonly, add this here.
                        if ((typeof domain.desktop == 'object') && (domain.desktop.viewonly == true)) { command.desktopviewonly = true; }

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
                            if ((options != null) && (options.removeViewOnlyLimitation === true) && (command.rights != 0xFFFFFFFF) && ((command.rights & 0x100) != 0)) { command.rights -= 0x100; } // Since the multiplexor will enforce view-only, remove MESHRIGHT_REMOTEVIEWONLY
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
                try { ws.send(JSON.stringify({ action: 'stopped', msg: 'Session count exceed' })); } catch (ex) { }
                try { ws.close(); } catch (e) { }
                return;
            }
        }

        // Associate this websocket session with the web session
        ws.userid = user._id;
        ws.domainid = domain.id;
        ws.clientIp = req.clientIp;

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
                // If this session is logged in using a loginToken and the token is removed, disconnect.
                if ((req.session.loginToken != null) && (typeof event == 'object') && (event.action == 'loginTokenChanged') && (event.removed != null) && (event.removed.indexOf(req.session.loginToken) >= 0)) { delete req.session; obj.close(); return; }

                // If this user is not viewing all devices and paging, check if this event is in the current page
                if (isEventWithinPage(ids) == false) return;

                // Normally, only allow this user to receive messages from it's own domain.
                // If the user is a cross domain administrator, allow some select messages from different domains.
                if ((event.domain == null) || (event.domain == domain.id) || ((obj.crossDomain === true) && (allowedCrossDomainMessages.indexOf(event.action) >= 0))) {
                    try {
                        if (event == 'close') { try { delete req.session; } catch (ex) { } obj.close(); return; }
                        else if (event == 'resubscribe') { user.subscriptions = parent.subscribe(user._id, ws); }
                        else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                        else {
                            // If updating guest device shares, if we are updating a user that is not creator of the share, remove the URL.
                            if (((event.action == 'deviceShareUpdate') && (Array.isArray(event.deviceShares))) || ((event.action == 'changenode') && (event.node != null) && ((event.node.rdp != null) || (event.node.ssh != null)))) {
                                event = common.Clone(event);
                                if ((event.action == 'deviceShareUpdate') && (Array.isArray(event.deviceShares))) {
                                    for (var i in event.deviceShares) { if (event.deviceShares[i].userid != user._id) { delete event.deviceShares[i].url; } }
                                }
                                if ((event.action == 'changenode') && (event.node != null) && ((event.node.rdp != null) || (event.node.ssh != null))) {
                                    // Clean up RDP & SSH credentials
                                    if ((event.node.rdp != null) && (typeof event.node.rdp[user._id] == 'number')) { event.node.rdp = event.node.rdp[user._id]; } else { delete event.node.rdp; }
                                    if ((event.node.ssh != null) && (typeof event.node.ssh[user._id] == 'number')) { event.node.ssh = event.node.ssh[user._id]; } else { delete event.node.ssh; }
                                }
                            }

                            // This is a MeshCentral Satellite message
                            if (event.action == 'satellite') { if ((obj.ws.satelliteFlags & event.satelliteFlags) != 0) { try { ws.send(JSON.stringify(event)); } catch (ex) { } return; } }

                            // Because of the device group "Show Self Events Only", we need to do more checks here.
                            if (id.startsWith('mesh/')) {
                                // Check if we have rights to get this message. If we have limited events on this mesh, don't send the event to the user.
                                var meshrights = parent.GetMeshRights(user, id);
                                if ((meshrights === MESHRIGHT_ADMIN) || ((meshrights & MESHRIGHT_LIMITEVENTS) == 0) || (ids.indexOf(user._id) >= 0)) {
                                    // We have the device group rights to see this event or we are directly targetted by the event
                                    try { ws.send(JSON.stringify({ action: 'event', event: event })); } catch (ex) { }
                                } else {
                                    // Check if no other users are targeted by the event, if not, we can get this event.
                                    var userTarget = false;
                                    for (var i in ids) { if (ids[i].startsWith('user/')) { userTarget = true; } }
                                    if (userTarget == false) { ws.send(JSON.stringify({ action: 'event', event: event })); }
                                }
                            } else if (event.ugrpid != null) {
                                if ((user.siteadmin & SITERIGHT_USERGROUPS) != 0) {
                                    // If we have the rights to see users in a group, send the group as is.
                                    try { ws.send(JSON.stringify({ action: 'event', event: event })); } catch (ex) { }
                                } else {
                                    // We don't have the rights to see otehr users in the user group, remove the links that are not for ourselves.
                                    var links = {};
                                    if (event.links) { for (var i in event.links) { if ((i == user._id) || i.startsWith('mesh/') || i.startsWith('node/')) { links[i] = event.links[i]; } } }
                                    try { ws.send(JSON.stringify({ action: 'event', event: { ugrpid: event.ugrpid, domain: event.domain, time: event.time, name: event.name, action: event.action, username: event.username, links: links, h: event.h } })); } catch (ex) { }
                                }
                            } else {
                                // This is not a device group event, we can get this event.
                                try { ws.send(JSON.stringify({ action: 'event', event: event })); } catch (ex) { }
                            }
                        }
                    } catch (ex) { console.log(ex); }
                }
            };

            user.subscriptions = parent.subscribe(user._id, ws); // Subscribe to events
            try { ws._socket.setKeepAlive(true, 240000); } catch (ex) { } // Set TCP keep alive

            // Send current server statistics
            obj.SendServerStats = function () {
                // Take a look at server stats
                var os = require('os');
                var stats = { action: 'serverstats', totalmem: os.totalmem(), freemem: os.freemem() };
                try { stats.cpuavg = os.loadavg(); } catch (ex) { }
                if (parent.parent.platform != 'win32') {
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
            const allFeatures = parent.getDomainUserFeatures(domain, user, req);
            var serverinfo = { domain: domain.id, name: domain.dns ? domain.dns : parent.certificates.CommonName, mpsname: parent.certificates.AmtMpsName, mpsport: mpsport, mpspass: args.mpspass, port: httpport, emailcheck: ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (args.lanonly != true) && (parent.certificates.CommonName != null) && (parent.certificates.CommonName.indexOf('.') != -1) && (user._id.split('/')[2].startsWith('~') == false)), domainauth: (domain.auth == 'sspi'), serverTime: Date.now(), features: allFeatures.features, features2: allFeatures.features2 };
            serverinfo.languages = parent.renderLanguages;
            serverinfo.tlshash = Buffer.from(parent.webCertificateFullHashs[domain.id], 'binary').toString('hex').toUpperCase(); // SHA384 of server HTTPS certificate
            serverinfo.agentCertHash = parent.agentCertificateHashBase64;
            if (typeof domain.sessionrecording == 'object') {
                if (domain.sessionrecording.onlyselectedusers === true) { serverinfo.usersSessionRecording = 1; } // Allow enabling of session recording for users
                if (domain.sessionrecording.onlyselectedusergroups === true) { serverinfo.userGroupsSessionRecording = 1; } // Allow enabling of session recording for user groups
                if (domain.sessionrecording.onlyselecteddevicegroups === true) { serverinfo.devGroupSessionRecording = 1; } // Allow enabling of session recording for device groups
            }
            if ((parent.parent.config.domains[domain.id].amtacmactivation != null) && (parent.parent.config.domains[domain.id].amtacmactivation.acmmatch != null)) {
                var matchingDomains = [];
                for (var i in parent.parent.config.domains[domain.id].amtacmactivation.acmmatch) {
                    var cn = parent.parent.config.domains[domain.id].amtacmactivation.acmmatch[i].cn;
                    if ((cn != '*') && (matchingDomains.indexOf(cn) == -1)) { matchingDomains.push(cn); }
                }
                if (matchingDomains.length > 0) { serverinfo.amtAcmFqdn = matchingDomains; }
            }
            if (typeof domain.devicemeshrouterlinks == 'object') { serverinfo.devicemeshrouterlinks = domain.devicemeshrouterlinks; }
            if ((typeof domain.altmessenging == 'object') && (typeof domain.altmessenging.name == 'string') && (typeof domain.altmessenging.url == 'string')) { serverinfo.altmessenging = [{ name: domain.altmessenging.name, url: domain.altmessenging.url, localurl: domain.altmessenging.localurl, type: domain.altmessenging.type }]; }
            if (Array.isArray(domain.altmessenging)) { serverinfo.altmessenging = []; for (var i in domain.altmessenging) { if ((typeof domain.altmessenging[i] == 'object') && (typeof domain.altmessenging[i].name == 'string') && (typeof domain.altmessenging[i].url == 'string')) { serverinfo.altmessenging.push({ name: domain.altmessenging[i].name, url: domain.altmessenging[i].url, type: domain.altmessenging[i].type }); } } }
            serverinfo.https = true;
            serverinfo.redirport = args.redirport;
            if (parent.parent.webpush != null) { serverinfo.vapidpublickey = parent.parent.webpush.vapidPublicKey; } // Web push public key
            if (parent.parent.amtProvisioningServer != null) { serverinfo.amtProvServerMeshId = parent.parent.amtProvisioningServer.meshid; } // Device group that allows for bare-metal Intel AMT activation
            if ((typeof domain.autoremoveinactivedevices == 'number') && (domain.autoremoveinactivedevices > 0)) { serverinfo.autoremoveinactivedevices = domain.autoremoveinactivedevices; } // Default number of days before inactive devices are removed
            if (domain.passwordrequirements) {
                if (domain.passwordrequirements.lock2factor == true) { serverinfo.lock2factor = true; } // Indicate 2FA change are not allowed
                if (typeof domain.passwordrequirements.maxfidokeys == 'number') { serverinfo.maxfidokeys = domain.passwordrequirements.maxfidokeys; }
            }
            if (parent.parent.msgserver != null) { // Setup messaging providers information
                serverinfo.userMsgProviders = parent.parent.msgserver.providers;
                if (parent.parent.msgserver.discordUrl != null) { serverinfo.discordUrl = parent.parent.msgserver.discordUrl; }
            }
            if ((typeof parent.parent.config.messaging == 'object') && (typeof parent.parent.config.messaging.ntfy == 'object') && (typeof parent.parent.config.messaging.ntfy.userurl == 'string')) { // nfty user url
                serverinfo.userMsgNftyUrl = parent.parent.config.messaging.ntfy.userurl;
            }

            // Build the mobile agent URL, this is used to connect mobile devices
            var agentServerName = parent.getWebServerName(domain, req);
            if (typeof parent.args.agentaliasdns == 'string') { agentServerName = parent.args.agentaliasdns; }
            var xdomain = (domain.dns == null) ? domain.id : '';
            var agentHttpsPort = ((parent.args.aliasport == null) ? parent.args.port : parent.args.aliasport); // Use HTTPS alias port is specified
            if (parent.args.agentport != null) { agentHttpsPort = parent.args.agentport; } // If an agent only port is enabled, use that.
            if (parent.args.agentaliasport != null) { agentHttpsPort = parent.args.agentaliasport; } // If an agent alias port is specified, use that.
            serverinfo.magenturl = 'mc://' + agentServerName + ((agentHttpsPort != 443) ? (':' + agentHttpsPort) : '') + ((xdomain != '') ? ('/' + xdomain) : '');
            serverinfo.domainsuffix = xdomain;

            if (domain.guestdevicesharing === false) { serverinfo.guestdevicesharing = false; } else {
                if (typeof domain.guestdevicesharing == 'object') {
                    if (typeof domain.guestdevicesharing.maxsessiontime == 'number') { serverinfo.guestdevicesharingmaxtime = domain.guestdevicesharing.maxsessiontime; }
                }
            }
            if (typeof domain.userconsentflags == 'number') { serverinfo.consent = domain.userconsentflags; }
            if ((typeof domain.usersessionidletimeout == 'number') && (domain.usersessionidletimeout > 0)) { serverinfo.timeout = (domain.usersessionidletimeout * 60 * 1000); }
            if (user.siteadmin === SITERIGHT_ADMIN) {
                if (parent.parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) { serverinfo.manageAllDeviceGroups = true; }
                if (obj.crossDomain === true) { serverinfo.crossDomain = []; for (var i in parent.parent.config.domains) { serverinfo.crossDomain.push(i); } }
                if (typeof parent.webCertificateExpire[domain.id] == 'number') { serverinfo.certExpire = parent.webCertificateExpire[domain.id]; }
            }
            if (typeof domain.terminal == 'object') { // Settings used for remote terminal feature
                if ((typeof domain.terminal.linuxshell == 'string') && (domain.terminal.linuxshell != 'any')) { serverinfo.linuxshell = domain.terminal.linuxshell; }
            }
            if (Array.isArray(domain.preconfiguredremoteinput)) { serverinfo.preConfiguredRemoteInput = domain.preconfiguredremoteinput; }
            if (Array.isArray(domain.preconfiguredscripts)) {
                const r = [];
                for (var i in domain.preconfiguredscripts) {
                    const types = ['', 'bat', 'ps1', 'sh', 'agent']; // 1 = Windows Command, 2 = Windows PowerShell, 3 = Linux, 4 = Agent
                    const script = domain.preconfiguredscripts[i];
                    if ((typeof script.name == 'string') && (script.name.length <= 32) && (typeof script.type == 'string') && ((typeof script.file == 'string') || (typeof script.cmd == 'string'))) {
                        const s = { name: script.name, type: types.indexOf(script.type.toLowerCase()) };
                        if (s.type > 0) { r.push(s); }
                    }
                }
                serverinfo.preConfiguredScripts = r;
            }
            if (domain.maxdeviceview != null) { serverinfo.maxdeviceview = domain.maxdeviceview; } // Maximum number of devices a user can view at any given time

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
                db.GetFailedLoginCount(user._id, user.domain, new Date(lastLoginTime * 1000), function (count) {
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
    } catch (ex) { console.log(ex); }

    // Process incoming web socket data from the browser
    function processWebSocketData(msg) {
        var command, i = 0, mesh = null, meshid = null, nodeid = null, meshlinks = null, change = 0;
        try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
        if (common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

        var commandHandler = serverCommands[command.action];
        if (commandHandler != null) { 
            try { commandHandler(command); return; }
            catch (e) {
                console.log('Unhandled error while processing ' + command.action + ' for user ' + user.name + ':\n' + e);
                parent.parent.logError(e.stack); return; // todo: remove returns when switch is gone
            }
        } else { }
            // console.log('Unknown action from user ' + user.name + ': ' + command.action + '.');
            // pass through to switch statement until refactoring complete

        switch (command.action) {
            case 'nodes':
                {
                    // If in paging mode, look to set the skip and limit values
                    if (domain.maxdeviceview != null) {
                        if ((typeof command.skip == 'number') && (command.skip >= 0)) { obj.deviceSkip = command.skip; }
                        if ((typeof command.limit == 'number') && (command.limit > 0)) { obj.deviceLimit = command.limit; }
                        if (obj.deviceLimit > domain.maxdeviceview) { obj.deviceLimit = domain.maxdeviceview; }
                    }

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
                                extraids = getUserExtraIds();
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
                    db.GetAllTypeNoTypeFieldMeshFiltered(links, extraids, domain.id, 'node', command.id, obj.deviceSkip, obj.deviceLimit, function (err, docs) {

                        //console.log(err, docs, links, extraids, domain.id, 'node', command.id);

                        if (docs == null) { docs = []; }
                        parent.common.unEscapeAllLinksFieldName(docs);

                        var r = {}, nodeCount = docs.length;
                        if (domain.maxdeviceview != null) { obj.visibleDevices = {}; }
                        for (i in docs) {
                            // Check device links, if a link points to an unknown user, remove it.
                            parent.cleanDevice(docs[i]); // TODO: This will make the total device count incorrect and will affect device paging.

                            // If we are paging, add the device to the page here
                            if (domain.maxdeviceview != null) { obj.visibleDevices[docs[i]._id] = 1; }

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

                            // Remove SSH credentials if present
                            if (docs[i].ssh != null) {
                                if ((docs[i].ssh[obj.user._id] != null) && (docs[i].ssh[obj.user._id].u)) {
                                    if (docs[i].ssh.k && docs[i].ssh[obj.user._id].kp) { docs[i].ssh = 2; } // Username, key and password
                                    else if (docs[i].ssh[obj.user._id].k) { docs[i].ssh = 3; } // Username and key. No password.
                                    else if (docs[i].ssh[obj.user._id].p) { docs[i].ssh = 1; } // Username and password
                                    else { delete docs[i].ssh; }
                                } else {
                                    delete docs[i].ssh;
                                }
                            }

                            // Remove RDP credentials if present, only set to 1 if our userid has RDP credentials
                            if ((docs[i].rdp != null) && (docs[i].rdp[obj.user._id] != null)) { docs[i].rdp = 1; } else { delete docs[i].rdp; }

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

                            // Add IP-KVM sessions
                            if (parent.parent.ipKvmManager != null) {
                                const xipkvmport = parent.parent.ipKvmManager.managedPorts[docs[i]._id];
                                if ((xipkvmport != null) && (xipkvmport.sessions != null)) { docs[i].sessions = xipkvmport.sessions; }
                            }

                            r[meshid].push(docs[i]);
                        }
                        const response = { action: 'nodes', responseid: command.responseid, nodes: r, tag: command.tag };
                        if (domain.maxdeviceview != null) {
                            // If in paging mode, report back the skip and limit values
                            response.skip = obj.deviceSkip;
                            response.limit = obj.deviceLimit;

                            // Add total device count
                            // Only set response.totalcount if we need to be in paging mode
                            if (nodeCount < response.limit) {
                                if (obj.deviceSkip > 0) { response.totalcount = obj.deviceSkip + nodeCount; } else { obj.visibleDevices = null; }
                                try { ws.send(JSON.stringify(response)); } catch (ex) { }
                            } else {
                                // Ask the database for the total device count
                                if (db.CountAllTypeNoTypeFieldMeshFiltered) {
                                    db.CountAllTypeNoTypeFieldMeshFiltered(links, extraids, domain.id, 'node', command.id, function (err, count) {
                                        if ((err != null) || (typeof count != 'number') || ((obj.deviceSkip == 0) && (count < obj.deviceLimit))) {
                                            obj.visibleDevices = null;
                                        } else {
                                            response.totalcount = count;
                                        }
                                        try { ws.send(JSON.stringify(response)); } catch (ex) { }
                                    });
                                } else {
                                    // The database does not support device counting
                                    obj.visibleDevices = null; // We are not in paging mode
                                    try { ws.send(JSON.stringify(response)); } catch (ex) { }
                                }
                            }
                        } else {
                            obj.visibleDevices = null; // We are not in paging mode
                            try { ws.send(JSON.stringify(response)); } catch (ex) { }
                        }
                    });
                    break;
                }
            case 'fileoperation':
                {
                    // Check permissions
                    if ((user.siteadmin & 8) != 0) {
                        // Perform a file operation (Create Folder, Delete Folder, Delete File...)
                        if (common.validateString(command.fileop, 3, 16) == false) return;
                        var sendUpdate = true, path = meshPathToRealPath(command.path, user); // This will also check access rights
                        if (path == null) break;

                        if ((command.fileop == 'createfolder') && (common.IsFilenameValid(command.newfolder) == true)) {
                            // Create a new folder
                            try { fs.mkdirSync(parent.path.join(path, command.newfolder)); } catch (ex) {
                                try { fs.mkdirSync(path); } catch (ex) { }
                                try { fs.mkdirSync(parent.path.join(path, command.newfolder)); } catch (ex) { }
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
                            try { fs.renameSync(parent.path.join(path, command.oldname), parent.path.join(path, command.newname)); } catch (e) { }
                        }
                        else if ((command.fileop == 'copy') || (command.fileop == 'move')) {
                            // Copy or move of one or many files
                            if (common.validateArray(command.name, 1) == false) return;
                            var scpath = meshPathToRealPath(command.path, user); // This will also check access rights
                            if (scpath == null) break;
                            // TODO: Check quota if this is a copy
                            for (i in command.names) {
                                if (common.IsFilenameValid(command.names[i]) === true) {
                                    var s = parent.path.join(scpath, command.names[i]), d = parent.path.join(path, command.names[i]);
                                    sendUpdate = false;
                                    copyFile(s, d, function (op) { if (op != null) { fs.unlink(op, function (err) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); }); } else { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } }, ((command.fileop == 'move') ? s : null));
                                }
                            }
                        } else if (command.fileop == 'get') {
                            // Get a short file and send it back on the web socket
                            if (common.validateString(command.file, 1, 4096) == false) return;
                            const scpath = meshPathToRealPath(command.path, user); // This will also check access rights
                            if (scpath == null) break;
                            const filePath = parent.path.join(scpath, command.file);
                            fs.stat(filePath, function (err, stat) {
                                if ((err != null) || (stat == null) || (stat.size >= 204800)) return;
                                fs.readFile(filePath, function (err, data) {
                                    if ((err != null) || (data == null)) return;
                                    command.data = data.toString('base64');
                                    ws.send(JSON.stringify(command)); // Send the file data back, base64 encoded.
                                });
                            });
                        } else if (command.fileop == 'set') {
                            // Set a short file transfered on the web socket
                            if (common.validateString(command.file, 1, 4096) == false) return;
                            if (typeof command.data != 'string') return;
                            const scpath = meshPathToRealPath(command.path, user); // This will also check access rights
                            if (scpath == null) break;
                            const filePath = parent.path.join(scpath, command.file);
                            var data = null;
                            try { data = Buffer.from(command.data, 'base64'); } catch (ex) { return; }
                            fs.writeFile(filePath, data, function (err) { if (err == null) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } });
                        }
                        if (sendUpdate == true) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } // Fire an event causing this user to update this files
                    }
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
                    var requiredRights = null, requiredNonRights = null, routingOptions = null;

                    // Complete the nodeid if needed
                    if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }

                    // Check if getting / setting clipboard data is allowed
                    if ((command.type == 'getclip') && (domain.clipboardget == false)) { console.log('CG-EXIT'); break; }
                    if ((command.type == 'setclip') && (domain.clipboardset == false)) { console.log('CS-EXIT'); break; }

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

                        // If we are using the desktop multiplexor, remove the VIEWONLY limitation. The multiplexor will take care of enforcing that limitation when needed.
                        if (((parent.parent.config.settings.desktopmultiplex === true) || (domain.desktopmultiplex === true)) && (url.query.p == '2')) { routingOptions = { removeViewOnlyLimitation: true }; }

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
                            if ((typeof domain.consentmessages.consenttimeout == 'number') && (domain.consentmessages.consenttimeout > 0)) { command.soptions.consentTimeout = domain.consentmessages.consenttimeout; }
                            if (domain.consentmessages.autoacceptontimeout === true) { command.soptions.consentAutoAccept = true; }
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
                    routeCommandToNode(command, requiredRights, requiredNonRights, func, routingOptions);
                    break;
                }
            case 'events':
                {
                    // User filtered events
                    if ((command.userid != null) && ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0)) {
                        const userSplit = command.userid.split('/');
                        if ((userSplit.length != 3) || (userSplit[1] != domain.id)) return;

                        // TODO: Add the meshes command.userid has access to (???)
                        var filter = [command.userid];

                        if ((command.limit == null) || (typeof command.limit != 'number')) {
                            // Send the list of all events for this session
                            db.GetUserEvents(filter, domain.id, command.userid, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, userid: command.userid, tag: command.tag })); } catch (ex) { }
                            });
                        } else {
                            // Send the list of most recent events for this session, up to 'limit' count
                            db.GetUserEventsWithLimit(filter, domain.id, command.userid, command.limit, function (err, docs) {
                                if (err != null) return;
                                try { ws.send(JSON.stringify({ action: 'events', events: docs, userid: command.userid, tag: command.tag })); } catch (ex) { }
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
                    if (err != null) { try { ws.send(JSON.stringify({ action: 'recordings', error: 1, tag: command.tag })); } catch (ex) { } return; }
                    if ((command.limit == null) || (typeof command.limit != 'number')) {
                        // Send the list of all recordings
                        db.GetEvents(['recording'], domain.id, function (err, docs) {
                            if (err != null) { try { ws.send(JSON.stringify({ action: 'recordings', error: 2, tag: command.tag })); } catch (ex) { } return; }
                            for (var i in docs) {
                                delete docs[i].action; delete docs[i].etype; delete docs[i].msg; // TODO: We could make a more specific query in the DB and never have these.
                                if (files.indexOf(docs[i].filename) >= 0) { docs[i].present = 1; }
                            }
                            try { ws.send(JSON.stringify({ action: 'recordings', events: docs, tag: command.tag })); } catch (ex) { }
                        });
                    } else {
                        // Send the list of most recent recordings, up to 'limit' count
                        db.GetEventsWithLimit(['recording'], domain.id, command.limit, function (err, docs) {
                            if (err != null) { try { ws.send(JSON.stringify({ action: 'recordings', error: 2, tag: command.tag })); } catch (ex) { } return; }
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

                    db.Remove('ws' + deluser._id);  // Remove user web state
                    db.Remove('nt' + deluser._id);  // Remove notes for this user
                    db.Remove('ntp' + deluser._id); // Remove personal notes for this user
                    db.Remove('im' + deluser._id);  // Remove image for this user

                    // Delete any login tokens
                    parent.parent.db.GetAllTypeNodeFiltered(['logintoken-' + deluser._id], domain.id, 'logintoken', null, function (err, docs) {
                        if ((err == null) && (docs != null)) { for (var i = 0; i < docs.length; i++) { parent.parent.db.Remove(docs[i]._id, function () { }); } }
                    });

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
                        if ((command.msghandle != null) && (typeof command.msghandle == 'string')) {
                            if (command.msghandle.startsWith('callmebot:https://')) { const h = parent.parent.msgserver.callmebotUrlToHandle(command.msghandle.substring(10)); if (h) { command.msghandle = h; } else { command.msghandle = ''; } }
                            if (command.msghandle == '') { delete chguser.msghandle; } else { chguser.msghandle = command.msghandle; }
                            change = 1;
                        }
                        if ((command.flags != null) && (typeof command.flags == 'number')) {
                            // Flags: 1 = Account Image, 2 = Session Recording
                            if ((command.flags == 0) && (chguser.flags != null)) { delete chguser.flags; change = 1; } else { if (command.flags !== chguser.flags) { chguser.flags = command.flags; change = 1; } }
                        }
                        if ((command.removeRights != null) && (typeof command.removeRights == 'number')) {
                            if (command.removeRights == 0) {
                                if (chguser.removeRights != null) { delete chguser.removeRights; change = 1; }
                            } else {
                                if (command.removeRights !== chguser.removeRights) { chguser.removeRights = command.removeRights; change = 1; }
                            } 
                        }

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
                        try { ws.send(JSON.stringify({ action: 'usergroups', ugroups: groupCount ? groups : null, tag: command.tag })); } catch (ex) { }
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
                        // Check if we are in a mode that does not allow manual user group creation
                        if (
                            (typeof domain.authstrategies == 'object') &&
                            (typeof domain.authstrategies['oidc'] == 'object') &&
                            (typeof domain.authstrategies['oidc'].groups == 'object') &&
                            ((domain.authstrategies['oidc'].groups.sync == true) || ((typeof domain.authstrategies['oidc'].groups.sync == 'object') && (domain.authstrategies['oidc'].groups.sync.enabled == true)))
                        ) {
                            err = "Not allowed in OIDC mode with user group sync.";
                        }

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
                                            var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: xmesh._id, name: xmesh.name, mtype: xmesh.mtype, desc: xmesh.desc, action: 'meshchange', links: xmesh.links, msgid: 68, msgArgs: [ugrp.name, xmesh.name], msg: 'Added user group ' + ugrp.name + ' to device group ' + xmesh.name, domain: ugrpdomain.id, invite: xmesh.invite };
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

                        // Event the user group creation
                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugrpid, name: ugrp.name, desc: ugrp.desc, action: 'createusergroup', links: ugrp.links, msgid: 69, msgArgv: [ugrp.name], msg: 'User group created: ' + ugrp.name, ugrpdomain: domain.id };
                        parent.parent.DispatchEvent(['*', ugrpid, user._id], obj, event); // Even if DB change stream is active, this event must be acted upon.

                        // Event any pending events, these must be sent out after the group creation event is dispatched.
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
                    var delGroupDomain;
                    if (ugroupidsplit != null) {
                        delGroupDomain = parent.parent.config.domains[ugroupidsplit[1]];
                        if (delGroupDomain == null) { err = "Invalid domain id"; }
                    }

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

                        // If this user group is an externally managed user group, it can't be deleted unless there are no users in it.
                        if (group.membershipType != null) {
                            var userCount = 0;
                            if (group.links != null) { for (var i in group.links) { if (i.startsWith('user/')) { userCount++; } } }
                            if (userCount > 0) return;
                        }

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
                    change = '';
                    var group = parent.userGroups[command.ugrpid];
                    if (group != null) {
                        // If this user group is an externally managed user group, the name of the user group can't be edited
                        if ((group.membershipType == null) && (common.validateString(command.name, 1, 64) == true) && (command.name != group.name)) { change = 'User group name changed from "' + group.name + '" to "' + command.name + '"'; group.name = command.name; }
                        if ((common.validateString(command.desc, 0, 1024) == true) && (command.desc != group.desc)) { if (change != '') change += ' and description changed'; else change += 'User group "' + group.name + '" description changed'; group.desc = command.desc; }
                        if ((typeof command.consent == 'number') && (command.consent != group.consent)) { if (change != '') change += ' and consent changed'; else change += 'User group "' + group.name + '" consent changed'; group.consent = command.consent; }

                        if ((command.flags != null) && (typeof command.flags == 'number')) {
                            // Flags: 2 = Session Recording
                            if ((command.flags == 0) && (group.flags != null)) { delete group.flags; } else { if (command.flags !== group.flags) { group.flags = command.flags; } }
                            if (change == '') { change = 'User group features changed.'; }
                        }

                        if (change != '') {
                            db.Set(group);
                            var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, consent: ((group.consent == null) ? 0 : group.consent), action: 'usergroupchange', links: group.links, flags: group.flags, msg: change, domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                            parent.parent.DispatchEvent(['*', group._id, user._id], obj, event);
                        }
                    }
                    break;
                }
            case 'changemeshnotify':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    //   2 = WebPage device connections
                    //   4 = WebPage device disconnections
                    //   8 = WebPage device desktop and serial events
                    //  16 = Email device connections
                    //  32 = Email device disconnections
                    //  64 = Email device help request
                    // 128 = Messaging device connections
                    // 256 = Messaging device disconnections
                    // 512 = Messaging device help request

                    var err = null;
                    try {
                        // Change the current user's notification flags for a meshid
                        if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid group identifier'; } // Check the meshid
                        else if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                        if (common.validateInt(command.notify) == false) { err = 'Invalid notification flags'; }
                        if (parent.IsMeshViewable(user, command.meshid) == false) err = 'Access denied';
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changemeshnotify', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                    // Change the device group notification
                    if (user.links == null) { user.links = {}; }
                    if (user.links[command.meshid]) {
                        // The user has direct rights for this device group
                        if (command.notify == 0) {
                            delete user.links[command.meshid].notify;
                        } else {
                            user.links[command.meshid].notify = command.notify;
                        }
                    }

                    // Change user notification if needed, this is needed then a user has device rights thru a user group
                    if ((command.notify == 0) && (user.notify != null) && (user.notify[command.meshid] != null)) { delete user.notify[command.meshid]; }
                    if ((command.notify != 0) && (user.links[command.meshid] == null)) { if (user.notify == null) { user.notify = {} } user.notify[command.meshid] = command.notify; }

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
            case 'changeusernotify':
                {
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    //   2 = WebPage device connections
                    //   4 = WebPage device disconnections
                    //   8 = WebPage device desktop and serial events
                    //  16 = Email device connections
                    //  32 = Email device disconnections
                    //  64 = Email device help request
                    // 128 = Messaging device connections
                    // 256 = Messaging device disconnections
                    // 512 = Messaging device help request

                    var err = null;
                    try {
                        // Change the current user's notification flags for a meshid
                        if (common.validateString(command.nodeid, 1, 1024) == false) { err = 'Invalid device identifier'; } // Check the meshid
                        else if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                        if (common.validateInt(command.notify) == false) { err = 'Invalid notification flags'; }
                        //if (parent.IsMeshViewable(user, command.nodeid) == false) err = 'Access denied';
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeusernotify', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                    // Check if nothing has changed
                    if ((user.notify == null) && (command.notify == 0)) return;
                    if ((user.notify != null) && (user.notify[command.nodeid] == command.notify)) return;

                    // Change the notification
                    if (user.notify == null) { user.notify = {}; }
                    if (command.notify == 0) { delete user.notify[command.nodeid]; } else { user.notify[command.nodeid] = command.notify; }
                    if (Object.keys(user.notify).length == 0) { delete user.notify; }

                    // Save the user
                    parent.db.SetUser(user);

                    // Notify change
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 130, msg: 'User notifications changed', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);

                    break;
                }
            case 'changepassword':
                {
                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    // If this account is settings locked, return here.
                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;
                    
                    // Do not allow change password if sspi or ldap
                    if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) return;
                    
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
                                delete chguser.passtype;      // Remove the password type if one was present.
                                if (command.removeMultiFactor === true) {
                                    delete chguser.otpkeys;   // One time backup codes
                                    delete chguser.otpsecret; // OTP Google Authenticator
                                    delete chguser.otphkeys;  // FIDO keys
                                    delete chguser.otpekey;   // Email 2FA
                                    delete chguser.phone;     // SMS 2FA
                                    delete chguser.otpdev;    // Push notification 2FA
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
                            var url = "https://" + parent.getWebServerName(domain, req) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.userid) + "/" + encodeURIComponent(user._id);

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
                        var url = "https://" + parent.getWebServerName(domain, req) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.nodeid) + "/" + encodeURIComponent(user._id);

                        // Open a web page on the remote device
                        routeCommandToNode({ 'action': 'openUrl', 'nodeid': command.nodeid, 'userid': user._id, 'username': user.name, 'url': url });
                    });
                    break;
                }
            case 'createmesh':
                {
                    var err = null;
                    try {
                        // Support for old web pages that sent the meshtype as a string.
                        if (typeof command.meshtype == 'string') { command.meshtype = parseInt(command.meshtype); }

                        // Check if we have new group restriction
                        if ((user.siteadmin != SITERIGHT_ADMIN) && ((user.siteadmin & 64) != 0)) { err = 'Permission denied'; }

                        // In some situations, we need a verified email address to create a device group.
                        else if ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (user.emailVerified !== true) && (user.siteadmin != SITERIGHT_ADMIN)) { err = 'Email verification required'; } // User must verify it's email first.

                        // Create mesh
                        else if (common.validateString(command.meshname, 1, 128) == false) { err = 'Invalid group name'; } // Meshname is between 1 and 128 characters
                        else if ((command.desc != null) && (common.validateString(command.desc, 0, 1024) == false)) { err = 'Invalid group description'; } // Mesh description is between 0 and 1024 characters
                        else if ((command.meshtype < 1) || (command.meshtype > 4)) { err = 'Invalid group type'; } // Device group types are 1 = AMT, 2 = Agent, 3 = Local
                        else if (((command.meshtype == 3) || (command.meshtype == 4)) && (parent.args.wanonly == true) && (typeof command.relayid != 'string')) { err = 'Invalid group type'; } // Local device group type wihtout relay is not allowed in WAN mode
                        else if (((command.meshtype == 3) || (command.meshtype == 4)) && (parent.args.lanonly == true) && (typeof command.relayid == 'string')) { err = 'Invalid group type'; } // Local device group type with relay is not allowed in WAN mode
                        else if ((domain.ipkvm == null) && (command.meshtype == 4)) { err = 'Invalid group type'; } // IP KVM device group type is not allowed unless enabled
                        if ((err == null) && (command.meshtype == 4)) {
                            if ((command.kvmmodel < 1) || (command.kvmmodel > 2)) { err = 'Invalid KVM model'; }
                            else if (common.validateString(command.kvmhost, 1, 128) == false) { err = 'Invalid KVM hostname'; }
                            else if (common.validateString(command.kvmuser, 1, 128) == false) { err = 'Invalid KVM username'; }
                            else if (common.validateString(command.kvmpass, 1, 128) == false) { err = 'Invalid KVM password'; }
                        }
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

                        // Add KVM information if needed
                        if (command.meshtype == 4) { mesh.kvm = { model: command.kvmmodel, host: command.kvmhost, user: command.kvmuser, pass: command.kvmpass }; }

                        // If this is device group that requires a relay device, store that now
                        if ((parent.args.lanonly != true) && ((command.meshtype == 3) || (command.meshtype == 4)) && (typeof command.relayid == 'string')) {
                            // Check the relay id
                            var relayIdSplit = command.relayid.split('/');
                            if ((relayIdSplit[0] == 'node') && (relayIdSplit[1] == domain.id)) { mesh.relayid = command.relayid; }
                        }

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
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: meshid, mtype: command.meshtype, mesh: parent.CloneSafeMesh(mesh), action: 'createmesh', msgid: 76, msgArgs: [command.meshname], msg: 'Device group created: ' + command.meshname, domain: domain.id };
                        parent.parent.DispatchEvent(['*', 'server-createmesh', meshid, user._id], obj, event); // Even if DB change stream is active, this event must be acted upon.

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created device group ' + mesh.name); }

                        try { ws.send(JSON.stringify({ action: 'createmesh', responseid: command.responseid, result: 'ok', meshid: meshid, links: links })); } catch (ex) { }

                        // If needed, event that a device is now a device group relay
                        if (mesh.relayid != null) {
                            // Get the node and the rights for this node
                            parent.GetNodeWithRights(domain, user, mesh.relayid, function (node, rights, visible) {
                                if (node == null) return;
                                var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Is a relay for ' + mesh.name + '.', msgid: 153, msgArgs: [mesh.name], node: parent.CloneSafeNode(node) };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                                parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                            });
                        }
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
                        if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid group identifier'; } // Check the meshid
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
                    var event = { etype: 'mesh', userid: user._id, username: user.name, mtype: mesh.mtype, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msgid: 77, msgArgs: [command.meshname], msg: 'Device group deleted: ' + command.meshname, domain: domain.id };
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, ['server-deletemesh']), obj, event); // Even if DB change stream is active, this event need to be acted on.

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

                    // Delete any invitation codes
                    delete mesh.invite;

                    // Delete all files on the server for this mesh
                    try {
                        var meshpath = parent.getServerRootFilePath(mesh);
                        if (meshpath != null) { parent.deleteFolderRec(meshpath); }
                    } catch (e) { }

                    parent.parent.RemoveEventDispatchId(command.meshid); // Remove all subscriptions to this mesh

                    // Notify the devices that they have changed relay roles
                    if (mesh.relayid != null) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, mesh.relayid, function (node, rights, visible) {
                            if (node == null) return;
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'No longer a relay for ' + mesh.name + '.', msgid: 152, msgArgs: [mesh.name], node: parent.CloneSafeNode(node) };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        });
                    }

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
                        if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid group identifier'; } // Check the meshid
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

                    var changesids = [];
                    if ((common.validateString(command.meshname, 1, 128) == true) && (command.meshname != mesh.name)) { change = 'Device group name changed from "' + mesh.name + '" to "' + command.meshname + '"'; changesids.push(1); mesh.name = command.meshname; }
                    if ((common.validateString(command.desc, 0, 1024) == true) && (command.desc != mesh.desc)) { if (change != '') change += ' and description changed'; else change += 'Device group "' + mesh.name + '" description changed'; changesids.push(2); mesh.desc = command.desc; }
                    if ((common.validateInt(command.flags) == true) && (command.flags != mesh.flags)) { if (change != '') change += ' and flags changed'; else change += 'Device group "' + mesh.name + '" flags changed'; changesids.push(3); mesh.flags = command.flags; }
                    if ((common.validateInt(command.consent) == true) && (command.consent != mesh.consent)) { if (change != '') change += ' and consent changed'; else change += 'Device group "' + mesh.name + '" consent changed'; changesids.push(4); mesh.consent = command.consent; }
                    if ((common.validateInt(command.expireDevs, 0, 2000) == true) && (command.expireDevs != mesh.expireDevs)) { if (change != '') change += ' and auto-remove changed'; else change += 'Device group "' + mesh.name + '" auto-remove changed'; changesids.push(5); if (command.expireDevs == 0) { delete mesh.expireDevs; } else { mesh.expireDevs = command.expireDevs; } }

                    var oldRelayNodeId = null, newRelayNodeId = null;
                    if ((typeof command.relayid == 'string') && ((mesh.mtype == 3) || (mesh.mtype == 4)) && (mesh.relayid != null) && (command.relayid != mesh.relayid)) {
                        var relayIdSplit = command.relayid.split('/');
                        if ((relayIdSplit.length == 3) && (relayIdSplit[0] = 'node') && (relayIdSplit[1] == domain.id)) {
                            if (change != '') { change += ' and device relay changed'; } else { change = 'Device relay changed'; }
                            changesids.push(7);
                            oldRelayNodeId = mesh.relayid;
                            newRelayNodeId = mesh.relayid = command.relayid;
                        }
                    }

                    // See if we need to change device group invitation codes
                    if (mesh.mtype == 2) {
                        if (command.invite === '*') {
                            // Clear invite codes
                            if (mesh.invite != null) { delete mesh.invite; }
                            if (change != '') { change += ' and invite code changed'; } else { change += 'Device group "' + mesh.name + '" invite code changed'; }
                            changesids.push(6);
                        } else if ((typeof command.invite == 'object') && (Array.isArray(command.invite.codes)) && (typeof command.invite.flags == 'number')) {
                            // Set invite codes
                            if ((mesh.invite == null) || (mesh.invite.codes != command.invite.codes) || (mesh.invite.flags != command.invite.flags)) {
                                // Check if an invite code is not already in use.
                                var dup = null;
                                for (var i in command.invite.codes) {
                                    for (var j in parent.meshes) {
                                        if ((j != command.meshid) && (parent.meshes[j].deleted == null) && (parent.meshes[j].domain == domain.id) && (parent.meshes[j].invite != null) && (parent.meshes[j].invite.codes.indexOf(command.invite.codes[i]) >= 0)) { dup = command.invite.codes[i]; break; }
                                    }
                                }
                                if (dup != null) {
                                    // A duplicate was found, don't allow this change.
                                    displayNotificationMessage("Error, invite code \"" + dup + "\" already in use.", "Invite Codes", null, 6, 22, [dup]);
                                    return;
                                }
                                mesh.invite = { codes: command.invite.codes, flags: command.invite.flags };
                                if (typeof command.invite.ag == 'number') { mesh.invite.ag = command.invite.ag; }
                                if (change != '') { change += ' and invite code changed'; } else { change += 'Device group "' + mesh.name + '" invite code changed'; }
                                changesids.push(6);
                            }
                        }
                    }

                    if (change != '') {
                        db.Set(mesh);
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, flags: mesh.flags, consent: mesh.consent, action: 'meshchange', links: mesh.links, msgid: 142, msgArgs: [mesh.name, changesids], msg: change, domain: domain.id, invite: mesh.invite, expireDevs: command.expireDevs, relayid: mesh.relayid };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id, 'server-editmesh']), obj, event);
                    }

                    // Notify the devices that they have changed relay roles
                    if (oldRelayNodeId != null) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, oldRelayNodeId, function (node, rights, visible) {
                            if (node == null) return;
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'No longer a relay for ' + mesh.name + '.', msgid: 152, msgArgs: [mesh.name], node: parent.CloneSafeNode(node) };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        });
                    }
                    if (newRelayNodeId != null) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, newRelayNodeId, function (node, rights, visible) {
                            if (node == null) return;
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Is a relay for ' + mesh.name + '.', msgid: 153, msgArgs: [mesh.name], node: parent.CloneSafeNode(node) };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        });
                    } else if ((mesh.relayid != null) && (changesids.indexOf(1) >= 0)) {
                        // Notify of node name change, get the node and the rights for this node, we just want to trigger a device update.
                        parent.GetNodeWithRights(domain, user, mesh.relayid, function (node, rights, visible) {
                            if (node == null) return;
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, node: parent.CloneSafeNode(node), nolog: 1 };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        });
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'editmesh', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
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
                        if (common.validateString(command.userid, 8, 1024) == false) { err = "Invalid userid"; } // Check userid
                        if (common.validateString(command.meshid, 8, 134) == false) { err = "Invalid groupid"; } // Check meshid
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
                    if (common.validateString(command.meshid, 8, 134) == false) break; // Check the meshid
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
                    if (mesh) {
                        // Check if this user has rights to do this
                        if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // TODO: Check if this is a change from the existing policy

                        // Perform the Intel AMT policy change
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
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, amt: amtpolicy2, action: 'meshchange', links: mesh.links, msgid: 141, msg: "Intel(r) AMT policy change", domain: domain.id, invite: mesh.invite };
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
            case 'addlocaldevice':
                {
                    if (common.validateString(command.meshid, 8, 134) == false) break; // Check meshid
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    if (common.validateString(command.devicename, 1, 256) == false) break; // Check device name
                    if (common.validateString(command.hostname, 1, 256) == false) break; // Check hostname
                    if (typeof command.type != 'number') break; // Type must be a number
                    if ((command.type != 4) && (command.type != 6) && (command.type != 29)) break; // Check device type

                    // Get the mesh
                    mesh = parent.meshes[command.meshid];
                    if (mesh) {
                        if (mesh.mtype != 3) return; // This operation is only allowed for mesh type 3, local device agentless mesh.

                        // Check if this user has rights to do this
                        if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_MANAGECOMPUTERS) == 0) return;

                        // Create a new nodeid
                        parent.crypto.randomBytes(48, function (err, buf) {
                            // Create the new node
                            nodeid = 'node/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            var device = { type: 'node', _id: nodeid, meshid: command.meshid, mtype: 3, icon: 1, name: command.devicename, host: command.hostname, domain: domain.id, agent: { id: command.type, caps: 0 } };
                            db.Set(device);

                            // Event the new node
                            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, [nodeid]), obj, { etype: 'node', userid: user._id, username: user.name, action: 'addnode', node: parent.CloneSafeNode(device), msgid: 84, msgArgs: [command.devicename, mesh.name], msg: 'Added device ' + command.devicename + ' to device group ' + mesh.name, domain: domain.id });
                        });
                    }

                    break;
                }
            case 'addamtdevice':
                {
                    if (args.wanonly == true) return; // This is a WAN-only server, local Intel AMT computers can't be added
                    if (common.validateString(command.meshid, 8, 134) == false) break; // Check meshid
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
                            // Create the new node
                            nodeid = 'node/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            var device = { type: 'node', _id: nodeid, meshid: command.meshid, mtype: 1, icon: 1, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: command.amttls } };

                            // Add optional feilds
                            if (common.validateInt(command.state, 0, 3)) { device.intelamt.state = command.state; }
                            if (common.validateString(command.ver, 1, 16)) { device.intelamt.ver = command.ver; }
                            if (common.validateString(command.hash, 1, 256)) { device.intelamt.hash = command.hash; }
                            if (common.validateString(command.realm, 1, 256)) { device.intelamt.realm = command.realm; }

                            // Save the device to the database
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
                        if (common.validateString(command.meshid, 8, 134) == false) { err = "Invalid groupid"; } // Check meshid
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

                    // This is to change device guest sharing to the new device group
                    var changeDeviceShareMeshIdNodeCount = command.nodeids.length;
                    var changeDeviceShareMeshIdNodeList = [];

                    // For each nodeid, change the group
                    for (var i = 0; i < command.nodeids.length; i++) {
                        var xnodeid = command.nodeids[i];
                        if (xnodeid.indexOf('/') == -1) { xnodeid = 'node/' + domain.id + '/' + xnodeid; }

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, xnodeid, function (node, rights, visible) {
                            // Check if we found this device
                            if (node == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device not found' })); } catch (ex) { } } changeDeviceShareMeshIdNodeCount--; return; }

                            // Check if already in the right mesh
                            if (node.meshid == command.meshid) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device already in correct group' })); } catch (ex) { } } changeDeviceShareMeshIdNodeCount--; return; }

                            // Make sure both source and target mesh are the same type
                            try { if (parent.meshes[node.meshid].mtype != parent.meshes[command.meshid].mtype) { changeDeviceShareMeshIdNodeCount--; return; } } catch (e) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Device groups are of different types' })); } catch (ex) { } }
                                changeDeviceShareMeshIdNodeCount--;
                                return;
                            };

                            // Make sure that we have rights on both source and destination mesh
                            const targetMeshRights = parent.GetMeshRights(user, command.meshid);
                            if (((rights & MESHRIGHT_EDITMESH) == 0) || ((targetMeshRights & MESHRIGHT_EDITMESH) == 0)) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeDeviceMesh', responseid: command.responseid, result: 'Permission denied' })); } catch (ex) { } }
                                changeDeviceShareMeshIdNodeCount--;
                                return;
                            }

                            // Perform the switch, start by saving the node with the new meshid.
                            changeDeviceShareMeshIdNodeList.push(node._id);
                            changeDeviceShareMeshIdNodeCount--;
                            if (changeDeviceShareMeshIdNodeCount == 0) { changeDeviceShareMeshId(changeDeviceShareMeshIdNodeList, command.meshid); }
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

                            // Update lastconnect meshid for this node
                            db.Get('lc' + node._id, function (err, xnodes) {
                                if ((xnodes != null) && (xnodes.length == 1) && (xnodes[0].meshid != command.meshid)) { xnodes[0].meshid = command.meshid; db.Set(xnodes[0]); }
                            });

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
                            db.Remove('al' + node._id);                          // Remove error log last time
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

                    // Send response if required, in this case we always send ok which is not ideal.
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removedevices', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }

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
                        if (common.validateString(nodeid, 8, 128) == false) { // Check the nodeid
                            if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'Invalid nodeid' })); } catch (ex) { } }
                            continue;
                        }
                        else if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
                        else if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) { // Invalid domain, operation only valid for current domain
                            if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'Invalid domain' })); } catch (ex) { } }
                            continue;
                        }

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                            // Check we have the rights to wake this device
                            if ((node == null) || (visible == false) || (rights & MESHRIGHT_WAKEDEVICE) == 0) {
                                if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'Invalid nodeid' })); } catch (ex) { } }
                                return;
                            }

                            // If this device is connected on MQTT, send a wake action.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.publish(node._id, 'powerAction', 'wake'); }

                            // If this is a IP-KVM or Power Distribution Unit (PDU), dispatch an action event
                            if (node.mtype == 4) {
                                // Send out an event to perform turn off command on the port
                                const targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['devport-operation', 'server-users', user._id]);
                                const event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'turnon', domain: domain.id, portid: node.portid, porttype: node.porttype, portnum: node.portnum, meshid: node.meshid, mtype: node.mtype, msgid: 132, msg: "Turn on." };
                                parent.parent.DispatchEvent(targets, obj, event);
                                return;
                            }

                            // Get the device interface information
                            db.Get('if' + node._id, function (err, nodeifs) {
                                if ((nodeifs != null) && (nodeifs.length == 1)) {
                                    var macs = [], nodeif = nodeifs[0];
                                    if (nodeif.netif) {
                                        for (var j in nodeif.netif) { if (nodeif.netif[j].mac && (nodeif.netif[j].mac != '00:00:00:00:00:00') && (macs.indexOf(nodeif.netif[j].mac) == -1)) { macs.push(nodeif.netif[j].mac); } }
                                    } else if (nodeif.netif2) {
                                        for (var j in nodeif.netif2) { for (var k in nodeif.netif2[j]) { if (nodeif.netif2[j][k].mac && (nodeif.netif2[j][k].mac != '00:00:00:00:00:00') && (macs.indexOf(nodeif.netif2[j][k].mac) == -1)) { macs.push(nodeif.netif2[j][k].mac); } } }
                                    }
                                    if (macs.length == 0) {
                                        if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'No known MAC addresses for this device' })); } catch (ex) { } }
                                        return;
                                    }

                                    // Have the server send a wake-on-lan packet (Will not work in WAN-only)
                                    if (parent.parent.meshScanner != null) { parent.parent.meshScanner.wakeOnLan(macs, node.host); }

                                    // Get the list of device groups this user as wake permissions on
                                    var targets = [], targetDeviceGroups = parent.GetAllMeshWithRights(user, MESHRIGHT_WAKEDEVICE);
                                    for (j in targetDeviceGroups) { targets.push(targetDeviceGroups[j]._id); }
                                    for (j in user.links) { if ((j.startsWith('node/')) && (typeof user.links[j].rights == 'number') && ((user.links[j].rights & MESHRIGHT_WAKEDEVICE) != 0)) { targets.push(j); } }

                                    // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                    var wakeCount = 0;
                                    for (j in parent.wsagents) {
                                        var agent = parent.wsagents[j];
                                        if ((agent.authenticated == 2) && ((targets.indexOf(agent.dbMeshKey) >= 0) || (targets.indexOf(agent.dbNodeKey) >= 0))) {
                                            //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                            try { agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs })); wakeCount++; } catch (ex) { }
                                        }
                                    }
                                    if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'Used ' + wakeCount + ' device(s) to send wake packets' })); } catch (ex) { } }
                                } else {
                                    if (command.nodeids.length == 1) { try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'No network information for this device' })); } catch (ex) { } }
                                }
                            });
                        });

                        if (command.nodeids.length > 1) {
                            // If we are waking multiple devices, confirm we got the command.
                            try { ws.send(JSON.stringify({ action: 'wakedevices', responseid: command.responseid, result: 'ok' })); } catch (ex) { }
                        }
                    }
                    break;
                }
            case 'runcommands':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    if (typeof command.presetcmd != 'number') {
                        if (typeof command.type != 'number') break; // Check command type
                        if (typeof command.runAsUser != 'number') { command.runAsUser = 0; } // Check runAsUser
                    }

                    const processRunCommand = function (command) {
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

                                if (command.type == 4) {
                                    // This is an agent console command

                                    // Check we have the rights to run commands on this device, MESHRIGHT_REMOTECONTROL & MESHRIGHT_AGENTCONSOLE are needed
                                    if ((rights & 24) != 24) {
                                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                                        return;
                                    }

                                    // Send the commands to the agent
                                    var agent = parent.wsagents[node._id];
                                    if ((agent != null) && (agent.authenticated == 2) && (agent.agentInfo != null)) {
                                        try { agent.send(JSON.stringify({ action: 'msg', type: 'console', value: command.cmds, rights: rights, sessionid: ws.sessionId })); } catch (ex) { }
                                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'OK' })); } catch (ex) { } }
                                    } else {
                                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'runcommands', responseid: command.responseid, result: 'Agent not connected' })); } catch (ex) { } }
                                    }
                                } else {
                                    // This is a standard (bash/shell/powershell) command.

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
                                }
                            });
                        }
                    }

                    if (typeof command.presetcmd == 'number') {
                        // If a pre-set command is used, load the command
                        if (Array.isArray(domain.preconfiguredscripts) == false) return;
                        const script = domain.preconfiguredscripts[command.presetcmd];
                        if (script == null) return;
                        delete command.presetcmd;

                        // Decode script type
                        const types = ['', 'bat', 'ps1', 'sh', 'agent']; // 1 = Windows Command, 2 = Windows PowerShell, 3 = Linux, 4 = Agent
                        if (typeof script.type == 'string') { const stype = types.indexOf(script.type.toLowerCase()); if (stype > 0) { command.type = stype; } }
                        if (command.type == null) return;

                        // Decode script runas
                        if (command.type != 4) {
                            const runAsModes = ['agent', 'userfirst', 'user']; // 0 = AsAgent, 1 = UserFirst, 2 = UserOnly
                            if (typeof script.runas == 'string') { const srunas = runAsModes.indexOf(script.runas.toLowerCase()); if (srunas >= 0) { command.runAsUser = srunas; } }
                        }

                        if (typeof script.file == 'string') {
                            // The pre-defined script commands are in a file, load it
                            const scriptPath = parent.common.joinPath(parent.parent.datapath, script.file);
                            fs.readFile(scriptPath, function (err, data) {
                                // If loaded correctly, run loaded commands
                                if ((err != null) || (data == null) || (data.length == 0) || (data.length > 65535)) return;
                                command.cmds = data.toString();
                                processRunCommand(command);
                            });
                        } else if (typeof script.cmd == 'string') {
                            // The pre-defined script commands are right in the config.json, use that
                            command.cmds = script.cmd;
                            processRunCommand(command);
                        }
                    } else if (typeof command.cmdpath == 'string') {
                        // If a server command path is used, load the script from the path
                        var file = parent.getServerFilePath(user, domain, command.cmdpath);
                        if (file != null) {
                            fs.readFile(file.fullpath, function (err, data) {
                                // If loaded correctly, run loaded commands
                                if ((err != null) || (data == null) || (data.length == 0) || (data.length > 65535)) return;
                                command.cmds = data.toString();
                                delete command.cmdpath;
                                processRunCommand(command);
                            });
                        }
                    } else if (typeof command.cmds == 'string') {
                        // Run provided commands
                        if (command.cmds.length > 65535) return;
                        processRunCommand(command);
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
                    if (common.validateInt(command.actiontype, 2, 401) == false) break; // Check actiontype
                    for (i in command.nodeids) {
                        var nodeid = command.nodeids[i];

                        // Argument validation
                        if (common.validateString(nodeid, 8, 128) == false) { continue; } // Check the nodeid
                        else if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
                        else if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) { continue; } // Invalid domain, operation only valid for current domain

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                            if ((command.actiontype >= 400) && ((rights & MESHRIGHT_REMOTECONTROL) != 0)) {
                                // Flash and vibrate
                                if ((command.actiontype == 400) && common.validateInt(command.time, 1, 30000)) { routeCommandToNode({ action: 'msg', type: 'console', nodeid: node._id, value: 'flash ' + command.time }, MESHRIGHT_ADMIN, 0); }
                                if ((command.actiontype == 401) && common.validateInt(command.time, 1, 30000)) { routeCommandToNode({ action: 'msg', type: 'console', nodeid: node._id, value: 'vibrate ' + command.time }, MESHRIGHT_ADMIN, 0); }
                            } else {
                                // Check we have the rights to perform this operation
                                if ((command.actiontype == 302) && ((rights & MESHRIGHT_WAKEDEVICE) == 0)) return; // This is a Intel AMT power on operation, check if we have WAKE rights
                                if ((command.actiontype != 302) && ((rights & MESHRIGHT_RESETOFF) == 0)) return; // For all other operations, check that we have RESET/OFF rights

                                // If this device is connected on MQTT, send a power action.
                                if ((parent.parent.mqttbroker != null) && (command.actiontype >= 0) && (command.actiontype <= 4)) { parent.parent.mqttbroker.publish(node._id, 'powerAction', ['', '', 'poweroff', 'reset', 'sleep'][command.actiontype]); }

                                // If this is a IP-KVM or Power Distribution Unit (PDU), dispatch an action event
                                if (node.mtype == 4) {
                                    // Send out an event to perform turn off command on the port
                                    const targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['devport-operation', 'server-users', user._id]);
                                    const event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'turnoff', domain: domain.id, portid: node.portid, porttype: node.porttype, portnum: node.portnum, meshid: node.meshid, mtype: node.mtype, msgid: 133, msg: "Turn off." };
                                    parent.parent.DispatchEvent(targets, obj, event);
                                    return;
                                }

                                if ((command.actiontype >= 300) && (command.actiontype < 400)) {
                                    if ((command.actiontype != 302) && (command.actiontype != 308) && (command.actiontype < 310) && (command.actiontype > 312)) return; // Invalid action type.
                                    // Intel AMT power command, actiontype: 2 = Power on, 8 = Power down, 10 = reset, 11 = Power on to BIOS, 12 = Reset to BIOS, 13 = Power on to BIOS with SOL, 14 = Reset to BIOS with SOL
                                    parent.parent.DispatchEvent('*', obj, { action: 'amtpoweraction', userid: user._id, username: user.name, nodeids: [node._id], domain: domain.id, nolog: 1, actiontype: command.actiontype - 300 });
                                } else {
                                    if ((command.actiontype < 2) && (command.actiontype > 4)) return; // Invalid action type.
                                    // Mesh Agent power command, get this device and send the power command
                                    const agent = parent.wsagents[node._id];
                                    if (agent != null) {
                                        try { agent.send(JSON.stringify({ action: 'poweraction', actiontype: command.actiontype, userid: user._id, username: user.name, remoteaddr: req.clientIp })); } catch (ex) { }
                                    }
                                }
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

                    // Check the title, if needed, use a default one
                    if (common.validateString(command.title, 1, 512) == false) { delete command.title } // Check title
                    if ((command.title == null) && (typeof domain.notificationmessages == 'object') && (typeof domain.notificationmessages.title == 'string')) { command.title = domain.notificationmessages.title; }
                    if ((command.title == null) && (typeof domain.title == 'string')) { command.title = domain.title; }
                    if (command.title == null) { command.title = "MeshCentral"; }

                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to notify this device
                            if ((rights & MESHRIGHT_CHATNOTIFY) == 0) {
                                if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'toast', responseid: command.responseid, result: 'Access Denied' })); } catch (ex) { } }
                                return;
                            }

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
            case 'changedevice':
                {
                    var err = null;

                    // Argument validation
                    try {
                        if (common.validateString(command.nodeid, 1, 1024) == false) { err = "Invalid nodeid"; } // Check nodeid
                        else {
                            if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                            if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) { err = "Invalid nodeid"; } // Invalid domain, operation only valid for current domain
                            else if ((command.userloc) && (command.userloc.length != 2) && (command.userloc.length != 0)) { err = "Invalid user location"; }
                        }
                    } catch (ex) { console.log(ex); err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changedevice', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if ((rights & MESHRIGHT_MANAGECOMPUTERS) == 0) {
                            if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changedevice', responseid: command.responseid, result: 'Access Denied' })); } catch (ex) { } }
                            return;
                        }
                        var mesh = parent.meshes[node.meshid], amtchange = 0;

                        // Ready the node change event
                        var changes = [], event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id };
                        change = 0;
                        event.msg = ': ';

                        // If we are in WAN-only mode, host is not used
                        if ((args.wanonly == true) && (command.host) && (node.mtype != 3) && (node.mtype != 4)) { delete command.host; }

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

                        if ((typeof command.sshport == 'number') && (command.sshport > 0) && (command.sshport < 65536)) {
                            if ((command.sshport == 22) && (node.sshport != null)) {
                                delete node.sshport; change = 1; changes.push('sshport'); // Delete the SSH port
                            } else {
                                node.sshport = command.sshport; change = 1; changes.push('sshport'); // Set the SSH port
                            }
                        }

                        if ((typeof command.httpport == 'number') && (command.httpport > 0) && (command.httpport < 65536)) {
                            if ((command.httpport == 80) && (node.httpport != null)) {
                                delete node.httpport; change = 1; changes.push('httpport'); // Delete the HTTP port
                            } else {
                                node.httpport = command.httpport; change = 1; changes.push('httpport'); // Set the HTTP port
                            }
                        }

                        if ((typeof command.httpsport == 'number') && (command.httpsport > 0) && (command.httpsport < 65536)) {
                            if ((command.httpsport == 443) && (node.httpsport != null)) {
                                delete node.httpsport; change = 1; changes.push('httpsport'); // Delete the HTTPS port
                            } else {
                                node.httpsport = command.httpsport; change = 1; changes.push('httpsport'); // Set the HTTPS port
                            }
                        }

                        if ((typeof command.ssh == 'number') && (command.ssh == 0)) {
                            if ((node.ssh != null) && (node.ssh[user._id] != null)) { delete node.ssh[user._id]; change = 1; changes.push('ssh'); } // Delete the SSH cendentials
                        }

                        if ((typeof command.rdp == 'number') && (command.rdp == 0)) {
                            if ((node.rdp != null) && (node.rdp[user._id] != null)) { delete node.rdp[user._id]; change = 1; changes.push('rdp'); } // Delete the RDP cendentials
                        }

                        // Clean up any legacy RDP and SSH credentials
                        if (node.rdp != null) { delete node.rdp.d; delete node.rdp.u; delete node.rdp.p; }
                        if (node.ssh != null) { delete node.ssh.u; delete node.ssh.p; delete node.ssh.k; delete node.ssh.kp; }

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
                            if ((parent.parent.amtManager == null) || (node.intelamt.pass == null) || (node.intelamt.pass == '') || ((node.intelamt.warn != null) && (((node.intelamt.warn) & 9) != 0))) { // Only allow changes to Intel AMT credentials if AMT manager is not running, or manager warned of unknown/trying credentials.
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
                            event.msgid = 140;
                            event.msgArgs = [ node.name, mesh.name, changes.join(', ') ];
                            if (amtchange == 1) { event.amtchange = 1; } // This will give a hint to the AMT Manager to reconnect using new AMT credentials
                            if (command.rdpport == 3389) { event.node.rdpport = 3389; }
                            if (command.rfbport == 5900) { event.node.rfbport = 5900; }
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), obj, event);
                        }

                        // Send response if required
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changedevice', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                    });
                    break;
                }
            case 'uploadagentcore':
                {
                    if (common.validateString(command.type, 1, 40) == false) break; // Check path
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's

                    // Go thru all node identifiers and run the operation
                    for (var i in command.nodeids) {
                        var nodeid = command.nodeids[i];
                        if (typeof nodeid != 'string') return;

                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
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
                    }
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
                        else if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid group identifier'; } // Check meshid
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
                    if ((idtype != 'puser') && (idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

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
                    } else if (idtype == 'puser') {
                        // Set the user's personal note, starts with 'ntp' + userid.
                        if (common.validateString(command.notes, 1) == false) {
                            db.Remove('ntp' + user._id); // Delete the note for this node
                        } else {
                            db.Set({ _id: 'ntp' + user._id, type: 'note', value: command.notes }); // Set the note for this user
                        }
                    }

                    break;
                }
            case 'otpemail':
                {
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: command.enabled ? 88 : 89, msg: command.enabled ? "Enabled email two-factor authentication." : "Disabled email two-factor authentication.", domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                    break;
                }
            case 'otpauth-request':
                {
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) { ws.send(JSON.stringify({ action: 'otpauth-request', err: 1 })); return; }

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) { ws.send(JSON.stringify({ action: 'otpauth-request', err: 3 })); return; }

                    // Check of OTP 2FA is allowed
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.otp2factor == false)) { ws.send(JSON.stringify({ action: 'otpauth-request', err: 4 })); return; }

                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) { ws.send(JSON.stringify({ action: 'otpauth-request', err: 5 })); return; } // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Request a one time password to be setup
                        var otplib = null;
                        try { otplib = require('otplib'); } catch (ex) { }
                        if (otplib == null) { ws.send(JSON.stringify({ action: 'otpauth-request', err: 6 })); return; }
                        const secret = otplib.authenticator.generateSecret(); // TODO: Check the random source of this value.

                        var domainName = parent.certificates.CommonName;
                        if (domain.dns != null) { domainName = domain.dns; }
                        ws.send(JSON.stringify({ action: 'otpauth-request', secret: secret, url: otplib.authenticator.keyuri(encodeURIComponent(user.name), domainName, secret) }));
                    }
                    break;
                }
            case 'otpauth-setup':
                {
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    // Check of OTP 2FA is allowed
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.otp2factor == false)) break;

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
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command if backup codes are not allowed
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.backupcode2factor == false)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
                    // Do not allow this command if 2FA's are locked or max keys reached
                    if (domain.passwordrequirements) {
                        if (domain.passwordrequirements.lock2factor == true) return;
                        if ((typeof domain.passwordrequirements.maxfidokeys == 'number') && (user.otphkeys) && (user.otphkeys.length >= domain.passwordrequirements.maxfidokeys)) return;
                    }

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
            case 'otpdev-clear':
                {
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    // Remove the authentication push notification device
                    if (user.otpdev != null) {
                        // Change the user
                        user.otpdev = obj.dbNodeKey;
                        parent.db.SetUser(user);

                        // Notify change
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 114, msg: "Removed push notification authentication device", domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);
                    }
                    break;
                }
            case 'otpdev-set':
                {
                    // Do not allow this command if 2FA's are locked
                    if ((domain.passwordrequirements) && (domain.passwordrequirements.lock2factor == true)) return;

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    // Attempt to add a authentication push notification device
                    // This will only send a push notification to the device, the device needs to confirm for the auth device to be added.
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        // Only allow use of devices with full rights
                        if ((node == null) || (visible == false) || (rights != 0xFFFFFFFF) || (node.agent == null) || (node.agent.id != 14) || (node.pmt == null)) return;

                        // Encode the cookie
                        const code = Buffer.from(user.name).toString('base64');
                        const authCookie = parent.parent.encodeCookie({ a: 'addAuth', c: code, u: user._id, n: node._id });

                        // Send out a push message to the device
                        var payload = { notification: { title: "MeshCentral", body: user.name + " authentication" }, data: { url: '2fa://auth?code=' + code + '&c=' + authCookie } };
                        var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
                        parent.parent.firebase.sendToDevice(node, payload, options, function (id, err, errdesc) {
                            if (err == null) {
                                parent.parent.debug('email', 'Successfully auth addition send push message to device ' + node.name);
                            } else {
                                parent.parent.debug('email', 'Failed auth addition push message to device ' + node.name + ', error: ' + errdesc);
                            }
                        });
                    });
                    break;
                }
            case 'webauthn-startregister':
                {
                    // Do not allow this command if 2FA's are locked or max keys reached
                    if (domain.passwordrequirements) {
                        if (domain.passwordrequirements.lock2factor == true) return;
                        if ((typeof domain.passwordrequirements.maxfidokeys == 'number') && (user.otphkeys) && (user.otphkeys.length >= domain.passwordrequirements.maxfidokeys)) return;
                    }

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.

                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if ((twoStepLoginSupported == false) || (command.name == null)) break;

                    // Send the registration request
                    var registrationOptions = parent.webauthn.generateRegistrationChallenge("Anonymous Service", { id: Buffer.from(user._id, 'binary').toString('base64'), name: user._id, displayName: user._id.split('/')[2] });
                    //console.log('registrationOptions', registrationOptions);
                    obj.webAuthnReqistrationRequest = { action: 'webauthn-startregister', keyname: command.name, request: registrationOptions };
                    ws.send(JSON.stringify(obj.webAuthnReqistrationRequest));
                    break;
                }
            case 'webauthn-endregister':
                {
                    // Do not allow this command if 2FA's are locked or max keys reached
                    if (domain.passwordrequirements) {
                        if (domain.passwordrequirements.lock2factor == true) return;
                        if ((typeof domain.passwordrequirements.maxfidokeys == 'number') && (user.otphkeys) && (user.otphkeys.length >= domain.passwordrequirements.maxfidokeys)) return;
                    }

                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

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
            case 'userWebState': {
                if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
                if (common.validateString(command.state, 1, 30000) == false) break; // Check state size, no more than 30k
                command.state = parent.filterUserWebState(command.state); // Filter the state to remove anything bad
                if ((command.state == null) || (typeof command.state !== 'string')) break; // If state did not validate correctly, quit here.
                command.domain = domain.id;
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
                    if ((idtype != 'puser') && (idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

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
                    } else if (idtype == 'puser') {
                        // Get personal note, starts with 'ntp' + userid
                        db.Get('ntp' + user._id, function (err, notes) {
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

                if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid group id'; } // Check the meshid (Max length of a meshid is 134 bytes).
                else if (common.validateInt(command.expire, 0, 99999) == false) { err = 'Invalid expire time'; } // Check the expire time in hours
                else if (common.validateInt(command.flags, 0, 256) == false) { err = 'Invalid flags'; } // Check the flags
                else {
                    if (command.meshid.split('/').length == 1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                    var smesh = command.meshid.split('/');
                    if ((smesh.length != 3) || (smesh[0] != 'mesh') || (smesh[1] != domain.id)) { err = 'Invalid group id'; }
                    mesh = parent.meshes[command.meshid];
                    if ((mesh == null) || (parent.IsMeshViewable(user, mesh) == false)) { err = 'Invalid group id'; }
                }
                var serverName = parent.getWebServerName(domain, req);

                // Handle any errors
                if (err != null) {
                    console.log(err, command.meshid);
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createInviteLink', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                const cookie = { a: 4, mid: command.meshid, f: command.flags, expire: command.expire * 60 };
                if ((typeof command.agents == 'number') && (command.agents != 0)) { cookie.ag = command.agents; }
                const inviteCookie = parent.parent.encodeCookie(cookie, parent.parent.invitationLinkEncryptionKey);
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
            case 'deviceMeshShares': {
                if (domain.guestdevicesharing === false) return; // This feature is not allowed.
                var err = null;

                // Argument validation
                if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid device group id'; } // Check the meshid
                else if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                else if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                else {
                    // Check if we have rights on this device group
                    mesh = parent.meshes[command.meshid];
                    if (mesh == null) { err = 'Invalid device group id'; } // Check the meshid
                    else if (parent.GetMeshRights(user, mesh) == 0) { err = 'Access denied'; }
                }

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Get all device shares
                parent.db.GetAllTypeNoTypeField('deviceshare', domain.id, function (err, docs) {
                    if (err != null) return;
                    var now = Date.now(), okDocs = [];
                    for (var i = 0; i < docs.length; i++) {
                        const doc = docs[i];
                        if ((doc.expireTime != null) && (doc.expireTime < now)) {
                            // This share is expired.
                            parent.db.Remove(doc._id, function () { });

                            // Send device share update
                            var targets = parent.CreateNodeDispatchTargets(doc.xmeshid, doc.nodeid, ['server-users', user._id]);
                            parent.parent.DispatchEvent(targets, obj, { etype: 'node', meshid: doc.xmeshid, nodeid: doc.nodeid, action: 'deviceShareUpdate', domain: domain.id, deviceShares: okDocs, nolog: 1 });
                        } else {
                            if (doc.xmeshid == null) {
                                // This is an old share with missing meshid, fix it here.
                                const f = function fixShareMeshId(err, nodes) {
                                    if (err != null) return;
                                    if (nodes.length == 1) {
                                        // Add the meshid to the device share
                                        fixShareMeshId.xdoc.xmeshid = nodes[0].meshid;
                                        fixShareMeshId.xdoc.type = 'deviceshare';
                                        delete fixShareMeshId.xdoc.meshid;
                                        parent.db.Set(fixShareMeshId.xdoc);
                                    } else {
                                        // This node no longer exists, remove the device share.
                                        parent.db.Remove(fixShareMeshId.xdoc._id);
                                    }
                                }
                                f.xdoc = doc;
                                db.Get(doc.nodeid, f);
                            } else if (doc.xmeshid == command.meshid) {
                                // This share is ok, remove extra data we don't need to send.
                                delete doc._id; delete doc.domain; delete doc.type; delete doc.xmeshid;
                                if (doc.userid != user._id) { delete doc.url; } // If this is not the user who created this link, don't give the link.
                                okDocs.push(doc);
                            }
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'deviceMeshShares', meshid: command.meshid, deviceShares: okDocs })); } catch (ex) { }
                });
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
                            if ((doc.expireTime != null) && (doc.expireTime < now)) {
                                // This share is expired.
                                parent.db.Remove(doc._id, function () { }); removed = true;
                            } else {
                                // This share is ok, remove extra data we don't need to send.
                                delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type; delete doc.xmeshid;
                                if (doc.userid != user._id) { delete doc.url; } // If this is not the user who created this link, don't give the link.
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
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeDeviceShare', responseid: command.responseid, nodeid: command.nodeid, publicid: command.publicid, removed: removedExact })); } catch (ex) { } }

                        // Event device share removal
                        if (removedExact != null) {
                            // Send out an event that we removed a device share
                            var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', 'server-shareremove', user._id]);
                            var event = { etype: 'node', userid: user._id, username: user.name, nodeid: node._id, action: 'removedDeviceShare', msg: 'Removed Device Share', msgid: 102, msgArgs: [removedExact.guestName], domain: domain.id, publicid: command.publicid };
                            parent.parent.DispatchEvent(targets, obj, event);

                            // If this is an agent self-sharing link, notify the agent
                            if (command.publicid.startsWith('AS:node/')) { routeCommandToNode({ action: 'msg', type: 'guestShare', nodeid: command.publicid.substring(3), flags: 0, url: null, viewOnly: false }); }
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
                else if ((command.expire != null) && (typeof command.expire != 'number')) { err = 'Invalid expire time'; } // Check the expire time in minutes
                else if ((command.start != null) && (typeof command.start != 'number')) { err = 'Invalid start time'; } // Check the start time in UTC seconds
                else if ((command.end != null) && (typeof command.end != 'number')) { err = 'Invalid end time'; } // Check the end time in UTC seconds
                else if (common.validateInt(command.consent, 0, 256) == false) { err = 'Invalid flags'; } // Check the flags
                else if (common.validateInt(command.p, 1, 31) == false) { err = 'Invalid protocol'; } // Check the protocol, 1 = Terminal, 2 = Desktop, 4 = Files, 8 = HTTP, 16 = HTTPS
                else if ((command.recurring != null) && (common.validateInt(command.recurring, 1, 2) == false)) { err = 'Invalid recurring value'; } // Check the recurring value, 1 = Daily, 2 = Weekly
                else if ((command.port != null) && (common.validateInt(command.port, 1, 65535) == false)) { err = 'Invalid port value'; } // Check the port if present
                else if ((command.recurring != null) && ((command.end != null) || (command.start == null) || (command.expire == null))) { err = 'Invalid recurring command'; }
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

                // Correct maximum session length if needed
                if ((typeof domain.guestdevicesharing == 'object') && (typeof domain.guestdevicesharing.maxsessiontime == 'number') && (domain.guestdevicesharing.maxsessiontime > 0)) {
                    const maxtime = domain.guestdevicesharing.maxsessiontime;
                    if ((command.expire != null) && (command.expire > maxtime)) { command.expire = maxtime; }
                    if ((command.start != null) && (command.end != null)) { if ((command.end - command.start) > (maxtime * 60)) { command.end = (command.start + (maxtime * 60)); } }
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
                    if (((command.p & 1) != 0) && (rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_NOTERMINAL) != 0)) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                        return;
                    }

                    // If we are limited to no desktop, don't allow desktop sharing
                    if (((command.p & 2) != 0) && (rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_NODESKTOP) != 0)) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                        return;
                    }

                    // If we are limited to no files, don't allow file sharing
                    if (((command.p & 4) != 0) && (rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_NOFILES) != 0)) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deviceShares', responseid: command.responseid, result: 'Access denied' })); } catch (ex) { } }
                        return;
                    }

                    // If we have view only remote desktop rights, force view-only on the guest share.
                    if ((rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_REMOTEVIEWONLY) != 0)) { command.viewOnly = true; command.p = (command.p & 1); }

                    // Create cookie
                    var publicid = getRandomPassword(), startTime = null, expireTime = null, duration = null;
                    if (command.recurring) {
                        // Recurring share
                        startTime = command.start * 1000;
                        duration = command.expire;
                    } else if (command.expire != null) {
                        if (command.expire !== 0) {
                            // Now until expire in hours
                            startTime = Date.now();
                            expireTime = Date.now() + (60000 * command.expire);
                        } else {
                            delete command.expire;
                        }
                    } else {
                        // Time range in seconds
                        startTime = command.start * 1000;
                        expireTime = command.end * 1000;
                    }

                    //var cookie = { a: 5, p: command.p, uid: user._id, gn: command.guestname, nid: node._id, cf: command.consent, pid: publicid }; // Old style sharing cookie
                    var cookie = { a: 6, pid: publicid }; // New style sharing cookie
                    if ((startTime != null) && (expireTime != null)) { command.start = startTime; command.expire = cookie.e = expireTime; }
                    else if ((startTime != null) && (duration != null)) { command.start = startTime; }
                    const inviteCookie = parent.parent.encodeCookie(cookie, parent.parent.invitationLinkEncryptionKey);
                    if (inviteCookie == null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createDeviceShareLink', responseid: command.responseid, result: 'Unable to generate shareing cookie' })); } catch (ex) { } } return; }

                    // Create the server url
                    var serverName = parent.getWebServerName(domain, req);
                    var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
                    var xdomain = (domain.dns == null) ? domain.id : '';
                    if (xdomain != '') xdomain += '/';
                    var url = 'https://' + serverName + ':' + httpsPort + '/' + xdomain + 'sharing?c=' + inviteCookie;
                    if (serverName.split('.') == 1) { url = '/' + xdomain + page + '?c=' + inviteCookie; }
                    command.url = url;
                    command.publicid = publicid;
                    if (command.responseid != null) { command.result = 'OK'; }
                    try { ws.send(JSON.stringify(command)); } catch (ex) { }

                    // Create a device sharing database entry
                    var shareEntry = { _id: 'deviceshare-' + publicid, type: 'deviceshare', xmeshid: node.meshid, nodeid: node._id, p: command.p, domain: node.domain, publicid: publicid, userid: user._id, guestName: command.guestname, consent: command.consent, port: command.port, url: url };
                    if ((startTime != null) && (expireTime != null)) { shareEntry.startTime = startTime; shareEntry.expireTime = expireTime; }
                    else if ((startTime != null) && (duration != null)) { shareEntry.startTime = startTime; shareEntry.duration = duration; }
                    if (command.recurring) { shareEntry.recurring = command.recurring; }
                    if (command.viewOnly === true) { shareEntry.viewOnly = true; }
                    parent.db.Set(shareEntry);

                    // Send out an event that we added a device share
                    var targets = parent.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', user._id]);
                    var event;
                    if (command.recurring == 1) {
                        event = { etype: 'node', userid: user._id, username: user.name, meshid: node.meshid, nodeid: node._id, action: 'addedDeviceShare', msg: 'Added device share ' + command.guestname + ' recurring daily.', msgid: 138, msgArgs: [command.guestname], domain: domain.id };
                    } else if (command.recurring == 2) {
                        event = { etype: 'node', userid: user._id, username: user.name, meshid: node.meshid, nodeid: node._id, action: 'addedDeviceShare', msg: 'Added device share ' + command.guestname + ' recurring weekly.', msgid: 139, msgArgs: [command.guestname], domain: domain.id };
                    } else if ((startTime != null) && (expireTime != null)) {
                        event = { etype: 'node', userid: user._id, username: user.name, meshid: node.meshid, nodeid: node._id, action: 'addedDeviceShare', msg: 'Added device share: ' + command.guestname + '.', msgid: 101, msgArgs: [command.guestname, 'DATETIME:' + startTime, 'DATETIME:' + expireTime], domain: domain.id };
                    } else {
                        event = { etype: 'node', userid: user._id, username: user.name, meshid: node.meshid, nodeid: node._id, action: 'addedDeviceShare', msg: 'Added device share ' + command.guestname + ' with unlimited time.', msgid: 131, msgArgs: [command.guestname], domain: domain.id };
                    }
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
                                delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type; delete doc.xmeshid;
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
                        if (rights != 0) {
                            parent.parent.mqttbroker.publish(node._id, command.topic, command.msg);
                        }
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
                        const serverName = parent.getWebServerName(domain, req);

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
                    
                } catch(ex) { console.log('Cannot add plugin: ' + e); }
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
                    } catch (ex) { console.log('Error loading plugin handler (' + e + ')'); }
                }
                break;
            }
            case 'uicustomevent': {
                if ((command.src != null) && (Array.isArray(command.src.selectedDevices))) {
                    // Contains a list of nodeid's, check that we have permissions for them.
                    parent.GetNodesWithRights(domain, user, command.src.selectedDevices, function (nodes) {
                        var nodeids = [];
                        for (var i in nodes) { nodeids.push(i); }
                        if (nodeids.length == 0) return;

                        // Event the custom UI action
                        var message = { etype: 'user', userid: user._id, username: user.name, action: 'uicustomevent', domain: domain.id, uisection: command.section, element: command.element };
                        if (nodeids.length == 1) { message.nodeid = nodeids[0]; }
                        if (command.selectedDevices != null) { message.selectedDevices = command.selectedDevices; }
                        if (command.src != null) { message.src = command.src; }
                        if (command.values != null) { message.values = command.values; }
                        if (typeof command.logmsg == 'string') { message.msg = command.logmsg; } else { message.nolog = 1; }
                        parent.parent.DispatchEvent(['*', user._id], obj, message);
                    });
                } else {
                    // Event the custom UI action
                    var message = { etype: 'user', userid: user._id, username: user.name, action: 'uicustomevent', domain: domain.id, uisection: command.section, element: command.element };
                    if (command.selectedDevices != null) { message.selectedDevices = command.selectedDevices; }
                    if (command.src != null) { message.src = command.src; }
                    if (command.values != null) { message.values = command.values; }
                    if (typeof command.logmsg == 'string') { message.msg = command.logmsg; } else { message.nolog = 1; }
                    parent.parent.DispatchEvent(['*', user._id], obj, message);
                }
                break;
            }
            case 'serverBackup': {
                // Do not allow this command when logged in using a login token
                if (req.session.loginToken != null) break;

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
                try {
                    // Do not allow this command when logged in using a login token
                    if (req.session.loginToken != null) break;

                    // Do not allows this command is 2FA cookie duration is set to zero
                    if (domain.twofactorcookiedurationdays === 0) break;

                    // Generate a two-factor cookie
                    var maxCookieAge = domain.twofactorcookiedurationdays;
                    if ((typeof maxCookieAge != 'number') || (maxCookieAge < 1)) { maxCookieAge = 30; }
                    const twoFactorCookie = parent.parent.encodeCookie({ userid: user._id, expire: maxCookieAge * 24 * 60 /*, ip: req.clientIp*/ }, parent.parent.loginCookieEncryptionKey);
                    try { ws.send(JSON.stringify({ action: 'twoFactorCookie', cookie: twoFactorCookie })); } catch (ex) { }
                } catch (ex) { console.log(ex); }
                break;
            }
            case 'amtsetupbin': {
                if ((command.oldmebxpass != 'admin') && (common.validateString(command.oldmebxpass, 8, 16) == false)) break; // Check password
                if (common.validateString(command.newmebxpass, 8, 16) == false) break; // Check password
                if ((command.baremetal) && (parent.parent.amtProvisioningServer != null)) {
                    // Create bare metal setup.bin
                    var bin = parent.parent.certificateOperations.GetBareMetalSetupBinFile(domain.amtacmactivation, command.oldmebxpass, command.newmebxpass, domain, user);
                    try { ws.send(JSON.stringify({ action: 'amtsetupbin', file: Buffer.from(bin, 'binary').toString('base64') })); } catch (ex) { }
                } else {
                    // Create standard setup.bin
                    var bin = parent.parent.certificateOperations.GetSetupBinFile(domain.amtacmactivation, command.oldmebxpass, command.newmebxpass, domain, user);
                    try { ws.send(JSON.stringify({ action: 'amtsetupbin', file: Buffer.from(bin, 'binary').toString('base64') })); } catch (ex) { }
                }
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
            case 'previousLogins': {
                // TODO: Make a better database call to get filtered data.
                if (command.userid == null) {
                    var splitUser = user._id.split('/');
                    // Get previous logins for self
                    if (db.GetUserLoginEvents) {
                        // New way
                        db.GetUserLoginEvents(domain.id, user._id, function (err, docs) {
                            if (err != null) return;
                            var e = [];
                            for (var i in docs) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs, tn: docs[i].tokenName }); }
                            try { ws.send(JSON.stringify({ action: 'previousLogins', events: e })); } catch (ex) { }
                        });
                    } else {
                        // Old way
                        db.GetUserEvents([user._id], domain.id, user._id, function (err, docs) {
                            if (err != null) return;
                            var e = [];
                            for (var i in docs) {
                                if ((docs[i].msgArgs) && (docs[i].userid == user._id) && ((docs[i].action == 'authfail') || (docs[i].action == 'login'))) {
                                    e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs, tn: docs[i].tokenName });
                                }
                            }
                            try { ws.send(JSON.stringify({ action: 'previousLogins', events: e })); } catch (ex) { }
                        });
                    }
                } else {
                    // Get previous logins for specific userid
                    if ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0) {
                        var splitUser = command.userid.split('/');
                        if ((obj.crossDomain === true) || (splitUser[1] === domain.id)) {
                            if (db.GetUserLoginEvents) {
                                // New way
                                db.GetUserLoginEvents(splitUser[1], command.userid, function (err, docs) {
                                    if (err != null) return;
                                    var e = [];
                                    for (var i in docs) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); }
                                    try { ws.send(JSON.stringify({ action: 'previousLogins', userid: command.userid, events: e })); } catch (ex) { }
                                });
                            } else {
                                // Old way
                                db.GetUserEvents([command.userid], domain.id, user._id, function (err, docs) {
                                    if (err != null) return;
                                    var e = [];
                                    for (var i in docs) { if ((docs[i].msgArgs) && (docs[i].userid == command.userid) && ((docs[i].action == 'authfail') || (docs[i].action == 'login'))) { e.push({ t: docs[i].time, m: docs[i].msgid, a: docs[i].msgArgs }); } }
                                    try { ws.send(JSON.stringify({ action: 'previousLogins', userid: command.userid, events: e })); } catch (ex) { }
                                });
                            }
                        }
                    }
                }
                break;
            }
            case 'oneclickrecovery': { // Intel(R) AMT One Click Recovery (OCR)
                if (common.validateStrArray(command.nodeids, 1) == false) break; // Check nodeids
                if (common.validateString(command.path, 1, 2048) == false) break; // Check file path
                if (command.type != 'diskimage') break; // Make sure type is correct

                var file = parent.getServerFilePath(user, domain, command.path);
                if (file == null) return;

                // For each nodeid, change the group
                for (var i = 0; i < command.nodeids.length; i++) {
                    var xnodeid = command.nodeids[i];
                    if (xnodeid.indexOf('/') == -1) { xnodeid = 'node/' + domain.id + '/' + xnodeid; }

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, xnodeid, function (node, rights, visible) {
                        // Check if we found this device and if we have full rights
                        if ((node == null) || (rights != 0xFFFFFFFF)) return;

                        // Event Intel AMT One Click Recovery, this will cause Intel AMT wake operations on this and other servers.
                        parent.parent.DispatchEvent('*', obj, { action: 'oneclickrecovery', userid: user._id, username: user.name, nodeids: [node._id], domain: domain.id, nolog: 1, file: file.fullpath });
                    });
                }
                break;
            }
            case 'loginTokens': { // Respond with the list of currently valid login tokens
                if (req.session.loginToken != null) break; // Do not allow this command when logged in using a login token
                if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.logintokens == false)) break; // Login tokens are not supported on this server

                // If remove is an array or strings, we are going to be removing these and returning the results.
                if (common.validateStrArray(command.remove, 1) == false) { delete command.remove; }

                parent.db.GetAllTypeNodeFiltered(['logintoken-' + user._id], domain.id, 'logintoken', null, function (err, docs) {
                    if (err != null) return;
                    var now = Date.now(), removed = [], okDocs = [];
                    for (var i = 0; i < docs.length; i++) {
                        const doc = docs[i];
                        if (((doc.expire != 0) && (doc.expire < now)) || (doc.tokenUser == null) || ((command.remove != null) && (command.remove.indexOf(doc.tokenUser) >= 0))) {
                            // This share is expired.
                            parent.db.Remove(doc._id, function () { }); removed.push(doc.tokenUser);
                        } else {
                            // This share is ok, remove extra data we don't need to send.
                            delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type; delete doc.userid; delete doc.salt; delete doc.hash;
                            okDocs.push(doc);
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'loginTokens', loginTokens: okDocs })); } catch (ex) { }

                    // If any login tokens where removed, event the change.
                    if (removed.length > 0) {
                        // Dispatch the new event
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, action: 'loginTokenChanged', domain: domain.id, loginTokens: okDocs, removed: removed, nolog: 1 };
                        parent.parent.DispatchEvent(targets, obj, event);
                    }
                });
                break;
            }
            case 'createLoginToken': { // Create a new login token
                var err = null;

                if (req.session.loginToken != null) { err = "Access denied"; } // Do not allow this command when logged in using a login token
                else if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.logintokens === false)) { err = "Not supported"; } // Login tokens are not supported on this server
                else if ((typeof domain.passwordrequirements == 'object') && Array.isArray(domain.passwordrequirements.logintokens) && (domain.passwordrequirements.logintokens.indexOf(user._id) < 0)) { err = "Not supported"; } // Login tokens are not supported by this user
                else if (common.validateString(command.name, 1, 100) == false) { err = "Invalid name"; } // Check name
                else if ((typeof command.expire != 'number') || (command.expire < 0)) { err = "Invalid expire value"; } // Check expire

                // Handle any errors
                if (err != null) {
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createLoginToken', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Generate a token username. Don't have any + or / in the username or password
                var tokenUser = '~t:' + Buffer.from(parent.parent.crypto.randomBytes(12), 'binary').toString('base64');
                while ((tokenUser.indexOf('+') >= 0) || (tokenUser.indexOf('/') >= 0)) { tokenUser = '~t:' + Buffer.from(parent.parent.crypto.randomBytes(12), 'binary').toString('base64'); };
                var tokenPass = Buffer.from(parent.parent.crypto.randomBytes(15), 'binary').toString('base64');
                while ((tokenPass.indexOf('+') >= 0) || (tokenPass.indexOf('/') >= 0)) { tokenPass = Buffer.from(parent.parent.crypto.randomBytes(15), 'binary').toString('base64'); };

                // Create a user, generate a salt and hash the password
                require('./pass').hash(tokenPass, function (err, salt, hash, tag) {
                    if (err) throw err;

                    // Compute expire time
                    const created = Date.now();
                    var expire = 0;
                    if (command.expire > 0) { expire = created + (command.expire * 60000); }

                    // Generate the token password
                    const dbentry = { _id: 'logintoken-' + tokenUser, type: 'logintoken', nodeid: 'logintoken-' + user._id, userid: user._id, name: command.name, tokenUser: tokenUser, salt: salt, hash: hash, domain: domain.id, created: created, expire: expire };
                    parent.db.Set(dbentry);

                    // Send the token information back
                    try { ws.send(JSON.stringify({ action: 'createLoginToken', name: command.name, tokenUser: tokenUser, tokenPass: tokenPass, created: created, expire: expire })); } catch (ex) { }

                    // Dispatch the new event
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    var event = { etype: 'user', userid: user._id, username: user.name, action: 'loginTokenAdded', msgid: 115, msg: "Added login token", domain: domain.id, newToken: { name: command.name, tokenUser: tokenUser, created: created, expire: expire } };
                    parent.parent.DispatchEvent(targets, obj, event);
                });
                break;
            }
            case 'getDeviceDetails': {
                if ((common.validateStrArray(command.nodeids, 1) == false) && (command.nodeids != null)) break; // Check nodeids
                if (common.validateString(command.type, 3, 4) == false) break; // Check type

                // Create a list of node ids and query them for last device connection time
                const ids = []
                for (var i in command.nodeids) { ids.push('lc' + command.nodeids[i]); }
                db.GetAllIdsOfType(ids, domain.id, 'lastconnect', function (err, docs) {
                    const lastConnects = {};
                    if (docs != null) { for (var i in docs) { lastConnects[docs[i]._id] = docs[i]; } }

                    getDeviceDetailedInfo(command.nodeids, command.type, function (results, type) {
                        for (var i = 0; i < results.length; i++) {
                            // Remove any device system and network information is we do not have details rights to this device
                            if ((parent.GetNodeRights(user, results[i].node.meshid, results[i].node._id) & MESHRIGHT_DEVICEDETAILS) == 0) {
                                delete results[i].sys; delete results[i].net;
                            }

                            // Merge any last connection information
                            const lc = lastConnects['lc' + results[i].node._id];
                            if (lc != null) { delete lc._id; delete lc.type;; delete lc.meshid; delete lc.domain; results[i].lastConnect = lc; }
                        }

                        var output = null;
                        if (type == 'csv') {
                            try {
                                // Create the CSV file
                                output = 'id,name,rname,host,icon,ip,osdesc,groupname,av,update,firewall,avdetails,cpu,osbuild,biosDate,biosVendor,biosVersion,boardName,boardVendor,boardVersion,productUuid,totalMemory,agentOpenSSL,agentCommitDate,agentCommitHash,agentCompileTime,netIfCount,macs,addresses,lastConnectTime,lastConnectAddr\r\n';
                                for (var i = 0; i < results.length; i++) {
                                    const nodeinfo = results[i];

                                    // Node information
                                    if (nodeinfo.node != null) {
                                        const n = nodeinfo.node;
                                        output += csvClean(n._id) + ',' + csvClean(n.name) + ',' + csvClean(n.rname ? n.rname : '') + ',' + csvClean(n.host ? n.host : '') + ',' + (n.icon ? n.icon : 1) + ',' + (n.ip ? n.ip : '') + ',' + (n.osdesc ? csvClean(n.osdesc) : '') + ',' + csvClean(parent.meshes[n.meshid].name);
                                        if (typeof n.wsc == 'object') {
                                            output += ',' + csvClean(n.wsc.antiVirus ? n.wsc.antiVirus : '') + ',' + csvClean(n.wsc.autoUpdate ? n.wsc.autoUpdate : '') + ',' + csvClean(n.wsc.firewall ? n.wsc.firewall : '')
                                        } else { output += ',,,'; }
                                        if (typeof n.av == 'object') {
                                            var avdetails = '', firstav = true;
                                            for (var a in n.av) { if (typeof n.av[a].product == 'string') { if (firstav) { firstav = false; } else { avdetails += '|'; } avdetails += (n.av[a].product + '/' + ((n.av[a].enabled) ? 'enabled' : 'disabled') + '/' + ((n.av[a].updated) ? 'updated' : 'notupdated')); } }
                                            output += ',' + csvClean(avdetails);
                                        }
                                        else { output += ','; }
                                    } else {
                                        output += ',,,,,,,,,,,';
                                    }

                                    // System infomation
                                    if ((nodeinfo.sys) && (nodeinfo.sys.hardware) && (nodeinfo.sys.hardware.windows) && (nodeinfo.sys.hardware.windows)) {
                                        // Windows
                                        output += ',';
                                        if (nodeinfo.sys.hardware.windows.cpu && (nodeinfo.sys.hardware.windows.cpu.length > 0) && (typeof nodeinfo.sys.hardware.windows.cpu[0].Name == 'string')) { output += csvClean(nodeinfo.sys.hardware.windows.cpu[0].Name); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.windows.osinfo && (nodeinfo.sys.hardware.windows.osinfo.BuildNumber)) { output += csvClean(nodeinfo.sys.hardware.windows.osinfo.BuildNumber); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.bios_date)) { output += csvClean(nodeinfo.sys.hardware.identifiers.bios_date); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.bios_vendor)) { output += csvClean(nodeinfo.sys.hardware.identifiers.bios_vendor); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.bios_version)) { output += csvClean(nodeinfo.sys.hardware.identifiers.bios_version); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.board_name)) { output += csvClean(nodeinfo.sys.hardware.identifiers.board_name); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.board_vendor)) { output += csvClean(nodeinfo.sys.hardware.identifiers.board_vendor); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.board_version)) { output += csvClean(nodeinfo.sys.hardware.identifiers.board_version); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.identifiers && (nodeinfo.sys.hardware.identifiers.product_uuid)) { output += csvClean(nodeinfo.sys.hardware.identifiers.product_uuid); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.windows.memory) {
                                            var totalMemory = 0;
                                            for (var j in nodeinfo.sys.hardware.windows.memory) {
                                                if (nodeinfo.sys.hardware.windows.memory[j].Capacity) {
                                                    if (typeof nodeinfo.sys.hardware.windows.memory[j].Capacity == 'number') { totalMemory += nodeinfo.sys.hardware.windows.memory[j].Capacity; }
                                                    if (typeof nodeinfo.sys.hardware.windows.memory[j].Capacity == 'string') { totalMemory += parseInt(nodeinfo.sys.hardware.windows.memory[j].Capacity); }
                                                }
                                            }
                                            output += csvClean('' + totalMemory);
                                        }
                                    } else if ((nodeinfo.sys) && (nodeinfo.sys.hardware) && (nodeinfo.sys.hardware.mobile)) {
                                        // Mobile
                                        output += ',';
                                        output += ',';
                                        output += ',';
                                        output += ',';
                                        output += ',';
                                        if (nodeinfo.sys.hardware.mobile && (nodeinfo.sys.hardware.mobile.bootloader)) { output += csvClean(nodeinfo.sys.hardware.mobile.bootloader); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.mobile && (nodeinfo.sys.hardware.mobile.model)) { output += csvClean(nodeinfo.sys.hardware.mobile.model); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.mobile && (nodeinfo.sys.hardware.mobile.brand)) { output += csvClean(nodeinfo.sys.hardware.mobile.brand); }
                                        output += ',';
                                        output += ',';
                                        if (nodeinfo.sys.hardware.mobile && (nodeinfo.sys.hardware.mobile.id)) { output += csvClean(nodeinfo.sys.hardware.mobile.id); }
                                        output += ',';
                                    } else if ((nodeinfo.sys) && (nodeinfo.sys.hardware) && (nodeinfo.sys.hardware.windows) && (nodeinfo.sys.hardware.linux)) {
                                        // Linux
                                        output += ',';
                                        output += ',';
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.bios_date)) { output += csvClean(nodeinfo.sys.hardware.linux.bios_date); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.bios_vendor)) { output += csvClean(nodeinfo.sys.hardware.linux.bios_vendor); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.bios_version)) { output += csvClean(nodeinfo.sys.hardware.linux.bios_version); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.board_name)) { output += csvClean(nodeinfo.sys.hardware.linux.board_name); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.board_vendor)) { output += csvClean(nodeinfo.sys.hardware.linux.board_vendor); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.board_version)) { output += csvClean(nodeinfo.sys.hardware.linux.board_version); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.linux && (nodeinfo.sys.hardware.linux.product_uuid)) { output += csvClean(nodeinfo.sys.hardware.linux.product_uuid); }
                                        output += ',';
                                    } else {
                                        output += ',,,,,,,,,,';
                                    }

                                    // Agent information
                                    if ((nodeinfo.sys) && (nodeinfo.sys.hardware) && (nodeinfo.sys.hardware.agentvers)) {
                                        output += ',';
                                        if (nodeinfo.sys.hardware.agentvers.openssl) { output += csvClean(nodeinfo.sys.hardware.agentvers.openssl); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.agentvers.commitDate) { output += csvClean(nodeinfo.sys.hardware.agentvers.commitDate); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.agentvers.commitHash) { output += csvClean(nodeinfo.sys.hardware.agentvers.commitHash); }
                                        output += ',';
                                        if (nodeinfo.sys.hardware.agentvers.compileTime) { output += csvClean(nodeinfo.sys.hardware.agentvers.compileTime); }
                                    } else {
                                        output += ',,,,';
                                    }

                                    // Network interfaces
                                    if ((nodeinfo.net) && (nodeinfo.net.netif2)) {
                                        output += ',';
                                        output += Object.keys(nodeinfo.net.netif2).length; // Interface count
                                        var macs = [], addresses = [];
                                        for (var j in nodeinfo.net.netif2) {
                                            if (Array.isArray(nodeinfo.net.netif2[j])) {
                                                for (var k = 0; k < nodeinfo.net.netif2[j].length; k++) {
                                                    if (typeof nodeinfo.net.netif2[j][k].mac == 'string') { macs.push(nodeinfo.net.netif2[j][k].mac); }
                                                    if (typeof nodeinfo.net.netif2[j][k].address == 'string') { addresses.push(nodeinfo.net.netif2[j][k].address); }
                                                }
                                            }
                                        }
                                        output += ',';
                                        output += csvClean(macs.join(' ')); // MACS
                                        output += ',';
                                        output += csvClean(addresses.join(' ')); // Addresses
                                    } else {
                                        output += ',,,';
                                    }

                                    // Last connection information
                                    if (nodeinfo.lastConnect) {
                                        output += ',';
                                        if (nodeinfo.lastConnect.time) {
                                            // Last connection time
                                            if ((typeof command.l == 'string') && (typeof command.tz == 'string')) {
                                                output += csvClean(new Date(nodeinfo.lastConnect.time).toLocaleString(command.l, { timeZone: command.tz }))
                                            } else {
                                                output += nodeinfo.lastConnect.time;
                                            }
                                        }
                                        output += ',';
                                        if (typeof nodeinfo.lastConnect.addr == 'string') { output += csvClean(nodeinfo.lastConnect.addr); } // Last connection address and port
                                    } else {
                                        output += ',,';
                                    }

                                    output += '\r\n';
                                }
                            } catch (ex) { console.log(ex); }
                        } else {
                            // Create the JSON file

                            // Add the device group name to each device
                            for (var i = 0; i < results.length; i++) {
                                const nodeinfo = results[i];
                                if (nodeinfo.node) {
                                    const mesh = parent.meshes[nodeinfo.node.meshid];
                                    if (mesh) { results[i].node.groupname = mesh.name; }
                                }
                            }

                            output = JSON.stringify(results, null, 2);
                        }
                        try { ws.send(JSON.stringify({ action: 'getDeviceDetails', data: output, type: type })); } catch (ex) { }
                    });
                });

                break;
            }
            case 'endDesktopMultiplex': {
                var err = null, xuser = null;
                try {
                    if (command.xuserid.indexOf('/') < 0) { command.xuserid = 'user/' + domain.id + '/' + command.xuserid; }
                    if (common.validateString(command.nodeid, 1, 1024) == false) { err = 'Invalid device identifier'; } // Check the meshid
                    else if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
                    const xusersplit = command.xuserid.split('/');
                    xuser = parent.users[command.xuserid];
                    if (xuser == null) { err = 'User does not exists'; }
                    else if ((obj.crossDomain !== true) && ((xusersplit.length != 3) || (xusersplit[1] != domain.id))) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                } catch (ex) { err = 'Validation exception: ' + ex; }

                // Handle any errors
                if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'changeusernotify', responseid: command.responseid, result: err })); } catch (ex) { } } break; }

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, xuser, command.nodeid, function (node, rights, visible) {
                    if ((rights != 0xFFFFFFFF) && (xuser._id != command.xuserid)) return;
                    const desktopRelay = parent.desktoprelays[command.nodeid];
                    if ((desktopRelay == null) || (desktopRelay === 1)) return; // If the desktopRelay is equal to 1, the relay is being constructed.
                    var viewersToClose = []; // Create a list of viewers to close. We don't want to close directly because it will change "desktopRelay.viewers" and we will not enumerate correctly. 
                    for (var i = 0; i < desktopRelay.viewers.length; i++) {
                        const viewer = desktopRelay.viewers[i];
                        if ((viewer.user._id == command.xuserid) && (viewer.guestName == command.guestname)) { viewersToClose.push(viewer); } // Only close viewers that match the userid and guestname if present.
                    }
                    for (var i = 0; i < viewersToClose.length; i++) { viewersToClose[i].close(); } // Close any viewers we need closed.

                    // Log the desktop session disconnection
                    var targets = ['*', user._id, command.xuserid];
                    const splitxuser = command.xuserid.split('/');
                    var xusername = splitxuser[2];
                    if (command.guestname != null) { xusername += '/' + command.guestname; }
                    const event = { etype: 'user', userid: user._id, username: user.name, nodeid: command.nodeid, xuserid: command.xuserid, action: 'endsession', msgid: 134, msgArgs: [xusername], msg: 'Forcibly disconnected desktop session of user ' + xusername, domain: domain.id };
                    if (command.guestname != null) { event.guestname = command.guestname; }
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                });

                break;
            }
            case 'satellite': {
                // Command indicates this is a MeshCentral Satellite session and what featues it supports
                if ((command.setFlags != null) && (typeof command.setFlags == 'number')) { obj.ws.satelliteFlags = command.setFlags; }
                if ((command.reqid != null) && (typeof command.satelliteFlags == 'number')) {
                    const event = { action: 'satelliteResponse', subaction: command.subaction, reqid: command.reqid, response: command.response, satelliteFlags: command.satelliteFlags, nolog: 1 }
                    if (typeof command.nodeid == 'string') { event.nodeid = command.nodeid; }
                    parent.parent.DispatchEvent(['*'], obj, event);
                }
                break;
            }
            case 'importamtdevices': {
                if ((command.amtdevices == null) || (command.meshid == null) || (typeof command.meshid != 'string') || (command.meshid.startsWith('mesh/' + domain.id + '/') == false)) return;
                const mesh = parent.meshes[command.meshid];
                if ((mesh == null) || (mesh.mtype != 1) || (parent.GetMeshRights(user, command.meshid) & MESHRIGHT_EDITMESH) == 0) return null; // This user must have mesh rights to edit the device group
                var amtDevices = [];

                // Decode a JSON file from the Intel SCS migration tool
                if ((typeof command.amtdevices == 'object') && (typeof command.amtdevices.ApplicationData == 'object') && (command.amtdevices.ApplicationData.Application == 'Intel vPro(R) Manageability Migration Tool') && (typeof command.amtdevices['ManagedSystems'] == 'object') && (Array.isArray(command.amtdevices['ManagedSystems']['ManagedSystemsList']))) {
                    for (var i in command.amtdevices['ManagedSystems']['ManagedSystemsList']) {
                        const importDev = command.amtdevices['ManagedSystems']['ManagedSystemsList'][i];
                        var host = null;
                        if ((typeof importDev.Fqdn == 'string') && (importDev.Fqdn != '')) { host = importDev.Fqdn; }
                        if ((host == null) && (typeof importDev.IPv4 == 'string') && (importDev.IPv4 != '')) { host = importDev.IPv4; }
                        if (host != null) {
                            // Create a new Intel AMT device
                            const nodeid = 'node/' + domain.id + '/' + parent.crypto.randomBytes(48).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            const device = { type: 'node', _id: nodeid, meshid: mesh._id, mtype: 1, icon: 1, name: host, host: host, domain: domain.id, intelamt: { user: 'admin', state: 2 } };

                            // Add optional fields
                            if (typeof importDev.AmtVersion == 'string') { device.intelamt.ver = importDev.AmtVersion; }
                            if (typeof importDev.ConfiguredPassword == 'string') { device.intelamt.pass = importDev.ConfiguredPassword; }
                            if (typeof importDev.Uuid == 'string') { device.intelamt.uuid = importDev.Uuid; }
                            if (importDev.ConnectionType == 'TLS') { device.intelamt.tls = 1; }

                            // Check if we are already adding a device with the same hostname, if so, skip it.
                            var skip = false;
                            for (var i in amtDevices) { if (amtDevices[i].host.toLowerCase() == device.host.toLowerCase()) { skip = true; } }
                            if (skip == false) { amtDevices.push(device); }
                        }
                    }
                }

                // Decode a JSON file from MeshCommander
                if ((typeof command.amtdevices == 'object') && (typeof command.amtdevices.webappversion == 'string') && (Array.isArray(command.amtdevices.computers))) {
                    for (var i in command.amtdevices.computers) {
                        const importDev = command.amtdevices.computers[i];
                        if ((typeof importDev.host == 'string') && (importDev.host != '') && (importDev.host != '127.0.0.1') && (importDev.host.toLowerCase() != 'localhost')) {
                            // Create a new Intel AMT device
                            const nodeid = 'node/' + domain.id + '/' + parent.crypto.randomBytes(48).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            const device = { type: 'node', _id: nodeid, meshid: mesh._id, mtype: 1, icon: 1, host: importDev.host, domain: domain.id, intelamt: { user: 'admin', state: 2 } };
                            if (typeof importDev.name == 'string') { device.name = importDev.name; } else { device.name = importDev.host; }

                            // Add optional fields
                            if (typeof importDev.user == 'string') { device.intelamt.user = importDev.user; }
                            if (typeof importDev.pass == 'string') { device.intelamt.pass = importDev.pass; }
                            if ((importDev.tls === true) || (importDev.tls === 1)) { device.intelamt.tls = 1; }
                            if (typeof importDev.digestrealm == 'string') { device.intelamt.realm = importDev.digestrealm; }
                            if (typeof importDev.ver == 'string') { device.intelamt.ver = importDev.ver; }
                            if (typeof importDev.uuid == 'string') { device.intelamt.uuid = importDev.uuid; }
                            if (typeof importDev.pstate == 'number') { device.intelamt.state = importDev.pstate; }
                            if (typeof importDev.tlscerthash == 'string') { device.intelamt.hash = importDev.tlscerthash; }
                            if (typeof importDev.icon == 'number') { device.icon = importDev.icon; }
                            if (typeof importDev.desc == 'string') { device.desc = importDev.desc; }

                            // Check if we are already adding a device with the same hostname, if so, skip it.
                            var skip = false;
                            for (var i in amtDevices) { if (amtDevices[i].host.toLowerCase() == device.host.toLowerCase()) { skip = true; } }
                            if (skip == false) { amtDevices.push(device); }
                        }
                    }
                }

                // Decode a JSON file in simple format
                if (Array.isArray(command.amtdevices)) {
                    for (var i in command.amtdevices) {
                        const importDev = command.amtdevices[i];
                        if ((typeof importDev.fqdn == 'string') && (importDev.fqdn != '') && (importDev.fqdn != '127.0.0.1') && (importDev.fqdn.toLowerCase() != 'localhost')) {
                            // Create a new Intel AMT device
                            const nodeid = 'node/' + domain.id + '/' + parent.crypto.randomBytes(48).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            const device = { type: 'node', _id: nodeid, meshid: mesh._id, mtype: 1, icon: 1, host: importDev.fqdn, domain: domain.id, intelamt: { user: 'admin', state: 2 } };
                            if (typeof importDev.name == 'string') { device.name = importDev.name; } else { device.name = importDev.host; }

                            // Add optional fields
                            if (typeof importDev.username == 'string') { device.intelamt.user = importDev.username; }
                            if (typeof importDev.password == 'string') { device.intelamt.pass = importDev.password; }
                            if ((importDev.tls === true) || (importDev.tls === 1)) { device.intelamt.tls = 1; }
                            if (typeof importDev.version == 'string') { device.intelamt.ver = importDev.version; }
                            if (typeof importDev.digestrealm == 'string') { device.intelamt.realm = importDev.digestrealm; }
                            if (typeof importDev.uuid == 'string') { device.intelamt.uuid = importDev.uuid; }
                            if (typeof importDev.pstate == 'number') { device.intelamt.state = importDev.pstate; }
                            if (typeof importDev.tlscerthash == 'string') { device.intelamt.hash = importDev.tlscerthash; }
                            if (typeof importDev.icon == 'number') { device.icon = importDev.icon; }
                            if (typeof importDev.desc == 'string') { device.desc = importDev.desc; }

                            // Check if we are already adding a device with the same hostname, if so, skip it.
                            var skip = false;
                            for (var i in amtDevices) { if (amtDevices[i].host.toLowerCase() == device.host.toLowerCase()) { skip = true; } }
                            if (skip == false) { amtDevices.push(device); }
                        }
                    }
                }

                // Add all the correctly parsed devices to the database and event them
                // TODO: We may want to remove any devices with duplicate hostnames
                if (amtDevices.length == 0) return;
                for (var i in amtDevices) {
                    // Save the device to the database
                    db.Set(amtDevices[i]);
                    // Event the new node
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, [nodeid]), obj, { etype: 'node', userid: user._id, username: user.name, action: 'addnode', node: parent.CloneSafeNode(amtDevices[i]), msgid: 84, msgArgs: [amtDevices[i].name, mesh.name], msg: 'Added device ' + amtDevices[i].name + ' to device group ' + mesh.name, domain: domain.id });
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

    const serverCommands = {
        'adddeviceuser': serverCommandAddDeviceUser,
        'addmeshuser': serverCommandAddMeshUser,
        'adduser': serverCommandAddUser,
        'adduserbatch': serverCommandAddUserBatch,
        'addusertousergroup': serverCommandAddUserToUserGroup,
        'agentdisconnect': serverCommandAgentDisconnect,
        'authcookie': serverCommandAuthCookie,
        'changeemail': serverCommandChangeEmail,
        'changelang': serverCommandChangeLang,
        'close': serverCommandClose,
        'confirmPhone': serverCommandConfirmPhone,
        'confirmMessaging': serverCommandConfirmMessaging,
        'emailuser': serverCommandEmailUser,
        'files': serverCommandFiles,
        'getClip': serverCommandGetClip,
        'getcookie': serverCommandGetCookie,
        'getnetworkinfo': serverCommandGetNetworkInfo,
        'getsysinfo': serverCommandGetSysInfo,
        'intersession': serverCommandInterSession,
        'interuser': serverCommandInterUser,
        'lastconnect': serverCommandLastConnect,
        'lastconnects': serverCommandLastConnects,
        'logincookie': serverCommandLoginCookie,
        'meshes': serverCommandMeshes,
        'ping': serverCommandPing,
        'pong': serverCommandPong,
        'powertimeline': serverCommandPowerTimeline,
        'print': serverCommandPrint,
        'removePhone': serverCommandRemovePhone,
        'removeMessaging': serverCommandRemoveMessaging,
        'removeuserfromusergroup': serverCommandRemoveUserFromUserGroup,
        'report': serverCommandReport,
        'serverclearerrorlog': serverCommandServerClearErrorLog,
        'serverconsole': serverCommandServerConsole,
        'servererrors': serverCommandServerErrors,
        'serverstats': serverCommandServerStats,
        'servertimelinestats': serverCommandServerTimelineStats,
        'serverupdate': serverCommandServerUpdate,
        'serverversion': serverCommandServerVersion,
        'setClip': serverCommandSetClip,
        'smsuser': serverCommandSmsUser,
        'msguser': serverCommandMsgUser,
        'trafficdelta': serverCommandTrafficDelta,
        'trafficstats': serverCommandTrafficStats,
        'updateAgents': serverCommandUpdateAgents,
        'updateUserImage': serverCommandUpdateUserImage,
        'urlargs': serverCommandUrlArgs,
        'users': serverCommandUsers,
        'verifyemail': serverCommandVerifyEmail,
        'verifyPhone': serverCommandVerifyPhone,
        'verifyMessaging': serverCommandVerifyMessaging
    };

    const serverUserCommands = {
        '2falock': [serverUserCommand2faLock, "Shows and changes the 2FA lock state"],
        'acceleratorsstats': [serverUserCommandAcceleratorsStats, "Show data on work being offloaded to other CPU's"],
        'agentissues': [serverUserCommandAgentIssues, ""],
        'agentstats': [serverUserCommandAgentStats, ""],
        'amtacm': [serverUserCommandAmtAcm, ""],
        'amtmanager': [serverUserCommandAmtManager, ""],
        'amtpasswords': [serverUserCommandAmtPasswords, ""],
        'amtstats': [serverUserCommandAmtStats, ""],
        'args': [serverUserCommandArgs, ""],
        'autobackup': [serverUserCommandAutoBackup, ""],
        'backupconfig': [serverUserCommandBackupConfig, ""],
        'badlogins': [serverUserCommandBadLogins, "Displays or resets the invalid login rate limiting table."],
        'bad2fa': [serverUserCommandBad2fa, "Displays or resets the invalid 2FA rate limiting table."],
        'certexpire': [serverUserCommandCertExpire, ""],
        'certhashes': [serverUserCommandCertHashes, ""],
        'closeusersessions': [serverUserCommandCloseUserSessions, "Disconnects all sessions for a specified user."],
        'cores': [serverUserCommandCores, ""],
        'dbcounters': [serverUserCommandDbCounters, ""],
        'dbstats': [serverUserCommandDbStats, ""],
        'dispatchtable': [serverUserCommandDispatchTable, ""],
        'dropallcira': [serverUserCommandDropAllCira, ""],
        'dupagents': [serverUserCommandDupAgents, ""],
        'email': [serverUserCommandEmail, ""],
        'emailnotifications': [serverUserCommandEmailNotifications, ""],
        'msgnotifications': [serverUserCommandMessageNotifications, ""],
        'firebase': [serverUserCommandFirebase, ""],
        'heapdump': [serverUserCommandHeapDump, ""],
        'heapdump2': [serverUserCommandHeapDump2, ""],
        'help': [serverUserCommandHelp, ""],
        'info': [serverUserCommandInfo, "Returns the most immidiatly useful information about this server, including MeshCentral and NodeJS versions. This is often information required to file a bug."],
        'le': [serverUserCommandLe, ""],
        'lecheck': [serverUserCommandLeCheck, ""],
        'leevents': [serverUserCommandLeEvents, ""],
        'maintenance': [serverUserCommandMaintenance, ""],
        'migrationagents': [serverUserCommandMigrationAgents, ""],
        'mps': [serverUserCommandMps, ""],
        'mpsstats': [serverUserCommandMpsStats, ""],
        'nodeconfig': [serverUserCommandNodeConfig, ""],
        'print': [serverUserCommandPrint, ""],
        'relays': [serverUserCommandRelays, ""],
        'removeinactivedevices': [serverUserCommandRemoveInactiveDevices, ""],
        'resetserver': [serverUserCommandResetServer, "Causes the server to reset, this is sometimes useful is the config.json file was changed."],
        'serverupdate': [serverUserCommandServerUpdate, "Updates server to latest version. Optional version argument to install specific version. Example: serverupdate 0.8.49"],
        'setmaxtasks': [serverUserCommandSetMaxTasks, ""],
        'showpaths': [serverUserCommandShowPaths, ""],
        'sms': [serverUserCommandSMS, "Send a SMS message to a specified phone number"],
        'msg': [serverUserCommandMsg, "Send a user message to a user handle"],
        'swarmstats': [serverUserCommandSwarmStats, ""],
        'tasklimiter': [serverUserCommandTaskLimiter, "Returns the internal status of the tasklimiter. This is a system used to smooth out work done by the server. It's used by, for example, agent updates so that not all agents are updated at the same time."],
        'trafficdelta': [serverUserCommandTrafficDelta, ""],
        'trafficstats': [serverUserCommandTrafficStats, ""],
        'updatecheck': [serverUserCommandUpdateCheck, ""],
        'usersessions': [serverUserCommandUserSessions, "Returns a list of active sessions grouped by user."],
        'versions': [serverUserCommandVersions, "Returns all internal versions for NodeJS running this server."],
        'watchdog': [serverUserCommandWatchdog, ""],
        'webpush': [serverUserCommandWebPush, ""],
        'webstats': [serverUserCommandWebStats, ""]
    };

    function serverCommandAddDeviceUser(command) {
        if (typeof command.userid == 'string') { command.userids = [command.userid]; }
        var err = null;
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
            if (command.responseid != null) { obj.send({ action: 'adddeviceuser', responseid: command.responseid, result: err }); }
            return;
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
                        node.links[newuserid] = { rights: command.rights };
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
                    event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msgid: 81, msgArgs: [node.name], msg: 'Removed user device rights for ' + node.name, node: parent.CloneSafeNode(node) };
                } else {
                    event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msgid: 82, msgArgs: [node.name], msg: 'Changed user device rights for ' + node.name, node: parent.CloneSafeNode(node) };
                }
                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                parent.parent.DispatchEvent(dispatchTargets, obj, event);
            }
    
            if (command.responseid != null) { obj.send({ action: 'adddeviceuser', responseid: command.responseid, result: 'ok' }); }
        });
    }

    function serverCommandAddMeshUser(command) {
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
            if (common.validateString(command.meshid, 8, 134) == false) { err = 'Invalid groupid'; } // Check the meshid
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
            if (command.responseid != null) { obj.send({ action: 'addmeshuser', responseid: command.responseid, result: err }); }
            return;
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
    
        if (command.responseid != null) { obj.send({ action: 'addmeshuser', responseid: command.responseid, result: msgs.join(', '), success: successCount, failed: failCount }); }
    }

    function serverCommandAddUser(command) {
        // If the email is the username, set this here.
        if (domain.usernameisemail) { if (command.email) { command.username = command.email; } else { command.email = command.username; } }

        // Randomize the password if needed
        if (command.randomPassword === true) { command.pass = getRandomPassword(); }

        // Add a new user account
        var err = null, errid = 0, args = null, newusername, newuserid, newuserdomain;
        try {
            if ((user.siteadmin & MESHRIGHT_MANAGEUSERS) == 0) { err = "Permission denied"; errid = 1; }
            else if (common.validateUsername(command.username, 1, 256) == false) { err = "Invalid username"; errid = 2; } // Username is between 1 and 64 characters, no spaces
            else if ((command.username[0] == '~') || (command.username.indexOf('/') >= 0)) { err = "Invalid username"; errid = 2; } // Usernames cant' start with ~ and can't have '/'
            else if (common.validateString(command.pass, 1, 256) == false) { err = "Invalid password"; errid = 3; } // Password is between 1 and 256 characters
            else if ((command.randomPassword !== true) && (common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false)) { err = "Invalid password"; errid = 3; } // Password does not meet requirements
            else if ((command.email != null) && (common.validateEmail(command.email, 1, 1024) == false)) { err = "Invalid email"; errid = 4; } // Check if this is a valid email address
            else if ((obj.crossDomain === true) && (command.domain != null) && ((typeof command.domain != 'string') || (parent.parent.config.domains[command.domain] == null))) { err = "Invalid domain"; errid = 5; } // Check if this is a valid domain
            else if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains) && !common.validateEmailDomain(command.email, domain.newaccountemaildomains)) { err = "Email domain is not allowed. Only (" + domain.newaccountemaildomains.join(', ') + ") are allowed."; errid=30; args = [common.getEmailDomain(command.email), domain.newaccountemaildomains.join(', ')]; }
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
                obj.send({ action: 'adduser', responseid: command.responseid, result: err, msgid: errid });
            } else {
                // Send error back, user not found.
                displayNotificationMessage(err, "New Account", 'ServerNotify', 1, errid, args);
            }
            return;
        }

        // Check if we exceed the maximum number of user accounts
        db.isMaxType(newuserdomain.limits.maxuseraccounts, 'user', newuserdomain.id, function (maxExceed) {
            if (maxExceed) {
                // Account count exceed, do notification
                if (command.responseid != null) {
                    // Respond privately if requested
                    obj.send({ action: 'adduser', responseid: command.responseid, result: 'maxUsersExceed' });
                } else {
                    // Create the notification message
                    var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: newuserdomain.id, titleid: 2, msgid: 10 };

                    // Get the list of sessions for this user
                    var sessions = parent.wssessions[user._id];
                    if (sessions != null) { for (var i in sessions) { try { if (sessions[i].domainid == newuserdomain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
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
                            domain.mailserver.sendAccountInviteMail(newuserdomain, (user.realname ? user.realname : user.name), newusername, command.email.toLowerCase(), command.pass, parent.getLanguageCodes(req), req.query.key);
                        }

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created a user account ' + newuser.name); }

                        // OK Response
                        if (command.responseid != null) { obj.send({ action: 'adduser', responseid: command.responseid, result: 'ok' }); }
                    } else {
                        if (command.responseid != null) { obj.send({ action: 'adduser', responseid: command.responseid, result: 'passwordHashError' }); }
                    }
                }, 0);
            }
        });
    }

    function serverCommandAddUserBatch(command) {
        var err = null;

        // Add many new user accounts
        if ((user.siteadmin & 2) == 0) { err = 'Access denied'; }
        else if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { err = 'Unable to create users when in SSPI or LDAP mode'; }
        else if (!Array.isArray(command.users)) { err = 'Invalid users'; }
        else {
            var userCount = 0;
            for (var i in command.users) {
                if (domain.usernameisemail) { if (command.users[i].email) { command.users[i].user = command.users[i].email; } else { command.users[i].email = command.users[i].user; } } // If the email is the username, set this here.
                if (common.validateUsername(command.users[i].user, 1, 256) == false) { err = 'Invalid username'; } // Username is between 1 and 64 characters, no spaces
                if ((command.users[i].user[0] == '~') || (command.users[i].user.indexOf('/') >= 0)) { err = 'Invalid username'; } // This is a reserved user name or invalid name
                if (common.validateString(command.users[i].pass, 1, 256) == false) { err = 'Invalid password'; } // Password is between 1 and 256 characters
                if (common.checkPasswordRequirements(command.users[i].pass, domain.passwordrequirements) == false) { err = 'Invalid password'; } // Password does not meet requirements
                if ((command.users[i].email != null) && (common.validateEmail(command.users[i].email, 1, 1024) == false)) { err = 'Invalid email'; } // Check if this is a valid email address
                userCount++;
            }
        }

        // Handle any errors
        if (err != null) {
            if (command.responseid != null) { obj.send({ action: 'adduserbatch', responseid: command.responseid, result: err }); }
            return;
        }

        // Check if we exceed the maximum number of user accounts
        db.isMaxType(domain.limits.maxuseraccounts + userCount, 'user', domain.id, function (maxExceed) {
            if (maxExceed) {
                // Account count exceed, do notification

                // Create the notification message
                var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: domain.id, titleid: 2, msgid: 10 };

                // Get the list of sessions for this user
                var sessions = parent.wssessions[user._id];
                if (sessions != null) { for (var i in sessions) { try { if (sessions[i].domainid == domain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
                // TODO: Notify all sessions on other peers.
            } else {
                for (var i in command.users) {
                    // Check if this is an existing user
                    var newuserid = 'user/' + domain.id + '/' + command.users[i].user.toLowerCase();
                    var newuser = { type: 'user', _id: newuserid, name: command.users[i].user, creation: Math.floor(Date.now() / 1000), domain: domain.id };
                    if (domain.newaccountsrights) { newuser.siteadmin = domain.newaccountsrights; }
                    if (common.validateString(command.users[i].realname, 1, 256)) { newuser.realname = command.users[i].realname; }
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
    }

    function serverCommandAddUserToUserGroup(command) {
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
            if (command.responseid != null) { obj.send({ action: 'addusertousergroup', responseid: command.responseid, result: err }); }
            return;
        }

        // Get the user group
        var group = parent.userGroups[command.ugrpid];
        if (group != null) {
            // If this user group is an externally managed user group, we can't add users to it.
            if ((group != null) && (group.membershipType != null)) return;

            if (group.links == null) { group.links = {}; }

            var unknownUsers = [], addedCount = 0, failCount = 0, knownUsers = [];
            for (var i in command.usernames) {
                // Check if the user exists
                var chguserid = 'user/' + addUserDomain.id + '/' + command.usernames[i].toLowerCase();
                var chguser = parent.users[chguserid];
                if (chguser == null) { chguserid = 'user/' + addUserDomain.id + '/' + command.usernames[i]; chguser = parent.users[chguserid]; }
                if (chguser != null) {
                    // Add usr group to user
                    if (chguser.links == null) { chguser.links = {}; }
                    chguser.links[group._id] = { rights: 1 };
                    db.SetUser(chguser);
                    parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');

                    knownUsers.push(chguser);
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
                var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msgid: 71, msgArgs: [knownUsers.map((u)=>u.name), group.name], msg: 'Added user(s) ' + knownUsers.map((u)=>u.name) + ' to user group ' + group.name, addUserDomain: domain.id };
                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                parent.parent.DispatchEvent(['*', group._id, user._id, chguserid], obj, event);
            }

            if (unknownUsers.length > 0) {
                // Send error back, user not found.
                displayNotificationMessage('User' + ((unknownUsers.length > 1) ? 's' : '') + ' ' + EscapeHtml(unknownUsers.join(', ')) + ' not found.', "Device Group", 'ServerNotify', 5, (unknownUsers.length > 1) ? 16 : 15, [EscapeHtml(unknownUsers.join(', '))]);
            }
        }

        if (command.responseid != null) { obj.send({ action: 'addusertousergroup', responseid: command.responseid, result: 'ok', added: addedCount, failed: failCount }); }
    }

    function serverCommandAgentDisconnect(command) {
        if (common.validateInt(command.disconnectMode) == false) return; // Check disconnect mode

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((node == null) || (((rights & MESHRIGHT_AGENTCONSOLE) == 0) && (user.siteadmin != SITERIGHT_ADMIN))) return;

            // Force mesh agent disconnection
            parent.forceMeshAgentDisconnect(user, domain, node._id, command.disconnectMode);
        });
    }

    function serverCommandAuthCookie(command) {
        try {
            ws.send(JSON.stringify({
                action: 'authcookie',
                cookie: parent.parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: req.clientIp }, parent.parent.loginCookieEncryptionKey),
                rcookie: parent.parent.encodeCookie({ ruserid: user._id, x: req.session.x }, parent.parent.loginCookieEncryptionKey)
            }));
        } catch (ex) { }
    }

    function serverCommandChangeEmail(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

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
                    obj.send({ action: 'msg', type: 'notify', title: 'Account Settings', id: Math.random(), tag: 'ServerNotify', value: 'Failed to change email address, another account already using: ' + command.email + '.', titleid: 4, msgid: 13, args: [command.email] });
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
                    if (domain.mailserver != null) { domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, parent.getLanguageCodes(req), req.query.key); }
                }
            });
        }
    }

    function serverCommandChangeLang(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

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
    }

    function serverCommandClose(command) {
        // Close the web socket session
        try { if (obj.req.session.ws == ws) delete obj.req.session.ws; } catch (e) { }
        try { ws.close(); } catch (e) { }
    }

    function serverCommandConfirmPhone(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if ((parent.parent.smsserver == null) || (typeof command.cookie != 'string') || (typeof command.code != 'string') || (obj.failedSmsCookieCheck == 1)) return; // Input checks
        var cookie = parent.parent.decodeCookie(command.cookie);
        if (cookie == null) return; // Invalid cookie
        if (cookie.s != ws.sessionId) return; // Invalid session
        if (cookie.c != command.code) {
            obj.failedSmsCookieCheck = 1;
            // Code does not match, delay the response to limit how many guesses we can make and don't allow more than 1 guess at any given time.
            setTimeout(function () {
                ws.send(JSON.stringify({ action: 'verifyPhone', cookie: command.cookie, success: true }));
                delete obj.failedSmsCookieCheck;
            }, 2000 + (parent.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        // Set the user's phone
        user.phone = cookie.p;
        db.SetUser(user);

        // Event the change
        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 96, msgArgs: [user.name], msg: 'Verified phone number of user ' + EscapeHtml(user.name), domain: domain.id };
        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
        parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
    }

    function serverCommandConfirmMessaging(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if ((parent.parent.msgserver == null) || (typeof command.cookie != 'string') || (typeof command.code != 'string') || (obj.failedMsgCookieCheck == 1)) return; // Input checks
        var cookie = parent.parent.decodeCookie(command.cookie);
        if (cookie == null) return; // Invalid cookie
        if (cookie.s != ws.sessionId) return; // Invalid session
        if (cookie.c != command.code) {
            obj.failedMsgCookieCheck = 1;
            // Code does not match, delay the response to limit how many guesses we can make and don't allow more than 1 guess at any given time.
            setTimeout(function () {
                ws.send(JSON.stringify({ action: 'verifyMessaging', cookie: command.cookie, success: true }));
                delete obj.failedMsgCookieCheck;
            }, 2000 + (parent.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        // Set the user's messaging handle
        user.msghandle = cookie.p;
        db.SetUser(user);

        // Event the change
        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 156, msgArgs: [user.name], msg: 'Verified messaging account of user ' + EscapeHtml(user.name), domain: domain.id };
        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
        parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
    }

    function serverCommandEmailUser(command) {
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

        if (errMsg != null) { displayNotificationMessage(errMsg); return; }
        domain.mailserver.sendMail(emailuser.email, command.subject, command.msg);
        displayNotificationMessage("Email sent.", null, null, null, 14);
    }

    function serverCommandFiles(command) {
        // Send the full list of server files to the browser app
        updateUserFiles(user, ws, domain);
    }

    function serverCommandGetClip(command) {
        if (common.validateString(command.nodeid, 1, 1024) == false) return; // Check nodeid

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((rights & MESHRIGHT_REMOTECONTROL) == 0) return;

            // Ask for clipboard data from agent
            var agent = parent.wsagents[node._id];
            if (agent != null) { try { agent.send(JSON.stringify({ action: 'getClip' })); } catch (ex) { } }
        });
    }

    function serverCommandGetCookie(command) {
        // Check if this user has rights on this nodeid
        if (common.validateString(command.nodeid, 1, 1024) == false) return; // Check nodeid
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((node == null) || ((rights & MESHRIGHT_REMOTECONTROL) == 0) || (visible == false)) return; // Access denied.

            // Add a user authentication cookie to a url
            var cookieContent = { userid: user._id, domainid: user.domain };
            if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
            if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want the agent to TCP connect to a remote address
            if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want the agent to TCP connect to a remote port
            if (node.mtype == 3) { cookieContent.lc = 1; command.localRelay = true; } // Indicate this is for a local connection
            command.cookie = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
            command.trustedCert = parent.isTrustedCert(domain);
            obj.send(command);
        });
    }

    function serverCommandGetNetworkInfo(command) {
        if (!validNodeIdAndDomain(command)) return;

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((visible == false) || ((rights & MESHRIGHT_DEVICEDETAILS) == 0)) { obj.send({ action: 'getnetworkinfo', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' }); return; }

            // Get network information about this node
            db.Get('if' + node._id, function (err, netinfos) {
                if ((netinfos == null) || (netinfos.length != 1)) { obj.send({ action: 'getnetworkinfo', nodeid: node._id, netif: null, netif2: null }); return; }
                var netinfo = netinfos[0];

                // Unescape any field names that have special characters if needed
                if (netinfo.netif2 != null) {
                    for (var i in netinfo.netif2) {
                        var esc = common.unEscapeFieldName(i);
                        if (esc !== i) { netinfo.netif2[esc] = netinfo.netif2[i]; delete netinfo.netif2[i]; }
                    }
                }

                obj.send({ action: 'getnetworkinfo', nodeid: node._id, updateTime: netinfo.updateTime, netif: netinfo.netif, netif2: netinfo.netif2 });
            });
        });
    }

    function serverCommandGetSysInfo(command) {
        if (!validNodeIdAndDomain(command)) return;

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((visible == false) || ((rights & MESHRIGHT_DEVICEDETAILS) == 0)) { obj.send({ action: 'getsysinfo', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' }); return; }
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
                    obj.send(doc);
                } else {
                    obj.send({ action: 'getsysinfo', nodeid: node._id, tag: command.tag, noinfo: true, result: 'Invalid device id' });
                }
            });
        });
    }

    function serverCommandInterSession(command) {
        // Sends data between sessions of the same user
        var sessions = parent.wssessions[obj.user._id];
        if (sessions == null) return;

        // Create the notification message and send on all sessions except our own (no echo back).
        var notification = JSON.stringify(command);
        for (var i in sessions) { if (sessions[i] != obj.ws) { try { sessions[i].send(notification); } catch (ex) { } } }
        // TODO: Send the message of user sessions connected to other servers.
    }

    function serverCommandInterUser(command) {
        // Sends data between users only if allowed. Only a user in the "interUserMessaging": [] list, in the settings section of the config.json can receive and send inter-user messages from and to all users.
        if ((parent.parent.config.settings.interusermessaging == null) || (parent.parent.config.settings.interusermessaging == false) || (command.data == null)) return;
        if (typeof command.sessionid == 'string') { var userSessionId = command.sessionid.split('/'); if (userSessionId.length != 4) return; command.userid = userSessionId[0] + '/' + userSessionId[1] + '/' + userSessionId[2]; }
        if (common.validateString(command.userid, 0, 2014) == false) return;
        var userSplit = command.userid.split('/');
        if (userSplit.length == 1) { command.userid = 'user/' + domain.id + '/' + command.userid; userSplit = command.userid.split('/'); }
        if ((userSplit.length != 3) || (userSplit[0] != 'user') || (userSplit[1] != domain.id) || (parent.users[command.userid] == null)) return; // Make sure the target userid is valid and within the domain
        const allowed = ((parent.parent.config.settings.interusermessaging === true) || (parent.parent.config.settings.interusermessaging.indexOf(obj.user._id) >= 0) || (parent.parent.config.settings.interusermessaging.indexOf(command.userid) >= 0));
        if (allowed == false) return;

        // Get sessions
        var sessions = parent.wssessions[command.userid];
        if (sessions == null) return;

        // Create the notification message and send on all sessions except our own (no echo back).
        var notification = JSON.stringify({ action: 'interuser', sessionid: ws.sessionId, data: command.data, scope: (command.sessionid != null)?'session':'user' });
        for (var i in sessions) {
            if ((command.sessionid != null) && (sessions[i].sessionId != command.sessionid)) continue; // Send to a specific session
            if (sessions[i] != obj.ws) { try { sessions[i].send(notification); } catch (ex) { } }
        }
        // TODO: Send the message of user sessions connected to other servers.
    }

    function serverCommandLastConnect(command) {
        if (!validNodeIdAndDomain(command)) return;

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if (visible == false) { obj.send({ action: 'lastconnect', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' }); return; }

            // Query the database for the last time this node connected
            db.Get('lc' + command.nodeid, function (err, docs) {
                if ((docs != null) && (docs.length > 0)) {
                    obj.send({ action: 'lastconnect', nodeid: command.nodeid, time: docs[0].time, addr: docs[0].addr });
                } else {
                    obj.send({ action: 'lastconnect', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'No data' });
                }
            });
        });
    }

    function serverCommandLastConnects(command) {
        if (obj.visibleDevices == null) {
            // If we are not paging, get all devices visible to this user
            const links = parent.GetAllMeshIdWithRights(user);
            const extraids = getUserExtraIds();
            db.GetAllTypeNoTypeFieldMeshFiltered(links, extraids, domain.id, 'node', null, obj.deviceSkip, obj.deviceLimit, function (err, docs) {
                if (docs == null) return;

                // Create a list of node ids for this user and query them for last device connection time
                const ids = []
                for (var i in docs) { ids.push('lc' + docs[i]._id); }

                // Pull list of last connections only for device owned by this user
                db.GetAllIdsOfType(ids, domain.id, 'lastconnect', function (err, docs) {
                    if (docs == null) return;
                    const response = {};
                    for (var j in docs) { response[docs[j]._id.substring(2)] = docs[j].time; }
                    obj.send({ action: 'lastconnects', lastconnects: response, tag: command.tag });
                });
            });
        } else {
            // If we are paging, we know what devices the user is look at
            // Create a list of node ids for this user and query them for last device connection time
            const ids = []
            for (var i in obj.visibleDevices) { ids.push('lc' + i); }

            // Pull list of last connections only for device owned by this user
            db.GetAllIdsOfType(ids, domain.id, 'lastconnect', function (err, docs) {
                if (docs == null) return;
                const response = {};
                for (var j in docs) { response[docs[j]._id.substring(2)] = docs[j].time; }
                obj.send({ action: 'lastconnects', lastconnects: response, tag: command.tag });
            });
        }
    }

    function serverCommandLoginCookie(command) {
        // If allowed, return a login cookie
        if (parent.parent.config.settings.allowlogintoken === true) {
            obj.send({ action: 'logincookie', cookie: parent.parent.encodeCookie({ u: user._id, a: 3 }, parent.parent.loginCookieEncryptionKey) });
        }
    }

    function serverCommandMeshes(command) {
        // Request a list of all meshes this user as rights to
        obj.send({ action: 'meshes', meshes: parent.GetAllMeshWithRights(user).map(parent.CloneSafeMesh), tag: command.tag });
    }

    function serverCommandPing(command) { try { ws.send('{action:"pong"}'); } catch (ex) { } }
    function serverCommandPong(command) { } // NOP

    function serverCommandPowerTimeline(command) {
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
                    obj.send({ action: 'powertimeline', nodeid: node._id, timeline: timeline, tag: command.tag });
                } else {
                    // No records found, send current state if we have it
                    var state = parent.parent.GetConnectivityState(command.nodeid);
                    if (state != null) { obj.send({ action: 'powertimeline', nodeid: node._id, timeline: [state.powerState, Date.now(), state.powerState], tag: command.tag }); }
                }
            });
        });
    }

    function serverCommandPrint(command) { console.log(command.value); }

    function serverCommandRemovePhone(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if (user.phone == null) return;

        // Clear the user's phone
        delete user.phone;
        db.SetUser(user);

        // Event the change
        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 97, msgArgs: [user.name], msg: 'Removed phone number of user ' + EscapeHtml(user.name), domain: domain.id };
        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
        parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
    }

    function serverCommandRemoveMessaging(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if (user.msghandle == null) return;

        // Clear the user's phone
        delete user.msghandle;
        db.SetUser(user);

        // Event the change
        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 157, msgArgs: [user.name], msg: 'Removed messaging account of user ' + EscapeHtml(user.name), domain: domain.id };
        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
        parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
    }

    function serverCommandRemoveUserFromUserGroup(command) {
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
            if (command.responseid != null) { obj.send({ action: 'removeuserfromusergroup', responseid: command.responseid, result: err }); }
            return;
        }

        // Check if the user exists
        if (command.userid.startsWith('user/') == false) {
            if (parent.users['user/' + removeUserDomain.id + '/' + command.userid.toLowerCase()] != null) { command.userid = 'user/' + removeUserDomain.id + '/' + command.userid.toLowerCase(); }
            else if (parent.users['user/' + removeUserDomain.id + '/' + command.userid] != null) { command.userid = 'user/' + removeUserDomain.id + '/' + command.userid; }
        }

        var chguser = parent.users[command.userid];
        if (chguser != null) {
            // Get the user group
            var group = parent.userGroups[command.ugrpid];

            // If this user group is an externally managed user group, we can't remove a user from it.
            if ((group != null) && (group.membershipType != null)) return;

            if ((chguser.links != null) && (chguser.links[command.ugrpid] != null)) {
                delete chguser.links[command.ugrpid];

                // Notify user change
                var targets = ['*', 'server-users', user._id, chguser._id];
                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 67, msgArgs: [chguser.name], msg: 'User group membership changed: ' + chguser.name, domain: removeUserDomain.id };
                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                parent.parent.DispatchEvent(targets, obj, event);

                db.SetUser(chguser);
                parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
            }

            if (group != null) {
                // Remove the user from the group
                if ((group.links != null) && (group.links[command.userid] != null)) {
                    delete group.links[command.userid];
                    db.Set(group);

                    // Notify user group change
                    var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msgid: 72, msgArgs: [chguser.name, group.name], msg: 'Removed user ' + chguser.name + ' from user group ' + group.name, domain: removeUserDomain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                    parent.parent.DispatchEvent(['*', group._id, user._id, chguser._id], obj, event);
                }
            }
        }

        if (command.responseid != null) { obj.send({ action: 'removeuserfromusergroup', responseid: command.responseid, result: 'ok' }); }
    }

    function serverCommandReport(command) {
        if (common.validateInt(command.type, 1, 4) == false) return; // Validate type
        if (common.validateInt(command.groupBy, 1, 3) == false) return; // Validate groupBy: 1 = User, 2 = Device, 3 = Day
        if ((typeof command.start != 'number') || (typeof command.end != 'number') || (command.start >= command.end)) return; // Validate start and end time
        const manageAllDeviceGroups = ((user.siteadmin == 0xFFFFFFFF) && (parent.parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0));
        if ((command.devGroup != null) && (manageAllDeviceGroups == false) && ((user.links == null) || (user.links[command.devGroup] == null))) return; // Asking for a device group that is not allowed

        const msgIdFilter = [5, 10, 11, 12, 122, 123, 124, 125, 126];
        switch (command.type) {
            case 1: {
                remoteSessionReport(command, manageAllDeviceGroups, msgIdFilter);
                break;
            }
            case 2: {
                trafficUsageReport(command, msgIdFilter);
                break;
            }
            case 3: {
                userLoginReport(command);
                break;
            }   
            case 4: {
                databaseRecordsReport(command);
                break;
            }   
        }
    }

    function serverCommandServerClearErrorLog(command) {
        // Clear the server error log if user has site update permissions
        if (userHasSiteUpdate()) { fs.unlink(parent.parent.getConfigFilePath('mesherrors.txt'), function (err) { }); }
    }

    function serverCommandServerConsole(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;
        // This is a server console message, only process this if full administrator
        if (user.siteadmin != SITERIGHT_ADMIN) return;
        // Only accept if the console is allowed for this domain
        if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.console !== true))) return;

        var cmdargs = splitArgs(command.value);
        if (cmdargs.length == 0) return;
        const cmd = cmdargs[0].toLowerCase();
        cmdargs = parseArgs(cmdargs);
        var cmdData = { result: '', command: command, cmdargs: cmdargs };

        // Find the command in the lookup table and run it.
        var cmdTableEntry = serverUserCommands[cmd];
        if (cmdTableEntry != null) { try { cmdTableEntry[0](cmdData); } catch (ex) { cmdData.result = '' + ex; }
        } else { cmdData.result = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.'; }

        // Send back the command result
        if (cmdData.result != '') { obj.send({ action: 'serverconsole', value: cmdData.result, tag: command.tag }); }
    }

    function serverCommandServerErrors(command) {
        // Load the server error log
        if (userHasSiteUpdate() && domainHasMyServerErrorLog())
            fs.readFile(parent.parent.getConfigFilePath('mesherrors.txt'), 'utf8', function (err, data) { obj.send({ action: 'servererrors', data: data }); });
    }

    function serverCommandServerStats(command) {
        // Only accept if the "My Server" tab is allowed for this domain
        if (domain.myserver === false) return;

        if ((user.siteadmin & 21) == 0) return; // Only site administrators with "site backup" or "site restore" or "site update" permissions can use this.
        if (common.validateInt(command.interval, 1000, 1000000) == false) {
            // Clear the timer
            if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); delete obj.serverStatsTimer; }
        } else {
            // Set the timer
            obj.SendServerStats();
            obj.serverStatsTimer = setInterval(obj.SendServerStats, command.interval);
        }
    }

    function serverCommandServerTimelineStats(command) {
        // Only accept if the "My Server" tab is allowed for this domain
        if (domain.myserver === false) return;

        if ((user.siteadmin & 21) == 0) return; // Only site administrators with "site backup" or "site restore" or "site update" permissions can use this.
        if (common.validateInt(command.hours, 0, 24 * 30) == false) return;
        db.GetServerStats(command.hours, function (err, docs) {
            if (err == null) { obj.send({ action: 'servertimelinestats', events: docs }); }
        });
    }

    function serverCommandServerUpdate(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        // Perform server update
        if (userHasSiteUpdate() && domainHasMyServerUpgrade() && !((command.version != null) && (typeof command.version != 'string')))
            parent.parent.performServerUpdate(command.version);
    }

    function serverCommandServerVersion(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        // Check the server version
        if (userHasSiteUpdate() && domainHasMyServerUpgrade())
            parent.parent.getServerTags(function (tags, err) { obj.send({ action: 'serverversion', tags: tags }); });
    }

    function serverCommandSetClip(command) {
        if (common.validateString(command.data, 1, 65535) == false) return; // Check 

        // Get the node and the rights for this node
        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
            if ((rights & MESHRIGHT_REMOTECONTROL) == 0) return;

            // Send clipboard data to the agent
            var agent = parent.wsagents[node._id];
            if (agent != null) { try { agent.send(JSON.stringify({ action: 'setClip', data: command.data })); } catch (ex) { } }
        });
    }

    function serverCommandSmsUser(command) {
        var errMsg = null, smsuser = null;
        if (parent.parent.smsserver == null) { errMsg = "SMS gateway not enabled"; }
        else if ((user.siteadmin & 2) == 0) { errMsg = "No user management rights"; }
        else if (common.validateString(command.userid, 1, 2048) == false) { errMsg = "Invalid username"; }
        else if (common.validateString(command.msg, 1, 160) == false) { errMsg = "Invalid SMS message"; }
        else {
            smsuser = parent.users[command.userid];
            if (smsuser == null) { errMsg = "Invalid username"; }
            else if (smsuser.phone == null) { errMsg = "No phone number for this user"; }
        }

        if (errMsg != null) { displayNotificationMessage(errMsg); return; }

        parent.parent.smsserver.sendSMS(smsuser.phone, command.msg, function (success, msg) {
            if (success) {
                displayNotificationMessage("SMS succesfuly sent.", null, null, null, 27);
            } else {
                if (typeof msg == 'string') { displayNotificationMessage("SMS error: " + msg, null, null, null, 29, [msg]); } else { displayNotificationMessage("SMS error", null, null, null, 28); }
            }
        });
    }

    function serverCommandMsgUser(command) {
        var errMsg = null, msguser = null;
        if ((parent.parent.msgserver == null) || (parent.parent.msgserver.providers == 0)) { errMsg = "Messaging server not enabled"; }
        else if ((user.siteadmin & 2) == 0) { errMsg = "No user management rights"; }
        else if (common.validateString(command.userid, 1, 2048) == false) { errMsg = "Invalid username"; }
        else if (common.validateString(command.msg, 1, 160) == false) { errMsg = "Invalid message"; }
        else {
            msguser = parent.users[command.userid];
            if (msguser == null) { errMsg = "Invalid username"; }
            else if (msguser.msghandle == null) { errMsg = "No messaging service configured for this user"; }
        }

        if (errMsg != null) { displayNotificationMessage(errMsg); return; }

        parent.parent.msgserver.sendMessage(msguser.msghandle, command.msg, domain, function (success, msg) {
            if (success) {
                displayNotificationMessage("Message succesfuly sent.", null, null, null, 32);
            } else {
                if (typeof msg == 'string') { displayNotificationMessage("Messaging error: " + msg, null, null, null, 34, [msg]); } else { displayNotificationMessage("Messaging error", null, null, null, 33); }
            }
        });
    }

    function serverCommandTrafficDelta(command) {
        const stats = parent.getTrafficDelta(obj.trafficStats);
        obj.trafficStats = stats.current;
        obj.send({ action: 'trafficdelta', delta: stats.delta });
    }

    function serverCommandTrafficStats(command) {
        obj.send({ action: 'trafficstats', stats: parent.getTrafficStats() });
    }

    function serverCommandUpdateAgents(command) {
        // Update agents for selected devices
        if (common.validateStrArray(command.nodeids, 1) == false) return; // Check nodeids
        for (var i in command.nodeids) { routeCommandToNode({ action: 'msg', type: 'console', nodeid: command.nodeids[i], value: 'agentupdate' }, MESHRIGHT_ADMIN, 0); }
    }

    function serverCommandUpdateUserImage(command) {
        if (req.session.loginToken != null) return; // Do not allow this command when logged in using a login token

        var uid = user._id;
        if ((typeof command.userid == 'string') && ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0)) { uid = command.userid; }

        var chguser = parent.users[uid], flags = 0, change = 0;
        if (chguser == null) return;
        if (typeof chguser.flags == 'number') { flags = chguser.flags; }

        if (command.image == 0) {
            // Delete the image
            db.Remove('im' + uid);
            if ((flags & 1) != 0) { flags -= 1; change = 1; }
        } else if ((typeof command.image == 'string') && (command.image.length < 600000) && ((command.image.startsWith('data:image/png;base64,') || (command.image.startsWith('data:image/jpeg;base64,'))))) {
            // Save the new image
            db.Set({ _id: 'im' + uid, image: command.image });
            if ((flags & 1) == 0) { flags += 1; }
            change = 1;
        }

        // Update the user if needed
        if (change == 1) {
            chguser.flags = flags;
            db.SetUser(chguser);

            // Event the change
            var targets = ['*', 'server-users', user._id, chguser._id];
            var allTargetGroups = chguser.groups;
            if (allTargetGroups) { for (var i in allTargetGroups) { targets.push('server-users:' + i); } }
            var event = { etype: 'user', userid: uid, username: chguser.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msgid: 66, msgArgs: [chguser.name], msg: 'Account changed: ' + chguser.name, domain: domain.id, accountImageChange: 1 };
            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
            parent.parent.DispatchEvent(targets, obj, event);
        }
    }

    function serverCommandUrlArgs(command) {
        console.log(req.query);
        console.log(command.args);
    }

    function serverCommandUsers(command) {
        // Request a list of all users
        if ((user.siteadmin & 2) == 0) { if (command.responseid != null) { obj.send({ action: 'users', responseid: command.responseid, result: 'Access denied' }); } return; }
        var docs = [];
        for (i in parent.users) {
            if (((obj.crossDomain === true) || (parent.users[i].domain == domain.id)) && (parent.users[i].name != '~')) {
                // If we are part of a user group, we can only see other members of our own group
                if ((obj.crossDomain === true) || (user.groups == null) || (user.groups.length == 0) || ((parent.users[i].groups != null) && (findOne(parent.users[i].groups, user.groups)))) {
                    docs.push(parent.CloneSafeUser(parent.users[i]));
                }
            }
        }
        obj.send({ action: 'users', users: docs, tag: command.tag });
    }

    function serverCommandVerifyEmail(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        // If this account is settings locked, return here.
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return;

        // Send a account email verification email
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) return;
        if (common.validateString(command.email, 3, 1024) == false) return;

        // Always lowercase the email address
        command.email = command.email.toLowerCase();

        if ((domain.mailserver != null) && (obj.user.email.toLowerCase() == command.email)) {
            // Send the verification email
            domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, parent.getLanguageCodes(req), req.query.key);
        }
    }

    function serverCommandVerifyPhone(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if (parent.parent.smsserver == null) return;
        if (common.validateString(command.phone, 1, 18) == false) return; // Check phone length
        if (isPhoneNumber(command.phone) == false) return; // Check phone

        const code = common.zeroPad(getRandomSixDigitInteger(), 6);
        const phoneCookie = parent.parent.encodeCookie({ a: 'verifyPhone', c: code, p: command.phone, s: ws.sessionId });
        parent.parent.smsserver.sendPhoneCheck(domain, command.phone, code, parent.getLanguageCodes(req), function (success) {
            ws.send(JSON.stringify({ action: 'verifyPhone', cookie: phoneCookie, success: success }));
        });
    }

    function serverCommandVerifyMessaging(command) {
        // Do not allow this command when logged in using a login token
        if (req.session.loginToken != null) return;

        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) return; // If this account is settings locked, return here.
        if (parent.parent.msgserver == null) return;
        if (common.validateString(command.handle, 1, 1024) == false) return; // Check handle length

        // Setup the handle for the right messaging service
        var handle = null;
        if ((command.service == 1) && ((parent.parent.msgserver.providers & 1) != 0)) { handle = 'telegram:@' + command.handle; }
        if ((command.service == 4) && ((parent.parent.msgserver.providers & 4) != 0)) { handle = 'discord:' + command.handle; }
        if ((command.service == 8) && ((parent.parent.msgserver.providers & 8) != 0)) { handle = 'xmpp:' + command.handle; }
        if ((command.service == 16) && ((parent.parent.msgserver.providers & 16) != 0)) { handle = parent.parent.msgserver.callmebotUrlToHandle(command.handle); }
        if ((command.service == 32) && ((parent.parent.msgserver.providers & 32) != 0)) { handle = 'pushover:' + command.handle; }
        if ((command.service == 64) && ((parent.parent.msgserver.providers & 64) != 0)) { handle = 'ntfy:' + command.handle; }
        if ((command.service == 128) && ((parent.parent.msgserver.providers & 128) != 0)) { handle = 'zulip:' + command.handle; }
        if (handle == null) return;

        // Send a verification message
        const code = common.zeroPad(getRandomSixDigitInteger(), 6);
        const messagingCookie = parent.parent.encodeCookie({ a: 'verifyMessaging', c: code, p: handle, s: ws.sessionId });
        parent.parent.msgserver.sendMessagingCheck(domain, handle, code, parent.getLanguageCodes(req), function (success) {
            ws.send(JSON.stringify({ action: 'verifyMessaging', cookie: messagingCookie, success: success }));
        });
    }

    function serverUserCommandHelp(cmdData) {
        var fin = '', f = '', availcommands = [];
        for (var i in serverUserCommands) { availcommands.push(i); }
        availcommands = availcommands.sort();
        while (availcommands.length > 0) { if (f.length > 80) { fin += (f + ',\r\n'); f = ''; } f += (((f != '') ? ', ' : ' ') + availcommands.shift()); }
        if (f != '') { fin += f; }

        if (cmdData.cmdargs['_'].length == 0) {
            cmdData.result = 'Available commands: \r\n' + fin + '\r\nType help <command> for details.';
        } else {
            var cmd2 = cmdData.cmdargs['_'][0].toLowerCase();
            var cmdTableEntry = serverUserCommands[cmd2];
            if (cmdTableEntry) {
                if (cmdTableEntry[1] == '') {
                    cmdData.result = 'No help available for this command.';
                } else {
                    cmdData.result = cmdTableEntry[1]; }
            } else { 
                cmdData.result = "This command does not exist.";
            }
        }
    }

    function serverUserCommandCertExpire(cmdData) {
        const now = Date.now();
        for (var i in parent.webCertificateExpire) {
            const domainName = (i == '') ? '[Default]' : i;
            cmdData.result += domainName + ', expires in ' + Math.floor((parent.webCertificateExpire[i] - now) / 86400000) + ' day(s)\r\n';
        }
    }

    function serverUserCommandWebPush(cmdData) {
        if (parent.parent.webpush == null) {
            cmdData.result = "Web push not supported.";
        } else {
            if (cmdData.cmdargs['_'].length != 1) {
                cmdData.result = "Usage: WebPush \"Message\"";
            } else {
                const pushSubscription = { "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABgIkO9hjXHWhMPiuk-ppNRw7r_pUZitddwCEK4ykdzeIxOIjFnYhIt_nr-qUca2mpZziwQsSEhYTUCiuYrhWnVDRweMtiUj16yJJq8V5jneaEaUYjEIe5jp3DOMNpoTm1aHgX74gCR8uTXSITcM97bNi-hRxcQ4f6Ie4WSAmoXpd89B_g", "keys": { "auth": "UB2sbLVK7ALnSHw5P1dahg", "p256dh": "BIoRbcNSxBuTjN39CCCUCHo1f4NxBJ1YDdu_k4MbPW_q3NK1_RufnydUzLPDp8ibBVItSI72-s48QJvOjQ_S8Ok" } }
                parent.parent.webpush.sendNotification(pushSubscription, cmdData.cmdargs['_'][0]).then(
                    function (value) { try { ws.send(JSON.stringify({ action: 'OK', value: cmdData.result, tag: cmdData.command.tag })); } catch (ex) { } },
                    function (error) { try { ws.send(JSON.stringify({ action: 'Error', value: cmdData.result, tag: cmdData.command.tag })); } catch (ex) { } }
                );
            }
        }
    }

    function serverUserCommandAmtManager(cmdData) {
        if (parent.parent.amtManager == null) {
            cmdData.result = 'Intel AMT Manager not active.';
        } else { 
            cmdData.result = parent.parent.amtManager.getStatusString();
        }
    }

    function serverUserCommandCertHashes(cmdData) {
        cmdData.result += 'AgentCertHash: ' + parent.agentCertificateHashHex;
        for (var i in parent.webCertificateHashs) { cmdData.result += '\r\nwebCertificateHash (' + i + '): ' + common.rstr2hex(parent.webCertificateHashs[i]); }
        for (var i in parent.webCertificateFullHashs) { cmdData.result += '\r\nwebCertificateFullHash (' + i + '): ' + common.rstr2hex(parent.webCertificateFullHashs[i]); }
        cmdData.result += '\r\ndefaultWebCertificateHash: ' + common.rstr2hex(parent.defaultWebCertificateHash);
        cmdData.result += '\r\ndefaultWebCertificateFullHash: ' + common.rstr2hex(parent.defaultWebCertificateFullHash);
    }

    function serverUserCommandAmtAcm(cmdData) {
        if ((domain.amtacmactivation == null) || (domain.amtacmactivation.acmmatch == null) || (domain.amtacmactivation.acmmatch.length == 0)) {
            cmdData.result = 'No Intel AMT activation certificates.';
        } else {
            if (domain.amtacmactivation.log != null) { cmdData.result += '--- Activation Log ---\r\nFile  : ' + domain.amtacmactivation.log + '\r\n'; }
            for (var i in domain.amtacmactivation.acmmatch) {
                var acmcert = domain.amtacmactivation.acmmatch[i];
                cmdData.result += '--- Activation Certificate ' + (parseInt(i) + 1) + ' ---\r\nName  : ' + acmcert.cn + '\r\nSHA1  : ' + acmcert.sha1 + '\r\nSHA256: ' + acmcert.sha256 + '\r\n';
            }
        }
    }

    function serverUserCommandHeapDump(cmdData) {
        // Heapdump support, see example at:
        // https://www.arbazsiddiqui.me/a-practical-guide-to-memory-leaks-in-nodejs/
        if (parent.parent.config.settings.heapdump === true) {
            var dumpFileName = parent.path.join(parent.parent.datapath, `heapDump-${Date.now()}.heapsnapshot`);
            try { ws.send(JSON.stringify({ action: 'serverconsole', value: "Generating dump file at: " + dumpFileName, tag: cmdData.command.tag })); } catch (ex) { }
            require('heapdump').writeSnapshot(dumpFileName, (err, filename) => {
                try { ws.send(JSON.stringify({ action: 'serverconsole', value: "Done.", tag: cmdData.command.tag })); } catch (ex) { }
            });
        } else {
            cmdData.result = "Heapdump not supported, add \"heapdump\":true to settings section of config.json.";
        }
    }

    function serverUserCommandHeapDump2(cmdData) {
        var heapdump = null;
        try { heapdump = require('heapdump'); } catch (ex) { }
        if (heapdump == null) {
            cmdData.result = 'Heapdump module not installed, run "npm install heapdump".';
        } else {
            heapdump.writeSnapshot(function (err, filename) {
                if (err != null) {
                    try { ws.send(JSON.stringify({ action: 'serverconsole', value: 'Unable to write heapdump: ' + err })); } catch (ex) { }
                } else {
                    try { ws.send(JSON.stringify({ action: 'serverconsole', value: 'Wrote heapdump at ' + filename })); } catch (ex) { }
                }
            });
        }
    }

    function serverUserCommandSMS(cmdData) {
        if (parent.parent.smsserver == null) {
            cmdData.result = "No SMS gateway in use.";
        } else {
            if (cmdData.cmdargs['_'].length != 2) {
                cmdData.result = "Usage: SMS \"PhoneNumber\" \"Message\".";
            } else {
                parent.parent.smsserver.sendSMS(cmdData.cmdargs['_'][0], cmdData.cmdargs['_'][1], function (status, msg) {
                    if (typeof msg == 'string') {
                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? ('Success: ' + msg) : ('Failed: ' + msg), tag: cmdData.command.tag })); } catch (ex) { }
                    } else {
                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? 'Success' : 'Failed', tag: cmdData.command.tag })); } catch (ex) { }
                    }
                });
            }
        }
    }

    function serverUserCommandMsg(cmdData) {
        if ((parent.parent.msgserver == null) || (parent.parent.msgserver.providers == 0)) {
            cmdData.result = "No messaging providers configured.";
        } else {
            if (cmdData.cmdargs['_'].length != 2) {
                var r = [];
                if ((parent.parent.msgserver.providers & 1) != 0) { r.push("Usage: MSG \"telegram:[@UserHandle]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 2) != 0) { r.push("Usage: MSG \"signal:[UserHandle]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 4) != 0) { r.push("Usage: MSG \"discord:[Username#0000]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 8) != 0) { r.push("Usage: MSG \"xmpp:[username@server.com]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 32) != 0) { r.push("Usage: MSG \"pushover:[userkey]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 64) != 0) { r.push("Usage: MSG \"ntfy:[topic]\" \"Message\"."); }
                if ((parent.parent.msgserver.providers & 128) != 0) { r.push("Usage: MSG \"zulip:[topic]\" \"Message\"."); }
                cmdData.result = r.join('\r\n');
            } else {
                parent.parent.msgserver.sendMessage(cmdData.cmdargs['_'][0], cmdData.cmdargs['_'][1], domain, function (status, msg) {
                    if (typeof msg == 'string') {
                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? ('Success: ' + msg) : ('Failed: ' + msg), tag: cmdData.command.tag })); } catch (ex) { }
                    } else {
                        try { ws.send(JSON.stringify({ action: 'serverconsole', value: status ? 'Success' : 'Failed', tag: cmdData.command.tag })); } catch (ex) { }
                    }
                });
            }
        }
    }

    function serverUserCommandEmail(cmdData) {
        if (domain.mailserver == null) {
            cmdData.result = "No email service enabled.";
        } else {
            if (cmdData.cmdargs['_'].length != 3) {
                cmdData.result = "Usage: email \"user@sample.com\" \"Subject\" \"Message\".";
            } else {
                domain.mailserver.sendMail(cmdData.cmdargs['_'][0], cmdData.cmdargs['_'][1], cmdData.cmdargs['_'][2]);
                cmdData.result = "Done.";
            }
        }
    }

    function serverUserCommandEmailNotifications(cmdData) {
        if (domain.mailserver == null) {
            cmdData.result = "No email service enabled.";
        } else {
            var x = '';
            for (var userid in domain.mailserver.deviceNotifications) {
                x += userid + '\r\n';
                for (var nodeid in domain.mailserver.deviceNotifications[userid].nodes) {
                    const info = domain.mailserver.deviceNotifications[userid].nodes[nodeid];
                    x += '  ' + info.mn + ', ' + info.nn + ', c:' + (info.c ? info.c : 0) + ', d:' + (info.d ? info.d : 0) + '\r\n';
                }
            }
            cmdData.result = ((x == '') ? 'None' : x);
        }
    }

    function serverUserCommandMessageNotifications(cmdData) {
        if (parent.parent.msgserver == null) {
            cmdData.result = "No messaging service enabled.";
        } else {
            var x = '';
            for (var userid in parent.parent.msgserver.deviceNotifications) {
                x += userid + '\r\n';
                for (var nodeid in parent.parent.msgserver.deviceNotifications[userid].nodes) {
                    const info = parent.parent.msgserver.deviceNotifications[userid].nodes[nodeid];
                    x += '  ' + info.mn + ', ' + info.nn + ', c:' + (info.c ? info.c : 0) + ', d:' + (info.d ? info.d : 0) + '\r\n';
                }
            }
            cmdData.result = ((x == '') ? 'None' : x);
        }
    }

    function serverUserCommandLe(cmdData) {
        if (parent.parent.letsencrypt == null) {
            cmdData.result = "Let's Encrypt not in use.";
        } else {
            cmdData.result = JSON.stringify(parent.parent.letsencrypt.getStats(), null, 4);
        }
    }

    function serverUserCommandLeCheck(cmdData) {
        if (parent.parent.letsencrypt == null) {
            cmdData.result = "Let's Encrypt not in use.";
        } else {
            cmdData.result = ["CertOK", "Request:NoCert", "Request:Expire", "Request:MissingNames"][parent.parent.letsencrypt.checkRenewCertificate()];
        }
    }

    function serverUserCommandLeEvents(cmdData) {
        if (parent.parent.letsencrypt == null) {
            cmdData.result = "Let's Encrypt not in use.";
        } else {
            cmdData.result = parent.parent.letsencrypt.events.join('\r\n');
        }
    }

    function serverUserCommandBadLogins(cmdData) {
        if (parent.parent.config.settings.maxinvalidlogin == false) {
            cmdData.result = 'Bad login filter is disabled.';
        } else {
            if (cmdData.cmdargs['_'] == 'reset') {
                // Reset bad login table
                parent.badLoginTable = {};
                parent.badLoginTableLastClean = 0;
                cmdData.result = 'Done.';
            } else if (cmdData.cmdargs['_'] == '') {
                // Show current bad login table
                if (typeof parent.parent.config.settings.maxinvalidlogin.coolofftime == 'number') {
                    cmdData.result = "Max is " + parent.parent.config.settings.maxinvalidlogin.count + " bad login(s) in " + parent.parent.config.settings.maxinvalidlogin.time + " minute(s), " + parent.parent.config.settings.maxinvalidlogin.coolofftime + " minute(s) cooloff.\r\n";
                } else {
                    cmdData.result = "Max is " + parent.parent.config.settings.maxinvalidlogin.count + " bad login(s) in " + parent.parent.config.settings.maxinvalidlogin.time + " minute(s).\r\n";
                }
                var badLoginCount = 0;
                parent.cleanBadLoginTable();
                for (var i in parent.badLoginTable) {
                    badLoginCount++;
                    if (typeof parent.badLoginTable[i] == 'number') {
                        cmdData.result += "Cooloff for " + Math.floor((parent.badLoginTable[i] - Date.now()) / 60000) + " minute(s)\r\n";
                    } else {
                        if (parent.badLoginTable[i].length > 1) {
                            cmdData.result += (i + ' - ' + parent.badLoginTable[i].length + " records\r\n");
                        } else {
                            cmdData.result += (i + ' - ' + parent.badLoginTable[i].length + " record\r\n");
                        }
                    }
                }
                if (badLoginCount == 0) { cmdData.result += 'No bad logins.'; }
            } else {
                cmdData.result = 'Usage: badlogin [reset]';
            }
        }
    }

    function serverUserCommandBad2fa(cmdData) {
        if (parent.parent.config.settings.maxinvalid2fa == false) {
            cmdData.result = 'Bad 2FA filter is disabled.';
        } else {
            if (cmdData.cmdargs['_'] == 'reset') {
                // Reset bad login table
                parent.bad2faTable = {};
                parent.bad2faTableLastClean = 0;
                cmdData.result = 'Done.';
            } else if (cmdData.cmdargs['_'] == '') {
                // Show current bad login table
                if (typeof parent.parent.config.settings.maxinvalid2fa.coolofftime == 'number') {
                    cmdData.result = "Max is " + parent.parent.config.settings.maxinvalid2fa.count + " bad 2FA(s) in " + parent.parent.config.settings.maxinvalid2fa.time + " minute(s), " + parent.parent.config.settings.maxinvalid2fa.coolofftime + " minute(s) cooloff.\r\n";
                } else {
                    cmdData.result = "Max is " + parent.parent.config.settings.maxinvalid2fa.count + " bad 2FA(s) in " + parent.parent.config.settings.maxinvalid2fa.time + " minute(s).\r\n";
                }
                var bad2faCount = 0;
                parent.cleanBad2faTable();
                for (var i in parent.bad2faTable) {
                    bad2faCount++;
                    if (typeof parent.bad2faTable[i] == 'number') {
                        cmdData.result += "Cooloff for " + Math.floor((parent.bad2faTable[i] - Date.now()) / 60000) + " minute(s)\r\n";
                    } else {
                        if (parent.bad2faTable[i].length > 1) {
                            cmdData.result += (i + ' - ' + parent.bad2faTable[i].length + " records\r\n");
                        } else {
                            cmdData.result += (i + ' - ' + parent.bad2faTable[i].length + " record\r\n");
                        }
                    }
                }
                if (bad2faCount == 0) { cmdData.result += 'No bad 2FA.'; }
            } else {
                cmdData.result = 'Usage: bad2fa [reset]';
            }
        }
    }

    function serverUserCommandDispatchTable(cmdData) {
        for (var i in parent.parent.eventsDispatch) {
            cmdData.result += (i + ', ' + parent.parent.eventsDispatch[i].length + '\r\n'); 
        }
    }

    function serverUserCommandDropAllCira(cmdData) {
        if (parent.parent.mpsserver == null) { cmdData.result = 'MPS not setup.'; return; }
        const dropCount = parent.parent.mpsserver.dropAllConnections();
        cmdData.result = 'Dropped ' + dropCount + ' connection(s).';
    }

    function serverUserCommandDupAgents(cmdData) {
        for (var i in parent.duplicateAgentsLog) {
            cmdData.result += JSON.stringify(parent.duplicateAgentsLog[i]) + '\r\n';
        }
        if (cmdData.result == '') { cmdData.result = 'No duplicate agents in log.'; }
    }

    function serverUserCommandAgentStats(cmdData) {
        var stats = parent.getAgentStats();
        for (var i in stats) {
            if (typeof stats[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats[i] + '\r\n'); }
        }
    }

    function serverUserCommandAgentIssues(cmdData) {
        var stats = parent.getAgentIssues();
        if (stats.length == 0) {
            cmdData.result = "No agent issues.";
        } else {
            for (var i in stats) { cmdData.result += stats[i].join(', ') + '\r\n'; }
        }
    }

    function serverUserCommandWebStats(cmdData) {
        var stats = parent.getStats();
        for (var i in stats) {
            if (typeof stats[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats[i] + '\r\n'); }
        }
    }

    function serverUserCommandTrafficStats(cmdData) {
        var stats = parent.getTrafficStats();
        for (var i in stats) {
            if (typeof stats[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats[i] + '\r\n'); }
        }
    }

    function serverUserCommandTrafficDelta(cmdData) {
        const stats = parent.getTrafficDelta(obj.trafficStats);
        obj.trafficStats = stats.current;
        for (var i in stats.delta) {
            if (typeof stats.delta[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats.delta[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats.delta[i] + '\r\n'); }
        }
    }

    function serverUserCommandWatchdog(cmdData) {
        if (parent.parent.watchdog == null) {
            cmdData.result = 'Server watchdog not active.';
        } else {
            cmdData.result = 'Server watchdog active.\r\n';
            if (parent.parent.watchdogmaxtime != null) { cmdData.result += 'Largest timeout was ' + parent.parent.watchdogmax + 'ms on ' + parent.parent.watchdogmaxtime + '\r\n'; }
            for (var i in parent.parent.watchdogtable) { cmdData.result += parent.parent.watchdogtable[i] + '\r\n'; }
        }
    }

    function serverUserCommand2faLock(cmdData) {
        var arg = null;
        if (cmdData.cmdargs['_'].length > 0) { arg = cmdData.cmdargs['_'][0]; }
        if (domain.passwordrequirements == null) { domain.passwordrequirements = {}; }
        if (arg == 'set') {
            // TODO: Change 2FA lock for peer servers
            domain.passwordrequirements.lock2factor = true;
            cmdData.result = "2FA lock is set";
            parent.parent.DispatchEvent(['server-allusers'], obj, { action: 'serverinfochange', lock2factor: true, nolog: 1, domain: domain.id });
        } else if (arg == 'clear') {
            // TODO: Change 2FA lock for peer servers
            delete domain.passwordrequirements.lock2factor;
            cmdData.result = "2FA lock is cleared";
            parent.parent.DispatchEvent(['server-allusers'], obj, { action: 'serverinfochange', lock2factor: false, nolog: 1, domain: domain.id });
        } else {
            cmdData.result = (domain.passwordrequirements.lock2factor == true) ? "2FA lock is set" : "2FA lock is cleared";
            cmdData.result += ", use '2falock [set/clear]' to change the lock state."
        }
    }

    function serverUserCommandAcceleratorsStats(cmdData) {
        var stats = parent.parent.certificateOperations.getAcceleratorStats();
        for (var i in stats) {
            if (typeof stats[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats[i] + '\r\n'); }
        }
    }

    function serverUserCommandMpsStats(cmdData) {
        if (parent.parent.mpsserver == null) {
            cmdData.result = 'MPS not enabled.';
        } else {
            var stats = parent.parent.mpsserver.getStats();
            for (var i in stats) {
                if (typeof stats[i] == 'object') { cmdData.result += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { cmdData.result += (i + ': ' + stats[i] + '\r\n'); }
            }
        }
    }

    function serverUserCommandMps(cmdData) {
        if (parent.parent.mpsserver == null) {
            cmdData.result = 'MPS not enabled.';
        } else {
            const connectionTypes = ['CIRA', 'Relay', 'LMS'];
            for (var nodeid in parent.parent.mpsserver.ciraConnections) {
                cmdData.result += nodeid;
                var connections = parent.parent.mpsserver.ciraConnections[nodeid];
                for (var i in connections) { cmdData.result += ', ' + connectionTypes[connections[i].tag.connType]; }
                cmdData.result += '\r\n';
            }
            if (cmdData.result == '') { cmdData.result = 'MPS has not connections.'; }
        }
    }

    function serverUserCommandDbStats(cmdData) {
        parent.parent.db.getDbStats(function (stats) {
            var r2 = '';
            for (var i in stats) { r2 += (i + ': ' + stats[i] + '\r\n'); }
            try { ws.send(JSON.stringify({ action: 'serverconsole', value: r2, tag: cmdData.command.tag })); } catch (ex) { }
        });
    }

    function serverUserCommandDbCounters(cmdData) {
        try { ws.send(JSON.stringify({ action: 'serverconsole', value: JSON.stringify(parent.parent.db.dbCounters, null, 2), tag: cmdData.command.tag })); } catch (ex) { }
    }

    function serverUserCommandServerUpdate(cmdData) {
        cmdData.result = 'Performing server update...';
        var version = null;

        if (cmdData.cmdargs['_'].length > 0) {
            version = cmdData.cmdargs['_'][0];

            // This call is SLOW. We only want to validate version if we have to
            if (version != 'stable' && version != 'latest') {
                parent.parent.getServerVersions((data) => {
                    var versions = JSON.parse(data);

                    if (versions.includes(version)) {
                        if (parent.parent.performServerUpdate(version) == false) { 
                            try { 
                                ws.send(JSON.stringify({ action: 'serverconsole',
                                                         value: 'Server self-update not possible.'}));
                            } catch (ex) { }
                        }
                    } else {
                        try { 
                            ws.send(JSON.stringify({ action: 'serverconsole',
                                                     value: 'Invalid version. Aborting update'}));
                        } catch (ex) { }
                    }
                });
            } else {
                if (parent.parent.performServerUpdate(version) == false) { 
                    cmdData.result = 'Server self-update not possible.';
                }
            }  
        } else {
            if (parent.parent.performServerUpdate(version) == false) { 
                cmdData.result = 'Server self-update not possible.';
            }
        }
    }

    function serverUserCommandPrint(cmdData) {
        console.log(cmdData.cmdargs['_'][0]);
    }

    function serverUserCommandAmtPasswords(cmdData) {
        if (parent.parent.amtPasswords == null) {
            cmdData.result = "No Intel AMT password table."
        } else {
            for (var i in parent.parent.amtPasswords) { cmdData.result += (i + ' - ' + parent.parent.amtPasswords[i].join(', ') + '\r\n'); }
        }
    }

    function serverUserCommandAmtStats(cmdData) {
        parent.parent.db.GetAllType('node', function (err, docs) {
            var r = '';
            if (err != null) {
                r = "Error occured.";
            } else if ((docs == null) || (docs.length == 0)) {
                r = "No devices in database"
            } else {
                var amtData = { total: 0, versions: {}, state: {} };
                for (var i in docs) {
                    const node = docs[i];
                    if (node.intelamt != null) {
                        amtData['total']++;
                        if (node.intelamt.ver != null) { if (amtData.versions[node.intelamt.ver] == null) { amtData.versions[node.intelamt.ver] = 1; } else { amtData.versions[node.intelamt.ver]++; } }
                        if (node.intelamt.state != null) { if (amtData.state[node.intelamt.state] == null) { amtData.state[node.intelamt.state] = 1; } else { amtData.state[node.intelamt.state]++; } }
                    }
                }
                if (amtData.total == 0) {
                    r = "No Intel AMT devices found"
                } else {
                    r = "Total Intel AMT devices: " + amtData['total'] + '\r\n';
                    r += "Un-provisionned: " + amtData['state'][0] + '\r\n';
                    r += "Provisionned: " + amtData['state'][2] + '\r\n';
                    r += "Versions: " + '\r\n';

                    // Sort the Intel AMT versions
                    var amtVersions = [];
                    for (var i in amtData.versions) { if (amtVersions.indexOf(i) == -1) { amtVersions.push(i); } }
                    var collator = new Intl.Collator([], { numeric: true });
                    amtVersions.sort((a, b) => collator.compare(a, b));
                    for (var i in amtVersions) { r += '  ' + amtVersions[i] + ': ' + amtData.versions[amtVersions[i]] + '\r\n'; }
                }
            }
            try { ws.send(JSON.stringify({ action: 'serverconsole', value: r, tag: cmdData.command.tag })); } catch (ex) { }
        });
    }

    function serverUserCommandUpdateCheck(cmdData) {
        parent.parent.getServerTags(function (tags, error) {
            var r2 = '';
            if (error != null) { r2 += 'Exception: ' + error + '\r\n'; }
            else { for (var i in tags) { r2 += i + ': ' + tags[i] + '\r\n'; } }
            try { ws.send(JSON.stringify({ action: 'serverconsole', value: r2, tag: cmdData.command.tag })); } catch (ex) { }
        });
        cmdData.result = "Checking server update...";
    }

    function serverUserCommandMaintenance(cmdData) {
        var arg = null, changed = false;
        if ((cmdData.cmdargs['_'] != null) && (cmdData.cmdargs['_'][0] != null)) { arg = cmdData.cmdargs['_'][0].toLowerCase(); }
        if (arg == 'enabled') { parent.parent.config.settings.maintenancemode = 1; changed = true; }
        else if (arg == 'disabled') { delete parent.parent.config.settings.maintenancemode; changed = true; }
        cmdData.result = 'Maintenance mode: ' + ((parent.parent.config.settings.maintenancemode == null) ? 'Disabled' : 'Enabled');
        if (changed == false) { cmdData.result += '\r\nTo change type: maintenance [enabled|disabled]'; }
    }

    function serverUserCommandInfo(cmdData) {
        var info = {};
        try { info.meshVersion = 'v' + parent.parent.currentVer; } catch (ex) { }
        try { info.nodeVersion = process.version; } catch (ex) { }
        try { info.runMode = (["Hybrid (LAN + WAN) mode", "WAN mode", "LAN mode"][(args.lanonly ? 2 : (args.wanonly ? 1 : 0))]); } catch (ex) { }
        try { info.productionMode = ((process.env.NODE_ENV != null) && (process.env.NODE_ENV == 'production')); } catch (ex) { }
        try { info.database = ["Unknown", "NeDB", "MongoJS", "MongoDB", "MariaDB", "MySQL", "PostgreSQL", "AceBase", "SQLite"][parent.parent.db.databaseType]; } catch (ex) { }
        try { if (parent.db.databaseType == 3) { info.dbChangeStream = parent.db.changeStream; info.dbBulkOperations = (parent.parent.config.settings.mongodbbulkoperations === true); } } catch (ex) { }
        try { if (parent.parent.multiServer != null) { info.serverId = parent.parent.multiServer.serverid; } } catch (ex) { }
        try { if (parent.parent.pluginHandler != null) { info.plugins = []; for (var i in parent.parent.pluginHandler.plugins) { info.plugins.push(i); } } } catch (ex) { }
        try { info.platform = process.platform; } catch (ex) { }
        try { info.arch = process.arch; } catch (ex) { }
        try { info.pid = process.pid; } catch (ex) { }
        try { info.uptime = process.uptime(); } catch (ex) { }
        try { info.cpuUsage = process.cpuUsage(); } catch (ex) { }
        try { info.memoryUsage = process.memoryUsage(); } catch (ex) { }
        try { info.warnings = parent.parent.getServerWarnings(); } catch (ex) { console.log(ex); }
        try { info.allDevGroupManagers = parent.parent.config.settings.managealldevicegroups; } catch (ex) { }
        try { if (process.traceDeprecation == true) { info.traceDeprecation = true; } } catch (ex) { }
        cmdData.result = JSON.stringify(info, null, 4);
    }

    function serverUserCommandNodeConfig(cmdData) {
        cmdData.result = JSON.stringify(process.config, null, 4);
    }

    function serverUserCommandVersions(cmdData) {
        cmdData.result = JSON.stringify(process.versions, null, 4);
    }

    function serverUserCommandArgs(cmdData) {
        cmdData.result = 'args: ' + JSON.stringify(cmdData.cmdargs);
    }

    function serverUserCommandUserSessions(cmdData) {
        var userSessionCount = 0;
        var filter = null;
        var arg = cmdData.cmdargs['_'][0];
        if (typeof arg == 'string') { if (arg.indexOf('/') >= 0) { filter = arg; } else { filter = ('user/' + domain.id + '/' + arg); } }
        for (var i in parent.wssessions) {
            if ((filter == null) || (filter == i)) {
                userSessionCount++;
                cmdData.result += (i + ', ' + parent.wssessions[i].length + ' session' + ((parent.wssessions[i].length > 1) ? 's' : '') + '.\r\n');
                for (var j in parent.wssessions[i]) {
                    var extras = "";
                    if (parent.wssessions[i][j].satelliteFlags) { extras += ', Satellite'; }
                    cmdData.result += '    ' + parent.wssessions[i][j].clientIp + ' --> ' + parent.wssessions[i][j].sessionId + extras + ((parent.wssessions[i][j].xclosed) ? (', CLOSED-' + parent.wssessions[i][j].xclosed):'') + '\r\n';
                }
            }
        }
        if (userSessionCount == 0) { cmdData.result = 'None.'; }
    }

    function serverUserCommandCloseUserSessions(cmdData) {
        var userSessionCount = 0;
        var filter = null;
        var arg = cmdData.cmdargs['_'][0];
        if (typeof arg == 'string') { if (arg.indexOf('/') >= 0) { filter = arg; } else { filter = ('user/' + domain.id + '/' + arg); } }
        if (filter == null) {
            cmdData.result += "Usage: closeusersessions <username>";
        } else {
            cmdData.result += "Closing user sessions for: " + filter + '\r\n';
            for (var i in parent.wssessions) {
                if (filter == i) {
                    userSessionCount++;
                    for (var j in parent.wssessions[i]) {
                        parent.wssessions[i][j].send(JSON.stringify({ action: 'stopped', msg: "Administrator forced disconnection" }));
                        parent.wssessions[i][j].close();
                    }
                }
            }
            if (userSessionCount < 2) { cmdData.result += 'Disconnected ' + userSessionCount + ' session.'; } else { cmdData.result += 'Disconnected ' + userSessionCount + ' sessions.'; };
        }
    }

    function serverUserCommandResetServer(cmdData) {
        console.log("Server restart...");
        process.exit(0);
    }

    function serverUserCommandTaskLimiter(cmdData) {
        if (parent.parent.taskLimiter != null) {
            //var obj = { maxTasks: maxTasks, maxTaskTime: (maxTaskTime * 1000), nextTaskId: 0, currentCount: 0, current: {}, pending: [[], [], []], timer: null };
            const tl = parent.parent.taskLimiter;
            cmdData.result += 'MaxTasks: ' + tl.maxTasks + ', NextTaskId: ' + tl.nextTaskId + '\r\n';
            cmdData.result += 'MaxTaskTime: ' + (tl.maxTaskTime / 1000) + ' seconds, Timer: ' + (tl.timer != null) + '\r\n';
            var c = [];
            for (var i in tl.current) { c.push(i); }
            cmdData.result += 'Current (' + tl.currentCount + '): [' + c.join(', ') + ']\r\n';
            cmdData.result += 'Pending (High/Med/Low): ' + tl.pending[0].length + ', ' + tl.pending[1].length + ', ' + tl.pending[2].length + '\r\n';
        }
    }

    function serverUserCommandSetMaxTasks(cmdData) {
        if ((cmdData.cmdargs["_"].length != 1) || (parseInt(cmdData.cmdargs["_"][0]) < 1) || (parseInt(cmdData.cmdargs["_"][0]) > 1000)) {
            cmdData.result = 'Usage: setmaxtasks [1 to 1000]';
        } else {
            parent.parent.taskLimiter.maxTasks = parseInt(cmdData.cmdargs["_"][0]);
            cmdData.result = 'MaxTasks set to ' + parent.parent.taskLimiter.maxTasks + '.';
        }
    }

    function serverUserCommandCores(cmdData) {
        if (parent.parent.defaultMeshCores != null) {
            for (var i in parent.parent.defaultMeshCores) {
                cmdData.result += i + ': ' + parent.parent.defaultMeshCores[i].length + ' bytes\r\n';
            }
        }
    }

    function serverUserCommandShowPaths(cmdData) {
        cmdData.result = 'Parent:     ' + parent.parent.parentpath + '\r\n';
        cmdData.result += 'Data:       ' + parent.parent.datapath + '\r\n';
        cmdData.result += 'Files:      ' + parent.parent.filespath + '\r\n';
        cmdData.result += 'Backup:     ' + parent.parent.backuppath + '\r\n';
        cmdData.result += 'Record:     ' + parent.parent.recordpath + '\r\n';
        cmdData.result += 'WebPublic:  ' + parent.parent.webPublicPath + '\r\n';
        cmdData.result += 'WebViews:   ' + parent.parent.webViewsPath + '\r\n';
        if (parent.parent.webViewsOverridePath) { cmdData.result += 'XWebPublic: ' + parent.parent.webViewsOverridePath + '\r\n'; }
        if (parent.parent.webViewsOverridePath) { cmdData.result += 'XWebViews:  ' + parent.parent.webPublicOverridePath + '\r\n'; }
    }

    function serverUserCommandMigrationAgents(cmdData) {
        if (parent.parent.swarmserver == null) {
            cmdData.result = 'Swarm server not running.';
        } else {
            for (var i in parent.parent.swarmserver.migrationAgents) {
                var arch = parent.parent.swarmserver.migrationAgents[i];
                for (var j in arch) { var agent = arch[j]; cmdData.result += 'Arch ' + agent.arch + ', Ver ' + agent.ver + ', Size ' + ((agent.binary == null) ? 0 : agent.binary.length) + '<br />'; }
            }
        }
    }

    function serverUserCommandSwarmStats(cmdData) {
        if (parent.parent.swarmserver == null) {
            cmdData.result = 'Swarm server not running.';
        } else {
            for (var i in parent.parent.swarmserver.stats) {
                if (typeof parent.parent.swarmserver.stats[i] == 'object') {
                    cmdData.result += i + ': ' + JSON.stringify(parent.parent.swarmserver.stats[i]) + '\r\n';
                } else {
                    cmdData.result += i + ': ' + parent.parent.swarmserver.stats[i] + '\r\n';
                }
            }
        }
    }

    function serverUserCommandRelays(cmdData) {
        for (var i in parent.wsrelays) {
            cmdData.result += 'id: ' + i + ', ' + ((parent.wsrelays[i].state == 2) ? 'connected' : 'pending');
            if (parent.wsrelays[i].peer1 != null) {
                cmdData.result += ', ' + cleanRemoteAddr(parent.wsrelays[i].peer1.req.clientIp);
                if (parent.wsrelays[i].peer1.user) { cmdData.result += ' (User:' + parent.wsrelays[i].peer1.user.name + ')' }
            }
            if (parent.wsrelays[i].peer2 != null) {
                cmdData.result += ' to ' + cleanRemoteAddr(parent.wsrelays[i].peer2.req.clientIp);
                if (parent.wsrelays[i].peer2.user) { cmdData.result += ' (User:' + parent.wsrelays[i].peer2.user.name + ')' }
            }
            cmdData.result += '\r\n';
        }
        if (cmdData.result == '') { cmdData.result = 'No relays.'; }
    }

    // removeinactivedevices showall|showremoved
    function serverUserCommandRemoveInactiveDevices(cmdData) {
        var arg = cmdData.cmdargs['_'][0];
        if ((arg == null) && (arg != 'showremoved') && (arg != 'showall')) {
            cmdData.result = 'Usage: removeinactivedevices [showremoved|showall]';
        } else {
            parent.db.removeInactiveDevices((arg == 'showall'), function (msg) { try { ws.send(JSON.stringify({ action: 'serverconsole', value: msg, tag: cmdData.command.tag })); } catch (ex) { } });
        }
    }

    function serverUserCommandAutoBackup(cmdData) {
        var backupResult = parent.db.performBackup(function (msg) {
            try { ws.send(JSON.stringify({ action: 'serverconsole', value: msg, tag: cmdData.command.tag })); } catch (ex) { }
        });
        if (backupResult == 0) { cmdData.result = 'Starting auto-backup...'; } else { cmdData.result = 'Backup alreay in progress.'; }
    }

    function serverUserCommandBackupConfig(cmdData) {
        cmdData.result = parent.db.getBackupConfig();
    }

    function serverUserCommandFirebase(cmdData) {
        if (parent.parent.firebase == null) {
            cmdData.result = "Firebase push messaging not supported";
        } else {
            cmdData.result = JSON.stringify(parent.parent.firebase.stats, null, 2);
        }
    }


    function validNodeIdAndDomain(command) {
        if (common.validateString(command.nodeid, 1, 1024) == false) return false; // Check nodeid
        if (command.nodeid.indexOf('/') == -1) { command.nodeid = 'node/' + domain.id + '/' + command.nodeid; }
        if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return false; // Invalid domain, operation only valid for current domain
        return true;
    }

    function getUserExtraIds() {
        var extraids = null;
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
        return extraids;
    }

    function userHasSiteUpdate() { return ((user.siteadmin & SITERIGHT_SERVERUPDATE) > 0); }
    function domainHasMyServerErrorLog() { return !((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.errorlog !== true))); }
    function domainHasMyServerUpgrade()  { return !((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver !== true) && (domain.myserver.upgrade !== true))); }

    function csvClean(s) { return '\"' + s.split('\"').join('').split(',').join('').split('\r').join('').split('\n').join('') + '\"'; }

    function remoteSessionReport(command, manageAllDeviceGroups, msgIdFilter) {
        // If we are not user administrator on this site, only search for events with our own user id.
        var ids = [user._id];
        if ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0) {
            if (command.devGroup != null) {
                ids = [ user._id, command.devGroup ];
            } else {
                if (manageAllDeviceGroups) { ids = ['*']; } else if (user.links) { for (var i in user.links) { ids.push(i); } }
            }
        }

        // Get the events in the time range
        // MySQL or MariaDB query will ignore the MsgID filter.
        db.GetEventsTimeRange(ids, domain.id, msgIdFilter, new Date(command.start * 1000), new Date(command.end * 1000), function (err, docs) {
            if (err != null) return;
            var data = { groups: {} };
            var guestNamePresent = false;

            // Columns
            if (command.groupBy == 1) {
                data.groupFormat = 'user';
                data.columns = [{ id: 'time', title: "time", format: 'datetime' }, { id: 'nodeid', title: "device", format: 'node' }, { id: 'meshid', title: "devgroup", format: 'mesh' }, { id: 'guestname', title: "guest", align: 'center' }, { id: 'protocol', title: "session", format: 'protocol', align: 'center' }, { id: 'length', title: "length", format: 'seconds', align: 'center', sumBy: 'protocol' } ];
            } else if (command.groupBy == 2) {
                data.groupFormat = 'nodemesh';
                data.columns = [{ id: 'time', title: "time", format: 'datetime' }, { id: 'userid', title: "user", format: 'user' }, { id: 'guestname', title: "guest", align: 'center' }, { id: 'protocol', title: "session", format: 'protocol', align: 'center' }, { id: 'length', title: "length", format: 'seconds', align: 'center', sumBy: 'protocol' } ];
            } else if (command.groupBy == 3) {
                data.columns = [{ id: 'time', title: "time", format: 'time' }, { id: 'nodeid', title: "device", format: 'node' }, { id: 'meshid', title: "devgroup", format: 'mesh' }, { id: 'guestname', title: "guest", align: 'center' }, { id: 'userid', title: "user", format: 'user' }, { id: 'protocol', title: "session", format: 'protocol', align: 'center' }, { id: 'length', title: "length", format: 'seconds', align: 'center', sumBy: 'protocol' } ];
            }

            // Add traffic columns
            if (command.showTraffic) {
                data.columns.push({ id: 'bytesin', title: "bytesin", format: 'bytes', align: 'center', sumBy: 'protocol' });
                data.columns.push({ id: 'bytesout', title: "bytesout", format: 'bytes', align: 'center', sumBy: 'protocol' });
            }

            // Rows
            for (var i in docs) {
                // If MySQL or MariaDB query, we can't filter on MsgID, so we have to do it here.
                if (msgIdFilter.indexOf(docs[i].msgid) < 0) continue;
                if ((command.devGroup != null) && (docs[i].ids != null) && (docs[i].ids.indexOf(command.devGroup) == -1)) continue;

                var entry = { time: docs[i].time.valueOf() };

                // UserID
                if (command.groupBy != 1) { entry.userid = docs[i].userid; }
                if (command.groupBy != 2) { entry.nodeid = docs[i].nodeid; }
                entry.protocol = docs[i].protocol;

                // Device Group
                if (docs[i].ids != null) { for (var j in docs[i].ids) { if (docs[i].ids[j].startsWith('mesh/')) { entry.meshid = docs[i].ids[j]; } } }

                // Add traffic data
                if (command.showTraffic) { entry.bytesin = docs[i].bytesin; entry.bytesout = docs[i].bytesout; }

                // Add guest name if present
                if (docs[i].guestname != null) { entry.guestname = docs[i].guestname; guestNamePresent = true; }

                // Session length
                if (((docs[i].msgid >= 10) && (docs[i].msgid <= 12)) && (docs[i].msgArgs != null) && (typeof docs[i].msgArgs == 'object') && (typeof docs[i].msgArgs[3] == 'number')) { entry.length = docs[i].msgArgs[3]; }
                else if ((docs[i].msgid >= 122) && (docs[i].msgid <= 126) && (docs[i].msgArgs != null) && (typeof docs[i].msgArgs == 'object') && (typeof docs[i].msgArgs[0] == 'number')) { entry.length = docs[i].msgArgs[0]; }

                if (command.groupBy == 1) { // Add entry to per user
                    if (data.groups[docs[i].userid] == null) { data.groups[docs[i].userid] = { entries: [] }; }
                    data.groups[docs[i].userid].entries.push(entry);
                } else if (command.groupBy == 2) { // Add entry to per mesh+device
                    if (entry.meshid != null) {
                        var k = docs[i].nodeid + '/' + entry.meshid;
                        if (data.groups[k] == null) { data.groups[k] = { entries: [] }; }
                        data.groups[k].entries.push(entry);
                    } else {
                        if (data.groups[docs[i].nodeid] == null) { data.groups[docs[i].nodeid] = { entries: [] }; }
                        data.groups[docs[i].nodeid].entries.push(entry);
                    }
                } else if (command.groupBy == 3) { // Add entry to per day
                    var day;
                    if ((typeof command.l == 'string') && (typeof command.tz == 'string')) {
                        day = new Date(docs[i].time).toLocaleDateString(command.l, { timeZone: command.tz });
                    } else {
                        day = docs[i].time; // TODO
                    }
                    if (data.groups[day] == null) { data.groups[day] = { entries: [] }; }
                    data.groups[day].entries.push(entry);
                }
            }

            // Remove guest column if not needed
            if (guestNamePresent == false) {
                if ((command.groupBy == 1) || (command.groupBy == 3)) {
                    data.columns.splice(3, 1);
                } else if (command.groupBy == 2) {
                    data.columns.splice(2, 1);
                }
            }

            try { ws.send(JSON.stringify({ action: 'report', data: data })); } catch (ex) { }
        });
    }

    function trafficUsageReport(command, msgIdFilter) {
        // If we are not user administrator on this site, only search for events with our own user id.
        var ids = [user._id]; // If we are nto user administrator, only count our own traffic.
        if ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0) { ids = ['*']; } // If user administrator, count traffic of all users.

        // Get the events in the time range
        // MySQL or MariaDB query will ignore the MsgID filter.
        db.GetEventsTimeRange(ids, domain.id, msgIdFilter, new Date(command.start * 1000), new Date(command.end * 1000), function (err, docs) {
            if (err != null) return;
            var data = { groups: { 0: { entries: [] } } };
            data.columns = [{ id: 'userid', title: "user", format: 'user' }, { id: 'length', title: "length", format: 'seconds', align: 'center', sumBy: true }, { id: 'bytesin', title: "bytesin", format: 'bytes', align: 'center', sumBy: true }, { id: 'bytesout', title: "bytesout", format: 'bytes', align: 'center', sumBy: true }];
            var userEntries = {};

            // Sum all entry logs for each user
            for (var i in docs) {
                // If MySQL or MariaDB query, we can't filter on MsgID, so we have to do it here.
                if (msgIdFilter.indexOf(docs[i].msgid) < 0) continue;
                if ((command.devGroup != null) && (docs[i].ids != null) && (docs[i].ids.indexOf(command.devGroup) == -1)) continue;

                // Fetch or create the user entry
                var userEntry = userEntries[docs[i].userid];
                if (userEntry == null) { userEntry = { userid: docs[i].userid, length: 0, bytesin: 0, bytesout: 0 }; }
                if (docs[i].bytesin) { userEntry.bytesin += docs[i].bytesin; }
                if (docs[i].bytesout) { userEntry.bytesout += docs[i].bytesout; }

                // Session length
                if (((docs[i].msgid >= 10) && (docs[i].msgid <= 12)) && (docs[i].msgArgs != null) && (typeof docs[i].msgArgs == 'object') && (typeof docs[i].msgArgs[3] == 'number')) { userEntry.length += docs[i].msgArgs[3]; }
                else if ((docs[i].msgid >= 122) && (docs[i].msgid <= 126) && (docs[i].msgArgs != null) && (typeof docs[i].msgArgs == 'object') && (typeof docs[i].msgArgs[0] == 'number')) { userEntry.length += docs[i].msgArgs[0]; }

                // Set the user entry
                userEntries[docs[i].userid] = userEntry;
            }

            var userEntries2 = [];
            for (var i in userEntries) { userEntries2.push(userEntries[i]); }
            data.groups[0].entries = userEntries2;

            try { ws.send(JSON.stringify({ action: 'report', data: data })); } catch (ex) { }
        });
    }


    function userLoginReport(command) {
        // If we are not user administrator on this site, only search for events with our own user id.
        var ids = [user._id]; // If we are nto user administrator, only count our own traffic.
        if ((user.siteadmin & SITERIGHT_MANAGEUSERS) != 0) { ids = ['*']; } // If user administrator, count traffic of all users.

        var showInvalidLoginAttempts = true;

        // Get the events in the time range
        // MySQL or MariaDB query will ignore the MsgID filter.
        var msgIdFilter = [107];
        if (showInvalidLoginAttempts) { msgIdFilter = [107, 108, 109, 110]; } // Includes invalid login attempts

        db.GetEventsTimeRange(ids, domain.id, msgIdFilter, new Date(command.start * 1000), new Date(command.end * 1000), function (err, docs) {
            if (err != null) return;

            // Columns
            var data = { groups: {} };
            if (command.groupBy == 1) {
                data.groupFormat = 'user';
                data.columns = [{ id: 'time', title: "time", format: 'datetime' }, { id: 'ip', title: "ip" }, { id: 'browser', title: "browser" }, { id: 'os', title: "os" }, { id: 'twofactor', title: "twofactor", format: '2fa' }];
            } else if (command.groupBy == 3) {
                data.columns = [{ id: 'time', title: "time", format: 'time' }, { id: 'userid', title: "user", format: 'user' }, { id: 'ip', title: "ip" }, { id: 'browser', title: "browser" }, { id: 'os', title: "os" }, { id: 'twofactor', title: "twofactor", format: '2fa' }];
            }
            if (showInvalidLoginAttempts) { data.columns.push({ id: 'msg', title: "msg", format: 'msg' }); }

            // Add all log entries
            var entries = [];
            for (var i in docs) {
                // If MySQL or MariaDB query, we can't filter on MsgID, so we have to do it here.
                if (msgIdFilter.indexOf(docs[i].msgid) < 0) continue;

                if (command.groupBy == 1) { // Add entry per user
                    if (data.groups[docs[i].userid] == null) { data.groups[docs[i].userid] = { entries: [] }; }
                    const entry = { time: docs[i].time.valueOf(), ip: docs[i].msgArgs[0], browser: docs[i].msgArgs[1], os: docs[i].msgArgs[2], twofactor: docs[i].twoFactorType ? docs[i].twoFactorType : '' };
                    if (showInvalidLoginAttempts) { entry.msg = docs[i].msgid }
                    data.groups[docs[i].userid].entries.push(entry);
                } else if (command.groupBy == 3) { // Add entry per day
                    var day;
                    if ((typeof command.l == 'string') && (typeof command.tz == 'string')) {
                        day = new Date(docs[i].time).toLocaleDateString(command.l, { timeZone: command.tz });
                    } else {
                        day = docs[i].time; // TODO
                    }
                    if (data.groups[day] == null) { data.groups[day] = { entries: [] }; }
                    const entry = { time: docs[i].time.valueOf(), userid: docs[i].userid, ip: docs[i].msgArgs[0], browser: docs[i].msgArgs[1], os: docs[i].msgArgs[2], twofactor: docs[i].twoFactorType ? docs[i].twoFactorType : '' };
                    if (showInvalidLoginAttempts) { entry.msg = docs[i].msgid }
                    data.groups[day].entries.push(entry);
                }
            }

            try { ws.send(JSON.stringify({ action: 'report', data: data })); } catch (ex) { }
        });
    }

    function databaseRecordsReport(command) {
        if (user.siteadmin != 0xFFFFFFFF) return; // This report is only available to full administrators
        parent.parent.db.getDbStats(function (stats) {
            var data = { groups: { 0: { entries: [] } } };
            data.columns = [{ id: 'record', title: "Record", format: 'records' }, { id: 'recordcount', title: "Count", align: 'center', sumBy: true }];
            for (var i in stats) { if ((i != 'total') && (stats[i] > 0)) { data.groups[0].entries.push({ record: i, recordcount: stats[i] }); } }
            try { ws.send(JSON.stringify({ action: 'report', data: data })); } catch (ex) { }
        });
    }

    // Return detailed information about an array of nodeid's
    function getDeviceDetailedInfo(nodeids, type, func) {
        if (nodeids == null) { getAllDeviceDetailedInfo(type, func); return; }
        var results = [], resultPendingCount = 0;
        for (var i in nodeids) {
            // Fetch the node from the database
            resultPendingCount++;
            const getNodeFunc = function (node, rights, visible) {
                if ((node != null) && (visible == true)) {
                    const getNodeSysInfoFunc = function (err, docs) {
                        const getNodeNetInfoFunc = function (err, docs) {
                            var netinfo = null;
                            if ((err == null) && (docs != null) && (docs.length == 1)) { netinfo = docs[0]; }
                            resultPendingCount--;
                            getNodeNetInfoFunc.results.push({ node: parent.CloneSafeNode(getNodeNetInfoFunc.node), sys: getNodeNetInfoFunc.sysinfo, net: netinfo });
                            if (resultPendingCount == 0) { func(getNodeFunc.results, type); }
                        }
                        getNodeNetInfoFunc.results = getNodeSysInfoFunc.results;
                        getNodeNetInfoFunc.nodeid = getNodeSysInfoFunc.nodeid;
                        getNodeNetInfoFunc.node = getNodeSysInfoFunc.node;
                        if ((err == null) && (docs != null) && (docs.length == 1)) { getNodeNetInfoFunc.sysinfo = docs[0]; }

                        // Query the database for network information
                        db.Get('if' + getNodeSysInfoFunc.nodeid, getNodeNetInfoFunc);
                    }
                    getNodeSysInfoFunc.results = getNodeFunc.results;
                    getNodeSysInfoFunc.nodeid = getNodeFunc.nodeid;
                    getNodeSysInfoFunc.node = node;

                    // Query the database for system information
                    db.Get('si' + getNodeFunc.nodeid, getNodeSysInfoFunc);
                } else { resultPendingCount--; }
                if (resultPendingCount == 0) { func(getNodeFunc.results.join('\r\n'), type); }
            }
            getNodeFunc.results = results;
            getNodeFunc.nodeid = nodeids[i];
            parent.GetNodeWithRights(domain, user, nodeids[i], getNodeFunc);
        }
    }

    // Update all device shares for a nodeid list to a new meshid
    // This is used when devices move to a new device group, changes are not evented.
    function changeDeviceShareMeshId(nodes, meshid) {
        parent.db.GetAllTypeNoTypeField('deviceshare', domain.id, function (err, docs) {
            if (err != null) return;
            for (var i = 0; i < docs.length; i++) {
                const doc = docs[i];
                if (nodes.indexOf(doc.nodeid) >= 0) {
                    doc.xmeshid = meshid;
                    doc.type = 'deviceshare';
                    db.Set(doc);
                }
            }
        });
    }

    // Return detailed information about all nodes this user has access to
    function getAllDeviceDetailedInfo(type, func) {
        // If we are not paging, get all devices visible to this user
        if (obj.visibleDevices == null) {

            // Get all device groups this user has access to
            var links = parent.GetAllMeshIdWithRights(user);

            // Add any nodes with direct rights or any nodes with user group direct rights
            var extraids = getUserExtraIds();

            // Request a list of all nodes
            db.GetAllTypeNoTypeFieldMeshFiltered(links, extraids, domain.id, 'node', null, obj.deviceSkip, obj.deviceLimit, function (err, docs) {
                if (docs == null) { docs = []; }
                parent.common.unEscapeAllLinksFieldName(docs);

                var results = [], resultPendingCount = 0;
                for (i in docs) {
                    // Check device links, if a link points to an unknown user, remove it.
                    parent.cleanDevice(docs[i]);

                    // Fetch the node from the database
                    resultPendingCount++;
                    const getNodeFunc = function (node, rights, visible) {
                        if ((node != null) && (visible == true)) {
                            const getNodeSysInfoFunc = function (err, docs) {
                                const getNodeNetInfoFunc = function (err, docs) {
                                    var netinfo = null;
                                    if ((err == null) && (docs != null) && (docs.length == 1)) { netinfo = docs[0]; }
                                    resultPendingCount--;
                                    getNodeNetInfoFunc.results.push({ node: parent.CloneSafeNode(getNodeNetInfoFunc.node), sys: getNodeNetInfoFunc.sysinfo, net: netinfo });
                                    if (resultPendingCount == 0) { func(getNodeFunc.results, type); }
                                }
                                getNodeNetInfoFunc.results = getNodeSysInfoFunc.results;
                                getNodeNetInfoFunc.nodeid = getNodeSysInfoFunc.nodeid;
                                getNodeNetInfoFunc.node = getNodeSysInfoFunc.node;
                                if ((err == null) && (docs != null) && (docs.length == 1)) { getNodeNetInfoFunc.sysinfo = docs[0]; }

                                // Query the database for network information
                                db.Get('if' + getNodeSysInfoFunc.nodeid, getNodeNetInfoFunc);
                            }
                            getNodeSysInfoFunc.results = getNodeFunc.results;
                            getNodeSysInfoFunc.nodeid = getNodeFunc.nodeid;
                            getNodeSysInfoFunc.node = node;

                            // Query the database for system information
                            db.Get('si' + getNodeFunc.nodeid, getNodeSysInfoFunc);
                        } else { resultPendingCount--; }
                        if (resultPendingCount == 0) { func(getNodeFunc.results.join('\r\n'), type); }
                    }
                    getNodeFunc.results = results;
                    getNodeFunc.nodeid = docs[i]._id;
                    parent.GetNodeWithRights(domain, user, docs[i]._id, getNodeFunc);
                }
            });
        } else {
            // If we are paging, we know what devices the user is look at
            for (var id in obj.visibleDevices) {
                // Fetch the node from the database
                resultPendingCount++;
                const getNodeFunc = function (node, rights, visible) {
                    if ((node != null) && (visible == true)) {
                        const getNodeSysInfoFunc = function (err, docs) {
                            const getNodeNetInfoFunc = function (err, docs) {
                                var netinfo = null;
                                if ((err == null) && (docs != null) && (docs.length == 1)) { netinfo = docs[0]; }
                                resultPendingCount--;
                                getNodeNetInfoFunc.results.push({ node: parent.CloneSafeNode(getNodeNetInfoFunc.node), sys: getNodeNetInfoFunc.sysinfo, net: netinfo });
                                if (resultPendingCount == 0) { func(getNodeFunc.results, type); }
                            }
                            getNodeNetInfoFunc.results = getNodeSysInfoFunc.results;
                            getNodeNetInfoFunc.nodeid = getNodeSysInfoFunc.nodeid;
                            getNodeNetInfoFunc.node = getNodeSysInfoFunc.node;
                            if ((err == null) && (docs != null) && (docs.length == 1)) { getNodeNetInfoFunc.sysinfo = docs[0]; }

                            // Query the database for network information
                            db.Get('if' + getNodeSysInfoFunc.nodeid, getNodeNetInfoFunc);
                        }
                        getNodeSysInfoFunc.results = getNodeFunc.results;
                        getNodeSysInfoFunc.nodeid = getNodeFunc.nodeid;
                        getNodeSysInfoFunc.node = node;

                        // Query the database for system information
                        db.Get('si' + getNodeFunc.nodeid, getNodeSysInfoFunc);
                    } else { resultPendingCount--; }
                    if (resultPendingCount == 0) { func(getNodeFunc.results.join('\r\n'), type); }
                }
                getNodeFunc.results = results;
                getNodeFunc.nodeid = id;
                parent.GetNodeWithRights(domain, user, id, getNodeFunc);
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
            var f = { t: 3, d: 111 }, stat = null;
            try { stat = fs.statSync(path + '/' + dir[i]); } catch (ex) { }
            if (stat != null) {
                if ((stat.mode & 0x004000) == 0) { f.s = stat.size; f.d = stat.mtime.getTime(); } else { f.t = 2; f.f = readFilesRec(path + '/' + dir[i]); }
                r[dir[i]] = f;
            }
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

        // Add files for each mesh
        const meshes = parent.GetAllMeshWithRights(user, MESHRIGHT_SERVERFILES);
        for (var i in meshes) {
            const mesh = meshes[i];
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
        var msg2fa = ((parent.parent.msgserver != null) && (parent.parent.msgserver.providers != 0) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)));
        var authFactorCount = 0;
        if (typeof user.otpsecret == 'string') { authFactorCount++; } // Authenticator time factor
        if (email2fa && (user.otpekey != null)) { authFactorCount++; } // EMail factor
        if (sms2fa && (user.phone != null)) { authFactorCount++; } // SMS factor
        if (msg2fa && (user.msghandle != null)) { authFactorCount++; } // Messaging factor
        if (user.otphkeys != null) { authFactorCount += user.otphkeys.length; } // FIDO hardware factor
        if ((authFactorCount > 0) && (user.otpkeys != null)) { authFactorCount++; } // Backup keys
        return authFactorCount;
    }

    // Return true if the event is for a device that is part of the currently visible page
    function isEventWithinPage(ids) {
        if (obj.visibleDevices == null) return true; // Add devices are visible
        var r = true;
        for (var i in ids) {
            // If the event is for a visible device, return true
            if (ids[i].startsWith('node/')) { r = false; if (obj.visibleDevices[ids[i]] != null) return true; }
        }
        return r; // If this event is not for any specific device, return true
    }

    return obj;
};
