/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

'use strict';

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshUser = function (parent, db, ws, req, args, domain) {
    var obj = {};
    obj.db = db;
    obj.ws = ws;
    obj.fs = parent.fs;
    obj.path = parent.path;
    obj.certificates = parent.certificates;
    obj.certificateOperations = require('./certoperations.js').CertificateOperations();
    obj.args = args;
    obj.parent = parent;
    obj.domain = domain;
    obj.common = parent.common;
    obj.fs = require('fs');
    obj.path = require('path');

// Create windows sfx mesh agent    
    var Zip = require('node-7z-forall');   
    function createSfxMeshAgent(mesh, sfxmeshfile) {
        var sfxmodule = '7zS2.sfx'; 
        var sfx_ext = EscapeHtml(mesh.name) + '.exe';
		var sfxagent32bit = obj.path.join(__dirname, 'agents', 'MeshService.exe' );
		var sfxagent64bit = obj.path.join(__dirname, 'agents', 'MeshService64.exe' );
        var makesfx = new Zip();
		var sfxagent = obj.path.join(__dirname, 'sfxagents', 'remotesupport_' + sfx_ext);
		var sfxagentext = obj.path.join(__dirname, 'agents', 'meshinstall.bat' );
		var sfxagentextun = obj.path.join(__dirname, 'agents', 'meshuninstaller.bat' );
		var sfxagentextreg = obj.path.join(__dirname, 'agents', 'meshagent.reg' );
		var sfxagentextreg64 = obj.path.join(__dirname, 'agents', 'meshagent64.reg' );
		makesfx.add( sfxagent, [ sfxagentext, sfxagentextun, sfxagentextreg, sfxagentextreg64, sfxagent32bit, sfxagent64bit, sfxmeshfile ], { sfx: sfxmodule } )
			.then(function () {
				mesh.path = sfxagent;
				mesh.filename = 'remotesupport_' + sfx_ext;
				sfxagent = obj.path.join(__dirname, 'sfxagents', 'uninstallremotesupport_' + sfx_ext);
				sfxagentext = obj.path.join(__dirname, 'agents', 'meshuninstall.bat' );
				makesfx.add( sfxagent , [ sfxagentext ,sfxagent32bit, sfxagent64bit, sfxmeshfile ], { sfx: sfxmodule } )
					.then(function () {
						mesh.path2 = sfxagent;
						mesh.filename2 = 'uninstallremotesupport_' + sfx_ext;
						obj.db.Set(mesh);
						obj.fs.unlink(sfxmeshfile, (err) => { if (err) console.log(err); });
						})
						.catch(function (err) {
							console.error( err + ' #2 ' + exePath.path );
                            obj.fs.unlink(sfxmeshfile, (err) => { if (err) console.log(err); });
						});
		        })
				.catch(function (err) {
                    console.error( err + ' #1 ' + exePath.path );
                    obj.fs.unlink(sfxmeshfile, (err) => { if (err) console.log(err); });
				});
		return;
	}
    
    // Send a message to the user
    //obj.send = function (data) { try { if (typeof data == 'string') { obj.ws.send(new Buffer(data, 'binary')); } else { obj.ws.send(data); } } catch (e) { } }

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); obj.parent.parent.debug(1, 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); obj.parent.parent.debug(1, 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
    }

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
        ds.on('close', function() { /*delete this.ss.fs._copyStreams[this.ss.id];*/ func(tag); });
	};

    try {
        // Check if the user is logged in
        if ((!req.session) || (!req.session.userid) || (req.session.domainid != domain.id)) { try { obj.ws.close(); } catch (e) { } return; }
        req.session.ws = obj.ws; // Associate this websocket session with the web session
        req.session.ws.userid = req.session.userid;
        req.session.ws.domainid = domain.id;
        var user = obj.parent.users[req.session.userid];
        if (user == null) { try { obj.ws.close(); } catch (e) { } return; }

        // Add this web socket session to session list
        obj.ws.sessionId = user._id + '/' + ('' + Math.random()).substring(2);
        obj.parent.wssessions2[ws.sessionId] = obj.ws;
        if (!obj.parent.wssessions[user._id]) { obj.parent.wssessions[user._id] = [ws]; } else { obj.parent.wssessions[user._id].push(obj.ws); }
        if (obj.parent.parent.multiServer == null) {
            obj.parent.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.parent.wssessions[user._id].length, nolog: 1, domain: obj.domain.id })
        } else {
            obj.parent.recountSessions(obj.ws.sessionId); // Recount sessions
        }

        // If we have peer servers, inform them of the new session
        if (obj.parent.parent.multiServer != null) { obj.parent.parent.multiServer.DispatchMessage({ action: 'sessionStart', sessionid: obj.ws.sessionId }); }

        // Handle events
        obj.ws.HandleEvent = function (source, event) {
            if (!event.domain || event.domain == obj.domain.id) {
                try {
                    if (event == 'close') { req.session.destroy(); obj.close(); }
                    else if (event == 'resubscribe') { user.subscriptions = obj.parent.subscribe(user._id, ws); }
                    else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                    else { ws.send(JSON.stringify({ action: 'event', event: event })); }
                } catch (e) { }
            }
        }

        user.subscriptions = obj.parent.subscribe(user._id, ws);   // Subscribe to events
        obj.ws._socket.setKeepAlive(true, 240000);                 // Set TCP keep alive

        // When data is received from the web socket
        ws.on('message', function (msg) {
            var command, user = obj.parent.users[req.session.userid];
            try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
            if ((user == null) || (obj.common.validateString(command.action, 3, 32) == false)) return; // User must be set and action must be a string between 3 and 32 chars

            switch (command.action) {
                case 'ping': { ws.send(JSON.stringify({ action: 'pong' })); break; }
                case 'meshes':
                    {
                        // Request a list of all meshes this user as rights to
                        var docs = [];
                        for (var i in user.links) { if (obj.parent.meshes[i]) { docs.push(obj.parent.meshes[i]); } }
                        ws.send(JSON.stringify({ action: 'meshes', meshes: docs, tag: command.tag }));
                        break;
                    }
                case 'nodes':
                    {
                        var links = [];
                        if (command.meshid == null) {
                            // Request a list of all meshes this user as rights to
                            for (var i in user.links) { links.push(i); }
                        } else {
                            // Request list of all nodes for one specific meshid
                            var meshid = command.meshid;
                            if (obj.common.validateString(meshid, 0, 128) == false) return;
                            if (meshid.split('/').length == 0) { meshid = 'mesh/' + domain.id + '/' + command.meshid; }
                            if (user.links[meshid] != null) { links.push(meshid); }
                        }

                        // Request a list of all nodes
                        obj.db.GetAllTypeNoTypeFieldMeshFiltered(links, domain.id, 'node', function (err, docs) {
                            var r = {};
                            for (var i in docs) {
                                // Add the connection state
                                var state = obj.parent.parent.GetConnectivityState(docs[i]._id);
                                if (state) {
                                    docs[i].conn = state.connectivity;
                                    docs[i].pwr = state.powerState;
                                    if ((state.connectivity & 1) != 0) { var agent = obj.parent.wsagents[docs[i]._id]; if (agent != null) { docs[i].agct = agent.connectTime; } }
                                    if ((state.connectivity & 2) != 0) { var cira = obj.parent.parent.mpsserver.ciraConnections[docs[i]._id]; if (cira != null) { docs[i].cict = cira.tag.connectTime; } }
                                }

                                // Compress the meshid's
                                var meshid = docs[i].meshid;
                                if (!r[meshid]) { r[meshid] = []; }
                                delete docs[i].meshid;

                                // Remove Intel AMT credential if present
                                if (docs[i].intelamt != null && docs[i].intelamt.pass != null) { delete docs[i].intelamt.pass; }

                                r[meshid].push(docs[i]);
                            }
                            ws.send(JSON.stringify({ action: 'nodes', nodes: r, tag: command.tag }));
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
                                for (var i in docs) {
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
                                ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: timeline, tag: command.tag }));
                            } else {
                                // No records found, send current state if we have it
                                var state = obj.parent.parent.GetConnectivityState(command.nodeid);
                                if (state != null) { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: [state.powerState, Date.now(), state.powerState], tag: command.tag })); }
                            }
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
                            else if (command.fileop == 'delete') { if (obj.common.validateArray(command.delfiles, 1) == false) return; for (var i in command.delfiles) { if (obj.common.IsFilenameValid(command.delfiles[i]) == true) { var fullpath = path + "/" + command.delfiles[i]; try { obj.fs.rmdirSync(fullpath); } catch (e) { try { obj.fs.unlinkSync(fullpath); } catch (e) { } } } } } // Delete
                            else if ((command.fileop == 'rename') && (obj.common.IsFilenameValid(command.oldname) == true) && (obj.common.IsFilenameValid(command.newname) == true)) { try { obj.fs.renameSync(path + "/" + command.oldname, path + "/" + command.newname); } catch (e) { } } // Rename
                            else if ((command.fileop == 'copy') || (command.fileop == 'move')) {
                                if (obj.common.validateArray(command.names, 1) == false) return;
                                var scpath = meshPathToRealPath(command.scpath, user); // This will also check access rights
                                if (scpath == null) break;
                                // TODO: Check quota if this is a copy!!!!!!!!!!!!!!!!
                                for (var i in command.names) {
                                    var s = obj.path.join(scpath, command.names[i]), d = obj.path.join(path, command.names[i]);
                                    sendUpdate = false;
                                    copyFile(s, d, function (op) { if (op != null) { obj.fs.unlink(op, function () { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); }); } else { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } }, ((command.fileop == 'move') ? s : null));
                                }
                            }

                            if (sendUpdate == true) { obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles'); } // Fire an event causing this user to update this files
                        }
                        break;
                    }
                case 'msg':
                    {
                        // Route a message.
                        // This this command has a nodeid, that is the target.
                        if (obj.common.validateString(command.nodeid, 8, 128) == false) return;
                        var splitnodeid = command.nodeid.split('/');
                        // Check that we are in the same domain and the user has rights over this node.
                        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domain.id)) {
                            // See if the node is connected
                            var agent = obj.parent.wsagents[command.nodeid];
                            if (agent != null) {
                                // Check if we have permission to send a message to that node
                                var rights = user.links[agent.dbMeshKey];
                                if ((rights != null) && ((rights.rights & 8) != 0)) { // 8 is remote control permission
                                    command.sessionid = ws.sessionId;   // Set the session id, required for responses.
                                    command.rights = rights.rights;     // Add user rights flags to the message
                                    delete command.nodeid;              // Remove the nodeid since it's implyed.
                                    agent.send(JSON.stringify(command));
                                }
                            } else {
                                // Check if a peer server is connected to this agent
                                var routing = obj.parent.parent.GetRoutingServerId(command.nodeid, 1); // 1 = MeshAgent routing type
                                if (routing != null) {
                                    // Check if we have permission to send a message to that node
                                    var rights = user.links[routing.meshid];
                                    if ((rights != null) && ((rights.rights & 8) != 0)) { // 8 is remote control permission
                                        command.fromSessionid = ws.sessionId;   // Set the session id, required for responses.
                                        command.rights = rights.rights;         // Add user rights flags to the message
                                        obj.parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                                    }
                                }
                            }
                        }
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
                        obj.parent.parent.DispatchEvent(['*', 'server-global'], obj, { action: 'clearevents', nolog: 1, domain: domain.id })
                        break;
                    }
                case 'users':
                    {
                        // Request a list of all users
                        if ((user.siteadmin & 2) == 0) break;
                        var docs = [];
                        for (var i in obj.parent.users) {
                            if ((obj.parent.users[i].domain == domain.id) && (obj.parent.users[i].name != '~')) {
                                var userinfo = obj.common.Clone(obj.parent.users[i]);
                                delete userinfo.hash;
                                delete userinfo.passhint;
                                delete userinfo.salt;
                                delete userinfo.type;
                                delete userinfo.domain;
                                delete userinfo.subscriptions;
                                delete userinfo.passtype;
                                docs.push(userinfo);
                            }
                        }
                        ws.send(JSON.stringify({ action: 'users', users: docs, tag: command.tag }));
                        break;
                    }
                case 'changeemail':
                    {
                        // Change the email address
                        if (obj.common.validateEmail(command.email, 1, 256) == false) return;
                        if (obj.parent.users[req.session.userid].email != command.email) {
                            // Check if this email is already validated on a different account
                            obj.db.GetUserWithVerifiedEmail(domain.id, command.email, function (err, docs) {
                                if (docs.length > 0) {
                                    // Notify the duplicate email error
                                    ws.send(JSON.stringify({ action: 'msg', type: 'notify', value: 'Failed to change email address, another account already using: <b>' + EscapeHtml(command.email) + '</b>.' }));
                                } else {
                                    // Update the user's email
                                    var oldemail = user.email;
                                    user.email = command.email;
                                    user.emailVerified = false;
                                    obj.parent.db.SetUser(user);

                                    // Event the change
                                    var userinfo = obj.common.Clone(user);
                                    delete userinfo.hash;
                                    delete userinfo.passhint;
                                    delete userinfo.salt;
                                    delete userinfo.type;
                                    delete userinfo.domain;
                                    delete userinfo.subscriptions;
                                    delete userinfo.passtype;
                                    var message = { etype: 'user', username: userinfo.name, account: userinfo, action: 'accountchange', domain: domain.id };
                                    if (oldemail != null) {
                                        message.msg = 'Changed email of user ' + userinfo.name + ' from ' + oldemail + ' to ' + user.email;
                                    } else {
                                        message.msg = 'Set email of user ' + userinfo.name + ' to ' + user.email;
                                    }
                                    obj.parent.parent.DispatchEvent(['*', 'server-users', user._id], obj, message);
                                }
                            });
                        }
                        break;
                    }
                case 'verifyemail':
                    {
                        // Send a account email verification email
                        if (obj.common.validateString(command.email, 3, 1024) == false) return;
                        var x = command.email.split('@');
                        if ((x.length == 2) && (x[0].length > 0) && (x[1].split('.').length > 1) && (x[1].length > 2)) {
                            if (obj.parent.users[req.session.userid].email == command.email) {
                                // Send the verification email
                                if (obj.parent.parent.mailserver != null) {
                                    obj.parent.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email);
                                }
                            }
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
                            for (var i in obj.parent.wssessions) { if (obj.parent.wssessions[i][0].domainid == domain.id) { wssessions[i] = obj.parent.wssessions[i].length; } }
                        } else {
                            // We have peer servers, use more complex session counting
                            for (var userid in obj.parent.sessionsCount) { if (userid.split('/')[1] == domain.id) { wssessions[userid] = obj.parent.sessionsCount[userid]; } }
                        }
                        ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: wssessions, tag: command.tag })); // wssessions is: userid --> count
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
                            for (var meshid in deluser.links) {
                                // Get the mesh
                                var mesh = obj.parent.meshes[meshid];
                                if (mesh) {
                                    // Remove user from the mesh
                                    if (mesh.links[deluser._id] != null) { delete mesh.links[deluser._id]; obj.parent.db.Set(mesh); }
                                    // Notify mesh change
                                    var change = 'Removed user ' + deluser.name + ' from mesh ' + mesh.name;
                                    obj.parent.parent.DispatchEvent(['*', mesh._id, deluser._id, userid], obj, { etype: 'mesh', username: user.name, userid: userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
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
                        obj.parent.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: deluserid, username: deluser.name, action: 'accountremove', msg: 'Account removed', domain: domain.id })
                        obj.parent.parent.DispatchEvent([deluserid], obj, 'close');

                        break;
                    }
                case 'adduser':
                    {
                        // Add a new user account
                        if ((user.siteadmin & 2) == 0) break;
                        if (obj.common.validateUsername(command.username, 1, 64) == false) break; // Username is between 1 and 64 characters, no spaces
                        if (obj.common.validateString(command.pass, 1, 256) == false) break; // Password is between 1 and 256 characters
                        if ((command.email != null) && (obj.common.validateEmail(command.email, 1, 256) == false)) break; // Check if this is a valid email address
                        var newusername = command.username, newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase();
                        if (newusername == '~') break; // This is a reserved user name
                        if (!obj.parent.users[newuserid]) {
                            var newuser = { type: 'user', _id: newuserid, name: newusername, creation: Date.now(), domain: domain.id };
                            if (command.email != null) { newuser.email = command.email; } // Email
                            obj.parent.users[newuserid] = newuser;
                            // Create a user, generate a salt and hash the password
                            require('./pass').hash(command.pass, function (err, salt, hash) {
                                if (err) throw err;
                                newuser.salt = salt;
                                newuser.hash = hash;
                                obj.db.SetUser(newuser);
                                var newuser2 = obj.common.Clone(newuser);
                                if (newuser2.subscriptions) { delete newuser2.subscriptions; }
                                if (newuser2.salt) { delete newuser2.salt; }
                                if (newuser2.hash) { delete newuser2.hash; }
                                obj.parent.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: newusername, account: newuser2, action: 'accountcreate', msg: 'Account created, email is ' + command.email, domain: domain.id })
                            });
                        }
                        break;
                    }
                case 'edituser':
                    {
                        // Edit a user account, may involve changing email or administrator permissions
                        if (((user.siteadmin & 2) != 0) || (user.name == command.name)) {
                            var chguserid = 'user/' + domain.id + '/' + command.name.toLowerCase(), chguser = obj.parent.users[chguserid], change = 0;
                            if (chguser) {
                                if (obj.common.validateString(command.email, 1, 256) && (chguser.email != command.email)) { chguser.email = command.email; change = 1; }
                                if ((command.emailVerified === true || command.emailVerified === false) && (chguser.emailVerified != command.emailVerified)) { chguser.emailVerified = command.emailVerified; change = 1; }
                                if (obj.common.validateInt(command.quota, 0) && (command.quota != chguser.quota)) { chguser.quota = command.quota; if (chguser.quota == null) { delete chguser.quota; } change = 1; }
                                if ((user.siteadmin == 0xFFFFFFFF) && obj.common.validateInt(command.siteadmin) && (chguser.siteadmin != command.siteadmin)) { chguser.siteadmin = command.siteadmin; change = 1 }
                                if (change == 1) {
                                    obj.db.SetUser(chguser);
                                    obj.parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
                                    var userinfo = obj.common.Clone(chguser);
                                    delete userinfo.hash;
                                    delete userinfo.passhint;
                                    delete userinfo.salt;
                                    delete userinfo.type;
                                    delete userinfo.domain;
                                    delete userinfo.subscriptions;
                                    delete userinfo.passtype;
                                    obj.parent.parent.DispatchEvent(['*', 'server-users', user._id, chguser._id], obj, { etype: 'user', username: user.name, account: userinfo, action: 'accountchange', msg: 'Account changed: ' + command.name, domain: domain.id })
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
                        if (sessions != null) { for (var i in sessions) { sessions[i].send(JSON.stringify(notification)); } }

                        if (obj.parent.parent.multiServer != null) {
                            // TODO: Add multi-server support
                        }
                    }
                case 'serverversion':
                    {
                        // Check the server version
                        if ((user.siteadmin & 16) == 0) break;
                        obj.parent.parent.getLatestServerVersion(function (currentVersion, latestVersion) { ws.send(JSON.stringify({ action: 'serverversion', current: currentVersion, latest: latestVersion })); });
                        break;
                    }
                case 'serverupdate':
                    {
                        // Perform server update
                        if ((user.siteadmin & 16) == 0) break;
                        obj.parent.parent.performServerUpdate();
                        break;
                    }
                case 'createmesh':
                    {
                        // Create mesh
                        if (obj.common.validateString(command.meshname, 1, 64) == false) break; // Meshname is between 1 and 64 characters
                        if (obj.common.validateString(command.desc, 0, 1024) == false) break; // Mesh description is between 0 and 1024 characters

                        // We only create Agent-less Intel AMT mesh (Type1), or Agent mesh (Type2)
                        if ((command.meshtype == 1) || (command.meshtype == 2)) {
                            // Create a type 1 agent-less Intel AMT mesh.
                            obj.parent.crypto.randomBytes(48, function (err, buf) {
                                var meshid = 'mesh/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                                var links = {}
                                links[user._id] = { name: user.name, rights: 0xFFFFFFFF };
                                var mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links, path: '', filename: '', path2: '', filename2: '' };
                                obj.db.Set(obj.common.escapeLinksFieldName(mesh));
                                obj.parent.meshes[meshid] = mesh;
                                obj.parent.parent.AddEventDispatch([meshid], ws);
                                if (user.links == null) user.links = {};
                                user.links[meshid] = { rights: 0xFFFFFFFF };
                                user.subscriptions = obj.parent.subscribe(user._id, ws);
                                obj.db.SetUser(user);
                                obj.parent.parent.DispatchEvent(['*', meshid, user._id], obj, { etype: 'mesh', username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msg: 'Mesh created: ' + command.meshname, domain: domain.id })
                                
                            // Create mesh settings file for mesh sfx agent  
                                obj.agentCertificateHashBase64 = new Buffer(obj.certificateOperations.forge.pki.getPublicKeyFingerprint(obj.certificateOperations.forge.pki.certificateFromPem(obj.certificates.agent.cert).publicKey, { md: obj.certificateOperations.forge.md.sha384.create(), encoding: 'binary' }), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                                
                                if (domain.dns != null) {
                                    var WebServerName = domain.dns;
                                } else {
                                    var WebServerName = obj.certificates.CommonName;
                                }
                                
                                var meshidhex = new Buffer(meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                                var serveridhex = new Buffer(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                                var xdomain = (domain.dns == null) ? domain.id : '';
                                if (xdomain != '') xdomain += "/";
                                var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
                                if (obj.args.lanonly != true) { 
                                    meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + WebServerName + ":" + obj.args.port + "/" + xdomain + "agent.ashx\r\n"; 
                                } else { 
                                    meshsettings += "MeshServer=local"; 
                                }
                                
                                var sfxmeshfile = obj.path.join(__dirname, 'agents', 'meshagent.msh' );   
                                obj.fs.writeFileSync(sfxmeshfile, meshsettings, 'utf8');
                                createSfxMeshAgent(mesh, sfxmeshfile);  
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
                            var mesh = obj.common.unEscapeLinksFieldName(meshes[0]);

                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || mesh.links[user._id].rights != 0xFFFFFFFF) return;
                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                                                           
                            // Delete mesh SFX files
                            if (mesh.path != null)
                                obj.fs.unlink(mesh.path, (err) => { if (err) console.log(err); });
                            if (mesh.path2 != null)
                                obj.fs.unlink(mesh.path2, (err) => { if (err) console.log(err); });
                            
                            // Fire the removal event first, because after this, the event will not route
                            obj.parent.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'mesh', username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msg: 'Mesh deleted: ' + command.meshname, domain: domain.id })

                            // Remove all user links to this mesh
                            for (var i in meshes) {
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
                                var meshpath = getServerRootFilePath(mesh);
                                if (meshpath != null) { deleteFolderRec(meshpath); }
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
                        var mesh = obj.parent.meshes[command.meshid], change = '';
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 1) == 0)) return;
                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                            var sfxname = mesh.name;
                            if ((obj.common.validateString(command.meshname, 1, 64) == true) && (command.meshname != mesh.name)) { change = 'Mesh name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }

                            if ((obj.common.validateString(command.desc, 0, 1024) == true) && (command.desc != mesh.desc)) { if (change != '') change += ' and description changed'; else change += 'Mesh "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
							
                            if (change != '') {
                                
                                if (sfxname != mesh.name) {
                                    var makesfx = new Zip();
                                    var tempdir = obj.path.join(__dirname, 'tmp' );
                                    // extract current mesh policy from Sfx                             
                                    makesfx.extract( mesh.path2, tempdir )
                                        .then(function () {
                                            // Delete current mesh SFX files
                                            if (mesh.path1 != null)
                                                obj.fs.unlink(mesh.path, (err) => { if (err) console.log(err); });
                                            if (mesh.path2 != null)
                                                obj.fs.unlink(mesh.path2, (err) => { if (err) console.log(err); });
                                            // change mesh name 
                                            var sfxmeshfile = obj.path.join( tempdir, 'meshagent.msh');   
                                            var data = obj.fs.readFileSync(sfxmeshfile, 'utf8'); 
                                            var result = data.replace( sfxname , mesh.name );
                                            obj.fs.writeFileSync(sfxmeshfile, result, 'utf8');
                                            // recreate sfx
                                            createSfxMeshAgent(mesh, sfxmeshfile); 
                                            var tempfile = obj.path.join(tempdir, 'meshuninstall.bat' );
                                            obj.fs.unlink(tempfile, (err) => { if (err) console.log(err); });
                                            var tempfile2 = obj.path.join(tempdir, 'MeshService.exe' );
                                            obj.fs.unlink(tempfile2, (err) => { if (err) console.log(err); });
                                            var tempfile3 = obj.path.join(tempdir, 'MeshService64.exe' );
                                            obj.fs.unlink(tempfile3, (err) => { if (err) console.log(err); });
                                        });
                                }
                                
								if (change != '') { obj.db.Set(obj.common.escapeLinksFieldName(mesh)); obj.parent.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'mesh', username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id }) }
							
                            }
                        }
                        break;
                    }
                case 'emailsfxagent':
                    {
                        var mesh = obj.parent.meshes[command.meshid];
                        // Send a link to download mesh sfx agent by email
                        if ((command.clientemail != null) && (typeof command.clientemail == 'string') && (command.clientemail.length < 1024)) {
                            var x = command.clientemail.split('@');
                            if ((x.length == 2) && (x[0].length > 0) && (x[1].split('.').length > 1) && (x[1].length > 2)) {
                                if (obj.parent.parent.mailserver != null) {
                                    obj.parent.parent.mailserver.sendAgentMail( domain, command.clientemail, user.name, command.clientname, command.agenturl );
                                    obj.parent.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'user', username: user.name, action: 'emailsfxagent', msg: 'User: ' + user.name + 'sent remote session invite to: ' + command.clientname + ', At: ' + command.clientemail });
                                }
                            }

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
                        var mesh = obj.parent.meshes[command.meshid], change = '';
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
                            var change = 'Added user ' + newuser.name + ' to mesh ' + mesh.name;
                            obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, newuserid], obj, { etype: 'mesh', username: newuser.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                        }
                        break;
                    }
                case 'removemeshuser':
                    {
                        if (obj.common.validateString(command.userid, 1, 1024) == false) break; // Check userid
                        if (obj.common.validateString(command.meshid, 1, 1024) == false) break; // Check meshid
                        if ((command.userid.split('/').length != 3) || (command.userid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // Get the mesh
                        var mesh = obj.parent.meshes[command.meshid];
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
                                var change = 'Removed user ' + deluser.name + ' from mesh ' + mesh.name;
                                obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, command.userid], obj, { etype: 'mesh', username: user.name, userid: deluser.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                            }
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
                        var mesh = obj.parent.meshes[command.meshid];
                        if (mesh) {
                            if (mesh.mtype != 1) return; // This operation is only allowed for mesh type 1, Intel AMT agentless mesh.

                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                            // Create a new nodeid
                            obj.parent.crypto.randomBytes(48, function (err, buf) {
                                // create the new node
                                var nodeid = 'node/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');;
                                var device = { type: 'node', mtype: 1, _id: nodeid, meshid: command.meshid, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: command.amttls } };
                                obj.db.Set(device);

                                // Event the new node
                                var device2 = obj.common.Clone(device);
                                delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                var change = 'Added device ' + command.devicename + ' to mesh ' + mesh.name;
                                obj.parent.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'node', username: user.name, action: 'addnode', node: device2, msg: change, domain: domain.id })
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

                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i];
                            if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                            if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                            // Get the device
                            obj.db.Get(nodeid, function (err, nodes) {
                                if (nodes.length != 1) return;
                                var node = nodes[0];

                                // Get the mesh for this device
                                var mesh = obj.parent.meshes[node.meshid];
                                if (mesh) {
                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                                    // Delete this node including network interface information, events and timeline
                                    obj.db.Remove(node._id); // Remove node with that id
                                    obj.db.Remove('if' + node._id); // Remove interface information
                                    obj.db.Remove('nt' + node._id); // Remove notes
                                    obj.db.RemoveNode(node._id); // Remove all entries with node:id

                                    // Event node deletion
                                    var change = 'Removed device ' + node.name + ' from mesh ' + mesh.name;
                                    obj.parent.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', username: user.name, action: 'removenode', nodeid: node._id, msg: change, domain: domain.id })

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
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i], wakeActions = 0;
                            if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                            if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                                // Get the device
                                obj.db.Get(nodeid, function (err, nodes) {
                                    if (nodes.length != 1) return;
                                    var node = nodes[0];

                                    // Get the mesh for this device
                                    var mesh = obj.parent.meshes[node.meshid];
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
                                                    for (var i in user.links) { targetMeshes.push(i); }

                                                    // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                                    for (var i in obj.parent.wsagents) {
                                                        var agent = obj.parent.wsagents[i];
                                                        if ((targetMeshes.indexOf(agent.dbMeshKey) >= 0) && (agent.authenticated == 2)) {
                                                            //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                                            agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs }));
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
                            ws.send(JSON.stringify({ action: 'wakedevices' }));
                        }

                        break;
                    }
                case 'poweraction':
                    {
                        if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i], powerActions = 0;
                            if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                            if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                                // Get the device
                                obj.db.Get(nodeid, function (err, nodes) {
                                    if (nodes.length != 1) return;
                                    var node = nodes[0];

                                    // Get the mesh for this device
                                    var mesh = obj.parent.meshes[node.meshid];
                                    if (mesh) {

                                        // Check if this user has rights to do this
                                        if (mesh.links[user._id] != null && ((mesh.links[user._id].rights & 8) != 0)) { // "Remote Control permission"

                                            // Get this device
                                            var agent = obj.parent.wsagents[node._id];
                                            if (agent != null) {
                                                // Send the power command
                                                agent.send(JSON.stringify({ action: 'poweraction', actiontype: command.actiontype }));
                                                powerActions++;
                                            }
                                        }
                                    }
                                });
                            }
                            // Confirm we may be doing something (TODO)
                            ws.send(JSON.stringify({ action: 'poweraction' }));
                        }
                        break;
                    }
                case 'toast':
                    {
                        if (obj.common.validateArray(command.nodeids, 1) == false) break; // Check nodeid's
                        if (obj.common.validateString(command.title, 1, 512) == false) break; // Check title
                        if (obj.common.validateString(command.msg, 1, 4096) == false) break; // Check message
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i], powerActions = 0;
                            if (obj.common.validateString(nodeid, 1, 1024) == false) break; // Check nodeid
                            if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                                // Get the device
                                obj.db.Get(nodeid, function (err, nodes) {
                                    if (nodes.length != 1) return;
                                    var node = nodes[0];

                                    // Get the mesh for this device
                                    var mesh = obj.parent.meshes[node.meshid];
                                    if (mesh) {

                                        // Check if this user has rights to do this
                                        if (mesh.links[user._id] != null && ((mesh.links[user._id].rights & 8) != 0)) { // "Remote Control permission"

                                            // Get this device
                                            var agent = obj.parent.wsagents[node._id];
                                            if (agent != null) {
                                                // Send the power command
                                                agent.send(JSON.stringify({ action: 'toast', title: command.title, msg: command.msg }));
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
                            if (nodes.length != 1) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }
                            var node = nodes[0];

                            // Get the mesh for this device
                            var mesh = obj.parent.meshes[node.meshid];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }

                                // Get network information about this node
                                obj.db.Get('if' + command.nodeid, function (err, netinfos) {
                                    if (netinfos.length != 1) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }
                                    var netinfo = netinfos[0];
                                    ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, updateTime: netinfo.updateTime, netif: netinfo.netif }));
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
                            var mesh = obj.parent.meshes[node.meshid];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                                // Ready the node change event
                                var changes = [], change = 0, event = { etype: 'node', username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id };
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
                                    event.msg = 'Changed device ' + node.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ');
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
                        if (command.path) {
                            if (obj.common.validateString(command.path, 1, 4096) == false) break; // Check path
                            if (command.path == '*') {
                                // Update the server default core and send a core hash request
                                // Load default mesh agent core if present, then perform a core update
                                obj.parent.parent.updateMeshCore(function () { obj.parent.sendMeshAgentCore(user, domain, command.nodeid, '*'); });
                            } else {
                                // Send a mesh agent core to the mesh agent
                                var file = obj.parent.getServerFilePath(user, domain, command.path);
                                if (file != null) {
                                    obj.parent.readEntireTextFile(file.fullpath, function (data) {
                                        if (data != null) {
                                            data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                                            obj.parent.sendMeshAgentCore(user, domain, command.nodeid, data);
                                        }
                                    })
                                }
                            }
                        } else {
                            // Clear the mesh agent core on the mesh agent
                            obj.parent.sendMeshAgentCore(user, domain, command.nodeid, null);
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
                        if (obj.req.session && obj.req.session.ws && obj.req.session.ws == ws) delete obj.req.session.ws;
                        try { ws.close(); } catch (e) { }
                        break;
                    }
                case 'getcookie':
                    {
                        // Check if this user has rights on this nodeid
                        if (obj.common.validateString(command.nodeid, 1, 1024) == false) break; // Check nodeid
                        obj.db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                            if (nodes.length == 1) {
                                var meshlinks = user.links[nodes[0].meshid];
                                if ((meshlinks) && (meshlinks.rights) && (meshlinks.rights & obj.parent.MESHRIGHT_REMOTECONTROL != 0)) {
                                    // Add a user authentication cookie to a url
                                    var cookieContent = { userid: user._id, domainid: user.domain };
                                    if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
                                    if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want to agent to TCP connect to a remote address
                                    if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want to agent to TCP connect to a remote port
                                    command.cookie = obj.parent.parent.encodeCookie(cookieContent);
                                    ws.send(JSON.stringify(command));
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
                        var mesh = obj.parent.meshes[command.meshid];
                        if (mesh) {
                            if (mesh.mtype != 2) return; // This operation is only allowed for mesh type 2, agent mesh

                            // Check if this user has rights to do this
                            //if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 4) == 0)) return;

                            // Perform email invitation
                            obj.parent.parent.mailserver.sendAgentInviteMail(domain, user.name, command.email, command.meshid);
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
                                    var meshlinks = user.links[nodes[0].meshid];
                                    if ((meshlinks) && (meshlinks.rights) && (meshlinks.rights & obj.parent.MESHRIGHT_SETNOTES != 0)) {
                                        // Set the id's notes
                                        if (obj.common.validateString(command.notes, 1) == false) {
                                            obj.db.Remove('nt' + command.id); // Delete the note for this node
                                        } else {
                                            obj.db.Set({ _id: 'nt' + command.id, value: command.notes }); // Set the note for this node
                                        }
                                    }
                                }
                            });
                        } else if (idtype == 'mesh') {
                            // Get the mesh for this device
                            var mesh = obj.parent.meshes[command.id];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { return; }

                                // Set the id's notes
                                if (obj.common.validateString(command.notes, 1) == false) {
                                    obj.db.Remove('nt' + command.id); // Delete the note for this node
                                } else {
                                    obj.db.Set({ _id: 'nt' + command.id, value: command.notes }); // Set the note for this node
                                }
                            }
                        } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                            // Set the id's notes
                            if (obj.common.validateString(command.notes, 1) == false) {
                                obj.db.Remove('nt' + command.id); // Delete the note for this node
                            } else {
                                obj.db.Set({ _id: 'nt' + command.id, value: command.notes }); // Set the note for this node
                            }
                        }

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
                                var mesh = obj.parent.meshes[node.meshid];
                                if (mesh) {
                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { return; }

                                    // Get the notes about this node
                                    obj.db.Get('nt' + command.id, function (err, notes) {
                                        if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                        ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                    });
                                }
                            });
                        } else if (idtype == 'mesh') {
                            // Get the mesh for this device
                            var mesh = obj.parent.meshes[command.id];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == null || (mesh.links[user._id].rights == 0)) { return; }

                                // Get the notes about this node
                                obj.db.Get('nt' + command.id, function (err, notes) {
                                    if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                    ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                                });
                            }
                        } else if ((idtype == 'user') && ((user.siteadmin & 2) != 0)) {
                            // Get the notes about this node
                            obj.db.Get('nt' + command.id, function (err, notes) {
                                if (notes.length != 1) { ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: null })); return; }
                                ws.send(JSON.stringify({ action: 'getNotes', id: command.id, notes: notes[0].value }));
                            });
                        }

                        break;
                    }
            }
        });

        // If error, do nothing
        ws.on('error', function (err) { console.log(err); });

        // If the web socket is closed
        ws.on('close', function (req) {
            obj.parent.parent.RemoveAllEventDispatch(ws);
            if (req.session && req.session.ws && req.session.ws == ws) { delete req.session.ws; }
            if (obj.parent.wssessions2[ws.sessionId]) { delete obj.parent.wssessions2[ws.sessionId]; }
            if (obj.parent.wssessions[ws.userid]) {
                var i = obj.parent.wssessions[ws.userid].indexOf(ws);
                if (i >= 0) {
                    obj.parent.wssessions[ws.userid].splice(i, 1);
                    var user = obj.parent.users[ws.userid];
                    if (user) {
                        if (obj.parent.parent.multiServer == null) {
                            obj.parent.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.parent.wssessions[ws.userid].length, nolog: 1, domain: obj.domain.id })
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
        var serverinfo = { name: obj.parent.certificates.CommonName, mpsname: obj.parent.certificates.AmtMpsName, mpsport: mpsport, mpspass: obj.args.mpspass, port: httpport, emailcheck: obj.parent.parent.mailserver != null }
        if (obj.args.notls == true) { serverinfo.https = false; } else { serverinfo.https = true; serverinfo.redirport = obj.args.redirport; }

        // Send server information
        ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: serverinfo }));

        // Send user information to web socket, this is the first thing we send
        var userinfo = obj.common.Clone(obj.parent.users[req.session.userid]);
        delete userinfo.salt;
        delete userinfo.hash;
        ws.send(JSON.stringify({ action: 'userinfo', userinfo: userinfo }));
    } catch (e) { console.log(e); }

    // Read the folder and all sub-folders and serialize that into json.
    function readFilesRec(path) {
        var r = {}, dir = obj.fs.readdirSync(path);
        for (var i in dir) {
            var f = { t: 3, d: 111 };
            var stat = obj.fs.statSync(path + '/' + dir[i])
            if ((stat.mode & 0x004000) == 0) { f.s = stat.size; f.d = stat.mtime.getTime(); } else { f.t = 2; f.f = readFilesRec(path + '/' + dir[i]); }
            r[dir[i]] = f;
        }
        return r;
    }

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
        ws.send(JSON.stringify(files));
    }

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    return obj;
}
