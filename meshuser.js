/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire & Bryan Roe
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

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshUser = function (parent, db, ws, req, args, domain, user) {
    var obj = {};
    obj.db = db;
    obj.ws = ws;
    obj.args = args;
    obj.user = user;
    obj.parent = parent;
    obj.domain = domain;
    obj.common = parent.common;
    obj.fs = require('fs');
    obj.path = require('path');
    obj.serverStatsTimer = null;

    // Send a message to the user
    //obj.send = function (data) { try { if (typeof data == 'string') { obj.ws.send(Buffer.from(data, 'binary')); } else { obj.ws.send(data); } } catch (e) { } }

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); obj.parent.parent.debug(1, 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); obj.parent.parent.debug(1, 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
    };

    // Convert a mesh path array into a real path on the server side
    function meshPathToRealPath(meshpath, user) {
        if (obj.common.validateArray(meshpath, 1) == false) return null;
        var splitid = meshpath[0].split('/');
        if (splitid[0] == 'user') {
            // Check user access
            if (meshpath[0] != user._id) return null; // Only allow own user folder
        } else if (splitid[0] == 'mesh') {
            // Check mesh access
            var meshrights = user.links[meshpath[0]];
            if (meshrights == null) return null; // No meth rights for this user
            meshrights = meshrights.rights; // Get the rights bit mask
            if ((meshrights == null) || ((meshrights & 32) == 0)) return null; // This user must have mesh rights to "server files"
        } else return null;
        var rootfolder = meshpath[0], rootfoldersplit = rootfolder.split('/'), domainx = 'domain';
        if (rootfoldersplit[1].length > 0) domainx = 'domain-' + rootfoldersplit[1];
        var path = obj.parent.path.join(obj.parent.filespath, domainx, rootfoldersplit[0] + "-" + rootfoldersplit[2]);
        for (var i = 1; i < meshpath.length; i++) { if (obj.common.IsFilenameValid(meshpath[i]) == false) { path = null; break; } path += ("/" + meshpath[i]); }
        return path;
    }

    // 
    function copyFile(src, dest, func, tag) {
        //var ss = obj.fs.createReadStream(src, { flags: 'rb' });
        //var ds = obj.fs.createWriteStream(dest, { flags: 'wb' });
        var ss = obj.fs.createReadStream(src);
        var ds = obj.fs.createWriteStream(dest);
        ss.fs = obj.fs;
        ss.pipe(ds);
        ds.ss = ss;
        /*
		if (!this._copyStreams) { this._copyStreams = {}; this._copyStreamID = 0; }
		ss.id = this._copyStreamID++;
		this._copyStreams[ss.id] = ss;
        */
        if (arguments.length == 3 && typeof arguments[2] === 'function') { ds.on('close', arguments[2]); }
        else if (arguments.length == 4 && typeof arguments[3] === 'function') { ds.on('close', arguments[3]); }
        ds.on('close', function () { /*delete this.ss.fs._copyStreams[this.ss.id];*/ func(tag); });
    }

    // Route a command to a target node
    function routeCommandToNode(command) {
        if (obj.common.validateString(command.nodeid, 8, 128) == false) return false;
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domain.id)) {
            // See if the node is connected
            var agent = obj.parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                var rights = user.links[agent.dbMeshKey];
                if ((rights != null) && ((rights.rights & 8) || (rights.rights & 256))) { // 8 is remote control permission, 256 is desktop read only
                    command.sessionid = ws.sessionId;   // Set the session id, required for responses.
                    command.rights = rights.rights;     // Add user rights flags to the message
                    delete command.nodeid;              // Remove the nodeid since it's implyed.
                    try { agent.send(JSON.stringify(command)); } catch (ex) { }
                }
            } else {
                // Check if a peer server is connected to this agent
                var routing = obj.parent.parent.GetRoutingServerId(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    var rights = user.links[routing.meshid];
                    if ((rights != null) && ((rights.rights & 8) || (rights.rights & 256))) { // 8 is remote control permission
                        command.fromSessionid = ws.sessionId;   // Set the session id, required for responses.
                        command.rights = rights.rights;         // Add user rights flags to the message
                        obj.parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                    }
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
        for (var nodeid in obj.parent.wsagents) {
            var agent = obj.parent.wsagents[nodeid];
            if (agent.dbMeshKey == meshid) { try { agent.send(JSON.stringify(command)); } catch (ex) { } }
        }
        return true;
    }

    try {
        // Check if the user is logged in
        if (user == null) { try { obj.ws.close(); } catch (e) { } return; }

        // Associate this websocket session with the web session
        obj.ws.userid = req.session.userid;
        obj.ws.domainid = domain.id;

        // Create a new session id for this user.
        obj.parent.crypto.randomBytes(20, function (err, randombuf) {
            obj.ws.sessionId = user._id + '/' + randombuf.toString('hex');

            // Add this web socket session to session list
            obj.parent.wssessions2[ws.sessionId] = obj.ws;
            if (!obj.parent.wssessions[user._id]) { obj.parent.wssessions[user._id] = [ws]; } else { obj.parent.wssessions[user._id].push(obj.ws); }
            if (obj.parent.parent.multiServer == null) {
                obj.parent.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.parent.wssessions[user._id].length, nolog: 1, domain: obj.domain.id });
            } else {
                obj.parent.recountSessions(obj.ws.sessionId); // Recount sessions
            }

            // If we have peer servers, inform them of the new session
            if (obj.parent.parent.multiServer != null) { obj.parent.parent.multiServer.DispatchMessage({ action: 'sessionStart', sessionid: obj.ws.sessionId }); }

            // Handle events
            obj.ws.HandleEvent = function (source, event) {
                if (!event.domain || event.domain == obj.domain.id) {
                    try {
                        if (event == 'close') { try { delete req.session; } catch (ex) { } obj.close(); }
                        else if (event == 'resubscribe') { user.subscriptions = obj.parent.subscribe(user._id, ws); }
                        else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                        else { ws.send(JSON.stringify({ action: 'event', event: event })); }
                    } catch (e) { }
                }
            };

            user.subscriptions = obj.parent.subscribe(user._id, ws); // Subscribe to events
            try { obj.ws._socket.setKeepAlive(true, 240000); } catch (ex) { } // Set TCP keep alive

            // Send current server statistics
            obj.SendServerStats = function () {
                obj.db.getStats(function (data) {
                    var os = require('os');
                    var stats = { action: 'serverstats', totalmem: os.totalmem(), freemem: os.freemem() };
                    if (obj.parent.parent.platform != 'win32') { stats.cpuavg = os.loadavg(); } // else { stats.cpuavg = [ 0.2435345, 0.523234234, 0.6435345345 ]; }
                    var serverStats = { "User Accounts": Object.keys(obj.parent.users).length, "Device Groups": Object.keys(obj.parent.meshes).length, "Connected Agents": Object.keys(obj.parent.wsagents).length, "Connected Users": Object.keys(obj.parent.wssessions2).length };
                    if (obj.parent.parent.mpsserver != null) { serverStats['Connected Intel&reg; AMT'] = Object.keys(obj.parent.parent.mpsserver.ciraConnections).length; }
                    stats.values = { "Server State": serverStats, "Database": { "Records": data.total, "Users": data.users, "Device Groups": data.meshes, "Devices": data.nodes, "Device NetInfo": data.nodeInterfaces, "Device Power Event": data.powerEvents, "Notes": data.notes, "Connection Records": data.connectEvents, "SMBios": data.smbios } }
                    try { ws.send(JSON.stringify(stats)); } catch (ex) { }
                });
            }

            // When data is received from the web socket
            ws.on('message', processWebSocketData);

            // If error, do nothing
            ws.on('error', function (err) { console.log(err); });

            // If the web socket is closed
            ws.on('close', function (req) {
                obj.parent.parent.RemoveAllEventDispatch(ws);
                if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); obj.serverStatsTimer = null; }
                if (req.session && req.session.ws && req.session.ws == ws) { delete req.session.ws; }
                if (obj.parent.wssessions2[ws.sessionId]) { delete obj.parent.wssessions2[ws.sessionId]; }
                if (obj.parent.wssessions[ws.userid]) {
                    var i = obj.parent.wssessions[ws.userid].indexOf(ws);
                    if (i >= 0) {
                        obj.parent.wssessions[ws.userid].splice(i, 1);
                        var user = obj.parent.users[ws.userid];
                        if (user) {
                            if (obj.parent.parent.multiServer == null) {
                                obj.parent.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.parent.wssessions[ws.userid].length, nolog: 1, domain: obj.domain.id });
                            } else {
                                obj.parent.recountSessions(ws.sessionId); // Recount sessions
                            }
                        }
                        if (obj.parent.wssessions[ws.userid].length == 0) { delete obj.parent.wssessions[ws.userid]; }
                    }
                }

                // If we have peer servers, inform them of the disconnected session
                if (obj.parent.parent.multiServer != null) { obj.parent.parent.multiServer.DispatchMessage({ action: 'sessionEnd', sessionid: ws.sessionId }); }
            });

            // Figure out the MPS port, use the alias if set
            var mpsport = ((obj.args.mpsaliasport != null) ? obj.args.mpsaliasport : obj.args.mpsport);
            var httpport = ((obj.args.aliasport != null) ? obj.args.aliasport : obj.args.port);

            // Build server information object
            var serverinfo = { name: obj.parent.certificates.CommonName, mpsname: obj.parent.certificates.AmtMpsName, mpsport: mpsport, mpspass: obj.args.mpspass, port: httpport, emailcheck: ((obj.parent.parent.mailserver != null) && (domain.auth != 'sspi')), domainauth: (domain.auth == 'sspi') };
            if (obj.args.notls == true) { serverinfo.https = false; } else { serverinfo.https = true; serverinfo.redirport = obj.args.redirport; }

            // Send server information
            try { ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: serverinfo })); } catch (ex) { }

            // Send user information to web socket, this is the first thing we send
            try { ws.send(JSON.stringify({ action: 'userinfo', userinfo: obj.parent.CloneSafeUser(obj.parent.users[user._id]) })); } catch (ex) { }

            // We are all set, start receiving data
            ws._socket.resume();
        });
    } catch (e) { console.log(e); }

    // Process incoming web socket data from the browser
    function processWebSocketData(msg) {
        var command, i = 0, mesh = null, meshid = null, nodeid = null, meshlinks = null, change = 0;
        try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
        if (obj.common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

        switch (command.action) {
            case 'ping': { try { ws.send(JSON.stringify({ action: 'pong' })); } catch (ex) { } break; }
            case 'authcookie':
                {
                    // Renew the authentication cookie
                    try { ws.send(JSON.stringify({ action: 'authcookie', cookie: obj.parent.parent.encodeCookie({ userid: user._id, domainid: domain.id }, obj.parent.loginCookieEncryptionKey) })); } catch (ex) { }
                    break;
                }
            case 'serverstats':
                {
                    if ((user.siteadmin) != 0) {
                        if (obj.common.validateInt(command.interval, 1000, 1000000) == false) {
                            // Clear the timer
                            if (obj.serverStatsTimer != null) { clearInterval(obj.serverStatsTimer); obj.serverStatsTimer = null; }
                        } else {
                            // Set the timer
                            obj.SendServerStats();
                            obj.serverStatsTimer = setInterval(obj.SendServerStats, command.interval);
                        }
                    }
                    break;
                }
            case 'meshes':
                {
                    // Request a list of all meshes this user as rights to
                    var docs = [];
                    for (i in user.links) { if (obj.parent.meshes[i]) { docs.push(obj.parent.meshes[i]); } }
                    try { ws.send(JSON.stringify({ action: 'meshes', meshes: docs, tag: command.tag })); } catch (ex) { }
                    break;
                }
            case 'nodes':
                {
                    var links = [];
                    if (command.meshid == null) {
                        // Request a list of all meshes this user as rights to
                        for (i in user.links) { links.push(i); }
                    } else {
                        // Request list of all nodes for one specific meshid
                        meshid = command.meshid;
                        if (obj.common.validateString(meshid, 0, 128) == false) return;
                        if (meshid.split('/').length == 0) { meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                        if (user.links[meshid] != null) { links.push(meshid); }
                    }

                    // Request a list of all nodes
                    obj.db.GetAllTypeNoTypeFieldMeshFiltered(links, domain.id, 'node', command.id, function (err, docs) {
                        var r = {};
                        for (i in docs) {
                            // Add the connection state
                            var state = obj.parent.parent.GetConnectivityState(docs[i]._id);
                            if (state) {
                                docs[i].conn = state.connectivity;
                                docs[i].pwr = state.powerState;
                                if ((state.connectivity & 1) != 0) { var agent = obj.parent.wsagents[docs[i]._id]; if (agent != null) { docs[i].agct = agent.connectTime; } }
                                if ((state.connectivity & 2) != 0) { var cira = obj.parent.parent.mpsserver.ciraConnections[docs[i]._id]; if (cira != null) { docs[i].cict = cira.tag.connectTime; } }
                            }

                            // Compress the meshid's
                            meshid = docs[i].meshid;
                            if (!r[meshid]) { r[meshid] = []; }
                            delete docs[i].meshid;

                            // Remove Intel AMT credential if present
                            if (docs[i].intelamt != null && docs[i].intelamt.pass != null) { delete docs[i].intelamt.pass; }

                            r[meshid].push(docs[i]);
                        }
                        try { ws.send(JSON.stringify({ action: 'nodes', nodes: r, tag: command.tag })); } catch (ex) { }
                    });
                    break;
                }
            case 'powertimeline':
                {
                    // Query the database for the power timeline for a given node
                    // The result is a compacted array: [ startPowerState, startTimeUTC, powerState ] + many[ deltaTime, powerState ]
                    if (obj.common.validateString(command.nodeid, 0, 128) == false) return;
                    obj.db.getPowerTimeline(command.nodeid, function (err, docs) {
                        if (err == null && docs.length > 0) {
                            var timeline = [], time = null, previousPower;
                            for (i in docs) {
                                var doc = docs[i];
                                if (time == null) {
                                    // First element
                                    time = doc.time;
                                    if (doc.oldPower) { timeline.push(doc.oldPower); } else { timeline.push(0); }
                                    timeline.push(time);
                                    timeline.push(doc.power);
                                    previousPower = doc.power;
                                } else {
                                    // Delta element
                                    if ((previousPower != doc.power) && ((doc.time - time) > 60000)) { // To boost speed, any blocks less than a minute get approximated.
                                        // Create a new timeline
                                        timeline.push(doc.time - time);
                                        timeline.push(doc.power);
                                        time = doc.time;
                                        previousPower = doc.power;
                                    } else {
                                        // Extend the previous timeline
                                        if ((timeline.length >= 6) && (timeline[timeline.length - 3] == doc.power)) { // We can merge the block with the previous block
                                            timeline[timeline.length - 4] += (timeline[timeline.length - 2] + (doc.time - time));
                                            timeline.pop();
                                            timeline.pop();
                                        } else { // Extend the last block in the timeline
                                            timeline[timeline.length - 2] += (doc.time - time);
                                            timeline[timeline.length - 1] = doc.power;
                                        }
                                        time = doc.time;
                                        previousPower = doc.power;
                                    }
                                }
                            }
                            try { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: timeline, tag: command.tag })); } catch (ex) { }
                        } else {
                            // No records found, send current state if we have it
                            var state = obj.parent.parent.GetConnectivityState(command.nodeid);
                            if (state != null) { try { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: [state.powerState, Date.now(), state.powerState], tag: command.tag })); } catch (ex) { } }
                        }
                    });
                    break;
                }
            case 'lastconnect':
                {
                    if (obj.common.validateString(command.nodeid, 0, 128) == false) return;

                    // Query the database for the last time this node connected
                    obj.db.Get('lc' + command.nodeid, function (err, docs) {
                        if ((docs != null) && (docs.length > 0)) { try { ws.send(JSON.stringify({ action: 'lastconnect', nodeid: command.nodeid, time: docs[0].time, addr: docs[0].addr })); } catch (ex) { } }
                    });
                    break;
                }
            case 'files':
                {
                    // Send the full list of server files to the browser app
                    if ((user != null) && (user.siteadmin != null) && (user.siteadmin & 8) != 0) { updateUserFiles(user, ws, domain); }
                    break;
                }
            case 'fileoperation':
                {
                    // Check permissions
                    if ((user.siteadmin & 8) != 0) {
                        // Perform a file operation (Create Folder, Delete Folder, Delete File...)
                        if (obj.common.validateString(command.fileop, 4, 16) == false) return;
                        var sendUpdate = true, path = meshPathToRealPath(command.path, user); // This will also check access rights
                        if (path == null) break;

                        if ((command.fileop == 'createfolder') && (obj.common.IsFilenameValid(command.newfolder) == true)) { try { obj.fs.mkdirSync(path + "/" + command.newfolder); } catch (e) { } } // Create a new folder
                        else if (command.fileop == 'delete') { // Delete
                            if (obj.common.validateArray(command.delfiles, 1) == false) return;
                            for (i in command.delfiles) {
                                if (obj.common.IsFilenameValid(command.delfiles[i]) == true) {
                                    var fullpath = obj.path.join(path, command.delfiles[i]);
                                    if (command.rec == true) {
                                        deleteFolderRecursive(fullpath); // TODO, make this an async function
                                    } else {
                                        try { obj.fs.rmdirSync(fullpath); } catch (e) { try { obj.fs.unlinkSync(fullpath); } catch (e) { } }
                                    }
                                }
                            }
                        }
                        else if ((command.fileop == 'rename') && (obj.common.IsFilenameValid(command.oldname) == true) && (obj.common.IsFilenameValid(command.newname) == true)) { try { obj.fs.renameSync(path + "/" + command.oldname, path + "/" + command.newname); } catch (e) { } } // Rename
                        else if ((command.fileop == 'copy') || (command.fileop == 'move')) {
                            if (obj.common.validateArray(command.names, 1) == false) return;
                            var scpath = meshPathToRealPath(command.scpath, user); // This will also check access rights
                            if (scpath == null) break;
                            // TODO: Check quota if this is a copy!!!!!!!!!!!!!!!!
                            for (i in command.names) {
                                var s = obj.path.join(scpath, command.names[i]), d = obj.path.join(path, command.names[i]);
                                sendUpdate = false;
                                copyFile(s, d, function (op) { if (op != null) { obj.fs.unlink(op, function (err) { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); }); } else { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } }, ((command.fileop == 'move') ? s : null));
                            }
                        }

                        if (sendUpdate == true) { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } // Fire an event causing this user to update this files
                    }
                    break;
                }
            case 'serverconsole':
                {
                    // This is a server console message, only process this if full administrator
                    if (user.siteadmin != 0xFFFFFFFF) break;

                    var r = '';
                    var args = splitArgs(command.value);
                    if (args.length == 0) break;
                    const cmd = args[0].toLowerCase();
                    args = parseArgs(args);

                    switch (cmd) {
                        case 'help': {
                            r = 'Available commands: help, args, resetserver, showconfig, usersessions.';
                            break;
                        }
                        case 'args': {
                            r = cmd + ': ' + JSON.stringify(args);
                            break;
                        }
                        case 'usersessions': {
                            for (var i in obj.parent.wssessions) {
                                r += (i + ', ' + obj.parent.wssessions[i].length + ' session' + ((obj.parent.wssessions[i].length > 1) ? 'a' : '') + '.<br />');
                                for (var j in obj.parent.wssessions[i]) {
                                    var addr = obj.parent.wssessions[i][j]._socket.remoteAddress;
                                    if (addr.startsWith('::ffff:')) { addr = addr.substring(7); }
                                    r += '    ' + addr + ' --> ' + obj.parent.wssessions[i][j].sessionId + '.<br />';
                                }
                            }
                            break;
                        }
                        case 'resetserver': {
                            console.log('Server restart...');
                            process.exit(0);
                            break;
                        }
                        case 'showconfig': {
                            var config = obj.common.Clone(obj.parent.parent.config);
                            if (config.settings) {
                                if (config.settings.configkey) { config.settings.configkey = '(present)'; }
                                if (config.settings.sessionkey) { config.settings.sessionkey = '(present)'; }
                                if (config.settings.dbencryptkey) { config.settings.dbencryptkey = '(present)'; }
                            }
                            r = JSON.stringify(removeAllUnderScore(config), null, 4);
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
                            obj.db.GetEvents(filter, domain.id, function (err, docs) { if (err != null) return; try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { } });
                        } else {
                            // Send the list of most recent events for this session, up to 'limit' count
                            obj.db.GetEventsWithLimit(filter, domain.id, command.limit, function (err, docs) { if (err != null) return; try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { } });
                        }
                    } else if (obj.common.validateString(command.nodeid, 0, 128) == true) { // Device filtered events
                        // TODO: Check that the user has access to this nodeid
                        var limit = 10000;
                        if (obj.common.validateInt(command.limit, 1, 60000) == true) { limit = command.limit; }

                        // Send the list of most recent events for this session, up to 'limit' count
                        obj.db.GetNodeEventsWithLimit(command.nodeid, domain.id, limit, function (err, docs) { if (err != null) return; try { ws.send(JSON.stringify({ action: 'events', events: docs, nodeid: command.nodeid, tag: command.tag })); } catch (ex) { } });
                    } else {
                        // All events
                        var filter = user.subscriptions;
                        if ((command.limit == null) || (typeof command.limit != 'number')) {
                            // Send the list of all events for this session
                            obj.db.GetEvents(filter, domain.id, function (err, docs) { if (err != null) return; try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { } });
                        } else {
                            // Send the list of most recent events for this session, up to 'limit' count
                            obj.db.GetEventsWithLimit(filter, domain.id, command.limit, function (err, docs) { if (err != null) return; try { ws.send(JSON.stringify({ action: 'events', events: docs, user: command.user, tag: command.tag })); } catch (ex) { } });
                        }
                    }
                    break;
                }
            case 'clearevents':
                {
                    // Delete all events
                    if (user.siteadmin != 0xFFFFFFFF) break;
                    obj.db.RemoveAllEvents(domain.id);
                    obj.parent.parent.DispatchEvent(['*', 'server-global'], obj, { action: 'clearevents', nolog: 1, domain: domain.id });
                    break;
                }
            case 'users':
                {
                    // Request a list of all users
                    if ((user.siteadmin & 2) == 0) break;
                    var docs = [];
                    for (i in obj.parent.users) {
                        if ((obj.parent.users[i].domain == domain.id) && (obj.parent.users[i].name != '~')) {
                            docs.push(obj.parent.CloneSafeUser(obj.parent.users[i]));
                        }
                    }
                    try { ws.send(JSON.stringify({ action: 'users', users: docs, tag: command.tag })); } catch (ex) { }
                    break;
                }
            case 'changeemail':
                {
                    // Change the email address
                    if (domain.auth == 'sspi') return;
                    if (obj.common.validateEmail(command.email, 1, 256) == false) return;
                    if (obj.parent.users[req.session.userid].email != command.email) {
                        // Check if this email is already validated on a different account
                        obj.db.GetUserWithVerifiedEmail(domain.id, command.email, function (err, docs) {
                            if (docs.length > 0) {
                                // Notify the duplicate email error
                                try { ws.send(JSON.stringify({ action: 'msg', type: 'notify', value: 'Failed to change email address, another account already using: <b>' + EscapeHtml(command.email) + '</b>.' })); } catch (ex) { }
                            } else {
                                // Update the user's email
                                var oldemail = user.email;
                                user.email = command.email;
                                user.emailVerified = false;
                                obj.parent.db.SetUser(user);

                                // Event the change
                                var message = { etype: 'user', username: user.name, account: obj.parent.CloneSafeUser(user), action: 'accountchange', domain: domain.id };
                                if (oldemail != null) {
                                    message.msg = 'Changed email of user ' + user.name + ' from ' + oldemail + ' to ' + user.email;
                                } else {
                                    message.msg = 'Set email of user ' + user.name + ' to ' + user.email;
                                }
                                obj.parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, message);

                                // Send the verification email
                                if ((obj.parent.parent.mailserver != null) && (domain.auth != 'sspi')) { obj.parent.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email); }
                            }
                        });
                    }
                    break;
                }
            case 'verifyemail':
                {
                    // Send a account email verification email
                    if (domain.auth == 'sspi') return;
                    if (obj.common.validateString(command.email, 3, 1024) == false) return;
                    if ((obj.parent.parent.mailserver != null) && (obj.parent.users[req.session.userid].email == command.email)) {
                        // Send the verification email
                        obj.parent.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email);
                    }
                    break;
                }
            case 'wssessioncount':
                {
                    // Request a list of all web socket user session count
                    var wssessions = {};
                    if ((user.siteadmin & 2) == 0) break;
                    if (obj.parent.parent.multiServer == null) {
                        // No peering, use simple session counting
                        for (i in obj.parent.wssessions) { if (obj.parent.wssessions[i][0].domainid == domain.id) { wssessions[i] = obj.parent.wssessions[i].length; } }
                    } else {
                        // We have peer servers, use more complex session counting
                        for (i in obj.parent.sessionsCount) { if (i.split('/')[1] == domain.id) { wssessions[i] = obj.parent.sessionsCount[i]; } }
                    }
                    try { ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: wssessions, tag: command.tag })); } catch (ex) { } // wssessions is: userid --> count
                    break;
                }
            case 'deleteuser':
                {
                    // Delete a user account
                    if ((user.siteadmin & 2) == 0) break;
                    if (obj.common.validateString(command.userid, 1, 2048) == false) break;
                    var delusersplit = command.userid.split('/'), deluserid = command.userid, deluser = obj.parent.users[deluserid];
                    if ((deluser == null) || (delusersplit.length != 3) || (delusersplit[1] != domain.id)) break; // Invalid domain, operation only valid for current domain
                    if ((deluser.siteadmin != null) && (deluser.siteadmin > 0) && (user.siteadmin != 0xFFFFFFFF)) break; // Need full admin to remote another administrator

                    // Remove all the mesh links to this user
                    if (deluser.links != null) {
                        for (meshid in deluser.links) {
                            // Get the mesh
                            mesh = obj.parent.meshes[meshid];
                            if (mesh) {
                                // Remove user from the mesh
                                if (mesh.links[deluser._id] != null) { delete mesh.links[deluser._id]; obj.parent.db.Set(mesh); }
                                // Notify mesh change
                                change = 'Removed user ' + deluser.name + ' from group ' + mesh.name;
                                obj.parent.parent.DispatchEvent(['*', mesh._id, deluser._id, user._id], obj, { etype: 'mesh', username: user.name, userid: user._id, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id });
                            }
                        }
                    }

                    // Remove notes for this user
                    obj.db.Remove('nt' + deluser._id);

                    // Delete all files on the server for this account
                    try {
                        var deluserpath = obj.parent.getServerRootFilePath(deluser);
                        if (deluserpath != null) { obj.parent.deleteFolderRec(deluserpath); }
                    } catch (e) { }

                    obj.db.Remove(deluserid);
                    delete obj.parent.users[deluserid];
                    obj.parent.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: deluserid, username: deluser.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
                    obj.parent.parent.DispatchEvent([deluserid], obj, 'close');

                    break;
                }
            case 'adduser':
                {
                    // Add a new user account
                    if ((user.siteadmin & 2) == 0) break;
                    if (obj.common.validateUsername(command.username, 1, 64) == false) break; // Username is between 1 and 64 characters, no spaces
                    if (obj.common.validateString(command.pass, 1, 256) == false) break; // Password is between 1 and 256 characters
                    if (obj.common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false) break; // Password does not meet requirements
                    if ((command.email != null) && (obj.common.validateEmail(command.email, 1, 256) == false)) break; // Check if this is a valid email address
                    var newusername = command.username, newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase();
                    if (newusername == '~') break; // This is a reserved user name
                    if (!obj.parent.users[newuserid]) {
                        var newuser = { type: 'user', _id: newuserid, name: newusername, creation: Math.floor(Date.now() / 1000), domain: domain.id };
                        if (command.email != null) { newuser.email = command.email; } // Email
                        obj.parent.users[newuserid] = newuser;
                        // Create a user, generate a salt and hash the password
                        require('./pass').hash(command.pass, function (err, salt, hash) {
                            if (err) throw err;
                            newuser.salt = salt;
                            newuser.hash = hash;
                            obj.db.SetUser(newuser);
                            obj.parent.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: newusername, account: obj.parent.CloneSafeUser(newuser), action: 'accountcreate', msg: 'Account created, email is ' + command.email, domain: domain.id });
                        });
                    }
                    break;
                }
            case 'edituser':
                {
                    // Edit a user account, may involve changing email or administrator permissions
                    if (((user.siteadmin & 2) != 0) || (user.name == command.name)) {
                        var chguserid = 'user/' + domain.id + '/' + command.name.toLowerCase(), chguser = obj.parent.users[chguserid];
                        change = 0;
                        if (chguser) {
                            if (obj.common.validateString(command.email, 1, 256) && (chguser.email != command.email)) { chguser.email = command.email; change = 1; }
                            if ((command.emailVerified === true || command.emailVerified === false) && (chguser.emailVerified != command.emailVerified)) { chguser.emailVerified = command.emailVerified; change = 1; }
                            if ((obj.common.validateInt(command.quota, 0) || command.quota == null) && (command.quota != chguser.quota)) { chguser.quota = command.quota; if (chguser.quota == null) { delete chguser.quota; } change = 1; }
                            if ((user.siteadmin == 0xFFFFFFFF) && obj.common.validateInt(command.siteadmin) && (chguser.siteadmin != command.siteadmin)) { chguser.siteadmin = command.siteadmin; change = 1; }
                            if (change == 1) {
                                obj.db.SetUser(chguser);
                                obj.parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
                                obj.parent.parent.DispatchEvent(['*', 'server-users', user._id, chguser._id], obj, { etype: 'user', username: user.name, account: obj.parent.CloneSafeUser(chguser), action: 'accountchange', msg: 'Account changed: ' + command.name, domain: domain.id });
                            }
                            if ((chguser.siteadmin) && (chguser.siteadmin != 0xFFFFFFFF) && (chguser.siteadmin & 32)) {
                                obj.parent.parent.DispatchEvent([chguser._id], obj, 'close'); // Disconnect all this user's sessions
                            }
                        }
                    }
                    break;
                }
            case 'changeuserpass':
                {
                    // Change a user's password
                    if (user.siteadmin != 0xFFFFFFFF) break;
                    if (obj.common.validateString(command.user, 1, 256) == false) break;
                    if (obj.common.validateString(command.pass, 1, 256) == false) break;
                    if (obj.common.checkPasswordRequirements(command.pass, domain.passwordrequirements) == false) break; // Password does not meet requirements
                    var chguserid = 'user/' + domain.id + '/' + command.user.toLowerCase(), chguser = obj.parent.users[chguserid];
                    if (chguser && chguser.salt) {
                        // Compute the password hash & save it
                        require('./pass').hash(command.pass, chguser.salt, function (err, hash) { if (!err) { chguser.hash = hash; obj.db.SetUser(chguser); } });
                    }
                    break;
                }
            case 'notifyuser':
                {
                    // Send a notification message to a user
                    if ((user.siteadmin & 2) == 0) break;
                    if (obj.common.validateString(command.userid, 1, 2048) == false) break;
                    if (obj.common.validateString(command.msg, 1, 4096) == false) break;

                    // Create the notification message
                    var notification = { "action": "msg", "type": "notify", "value": "<b>" + user.name + "</b>: " + EscapeHtml(command.msg), "userid": user._id, "username": user.name };

                    // Get the list of sessions for this user
                    var sessions = obj.parent.wssessions[command.userid];
                    if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                    if (obj.parent.parent.multiServer != null) {
                        // TODO: Add multi-server support
                    }
                    break;
                }
            case 'meshmessenger':
                {
                    // Send a notification message to a user
                    if ((user.siteadmin & 2) == 0) break;

                    // Setup a user-to-user session
                    if (obj.common.validateString(command.userid, 1, 2048)) {

                        // Create the notification message
                        var notification = {
                            "action": "msg", "type": "notify", "value": "<b>" + user.name + "</b>: Chat Request, Click here to accept.", "userid": user._id, "username": user.name, "tag": 'meshmessenger/' + encodeURIComponent(command.userid) + '/' + encodeURIComponent(user._id)
                        };

                        // Get the list of sessions for this user
                        var sessions = obj.parent.wssessions[command.userid];
                        if (sessions != null) { for (i in sessions) { try { sessions[i].send(JSON.stringify(notification)); } catch (ex) { } } }

                        if (obj.parent.parent.multiServer != null) {
                            // TODO: Add multi-server support
                        }
                    }

                    // Setup a user-to-node session
                    if (obj.common.validateString(command.nodeid, 1, 2048)) {
                        if (obj.args.lanonly == true) { return; } // User-to-device chat is not support in LAN-only mode yet. We need the agent to replace the IP address of the server??

                        // Create the server url
                        var httpsPort = ((obj.parent.args.aliasport == null) ? obj.parent.args.port : obj.parent.args.aliasport); // Use HTTPS alias port is specified
                        var xdomain = (domain.dns == null) ? domain.id : '';
                        if (xdomain != '') xdomain += "/";
                        var url = "http" + (obj.args.notls ? '' : 's') + "://" + obj.parent.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "messenger?id=meshmessenger/" + encodeURIComponent(command.nodeid) + "/" + encodeURIComponent(user._id) + "&title=" + encodeURIComponent(user.name);

                        // Create the notification message
                        routeCommandToNode({ "action": "openUrl", "nodeid": command.nodeid, "userid": user._id, "username": user.name, "url": url });
                    }

                    break;
                }
            case 'serverversion':
                {
                    // Check the server version
                    if ((user.siteadmin & 16) == 0) break;
                    obj.parent.parent.getLatestServerVersion(function (currentVersion, latestVersion) { try { ws.send(JSON.stringify({ action: 'serverversion', current: currentVersion, latest: latestVersion })); } catch (ex) { } });
                    break;
                }
            case 'serverupdate':
                {
                    // Perform server update
                    if ((user.siteadmin & 16) == 0) break;
                    obj.parent.parent.performServerUpdate();
                    break;
                }
            case 'servererrors':
                {
                    // Load the server error log
                    if ((user.siteadmin & 16) == 0) break;
                    obj.parent.parent.fs.readFile(obj.parent.parent.getConfigFilePath('mesherrors.txt'), 'utf8', function (err, data) { try { ws.send(JSON.stringify({ action: 'servererrors', data: data })); } catch (ex) { } });
                    break;
                }
            case 'serverclearerrorlog':
                {
                    // Clear the server error log
                    if ((user.siteadmin & 16) == 0) break;
                    obj.parent.parent.fs.unlink(obj.parent.parent.getConfigFilePath('mesherrors.txt'), function (err) { });
                    break;
                }
            case 'createmesh':
                {
                    // In some situations, we need a verified email address to create a device group.
                    if ((obj.parent.parent.mailserver != null) && (domain.auth != 'sspi') && (user.emailVerified !== true) && (user.siteadmin != 0xFFFFFFFF)) return; // User must verify it's email first.

                    // Create mesh
                    if (obj.common.validateString(command.meshname, 1, 64) == false) break; // Meshname is between 1 and 64 characters
                    if (obj.common.validateString(command.desc, 0, 1024) == false) break; // Mesh description is between 0 and 1024 characters

                    // We only create Agent-less Intel AMT mesh (Type1), or Agent mesh (Type2)
                    if ((command.meshtype == 1) || (command.meshtype == 2)) {
                        // Create a type 1 agent-less Intel AMT mesh.
                        obj.parent.crypto.randomBytes(48, function (err, buf) {
                            meshid = 'mesh/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            var links = {};
                            links[user._id] = { name: user.name, rights: 0xFFFFFFFF };
                            mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links };
                            obj.db.Set(obj.common.escapeLinksFieldName(mesh));
                            obj.parent.meshes[meshid] = mesh;
                            obj.parent.parent.AddEventDispatch([meshid], ws);
                            if (user.links == null) user.links = {};
                            user.links[meshid] = { rights: 0xFFFFFFFF };
                            user.subscriptions = obj.parent.subscribe(user._id, ws);
                            obj.db.SetUser(user);
                            obj.parent.parent.DispatchEvent(['*', meshid, user._id], obj, { etype: 'mesh', username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msg: 'Mesh created: ' + command.meshname, domain: domain.id });
                        });
                    }
                    break;
                }
            case 'deletemesh':
                {
                    // Delete a mesh and all computers within it
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    obj.db.Get(command.meshid, function (err, meshes) {
                        if (meshes.length != 1) return;
                        mesh = obj.common.unEscapeLinksFieldName(meshes[0]);

                        // Check if this user has rights to do this
                        if (mesh.links[user._id] == null || mesh.links[user._id].rights != 0xFFFFFFFF) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // Fire the removal event first, because after this, the event will not route
                        obj.parent.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'mesh', username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msg: 'Mesh deleted: ' + command.meshname, domain: domain.id });

                        // Remove all user links to this mesh
                        for (i in meshes) {
                            var links = meshes[i].links;
                            for (var j in links) {
                                var xuser = obj.parent.users[j];
                                delete xuser.links[meshes[i]._id];
                                obj.db.SetUser(xuser);
                                obj.parent.parent.DispatchEvent([xuser._id], obj, 'resubscribe');
                            }
                        }

                        // Delete all files on the server for this mesh
                        try {
                            var meshpath = obj.parent.getServerRootFilePath(mesh);
                            if (meshpath != null) { obj.parent.deleteFolderRec(meshpath); }
                        } catch (e) { }

                        obj.parent.parent.RemoveEventDispatchId(command.meshid); // Remove all subscriptions to this mesh
                        obj.db.RemoveMesh(command.meshid); // Remove mesh from database
                        delete obj.parent.meshes[command.meshid]; // Remove mesh from memory
                    });
                    break;
                }
            case 'editmesh':
                {
                    // Change the name or description of a mesh
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    mesh = obj.parent.meshes[command.meshid];
                    change = '';
                    if (mesh) {
                        // Check if this user has rights to do this
                        if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 1) == 0)) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        if ((obj.common.validateString(command.meshname, 1, 64) == true) && (command.meshname != mesh.name)) { change = 'Group name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }
                        if ((obj.common.validateString(command.desc, 0, 1024) == true) && (command.desc != mesh.desc)) { if (change != '') change += ' and description changed'; else change += 'Group "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
                        if ((obj.common.validateInt(command.flags) == true) && (command.flags != mesh.flags)) { if (change != '') change += ' and flags changed'; else change += 'Group "' + mesh.name + '" flags changed'; mesh.flags = command.flags; }
                        if (change != '') { obj.db.Set(obj.common.escapeLinksFieldName(mesh)); obj.parent.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'mesh', username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, flags: mesh.flags, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id }); }
                    }
                    break;
                }
            case 'addmeshuser':
                {
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    if (obj.common.validateString(command.username, 1, 64) == false) break; // Username is between 1 and 64 characters
                    if (obj.common.validateInt(command.meshadmin) == false) break; // Mesh rights must be an integer

                    // Check if the user exists
                    var newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase(), newuser = obj.parent.users[newuserid];
                    if (newuser == null) {
                        // TODO: Send error back, user not found.
                        break;
                    }

                    // Get the mesh
                    mesh = obj.parent.meshes[command.meshid];
                    if (mesh) {
                        // Check if this user has rights to do this
                        if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 2) == 0)) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // Add mesh to user
                        if (newuser.links == null) newuser.links = {};
                        newuser.links[command.meshid] = { rights: command.meshadmin };
                        obj.db.SetUser(newuser);
                        obj.parent.parent.DispatchEvent([newuser._id], obj, 'resubscribe');

                        // Add a user to the mesh
                        mesh.links[newuserid] = { name: newuser.name, rights: command.meshadmin };
                        obj.db.Set(obj.common.escapeLinksFieldName(mesh));

                        // Notify mesh change
                        obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, newuserid], obj, { etype: 'mesh', username: newuser.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Added user ' + newuser.name + ' to mesh ' + mesh.name, domain: domain.id });
                    }
                    break;
                }
            case 'removemeshuser':
                {
                    if (obj.common.validateString(command.userid, 1, 1024) == false) break; // Check userid
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check meshid
                    if ((command.userid.split('/').length != 3) || (command.userid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the mesh
                    mesh = obj.parent.meshes[command.meshid];
                    if (mesh) {
                        // Check if this user has rights to do this
                        if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 2) == 0)) return;

                        // Check if the user exists - Just in case we need to delete a mesh right for a non-existant user, we do it this way. Technically, it's not possible, but just in case.
                        var deluserid = command.userid, deluser = obj.parent.users[deluserid];
                        if (deluser != null) {
                            // Remove mesh from user
                            if (deluser.links != null && deluser.links[command.meshid] != null) {
                                var delmeshrights = deluser.links[command.meshid].rights;
                                if ((delmeshrights == 0xFFFFFFFF) && (mesh.links[deluserid].rights != 0xFFFFFFFF)) return; // A non-admin can't kick out an admin
                                delete deluser.links[command.meshid];
                                obj.db.Set(deluser);
                                obj.parent.parent.DispatchEvent([deluser._id], obj, 'resubscribe');
                            }
                        }

                        // Remove user from the mesh
                        if (mesh.links[command.userid] != null) {
                            delete mesh.links[command.userid];
                            obj.db.Set(obj.common.escapeLinksFieldName(mesh));

                            // Notify mesh change
                            if (deluser != null) {
                                obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, command.userid], obj, { etype: 'mesh', username: user.name, userid: deluser.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + deluser.name + ' from group ' + mesh.name, domain: domain.id });
                            } else {
                                obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, command.userid], obj, { etype: 'mesh', username: user.name, userid: (deluserid.split('/')[2]), meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + (deluserid.split('/')[2]) + ' from group ' + mesh.name, domain: domain.id });
                            }
                        }
                    }
                    break;
                }
            case 'meshamtpolicy':
                {
                    // Change a mesh Intel AMT policy
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check the meshid
                    if (obj.common.validateObject(command.amtpolicy) == false) break; // Check the amtpolicy
                    if (obj.common.validateInt(command.amtpolicy.type, 0, 2) == false) break; // Check the amtpolicy.type
                    if (command.amtpolicy.type === 2) {
                        if (obj.common.validateString(command.amtpolicy.password, 0, 32) == false) break; // Check the amtpolicy.password
                        if (obj.common.validateInt(command.amtpolicy.badpass, 0, 1) == false) break; // Check the amtpolicy.badpass
                        if (obj.common.validateInt(command.amtpolicy.cirasetup, 0, 2) == false) break; // Check the amtpolicy.cirasetup
                    }
                    mesh = obj.parent.meshes[command.meshid];
                    change = '';
                    if (mesh) {
                        // Check if this user has rights to do this
                        if ((mesh.links[user._id] == null) || (mesh.links[user._id].rights != 0xFFFFFFFF)) return;
                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // TODO: Check if this is a change from the existing policy

                        // Perform the Intel AMT policy change
                        change = 'Intel AMT policy change';
                        var amtpolicy = { type: command.amtpolicy.type };
                        if (command.amtpolicy.type === 2) { amtpolicy = { type: command.amtpolicy.type, password: command.amtpolicy.password, badpass: command.amtpolicy.badpass, cirasetup: command.amtpolicy.cirasetup }; }
                        mesh.amt = amtpolicy;
                        obj.db.Set(obj.common.escapeLinksFieldName(mesh));
                        obj.parent.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'mesh', username: user.name, meshid: mesh._id, amt: amtpolicy, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id });

                        // Send new policy to all computers on this mesh
                        routeCommandToMesh(command.meshid, { action: 'amtPolicy', amtPolicy: amtpolicy });
                    }
                    break;
                }
            case 'addamtdevice':
                {
                    if (obj.args.wanonly == true) return; // This is a WAN-only server, local Intel AMT computers can't be added
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check meshid
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    if (obj.common.validateString(command.devicename, 1, 256) == false) break; // Check device name
                    if (obj.common.validateString(command.hostname, 1, 256) == false) break; // Check hostname
                    if (obj.common.validateString(command.amtusername, 0, 16) == false) break; // Check username
                    if (obj.common.validateString(command.amtpassword, 0, 16) == false) break; // Check password
                    if (command.amttls == '0') { command.amttls = 0; } else if (command.amttls == '1') { command.amttls = 1; } // Check TLS flag
                    if ((command.amttls != 1) && (command.amttls != 0)) break;

                    // If we are in WAN-only mode, hostname is not used
                    if ((obj.parent.parent.args.wanonly == true) && (command.hostname)) { delete command.hostname; }

                    // Get the mesh
                    mesh = obj.parent.meshes[command.meshid];
                    if (mesh) {
                        if (mesh.mtype != 1) return; // This operation is only allowed for mesh type 1, Intel AMT agentless mesh.

                        // Check if this user has rights to do this
                        if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                        // Create a new nodeid
                        obj.parent.crypto.randomBytes(48, function (err, buf) {
                            // create the new node
                            nodeid = 'node/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            var device = { type: 'node', mtype: 1, _id: nodeid, meshid: command.meshid, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: command.amttls } };
                            obj.db.Set(device);

                            // Event the new node
                            var device2 = obj.common.Clone(device);
                            delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                            obj.parent.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'node', username: user.name, action: 'addnode', node: device2, msg: 'Added device ' + command.devicename + ' to mesh ' + mesh.name, domain: domain.id });
                        });
                    }
                    break;
                }
            case 'scanamtdevice':
                {
                    if (obj.args.wanonly == true) return; // This is a WAN-only server, this type of scanning is not allowed.
                    if (obj.common.validateString(command.range, 1, 256) == false) break; // Check range string

                    // Ask the RMCP scanning to scan a range of IP addresses
                    if (obj.parent.parent.amtScanner) {
                        if (obj.parent.parent.amtScanner.performRangeScan(ws.userid, command.range) == false) {
                            obj.parent.parent.DispatchEvent(['*', ws.userid], obj, { action: 'scanamtdevice', range: command.range, results: null, nolog: 1 });
                        }
                    }
                    break;
                }
            case 'removedevices':
                {
                    if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's

                    for (i in command.nodeids) {
                        nodeid = command.nodeids[i];
                        if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                        if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // Get the device
                        obj.db.Get(nodeid, function (err, nodes) {
                            if (nodes.length != 1) return;
                            var node = nodes[0];

                            // Get the mesh for this device
                            mesh = obj.parent.meshes[node.meshid];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                                // Delete this node including network interface information, events and timeline
                                obj.db.Remove(node._id); // Remove node with that id
                                obj.db.Remove('if' + node._id); // Remove interface information
                                obj.db.Remove('nt' + node._id); // Remove notes
                                obj.db.Remove('lc' + node._id); // Remove last connect time
                                obj.db.Remove('sm' + node._id); // Remove SMBios data
                                obj.db.RemoveNode(node._id); // Remove all entries with node:id

                                // Event node deletion
                                obj.parent.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', username: user.name, action: 'removenode', nodeid: node._id, msg: 'Removed device ' + node.name + ' from group ' + mesh.name, domain: domain.id });

                                // Disconnect all connections if needed
                                var state = obj.parent.parent.GetConnectivityState(nodeid);
                                if ((state != null) && (state.connectivity != null)) {
                                    if ((state.connectivity & 1) != 0) { obj.parent.wsagents[nodeid].close(); } // Disconnect mesh agent
                                    if ((state.connectivity & 2) != 0) { obj.parent.parent.mpsserver.close(obj.parent.parent.mpsserver.ciraConnections[nodeid]); } // Disconnect CIRA connection
                                }
                            }
                        });
                    }

                    break;
                }
            case 'wakedevices':
                {
                    if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    // TODO: We can optimize this a lot.
                    // - We should get a full list of all MAC's to wake first.
                    // - We should try to only have one agent per subnet (using Gateway MAC) send a wake-on-lan.
                    for (i in command.nodeids) {
                        nodeid = command.nodeids[i];
                        var wakeActions = 0;
                        if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                        if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                            // Get the device
                            obj.db.Get(nodeid, function (err, nodes) {
                                if (nodes.length != 1) return;
                                var node = nodes[0];

                                // Get the mesh for this device
                                mesh = obj.parent.meshes[node.meshid];
                                if (mesh) {

                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] != null && ((mesh.links[user._id].rights & 64) != 0)) {

                                        // Get the device interface information
                                        obj.db.Get('if' + node._id, function (err, nodeifs) {
                                            if (nodeifs.length == 1) {
                                                var nodeif = nodeifs[0];
                                                var macs = [];
                                                for (var i in nodeif.netif) { if (nodeif.netif[i].mac) { macs.push(nodeif.netif[i].mac); } }

                                                // Have the server send a wake-on-lan packet (Will not work in WAN-only)
                                                if (obj.parent.parent.meshScanner != null) { obj.parent.parent.meshScanner.wakeOnLan(macs); wakeActions++; }

                                                // Get the list of mesh this user as access to
                                                var targetMeshes = [];
                                                for (i in user.links) { targetMeshes.push(i); }

                                                // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                                for (i in obj.parent.wsagents) {
                                                    var agent = obj.parent.wsagents[i];
                                                    if ((targetMeshes.indexOf(agent.dbMeshKey) >= 0) && (agent.authenticated == 2)) {
                                                        //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                                        try { agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs })); } catch (ex) { }
                                                        wakeActions++;
                                                    }
                                                }
                                            }
                                        });

                                    }
                                }
                            });
                        }
                        // Confirm we may be doing something (TODO)
                        try { ws.send(JSON.stringify({ action: 'wakedevices' })); } catch (ex) { }
                    }

                    break;
                }
            case 'poweraction':
                {
                    if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    for (i in command.nodeids) {
                        nodeid = command.nodeids[i];
                        var powerActions = 0;
                        if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                        if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                            // Get the device
                            obj.db.Get(nodeid, function (err, nodes) {
                                if (nodes.length != 1) return;
                                var node = nodes[0];

                                // Get the mesh for this device
                                mesh = obj.parent.meshes[node.meshid];
                                if (mesh) {

                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] != null && ((mesh.links[user._id].rights & 8) != 0)) { // "Remote Control permission"

                                        // Get this device
                                        var agent = obj.parent.wsagents[node._id];
                                        if (agent != null) {
                                            // Send the power command
                                            try { agent.send(JSON.stringify({ action: 'poweraction', actiontype: command.actiontype })); } catch (ex) { }
                                            powerActions++;
                                        }
                                    }
                                }
                            });
                        }
                        // Confirm we may be doing something (TODO)
                        try { ws.send(JSON.stringify({ action: 'poweraction' })); } catch (ex) { }
                    }
                    break;
                }
            case 'toast':
                {
                    if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                    if (obj.common.validateString(command.title, 1, 512) == false) break; // Check title
                    if (obj.common.validateString(command.msg, 1, 4096) == false) break; // Check message
                    for (i in command.nodeids) {
                        nodeid = command.nodeids[i];
                        var powerActions = 0;
                        if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                        if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                            // Get the device
                            obj.db.Get(nodeid, function (err, nodes) {
                                if (nodes.length != 1) return;
                                var node = nodes[0];

                                // Get the mesh for this device
                                mesh = obj.parent.meshes[node.meshid];
                                if (mesh) {

                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] != null && ((mesh.links[user._id].rights & 8) != 0)) { // "Remote Control permission"

                                        // Get this device
                                        var agent = obj.parent.wsagents[node._id];
                                        if (agent != null) {
                                            // Send the power command
                                            try { agent.send(JSON.stringify({ action: 'toast', title: command.title, msg: command.msg })); } catch (ex) { }
                                        }
                                    }
                                }
                            });
                        }
                    }
                    break;
                }
            case 'getnetworkinfo':
                {
                    // Argument validation
                    if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the device
                    obj.db.Get(command.nodeid, function (err, nodes) {
                        if (nodes.length != 1) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); } catch (ex) { } return; }
                        var node = nodes[0];

                        // Get the mesh for this device
                        mesh = obj.parent.meshes[node.meshid];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); } catch (ex) { } return; }

                            // Get network information about this node
                            obj.db.Get('if' + command.nodeid, function (err, netinfos) {
                                if (netinfos.length != 1) { try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); } catch (ex) { } return; }
                                var netinfo = netinfos[0];
                                try { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, updateTime: netinfo.updateTime, netif: netinfo.netif })); } catch (ex) { }
                            });
                        }
                    });
                    break;
                }
            case 'changedevice':
                {
                    // Argument validation
                    if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if ((command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    if ((command.userloc) && (command.userloc.length != 2) && (command.userloc.length != 0)) return;

                    // Change the device
                    obj.db.Get(command.nodeid, function (err, nodes) {
                        if (nodes.length != 1) return;
                        var node = nodes[0];

                        // Get the mesh for this device
                        mesh = obj.parent.meshes[node.meshid];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                            // Ready the node change event
                            var changes = [], event = { etype: 'node', username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id };
                            change = 0;
                            event.msg = ": ";

                            // If we are in WAN-only mode, host is not used
                            if ((obj.parent.parent.args.wanonly == true) && (command.host)) { delete command.host; }

                            // Look for a change
                            if (command.icon && (command.icon != node.icon)) { change = 1; node.icon = command.icon; changes.push('icon'); }
                            if (command.name && (command.name != node.name)) { change = 1; node.name = command.name; changes.push('name'); }
                            if (command.host && (command.host != node.host)) { change = 1; node.host = command.host; changes.push('host'); }
                            if (command.userloc && ((node.userloc == null) || (command.userloc[0] != node.userloc[0]) || (command.userloc[1] != node.userloc[1]))) {
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
                                if (command.intelamt.tls && (command.intelamt.tls != node.intelamt.tls)) { change = 1; node.intelamt.tls = command.intelamt.tls; changes.push('Intel AMT TLS'); }
                            }
                            if (command.tags) { // Node grouping tag, this is a array of strings that can't be empty and can't contain a comma
                                var ok = true;
                                if (obj.common.validateString(command.tags, 0, 4096) == true) { command.tags = command.tags.split(','); }
                                if (obj.common.validateStrArray(command.tags, 1, 256) == true) { var groupTags = command.tags; for (var i in groupTags) { groupTags[i] = groupTags[i].trim(); if ((groupTags[i] == '') || (groupTags[i].indexOf(',') >= 0)) { ok = false; } } }
                                if (ok == true) { groupTags.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); }); node.tags = groupTags; change = 1; }
                            } else if ((command.tags === '') && node.tags) { delete node.tags; change = 1; }

                            if (change == 1) {
                                // Save the node
                                obj.db.Set(node);

                                // Event the node change
                                event.msg = 'Changed device ' + node.name + ' from group ' + mesh.name + ': ' + changes.join(', ');
                                var node2 = obj.common.Clone(node);
                                if (node2.intelamt && node2.intelamt.pass) delete node2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                event.node = node2;
                                obj.parent.parent.DispatchEvent(['*', node.meshid], obj, event);
                            }
                        }
                    });
                    break;
                }
            case 'uploadagentcore':
                {
                    if (user.siteadmin != 0xFFFFFFFF) break;
                    if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if (obj.common.validateString(command.type, 1, 40) == false) break; // Check path
                    if (command.type == 'default') {
                        // Send the default core to the agent
                        obj.parent.parent.updateMeshCore(function () { obj.parent.sendMeshAgentCore(user, domain, command.nodeid, 'default'); });
                    } else if (command.type == 'clear') {
                        // Clear the mesh agent core on the mesh agent
                        obj.parent.sendMeshAgentCore(user, domain, command.nodeid, 'clear');
                    } else if (command.type == 'recovery') {
                        // Send the recovery core to the agent
                        obj.parent.sendMeshAgentCore(user, domain, command.nodeid, 'recovery');
                    } else if ((command.type == 'custom') && (obj.common.validateString(command.path, 1, 2048) == true)) {
                        // Send a mesh agent core to the mesh agent
                        var file = obj.parent.getServerFilePath(user, domain, command.path);
                        if (file != null) {
                            obj.parent.parent.fs.readFile(file.fullpath, 'utf8', function (err, data) {
                                if (err != null) {
                                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                                    obj.parent.sendMeshAgentCore(user, domain, command.nodeid, 'custom', data);
                                }
                            });
                        }
                    }
                    break;
                }
            case 'agentdisconnect':
                {
                    // Force mesh agent disconnection
                    if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    if (obj.common.validateInt(command.disconnectMode) == false) break; // Check disconnect mode
                    obj.parent.forceMeshAgentDisconnect(user, domain, command.nodeid, command.disconnectMode);
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
                    if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                    obj.db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                        if (nodes.length == 1) {
                            meshlinks = user.links[nodes[0].meshid];
                            if ((meshlinks) && (meshlinks.rights) && (meshlinks.rights & obj.parent.MESHRIGHT_REMOTECONTROL != 0)) {
                                // Add a user authentication cookie to a url
                                var cookieContent = { userid: user._id, domainid: user.domain };
                                if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
                                if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want to agent to TCP connect to a remote address
                                if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want to agent to TCP connect to a remote port
                                command.cookie = obj.parent.parent.encodeCookie(cookieContent);
                                try { ws.send(JSON.stringify(command)); } catch (ex) { }
                            }
                        }
                    });
                    break;
                }
            case 'inviteAgent':
                {
                    if ((obj.parent.parent.mailserver == null) || (obj.args.lanonly == true)) return; // This operation requires the email server
                    if ((obj.parent.parent.certificates.CommonName == null) || (obj.parent.parent.certificates.CommonName == 'un-configured')) return; // Server name must be configured
                    if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check meshid
                    if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                    // Get the mesh
                    mesh = obj.parent.meshes[command.meshid];
                    if (mesh) {
                        if (mesh.mtype != 2) return; // This operation is only allowed for mesh type 2, agent mesh

                        // Check if this user has rights to do this
                        //if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                        // Perform email invitation
                        obj.parent.parent.mailserver.sendAgentInviteMail(domain, user.name, command.email, command.meshid, command.name, command.os, command.msg, command.flags);
                    }
                    break;
                }
            case 'setNotes':
                {
                    // Argument validation
                    if (obj.common.validateString(command.id, 1, 1024) == false) break; // Check id
                    var splitid = command.id.split('/');
                    if ((splitid.length != 3) || (splitid[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    var idtype = splitid[0];
                    if ((idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

                    if (idtype == 'node') {
                        // Check if this user has rights on this id to set notes
                        obj.db.Get(command.id, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                            if (nodes.length == 1) {
                                meshlinks = user.links[nodes[0].meshid];
                                if ((meshlinks) && (meshlinks.rights) && (meshlinks.rights & obj.parent.MESHRIGHT_SETNOTES != 0)) {
                                    // Set the id's notes
                                    if (obj.common.validateString(command.notes, 1) == false) {
                                        obj.db.Remove('nt' + command.id); // Delete the note for this node
                                    } else {
                                        obj.db.Set({ _id: 'nt' + command.id, type: 'note', value: command.notes }); // Set the note for this node
                                    }
                                }
                            }
                        });
                    } else if (idtype == 'mesh') {
                        // Get the mesh for this device
                        mesh = obj.parent.meshes[command.id];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if ((mesh.links[user._id] == null) || ((mesh.links[user._id].rights & 1) == 0)) { return; } // Must have rights to edit the mesh

                            // Set the id's notes
                            if (obj.common.validateString(command.notes, 1) == false) {
                                obj.db.Remove('nt' + command.id); // Delete the note for this node
                            } else {
                                obj.db.Set({ _id: 'nt' + command.id, type: 'note', value: command.notes }); // Set the note for this mesh
                            }
                        }
                    } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                        // Set the id's notes
                        if (obj.common.validateString(command.notes, 1) == false) {
                            obj.db.Remove('nt' + command.id); // Delete the note for this node
                        } else {
                            obj.db.Set({ _id: 'nt' + command.id, type: 'note', value: command.notes }); // Set the note for this user
                        }
                    }

                    break;
                }
            case 'otpauth-request':
                {
                    // Check is 2-step login is supported
                    const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.parent.certificates.CommonName != 'un-configured') && (obj.args.lanonly !== true) && (obj.args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Request a one time password to be setup
                        const otplib = require('otplib');
                        const secret = otplib.authenticator.generateSecret(); // TODO: Check the random source of this value.
                        ws.send(JSON.stringify({ action: 'otpauth-request', secret: secret, url: otplib.authenticator.keyuri(user.name, obj.parent.certificates.CommonName, secret) }));
                    }
                    break;
                }
            case 'otpauth-setup':
                {
                    // Check is 2-step login is supported
                    const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.parent.certificates.CommonName != 'un-configured') && (obj.args.lanonly !== true) && (obj.args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Perform the one time password setup
                        const otplib = require('otplib');
                        otplib.authenticator.options = { window: 6 }; // Set +/- 3 minute window
                        if (otplib.authenticator.check(command.token, command.secret) === true) {
                            // Token is valid, activate 2-step login on this account.
                            user.otpsecret = command.secret;
                            obj.parent.db.SetUser(user);
                            ws.send(JSON.stringify({ action: 'otpauth-setup', success: true })); // Report success

                            // Notify change
                            try { ws.send(JSON.stringify({ action: 'userinfo', userinfo: obj.parent.CloneSafeUser(user) })); } catch (ex) { }
                        } else {
                            ws.send(JSON.stringify({ action: 'otpauth-setup', success: false })); // Report fail
                        }
                    }
                    break;
                }
            case 'otpauth-clear':
                {
                    // Check is 2-step login is supported
                    const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.parent.certificates.CommonName != 'un-configured') && (obj.args.lanonly !== true) && (obj.args.nousers !== true));
                    if (twoStepLoginSupported) {
                        // Clear the one time password secret
                        if (user.otpsecret) {
                            delete user.otpsecret;
                            obj.parent.db.SetUser(user);

                            // Notify change
                            try { ws.send(JSON.stringify({ action: 'userinfo', userinfo: obj.parent.CloneSafeUser(user) })); } catch (ex) { }
                            ws.send(JSON.stringify({ action: 'otpauth-clear', success: true })); // Report success
                        } else {
                            ws.send(JSON.stringify({ action: 'otpauth-clear', success: false })); // Report fail
                        }
                    }
                    break;
                }
            case 'otpauth-getpasswords':
                {
                    // Check is 2-step login is supported
                    const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.parent.certificates.CommonName != 'un-configured') && (obj.args.lanonly !== true) && (obj.args.nousers !== true));

                    // Perform a sub-action
                    var actionTaken = false;
                    if (command.subaction == 1) { // Generate a new set of tokens
                        var randomNumbers = [], v;
                        for (var i = 0; i < 10; i++) { do { v = getRandomEightDigitInteger(); } while (randomNumbers.indexOf(v) >= 0); randomNumbers.push(v); }
                        user.otpkeys = { keys: [] };
                        for (var i = 0; i < 10; i++) { user.otpkeys.keys[i] = { p: randomNumbers[i], u: true } }
                        actionTaken = true;
                    } else if (command.subaction == 2) { // Clear all tokens
                        actionTaken = (user.otpkeys != null);
                        user.otpkeys = null;
                    }

                    // Save the changed user
                    if (actionTaken) { obj.parent.db.SetUser(user); }

                    // Return one time passwords for this user
                    if (twoStepLoginSupported && user.otpsecret) { ws.send(JSON.stringify({ action: 'otpauth-getpasswords', passwords: user.otpkeys?user.otpkeys.keys:null })); }
                    break;
                }
            case 'getNotes':
                {
                    // Argument validation
                    if (obj.common.validateString(command.id, 1, 1024) == false) break; // Check id
                    var splitid = command.id.split('/');
                    if ((splitid.length != 3) || (splitid[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                    var idtype = splitid[0];
                    if ((idtype != 'user') && (idtype != 'mesh') && (idtype != 'node')) return;

                    if (idtype == 'node') {
                        // Get the device
                        obj.db.Get(command.id, function (err, nodes) {
                            if (nodes.length != 1) return;
                            var node = nodes[0];

                            // Get the mesh for this device
                            mesh = obj.parent.meshes[node.meshid];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { return; }

                                // Get the notes about this node
                                obj.db.Get('nt' + command.id, function (err, notes) {
                                    try {
                                        if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                        ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                    } catch (ex) { }
                                });
                            }
                        });
                    } else if (idtype == 'mesh') {
                        // Get the mesh for this device
                        mesh = obj.parent.meshes[command.id];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 1) == 0)) { return; } // Must have rights to edit the mesh

                            // Get the notes about this node
                            obj.db.Get('nt' + command.id, function (err, notes) {
                                try {
                                    if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                    ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                } catch (ex) { }
                            });
                        }
                    } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                        // Get the notes about this node
                        obj.db.Get('nt' + command.id, function (err, notes) {
                            try {
                                if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                            } catch (ex) { }
                        });
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

    // Read the folder and all sub-folders and serialize that into json.
    function readFilesRec(path) {
        var r = {}, dir = obj.fs.readdirSync(path);
        for (var i in dir) {
            var f = { t: 3, d: 111 };
            var stat = obj.fs.statSync(path + '/' + dir[i]);
            if ((stat.mode & 0x004000) == 0) { f.s = stat.size; f.d = stat.mtime.getTime(); } else { f.t = 2; f.f = readFilesRec(path + '/' + dir[i]); }
            r[dir[i]] = f;
        }
        return r;
    }

    // Delete a directory with a files and directories within it
    // TODO, make this an async function
    function deleteFolderRecursive(path) {
        if (obj.fs.existsSync(path)) {
            obj.fs.readdirSync(path).forEach(function (file, index) {
                var curPath = obj.path.join(path, file);;
                if (obj.fs.lstatSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath);
                } else { // delete file
                    obj.fs.unlinkSync(curPath);
                }
            });
            obj.fs.rmdirSync(path);
        }
    };

    function updateUserFiles(user, ws, domain) {
        // Request the list of server files
        var files = { action: 'files', filetree: { n: 'Root', f: {} } };

        // Add user files
        files.filetree.f[user._id] = { t: 1, n: 'My Files', f: {} };
        files.filetree.f[user._id].maxbytes = obj.parent.getQuota(user._id, domain);
        var usersplit = user._id.split('/'), domainx = 'domain';
        if (usersplit[1].length > 0) domainx = 'domain-' + usersplit[1];

        // Read all files recursively
        try {
            files.filetree.f[user._id].f = readFilesRec(obj.path.join(obj.parent.filespath, domainx + "/user-" + usersplit[2]));
        } catch (e) {
            // Got an error, try to create all the folders and try again...
            try { obj.fs.mkdirSync(obj.parent.filespath); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.parent.filespath, domainx)); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.parent.filespath, domainx + "/user-" + usersplit[2])); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.parent.filespath, domainx + "/user-" + usersplit[2] + "/Public")); } catch (e) { }
            try { files.filetree.f[user._id].f = readFilesRec(obj.parent.path.join(obj.parent.filespath, domainx + "/user-" + usersplit[2])); } catch (e) { }
        }

        // Add files for each mesh
        for (var i in user.links) {
            if ((user.links[i].rights & 32) != 0) { // Check that we have file permissions
                var mesh = obj.parent.meshes[i];
                if (mesh) {
                    var meshsplit = mesh._id.split('/');
                    files.filetree.f[mesh._id] = { t: 4, n: mesh.name, f: {} };
                    files.filetree.f[mesh._id].maxbytes = obj.parent.getQuota(mesh._id, domain);

                    // Read all files recursively
                    try {
                        files.filetree.f[mesh._id].f = readFilesRec(obj.parent.path.join(__dirname, "files/" + domainx + "/mesh-" + meshsplit[2]));
                    } catch (e) {
                        // Got an error, try to create all the folders and try again...
                        try { obj.fs.mkdirSync(obj.parent.filespath); } catch (e) { }
                        try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx)); } catch (e) { }
                        try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx + "/mesh-" + meshsplit[2])); } catch (e) { }
                        try { files.filetree.f[mesh._id].f = readFilesRec(obj.parent.path.join(obj.parent.filespath, domainx + "/mesh-" + meshsplit[2])); } catch (e) { }
                    }
                }
            }
        }

        // Respond
        try { ws.send(JSON.stringify(files)); } catch (ex) { }
    }

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
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
        do { bigInt = obj.parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000);
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

    return obj;
};