/**
* @description Meshcentral MeshAgent
* @author Ylian Saint-Hilaire & Bryan Roe
* @version v0.0.1
*/

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshAgent = function (parent, db, ws, req, args, domain) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.ws = ws;
    obj.fs = parent.fs;
    obj.args = args;
    obj.nodeid = null;
    obj.meshid = null;
    obj.dbNodeKey = null;
    obj.dbMeshKey = null;
    obj.forge = parent.parent.certificateOperations.forge;
    obj.common = parent.parent.common;
    obj.authenticated = 0;
    obj.domain = domain;
    obj.receivedCommands = 0;
    obj.connectTime = null;
    obj.agentCoreCheck = 0;
    obj.agentInfo;
    obj.agentUpdate = null;
    var agentUpdateBlockSize = 65520;
    obj.remoteaddr = obj.ws._socket.remoteAddress;
    if (obj.remoteaddr.startsWith('::ffff:')) { obj.remoteaddr = obj.remoteaddr.substring(7); }

    // Send a message to the mesh agent
    obj.send = function (data) { if (typeof data == 'string') { obj.ws.send(new Buffer(data, 'binary')); } else { obj.ws.send(data); } }

    // Disconnect this agent
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); obj.parent.parent.debug(1, 'Soft disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); obj.parent.parent.debug(1, 'Hard disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')');  } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        if (obj.parent.wsagents[obj.dbNodeKey] == obj) {
            delete obj.parent.wsagents[obj.dbNodeKey];
            obj.parent.parent.ClearConnectivityState(obj.dbMeshKey, obj.dbNodeKey, 1);
        }
        // Other clean up may be needed here
        if (obj.unauth) { delete obj.unauth; }
        if (obj.agentUpdate != null) { obj.fs.close(obj.agentUpdate.fd); obj.agentUpdate = null; }
    }

    // When data is received from the mesh agent web socket
    ws.on('message', function (msg) {
        if (msg.length < 2) return;
        if (typeof msg == 'object') {
            // Convert the buffer into a string
            var msg2 = "";
            for (var i = 0; i < msg.length; i++) { msg2 += String.fromCharCode(msg[i]); }
            msg = msg2;
        }

        if (obj.authenticated == 2) { // We are authenticated
            if (msg.charCodeAt(0) == 123) { processAgentData(msg); }
            if (msg.length < 2) return;
            var cmdid = obj.common.ReadShort(msg, 0);
            if (cmdid == 11) { // MeshCommand_CoreModuleHash
                if (msg.length == 4) { ChangeAgentCoreInfo({ caps: 0 }); } // If the agent indicated that no core is running, clear the core information string.
                // Mesh core hash, sent by agent with the hash of the current mesh core.
                if (obj.agentCoreCheck == 1000) return; // If we are using a custom core, don't try to update it.
                // We need to check if the core is current.
                // TODO: Check if we have a mesh specific core. If so, use that.
                var agentMeshCoreHash = null;
                if (msg.length == 36) { agentMeshCoreHash = msg.substring(4, 36); }
                if (agentMeshCoreHash != obj.parent.parent.defaultMeshCoreHash) {
                    if (obj.agentCoreCheck < 5) { // This check is in place to avoid a looping core update.
                        if (obj.parent.parent.defaultMeshCoreHash == null) {
                            // Update no core
                            obj.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0)); // Command 10, ask mesh agent to clear the core
                        } else {
                            // Update new core
                            obj.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + obj.parent.parent.defaultMeshCoreHash + obj.parent.parent.defaultMeshCore); // Command 10, ask mesh agent to set the core
                        }
                        obj.agentCoreCheck++;
                    }
                } else {
                    obj.agentCoreCheck = 0;
                }
            }
            else if (cmdid == 12) { // MeshCommand_AgentHash
                if ((msg.length == 36) && (obj.agentInfo != undefined) && (obj.agentInfo.update == true)) {
                    var agenthash = obj.common.rstr2hex(msg.substring(4)).toLowerCase();
                    if (agenthash != obj.agentInfo.hash) {
                        // Mesh agent update required
                        console.log('Agent update required, NodeID=0x' + obj.nodeid.substring(0, 16) + ', ' + obj.agentInfo.desc);
                        obj.fs.open(obj.agentInfo.path, 'r', function (err, fd) {
                            if (err) { return console.error(err); }
                            obj.agentUpdate = { oldHash: agenthash, ptr: 0, buf: new Buffer(agentUpdateBlockSize + 4), fd: fd };

                            // We got the agent file open ont he server side, tell the agent we are sending an update starting with the SHA256 hash of the result
                            //console.log("Agent update file open.");
                            obj.send(obj.common.ShortToStr(13) + obj.common.ShortToStr(0)); // Command 13, start mesh agent download

                            // Send the first mesh agent update data block
                            obj.agentUpdate.buf[0] = 0;
                            obj.agentUpdate.buf[1] = 14;
                            obj.agentUpdate.buf[2] = 0;
                            obj.agentUpdate.buf[3] = 1;
                            var len = -1;
                            try { len = obj.fs.readSync(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, agentUpdateBlockSize, obj.agentUpdate.ptr); } catch (e) { }
                            if (len == -1) {
                                // Error reading the agent file, stop here.
                                obj.fs.close(obj.agentUpdate.fd);
                                obj.agentUpdate = null;
                            } else {
                                // Send the first block to the agent
                                obj.agentUpdate.ptr += len;
                                //console.log("Agent update send first block: " + len);
                                obj.send(obj.agentUpdate.buf); // Command 14, mesh agent first data block
                            }
                        });
                    }
                }
            }
            else if (cmdid == 14) { // MeshCommand_AgentBinaryBlock
                if ((msg.length == 4) && (obj.agentUpdate != null)) {
                    var status = obj.common.ReadShort(msg, 2);
                    if (status == 1) {
                        var len = -1;
                        try { len = obj.fs.readSync(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, agentUpdateBlockSize, obj.agentUpdate.ptr); } catch (e) { }
                        if (len == -1) {
                            // Error reading the agent file, stop here.
                            obj.fs.close(obj.agentUpdate.fd);
                            obj.agentUpdate = null;
                        } else {
                            // Send the next block to the agent
                            obj.agentUpdate.ptr += len;
                            //console.log("Agent update send next block: " + len);
                            if (len == agentUpdateBlockSize) { obj.ws.send(obj.agentUpdate.buf); } else { obj.ws.send(obj.agentUpdate.buf.slice(0, len + 4)); } // Command 14, mesh agent next data block

                            if (len < agentUpdateBlockSize) {
                                //console.log("Agent update sent");
                                obj.send(obj.common.ShortToStr(13) + obj.common.ShortToStr(0) + obj.common.hex2rstr(obj.agentInfo.hash)); // Command 13, end mesh agent download, send agent SHA256 hash
                                obj.fs.close(obj.agentUpdate.fd);
                                obj.agentUpdate = null;
                            }
                        }
                    }
                }
            }
            else if (cmdid == 15) { // MeshCommand_AgentTag
                ChangeAgentTag(msg.substring(2));
            }
        }
        else if (obj.authenticated < 2) { // We are not authenticated
            var cmd = obj.common.ReadShort(msg, 0);
            if (cmd == 1) {
                // Agent authentication request
                if ((msg.length != 66) || ((obj.receivedCommands & 1) != 0)) return;
                obj.receivedCommands += 1; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Check that the server hash matches out own web certificate hash
                if (obj.parent.webCertificatHash != msg.substring(2, 34)) { obj.close(); return; }

                // Use our server private key to sign the ServerHash + AgentNonce + ServerNonce
                var privateKey = obj.forge.pki.privateKeyFromPem(obj.parent.certificates.agent.key);
                var md = obj.forge.md.sha256.create();
                md.update(msg.substring(2), 'binary');
                md.update(obj.nonce, 'binary');
                obj.agentnonce = msg.substring(34);

                // Send back our certificate + signature
                obj.send(obj.common.ShortToStr(2) + obj.common.ShortToStr(parent.agentCertificatAsn1.length) + parent.agentCertificatAsn1 + privateKey.sign(md)); // Command 2, certificate + signature

                // Check the agent signature if we can
                if (obj.unauthsign != undefined) {
                    if (processAgentSignature(obj.unauthsign) == false) { disonnect(); return; } else { completeAgentConnection(); }
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
                if (obj.agentnonce == undefined) { obj.unauthsign = msg.substring(4 + certlen); } else { if (processAgentSignature(msg.substring(4 + certlen)) == false) { disonnect(); return; } }
                completeAgentConnection();
            }
            else if (cmd == 3) {
                // Agent meshid
                if ((msg.length < 56) || ((obj.receivedCommands & 4) != 0)) return;
                obj.receivedCommands += 4; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Set the meshid
                obj.agentInfo = {};
                obj.agentInfo.infoVersion = obj.common.ReadInt(msg, 2);
                obj.agentInfo.agentId = obj.common.ReadInt(msg, 6);
                obj.agentInfo.agentVersion = obj.common.ReadInt(msg, 10);
                obj.agentInfo.platformType = obj.common.ReadInt(msg, 14);
                obj.meshid = obj.common.rstr2hex(msg.substring(18, 50)).toUpperCase();
                obj.agentInfo.capabilities = obj.common.ReadInt(msg, 50);
                var computerNameLen = obj.common.ReadShort(msg, 54);
                obj.agentInfo.computerName = msg.substring(56, 56 + computerNameLen);
                obj.dbMeshKey = 'mesh/' + obj.domain.id + '/' + obj.meshid;
                completeAgentConnection();
            }
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { console.log(err); });

    // If the mesh agent web socket is closed, clean up.
    ws.on('close', function (req) { obj.parent.parent.debug(1, 'Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); obj.close(0); });
    // obj.ws._socket._parent.on('close', function (req) { obj.parent.parent.debug(1, 'Agent TCP disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); });

    // Start authenticate the mesh agent by sending a auth nonce & server TLS cert hash.
    // Send 256 bits SHA256 hash of TLS cert public key + 256 bits nonce
    obj.nonce = obj.forge.random.getBytesSync(32);
    obj.send(obj.common.ShortToStr(1) + parent.webCertificatHash + obj.nonce); // Command 1, hash + nonce

    // Once we get all the information about an agent, run this to hook everything up to the server
    function completeAgentConnection() {
        if (obj.authenticated =! 1 || obj.meshid == null) return;
        // Check that the mesh exists
        obj.db.Get(obj.dbMeshKey, function (err, meshes) {
            if (meshes.length == 0) { console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddr + ').'); return; } // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.
            var mesh = meshes[0];
            if (mesh.mtype != 2) { console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddr + ').'); return; } // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.

            // Check that the node exists
            obj.db.Get(obj.dbNodeKey, function (err, nodes) {
                var device;

                // Mark when we connected to this agent
                obj.connectTime = Date.now();

                if (nodes.length == 0) {
                    // This node does not exist, create it.
                    device = { type: 'node', mtype: mesh.mtype, _id: obj.dbNodeKey, icon: obj.agentInfo.platformType, meshid: obj.dbMeshKey, name: obj.agentInfo.computerName, domain: domain.id, agent: { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }, host: null };
                    obj.db.Set(device);

                    // Event the new node
                    var change = 'Added device ' + obj.agentInfo.computerName + ' to mesh ' + mesh.name;
                    obj.parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'addnode', node: device, msg: change, domain: domain.id })
                } else {
                    // Device already exists, look if changes has occured
                    device = nodes[0];
                    if (device.agent == undefined) {
                        device.agent = { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }; change = 1;
                    } else {
                        var changes = [], change = 0;
                        if (device.agent.ver != obj.agentInfo.agentVersion) { device.agent.ver = obj.agentInfo.agentVersion; change = 1; changes.push('agent version'); }
                        if (device.agent.id != obj.agentInfo.agentId) { device.agent.id = obj.agentInfo.agentId; change = 1; changes.push('agent type'); }
                        if ((device.agent.caps & 24) != (obj.agentInfo.capabilities & 24)) { device.agent.caps = obj.agentInfo.capabilities; change = 1; changes.push('agent capabilities'); } // If agent console or javascript support changes, update capabilities
                        if (device.meshid != obj.dbMeshKey) { device.meshid = obj.dbMeshKey; change = 1; changes.push('agent meshid'); } // TODO: If the meshid changes, we need to event a device add/remove on both meshes
                        if (change == 1) {
                            obj.db.Set(device);

                            // Event the node change
                            var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Changed device ' + device.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ') };
                            var device2 = obj.common.Clone(device);
                            if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                            event.node = device;
                            obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                        }
                    }
                }

                // Check if this agent is already connected
                var dupAgent = obj.parent.wsagents[obj.dbNodeKey];
                obj.parent.wsagents[obj.dbNodeKey] = obj;
                if (dupAgent) {
                    // Close the duplicate agent
                    obj.parent.parent.debug(1, 'Duplicate agent ' + obj.nodeid + ' (' + obj.remoteaddr + ')');
                    dupAgent.close();
                } else {
                    // Indicate the agent is connected
                    obj.parent.parent.SetConnectivityState(obj.dbMeshKey, obj.dbNodeKey, obj.connectTime, 1, 1);
                }

                // We are done, ready to communicate with this agent
                obj.authenticated = 2;

                // Command 4, inform mesh agent that it's authenticated.
                obj.send(obj.common.ShortToStr(4));

                // Check the mesh core, if the agent is capable of running one
                if ((obj.agentInfo.capabilities & 16) != 0) { obj.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); } // Command 11, ask for mesh core hash.

                // Check if we need to make an native update check
                obj.agentInfo = obj.parent.parent.meshAgentBinaries[obj.agentInfo.agentId];
                if ((obj.agentInfo != undefined) && (obj.agentInfo.update == true)) { obj.send(obj.common.ShortToStr(12) + obj.common.ShortToStr(0)); } // Ask the agent for it's executable binary hash

                // Check if we already have IP location information for this node
                obj.db.Get('iploc_' + obj.remoteaddr, function (err, iplocs) {
                    if (iplocs.length == 1) {
                        // We have a location in the database for this remote IP
                        var iploc = nodes[0], x = {};
                        x.publicip = iploc.ip;
                        x.iploc = iploc.loc + ',' + (Math.floor((new Date(iploc.date)) / 1000));
                        ChangeAgentLocationInfo(x);
                    } else {
                        // Check if we need to ask for the IP location
                        var doIpLocation = 0;
                        if (device.iploc == null) {
                            doIpLocation = 1;
                        } else {
                            var loc = device.iploc.split(',');
                            if (loc.length < 3) {
                                doIpLocation = 2;
                            } else {
                                var t = new Date((parseFloat(loc[2]) * 1000)), now = Date.now();
                                t.setDate(t.getDate() + 20);
                                if (t < now) { doIpLocation = 3; }
                            }
                        }

                        // If we need to ask for IP location, see if we have the quota to do it.
                        if (doIpLocation > 0) {
                            obj.db.getValueOfTheDay('ipLocationRequestLimitor', 10, function (ipLocationLimitor) {
                                if (ipLocationLimitor.value > 0) {
                                    ipLocationLimitor.value--;
                                    obj.db.Set(ipLocationLimitor);
                                    obj.send(JSON.stringify({ action: 'iplocation' }));
                                }
                            });
                        }
                    }
                });
            });
        });
    }
    
    // Verify the agent signature
    function processAgentSignature(msg) {
        var md = obj.forge.md.sha256.create(); // TODO: Switch this to SHA256 on node instead of forge.
        md.update(obj.parent.webCertificatHash, 'binary');
        md.update(obj.nonce, 'binary');
        md.update(obj.agentnonce, 'binary');
        if (obj.unauth.nodeCert.publicKey.verify(md.digest().bytes(), msg) == false) return false;

        // Connection is a success, clean up
        obj.nodeid = obj.unauth.nodeid.toUpperCase();
        obj.dbNodeKey = 'node/' + domain.id + '/' + obj.nodeid;
        delete obj.nonce;
        delete obj.agentnonce;
        delete obj.unauth;
        if (obj.unauthsign) delete obj.unauthsign;
        obj.parent.parent.debug(1, 'Verified agent connection to ' + obj.nodeid + ' (' + obj.remoteaddr + ').');
        obj.authenticated = 1;
        return true;
    }

    // Process incoming agent JSON data
    function processAgentData(msg) {
        var str = msg.toString('utf8');
        if (str[0] == '{') {
            try { command = JSON.parse(str) } catch (e) { console.log('Unable to parse JSON (' + obj.remoteaddr + ').'); return; } // If the command can't be parsed, ignore it.
            switch (command.action) {
                case 'msg':
                    {
                        // Route a message.
                        // If this command has a sessionid, that is the target.
                        if (command.sessionid != undefined) {
                            var splitsessionid = command.sessionid.split('/');
                            // Check that we are in the same domain and the user has rights over this node.
                            if ((splitsessionid[0] == 'user') && (splitsessionid[1] == domain.id)) {
                                // Check if this user has rights to get this message
                                //if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 16) == 0)) return; // TODO!!!!!!!!!!!!!!!!!!!!!
                                
                                // See if the session is connected
                                var ws = obj.parent.wssessions2[command.sessionid];
                                
                                // Go ahead and send this message to the target node
                                if (ws != undefined) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.sessionid;       // Remove the sessionid, since we are sending to that sessionid, so it's implyed.
                                    ws.send(JSON.stringify(command));
                                }
                            }
                        } else if (command.userid != undefined) { // If this command has a userid, that is the target.
                            var splituserid = command.userid.split('/');
                            // Check that we are in the same domain and the user has rights over this node.
                            if ((splituserid[0] == 'user') && (splituserid[1] == domain.id)) {
                                // Check if this user has rights to get this message
                                //if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 16) == 0)) return; // TODO!!!!!!!!!!!!!!!!!!!!!

                                // See if the session is connected
                                var sessions = obj.parent.wssessions[command.userid];

                                // Go ahead and send this message to the target node
                                if (sessions != undefined) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.userid;          // Remove the userid, since we are sending to that userid, so it's implyed.
                                    for (var i in sessions) { sessions[i].send(JSON.stringify(command)); }
                                }
                            }
                        } else { // Route this command to the mesh
                            for (var userid in obj.parent.wssessions) { // Find all connected users for this mesh and send the message
                                var user = obj.parent.users[userid];
                                if (user) {
                                    var rights = user.links[obj.dbMeshKey];
                                    if (rights != undefined) { // TODO: Look at what rights are needed for message routing
                                        command.nodeid = obj.dbNodeKey;
                                        var sessions = obj.parent.wssessions[userid];
                                        for (var i in sessions) { sessions[i].send(JSON.stringify(command)); }
                                    }
                                }
                            }
                        }
                        break;
                    }
                case 'coreinfo':
                    {
                        // Sent by the agent to update agent information
                        ChangeAgentCoreInfo(command);
                        break;
                    }
                case 'netinfo':
                    {
                        // Sent by the agent to update agent network interface information
                        delete command.action;
                        command.updateTime = Date.now();
                        command._id = 'if' + obj.dbNodeKey;
                        command.type = 'ifinfo';
                        obj.db.Set(command);

                        // Event the node interface information change
                        obj.parent.parent.DispatchEvent(['*', obj.meshid], obj, { action: 'ifchange', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 });

                        break;
                    }
                case 'iplocation':
                    {
                        // Sent by the agent to update location information
                        console.log(command);
                        if ((command.type == 'publicip') && (command.value != null) && (typeof command.value == 'object') && (command.value.ip) && (command.value.loc)) {
                            var x = {};
                            x.publicip = command.value.ip;
                            x.iploc = command.value.loc + ',' + (Math.floor(Date.now() / 1000) );
                            ChangeAgentLocationInfo(x);
                            command.value._id = 'iploc_' + command.value.ip;
                            command.value.type = 'iploc';
                            command.value.date = Date.now();
                            obj.db.Set(command.value); // Store the IP to location data in the database
                            // Sample Value: { ip: '192.55.64.246', city: 'Hillsboro', region: 'Oregon', country: 'US', loc: '45.4443,-122.9663', org: 'AS4983 Intel Corporation', postal: '97123' }
                        }
                        break;
                    }
            }
        }
    }

    // Change the current core information string and event it
    function ChangeAgentCoreInfo(command) {
        if ((command == undefined) || (command == null)) return; // Safety, should never happen.

        // Check capabilities value
        if (command.caps == undefined || command.caps == null) { command.caps = 0; } else { if (typeof command.caps != 'number') command.caps = 0; }

        // Check that the mesh exists
        obj.db.Get(obj.dbMeshKey, function (err, meshes) {
            if (meshes.length != 1) return;
            var mesh = meshes[0];
            // Get the node and change it if needed
            obj.db.Get(obj.dbNodeKey, function (err, nodes) {
                if (nodes.length != 1) return;
                var device = nodes[0];
                if (device.agent) {
                    var changes = [], change = 0;

                    // Check if anything changes
                    if (device.agent.core != command.value) { if ((command.value == null) && (device.agent.core != undefined)) { delete device.agent.core; } else { device.agent.core = command.value; } change = 1; changes.push('agent core'); }
                    if ((device.agent.caps & 0xFFFFFFE7) != (command.caps & 0xFFFFFFE7)) { device.agent.caps = ((device.agent.caps & 24) + (command.caps & 0xFFFFFFE7)); change = 1; changes.push('agent capabilities'); } // Allow Javascript on the agent to change all capabilities except console and javascript support
                    if (command.intelamt) {
                        if (!device.intelamt) { device.intelamt = {}; }
                        if (device.intelamt.ver != command.intelamt.ver) { device.intelamt.ver = command.intelamt.ver; change = 1; changes.push('AMT version'); }
                        if (device.intelamt.state != command.intelamt.state) { device.intelamt.state = command.intelamt.state; change = 1; changes.push('AMT state'); }
                        if (device.intelamt.flags != command.intelamt.flags) { device.intelamt.flags = command.intelamt.flags; change = 1; changes.push('AMT flags'); }
                        if (device.intelamt.host != command.intelamt.host) { device.intelamt.host = command.intelamt.host; change = 1; changes.push('AMT host'); }
                    }
                    if (mesh.mtype == 2) {
                        if (device.host != obj.remoteaddr) { device.host = obj.remoteaddr; change = 1; changes.push('host'); }
                        // TODO: Check that the agent has an interface that is the same as the one we got this websocket connection on. Only set if we have a match.
                    }

                    // If there are changes, save and event
                    if (change == 1) {
                        obj.db.Set(device);

                        // Event the node change
                        var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Changed device ' + device.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ') };
                        var device2 = obj.common.Clone(device);
                        if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                        event.node = device;
                        obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                    }
                }
            });
        });
    }

    // Change the current core information string and event it
    function ChangeAgentLocationInfo(command) {
        if ((command == undefined) || (command == null)) return; // Safety, should never happen.

        // Check that the mesh exists
        obj.db.Get(obj.dbMeshKey, function (err, meshes) {
            if (meshes.length != 1) return;
            var mesh = meshes[0];
            // Get the node and change it if needed
            obj.db.Get(obj.dbNodeKey, function (err, nodes) {
                if (nodes.length != 1) return;
                var device = nodes[0];
                if (device.agent) {
                    var changes = [], change = 0;

                    // Check if anything changes
                    if ((command.publicip) && (device.publicip != command.publicip)) { device.publicip = command.publicip; change = 1; changes.push('public ip'); }
                    if ((command.iploc) && (device.iploc != command.iploc)) { device.iploc = command.iploc; change = 1; changes.push('ip location'); }

                    // If there are changes, save and event
                    if (change == 1) {
                        obj.db.Set(device);

                        // Event the node change
                        var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Changed device ' + device.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ') };
                        var device2 = obj.common.Clone(device);
                        if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                        event.node = device;
                        obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                    }
                }
            });
        });
    }

    // Update the mesh agent tab in the database
    function ChangeAgentTag(tag) {
        if (tag.length == 0) { tag = undefined; }
        // Get the node and change it if needed
        obj.db.Get(obj.dbNodeKey, function (err, nodes) {
            if (nodes.length != 1) return;
            var device = nodes[0];
            if (device.agent) {
                if (device.agent.tag != tag) {
                    device.agent.tag = tag;
                    obj.db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 };
                    var device2 = obj.common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }
        });
    }

    return obj;
}
