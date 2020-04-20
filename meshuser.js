/**
* @description MeshCentral MeshAgent
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

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshUser = function (parent, db, ws, req, args, domain, user) {
    const fs = require('fs');
    const path = require('path');
    const common = parent.common;

    // User Consent Flags
    const USERCONSENT_DesktopNotifyUser = 1;
    const USERCONSENT_TerminalNotifyUser = 2;
    const USERCONSENT_FilesNotifyUser = 4;
    const USERCONSENT_DesktopPromptUser = 8;
    const USERCONSENT_TerminalPromptUser = 16;
    const USERCONSENT_FilesPromptUser = 32;
    const USERCONSENT_ShowConnectionToolbar = 64;

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 1;
    const MESHRIGHT_MANAGEUSERS = 2;
    const MESHRIGHT_MANAGECOMPUTERS = 4;
    const MESHRIGHT_REMOTECONTROL = 8;
    const MESHRIGHT_AGENTCONSOLE = 16;
    const MESHRIGHT_SERVERFILES = 32;
    const MESHRIGHT_WAKEDEVICE = 64;
    const MESHRIGHT_SETNOTES = 128;
    const MESHRIGHT_REMOTEVIEWONLY = 256;
    const MESHRIGHT_NOTERMINAL = 512;
    const MESHRIGHT_NOFILES = 1024;
    const MESHRIGHT_NOAMT = 2048;
    const MESHRIGHT_DESKLIMITEDINPUT = 4096;
    const MESHRIGHT_LIMITEVENTS = 8192;
    const MESHRIGHT_CHATNOTIFY = 16384;
    const MESHRIGHT_UNINSTALL = 32768;
    const MESHRIGHT_NODESKTOP = 65536;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 1;           // 0x00000001
    const SITERIGHT_MANAGEUSERS = 2;            // 0x00000002
    const SITERIGHT_SERVERRESTORE = 4;          // 0x00000004
    const SITERIGHT_FILEACCESS = 8;             // 0x00000008
    const SITERIGHT_SERVERUPDATE = 16;          // 0x00000010
    const SITERIGHT_LOCKED = 32;                // 0x00000020
    const SITERIGHT_NONEWGROUPS = 64;           // 0x00000040
    const SITERIGHT_NOMESHCMD = 128;            // 0x00000080
    const SITERIGHT_USERGROUPS = 256;           // 0x00000100

    var obj = {};
    obj.user = user;
    obj.domain = domain;
    obj.ws = ws;

    // Server side Intel AMT stack
    const WsmanComm = require('./amt/amt-wsman-comm.js');
    const Wsman = require('./amt/amt-wsman.js');
    const Amt = require('./amt/amt.js');

    // Send a message to the user
    //obj.send = function (data) { try { if (typeof data == 'string') { ws.send(Buffer.from(data, 'binary')); } else { ws.send(data); } } catch (e) { } }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (addr.startsWith('::ffff:')) { return addr.substring(7); } else { return addr; } }

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug('user', 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug('user', 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket

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
        ws.removeAllListeners(["message", "close", "error"]);
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
    function routeCommandToNode(command) {
        if (common.validateString(command.nodeid, 8, 128) == false) return false;
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
                        command.sessionid = ws.sessionId;   // Set the session id, required for responses
                        command.rights = rights;            // Add user rights flags to the message
                        command.consent = 0;
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        if (typeof mesh.consent == 'number') { command.consent |= mesh.consent; } // Add device group user consent
                        if (typeof node.consent == 'number') { command.consent |= node.consent; } // Add node user consent
                        if (typeof user.consent == 'number') { command.consent |= user.consent; } // Add user consent
                        command.username = user.name;       // Add user name
                        command.userid = user._id;          // Add user id
                        command.remoteaddr = cleanRemoteAddr(req.ip); // User's IP address
                        if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                        delete command.nodeid;              // Remove the nodeid since it's implied
                        try { agent.send(JSON.stringify(command)); } catch (ex) { }
                    }
                });
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerId(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    parent.GetNodeWithRights(domain, user, agent.dbNodeKey, function (node, rights, visible) {
                        var mesh = parent.meshes[routing.meshid];
                        if ((node != null) && (mesh != null) && ((rights & MESHRIGHT_REMOTECONTROL) || (rights & MESHRIGHT_REMOTEVIEWONLY))) { // 8 is remote control permission
                            command.fromSessionid = ws.sessionId;   // Set the session id, required for responses
                            command.rights = rights;                // Add user rights flags to the message
                            command.consent = 0;
                            if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                            if (typeof mesh.consent == 'number') { command.consent |= mesh.consent; } // Add device group user consent
                            if (typeof node.consent == 'number') { command.consent |= node.consent; } // Add node user consent
                            if (typeof user.consent == 'number') { command.consent |= user.consent; } // Add user consent
                            command.username = user.name;           // Add user name
                            command.userid = user._id;              // Add user id
                            command.remoteaddr = cleanRemoteAddr(req.ip); // User's IP address
                            if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                            parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        }
                    });
                }
            }
        }
        return true;
    }

    // Route a command to all targets in a mesh
    function routeCommandToMesh(meshid, command) {
        // Send the request to all peer servers
        // TODO !!!!

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
                if ((event.domain == null) || (event.domain == domain.id)) {
                    try {
                        if (event == 'close') { try { delete req.session; } catch (ex) { } obj.close(); }
                        else if (event == 'resubscribe') { user.subscriptions = parent.subscribe(user._id, ws); }
                        else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                        else {
                            // Because of the device group "Show Self Events Only", we need to do more checks here.
                            if (id.startsWith('mesh/')) {
                                // Check if we have rights to get this message. If we have limited events on this mesh, don't send the event to the user.
                                var meshrights = parent.GetMeshRights(user, id);
                                if ((meshrights == 0xFFFFFFFF) || ((meshrights & MESHRIGHT_LIMITEVENTS) == 0) || (ids.indexOf(user._id) >= 0)) {
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
                if (parent.parent.platform != 'win32') { stats.cpuavg = os.loadavg(); }
                var serverStats = {
                    UserAccounts: Object.keys(parent.users).length,
                    DeviceGroups: Object.keys(parent.meshes).length,
                    AgentSessions: Object.keys(parent.wsagents).length,
                    ConnectedUsers: Object.keys(parent.wssessions).length,
                    UsersSessions: Object.keys(parent.wssessions2).length,
                    RelaySessions: parent.relaySessionCount,
                    RelayCount: Object.keys(parent.wsrelays).length
                };
                if (parent.relaySessionErrorCount != 0) { serverStats.RelayErrors = parent.relaySessionErrorCount; }
                if (parent.parent.mpsserver != null) { serverStats.ConnectedIntelAMT = Object.keys(parent.parent.mpsserver.ciraConnections).length; }

                // Take a look at agent errors
                var agentstats = parent.getAgentStats();
                var errorCounters = {}, errorCountersCount = 0;
                if (agentstats.meshDoesNotExistCount > 0) { errorCountersCount++; errorCounters.UnknownGroup = agentstats.meshDoesNotExistCount; }
                if (agentstats.invalidPkcsSignatureCount > 0) { errorCountersCount++; errorCounters.InvalidPKCSsignature = agentstats.invalidPkcsSignatureCount; }
                if (agentstats.invalidRsaSignatureCount > 0) { errorCountersCount++; errorCounters.InvalidRSAsiguature = agentstats.invalidRsaSignatureCount; }
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
            var serverinfo = { name: domain.dns ? domain.dns : parent.certificates.CommonName, mpsname: parent.certificates.AmtMpsName, mpsport: mpsport, mpspass: args.mpspass, port: httpport, emailcheck: ((parent.parent.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (args.lanonly != true) && (parent.certificates.CommonName != null) && (parent.certificates.CommonName.indexOf('.') != -1)), domainauth: ((domain.auth == 'sspi') || (domain.auth == 'ldap')), serverTime: Date.now() };
            serverinfo.languages = parent.renderLanguages;
            serverinfo.tlshash = Buffer.from(parent.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(); // SHA384 of server HTTPS certificate
            if ((parent.parent.config.domains[domain.id].amtacmactivation != null) && (parent.parent.config.domains[domain.id].amtacmactivation.acmmatch != null)) {
                var matchingDomains = [];
                for (var i in parent.parent.config.domains[domain.id].amtacmactivation.acmmatch) {
                    var cn = parent.parent.config.domains[domain.id].amtacmactivation.acmmatch[i].cn;
                    if ((cn != '*') && (matchingDomains.indexOf(cn) == -1)) { matchingDomains.push(cn); }
                }
                if (matchingDomains.length > 0) { serverinfo.amtAcmFqdn = matchingDomains; }
            }
            if (args.notls == true) { serverinfo.https = false; } else { serverinfo.https = true; serverinfo.redirport = args.redirport; }
            if (typeof domain.userconsentflags == 'number') { serverinfo.consent = domain.userconsentflags; }
            if ((typeof domain.usersessionidletimeout == 'number') && (domain.usersessionidletimeout > 0)) { serverinfo.timeout = (domain.usersessionidletimeout * 60 * 1000); }

            // Send server information
            try { ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: serverinfo })); } catch (ex) { }

            // Send user information to web socket, this is the first thing we send
            try {
                var xuserinfo = parent.CloneSafeUser(parent.users[user._id]);
                if ((user.siteadmin == 0xFFFFFFFF) && (parent.parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0)) { xuserinfo.manageAllDeviceGroups = true; }
                ws.send(JSON.stringify({ action: 'userinfo', userinfo: xuserinfo }));
            } catch (ex) { }

            if (user.siteadmin == 0xFFFFFFFF) {
                // Send server tracing information
                try { ws.send(JSON.stringify({ action: 'traceinfo', traceSources: parent.parent.debugRemoteSources })); } catch (ex) { }

                // Send any server warnings if any
                var serverWarnings = parent.parent.getServerWarnings();
                if (serverWarnings.length > 0) { try { ws.send(JSON.stringify({ action: 'serverwarnings', warnings: serverWarnings })); } catch (ex) { } }
            }

            // See how many times bad login attempts where made since the last login
            const lastLoginTime = parent.users[user._id].pastlogin;
            if (lastLoginTime != null) {
                db.GetFailedLoginCount(user.name, user.domain, new Date(lastLoginTime * 1000), function (count) {
                    if (count > 0) { try { ws.send(JSON.stringify({ action: 'msg', type: 'notify', title: "Security Warning", tag: 'ServerNotify', id: Math.random(), value: "There has been " + count + " failed login attempts on this account since the last login." })); } catch (ex) { } delete user.pastlogin; }
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
            case 'ping': { try { ws.send(JSON.stringify({ action: 'pong' })); } catch (ex) { } break; }
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
                            cookie: parent.parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: cleanRemoteAddr(req.ip) }, parent.parent.loginCookieEncryptionKey),
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
                    if ((user.siteadmin & 21) == 0) return; // Only site administrators with "site backup" or "site restore" or "site update" permissions can use this.
                    if (common.validateInt(command.hours, 0, 24 * 30) == false) return;
                    db.GetServerStats(command.hours, function (err, docs) {
                        if (err == null) {
                            try { ws.send(JSON.stringify({ action: 'servertimelinestats', events: docs })); } catch (ex) { }
                        }
                    });
                    break;
                }
            case 'serverstats':
                {
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
                                if ((state.connectivity & 2) != 0) { var cira = parent.parent.mpsserver.ciraConnections[docs[i]._id]; if (cira != null) { docs[i].cict = cira.tag.connectTime; } }
                            }

                            // Compress the meshid's
                            meshid = docs[i].meshid;
                            if (!r[meshid]) { r[meshid] = []; }
                            delete docs[i].meshid;

                            // Remove Intel AMT credential if present
                            if (docs[i].intelamt != null && docs[i].intelamt.pass != null) { delete docs[i].intelamt.pass; }

                            // If GeoLocation not enabled, remove any node location information
                            if (domain.geolocation != true) {
                                if (docs[i].iploc != null) { delete docs[i].iploc; }
                                if (docs[i].wifiloc != null) { delete docs[i].wifiloc; }
                                if (docs[i].gpsloc != null) { delete docs[i].gpsloc; }
                                if (docs[i].userloc != null) { delete docs[i].userloc; }
                            }

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
                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) return;
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
                                try { ws.send(JSON.stringify(doc)); } catch (ex) { }
                            } else {
                                try { ws.send(JSON.stringify({ action: 'getsysinfo', nodeid: node._id, tag: command.tag, noinfo: true })); } catch (ex) { }
                            }
                        });
                    });
                    break;
                }
            case 'lastconnect':
                {
                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) return;
                        // Query the database for the last time this node connected
                        db.Get('lc' + command.nodeid, function (err, docs) {
                            if ((docs != null) && (docs.length > 0)) {
                                try { ws.send(JSON.stringify({ action: 'lastconnect', nodeid: command.nodeid, time: docs[0].time, addr: docs[0].addr })); } catch (ex) { }
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
                        else if ((command.fileop == 'rename') && (common.IsFilenameValid(command.oldname) == true) && (common.IsFilenameValid(command.newname) == true)) {
                            // Rename
                            try { fs.renameSync(path + '/' + command.oldname, path + '/' + command.newname); } catch (e) { }
                        }
                        else if ((command.fileop == 'copy') || (command.fileop == 'move')) {
                            if (common.validateArray(command.names, 1) == false) return;
                            var scpath = meshPathToRealPath(command.scpath, user); // This will also check access rights
                            if (scpath == null) break;
                            // TODO: Check quota if this is a copy!!!!!!!!!!!!!!!!
                            for (i in command.names) {
                                var s = parent.path.join(scpath, command.names[i]), d = parent.path.join(path, command.names[i]);
                                sendUpdate = false;
                                copyFile(s, d, function (op) { if (op != null) { fs.unlink(op, function (err) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); }); } else { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } }, ((command.fileop == 'move') ? s : null));
                            }
                        }

                        if (sendUpdate == true) { parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } // Fire an event causing this user to update this files
                    }
                    break;
                }
            case 'serverconsole':
                {
                    // This is a server console message, only process this if full administrator
                    if (user.siteadmin != 0xFFFFFFFF) break;

                    var r = '';
                    var cmdargs = splitArgs(command.value);
                    if (cmdargs.length == 0) break;
                    const cmd = cmdargs[0].toLowerCase();
                    cmdargs = parseArgs(cmdargs);

                    switch (cmd) {
                        case 'help': {
                            var fin = '', f = '', availcommands = 'help,info,versions,args,resetserver,showconfig,usersessions,closeusersessions,tasklimiter,setmaxtasks,cores,migrationagents,agentstats,webstats,mpsstats,swarmstats,acceleratorsstats,updatecheck,serverupdate,nodeconfig,heapdump,relays,autobackup,backupconfig,dupagents,dispatchtable,badlogins,showpaths,le,lecheck,leevents,dbstats';
                            if (parent.parent.config.settings.heapdump === true) { availcommands += ',heapdump'; }
                            availcommands = availcommands.split(',').sort();
                            while (availcommands.length > 0) {
                                if (f.length > 80) { fin += (f + ',\r\n'); f = ''; }
                                f += (((f != '') ? ', ' : ' ') + availcommands.shift());
                            }
                            if (f != '') { fin += f; }
                            r = 'Available commands: \r\n' + fin + '.';
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
                        case 'webstats': {
                            var stats = parent.getStats();
                            for (var i in stats) {
                                if (typeof stats[i] == 'object') { r += (i + ': ' + JSON.stringify(stats[i]) + '\r\n'); } else { r += (i + ': ' + stats[i] + '\r\n'); }
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
                        case 'dbstats': {
                            parent.parent.db.getStats(function (stats) {
                                var r2 = '';
                                for (var i in stats) { r2 += (i + ': ' + stats[i] + '\r\n'); }
                                try { ws.send(JSON.stringify({ action: 'serverconsole', value: r2, tag: command.tag })); } catch (ex) { }
                            })
                            break;
                        }
                        case 'serverupdate': {
                            r = 'Performing server update...';
                            if (parent.parent.performServerUpdate() == false) { r = 'Server self-update not possible.'; }
                            break;
                        }
                        case 'print': {
                            console.log(cmdargs["_"][0]);
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
                        case 'info': {
                            var info = process.memoryUsage();
                            info.dbType = ['None', 'NeDB', 'MongoJS', 'MongoDB'][parent.db.databaseType];
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
                        case 'showconfig': {
                            // Make a copy of the configuration and hide any secrets
                            var config = common.Clone(parent.parent.config);
                            if (config.settings) {
                                if (config.settings.configkey) { config.settings.configkey = '(present)'; }
                                if (config.settings.sessionkey) { config.settings.sessionkey = '(present)'; }
                                if (config.settings.dbencryptkey) { config.settings.dbencryptkey = '(present)'; }
                            }
                            if (config.domains) {
                                for (var i in config.domains) {
                                    if (config.domains[i].yubikey && config.domains[i].yubikey.secret) { config.domains[i].yubikey.secret = '(present)'; }
                                }
                            }

                            r = JSON.stringify(removeAllUnderScore(config), null, 4);
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
                                    r += ', ' + cleanRemoteAddr(parent.wsrelays[i].peer1.req.ip);
                                    if (parent.wsrelays[i].peer1.user) { r += ' (User:' + parent.wsrelays[i].peer1.user.name + ')' }
                                }
                                if (parent.wsrelays[i].peer2 != null) {
                                    r += ' to ' + cleanRemoteAddr(parent.wsrelays[i].peer2.req.ip);
                                    if (parent.wsrelays[i].peer2.user) { r += ' (User:' + parent.wsrelays[i].peer2.user.name + ')' }
                                }
                                r += '\r\n';
                            }
                            if (r == '') { r = 'No relays.'; }
                            break;
                        }
                        case 'autobackup': {
                            var backupResult = parent.db.performBackup();
                            if (backupResult == 0) { r = 'Starting auto-backup...'; } else { r = 'Backup alreay in progress.'; }
                            break;
                        }
                        case 'backupconfig': {
                            r = parent.db.getBackupConfig();
                            break;
                        }
                        default: { // This is an unknown command, return an error message
                            r = 'Unknown command \"' + cmd + '\", type \"help\" for list of avaialble commands.';
                            break;
                        }
                    }

                    if (r != '') { try { ws.send(JSON.stringify({ action: 'serverconsole', value: r, tag: command.tag })); } catch (ex) { } }
                    break;
                }
            case 'msg':
                {
                    // Route this command to a target node
                    routeCommandToNode(command);
                    break;
                }
            case 'events':
                {
                    // User filtered events
                    if ((command.user != null) && ((user.siteadmin & 2) != 0)) { // SITERIGHT_MANAGEUSERS
                        // TODO: Add the meshes command.user has access to (???)
                        var filter = ['user/' + domain.id + '/' + command.user.toLowerCase()];
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
                        parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                            if (node == null) return;

                            // Put a limit on the number of returned entries if present
                            var limit = 10000;
                            if (common.validateInt(command.limit, 1, 60000) == true) { limit = command.limit; }

                            if (((rights & MESHRIGHT_LIMITEVENTS) != 0) && (rights != 0xFFFFFFFF)) {
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
                        for (var link in obj.user.links) { if (((obj.user.links[link].rights & MESHRIGHT_LIMITEVENTS) != 0) && ((obj.user.links[link].rights != 0xFFFFFFFF))) { exGroupFilter2.push(link); } }
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
            case 'users':
                {
                    // Request a list of all users
                    if ((user.siteadmin & 2) == 0) break;
                    var docs = [];
                    for (i in parent.users) {
                        if ((parent.users[i].domain == domain.id) && (parent.users[i].name != '~')) {
                            // If we are part of a user group, we can only see other members of our own group
                            if ((user.groups == null) || (user.groups.length == 0) || ((parent.users[i].groups != null) && (findOne(parent.users[i].groups, user.groups)))) {
                                docs.push(parent.CloneSafeUser(parent.users[i]));
                            }
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'users', users: docs, tag: command.tag })); } catch (ex) { }
                    break;
                }
            case 'changelang':
                {
                    if (common.validateString(command.lang, 1, 6) == false) return;

                    // Always lowercase the email address
                    command.lang = command.lang.toLowerCase();

                    // Update the user's email
                    var oldlang = user.lang;
                    if (command.lang == '*') { delete user.lang; } else { user.lang = command.lang; }
                    parent.db.SetUser(user);

                    // Event the change
                    var message = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id };
                    if (db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    message.msg = 'Changed language of user ' + user.name + ' from ' + (oldlang ? oldlang : 'default') + ' to ' + (user.lang ? user.lang : 'default');

                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    parent.parent.DispatchEvent(targets, obj, message);

                    break;
                }
            case 'changeemail':
                {
                    // If the email is the username, this command is not allowed.
                    if (domain.usernameisemail) return;

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
                                try { ws.send(JSON.stringify({ action: 'msg', type: 'notify', title: 'Account Settings', id: Math.random(), tag: 'ServerNotify', value: 'Failed to change email address, another account already using: <b>' + EscapeHtml(command.email) + '</b>.' })); } catch (ex) { }
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
                                if (parent.parent.mailserver != null) { parent.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email, parent.getLanguageCodes(req)); }
                            }
                        });
                    }
                    break;
                }
            case 'verifyemail':
                {
                    // Send a account email verification email
                    if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) return;
                    if (common.validateString(command.email, 3, 1024) == false) return;

                    // Always lowercase the email address
                    command.email = command.email.toLowerCase();

                    if ((parent.parent.mailserver != null) && (obj.user.email.toLowerCase() == command.email)) {
                        // Send the verification email
                        parent.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email, parent.getLanguageCodes(req));
                    }
                    break;
                }
            case 'wssessioncount':
                {
                    // Request a list of all web socket user session count
                    var wssessions = {};
                    if ((user.siteadmin & 2) == 0) break;
                    if (parent.parent.multiServer == null) {
                        // No peering, use simple session counting
                        for (i in parent.wssessions) {
                            if (parent.wssessions[i][0].domainid == domain.id) {
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
                            if (i.split('/')[1] == domain.id) {
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
                    var err = null, delusersplit, deluserid, deluser;
                    try {
                        if ((user.siteadmin & 2) == 0) { err = 'Permission denied'; }
                        else if (common.validateString(command.userid, 1, 2048) == false) { err = 'Invalid userid'; }
                        else {
                            delusersplit = command.userid.split('/');
                            deluserid = command.userid;
                            deluser = parent.users[deluserid];
                            if (deluser == null) { err = 'User does not exists'; }
                            else if ((delusersplit.length != 3) || (delusersplit[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
                            else if ((deluser.siteadmin == 0xFFFFFFFF) && (user.siteadmin != 0xFFFFFFFF)) { err = 'Permission denied'; } // Need full admin to remote another administrator
                            else if ((user.groups != null) && (user.groups.length > 0) && ((deluser.groups == null) || (findOne(deluser.groups, user.groups) == false))) { err = 'Invalid user group'; } // Can only perform this operation on other users of our group.
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

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
                                    change = 'Removed user ' + deluser.name + ' from group ' + mesh.name;
                                    var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id, invite: mesh.invite };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [deluser._id, user._id]), obj, event);
                                }
                            } else if (i.startsWith('node/')) {
                                // Get the node and the rights for this node
                                parent.GetNodeWithRights(domain, deluser, i, function (node, rights, visible) {
                                    if ((node == null) || (node.links == null) || (node.links[deluser._id] == null)) return;

                                    // Remove the link and save the node to the database
                                    delete node.links[deluser._id];
                                    if (Object.keys(node.links).length == 0) { delete node.links; }
                                    db.Set(parent.cleanDevice(node));

                                    // Event the node change
                                    var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: (command.rights == 0) ? ('Removed user device rights for ' + node.name) : ('Changed user device rights for ' + node.name), node: parent.CloneSafeNode(node) }
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                    parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id), obj, event);
                                });
                            }
                        }
                    }

                    // TODO (UserGroups): Remove user groups??

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
                    parent.parent.DispatchEvent(targets, obj, { etype: 'user', userid: deluserid, username: deluser.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
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

                    // Send the notification on all user sessions for this server
                    for (var i in parent.wssessions2) {
                        try {
                            if (parent.wssessions2[i].domainid == domain.id) {
                                var sessionUser = parent.users[parent.wssessions2[i].userid];
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
                    // Add many new user accounts
                    if ((user.siteadmin & 2) == 0) break;
                    if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) break;
                    if (!Array.isArray(command.users)) break;
                    var userCount = 0;
                    for (var i in command.users) {
                        if (domain.usernameisemail) { if (command.users[i].email) { command.users[i].user = command.users[i].email; } else { command.users[i].email = command.users[i].user; } } // If the email is the username, set this here.
                        if (common.validateUsername(command.users[i].user, 1, 256) == false) break; // Username is between 1 and 64 characters, no spaces
                        if ((command.users[i].user == '~') || (command.users[i].user.indexOf('/') >= 0)) break; // This is a reserved user name
                        if (common.validateString(command.users[i].pass, 1, 256) == false) break; // Password is between 1 and 256 characters
                        if (common.checkPasswordRequirements(command.users[i].pass, domain.passwordrequirements) == false) break; // Password does not meet requirements
                        if ((command.users[i].email != null) && (common.validateEmail(command.users[i].email, 1, 1024) == false)) break; // Check if this is a valid email address
                        userCount++;
                    }

                    // Check if we exceed the maximum number of user accounts
                    db.isMaxType(domain.limits.maxuseraccounts + userCount, 'user', domain.id, function (maxExceed) {
                        if (maxExceed) {
                            // Account count exceed, do notification

                            // Create the notification message
                            var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: domain.id };

                            // Get the list of sessions for this user
                            var sessions = parent.wssessions[user._id];
                            if (sessions != null) { for (i in sessions) { try { if (sessions[i].domainid == domain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
                            // TODO: Notify all sessions on other peers.
                        } else {
                            for (var i in command.users) {
                                // Check if this is an existing user
                                var newuserid = 'user/' + domain.id + '/' + command.users[i].user.toLowerCase();
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
                                            event = { etype: 'user', userid: newuser._id, username: newuser.name, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msg: 'Account created, username is ' + newuser.name, domain: domain.id };
                                        } else {
                                            event = { etype: 'user', userid: newuser._id, username: newuser.name, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msg: 'Account created, email is ' + newuser.email, domain: domain.id };
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
                    var err = null, newusername, newuserid;
                    try {
                        if ((user.siteadmin & 2) == 0) { err = 'Permission denied'; }
                        else if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { err = 'Unable to add user in this mode'; }
                        else if (common.validateUsername(command.username, 1, 256) == false) { err = 'Invalid username'; } // Username is between 1 and 64 characters, no spaces
                        else if (common.validateString(command.pass, 1, 256) == false) { err = 'Invalid password'; } // Password is between 1 and 256 characters
                        else if (command.username.indexOf('/') >= 0) { err = 'Invalid username'; } // Usernames can't have '/'
                        else if ((command.randomPassword !== true) && (common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false)) { err = 'Invalid password'; } // Password does not meet requirements
                        else if ((command.email != null) && (common.validateEmail(command.email, 1, 1024) == false)) { err = 'Invalid email'; } // Check if this is a valid email address
                        else {
                            newusername = command.username;
                            newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase();
                            if (newusername == '~') { err = 'Invalid username'; } // This is a reserved user name
                            else if (command.siteadmin != null) {
                                if ((typeof command.siteadmin != 'number') || (Number.isInteger(command.siteadmin) == false)) { err = 'Invalid site permissions'; } // Check permissions
                                else if ((user.siteadmin != 0xFFFFFFFF) && ((command.siteadmin & (0xFFFFFFFF - 224)) != 0)) { err = 'Invalid site permissions'; }
                            }
                            if (parent.users[newuserid]) { err = 'User already exists'; } // Account already exists
                        }
                    } catch (ex) { err = 'Validation exception'; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) {
                            try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: err })); } catch (ex) { }
                        } else {
                            // Send error back, user not found.
                            displayNotificationMessage(err, 'New Account', 'ServerNotify');
                        }
                        break;
                    }

                    // Check if we exceed the maximum number of user accounts
                    db.isMaxType(domain.limits.maxuseraccounts, 'user', domain.id, function (maxExceed) {
                        if (maxExceed) {
                            // Account count exceed, do notification
                            if (command.responseid != null) {
                                // Respond privately if requested
                                try { ws.send(JSON.stringify({ action: 'adduser', responseid: command.responseid, result: 'maxUsersExceed' })); } catch (ex) { }
                            } else {
                                // Create the notification message
                                var notification = { action: 'msg', type: 'notify', id: Math.random(), value: "Account limit reached.", title: "Server Limit", userid: user._id, username: user.name, domain: domain.id };

                                // Get the list of sessions for this user
                                var sessions = parent.wssessions[user._id];
                                if (sessions != null) { for (i in sessions) { try { if (sessions[i].domainid == domain.id) { sessions[i].send(JSON.stringify(notification)); } } catch (ex) { } } }
                                // TODO: Notify all sessions on other peers.
                            }
                        } else {
                            // Remove any events for this userid
                            if (command.removeEvents === true) { db.RemoveAllUserEvents(domain.id, newuserid); }

                            // Create a new user
                            var newuser = { type: 'user', _id: newuserid, name: newusername, creation: Math.floor(Date.now() / 1000), domain: domain.id };
                            if (command.siteadmin != null) { newuser.siteadmin = command.siteadmin; }
                            else if (domain.newaccountsrights) { newuser.siteadmin = domain.newaccountsrights; }
                            if (command.email != null) { newuser.email = command.email.toLowerCase(); if (command.emailVerified === true) { newuser.emailVerified = true; } } // Email
                            if (command.resetNextLogin === true) { newuser.passchange = -1; } else { newuser.passchange = Math.floor(Date.now() / 1000); }
                            if (user.groups) { newuser.groups = user.groups; } // New accounts are automatically part of our groups (Realms).

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
                                        event = { etype: 'user', userid: newuser._id, username: newusername, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msg: 'Account created, username is ' + command.username, domain: domain.id };
                                    } else {
                                        event = { etype: 'user', userid: newuser._id, username: newusername, account: parent.CloneSafeUser(newuser), action: 'accountcreate', msg: 'Account created, email is ' + command.email.toLowerCase(), domain: domain.id };
                                    }
                                    if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                    parent.parent.DispatchEvent(targets, obj, event);

                                    // Perform email invitation
                                    if ((command.emailInvitation == true) && (command.emailVerified == true) && command.email && parent.parent.mailserver) {
                                        parent.parent.mailserver.sendAccountInviteMail(domain, user.name, newusername, command.email.toLowerCase(), command.pass, parent.getLanguageCodes(req));
                                    }

                                    // Log in the auth log
                                    if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created user account ' + newuser.name); }

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
                    // Edit a user account, may involve changing email or administrator permissions
                    if (((user.siteadmin & 2) != 0) || (user._id == command.id)) {
                        var chguser = parent.users[command.id];
                        change = 0;
                        if (chguser) {
                            // If the target user is admin and we are not admin, no changes can be made.
                            if ((chguser.siteadmin == 0xFFFFFFFF) && (user.siteadmin != 0xFFFFFFFF)) return;

                            // Can only perform this operation on other users of our group.
                            if (user.siteadmin != 0xFFFFFFFF) {
                                if ((user.groups != null) && (user.groups.length > 0) && ((chguser.groups == null) || (findOne(chguser.groups, user.groups) == false))) return;
                            }

                            // Validate and change email
                            if (domain.usernameisemail !== true) {
                                if (common.validateString(command.email, 1, 1024) && (chguser.email != command.email)) { chguser.email = command.email.toLowerCase(); change = 1; }
                            }

                            // Make changes
                            if ((command.emailVerified === true || command.emailVerified === false) && (chguser.emailVerified != command.emailVerified)) { chguser.emailVerified = command.emailVerified; change = 1; }
                            if ((common.validateInt(command.quota, 0) || command.quota == null) && (command.quota != chguser.quota)) { chguser.quota = command.quota; if (chguser.quota == null) { delete chguser.quota; } change = 1; }
                            if ((command.consent != null) && (typeof command.consent == 'number')) { if (command.consent == 0) { delete chguser.consent; } else { chguser.consent = command.consent; } change = 1; }

                            // Site admins can change any server rights, user managers can only change AccountLock, NoMeshCmd and NoNewGroups
                            if (chguser._id !== user._id) { // We can't change our own siteadmin permissions.
                                var chgusersiteadmin = chguser.siteadmin ? chguser.siteadmin : 0;
                                if (((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 2) && (((chgusersiteadmin ^ command.siteadmin) & 0xFFFFFF1F) == 0))) && common.validateInt(command.siteadmin) && (chguser.siteadmin != command.siteadmin)) { chguser.siteadmin = command.siteadmin; change = 1; }
                            }

                            // When sending a notification about a group change, we need to send to all the previous and new groups.
                            var allTargetGroups = chguser.groups;
                            if ((Array.isArray(command.groups)) && ((user._id != command.id) || (user.siteadmin == 0xFFFFFFFF))) {
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
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msg: 'Account changed: ' + chguser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }
                            if ((chguser.siteadmin) && (chguser.siteadmin != 0xFFFFFFFF) && (chguser.siteadmin & 32)) {
                                // If the user is locked out of this account, disconnect now
                                parent.parent.DispatchEvent([chguser._id], obj, 'close'); // Disconnect all this user's sessions
                            }
                        }
                    }
                    break;
                }
            case 'usergroups':
                {
                    // TODO: Return only groups in the same administrative domain?
                    if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) {
                        // We are not user group administrator, return a list with limited data for our domain.
                        var groups = {}, groupCount = 0;
                        for (var i in parent.userGroups) { if (parent.userGroups[i].domain == domain.id) { groupCount++; groups[i] = { name: parent.userGroups[i].name }; } }
                        try { ws.send(JSON.stringify({ action: 'usergroups', ugroups: groupCount?groups:null, tag: command.tag })); } catch (ex) { }
                    } else {
                        // We are user group administrator, return a full user group list for our domain.
                        var groups = {}, groupCount = 0;
                        for (var i in parent.userGroups) { if (parent.userGroups[i].domain == domain.id) { groupCount++; groups[i] = parent.userGroups[i]; } }
                        try { ws.send(JSON.stringify({ action: 'usergroups', ugroups: groupCount ? groups : null, tag: command.tag })); } catch (ex) { }
                    }
                    break;
                }
            case 'createusergroup':
                {
                    var err = null;
                    try {
                        // Check if we have new group restriction
                        if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { err = 'Permission denied'; }

                        // In some situations, we need a verified email address to create a device group.
                        else if ((parent.parent.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (user.emailVerified !== true) && (user.siteadmin != 0xFFFFFFFF)) { err = 'Email verification required'; } // User must verify it's email first.

                        // Create user group
                        else if (common.validateString(command.name, 1, 64) == false) { err = 'Invalid group name'; } // User group name is between 1 and 64 characters
                        else if ((command.desc != null) && (common.validateString(command.desc, 0, 1024) == false)) { err = 'Invalid group description'; } // User group description is between 0 and 1024 characters

                        // If we are cloning from an existing user group, check that.
                        if (command.clone) {
                            if (common.validateString(command.clone, 1, 256) == false) { err = 'Invalid clone groupid'; }
                            else {
                                var clonesplit = command.clone.split('/');
                                if ((clonesplit.length != 3) || (clonesplit[0] != 'ugrp') || (clonesplit[1] != domain.id)) { err = 'Invalid clone groupid'; }
                                else if (parent.userGroups[command.clone] == null) { err = 'Invalid clone groupid'; }
                            }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'createusergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // We only create Agent-less Intel AMT mesh (Type1), or Agent mesh (Type2)
                    parent.crypto.randomBytes(48, function (err, buf) {
                        // Create new device group identifier
                        var ugrpid = 'ugrp/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');

                        // Create the new device group
                        var ugrp = { type: 'ugrp', _id: ugrpid, name: command.name, desc: command.desc, domain: domain.id, links: {} };

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
                                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msg: 'User group membership changed: ' + xuser.name, domain: domain.id };
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
                                            var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: xmesh._id, name: xmesh.name, mtype: xmesh.mtype, desc: xmesh.desc, action: 'meshchange', links: xmesh.links, msg: 'Added group ' + ugrp.name + ' to mesh ' + xmesh.name, domain: domain.id, invite: mesh.invite };
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
                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugrpid, name: ugrp.name, desc: ugrp.desc, action: 'createusergroup', links: ugrp.links, msg: 'User group created: ' + ugrp.name, domain: domain.id };
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
                    if ((user.siteadmin & SITERIGHT_USERGROUPS) == 0) { return; }

                    // Change the name or description of a user group
                    if (common.validateString(command.ugrpid, 1, 1024) == false) break; // Check the user group id
                    var ugroupidsplit = command.ugrpid.split('/');
                    if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || (ugroupidsplit[1] != domain.id)) break;

                    db.Get(command.ugrpid, function (err, groups) {
                        if ((err != null) || (groups.length != 1)) return;
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
                                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msg: 'User group membership changed: ' + xuser.name, domain: domain.id };
                                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                        parent.parent.DispatchEvent(targets, obj, event);
                                    }
                                } else if (i.startsWith('mesh/')) {
                                    var xmesh = parent.meshes[i];
                                    if (xmesh && xmesh.links) {
                                        delete xmesh.links[group._id];
                                        db.Set(xmesh);

                                        // Notify mesh change
                                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: xmesh._id, name: xmesh.name, mtype: xmesh.mtype, desc: xmesh.desc, action: 'meshchange', links: xmesh.links, msg: 'Removed group ' + group.name + ' from mesh ' + xmesh.name, domain: domain.id, invite: mesh.invite };
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
                        var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, action: 'deleteusergroup', msg: change, domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(['*', group._id, user._id], obj, event);

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' deleted user group ' + group.name); }
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
                        if (change != '') {
                            db.Set(group);
                            var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msg: change, domain: domain.id };
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
                            if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || (ugroupidsplit[1] != domain.id)) { err = 'Invalid groupid'; }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

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
                            var chguserid = 'user/' + domain.id + '/' + command.usernames[i].toLowerCase(), chguser = parent.users[chguserid];
                            if (chguser != null) {
                                // Add mesh to user
                                if (chguser.links == null) { chguser.links = {}; }
                                chguser.links[group._id] = { rights: 1 };
                                db.SetUser(chguser);
                                parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');

                                // Notify user change
                                var targets = ['*', 'server-users', user._id, chguser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msg: 'User group membership changed: ' + chguser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);

                                // Add a user to the user group
                                group.links[chguserid] = { userid: chguser.id, name: chguser.name, rights: 1 };
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
                            var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msg: 'Added user ' + chguser.name + ' to user group ' + group.name, domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                            parent.parent.DispatchEvent(['*', group._id, user._id, chguserid], obj, event);
                        }

                        if (unknownUsers.length > 0) {
                            // Send error back, user not found.
                            displayNotificationMessage('User' + ((unknownUsers.length > 1) ? 's' : '') + ' ' + EscapeHtml(unknownUsers.join(', ')) + ' not found.', 'Device Group', 'ServerNotify');
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
                            if ((ugroupidsplit.length != 3) || (ugroupidsplit[0] != 'ugrp') || (ugroupidsplit[1] != domain.id)) { err = 'Invalid groupid'; }
                        }
                    } catch (ex) { err = 'Validation exception: ' + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'removeuserfromusergroup', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Check if the user exists
                    var chguser = parent.users[command.userid];
                    if (chguser != null) {
                        var change = false;
                        if ((chguser.links != null) && (chguser.links[command.ugrpid] != null)) {
                            change = true;
                            delete chguser.links[command.ugrpid];

                            // Notify user change
                            var targets = ['*', 'server-users', user._id, chguser._id];
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msg: 'User group membership changed: ' + chguser.name, domain: domain.id };
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
                                    var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: group._id, name: group.name, desc: group.desc, action: 'usergroupchange', links: group.links, msg: 'Removed user ' + chguser.name + ' from user group ' + group.name, domain: domain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                    parent.parent.DispatchEvent(['*', group._id, user._id, chguser._id], obj, event);
                                }
                            }
                        }
                    }

                    break;
                }
            case 'changemeshnotify':
                {
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
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Mesh notification change.', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);

                    break;
                }
            case 'changepassword':
                {
                    // Change our own password
                    if (common.validateString(command.oldpass, 1, 256) == false) break;
                    if (common.validateString(command.newpass, 1, 256) == false) break;
                    if ((command.hint != null) && (common.validateString(command.hint, 0, 256) == false)) break;
                    if (common.checkPasswordRequirements(command.newpass, domain.passwordrequirements) == false) break; // Password does not meet requirements

                    // Start by checking the old password
                    parent.checkUserPassword(domain, user, command.oldpass, function (result) {
                        if (result == true) {
                            // Update the password
                            require('./pass').hash(command.newpass, function (err, salt, hash, tag) {
                                if (err) {
                                    // Send user notification of error
                                    displayNotificationMessage('Error, password not changed.', 'Account Settings', 'ServerNotify');
                                } else {
                                    // Change the password
                                    if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (command.hint != null)) {
                                        var hint = command.hint;
                                        if (hint.length > 250) { hint = hint.substring(0, 250); }
                                        user.passhint = hint;
                                    }
                                    user.salt = salt;
                                    user.hash = hash;
                                    user.passchange = Math.floor(Date.now() / 1000);
                                    delete user.passtype;
                                    db.SetUser(user);

                                    var targets = ['*', 'server-users'];
                                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Account password changed: ' + user.name, domain: domain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                    parent.parent.DispatchEvent(targets, obj, event);

                                    // Send user notification of password change
                                    displayNotificationMessage('Password changed.', 'Account Settings', 'ServerNotify');

                                    // Log in the auth log
                                    if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' changed this password'); }
                                }
                            }, 0);
                        } else {
                            // Send user notification of error
                            displayNotificationMessage('Current password not correct.', 'Account Settings', 'ServerNotify');
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
                        if ((user.siteadmin != 0xFFFFFFFF) & (chguser.siteadmin == 0xFFFFFFFF)) break;

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
                                    if (chguser.otpekey) { delete chguser.otpekey; }
                                    if (chguser.otpsecret) { delete chguser.otpsecret; }
                                    if (chguser.otphkeys) { delete chguser.otphkeys; }
                                    if (chguser.otpkeys) { delete chguser.otpkeys; }
                                }
                                db.SetUser(chguser);

                                var targets = ['*', 'server-users', user._id, chguser._id];
                                if (chguser.groups) { for (var i in chguser.groups) { targets.push('server-users:' + i); } }
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(chguser), action: 'accountchange', msg: 'Changed account credentials.', domain: domain.id };
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

                    // Get the list of sessions for this user
                    var sessions = parent.wssessions[command.userid];
                    if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                    if (parent.parent.multiServer != null) {
                        // TODO: Add multi-server support
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
                            'action': 'msg', 'type': 'notify', id: Math.random(), 'value': "Chat Request, Click here to accept.", 'title': user.name, 'userid': user._id, 'username': user.name, 'tag': 'meshmessenger/' + encodeURIComponent(command.userid) + '/' + encodeURIComponent(user._id)
                        };

                        // Get the list of sessions for this user
                        var sessions = parent.wssessions[command.userid];
                        if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                        if (parent.parent.multiServer != null) {
                            // TODO: Add multi-server support
                        }
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
                        var url = "http" + (args.notls ? '' : 's') + "://" + parent.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.nodeid) + "/" + encodeURIComponent(user._id) + "&title=" + encodeURIComponent(user.name);

                        // Create the notification message
                        routeCommandToNode({ "action": "openUrl", "nodeid": command.nodeid, "userid": user._id, "username": user.name, "url": url });
                    });
                    break;
                }
            case 'serverversion':
                {
                    // Check the server version
                    if ((user.siteadmin & 16) == 0) break;
                    //parent.parent.getLatestServerVersion(function (currentVersion, latestVersion) { try { ws.send(JSON.stringify({ action: 'serverversion', current: currentVersion, latest: latestVersion })); } catch (ex) { } });
                    parent.parent.getServerTags(function (tags, err) { try { ws.send(JSON.stringify({ action: 'serverversion', tags: tags })); } catch (ex) { } });
                    break;
                }
            case 'serverupdate':
                {
                    // Perform server update
                    if ((user.siteadmin & 16) == 0) break;
                    if ((command.version != null) && (typeof command.version != 'string')) break;
                    parent.parent.performServerUpdate(command.version);
                    break;
                }
            case 'servererrors':
                {
                    // Load the server error log
                    if ((user.siteadmin & 16) == 0) break;
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
                        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 64) != 0)) { err = 'Permission denied'; }

                        // In some situations, we need a verified email address to create a device group.
                        else if ((parent.parent.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (user.emailVerified !== true) && (user.siteadmin != 0xFFFFFFFF)) { err = 'Email verification required'; } // User must verify it's email first.

                        // Create mesh
                        else if (common.validateString(command.meshname, 1, 64) == false) { err = 'Invalid group name'; } // Meshname is between 1 and 64 characters
                        else if ((command.desc != null) && (common.validateString(command.desc, 0, 1024) == false)) { err = 'Invalid group description'; } // Mesh description is between 0 and 1024 characters
                        else if ((command.meshtype != 1) && (command.meshtype != 2)) { err = 'Invalid group type'; }
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
                        mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links };
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
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msg: 'Device group created: ' + command.meshname, domain: domain.id };
                        parent.parent.DispatchEvent(['*', meshid, user._id], obj, event); // Even if DB change stream is active, this event must be acted upon.

                        // Log in the auth log
                        if (parent.parent.authlog) { parent.parent.authLog('https', 'User ' + user.name + ' created device group ' + mesh.name); }

                        try { ws.send(JSON.stringify({ action: 'createmesh', responseid: command.responseid, result: 'ok', meshid: meshid, links: links })); } catch (ex) { }
                    });
                    break;
                }
            case 'deletemesh':
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

                    try {
                        // Delete a mesh and all computers within it
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
                    if (parent.GetMeshRights(user, mesh) != 0xFFFFFFFF) { err = 'Access denied'; }
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = 'Invalid group'; } // Invalid domain, operation only valid for current domain

                    // Handle any errors
                    if (err != null) { if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'deletemesh', responseid: command.responseid, result: err })); } catch (ex) { } } return; }

                    // Fire the removal event first, because after this, the event will not route
                    var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msg: 'Device group deleted: ' + command.meshname, domain: domain.id };
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
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(xuser), action: 'accountchange', msg: 'Device group membership changed: ' + xuser.name, domain: domain.id };
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
                                var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: xgroup._id, name: xgroup.name, desc: xgroup.desc, action: 'usergroupchange', links: xgroup.links, msg: 'User group changed: ' + xgroup.name, domain: domain.id };
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
                    if (common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    mesh = parent.meshes[command.meshid];
                    change = '';

                    if (mesh) {
                        // Check if this user has rights to do this
                        if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_EDITMESH) == 0) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        if ((common.validateString(command.meshname, 1, 64) == true) && (command.meshname != mesh.name)) { change = 'Group name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }
                        if ((common.validateString(command.desc, 0, 1024) == true) && (command.desc != mesh.desc)) { if (change != '') change += ' and description changed'; else change += 'Group "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
                        if ((common.validateInt(command.flags) == true) && (command.flags != mesh.flags)) { if (change != '') change += ' and flags changed'; else change += 'Group "' + mesh.name + '" flags changed'; mesh.flags = command.flags; }
                        if ((common.validateInt(command.consent) == true) && (command.consent != mesh.consent)) { if (change != '') change += ' and consent changed'; else change += 'Group "' + mesh.name + '" consent changed'; mesh.consent = command.consent; }

                        // See if we need to change device group invitation codes
                        if (mesh.mtype == 2) {
                            if (command.invite === '*') {
                                // Clear invite codes
                                if (mesh.invite != null) { delete mesh.invite; }
                                if (change != '') { change += ' and invite code changed'; } else { change += 'Group "' + mesh.name + '" invite code changed'; }
                            } else if (typeof command.invite === 'object') {
                                // Set invite codes
                                if ((mesh.invite == null) || (mesh.invite.codes != command.invite.codes) || (mesh.invite.flags != command.invite.flags)) {
                                    // Check if an invite code is not already in use.
                                    var dup = null;
                                    for (var i in command.invite.codes) {
                                        for (var j in parent.meshes) {
                                            if ((j != command.meshid) && (parent.meshes[j].invite != null) && (parent.meshes[j].invite.codes.indexOf(command.invite.codes[i]) >= 0)) { dup = command.invite.codes[i]; break; }
                                        }
                                    }
                                    if (dup != null) {
                                        // A duplicate was found, don't allow this change.
                                        displayNotificationMessage('Error, invite code \"' + dup + '\" already in use.', 'Invite Codes');
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
                    }
                    break;
                }
            case 'addmeshuser':
                {
                    var err = null;
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
                            if (mesh == null) { err = 'Unknown group'; }
                            else if (((selfMeshRights = parent.GetMeshRights(user, mesh)) & MESHRIGHT_MANAGEUSERS) == 0) { err = 'Permission denied'; }
                            else if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = 'Invalid domain'; } // Invalid domain, operation only valid for current domain
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
                        for (var i in command.usernames) { command.userids.push('user/' + domain.id + '/' + command.usernames[i].toLowerCase()); }
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

                        if (newuser != null) {
                            // Can't add or modify self
                            if (newuserid == obj.user._id) { msgs.push("Can't change self"); continue; }

                            var targetMeshRights = 0;
                            if ((newuser.links != null) && (newuser.links[command.meshid] != null) && (newuser.links[command.meshid].rights != null)) { targetMeshRights = newuser.links[command.meshid].rights; }
                            if ((targetMeshRights == 0xFFFFFFFF) && (selfMeshRights != 0xFFFFFFFF)) { msgs.push("Can't change rights of device group administrator"); continue; } // A non-admin can't kick out an admin

                            if (command.remove === true) {
                                // Remove mesh from user or user group
                                delete newuser.links[command.meshid];
                            } else {
                                // Adjust rights since we can't add more rights that we have outself for MESHRIGHT_MANAGEUSERS
                                if ((selfMeshRights != 0xFFFFFFFF) && (command.meshadmin == 0xFFFFFFFF)) { msgs.push("Can't set device group administrator, if not administrator"); continue; }
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
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(newuser), action: 'accountchange', msg: 'Device group membership changed: ' + newuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (newuserid.startsWith('ugrp/')) {
                                // Notify user group change
                                var targets = ['*', 'server-ugroups', user._id, newuser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: newuser._id, name: newuser.name, desc: newuser.desc, action: 'usergroupchange', links: newuser.links, msg: 'User group changed: ' + newuser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            }

                            var event;
                            if (command.remove === true) {
                                // Remove userid from the mesh
                                delete mesh.links[newuserid];
                                db.Set(mesh);
                                event = { etype: 'mesh', username: newuser.name, userid: user._id, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + newuser.name + ' from mesh ' + mesh.name, domain: domain.id, invite: mesh.invite };
                            } else {
                                // Add userid to the mesh
                                mesh.links[newuserid] = { name: newuser.name, rights: command.meshadmin };
                                db.Set(mesh);
                                event = { etype: 'mesh', username: newuser.name, userid: user._id, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Added user ' + newuser.name + ' to mesh ' + mesh.name, domain: domain.id, invite: mesh.invite };
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
                        displayNotificationMessage('User' + ((unknownUsers.length > 1) ? 's' : '') + ' ' + EscapeHtml(unknownUsers.join(', ')) + ' not found.', 'Device Group', 'ServerNotify');
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addmeshuser', responseid: command.responseid, result: msgs.join(', '), success: successCount, failed: failCount })); } catch (ex) { } }
                    break;
                }
            case 'adddeviceuser': {
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
                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adddeviceuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                    break;
                }

                // Convert user names to userid's
                if (command.userids == null) {
                    command.userids = [];
                    for (var i in command.usernames) {
                        if (command.usernames[i] != null) { command.userids.push('user/' + domain.id + '/' + command.usernames[i].toLowerCase()); }
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
                                var event = { etype: 'user', userid: user._id, username: user.name, action: 'accountchange', msg: (command.rights == 0) ? ('Removed user device rights for ' + newuser.name) : ('Changed user device rights for ' + newuser.name), domain: domain.id, account: parent.CloneSafeUser(newuser), nodeListChange: newuserid };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (newuserid.startsWith('ugrp/')) {
                                db.Set(newuser);

                                // Notify user group change
                                var targets = ['*', 'server-ugroups', newuser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: newuser._id, name: newuser.name, action: 'usergroupchange', links: newuser.links, msg: 'User group changed: ' + newuser.name, domain: domain.id };
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
                        var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: (command.rights == 0) ? ('Removed user device rights for ' + node.name) : ('Changed user device rights for ' + node.name), node: parent.CloneSafeNode(node) }
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(dispatchTargets, obj, event);
                    }

                    if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'adddeviceuser', responseid: command.responseid, result: 'ok' })); } catch (ex) { } }
                });

                break;
            }
            case 'removemeshuser':
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

                    try {
                        if (common.validateString(command.userid, 1, 1024) == false) { err = "Invalid userid"; } // Check userid
                        if (common.validateString(command.meshid, 1, 1024) == false) { err = "Invalid groupid"; } // Check meshid
                        if (command.userid.indexOf('/') == -1) { command.userid = 'user/' + domain.id + '/' + command.userid; }
                        if (command.userid == obj.user._id) { err = "Can't remove self"; } // Can't add of modify self
                        if ((command.userid.split('/').length != 3) || (command.userid.split('/')[1] != domain.id)) { err = "Invalid userid"; } // Invalid domain, operation only valid for current domain
                        else {
                            if (command.meshid.indexOf('/') == -1) { command.meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            mesh = parent.meshes[command.meshid];
                            if (mesh == null) { err = "Unknown device group"; }
                            else if ((parent.GetMeshRights(user, mesh) & MESHRIGHT_MANAGEUSERS) == 0) { err = "Permission denied"; }
                            else if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) { err = "Invalid domain"; } // Invalid domain, operation only valid for current domain
                        }
                    } catch (ex) { err = "Validation exception: " + ex; }

                    // Handle any errors
                    if (err != null) {
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addmeshuser', responseid: command.responseid, result: err })); } catch (ex) { } }
                        break;
                    }

                    // Check if the user exists - Just in case we need to delete a mesh right for a non-existant user, we do it this way. Technically, it's not possible, but just in case.
                    var deluserid = command.userid, deluser = null;
                    if (deluserid.startsWith('user/')) { deluser = parent.users[deluserid]; }
                    else if (deluserid.startsWith('ugrp/')) { deluser = parent.userGroups[deluserid]; }

                    // Search for a user name in that windows domain is the username starts with *\
                    if ((deluser == null) && (deluserid.startsWith('user/' + domain.id + '/*\\')) == true) {
                        var search = deluserid.split('/')[2].substring(1);
                        for (var i in parent.users) { if (i.endsWith(search) && (parent.users[i].domain == domain.id)) { deluser = parent.users[i]; command.userid = deluserid = deluser._id; break; } }
                    }

                    if (deluser != null) {
                        // Remove mesh from user
                        if (deluser.links != null && deluser.links[command.meshid] != null) {
                            var delmeshrights = deluser.links[command.meshid].rights;
                            if ((delmeshrights == 0xFFFFFFFF) && (parent.GetMeshRights(user, mesh) != 0xFFFFFFFF)) return; // A non-admin can't kick out an admin
                            delete deluser.links[command.meshid];
                            if (deluserid.startsWith('user/')) { db.SetUser(deluser); }
                            else if (deluserid.startsWith('ugrp/')) { db.Set(deluser); }
                            parent.parent.DispatchEvent([deluser._id], obj, 'resubscribe');

                            if (deluserid.startsWith('user/')) {
                                // Notify user change
                                var targets = ['*', 'server-users', user._id, deluser._id];
                                var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(deluser), action: 'accountchange', msg: 'Device group membership changed: ' + deluser.name, domain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                parent.parent.DispatchEvent(targets, obj, event);
                            } else if (deluserid.startsWith('ugrp/')) {
                                // Notify user group change
                                var targets = ['*', 'server-ugroups', user._id, deluser._id];
                                var event = { etype: 'ugrp', username: user.name, ugrpid: deluser._id, name: deluser.name, desc: deluser.desc, action: 'usergroupchange', links: deluser.links, msg: 'User group changed: ' + deluser.name, domain: domain.id };
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
                            event = { etype: 'mesh', username: user.name, userid: deluser.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + deluser.name + ' from group ' + mesh.name, domain: domain.id, invite: mesh.invite };
                        } else {
                            event = { etype: 'mesh', username: user.name, userid: (deluserid.split('/')[2]), meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + (deluserid.split('/')[2]) + ' from group ' + mesh.name, domain: domain.id, invite: mesh.invite };
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
                    if (common.validateInt(command.amtpolicy.type, 0, 3) == false) break; // Check the amtpolicy.type
                    if (command.amtpolicy.type === 2) {
                        if (common.validateString(command.amtpolicy.password, 0, 32) == false) break; // Check the amtpolicy.password
                        if ((command.amtpolicy.badpass != null) && common.validateInt(command.amtpolicy.badpass, 0, 1) == false) break; // Check the amtpolicy.badpass
                        if (common.validateInt(command.amtpolicy.cirasetup, 0, 2) == false) break; // Check the amtpolicy.cirasetup
                    } else if (command.amtpolicy.type === 3) {
                        if (common.validateString(command.amtpolicy.password, 0, 32) == false) break; // Check the amtpolicy.password
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
                        if (command.amtpolicy.type === 2) { amtpolicy = { type: command.amtpolicy.type, password: command.amtpolicy.password, badpass: command.amtpolicy.badpass, cirasetup: command.amtpolicy.cirasetup }; }
                        else if (command.amtpolicy.type === 3) { amtpolicy = { type: command.amtpolicy.type, password: command.amtpolicy.password, cirasetup: command.amtpolicy.cirasetup }; }
                        mesh.amt = amtpolicy;
                        db.Set(mesh);
                        var amtpolicy2 = Object.assign({}, amtpolicy); // Shallow clone
                        delete amtpolicy2.password;
                        var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, amt: amtpolicy2, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id, invite: mesh.invite };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(mesh, [user._id]), obj, event);

                        // Send new policy to all computers on this mesh
                        //routeCommandToMesh(command.meshid, { action: 'amtPolicy', amtPolicy: amtpolicy });

                        // See if the node is connected
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
                            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(command.meshid, [nodeid]), obj, { etype: 'node', userid: user._id, username: user.name, action: 'addnode', node: parent.CloneSafeNode(device), msg: 'Added device ' + command.devicename + ' to mesh ' + mesh.name, domain: domain.id });
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
                        if (command.responseid != null) { try { ws.send(JSON.stringify({ action: 'addmeshuser', responseid: command.responseid, result: err })); } catch (ex) { } }
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
                            if (((rights & MESHRIGHT_MANAGECOMPUTERS) == 0) || ((targetMeshRights & MESHRIGHT_MANAGECOMPUTERS) == 0)) {
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
                                if ((state.connectivity & 2) != 0) { var cira = parent.parent.mpsserver.ciraConnections[node._id]; if (cira != null) { node.cict = cira.tag.connectTime; } }
                            }

                            // Event the node change
                            var newMesh = parent.meshes[command.meshid];
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'nodemeshchange', nodeid: node._id, node: node, oldMeshId: oldMeshId, newMeshId: command.meshid, msg: 'Moved device ' + node.name + ' to group ' + newMesh.name, domain: domain.id };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
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
                            if ((rights & MESHRIGHT_MANAGECOMPUTERS) == 0) return;

                            // Delete this node including network interface information, events and timeline
                            db.Remove(node._id);                            // Remove node with that id
                            db.Remove('if' + node._id);                     // Remove interface information
                            db.Remove('nt' + node._id);                     // Remove notes
                            db.Remove('lc' + node._id);                     // Remove last connect time
                            db.Remove('si' + node._id);                     // Remove system information
                            db.RemoveSMBIOS(node._id);                      // Remove SMBios data
                            db.RemoveAllNodeEvents(node._id);               // Remove all events for this node
                            db.removeAllPowerEventsForNode(node._id);       // Remove all power events for this node
                            db.Get('ra' + obj.dbNodeKey, function (err, nodes) {
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
                                            var event = { etype: 'user', userid: cuser._id, username: cuser.name, action: 'accountchange', msg: 'Removed user device rights for ' + cuser.name, domain: domain.id, account: parent.CloneSafeUser(cuser) };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                            parent.parent.DispatchEvent(targets, obj, event);
                                        }
                                    }
                                }
                            }

                            // Event node deletion
                            var event = { etype: 'node', userid: user._id, username: user.name, action: 'removenode', nodeid: node._id, msg: 'Removed device ' + node.name + ' from group ' + parent.meshes[node.meshid].name, domain: domain.id };
                            // TODO: We can't use the changeStream for node delete because we will not know the meshid the device was in.
                            //if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to remove the node. Another event will come.
                            parent.parent.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id), obj, event);

                            // Disconnect all connections if needed
                            var state = parent.parent.GetConnectivityState(nodeid);
                            if ((state != null) && (state.connectivity != null)) {
                                if ((state.connectivity & 1) != 0) { parent.wsagents[nodeid].close(); } // Disconnect mesh agent
                                if ((state.connectivity & 2) != 0) { parent.parent.mpsserver.close(parent.parent.mpsserver.ciraConnections[nodeid]); } // Disconnect CIRA connection
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
                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_WAKEDEVICE) == 0) return;

                            // If this device is connected on MQTT, send a wake action.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.publish(node._id, 'powerAction', 'wake'); }

                            // Get the device interface information
                            db.Get('if' + node._id, function (err, nodeifs) {
                                if ((nodeifs != null) && (nodeifs.length == 1)) {
                                    var macs = [], nodeif = nodeifs[0];
                                    for (var i in nodeif.netif) { if (nodeif.netif[i].mac) { macs.push(nodeif.netif[i].mac); } }

                                    // Have the server send a wake-on-lan packet (Will not work in WAN-only)
                                    if (parent.parent.meshScanner != null) { parent.parent.meshScanner.wakeOnLan(macs); }

                                    // Get the list of mesh this user as access to
                                    var targetMeshes = [];
                                    for (i in user.links) { targetMeshes.push(i); } // TODO: Include used security groups!!

                                    // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                    for (i in parent.wsagents) {
                                        var agent = parent.wsagents[i];
                                        if ((targetMeshes.indexOf(agent.dbMeshKey) >= 0) && (agent.authenticated == 2)) {
                                            //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                            try { agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs })); } catch (ex) { }
                                        }
                                    }
                                }
                            });
                        });
                        // Confirm we may be doing something (TODO)
                        try { ws.send(JSON.stringify({ action: 'wakedevices' })); } catch (ex) { }
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
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_REMOTECONTROL) == 0) return;

                            // If this device is connected on MQTT, send a power action.
                            if (parent.parent.mqttbroker != null) { parent.parent.mqttbroker.publish(node._id, 'powerAction', ['', '', 'poweroff', 'reset', 'sleep'][command.actiontype]); }

                            // Get this device and send the power command
                            const agent = parent.wsagents[node._id];
                            if (agent != null) {
                                try { agent.send(JSON.stringify({ action: 'poweraction', actiontype: command.actiontype })); } catch (ex) { }
                            }
                        });

                        // Confirm we may be doing something (TODO)
                        try { ws.send(JSON.stringify({ action: 'poweraction' })); } catch (ex) { }
                    }
                    break;
                }
            case 'toast':
                {
                    if (common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    if (common.validateString(command.title, 1, 512) == false) break; // Check title
                    if (common.validateString(command.msg, 1, 4096) == false) break; // Check message
                    for (i in command.nodeids) {
                        // Get the node and the rights for this node
                        parent.GetNodeWithRights(domain, user, command.nodeids[i], function (node, rights, visible) {
                            // Check we have the rights to delete this device
                            if ((rights & MESHRIGHT_CHATNOTIFY) == 0) return;

                            // Get this device and send toast command
                            const agent = parent.wsagents[node._id];
                            if (agent != null) {
                                try { agent.send(JSON.stringify({ action: 'toast', title: command.title, msg: command.msg, sessionid: ws.sessionId, username: user.name, userid: user._id })); } catch (ex) { }
                            }
                        });
                    }
                    break;
                }
            case 'getnetworkinfo':
                {
                    // Argument validation
                    if (common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the node and the rights for this node
                    parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                        if (visible == false) return;

                        // Get network information about this node
                        db.Get('if' + node._id, function (err, netinfos) {
                            if ((netinfos == null) || (netinfos.length != 1)) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: node._id, netif: null })); } catch (ex) { } return; }
                            var netinfo = netinfos[0];
                            try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: node._id, updateTime: netinfo.updateTime, netif: netinfo.netif })); } catch (ex) { }
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
                        var mesh = parent.meshes[node.meshid];

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
                            if ((command.intelamt.user != null) && (command.intelamt.pass != undefined) && ((command.intelamt.user != node.intelamt.user) || (command.intelamt.pass != node.intelamt.pass))) { change = 1; node.intelamt.user = command.intelamt.user; node.intelamt.pass = command.intelamt.pass; changes.push('Intel AMT credentials'); }
                            if ((command.intelamt.tls != null) && (command.intelamt.tls != node.intelamt.tls)) { change = 1; node.intelamt.tls = command.intelamt.tls; changes.push('Intel AMT TLS'); }
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
                            if (command.rdpport == 3389) { event.node.rdpport = 3389; }
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
                        if ((node == null) || (((rights & MESHRIGHT_AGENTCONSOLE) == 0) && (user.siteadmin != 0xFFFFFFFF))) return;

                        if (command.type == 'default') {
                            // Send the default core to the agent
                            parent.parent.updateMeshCore(function () { parent.sendMeshAgentCore(user, domain, node._id, 'default'); });
                        } else if (command.type == 'clear') {
                            // Clear the mesh agent core on the mesh agent
                            parent.sendMeshAgentCore(user, domain, node._id, 'clear');
                        } else if (command.type == 'recovery') {
                            // Send the recovery core to the agent
                            parent.sendMeshAgentCore(user, domain, node._id, 'recovery');
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
                        if ((node == null) || (((rights & MESHRIGHT_AGENTCONSOLE) == 0) && (user.siteadmin != 0xFFFFFFFF))) return;

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
                        if ((nodes == null) || (nodes.length == 1)) {
                            if ((parent.GetMeshRights(user, nodes[0].meshid) & MESHRIGHT_REMOTECONTROL) != 0) {
                                // Add a user authentication cookie to a url
                                var cookieContent = { userid: user._id, domainid: user.domain };
                                if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
                                if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want to agent to TCP connect to a remote address
                                if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want to agent to TCP connect to a remote port
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
                        if ((parent.parent.mailserver == null) || (args.lanonly == true)) { err = 'Unsupported feature'; } // This operation requires the email server
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
                    parent.parent.mailserver.sendAgentInviteMail(domain, user.name, command.email.toLowerCase(), command.meshid, command.name, command.os, command.msg, command.flags, command.expire, parent.getLanguageCodes(req));

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
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: command.enabled ? "Enabled email two-factor authentication." :"Disabled email two-factor authentication.", domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                    break;
                }
            case 'otpauth-request':
                {
                    // Check if 2-step login is supported
                    const twoStepLoginSupported = ((parent.parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (parent.parent.certificates.CommonName.indexOf('.') != -1) && (args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Request a one time password to be setup
                        var otplib = null;
                        try { otplib = require('otplib'); } catch (ex) { }
                        if (otplib == null) { break; }
                        const secret = otplib.authenticator.generateSecret(); // TODO: Check the random source of this value.
                        ws.send(JSON.stringify({ action: 'otpauth-request', secret: secret, url: otplib.authenticator.keyuri(user.name, parent.certificates.CommonName, secret) }));
                    }
                    break;
                }
            case 'otpauth-setup':
                {
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
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Added authentication application.', domain: domain.id };
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
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Removed authentication application.', domain: domain.id };
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

                    // Perform a sub-action
                    var actionTaken = false, actionText = null;
                    if (command.subaction == 1) { // Generate a new set of tokens
                        var randomNumbers = [], v;
                        for (var i = 0; i < 10; i++) { do { v = getRandomEightDigitInteger(); } while (randomNumbers.indexOf(v) >= 0); randomNumbers.push(v); }
                        user.otpkeys = { keys: [] };
                        for (var i = 0; i < 10; i++) { user.otpkeys.keys[i] = { p: randomNumbers[i], u: true } }
                        actionTaken = true;
                        actionText = 'New 2FA backup codes generated.';
                    } else if (command.subaction == 2) { // Clear all tokens
                        actionTaken = (user.otpkeys != null);
                        delete user.otpkeys;
                        if (actionTaken) { actionText = '2FA backup codes cleared.'; }
                    }

                    // Save the changed user
                    if (actionTaken) { parent.db.SetUser(user); }

                    // Return one time passwords for this user
                    if (user.otpsecret || ((user.otphkeys != null) && (user.otphkeys.length > 0))) {
                        ws.send(JSON.stringify({ action: 'otpauth-getpasswords', passwords: user.otpkeys ? user.otpkeys.keys : null }));
                    }

                    // Notify change
                    if (actionText != null) {
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: actionText, domain: domain.id };
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
                    var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Removed security key.', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    parent.parent.DispatchEvent(targets, obj, event);
                    break;
                }
            case 'otp-hkey-yubikey-add':
                {
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
                            var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Added security key.', domain: domain.id };
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
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msg: 'Added security key.', domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);
                    } else {
                        //console.log('webauthn-endregister-error', regResult.error);
                        ws.send(JSON.stringify({ action: 'otp-hkey-setup-response', result: false, error: regResult.error, name: command.name, index: keyIndex }));
                    }

                    delete obj.hardwareKeyRegistrationRequest;
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
                if (common.validateString(command.state, 1, 10000) == false) break; // Check state size, no more than 10k
                command.state = parent.filterUserWebState(command.state); // Filter the state to remove anything bad
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
                if (xdomain != '') xdomain += "/";
                var url = "http" + (args.notls ? '' : 's') + "://" + serverName + ":" + httpsPort + "/" + xdomain + "agentinvite?c=" + inviteCookie;
                if (serverName.split('.') == 1) { url = "/" + xdomain + "agentinvite?c=" + inviteCookie; }

                ws.send(JSON.stringify({ action: 'createInviteLink', meshid: command.meshid, url: url, expire: command.expire, cookie: inviteCookie, responseid: command.responseid, tag: command.tag }));
                break;
            }
            case 'traceinfo': {
                if ((user.siteadmin == 0xFFFFFFFF) && (typeof command.traceSources == 'object')) {
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
                    if (rights == 0xFFFFFFFF) {
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
                        r.wsUrl = 'ws' + (args.notls ? '' : 's') + '://' + serverName + ':' + httpsPort + '/' + xdomain + 'mqtt.ashx';
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
                } else if (command.mode == 3) {
                    if (parent.parent.apfserver.apfConnections[command.nodeid] == null) break;
                }

                // Get the node and the rights for this node
                parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
                    if ((rights & MESHRIGHT_REMOTECONTROL) == 0) return;
                    handleAmtCommand(command, node);
                });
                break;
            }
            case 'distributeCore': {
                // This is only available when plugins are enabled since it could cause stress on the server
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin with plugins enabled
                for (var i in command.nodes) {
                    parent.sendMeshAgentCore(user, domain, command.nodes[i]._id, 'default');
                }
                break;
            }
            case 'plugins': {
                // Since plugin actions generally require a server restart, use the Full admin permission
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin with plugins enabled
                parent.db.getPlugins(function(err, docs) {
                    try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                });
                break;
            }
            case 'pluginLatestCheck': {
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin with plugins enabled
                parent.parent.pluginHandler.getPluginLatest()
                .then(function(latest) {
                    try { ws.send(JSON.stringify({ action: 'pluginVersionsAvailable', list: latest })); } catch (ex) { } 
                });
                break;
            }
            case 'addplugin': {
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin, plugins enabled
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
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin, plugins enabled
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
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin, plugins enabled
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
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin, plugins enabled
                parent.parent.pluginHandler.removePlugin(command.id, function(){
                    parent.db.getPlugins(function(err, docs) {
                        try { ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) { } 
                    });
                });
                break;
            }
            case 'getpluginversions': {
                if ((user.siteadmin & 0xFFFFFFFF) == 0 || parent.parent.pluginHandler == null) break; // must be full admin, plugins enabled
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
            default: {
                // Unknown user action
                console.log('Unknown action from user ' + user.name + ': ' + command.action + '.');
                break;
            }
        }
    }

    // Display a notification message for this session only.
    function displayNotificationMessage(msg, title, tag) { ws.send(JSON.stringify({ 'action': 'msg', 'type': 'notify', id: Math.random(), 'value': msg, 'title': title, 'userid': user._id, 'username': user.name, 'tag': tag })); }

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

    function removeAllUnderScore(obj) {
        if (typeof obj != 'object') return obj;
        for (var i in obj) { if (i.startsWith('_')) { delete obj[i]; } else if (typeof obj[i] == 'object') { removeAllUnderScore(obj[i]); } }
        return obj;
    }

    // Generate a 8 digit integer with even random probability for each value.
    function getRandomEightDigitInteger() {
        var bigInt;
        do { bigInt = parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000);
        return bigInt % 100000000;
    }

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

    return obj;
};