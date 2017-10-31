/**
* @description Meshcentral MeshAgent
* @author Ylian Saint-Hilaire & Bryan Roe
* @version v0.0.1
*/

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshUser = function (parent, db, ws, req, args, domain) {
    var obj = {};
    obj.db = db;
    obj.ws = ws;
    obj.fs = parent.fs;
    obj.args = args;
    obj.parent = parent;
    obj.domain = domain;
    obj.common = parent.common;

    // Send a message to the user
    //obj.send = function (data) { try { if (typeof data == 'string') { obj.ws.send(new Buffer(data, 'binary')); } else { obj.ws.send(data); } } catch (e) { } }

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); obj.parent.parent.debug(1, 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); obj.parent.parent.debug(1, 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
    }

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
                    if (event == 'close') { obj.req.session.destroy(); obj.ws.close(); }
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
            var user = obj.parent.users[req.session.userid];
            var command = JSON.parse(msg.toString('utf8'))
            switch (command.action) {
                case 'meshes':
                    {
                        // Request a list of all meshes this user as rights to
                        var docs = [];
                        for (var i in user.links) { if (obj.parent.meshes[i]) { docs.push(obj.parent.meshes[i]); } }
                        ws.send(JSON.stringify({ action: 'meshes', meshes: docs }));
                        break;
                    }
                case 'nodes':
                    {
                        // Request a list of all meshes this user as rights to
                        var links = [];
                        for (var i in user.links) { links.push(i); }

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
                                r[meshid].push(docs[i]);
                            }
                            ws.send(JSON.stringify({ action: 'nodes', nodes: r }));
                        });
                        break;
                    }
                case 'powertimeline':
                    {
                        // Query the database for the power timeline for a given node
                        // The result is a compacted array: [ startPowerState, startTimeUTC, powerState ] + many[ deltaTime, powerState ]
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
                                ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: timeline }));
                            } else {
                                // No records found, send current state if we have it
                                var state = obj.parent.parent.GetConnectivityState(command.nodeid);
                                if (state != null) { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: [state.powerState, Date.now(), state.powerState] })); }
                            }
                        });
                        break;
                    }
                case 'files':
                    {
                        // Send the full list of server files to the browser app
                        if ((user.siteadmin & 8) != 0) { updateUserFiles(user, ws, domain); }
                        break;
                    }
                case 'fileoperation':
                    {
                        // Check permissions
                        if ((user.siteadmin & 8) != 0) {
                            // Perform a file operation (Create Folder, Delete Folder, Delete File...)
                            if ((command.path != null) && (typeof command.path == 'object') && command.path.length > 0) {
                                var rootfolder = command.path[0];
                                var rootfoldersplit = rootfolder.split('/'), domainx = 'domain';
                                if (rootfoldersplit[1].length > 0) domainx = 'domain-' + rootfoldersplit[1];
                                var path = obj.path.join(obj.filespath, domainx + "/" + rootfoldersplit[0] + "-" + rootfoldersplit[2]);
                                for (var i = 1; i < command.path.length; i++) { if (obj.common.IsFilenameValid(command.path[i]) == false) { path = null; break; } path += ("/" + command.path[i]); }
                                if (path == null) break;

                                if ((command.fileop == 'createfolder') && (obj.common.IsFilenameValid(command.newfolder) == true)) { try { obj.fs.mkdirSync(path + "/" + command.newfolder); } catch (e) { } } // Create a new folder
                                else if (command.fileop == 'delete') { for (var i in command.delfiles) { if (obj.common.IsFilenameValid(command.delfiles[i]) == true) { var fullpath = path + "/" + command.delfiles[i]; try { obj.fs.rmdirSync(fullpath); } catch (e) { try { obj.fs.unlinkSync(fullpath); } catch (e) { } } } } } // Delete
                                else if ((command.fileop == 'rename') && (obj.common.IsFilenameValid(command.oldname) == true) && (obj.common.IsFilenameValid(command.newname) == true)) { try { obj.fs.renameSync(path + "/" + command.oldname, path + "/" + command.newname); } catch (e) { } } // Rename

                                obj.parent.parent.DispatchEvent([user._id], obj, 'updatefiles') // Fire an event causing this user to update this files
                            }
                        }
                        break;
                    }
                case 'msg':
                    {
                        // Route a message.
                        // This this command has a nodeid, that is the target.
                        if (command.nodeid != null) {
                            var splitnodeid = command.nodeid.split('/');
                            // Check that we are in the same domain and the user has rights over this node.
                            if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domain.id)) {
                                // See if the node is connected
                                var agent = obj.parent.wsagents[command.nodeid];
                                if (agent != null) {
                                    // Check if we have permission to send a message to that node
                                    var rights = user.links[agent.dbMeshKey];
                                    if (rights != null || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
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
                                        if (rights != null || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                                            command.fromSessionid = ws.sessionId;   // Set the session id, required for responses.
                                            command.rights = rights.rights;         // Add user rights flags to the message
                                            obj.parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                case 'events':
                    {
                        // Send the list of events for this session
                        obj.db.GetEvents(user.subscriptions, domain.id, function (err, docs) { if (err != null) return; ws.send(JSON.stringify({ action: 'events', events: docs })); });
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
                        for (var i in obj.parent.users) { if ((obj.parent.users[i].domain == domain.id) && (obj.parent.users[i].name != '~')) { docs.push(obj.parent.users[i]); } }
                        ws.send(JSON.stringify({ action: 'users', users: docs }));
                        break;
                    }
                case 'wssessioncount':
                    {
                        // Request a list of all web socket user session count
                        var wssessions = {};
                        if ((user.siteadmin & 2) == 0) break;
                        if (obj.parent.parent.multiServer == null) {
                            // No peering, use simple session counting
                            for (var i in obj.wssessions) { if (obj.wssessions[i][0].domainid == domain.id) { wssessions[i] = obj.wssessions[i].length; } }
                        } else {
                            // We have peer servers, use more complex session counting
                            for (var userid in obj.sessionsCount) { if (userid.split('/')[1] == domain.id) { wssessions[userid] = obj.sessionsCount[userid]; } }
                        }
                        ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: wssessions })); // wssessions is: userid --> count
                        break;
                    }
                case 'deleteuser':
                    {
                        // Delete a user account
                        if ((user.siteadmin & 2) == 0) break;
                        var delusername = command.username, deluserid = command.userid, deluser = obj.parent.users[deluserid];
                        if ((deluser.siteadmin != null) && (deluser.siteadmin > 0) && (user.siteadmin != 0xFFFFFFFF)) break; // Need full admin to remote another administrator
                        if ((deluserid.split('/').length != 3) || (deluserid.split('/')[1] != domain.id)) break; // Invalid domain, operation only valid for current domain

                        // Delete all files on the server for this account
                        try {
                            var deluserpath = obj.parent.getServerRootFilePath(deluser);
                            if (deluserpath != null) { obj.parent.deleteFolderRec(deluserpath); }
                        } catch (e) { }

                        obj.db.Remove(deluserid);
                        delete obj.parent.users[deluserid];
                        obj.parent.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: deluserid, username: delusername, action: 'accountremove', msg: 'Account removed', domain: domain.id })
                        obj.parent.parent.DispatchEvent([deluserid], obj, 'close');

                        break;
                    }
                case 'adduser':
                    {
                        // Add a new user account
                        if ((user.siteadmin & 2) == 0) break;
                        var newusername = command.username, newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase();
                        if (newusername == '~') break; // This is a reserved user name
                        if (!obj.parent.users[newuserid]) {
                            var newuser = { type: 'user', _id: newuserid, name: newusername, email: command.email, creation: Date.now(), domain: domain.id };
                            obj.parent.users[newuserid] = newuser;
                            // Create a user, generate a salt and hash the password
                            obj.parent.hash(command.pass, function (err, salt, hash) {
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
                                if (command.email && chguser.email != command.email) { chguser.email = command.email; change = 1; }
                                if (command.quota != chguser.quota) { chguser.quota = command.quota; if (chguser.quota == null) { delete chguser.quota; } change = 1; }
                                if ((user.siteadmin == 0xFFFFFFFF) && (command.siteadmin != null) && (chguser.siteadmin != command.siteadmin)) { chguser.siteadmin = command.siteadmin; change = 1 }
                                if (change == 1) {
                                    obj.db.Set(chguser);
                                    obj.parent.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
                                    var chguser2 = obj.common.Clone(chguser);
                                    delete chguser2.salt;
                                    delete chguser2.hash;
                                    obj.parent.parent.DispatchEvent(['*', 'server-users', user._id, chguser._id], obj, { etype: 'user', username: user.name, account: chguser2, action: 'accountchange', msg: 'Account changed: ' + command.name, domain: domain.id })
                                }
                            }
                        }
                        break;
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
                        // TODO: Right now, we only create type 1 Agent-less Intel AMT mesh, or type 2 Agent mesh
                        if ((command.meshtype == 1) || (command.meshtype == 2)) {
                            // Create a type 1 agent-less Intel AMT mesh.
                            obj.parent.crypto.randomBytes(48, function (err, buf) {
                                var meshid = 'mesh/' + domain.id + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');;
                                var links = {}
                                links[user._id] = { name: user.name, rights: 0xFFFFFFFF };
                                var mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links };
                                obj.db.Set(mesh);
                                obj.parent.meshes[meshid] = mesh;
                                obj.parent.parent.AddEventDispatch([meshid], ws);
                                if (user.links == null) user.links = {};
                                user.links[meshid] = { rights: 0xFFFFFFFF };
                                user.subscriptions = obj.parent.subscribe(user._id, ws);
                                obj.db.SetUser(user);
                                obj.parent.parent.DispatchEvent(['*', meshid, user._id], obj, { etype: 'mesh', username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msg: 'Mesh created: ' + command.meshname, domain: domain.id })
                            });
                        }
                        break;
                    }
                case 'deletemesh':
                    {
                        // Delete a mesh and all computers within it
                        obj.db.Get(command.meshid, function (err, meshes) {
                            if (meshes.length != 1) return;
                            var mesh = meshes[0];

                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || mesh.links[user._id].rights != 0xFFFFFFFF) return;
                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                            // Fire the removal event first, because after this, the event will not route
                            obj.parent.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'mesh', username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msg: 'Mesh deleted: ' + command.meshname, domain: domain.id })

                            // Remove all user links to this mesh
                            for (var i in meshes) {
                                var links = meshes[i].links;
                                for (var j in links) {
                                    var xuser = obj.parent.users[j];
                                    delete xuser.links[meshes[i]._id];
                                    obj.db.Set(xuser);
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
                        var mesh = obj.parent.meshes[command.meshid], change = '';
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 1) == 0)) return;
                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                            if (command.meshname && command.meshname != '' && command.meshname != mesh.name) { change = 'Mesh name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }
                            if (command.desc != null && command.desc != mesh.desc) { if (change != '') change += ' and description changed'; else change += 'Mesh "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
                            if (change != '') { obj.db.Set(mesh); obj.parent.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'mesh', username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id }) }
                        }
                        break;
                    }
                case 'addmeshuser':
                    {
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
                            obj.db.Set(newuser);
                            obj.parent.parent.DispatchEvent([newuser._id], obj, 'resubscribe');

                            // Add a user to the mesh
                            mesh.links[newuserid] = { name: command.username, rights: command.meshadmin };
                            obj.db.Set(mesh);

                            // Notify mesh change
                            var change = 'Added user ' + command.username + ' to mesh ' + mesh.name;
                            obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, newuserid], obj, { etype: 'mesh', username: user.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                        }
                        break;
                    }
                case 'removemeshuser':
                    {
                        if ((command.userid.split('/').length != 3) || (command.userid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                        // Check if the user exists
                        var deluserid = command.userid, deluser = obj.parent.users[deluserid];
                        if (deluser == null) {
                            // TODO: Send error back, user not found.
                            break;
                        }

                        // Get the mesh
                        var mesh = obj.parent.meshes[command.meshid];
                        if (mesh) {
                            // Check if this user has rights to do this
                            if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 2) == 0)) return;

                            // Remove mesh from user
                            if (deluser.links != null && deluser.links[command.meshid] != null) {
                                var delmeshrights = deluser.links[command.meshid].rights;
                                if ((delmeshrights == 0xFFFFFFFF) && (mesh.links[user._id].rights != 0xFFFFFFFF)) return; // A non-admin can't kick out an admin
                                delete deluser.links[command.meshid];
                                obj.db.Set(deluser);
                                obj.parent.parent.DispatchEvent([deluser._id], obj, 'resubscribe');
                            }

                            // Remove user from the mesh
                            if (mesh.links[command.userid] != null) {
                                delete mesh.links[command.userid];
                                obj.db.Set(mesh);
                            }

                            // Notify mesh change
                            var change = 'Removed user ' + deluser.name + ' from mesh ' + mesh.name;
                            obj.parent.parent.DispatchEvent(['*', mesh._id, user._id, command.userid], obj, { etype: 'mesh', username: user.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                        }
                        break;
                    }
                case 'addamtdevice':
                    {
                        if (obj.args.wanonly == true) return; // This is a WAN-only server, local Intel AMT computers can't be added

                        if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

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
                                var device = { type: 'node', mtype: 1, _id: nodeid, meshid: command.meshid, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: parseInt(command.amttls) } };
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
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i];
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

                                    // Delete this node including network interface information and events
                                    obj.db.Remove(node._id);
                                    obj.db.Remove('if' + node._id);

                                    // Event node deletion
                                    var change = 'Removed device ' + node.name + ' from mesh ' + mesh.name;
                                    obj.parent.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', username: user.name, action: 'removenode', nodeid: node._id, msg: change, domain: domain.id })

                                    // Disconnect all connections if needed
                                    var state = obj.parent.parent.GetConnectivityState(command.nodeid);
                                    if ((state != null) && (state.connectivity != null)) {
                                        if ((state.connectivity & 1) != 0) { obj.parent.wsagents[command.nodeid].close(); } // Disconnect mesh agent
                                        if ((state.connectivity & 2) != 0) { obj.parent.parent.mpsserver.close(obj.parent.parent.mpsserver.ciraConnections[command.nodeid]); } // Disconnect CIRA connection
                                    }
                                }
                            });
                        }

                        break;
                    }
                case 'wakedevices':
                    {
                        // TODO: INPUT VALIDATION!!!
                        // TODO: We can optimize this a lot.
                        // - We should get a full list of all MAC's to wake first.
                        // - We should try to only have one agent per subnet (using Gateway MAC) send a wake-on-lan.
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i], wakeActions = 0;
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
                        // TODO: INPUT VALIDATION!!!
                        for (var i in command.nodeids) {
                            var nodeid = command.nodeids[i], powerActions = 0;
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
                case 'getnetworkinfo':
                    {
                        // Argument validation
                        if ((command.nodeid == null) || (typeof command.nodeid != 'string') || (command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

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
                        if ((command.nodeid == null) || (typeof command.nodeid != 'string') || (command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
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
                        if (command.path) {
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
                        forceMeshAgentDisconnect(user, domain, command.nodeid, command.disconnectMode);
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
                        obj.db.Get(command.nodeid, function (err, nodes) { // TODO: Make a NodeRights(user) method that also does not do a db call if agent is connected (???)
                            if (nodes.length == 1) {
                                var meshlinks = user.links[nodes[0].meshid];
                                if ((meshlinks) && (meshlinks.rights) && (meshlinks.rights & obj.parent.MESHRIGHT_REMOTECONTROL != 0)) {
                                    // Add a user authentication cookie to a url
                                    var cookieContent = { userid: user._id, domainid: user.domain };
                                    if (command.nodeid) { cookieContent.nodeid = command.nodeid; }
                                    if (command.tcpaddr) { cookieContent.tcpaddr = command.tcpaddr; } // Indicates the browser want to agent to TCP connect to a remote address
                                    if (command.tcpport) { cookieContent.tcpport = command.tcpport; } // Indicates the browser want to agent to TCP connect to a remote port
                                    command.cookie = obj.parent.encodeCookie(cookieContent);
                                    ws.send(JSON.stringify(command));
                                }
                            }
                        });
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

        // Send user information to web socket, this is the first thing we send
        var userinfo = obj.common.Clone(obj.parent.users[req.session.userid]);
        delete userinfo.salt;
        delete userinfo.hash;
        ws.send(JSON.stringify({ action: 'userinfo', userinfo: userinfo }));

        // Next, send server information
        if (obj.args.notls == true) {
            ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: { name: obj.parent.certificates.CommonName, mpsport: obj.args.mpsport, mpspass: obj.args.mpspass, port: obj.args.port, https: false } }));
        } else {
            ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: { name: obj.parent.certificates.CommonName, mpsport: obj.args.mpsport, mpspass: obj.args.mpspass, redirport: obj.args.redirport, port: obj.args.port, https: true } }));
        }
    } catch (e) { console.log(e); }

    // Return the maximum number of bytes allowed in the user account "My Files".
    function getQuota(objid, domain) {
        if (objid == null) return 0;
        if (objid.startsWith('user/')) {
            var user = obj.parent.users[objid];
            if (user == null) return 0;
            if ((user.quota != null) && (typeof user.quota == 'number')) { return user.quota; }
            if ((domain != null) && (domain.userQuota != null) && (typeof domain.userQuota == 'number')) { return domain.userQuota; }
            return 1048576; // By default, the server will have a 1 meg limit on user accounts
        } else if (objid.startsWith('mesh/')) {
            var mesh = obj.parent.meshes[objid];
            if (mesh == null) return 0;
            if ((mesh.quota != null) && (typeof mesh.quota == 'number')) { return mesh.quota; }
            if ((domain != null) && (domain.meshQuota != null) && (typeof domain.meshQuota == 'number')) { return domain.meshQuota; }
            return 1048576; // By default, the server will have a 1 meg limit on mesh accounts
        }
        return 0;
    }

    // Take a "user/domain/userid/path/file" format and return the actual server disk file path if access is allowed
    function getServerFilePath(user, domain, path) {
        var splitpath = path.split('/'), serverpath = obj.path.join(obj.filespath, 'domain'), filename = '';
        if ((splitpath.length < 3) || (splitpath[0] != 'user' && splitpath[0] != 'mesh') || (splitpath[1] != domain.id)) return null; // Basic validation
        var objid = splitpath[0] + '/' + splitpath[1] + '/' + splitpath[2];
        if (splitpath[0] == 'user' && (objid != user._id)) return null; // User validation, only self allowed
        if (splitpath[0] == 'mesh') { var link = user.links[objid]; if ((link == null) || (link.rights == null) || ((link.rights & 32) == 0)) { return null; } } // Check mesh server file rights
        if (splitpath[1] != '') { serverpath += '-' + splitpath[1]; } // Add the domain if needed
        serverpath += ('/' + splitpath[0] + '-' + splitpath[2]);
        for (var i = 3; i < splitpath.length; i++) { if (obj.common.IsFilenameValid(splitpath[i]) == true) { serverpath += '/' + splitpath[i]; filename = splitpath[i]; } else { return null; } } // Check that each folder is correct
        var fullpath = obj.path.resolve(obj.filespath, serverpath), quota = 0;
        return { fullpath: fullpath, path: serverpath, name: filename, quota: getQuota(objid, domain) };
    }

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
        files.filetree.f[user._id].maxbytes = getQuota(user._id, domain);
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
                    files.filetree.f[mesh._id] = { t: 1, n: mesh.name, f: {} };
                    files.filetree.f[mesh._id].maxbytes = getQuota(mesh._id, domain);

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

    return obj;
}
