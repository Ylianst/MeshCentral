/**
* @description MeshCentral MeshAgent communication module
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshAgent = function (parent, db, ws, req, args, domain) {
    const forge = parent.parent.certificateOperations.forge;
    const common = parent.parent.common;
    parent.agentStats.createMeshAgentCount++;
    parent.parent.debug('agent', 'New agent at ' + req.clientIp + ':' + ws._socket.remotePort);

    var obj = {};
    obj.domain = domain;
    obj.authenticated = 0;
    obj.receivedCommands = 0;
    obj.agentCoreCheck = 0;
    obj.remoteaddr = req.clientIp;
    obj.remoteaddrport = obj.remoteaddr + ':' + ws._socket.remotePort;
    obj.nonce = parent.crypto.randomBytes(48).toString('binary');
    //ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive, 4 minutes
    if (args.agentidletimeout != 0) { ws._socket.setTimeout(args.agentidletimeout, function () { obj.close(1); }); } // Inactivity timeout of 2:30 minutes, by default agent will WebSocket ping every 2 minutes and server will pong back.
    //obj.nodeid = null;
    //obj.meshid = null;
    //obj.dbNodeKey = null;
    //obj.dbMeshKey = null;
    //obj.connectTime = null;
    //obj.agentInfo = null;

    ws._socket.bytesReadEx = 0;
    ws._socket.bytesWrittenEx = 0;

    // Perform data accounting
    function dataAccounting() {
        parent.trafficStats.AgentCtrlIn += (ws._socket.bytesRead - ws._socket.bytesReadEx);
        parent.trafficStats.AgentCtrlOut += (ws._socket.bytesWritten - ws._socket.bytesWrittenEx);
        ws._socket.bytesReadEx = ws._socket.bytesRead;
        ws._socket.bytesWrittenEx = ws._socket.bytesWritten;
    }

    // Send a message to the mesh agent
    obj.send = function (data, func) { try { if (typeof data == 'string') { ws.send(Buffer.from(data), func); } else { ws.send(data, func); } } catch (e) { } };
    obj.sendBinary = function (data, func) { try { if (typeof data == 'string') { ws.send(Buffer.from(data, 'binary'), func); } else { ws.send(data, func); } } catch (e) { } };

    // Disconnect this agent
    obj.close = function (arg) {
        dataAccounting();

        if ((arg == 1) || (arg == null)) { try { ws.close(); if (obj.nodeid != null) { parent.parent.debug('agent', 'Soft disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); } } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { 
            try { 
                if (ws._socket._parent != null)
                    ws._socket._parent.end();
                else
                    ws._socket.end();
                
                if (obj.nodeid != null) { 
                    parent.parent.debug('agent', 'Hard disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); 
                }
            } catch (e) { console.log(e); }
        }
        // If arg == 2, hard close, close the TCP socket
        // If arg == 3, don't communicate with this agent anymore, but don't disconnect (Duplicate agent).

        // Stop any current self-share
        if (obj.guestSharing === true) { removeGuestSharing(); }

        // Remove this agent from the webserver list
        if (parent.wsagents[obj.dbNodeKey] == obj) {
            delete parent.wsagents[obj.dbNodeKey];
            parent.parent.ClearConnectivityState(obj.dbMeshKey, obj.dbNodeKey, 1, null, { remoteaddrport: obj.remoteaddrport, name: obj.name });
        }

        // Remove this agent from the list of agents with bad web certificates
        if (obj.badWebCert) { delete parent.wsagentsWithBadWebCerts[obj.badWebCert]; }

        // Get the current mesh
        const mesh = parent.meshes[obj.dbMeshKey];

        // If this is a temporary or recovery agent, or all devices in this group are temporary, remove the agent (0x20 = Temporary, 0x40 = Recovery)
        if (((obj.agentInfo) && (obj.agentInfo.capabilities) && ((obj.agentInfo.capabilities & 0x20) || (obj.agentInfo.capabilities & 0x40))) || ((mesh) && (mesh.flags) && (mesh.flags & 1))) {
            // Delete this node including network interface information and events
            db.Remove(obj.dbNodeKey);                                 // Remove node with that id
            db.Remove('if' + obj.dbNodeKey);                          // Remove interface information
            db.Remove('nt' + obj.dbNodeKey);                          // Remove notes
            db.Remove('lc' + obj.dbNodeKey);                          // Remove last connect time
            db.Remove('si' + obj.dbNodeKey);                          // Remove system information
            db.Remove('al' + obj.dbNodeKey);                          // Remove error log last time
            if (db.RemoveSMBIOS) { db.RemoveSMBIOS(obj.dbNodeKey); }  // Remove SMBios data
            db.RemoveAllNodeEvents(obj.dbNodeKey);                    // Remove all events for this node
            db.removeAllPowerEventsForNode(obj.dbNodeKey);            // Remove all power events for this node

            // Event node deletion
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, { etype: 'node', action: 'removenode', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 });

            // Disconnect all connections if needed
            const state = parent.parent.GetConnectivityState(obj.dbNodeKey);
            if ((state != null) && (state.connectivity != null)) {
                if ((state.connectivity & 1) != 0) { parent.wsagents[obj.dbNodeKey].close(); } // Disconnect mesh agent
                if ((state.connectivity & 2) != 0) { parent.parent.mpsserver.closeAllForNode(obj.dbNodeKey); } // Disconnect CIRA connection
            }
        }

        // Set this agent as no longer authenticated
        obj.authenticated = -1;

        // If we where updating the agent using native method, clean that up.
        if (obj.agentUpdate != null) {
            if (obj.agentUpdate.fd) { try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { } }
            parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
            delete obj.agentUpdate.buf;
            delete obj.agentUpdate;
        }

        // If we where updating the agent meshcore method, clean that up.
        if (obj.agentCoreUpdateTaskId != null) {
            parent.parent.taskLimiter.completed(obj.agentCoreUpdateTaskId);
            delete obj.agentCoreUpdateTaskId;
        }

        // Perform timer cleanup
        if (obj.pingtimer) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Perform aggressive cleanup
        delete obj.name;
        delete obj.nonce;
        delete obj.nodeid;
        delete obj.unauth;
        delete obj.remoteaddr;
        delete obj.remoteaddrport;
        delete obj.meshid;
        delete obj.connectTime;
        delete obj.agentInfo;
        delete obj.agentExeInfo;
        ws.removeAllListeners(['message', 'close', 'error']);
    };

    // When data is received from the mesh agent web socket
    ws.on('message', function (msg) {
        dataAccounting();
        if (msg.length < 2) return;
        if (typeof msg == 'object') { msg = msg.toString('binary'); } // TODO: Could change this entire method to use Buffer instead of binary string
        if (obj.authenticated == 2) { // We are authenticated
            if ((obj.agentUpdate == null) && (msg.charCodeAt(0) == 123)) { processAgentData(msg); } // Only process JSON messages if meshagent update is not in progress
            if (msg.length < 2) return;
            const cmdid = common.ReadShort(msg, 0);
            if (cmdid == 11) { // MeshCommand_CoreModuleHash
                if (msg.length == 4) { ChangeAgentCoreInfo({ 'caps': 0 }); } // If the agent indicated that no core is running, clear the core information string.
                // Mesh core hash, sent by agent with the hash of the current mesh core.

                // If we are performing an agent update, don't update the core.
                if (obj.agentUpdate != null) { return; }

                // If we are using a custom core, don't try to update it.
                if (obj.agentCoreCheck == 1000) {
                    obj.sendBinary(common.ShortToStr(16) + common.ShortToStr(0)); // MeshCommand_CoreOk. Indicates to the agent that the core is ok. Start it if it's not already started.
                    agentCoreIsStable();
                    return;
                }

                // Get the current meshcore hash
                const agentMeshCoreHash = (msg.length == 52) ? msg.substring(4, 52) : null;

                // If the agent indicates this is a custom core, we are done.
                if ((agentMeshCoreHash != null) && (agentMeshCoreHash == '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')) {
                    obj.agentCoreCheck = 0;
                    obj.sendBinary(common.ShortToStr(16) + common.ShortToStr(0)); // MeshCommand_CoreOk. Indicates to the agent that the core is ok. Start it if it's not already started.
                    agentCoreIsStable();
                    return;
                }

                // We need to check if the core is current. Figure out what core we need.
                var corename = null;
                if ((obj.agentInfo != null) && (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId] != null)) {
                    if ((obj.agentCoreCheck == 1001) || (obj.agentCoreUpdate == true)) {
                        // If the user asked, use the recovery core.
                        corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].rcore;
                    } else if (obj.agentCoreCheck == 1011) {
                        // If the user asked, use the tiny core.
                        corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].tcore;
                    } else if (obj.agentInfo.capabilities & 0x40) {
                        // If this is a recovery agent, use the agent recovery core.
                        corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].arcore;
                    } else {
                        // This is the normal core for this agent type.
                        corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].core;
                    }
                }

                // If we have a core, use it.
                if (corename != null) {
                    const meshcorehash = parent.parent.defaultMeshCoresHash[corename];
                    if (agentMeshCoreHash != meshcorehash) {
                        if ((obj.agentCoreCheck < 5) || (obj.agentCoreCheck == 1001) || (obj.agentCoreCheck == 1011) || (obj.agentCoreUpdate == true)) {
                            if (meshcorehash == null) {
                                // Clear the core
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0)); // MeshCommand_CoreModule, ask mesh agent to clear the core
                                parent.agentStats.clearingCoreCount++;
                                parent.parent.debug('agent', "Clearing core");
                            } else {
                                // Setup task limiter options, this system limits how many tasks can run at the same time to spread the server load.
                                var taskLimiterOptions = { hash: meshcorehash, core: parent.parent.defaultMeshCores[corename], name: corename };

                                // If the agent supports compression, sent the core compressed.
                                if ((obj.agentInfo.capabilities & 0x100) && (parent.parent.defaultMeshCoresDeflate[corename])) {
                                    args.core = parent.parent.defaultMeshCoresDeflate[corename];
                                }

                                // Update new core with task limiting so not to flood the server. This is a high priority task.
                                obj.agentCoreUpdatePending = true;
                                parent.parent.taskLimiter.launch(function (argument, taskid, taskLimiterQueue) {
                                    if (obj.authenticated == 2) {
                                        // Send the updated core.
                                        delete obj.agentCoreUpdatePending;
                                        obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + argument.hash + argument.core.toString('binary'), function () { parent.parent.taskLimiter.completed(taskid); }); // MeshCommand_CoreModule, start core update
                                        parent.agentStats.updatingCoreCount++;
                                        parent.parent.debug('agent', "Updating core " + argument.name);
                                    } else {
                                        // This agent is probably disconnected, nothing to do.
                                        parent.parent.taskLimiter.completed(taskid);
                                    }
                                }, taskLimiterOptions, 0);
                            }
                            obj.agentCoreCheck++;
                        }
                    } else {
                        obj.agentCoreCheck = 0;
                        obj.sendBinary(common.ShortToStr(16) + common.ShortToStr(0)); // MeshCommand_CoreOk. Indicates to the agent that the core is ok. Start it if it's not already started.
                        agentCoreIsStable(); // No updates needed, agent is ready to go.
                    }
                }

                /*
                // TODO: Check if we have a mesh specific core. If so, use that.
                var agentMeshCoreHash = null;
                if (msg.length == 52) { agentMeshCoreHash = msg.substring(4, 52); }
                if ((agentMeshCoreHash != parent.parent.defaultMeshCoreHash) && (agentMeshCoreHash != parent.parent.defaultMeshCoreNoMeiHash)) {
                    if (obj.agentCoreCheck < 5) { // This check is in place to avoid a looping core update.
                        if (parent.parent.defaultMeshCoreHash == null) {
                            // Update no core
                            obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0)); // Command 10, ask mesh agent to clear the core
                        } else {
                            // Update new core
                            if ((parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId] != null) && (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].amt == true)) {
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + parent.parent.defaultMeshCoreHash + parent.parent.defaultMeshCore); // Command 10, ask mesh agent to set the core (with MEI support)
                            } else {
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + parent.parent.defaultMeshCoreNoMeiHash + parent.parent.defaultMeshCoreNoMei); // Command 10, ask mesh agent to set the core (No MEI)
                            }
                        }
                        obj.agentCoreCheck++;
                    }
                } else {
                    obj.agentCoreCheck = 0;
                }
                */
            }
            else if (cmdid == 12) { // MeshCommand_AgentHash
                if ((msg.length == 52) && (obj.agentExeInfo != null) && (obj.agentExeInfo.update == true)) {
                    const agenthash = msg.substring(4);
                    const agentUpdateMethod = compareAgentBinaryHash(obj.agentExeInfo, agenthash);
                    if (agentUpdateMethod === 2) { // Use meshcore agent update system
                        // Send the recovery core to the agent, if the agent is capable of running one
                        if (((obj.agentInfo.capabilities & 16) != 0) && (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].core != null)) {
                            parent.agentStats.agentMeshCoreBinaryUpdate++;
                            obj.agentCoreUpdate = true;
                            obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0)); // Ask to clear the core
                            obj.sendBinary(common.ShortToStr(11) + common.ShortToStr(0)); // Ask for meshcore hash
                        }
                    } else if (agentUpdateMethod === 1) { // Use native agent update system
                        // Mesh agent update required, do it using task limiter so not to flood the network. Medium priority task.
                        parent.parent.taskLimiter.launch(function (argument, taskid, taskLimiterQueue) {
                            if (obj.authenticated != 2) { parent.parent.taskLimiter.completed(taskid); return; } // If agent disconnection, complete and exit now.
                            if (obj.nodeid != null) { parent.parent.debug('agent', "Agent update required, NodeID=0x" + obj.nodeid.substring(0, 16) + ', ' + obj.agentExeInfo.desc); }
                            parent.agentStats.agentBinaryUpdate++;
                            if ((obj.agentExeInfo.data == null) && (((obj.agentInfo.capabilities & 0x100) == 0) || (obj.agentExeInfo.zdata == null))) {
                                // Read the agent from disk
                                parent.fs.open(obj.agentExeInfo.path, 'r', function (err, fd) {
                                    if (obj.agentExeInfo == null) return; // Agent disconnected during this call.
                                    if (err) { parent.parent.debug('agentupdate', "ERROR: " + err); return console.error(err); }
                                    obj.agentUpdate = { ptr: 0, buf: Buffer.alloc(parent.parent.agentUpdateBlockSize + 4), fd: fd, taskid: taskid };

                                    // MeshCommand_CoreModule, ask mesh agent to clear the core.
                                    // The new core will only be sent after the agent updates.
                                    obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));

                                    // We got the agent file open on the server side, tell the agent we are sending an update ending with the SHA384 hash of the result
                                    //console.log("Agent update file open.");
                                    obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0)); // Command 13, start mesh agent download

                                    // Send the first mesh agent update data block
                                    obj.agentUpdate.buf[0] = 0;
                                    obj.agentUpdate.buf[1] = 14;
                                    obj.agentUpdate.buf[2] = 0;
                                    obj.agentUpdate.buf[3] = 1;
                                    parent.fs.read(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, parent.parent.agentUpdateBlockSize, obj.agentUpdate.ptr, function (err, bytesRead, buffer) {
                                        if (obj.agentUpdate == null) return;
                                        if ((err != null) || (bytesRead == 0)) {
                                            // Error reading the agent file, stop here.
                                            try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { }
                                            parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                            parent.parent.debug('agentupdate', "ERROR: Unable to read first block of agent binary from disk.");
                                            delete obj.agentUpdate.buf;
                                            delete obj.agentUpdate;
                                        } else {
                                            // Send the first block to the agent
                                            obj.agentUpdate.ptr += bytesRead;
                                            parent.parent.debug('agentupdate', "Sent first block of " + bytesRead + " bytes from disk.");
                                            obj.sendBinary(obj.agentUpdate.buf); // Command 14, mesh agent first data block
                                        }
                                    });
                                });
                            } else {
                                // Send the agent from RAM
                                obj.agentUpdate = { ptr: 0, buf: Buffer.alloc(parent.parent.agentUpdateBlockSize + 4), taskid: taskid };

                                // MeshCommand_CoreModule, ask mesh agent to clear the core.
                                // The new core will only be sent after the agent updates.
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));

                                // We got the agent file open on the server side, tell the agent we are sending an update ending with the SHA384 hash of the result
                                obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0)); // Command 13, start mesh agent download

                                // Send the first mesh agent update data block
                                obj.agentUpdate.buf[0] = 0;
                                obj.agentUpdate.buf[1] = 14;
                                obj.agentUpdate.buf[2] = 0;
                                obj.agentUpdate.buf[3] = 1;

                                // If agent supports compression, send the compressed agent if possible.
                                if ((obj.agentInfo.capabilities & 0x100) && (obj.agentExeInfo.zdata != null)) {
                                    // Send compressed data
                                    obj.agentUpdate.agentUpdateData = obj.agentExeInfo.zdata;
                                    obj.agentUpdate.agentUpdateHash = obj.agentExeInfo.zhash;
                                } else {
                                    // Send uncompressed data
                                    obj.agentUpdate.agentUpdateData = obj.agentExeInfo.data;
                                    obj.agentUpdate.agentUpdateHash = obj.agentExeInfo.hash;
                                }

                                const len = Math.min(parent.parent.agentUpdateBlockSize, obj.agentUpdate.agentUpdateData.length - obj.agentUpdate.ptr);
                                if (len > 0) {
                                    // Send the first block
                                    obj.agentUpdate.agentUpdateData.copy(obj.agentUpdate.buf, 4, obj.agentUpdate.ptr, obj.agentUpdate.ptr + len);
                                    obj.agentUpdate.ptr += len;
                                    obj.sendBinary(obj.agentUpdate.buf); // Command 14, mesh agent first data block
                                    parent.parent.debug('agentupdate', "Sent first block of " + len + " bytes from RAM.");
                                } else {
                                    // Error
                                    parent.parent.debug('agentupdate', "ERROR: Len of " + len + " is invalid.");
                                    parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                    delete obj.agentUpdate.buf;
                                    delete obj.agentUpdate;
                                }
                            }
                        }, null, 1);

                    } else {
                        // Check the mesh core, if the agent is capable of running one
                        if (((obj.agentInfo.capabilities & 16) != 0) && (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].core != null)) {
                            obj.sendBinary(common.ShortToStr(11) + common.ShortToStr(0)); // Command 11, ask for mesh core hash.
                        }
                    }
                }
            }
            else if (cmdid == 14) { // MeshCommand_AgentBinaryBlock
                if ((msg.length == 4) && (obj.agentUpdate != null)) {
                    const status = common.ReadShort(msg, 2);
                    if (status == 1) {
                        if (obj.agentExeInfo.data == null) {
                            // Read the agent from disk
                            parent.fs.read(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, parent.parent.agentUpdateBlockSize, obj.agentUpdate.ptr, function (err, bytesRead, buffer) {
                                if ((obj.agentExeInfo == null) || (obj.agentUpdate == null)) return; // Agent disconnected during this async call.
                                if ((err != null) || (bytesRead < 0)) {
                                    // Error reading the agent file, stop here.
                                    parent.parent.debug('agentupdate', "ERROR: Unable to read agent #" + obj.agentExeInfo.id + " binary from disk.");
                                    try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { }
                                    parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                    delete obj.agentUpdate.buf;
                                    delete obj.agentUpdate;
                                } else {
                                    // Send the next block to the agent
                                    parent.parent.debug('agentupdate', "Sending disk agent #" + obj.agentExeInfo.id + " block, ptr=" + obj.agentUpdate.ptr + ", len=" + bytesRead + ".");
                                    obj.agentUpdate.ptr += bytesRead;
                                    if (bytesRead == parent.parent.agentUpdateBlockSize) { obj.sendBinary(obj.agentUpdate.buf); } else { obj.sendBinary(obj.agentUpdate.buf.slice(0, bytesRead + 4)); } // Command 14, mesh agent next data block
                                    if ((bytesRead < parent.parent.agentUpdateBlockSize) || (obj.agentUpdate.ptr == obj.agentExeInfo.size)) {
                                        parent.parent.debug('agentupdate', "Completed agent #" + obj.agentExeInfo.id + " update from disk, ptr=" + obj.agentUpdate.ptr + ".");
                                        obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0) + obj.agentExeInfo.hash); // Command 13, end mesh agent download, send agent SHA384 hash
                                        try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { }
                                        parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                        delete obj.agentUpdate.buf;
                                        delete obj.agentUpdate;
                                    }
                                }
                            });
                        } else {
                            // Send the agent from RAM
                            const len = Math.min(parent.parent.agentUpdateBlockSize, obj.agentUpdate.agentUpdateData.length - obj.agentUpdate.ptr);
                            if (len > 0) {
                                obj.agentUpdate.agentUpdateData.copy(obj.agentUpdate.buf, 4, obj.agentUpdate.ptr, obj.agentUpdate.ptr + len);
                                if (len == parent.parent.agentUpdateBlockSize) { obj.sendBinary(obj.agentUpdate.buf); } else { obj.sendBinary(obj.agentUpdate.buf.slice(0, len + 4)); } // Command 14, mesh agent next data block
                                parent.parent.debug('agentupdate', "Sending RAM agent #" + obj.agentExeInfo.id + " block, ptr=" + obj.agentUpdate.ptr + ", len=" + len + ".");
                                obj.agentUpdate.ptr += len;
                            }

                            if (obj.agentUpdate.ptr == obj.agentUpdate.agentUpdateData.length) {
                                parent.parent.debug('agentupdate', "Completed agent #" + obj.agentExeInfo.id + " update from RAM, ptr=" + obj.agentUpdate.ptr + ".");
                                obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0) + obj.agentUpdate.agentUpdateHash); // Command 13, end mesh agent download, send agent SHA384 hash
                                parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                delete obj.agentUpdate.buf;
                                delete obj.agentUpdate;
                            }
                        }
                    }
                }
            }
            else if (cmdid == 15) { // MeshCommand_AgentTag
                var tag = msg.substring(2);
                while (tag.charCodeAt(tag.length - 1) == 0) { tag = tag.substring(0, tag.length - 1); } // Remove end-of-line zeros.
                ChangeAgentTag(tag);
            }
        } else if (obj.authenticated < 2) { // We are not authenticated
            // Check if this is a un-authenticated JSON
            if (msg.charCodeAt(0) == 123) {
                var str = msg.toString('utf8'), command = null;
                if (str[0] == '{') {
                    try { command = JSON.parse(str); } catch (ex) { } // If the command can't be parsed, ignore it.
                    if ((command != null) && (command.action === 'agentName') && (typeof command.value == 'string') && (command.value.length > 0) && (command.value.length < 256)) { obj.agentName = command.value; }
                }
                return;
            }
            const cmd = common.ReadShort(msg, 0);
            if (cmd == 1) {
                // Agent authentication request
                if ((msg.length != 98) || ((obj.receivedCommands & 1) != 0)) return;
                obj.receivedCommands += 1; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                if (isIgnoreHashCheck()) {
                    // Send the agent web hash back to the agent
                    // Send 384 bits SHA384 hash of TLS cert + 384 bits nonce
                    obj.sendBinary(common.ShortToStr(1) + msg.substring(2, 50) + obj.nonce); // Command 1, hash + nonce. Use the web hash given by the agent.
                } else {
                    // Check that the server hash matches our own web certificate hash (SHA384)
                    obj.agentSeenCerthash = msg.substring(2, 50);
                    if ((getWebCertHash(domain) != obj.agentSeenCerthash) && (getWebCertFullHash(domain) != obj.agentSeenCerthash) && (parent.defaultWebCertificateHash != obj.agentSeenCerthash) && (parent.defaultWebCertificateFullHash != obj.agentSeenCerthash)) {
                        if (parent.parent.supportsProxyCertificatesRequest !== false) {
                            obj.badWebCert = Buffer.from(parent.crypto.randomBytes(16), 'binary').toString('base64');
                            parent.wsagentsWithBadWebCerts[obj.badWebCert] = obj; // Add this agent to the list of of agents with bad web certificates.
                            parent.parent.updateProxyCertificates(false);
                        }
                        parent.agentStats.agentBadWebCertHashCount++;
                        parent.setAgentIssue(obj, "BadWebCertHash: " + Buffer.from(msg.substring(2, 50), 'binary').toString('hex'));
                        parent.parent.debug('agent', 'Agent bad web cert hash (Agent:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex').substring(0, 10)) + ' != Server:' + (Buffer.from(getWebCertHash(domain), 'binary').toString('hex').substring(0, 10)) + ' or ' + (Buffer.from(getWebCertFullHash(domain), 'binary').toString('hex').substring(0, 10)) + '), holding connection (' + obj.remoteaddrport + ').');
                        parent.parent.debug('agent', 'Agent reported web cert hash:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex')) + '.');
                        console.log('Agent bad web cert hash (Agent:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex').substring(0, 10)) + ' != Server:' + (Buffer.from(getWebCertHash(domain), 'binary').toString('hex').substring(0, 10)) + ' or ' + (Buffer.from(getWebCertFullHash(domain), 'binary').toString('hex').substring(0, 10)) + '), holding connection (' + obj.remoteaddrport + ').');
                        console.log('Agent reported web cert hash:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex')) + '.');
                        delete obj.agentSeenCerthash;
                        return;
                    } else {
                        // The hash matched one of the acceptable values, send the agent web hash back to the agent
                        // Send 384 bits SHA384 hash of TLS cert + 384 bits nonce
                        // Command 1, hash + nonce. Use the web hash given by the agent.
                        obj.sendBinary(common.ShortToStr(1) + obj.agentSeenCerthash + obj.nonce);
                    }
                }

                // Use our server private key to sign the ServerHash + AgentNonce + ServerNonce
                obj.agentnonce = msg.substring(50, 98);

                // Check if we got the agent auth confirmation
                if ((obj.receivedCommands & 8) == 0) {
                    // If we did not get an indication that the agent already validated this server, send the server signature.
                    if (obj.useSwarmCert == true) {
                        // Perform the hash signature using older swarm server certificate
                        parent.parent.certificateOperations.acceleratorPerformSignature(1, msg.substring(2) + obj.nonce, null, function (tag, signature) {
                            // Send back our certificate + signature
                            obj.sendBinary(common.ShortToStr(2) + common.ShortToStr(parent.swarmCertificateAsn1.length) + parent.swarmCertificateAsn1 + signature); // Command 2, certificate + signature
                        });
                    } else {
                        // Perform the hash signature using the server agent certificate
                        parent.parent.certificateOperations.acceleratorPerformSignature(0, msg.substring(2) + obj.nonce, null, function (tag, signature) {
                            // Send back our certificate + signature
                            obj.sendBinary(common.ShortToStr(2) + common.ShortToStr(parent.agentCertificateAsn1.length) + parent.agentCertificateAsn1 + signature); // Command 2, certificate + signature
                        });
                    }
                }

                // Check the agent signature if we can
                if (obj.unauthsign != null) {
                    if (processAgentSignature(obj.unauthsign) == false) {
                        parent.agentStats.agentBadSignature1Count++;
                        parent.setAgentIssue(obj, "BadSignature1");
                        parent.parent.debug('agent', 'Agent connected with bad signature, holding connection (' + obj.remoteaddrport + ').');
                        console.log('Agent connected with bad signature, holding connection (' + obj.remoteaddrport + ').'); return;
                    } else { completeAgentConnection(); }
                }
            }
            else if (cmd == 2) {
                // Agent certificate
                if ((msg.length < 4) || ((obj.receivedCommands & 2) != 0)) return;
                obj.receivedCommands += 2; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Decode the certificate
                const certlen = common.ReadShort(msg, 2);
                obj.unauth = {};
                try { obj.unauth.nodeid = Buffer.from(forge.pki.getPublicKeyFingerprint(forge.pki.certificateFromAsn1(forge.asn1.fromDer(msg.substring(4, 4 + certlen))).publicKey, { md: forge.md.sha384.create() }).data, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); } catch (ex) { console.log(ex); parent.parent.debug('agent', ex); return; }
                obj.unauth.nodeCertPem = '-----BEGIN CERTIFICATE-----\r\n' + Buffer.from(msg.substring(4, 4 + certlen), 'binary').toString('base64') + '\r\n-----END CERTIFICATE-----';

                // Check the agent signature if we can
                if (obj.agentnonce == null) { obj.unauthsign = msg.substring(4 + certlen); } else {
                    if (processAgentSignature(msg.substring(4 + certlen)) == false) {
                        parent.agentStats.agentBadSignature2Count++;
                        parent.setAgentIssue(obj, "BadSignature2");
                        parent.parent.debug('agent', 'Agent connected with bad signature, holding connection (' + obj.remoteaddrport + ').');
                        console.log('Agent connected with bad signature, holding connection (' + obj.remoteaddrport + ').'); return;
                    }
                }
                completeAgentConnection();
            }
            else if (cmd == 3) {
                // Agent meshid
                if ((msg.length < 70) || ((obj.receivedCommands & 4) != 0)) return;
                obj.receivedCommands += 4; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Set the meshid
                obj.agentInfo = {};
                obj.agentInfo.infoVersion = common.ReadInt(msg, 2);
                obj.agentInfo.agentId = common.ReadInt(msg, 6);
                obj.agentInfo.agentVersion = common.ReadInt(msg, 10);
                obj.agentInfo.platformType = common.ReadInt(msg, 14);
                if (obj.agentInfo.platformType > 8 || obj.agentInfo.platformType < 1) { obj.agentInfo.platformType = 1; }
                if (msg.substring(50, 66) == '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0') {
                    obj.meshid = Buffer.from(msg.substring(18, 50), 'binary').toString('hex'); // Older HEX MeshID
                } else {
                    obj.meshid = Buffer.from(msg.substring(18, 66), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); // New Base64 MeshID
                }
                //console.log('MeshID', obj.meshid);
                obj.agentInfo.capabilities = common.ReadInt(msg, 66);
                if (msg.length > 70) {
                    const computerNameLen = common.ReadShort(msg, 70);
                    obj.agentInfo.computerName = Buffer.from(msg.substring(72, 72 + computerNameLen), 'binary').toString('utf8');
                    //console.log('computerName', msg.length, computerNameLen, obj.agentInfo.computerName);
                } else {
                    obj.agentInfo.computerName = '';
                    //console.log('computerName-none');
                }

                obj.dbMeshKey = 'mesh/' + domain.id + '/' + obj.meshid;
                completeAgentConnection();
            } else if (cmd == 4) {
                if ((msg.length < 2) || ((obj.receivedCommands & 8) != 0)) return;
                obj.receivedCommands += 8; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.
                // Agent already authenticated the server, wants to skip the server signature - which is great for server performance.
            } else if (cmd == 5) {
                // ServerID. Agent is telling us what serverid it expects. Useful if we have many server certificates.
                if ((msg.substring(2, 34) == parent.swarmCertificateHash256) || (msg.substring(2, 50) == parent.swarmCertificateHash384)) { obj.useSwarmCert = true; }
            } else if (cmd == 30) {
                // Agent Commit Date. This is future proofing. Can be used to change server behavior depending on the date range of the agent.
                try { obj.AgentCommitDate = Date.parse(msg.substring(2)) } catch (ex) { }
                //console.log('Connected Agent Commit Date: ' + msg.substring(2) + ", " + Date.parse(msg.substring(2)));
            }
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('agent', 'AGENT WSERR: ' + err); console.log('AGENT WSERR: ' + err); obj.close(0); });

    // If the mesh agent web socket is closed, clean up.
    ws.on('close', function (req) {
        parent.agentStats.agentClose++;
        if (obj.nodeid != null) {
            const agentId = (obj.agentInfo && obj.agentInfo.agentId) ? obj.agentInfo.agentId : 'Unknown';
            //console.log('Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ') id=' + agentId);
            parent.parent.debug('agent', 'Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ') id=' + agentId);

            // Log the agent disconnection if we are not testing agent update
            if (args.agentupdatetest == null) {
                if (parent.wsagentsDisconnections[obj.nodeid] == null) {
                    parent.wsagentsDisconnections[obj.nodeid] = 1;
                } else {
                    parent.wsagentsDisconnections[obj.nodeid] = ++parent.wsagentsDisconnections[obj.nodeid];
                }
            }
        }
        obj.close(0);
    });

    // Return the mesh for this device, in some cases, we may auto-create the mesh.
    function getMeshAutoCreate() {
        var mesh = parent.meshes[obj.dbMeshKey];

        // If the mesh was not found and we are in LAN mode, check of the domain can be corrected
        if ((args.lanonly == true) && (mesh == null)) {
            var smesh = obj.dbMeshKey.split('/');
            for (var i in parent.parent.config.domains) {
                mesh = parent.meshes['mesh/' + i + '/' + smesh[2]];
                if (mesh != null) {
                    obj.domain = domain = parent.parent.config.domains[i];
                    obj.meshid = smesh[2];
                    obj.dbMeshKey = 'mesh/' + i + '/' + smesh[2];
                    obj.dbNodeKey = 'node/' + domain.id + '/' + obj.nodeid;
                    break;
                }
            }
        }

        if ((mesh == null) && (typeof domain.orphanagentuser == 'string')) {
            const adminUser = parent.users['user/' + domain.id + '/' + domain.orphanagentuser.toLowerCase()];
            if ((adminUser != null) && (adminUser.siteadmin == 0xFFFFFFFF)) {
                // Mesh name is hex instead of base64
                const meshname = obj.meshid.substring(0, 18);

                // Create a new mesh for this device
                const links = {};
                links[adminUser._id] = { name: adminUser.name, rights: 0xFFFFFFFF };
                mesh = { type: 'mesh', _id: obj.dbMeshKey, name: meshname, mtype: 2, desc: '', domain: domain.id, links: links };
                db.Set(mesh);
                parent.meshes[obj.dbMeshKey] = mesh;

                if (adminUser.links == null) adminUser.links = {};
                adminUser.links[obj.dbMeshKey] = { rights: 0xFFFFFFFF };
                db.SetUser(adminUser);
                parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [adminUser._id, obj.dbNodeKey]), obj, { etype: 'mesh', username: adminUser.name, meshid: obj.dbMeshKey, name: meshname, mtype: 2, desc: '', action: 'createmesh', links: links, msgid: 55, msgArgs: [obj.meshid], msg: "Created device group: " + obj.meshid, domain: domain.id });
            }
        } else {
            if ((mesh != null) && (mesh.deleted != null) && (mesh.links)) {
                // Must un-delete this mesh
                var ids = parent.CreateMeshDispatchTargets(mesh._id, [obj.dbNodeKey]);

                // See if users still exists, if so, add links to the mesh
                for (var userid in mesh.links) {
                    const user = parent.users[userid];
                    if (user) {
                        if (user.links == null) { user.links = {}; }
                        if (user.links[mesh._id] == null) {
                            user.links[mesh._id] = { rights: mesh.links[userid].rights };
                            ids.push(user._id);
                            db.SetUser(user);
                        }
                    }
                }

                // Send out an event indicating this mesh was "created"
                parent.parent.DispatchEvent(ids, obj, { etype: 'mesh', meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'createmesh', links: mesh.links, msgid: 56, msgArgs: [mesh._id], msg: "Device group undeleted: " + mesh._id, domain: domain.id });

                // Mark the mesh as active
                delete mesh.deleted;
                db.Set(mesh);
            }
        }
        return mesh;
    }

    // Send a PING/PONG message
    function sendPing() { obj.send('{"action":"ping"}'); }
    function sendPong() { obj.send('{"action":"pong"}'); }

    // Once we get all the information about an agent, run this to hook everything up to the server
    function completeAgentConnection() {
        if ((obj.authenticated != 1) || (obj.meshid == null) || obj.pendingCompleteAgentConnection || (obj.agentInfo == null)) { return; }
        obj.pendingCompleteAgentConnection = true;

        // Setup the agent PING/PONG timers
        if ((typeof args.agentping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, args.agentping * 1000); }
        else if ((typeof args.agentpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, args.agentpong * 1000); }

        // If this is a recovery agent
        if (obj.agentInfo.capabilities & 0x40) {
            // Inform mesh agent that it's authenticated.
            delete obj.pendingCompleteAgentConnection;
            obj.authenticated = 2;
            obj.sendBinary(common.ShortToStr(4));

            // Ask for mesh core hash.
            obj.sendBinary(common.ShortToStr(11) + common.ShortToStr(0));
            return;
        }

        // Check if we have too many agent sessions
        if (typeof domain.limits.maxagentsessions == 'number') {
            // Count the number of agent sessions for this domain
            var domainAgentSessionCount = 0;
            for (var i in parent.wsagents) { if (parent.wsagents[i].domain.id == domain.id) { domainAgentSessionCount++; } }

            // Check if we have too many user sessions
            if (domainAgentSessionCount >= domain.limits.maxagentsessions) {
                // Too many, hold the connection.
                parent.agentStats.agentMaxSessionHoldCount++;
                return;
            }
        }

        /*
        // Check that the mesh exists
        var mesh = parent.meshes[obj.dbMeshKey];
        if (mesh == null) {
            var holdConnection = true;
            if (typeof domain.orphanagentuser == 'string') {
                var adminUser = parent.users['user/' + domain.id + '/' + args.orphanagentuser];
                if ((adminUser != null) && (adminUser.siteadmin == 0xFFFFFFFF)) {
                    // Create a new mesh for this device
                    holdConnection = false;
                    var links = {};
                    links[user._id] = { name: adminUser.name, rights: 0xFFFFFFFF };
                    mesh = { type: 'mesh', _id: obj.dbMeshKey, name: obj.meshid, mtype: 2, desc: '', domain: domain.id, links: links };
                    db.Set(mesh);
                    parent.meshes[obj.meshid] = mesh;
                    parent.parent.AddEventDispatch(parent.CreateMeshDispatchTargets(obj.meshid, [obj.dbNodeKey]), ws);

                    if (adminUser.links == null) user.links = {};
                    adminUser.links[obj.meshid] = { rights: 0xFFFFFFFF };
                    //adminUser.subscriptions = parent.subscribe(adminUser._id, ws);
                    db.SetUser(user);
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(meshid, [user._id, obj.dbNodeKey]), obj, { etype: 'mesh', username: user.name, meshid: obj.meshid, name: obj.meshid, mtype: 2, desc: '', action: 'createmesh', links: links, msg: 'Mesh created: ' + obj.meshid, domain: domain.id });
                }
            }

            if (holdConnection == true) {
                // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                parent.parent.debug('agent', 'Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                return;
            }
        } 
        if (mesh.mtype != 2) { // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.
            parent.parent.debug('agent', 'Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
            console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
            return;
        }
        */

        // Check that the node exists
        db.Get(obj.dbNodeKey, function (err, nodes) {
            if (obj.agentInfo == null) { return; }
            var device, mesh;

            // See if this node exists in the database
            if ((nodes == null) || (nodes.length == 0)) {
                // This device does not exist, use the meshid given by the device

                // Check if we already have too many devices for this domain
                if (domain.limits && (typeof domain.limits.maxdevices == 'number')) {
                    db.isMaxType(domain.limits.maxdevices, 'node', domain.id, function (ismax, count) {
                        if (ismax == true) {
                            // Too many devices in this domain.
                            parent.agentStats.maxDomainDevicesReached++;
                        } else {
                            // We are under the limit, create the new device.
                            completeAgentConnection2();
                        }
                    });
                } else {
                    completeAgentConnection2();
                }
                return;
            } else {
                device = nodes[0];
                obj.name = device.name;

                // This device exists, meshid given by the device must be ignored, use the server side one.
                if ((device.meshid != null) && (device.meshid != obj.dbMeshKey)) {
                    obj.dbMeshKey = device.meshid;
                    obj.meshid = device.meshid.split('/')[2];
                }

                // See if this mesh exists, if it does not we may want to create it.
                mesh = getMeshAutoCreate();

                // Check if the mesh exists
                if (mesh == null) {
                    // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                    parent.agentStats.invalidDomainMesh2Count++;
                    parent.setAgentIssue(obj, "invalidDomainMesh2");
                    parent.parent.debug('agent', 'Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                    console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                    return;
                }

                // Check if the mesh is the right type
                if (mesh.mtype != 2) {
                    // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                    parent.agentStats.invalidMeshType2Count++;
                    parent.setAgentIssue(obj, "invalidMeshType2");
                    parent.parent.debug('agent', 'Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
                    console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
                    return;
                }

                // Mark when this device connected
                obj.connectTime = Date.now();

                // Device already exists, look if changes have occured
                var changes = [], change = 0, log = 0;
                if (device.agent == null) { device.agent = { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }; change = 1; }
                if (device.rname != obj.agentInfo.computerName) { device.rname = obj.agentInfo.computerName; change = 1; changes.push('computer name'); }
                if (device.agent.ver != obj.agentInfo.agentVersion) { device.agent.ver = obj.agentInfo.agentVersion; change = 1; changes.push('agent version'); }
                if (device.agent.id != obj.agentInfo.agentId) { device.agent.id = obj.agentInfo.agentId; change = 1; changes.push('agent type'); }
                if ((device.agent.caps & 24) != (obj.agentInfo.capabilities & 24)) { device.agent.caps = obj.agentInfo.capabilities; change = 1; changes.push('agent capabilities'); } // If agent console or javascript support changes, update capabilities
                if (mesh.flags && (mesh.flags & 2) && (device.name != obj.agentInfo.computerName)) { device.name = obj.agentInfo.computerName; change = 1; } // We want the server name to be sync'ed to the hostname
                if (device.ip != obj.remoteaddr) { device.ip = obj.remoteaddr; change = 1; }

                if (change == 1) {
                    // Do some clean up if needed, these values should not be in the database.
                    if (device.conn != null) { delete device.conn; }
                    if (device.pwr != null) { delete device.pwr; }
                    if (device.agct != null) { delete device.agct; }
                    if (device.cict != null) { delete device.cict; }

                    // Save the updated device in the database
                    db.Set(device);

                    // If this is a temporary device, don't log changes
                    if (obj.agentInfo.capabilities & 0x20) { log = 0; }

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, node: parent.CloneSafeNode(device) };
                    if (log == 0) { event.nolog = 1; } else { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(device.meshid, [obj.dbNodeKey]), obj, event);
                }
            }

            completeAgentConnection3(device, mesh);
        });
    }

    function completeAgentConnection2() {
        // See if this mesh exists, if it does not we may want to create it.
        var mesh = getMeshAutoCreate();

        // Check if the mesh exists
        if (mesh == null) {
            // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
            parent.agentStats.invalidDomainMeshCount++;
            parent.setAgentIssue(obj, "invalidDomainMesh");
            parent.parent.debug('agent', 'Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
            console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
            return;
        }

        // Check if the mesh is the right type
        if (mesh.mtype != 2) {
            // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
            parent.agentStats.invalidMeshTypeCount++;
            parent.setAgentIssue(obj, "invalidMeshType");
            parent.parent.debug('agent', 'Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
            console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
            return;
        }

        // Mark when this device connected
        obj.connectTime = Date.now();

        // This node does not exist, create it.
        var agentName = obj.agentName ? obj.agentName : obj.agentInfo.computerName;
        var device = { type: 'node', mtype: mesh.mtype, _id: obj.dbNodeKey, icon: obj.agentInfo.platformType, meshid: obj.dbMeshKey, name: agentName, rname: obj.agentInfo.computerName, domain: domain.id, agent: { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }, host: null };
        db.Set(device);

        // Event the new node
        if (obj.agentInfo.capabilities & 0x20) {
            // This is a temporary agent, don't log.
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, { etype: 'node', action: 'addnode', node: device, domain: domain.id, nolog: 1 });
        } else {
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, { etype: 'node', action: 'addnode', node: device, msgid: 57, msgArgs: [obj.agentInfo.computerName, mesh.name], msg: ('Added device ' + obj.agentInfo.computerName + ' to device group ' + mesh.name), domain: domain.id });
        }

        completeAgentConnection3(device, mesh);
    }

    function completeAgentConnection3(device, mesh) {
        // Check if this agent is already connected
        const dupAgent = parent.wsagents[obj.dbNodeKey];
        parent.wsagents[obj.dbNodeKey] = obj;
        if (dupAgent) {
            // Record duplicate agents
            if (parent.duplicateAgentsLog[obj.dbNodeKey] == null) {
                if (dupAgent.remoteaddr == obj.remoteaddr) {
                    parent.duplicateAgentsLog[obj.dbNodeKey] = { name: device.name, group: mesh.name, ip: [obj.remoteaddr], count: 1 };
                } else {
                    parent.duplicateAgentsLog[obj.dbNodeKey] = { name: device.name, group: mesh.name, ip: [obj.remoteaddr, dupAgent.remoteaddr], count: 1 };
                }
            } else {
                parent.duplicateAgentsLog[obj.dbNodeKey].name = device.name;
                parent.duplicateAgentsLog[obj.dbNodeKey].group = mesh.name;
                parent.duplicateAgentsLog[obj.dbNodeKey].count++;
                if (parent.duplicateAgentsLog[obj.dbNodeKey].ip.indexOf(obj.remoteaddr) == -1) { parent.duplicateAgentsLog[obj.dbNodeKey].ip.push(obj.remoteaddr); }
            }

            // Close the duplicate agent
            parent.agentStats.duplicateAgentCount++;
            parent.setAgentIssue(obj, 'duplicateAgent');
            if (obj.nodeid != null) { parent.parent.debug('agent', 'Duplicate agent ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); }
            dupAgent.close(3);
        } else {
            // Indicate the agent is connected
            parent.parent.SetConnectivityState(obj.dbMeshKey, obj.dbNodeKey, obj.connectTime, 1, 1, null, { remoteaddrport: obj.remoteaddrport, name: device.name });
        }

        // We are done, ready to communicate with this agent
        delete obj.pendingCompleteAgentConnection;
        obj.authenticated = 2;

        // Check how many times this agent disconnected in the last few minutes.
        const disconnectCount = parent.wsagentsDisconnections[obj.nodeid];
        if (disconnectCount > 6) {
            parent.parent.debug('agent', 'Agent in big trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            console.log('Agent in big trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            parent.agentStats.agentInBigTrouble++;
            // TODO: Log or do something to recover?
            return;
        }

        // Command 4, inform mesh agent that it's authenticated.
        obj.sendBinary(common.ShortToStr(4));

        // Not sure why, but in rare cases, obj.agentInfo is undefined here.
        if ((obj.agentInfo == null) || (typeof obj.agentInfo.capabilities != 'number')) { return; } // This is an odd case.
        obj.agentExeInfo = parent.parent.meshAgentBinaries[obj.agentInfo.agentId];
        if (domain.meshAgentBinaries && domain.meshAgentBinaries[obj.agentInfo.agentId]) { obj.agentExeInfo = domain.meshAgentBinaries[obj.agentInfo.agentId]; }

        // Check if this agent is reconnecting too often.
        if (disconnectCount > 4) {
            // Too many disconnections, this agent has issues. Just clear the core.
            obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));
            parent.parent.debug('agent', 'Agent in trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            parent.agentStats.agentInTrouble++;
            //console.log('Agent in trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            // TODO: Log or do something to recover?
            return;
        }

        // Check if we need to make an native update check
        var corename = null;
        if (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId] != null) {
            corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].core;
        } else {
            // MeshCommand_CoreModule, ask mesh agent to clear the core
            obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));
        }

        if ((obj.agentExeInfo != null) && (obj.agentExeInfo.update == true)) {
            // Ask the agent for it's executable binary hash
            obj.sendBinary(common.ShortToStr(12) + common.ShortToStr(0));
        } else {
            // Check the mesh core, if the agent is capable of running one
            if (((obj.agentInfo.capabilities & 16) != 0) && (corename != null)) {
                obj.sendBinary(common.ShortToStr(11) + common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else {
                agentCoreIsStable(); // No updates needed, agent is ready to go.
            }
        }
    }

    // Indicate to the agent that we want to check Intel AMT configuration
    // This may trigger a CIRA-LMS tunnel from the agent so the server can inspect the device.
    obj.sendUpdatedIntelAmtPolicy = function (policy) {
        if (obj.agentExeInfo && (obj.agentExeInfo.amt == true)) { // Only send Intel AMT policy to agents what could have AMT.
            if (policy == null) { var mesh = parent.meshes[obj.dbMeshKey]; if (mesh == null) return; policy = mesh.amt; }
            if ((policy != null) && (policy.type != 0)) {
                const cookie = parent.parent.encodeCookie({ a: 'apf', n: obj.dbNodeKey, m: obj.dbMeshKey }, parent.parent.loginCookieEncryptionKey);
                try { obj.send(JSON.stringify({ action: 'amtconfig', user: '**MeshAgentApfTunnel**', pass: cookie })); } catch (ex) { }
            }
        }
    }

    function recoveryAgentCoreIsStable(mesh) {
        parent.agentStats.recoveryCoreIsStableCount++;

        // Recovery agent is doing ok, lets perform main agent checking.
        //console.log('recoveryAgentCoreIsStable()');

        // Fetch the the real agent nodeid
        db.Get('da' + obj.dbNodeKey, function (err, nodes, self) {
            if ((nodes != null) && (nodes.length == 1)) {
                self.realNodeKey = nodes[0].raid;

                // Get agent connection state
                var agentConnected = false;
                var state = parent.parent.GetConnectivityState(self.realNodeKey);
                if (state) { agentConnected = ((state.connectivity & 1) != 0) }

                self.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: self.realNodeKey, agent: agentConnected } }));
            } else {
                self.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: null } }));
            }
        }, obj);
    }

    function agentCoreIsStable() {
        parent.agentStats.coreIsStableCount++;

        // Check that the mesh exists
        const mesh = parent.meshes[obj.dbMeshKey];
        if (mesh == null) {
            parent.agentStats.meshDoesNotExistCount++;
            parent.setAgentIssue(obj, "meshDoesNotExist");
            // TODO: Mark this agent as part of a mesh that does not exists.
            return; // Probably not worth doing anything else. Hold this agent.
        }

        // Check if this is a recovery agent
        if (obj.agentInfo.capabilities & 0x40) {
            recoveryAgentCoreIsStable(mesh);
            return;
        }

        // Fetch the the diagnostic agent nodeid
        db.Get('ra' + obj.dbNodeKey, function (err, nodes) {
            if ((nodes != null) && (nodes.length == 1)) {
                obj.diagnosticNodeKey = nodes[0].daid;
                obj.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: obj.diagnosticNodeKey } }));
            }
        });

        // Indicate that we want to check the Intel AMT configuration
        // This may trigger a CIRA-LMS tunnel to the server for further processing
        obj.sendUpdatedIntelAmtPolicy();

        // Fetch system information
        db.GetHash('si' + obj.dbNodeKey, function (err, results) {
            if ((results != null) && (results.length == 1)) { obj.send(JSON.stringify({ action: 'sysinfo', hash: results[0].hash })); } else { obj.send(JSON.stringify({ action: 'sysinfo' })); }
        });

        // Agent error log dump
        if (parent.parent.agentErrorLog != null) {
            db.Get('al' + obj.dbNodeKey, function (err, docs) { // Agent Log
                if ((docs != null) && (docs.length == 1) && (typeof docs[0].lastEvent)) {
                    obj.send('{"action":"errorlog","startTime":' + docs[0].lastEvent + '}'); // Ask all events after a given time
                } else {
                    obj.send('{"action":"errorlog"}'); // Ask all
                }
            });
        }

        // Set agent core dump
        if ((parent.parent.config.settings != null) && ((parent.parent.config.settings.agentcoredump === true) || (parent.parent.config.settings.agentcoredump === false))) {
            obj.send(JSON.stringify({ action: 'coredump', value: parent.parent.config.settings.agentcoredump }));
            if (parent.parent.config.settings.agentcoredump === true) {
                // Check if we requested a core dump file in the last minute, if not, ask if one is present.
                if ((parent.lastCoreDumpRequest == null) || ((Date.now() - parent.lastCoreDumpRequest) >= 60000)) { obj.send(JSON.stringify({ action: 'getcoredump' })); }
            }
        }

        // Do this if IP location is enabled on this domain TODO: Set IP location per device group?
        if (domain.iplocation == true) {
            // Check if we already have IP location information for this node
            db.Get('iploc_' + obj.remoteaddr, function (err, iplocs) {
                if ((iplocs != null) && (iplocs.length == 1)) {
                    // We have a location in the database for this remote IP
                    const iploc = nodes[0], x = {};
                    if ((iploc != null) && (iploc.ip != null) && (iploc.loc != null)) {
                        x.publicip = iploc.ip;
                        x.iploc = iploc.loc + ',' + (Math.floor((new Date(iploc.date)) / 1000));
                        ChangeAgentLocationInfo(x);
                    }
                } else {
                    // Check if we need to ask for the IP location
                    var doIpLocation = 0;
                    if (device.iploc == null) {
                        doIpLocation = 1;
                    } else {
                        const loc = device.iploc.split(',');
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
                        db.getValueOfTheDay('ipLocationRequestLimitor', 10, function (ipLocationLimitor) {
                            if ((ipLocationLimitor != null) && (ipLocationLimitor.value > 0)) {
                                ipLocationLimitor.value--;
                                db.Set(ipLocationLimitor);
                                obj.send(JSON.stringify({ action: 'iplocation' }));
                            }
                        });
                    }
                }
            });
        }

        // Indicate server information to the agent.
        var serverInfo = { action: 'serverInfo' };
        if ((typeof domain.terminal == 'object') && (typeof domain.terminal.launchcommand == 'object')) {
            // Send terminal starting command
            serverInfo.termlaunchcommand = {};
            if (typeof domain.terminal.launchcommand.linux == 'string') { serverInfo.termlaunchcommand.linux = domain.terminal.launchcommand.linux; }
            if (typeof domain.terminal.launchcommand.darwin == 'string') { serverInfo.termlaunchcommand.darwin = domain.terminal.launchcommand.darwin; }
            if (typeof domain.terminal.launchcommand.freebsd == 'string') { serverInfo.termlaunchcommand.freebsd = domain.terminal.launchcommand.freebsd; }
        }
        // Enable agent self guest sharing if allowed
        if (domain.agentselfguestsharing) { serverInfo.agentSelfGuestSharing = true; }
        obj.send(JSON.stringify(serverInfo));

        // Plug in handler
        if (parent.parent.pluginHandler != null) {
            parent.parent.pluginHandler.callHook('hook_agentCoreIsStable', obj, parent);
        }
    }

    // Get the web certificate private key hash for the specified domain
    function getWebCertHash(domain) {
        const hash = parent.webCertificateHashs[domain.id];
        if (hash != null) return hash;
        return parent.webCertificateHash;
    }

    // Get the web certificate hash for the specified domain
    function getWebCertFullHash(domain) {
        const hash = parent.webCertificateFullHashs[domain.id];
        if (hash != null) return hash;
        return parent.webCertificateFullHash;
    }

    // Verify the agent signature
    function processAgentSignature(msg) {
        if (isIgnoreHashCheck() == false) {
            var verified = false;

            // This agent did not report a valid TLS certificate hash, fail now.
            if (obj.agentSeenCerthash == null) return false;

            // Raw RSA signatures have an exact length of 256 or 384. PKCS7 is larger.
            if ((msg.length != 384) && (msg.length != 256)) {
                // Verify a PKCS7 signature.
                var msgDer = null;
                try { msgDer = forge.asn1.fromDer(forge.util.createBuffer(msg, 'binary')); } catch (ex) { }
                if (msgDer != null) {
                    try {
                        const p7 = forge.pkcs7.messageFromAsn1(msgDer);
                        const sig = p7.rawCapture.signature;

                        // Verify with key hash
                        var buf = Buffer.from(obj.agentSeenCerthash + obj.nonce + obj.agentnonce, 'binary');
                        var verifier = parent.crypto.createVerify('RSA-SHA384');
                        verifier.update(buf);
                        verified = verifier.verify(obj.unauth.nodeCertPem, sig, 'binary');
                        if (verified !== true) {
                            // Not a valid signature
                            parent.agentStats.invalidPkcsSignatureCount++;
                            parent.setAgentIssue(obj, "invalidPkcsSignature");
                            return false;
                        }
                    } catch (ex) { };
                }
            }

            if (verified == false) {
                // Verify the RSA signature. This is the fast way, without using forge.
                const verify = parent.crypto.createVerify('SHA384');
                verify.end(Buffer.from(obj.agentSeenCerthash + obj.nonce + obj.agentnonce, 'binary')); // Test using the private key hash
                if (verify.verify(obj.unauth.nodeCertPem, Buffer.from(msg, 'binary')) !== true) {
                    parent.agentStats.invalidRsaSignatureCount++;
                    parent.setAgentIssue(obj, "invalidRsaSignature");
                    return false;
                }
            }
        }

        // Connection is a success, clean up
        obj.nodeid = obj.unauth.nodeid;
        obj.dbNodeKey = 'node/' + domain.id + '/' + obj.nodeid;
        delete obj.nonce;
        delete obj.agentnonce;
        delete obj.unauth;
        delete obj.receivedCommands;
        delete obj.agentSeenCerthash;
        if (obj.unauthsign) delete obj.unauthsign;
        parent.agentStats.verifiedAgentConnectionCount++;
        parent.parent.debug('agent', 'Verified agent connection to ' + obj.nodeid + ' (' + obj.remoteaddrport + ').');
        obj.authenticated = 1;
        return true;
    }

    // Process incoming agent JSON data
    function processAgentData(msg) {
        if (obj.agentInfo == null) return;
        var i, str = msg.toString('utf8'), command = null;
        if (str[0] == '{') {
            try { command = JSON.parse(str); } catch (ex) {
                // If the command can't be parsed, ignore it.
                parent.agentStats.invalidJsonCount++;
                parent.setAgentIssue(obj, "invalidJson (" + str.length + "): " + str);
                parent.parent.debug('agent', 'Unable to parse agent JSON (' + obj.remoteaddrport + ')');
                console.log('Unable to parse agent JSON (' + obj.remoteaddrport + '): ' + str, ex);
                return;
            }
            if (typeof command != 'object') { return; }
            switch (command.action) {
                case 'msg':
                    {
                        // If the same console command is processed many times, kick out this agent.
                        // This is a safety mesure to guard against the agent DOS'ing the server.
                        if (command.type == 'console') {
                            if (obj.consoleKickValue == command.value) {
                                if (obj.consoleKickCount) { obj.consoleKickCount++; } else { obj.consoleKickCount = 1; }
                                if (obj.consoleKickCount > 30) { obj.close(); return; } // 30 identical console messages received, kick out this agent.
                            } else {
                                obj.consoleKickValue = command.value;
                            }
                        }

                        // Route a message
                        parent.routeAgentCommand(command, obj.domain.id, obj.dbNodeKey, obj.dbMeshKey);
                        break;
                    }
                case 'coreinfo':
                    {
                        // Sent by the agent to update agent information
                        ChangeAgentCoreInfo(command);

                        if ((obj.agentCoreUpdate === true) && (obj.agentExeInfo != null) && (typeof obj.agentExeInfo.url == 'string')) {
                            // Agent update. The recovery core was loaded in the agent, send a command to update the agent
                            parent.parent.taskLimiter.launch(function (argument, taskid, taskLimiterQueue) { // Medium priority task
                                // If agent disconnection, complete and exit now.
                                if ((obj.authenticated != 2) || (obj.agentExeInfo == null)) { parent.parent.taskLimiter.completed(taskid); return; }

                                // Agent update. The recovery core was loaded in the agent, send a command to update the agent
                                obj.agentCoreUpdateTaskId = taskid;
                                const url = '*' + require('url').parse(obj.agentExeInfo.url).path;
                                var cmd = { action: 'agentupdate', url: url, hash: obj.agentExeInfo.hashhex };
                                parent.parent.debug('agentupdate', "Sending agent update url: " + cmd.url);

                                // Add the hash
                                if (obj.agentExeInfo.fileHash != null) { cmd.hash = obj.agentExeInfo.fileHashHex; } else { cmd.hash = obj.agentExeInfo.hashhex; }

                                // Add server TLS cert hash
                                if (isIgnoreHashCheck() == false) {
                                    const tlsCertHash = parent.webCertificateFullHashs[domain.id];
                                    if (tlsCertHash != null) { cmd.servertlshash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
                                }

                                // Send the agent update command
                                obj.send(JSON.stringify(cmd));
                            }, null, 1);
                        }
                        break;
                    }
                case 'smbios':
                    {
                        // SMBIOS information must never be saved when NeDB is in use. NeDB will currupt that database.
                        if (db.SetSMBIOS == null) break;

                        // See if we need to save SMBIOS information
                        if (domain.smbios === true) {
                            // Store the RAW SMBios table of this computer
                            // Perform sanity checks before storing
                            try {
                                for (var i in command.value) { var k = parseInt(i); if ((k != i) || (i > 255) || (typeof command.value[i] != 'object') || (command.value[i].length == null) || (command.value[i].length > 1024) || (command.value[i].length < 0)) { delete command.value[i]; } }
                                db.SetSMBIOS({ _id: obj.dbNodeKey, domain: domain.id, time: new Date(), value: command.value });
                            } catch (ex) { }
                        }

                        // Event the node interface information change (This is a lot of traffic, probably don't need this).
                        //parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.meshid, [obj.dbNodeKey]), obj, { action: 'smBiosChange', nodeid: obj.dbNodeKey, domain: domain.id, smbios: command.value,  nolog: 1 });

                        break;
                    }
                case 'netinfo':
                    {
                        // Check if network information is present
                        if ((command.netif2 == null) && (command.netif == null)) return;

                        // Escape any field names that have special characters
                        if (command.netif2 != null) {
                            for (var i in command.netif2) {
                                var esc = common.escapeFieldName(i);
                                if (esc !== i) { command.netif2[esc] = command.netif2[i]; delete command.netif2[i]; }
                            }
                        }

                        // Sent by the agent to update agent network interface information
                        delete command.action;
                        command.updateTime = Date.now();
                        command._id = 'if' + obj.dbNodeKey;
                        command.domain = domain.id;
                        command.type = 'ifinfo';
                        db.Set(command);

                        // Event the node interface information change
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.meshid, [obj.dbNodeKey]), obj, { action: 'ifchange', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 });

                        break;
                    }
                case 'iplocation':
                    {
                        // Sent by the agent to update location information
                        if ((command.type == 'publicip') && (command.value != null) && (typeof command.value == 'object') && (command.value.ip) && (command.value.loc)) {
                            var x = {};
                            x.publicip = command.value.ip;
                            x.iploc = command.value.loc + ',' + (Math.floor(Date.now() / 1000));
                            ChangeAgentLocationInfo(x);
                            command.value._id = 'iploc_' + command.value.ip;
                            command.value.type = 'iploc';
                            command.value.date = Date.now();
                            db.Set(command.value); // Store the IP to location data in the database
                            // Sample Value: { ip: '192.55.64.246', city: 'Hillsboro', region: 'Oregon', country: 'US', loc: '45.4443,-122.9663', org: 'AS4983 Intel Corporation', postal: '97123' }
                        }
                        break;
                    }
                case 'mc1migration':
                    {
                        if (command.oldnodeid.length != 64) break;
                        const oldNodeKey = 'node//' + command.oldnodeid.toLowerCase();
                        db.Get(oldNodeKey, function (err, nodes) {
                            if ((nodes == null) || (nodes.length != 1)) return;
                            const node = nodes[0];
                            if (node.meshid == obj.dbMeshKey) {
                                // Update the device name & host
                                const newNode = { "name": node.name };
                                if (node.intelamt != null) { newNode.intelamt = node.intelamt; }
                                ChangeAgentCoreInfo(newNode);

                                // Delete this node including network interface information and events
                                db.Remove(node._id);
                                db.Remove('if' + node._id);

                                // Event node deletion
                                const change = 'Migrated device ' + node.name;
                                parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.dbNodeKey]), obj, { etype: 'node', action: 'removenode', nodeid: node._id, msg: change, domain: node.domain });
                            }
                        });
                        break;
                    }
                case 'openUrl':
                    {
                        // Sent by the agent to return the status of a open URL action.
                        // Nothing is done right now.
                        break;
                    }
                case 'log':
                    {
                        // Log a value in the event log
                        if ((typeof command.msg == 'string') && (command.msg.length < 4096)) {
                            var event = { etype: 'node', action: 'agentlog', nodeid: obj.dbNodeKey, domain: domain.id, msg: command.msg };
                            if (typeof command.msgid == 'number') { event.msgid = command.msgid; }
                            if (typeof command.guestname == 'string') { event.guestname = command.guestname; }
                            if (Array.isArray(command.msgArgs)) { event.msgArgs = command.msgArgs; }
                            if (typeof command.remoteaddr == 'string') { event.remoteaddr = command.remoteaddr; }
                            var targets = parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]);
                            if (typeof command.userid == 'string') {
                                var loguser = parent.users[command.userid];
                                if (loguser) { event.userid = command.userid; event.username = loguser.name; targets.push(command.userid); }
                            }
                            if (typeof command.xuserid == 'string') {
                                var xloguser = parent.users[command.xuserid];
                                if (xloguser) { targets.push(command.xuserid); }
                            }
                            if ((typeof command.sessionid == 'string') && (command.sessionid.length < 500)) { event.sessionid = command.sessionid; }
                            parent.parent.DispatchEvent(targets, obj, event);
                        }
                        break;
                    }
                case 'ping': { sendPong(); break; }
                case 'pong': { break; }
                case 'getScript':
                    {
                        // Used by the agent to get configuration scripts.
                        if (command.type == 1) {
                            parent.getCiraConfigurationScript(obj.dbMeshKey, function (script) {
                                obj.send(JSON.stringify({ action: 'getScript', type: 1, script: script.toString() }));
                            });
                        } else if (command.type == 2) {
                            parent.getCiraCleanupScript(function (script) {
                                obj.send(JSON.stringify({ action: 'getScript', type: 2, script: script.toString() }));
                            });
                        }
                        break;
                    }
                case 'diagnostic':
                    {
                        if (typeof command.value == 'object') {
                            switch (command.value.command) {
                                case 'register': {
                                    // Only main agent can do this
                                    if (((obj.agentInfo.capabilities & 0x40) == 0) && (typeof command.value.value == 'string') && (command.value.value.length == 64)) {
                                        // Store links to diagnostic agent id
                                        var daNodeKey = 'node/' + domain.id + '/' + db.escapeBase64(command.value.value);
                                        db.Set({ _id: 'da' + daNodeKey, domain: domain.id, time: obj.connectTime, raid: obj.dbNodeKey });  // DiagnosticAgent --> Agent
                                        db.Set({ _id: 'ra' + obj.dbNodeKey, domain: domain.id, time: obj.connectTime, daid: daNodeKey });  // Agent --> DiagnosticAgent
                                    }
                                    break;
                                }
                                case 'query': {
                                    // Only the diagnostic agent can do
                                    if ((obj.agentInfo.capabilities & 0x40) != 0) {
                                        // Return nodeid of main agent + connection status
                                        db.Get('da' + obj.dbNodeKey, function (err, nodes) {
                                            if ((nodes != null) && (nodes.length == 1)) {
                                                obj.realNodeKey = nodes[0].raid;

                                                // Get agent connection state
                                                var agentConnected = false;
                                                var state = parent.parent.GetConnectivityState(obj.realNodeKey);
                                                if (state) { agentConnected = ((state.connectivity & 1) != 0) }

                                                obj.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: obj.realNodeKey, agent: agentConnected } }));
                                            } else {
                                                obj.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: null } }));
                                            }
                                        });
                                    }
                                    break;
                                }
                                case 'log': {
                                    if (((obj.agentInfo.capabilities & 0x40) != 0) && (typeof command.value.value == 'string') && (command.value.value.length < 256)) {
                                        // If this is a diagnostic agent, log the event in the log of the main agent
                                        var event = { etype: 'node', action: 'diagnostic', nodeid: obj.realNodeKey, snodeid: obj.dbNodeKey, domain: domain.id, msg: command.value.value };
                                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, event);
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                    }
                case 'sysinfo': {
                    if ((typeof command.data == 'object') && (typeof command.data.hash == 'string')) {
                        // Validate command.data.
                        if (common.validateObjectForMongo(command.data, 1024) == false) break;

                        // Save to database
                        command.data._id = 'si' + obj.dbNodeKey;
                        command.data.type = 'sysinfo';
                        command.data.domain = domain.id;
                        command.data.time = Date.now();
                        db.Set(command.data); // Update system information in the database.

                        // Event the new sysinfo hash, this will notify everyone that the sysinfo document was changed
                        var event = { etype: 'node', action: 'sysinfohash', nodeid: obj.dbNodeKey, domain: domain.id, hash: command.data.hash, nolog: 1 };
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, event);
                    }
                    break;
                }
                case 'sysinfocheck': {
                    // Check system information update
                    db.GetHash('si' + obj.dbNodeKey, function (err, results) {
                        if ((results != null) && (results.length == 1)) { obj.send(JSON.stringify({ action: 'sysinfo', hash: results[0].hash })); } else { obj.send(JSON.stringify({ action: 'sysinfo' })); }
                    });
                    break;
                }
                case 'sessions': {
                    // This is a list of sessions provided by the agent
                    if (obj.sessions == null) { obj.sessions = {}; }
                    if (typeof command.value != null) {
                        if (command.type == 'kvm') { obj.sessions.kvm = command.value; }
                        else if (command.type == 'terminal') { obj.sessions.terminal = command.value; }
                        else if (command.type == 'files') { obj.sessions.files = command.value; }
                        else if (command.type == 'help') { obj.sessions.help = command.value; }
                        else if (command.type == 'tcp') { obj.sessions.tcp = command.value; }
                        else if (command.type == 'udp') { obj.sessions.udp = command.value; }
                        else if (command.type == 'msg') { obj.sessions.msg = command.value; }
                        else if (command.type == 'app') { obj.sessions.app = command.value; }
                    }

                    // Any "help" session must have an associated app, if not, remove it.
                    if (obj.sessions.help != null) {
                        for (var i in obj.sessions.help) { if (obj.sessions.help[i] == null) { delete obj.sessions.help[i]; } }
                        if (Object.keys(obj.sessions.help).length == 0) { delete obj.sessions.help; }
                    }

                    // Inform everyone of updated sessions
                    obj.updateSessions();
                    break;
                }
                case 'battery': {
                    // Device battery and power state
                    if (obj.sessions == null) { obj.sessions = {}; }
                    if (obj.sessions.battery == null) { obj.sessions.battery = {}; }
                    if ((command.state == 'ac') || (command.state == 'dc')) { obj.sessions.battery.state = command.state; } else { delete obj.sessions.battery.state; }
                    if ((typeof command.level == 'number') && (command.level >= 0) && (command.level <= 100)) { obj.sessions.battery.level = command.level; } else { delete obj.sessions.battery.level; }
                    obj.updateSessions();
                    break;
                }
                case 'getcoredump': {
                    // Check if we requested a core dump file in the last minute, if so, ignore this.
                    if ((parent.lastCoreDumpRequest != null) && ((Date.now() - parent.lastCoreDumpRequest) < 60000)) break;

                    // Indicates if the agent has a coredump available
                    if ((command.exists === true) && (typeof command.agenthashhex == 'string') && (command.agenthashhex.length == 96)) {
                        // Check if we already have this exact dump file
                        const coreDumpFile = parent.path.join(parent.parent.datapath, '..', 'meshcentral-coredumps', obj.agentInfo.agentId + '-' + command.agenthashhex + '-' + obj.nodeid + '.dmp');
                        parent.fs.stat(coreDumpFile, function (err, stats) {
                            if (stats != null) return;
                            obj.coreDumpPresent = true;

                            // Check how many files are in the coredumps folder
                            const coreDumpPath = parent.path.join(parent.parent.datapath, '..', 'meshcentral-coredumps');
                            parent.fs.readdir(coreDumpPath, function (err, files) {
                                if ((files != null) && (files.length >= 20)) return; // Don't get more than 20 core dump files.

                                // Get the core dump uploaded to the server.
                                parent.lastCoreDumpRequest = Date.now();
                                obj.RequestCoreDump(command.agenthashhex, command.corehashhex);
                            });
                        });
                    }
                    break;
                }
                case 'tunnelCloseStats': {
                    // TODO: This this extra stats from the tunnel, you can merge this into the tunnel event in the database.
                    //console.log(command);

                    // Validate input
                    if ((command.sent == null) || (typeof command.sent != 'string')) return;
                    if ((command.sentActual == null) || (typeof command.sentActual != 'string')) return;
                    if ((command.sentActual == null) || (typeof command.sentActual != 'number')) return;

                    // Event the session closed compression data.
                    var event = { etype: 'node', action: 'sessioncompression', nodeid: obj.dbNodeKey, domain: domain.id, sent: parseInt(command.sent), sentActual: parseInt(command.sentActual), msgid: 54, msgArgs: [command.sentRatio, parseInt(command.sent), parseInt(command.sentActual)], msg: 'Agent closed session with ' + command.sentRatio + '% agent to server compression. Sent: ' + command.sent + ', Compressed: ' + command.sentActual + '.' };
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, event);
                    break;
                }
                case 'lmsinfo': {
                    // Agents send the LMS port bindings
                    // Example: {"action":"lmsinfo","value":{"ports":["623","16992"]}}
                    break;
                }
                case 'plugin': {
                    if ((parent.parent.pluginHandler == null) || (typeof command.plugin != 'string')) break;
                    try {
                        parent.parent.pluginHandler.plugins[command.plugin].serveraction(command, obj, parent);
                    } catch (e) {
                        parent.parent.debug('agent', 'Error loading plugin handler (' + e + ')');
                        console.log('Error loading plugin handler (' + e + ')');
                    }
                    break;
                }
                case 'meshToolInfo': {
                    // Return information about a MeshCentral tool. Current tools are 'MeshCentralRouter' and 'MeshCentralAssistant'
                    // Information includes file hash and download location URL
                    if (typeof command.name != 'string') break;
                    var info = parent.parent.meshToolsBinaries[command.name];
                    if ((command.hash != null) && (info.hash == command.hash)) return;

                    // To build the connection URL, if we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                    var xdomain = (domain.dns == null) ? domain.id : '';
                    if (xdomain != '') xdomain += '/';

                    // Build the response
                    const responseCmd = { action: 'meshToolInfo', name: command.name, tag: command.tag, sessionid: command.sessionid, hash: info.hash, size: info.size, url: info.url };
                    if ((command.name == 'MeshCentralAssistant') && (command.msh == true)) { responseCmd.url = '*/' + xdomain + 'meshagents?id=10006'; } // If this is Assistant and the MSH needs to be included in the executable, change the URL.
                    if (command.cookie === true) { responseCmd.url += ('&auth=' + parent.parent.encodeCookie({ download: info.dlname }, parent.parent.loginCookieEncryptionKey)); }
                    if (command.pipe === true) { responseCmd.pipe = true; }
                    if (parent.webCertificateHashs[domain.id] != null) { responseCmd.serverhash = Buffer.from(parent.webCertificateHashs[domain.id], 'binary').toString('hex'); }
                    try { ws.send(JSON.stringify(responseCmd)); } catch (ex) { }
                    break;
                }
                case 'agentupdate': {
                    if ((obj.agentExeInfo != null) && (typeof obj.agentExeInfo.url == 'string')) {
                        var func = function agentUpdateFunc(argument, taskid, taskLimiterQueue) { // Medium priority task
                            // If agent disconnection, complete and exit now.
                            if (obj.authenticated != 2) { parent.parent.taskLimiter.completed(taskid); return; }

                            // Agent is requesting an agent update
                            obj.agentCoreUpdateTaskId = taskid;
                            const url = '*' + require('url').parse(obj.agentExeInfo.url).path;
                            var cmd = { action: 'agentupdate', url: url, hash: obj.agentExeInfo.hashhex, sessionid: agentUpdateFunc.sessionid };
                            parent.parent.debug('agentupdate', "Sending user requested agent update url: " + cmd.url);

                            // Add the hash
                            if (obj.agentExeInfo.fileHash != null) { cmd.hash = obj.agentExeInfo.fileHashHex; } else { cmd.hash = obj.agentExeInfo.hashhex; }

                            // Add server TLS cert hash
                            if (isIgnoreHashCheck() == false) {
                                const tlsCertHash = parent.webCertificateFullHashs[domain.id];
                                if (tlsCertHash != null) { cmd.servertlshash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
                            }

                            // Send the agent update command
                            obj.send(JSON.stringify(cmd));
                        }
                        func.sessionid = command.sessionid;

                        // Agent update. The recovery core was loaded in the agent, send a command to update the agent
                        parent.parent.taskLimiter.launch(func, null, 1);
                    }
                    break;
                }
                case 'agentupdatedownloaded': {
                    if (obj.agentCoreUpdateTaskId != null) {
                        // Indicate this udpate task is complete
                        parent.parent.taskLimiter.completed(obj.agentCoreUpdateTaskId);
                        delete obj.agentCoreUpdateTaskId;
                    }
                    break;
                }
                case 'errorlog': { // This is the agent error log
                    if ((!Array.isArray(command.log)) || (command.log.length == 0) || (parent.parent.agentErrorLog == null)) break;
                    var lastLogEntry = command.log[command.log.length - 1];
                    if ((lastLogEntry != null) && (typeof lastLogEntry == 'object') && (typeof lastLogEntry.t == 'number')) {
                        parent.fs.write(parent.parent.agentErrorLog, obj.dbNodeKey + ', ' + Date.now() + ', ' + str + '\r\n', function (err) { });
                        db.Set({ _id: 'al' + obj.dbNodeKey, lastEvent: lastLogEntry.t });
                    }
                    break;
                }
                case '2faauth': {
                    // Validate input
                    if ((typeof command.url != 'string') || (typeof command.approved != 'boolean') || (command.url.startsWith('2fa://') == false)) return;

                    // parse the URL
                    var url = null;
                    try { url = require('url').parse(command.url); } catch (ex) { }
                    if (url == null) return;

                    // Decode the cookie
                    var urlSplit = url.query.split('&c=');
                    if (urlSplit.length != 2) return;
                    const authCookie = parent.parent.decodeCookie(urlSplit[1], null, 1);
                    if ((authCookie == null) || (typeof authCookie.c != 'string') || (('code=' + authCookie.c) != urlSplit[0])) return;
                    if ((typeof authCookie.n != 'string') || (authCookie.n != obj.dbNodeKey) || (typeof authCookie.u != 'string')) return;

                    // Fetch the user
                    const user = parent.users[authCookie.u];
                    if (user == null) return;

                    // Add this device as the authentication push notification device for this user
                    if (authCookie.a == 'addAuth') {
                        // Do nothing if authentication is not approved.
                        // We do not want to indicate that the remote user responded to this.
                        if (command.approved !== true) return;

                        // Change the user
                        user.otpdev = obj.dbNodeKey;
                        parent.db.SetUser(user);

                        // Notify change
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: parent.CloneSafeUser(user), action: 'accountchange', msgid: 113, msg: "Added push notification authentication device", domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.parent.DispatchEvent(targets, obj, event);
                    }

                    // Complete 2FA checking
                    if (authCookie.a == 'checkAuth') {
                        if (typeof authCookie.s != 'string') return;
                        // Notify 2FA response
                        parent.parent.DispatchEvent(['2fadev-' + authCookie.s], obj, { etype: '2fadev', action: '2faresponse', domain: domain.id, nodeid: obj.dbNodeKey, code: authCookie.a, userid: user._id, approved: command.approved, sessionid: authCookie.s, nolog: 1 });
                    }

                    break;
                }
                case 'getUserImage': {
                    // Validate input
                    if (typeof command.userid != 'string') {
                        // Send back the default image if required
                        if ((command.default) || (command.sentDefault)) {
                            try { command.image = 'data:image/png;base64,' + Buffer.from(parent.fs.readFileSync(parent.parent.path.join(__dirname, 'public', 'images', 'user-128.png')), 'binary').toString('base64'); } catch (ex) { }
                            obj.send(JSON.stringify(command));
                        }
                        return;
                    }
                    var useridsplit = command.userid.split('/');
                    if ((useridsplit.length != 3) || (useridsplit[1] != domain.id)) return;

                    // Add the user's real name if present
                    var u = parent.users[command.userid];
                    if (u == null) return;
                    if (u.name) { command.name = u.name; }
                    if (u.realname) { command.realname = u.realname; }

                    // An agent can only request images of accounts with rights to the device.
                    if (parent.GetNodeRights(command.userid, obj.dbMeshKey, obj.dbNodeKey) != 0) {
                        parent.db.Get('im' + command.userid, function (err, images) {
                            if ((err == null) && (images != null) && (images.length == 1)) {
                                // Send back the account image
                                command.image = images[0].image;
                            } else {
                                // Send back the default image if required
                                if ((command.default) || (command.sentDefault)) {
                                    try { command.image = 'data:image/png;base64,' + Buffer.from(parent.fs.readFileSync(parent.parent.path.join(__dirname, 'public', 'images', 'user-128.png')), 'binary').toString('base64'); } catch (ex) { }
                                }
                            }
                            obj.send(JSON.stringify(command));
                        });
                    }
                    break;
                }
                case 'getServerImage': {
                    if (command.agent === 'assistant') {
                        // Return server title and image for MeshCentral Assistant
                        if ((domain.assistantcustomization != null) && (typeof domain.assistantcustomization == 'object')) {
                            var ok = false;
                            if (typeof domain.assistantcustomization.title == 'string') { ok = true; command.title = domain.assistantcustomization.title; }
                            if (typeof domain.assistantcustomization.image == 'string') { try { command.image = 'data:image/jpeg;base64,' + Buffer.from(parent.fs.readFileSync(parent.parent.getConfigFilePath(domain.assistantcustomization.image)), 'binary').toString('base64'); ok = true; } catch (ex) { console.log(ex); } }
                            if (ok) { obj.send(JSON.stringify(command)); }
                        }
                    }
                    if (command.agent === 'android') {
                        // Return server title and image for MeshCentral Assistant
                        if ((domain.androidcustomization != null) && (typeof domain.androidcustomization == 'object')) {
                            var ok = false;
                            if (typeof domain.androidcustomization.title == 'string') { ok = true; command.title = domain.androidcustomization.title; }
                            if (typeof domain.androidcustomization.subtitle == 'string') { ok = true; command.subtitle = domain.androidcustomization.subtitle; }
                            if (typeof domain.androidcustomization.image == 'string') { try { command.image = 'data:image/jpeg;base64,' + Buffer.from(parent.fs.readFileSync(parent.parent.getConfigFilePath(domain.androidcustomization.image)), 'binary').toString('base64'); ok = true; } catch (ex) { console.log(ex); } }
                            if (ok) { obj.send(JSON.stringify(command)); }
                        }
                    }
                    break;
                }
                case 'guestShare': {
                    if ((command.flags == null) || (command.flags == 0)) {
                        // Stop any current self-share, this is allowed even if self guest sharing is not allows so to clear any old shares.
                        removeGuestSharing(function () {
                            delete obj.guestSharing;
                            obj.send(JSON.stringify({ action: 'guestShare', flags: command.flags, url: null, viewOnly: false }));
                        });
                    } else {
                        // Add a new self-share, this will replace any share for this device
                        if ((domain.agentselfguestsharing == null) || (domain.agentselfguestsharing == false) || (typeof command.flags != 'number')) return; // Check if agent self-sharing is allowed, this is off by default.
                        if ((command.flags & 2) == 0) { command.viewOnly = false; } // Only allow "view only" if desktop is shared.
                        addGuestSharing(command.flags, command.viewOnly, function (share) {
                            obj.guestSharing = true;
                            obj.send(JSON.stringify({ action: 'guestShare', url: share.url, flags: share.flags, viewOnly: share.viewOnly }));
                        })
                    }
                    break;
                }
                case 'scriptTask': {
                    // TODO
                    break;
                }
                default: {
                    parent.agentStats.unknownAgentActionCount++;
                    parent.parent.debug('agent', 'Unknown agent action (' + obj.remoteaddrport + '): ' + JSON.stringify(command) + '.');
                    console.log('Unknown agent action (' + obj.remoteaddrport + '): ' + JSON.stringify(command) + '.');
                    break;
                }
            }
            if (parent.parent.pluginHandler != null) {
                parent.parent.pluginHandler.callHook('hook_processAgentData', command, obj, parent);
            }
        }
    }

    function addGuestSharing(flags, viewOnly, func) {
        // Create cookie
        const publicid = 'AS:' + obj.dbNodeKey;
        const extrakey = getRandomAmtPassword();
        const cookie = { a: 6, pid: publicid, k: extrakey }; // New style sharing cookie
        const inviteCookie = parent.parent.encodeCookie(cookie, parent.parent.invitationLinkEncryptionKey);
        if (inviteCookie == null) return;

        // Create the server url
        var serverName = parent.getWebServerName(domain);
        var httpsPort = ((args.aliasport == null) ? args.port : args.aliasport); // Use HTTPS alias port is specified
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var url = 'https://' + serverName + ':' + httpsPort + '/' + xdomain + 'sharing?c=' + inviteCookie;
        if (serverName.split('.') == 1) { url = '/' + xdomain + page + '?c=' + inviteCookie; }

        // Create a device sharing database entry
        var shareEntry = { _id: 'deviceshare-' + publicid, type: 'deviceshare', nodeid: obj.dbNodeKey, p: flags, domain: domain.id, publicid: publicid, guestName: 'Agent', consent: 0x7F, url: url, extrakey: extrakey };

        // Add expire time
        if ((typeof domain.agentselfguestsharing == 'object') && (typeof domain.agentselfguestsharing.expire == 'number') && (domain.agentselfguestsharing.expire > 0)) {
            shareEntry.startTime = Date.now();
            shareEntry.expireTime = Date.now() + (60000 * domain.agentselfguestsharing.expire);
        }

        if (viewOnly === true) { shareEntry.viewOnly = true; }
        parent.db.Set(shareEntry);

        // Send out an event that we added a device share
        var targets = parent.CreateNodeDispatchTargets(obj.dbMeshKey, obj.dbNodeKey);
        var event = { etype: 'node', nodeid: obj.dbNodeKey, action: 'addedDeviceShare', msg: 'Added device share with unlimited time', msgid: 131, msgArgs: ['Agent'], domain: domain.id };
        parent.parent.DispatchEvent(targets, obj, event);

        // Send device share update
        parent.db.GetAllTypeNodeFiltered([obj.dbNodeKey], domain.id, 'deviceshare', null, function (err, docs) {
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
            var targets = parent.CreateNodeDispatchTargets(obj.dbMeshKey, obj.dbNodeKey, []);
            parent.parent.DispatchEvent(targets, obj, { etype: 'node', nodeid: obj.dbNodeKey, action: 'deviceShareUpdate', domain: domain.id, deviceShares: docs, nolog: 1 });

            // Callback
            if (func) { func({ url: url, flags: flags, viewOnly: viewOnly }); }
        });
    }

    function removeGuestSharing(func) {
        var publicid = 'AS:' + obj.dbNodeKey;
        parent.db.GetAllTypeNodeFiltered([obj.dbNodeKey], domain.id, 'deviceshare', null, function (err, docs) {
            if (err != null) return;

            // Remove device sharing
            var now = Date.now(), removedExact = null, removed = false, okDocs = [];
            for (var i = 0; i < docs.length; i++) {
                const doc = docs[i];
                if (doc.publicid == publicid) { parent.db.Remove(doc._id, function () { }); removedExact = doc; removed = true; }
                else if (doc.expireTime < now) { parent.db.Remove(doc._id, function () { }); removed = true; } else {
                    // This share is ok, remove extra data we don't need to send.
                    delete doc._id; delete doc.domain; delete doc.nodeid; delete doc.type;
                    okDocs.push(doc);
                }
            }

            // Event device share removal
            if (removedExact != null) {
                // Send out an event that we removed a device share
                var targets = parent.CreateNodeDispatchTargets(obj.dbMeshKey, obj.dbNodeKey, []);
                var event = { etype: 'node', nodeid: obj.dbNodeKey, action: 'removedDeviceShare', msg: 'Removed Device Share', msgid: 102, msgArgs: ['Agent'], domain: domain.id, publicid: publicid };
                parent.parent.DispatchEvent(targets, obj, event);
            }

            // If we removed any shares, send device share update
            if (removed == true) {
                var targets = parent.CreateNodeDispatchTargets(obj.dbMeshKey, obj.dbNodeKey, []);
                parent.parent.DispatchEvent(targets, obj, { etype: 'node', nodeid: obj.dbNodeKey, action: 'deviceShareUpdate', domain: domain.id, deviceShares: okDocs, nolog: 1 });
            }

            // Call back when done
            if (func) func(removed);
        });
    }

    // Notify update of sessions
    obj.updateSessions = function () {
        // Perform some clean up
        for (var i in obj.sessions) { if (Object.keys(obj.sessions[i]).length == 0) { delete obj.sessions[i]; } }
        if (Object.keys(obj.sessions).length == 0) { delete obj.sessions; }

        // Event the new sessions, this will notify everyone that agent sessions have changed
        var event = { etype: 'node', action: 'devicesessions', nodeid: obj.dbNodeKey, domain: domain.id, sessions: obj.sessions, nolog: 1 };
        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(obj.dbMeshKey, [obj.dbNodeKey]), obj, event);
    }

    // Change the current core information string and event it
    function ChangeAgentCoreInfo(command) {
        if ((obj.agentInfo == null) || (obj.agentInfo.capabilities & 0x40)) return;
        if ((command == null) || (command == null)) return; // Safety, should never happen.

        // If the device is pending a change, hold.
        if (obj.deviceChanging === true) { setTimeout(function () { ChangeAgentCoreInfo(command); }, 100); return; }
        obj.deviceChanging = true;

        // Check that the mesh exists
        const mesh = parent.meshes[obj.dbMeshKey];
        if (mesh == null) { delete obj.deviceChanging; return; }

        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) { // TODO: THIS IS A BIG RACE CONDITION HERE, WE NEED TO FIX THAT. If this call is made twice at the same time on the same device, data will be missed.
            if ((nodes == null) || (nodes.length != 1)) { delete obj.deviceChanging; return; }
            const device = nodes[0];
            if (device.agent) {
                var changes = [], change = 0, log = 0;

                // Check if anything changes
                if (command.name && (typeof command.name == 'string') && (command.name != device.name)) { change = 1; log = 1; device.name = command.name; changes.push('name'); }
                if ((command.caps != null) && (device.agent.core != command.value)) { if ((command.value == null) && (device.agent.core != null)) { delete device.agent.core; } else { device.agent.core = command.value; } change = 1; } // Don't save this as an event to the db.
                if ((command.caps != null) && ((device.agent.caps & 0xFFFFFFE7) != (command.caps & 0xFFFFFFE7))) { device.agent.caps = ((device.agent.caps & 24) + (command.caps & 0xFFFFFFE7)); change = 1; } // Allow Javascript on the agent to change all capabilities except console and javascript support, Don't save this as an event to the db.
                if ((command.osdesc != null) && (typeof command.osdesc == 'string') && (device.osdesc != command.osdesc)) { device.osdesc = command.osdesc; change = 1; changes.push('os desc'); } // Don't save this as an event to the db.
                if ((typeof command.root == 'boolean') && (command.root !== device.agent.root)) { change = 1; device.agent.root = command.root; }
                if (device.ip != obj.remoteaddr) { device.ip = obj.remoteaddr; change = 1; }
                if (command.intelamt) {
                    if (!device.intelamt) { device.intelamt = {}; }
                    if ((command.intelamt.Versions != null) && (typeof command.intelamt.Versions == 'object')) {
                        if ((command.intelamt.Versions.AMT != null) && (typeof command.intelamt.Versions.AMT == 'string') && (command.intelamt.Versions.AMT.length < 12) && (device.intelamt.ver != command.intelamt.Versions.AMT)) { changes.push('AMT version'); device.intelamt.ver = command.intelamt.Versions.AMT; change = 1; log = 1; }
                        if ((command.intelamt.Versions.Sku != null) && (typeof command.intelamt.Versions.Sku == 'string')) { var sku = parseInt(command.intelamt.Versions.Sku); if (device.intelamt.sku !== command.intelamt.sku) { device.intelamt.sku = sku; change = 1; log = 1; } }
                    }
                    if ((command.intelamt.ProvisioningState != null) && (typeof command.intelamt.ProvisioningState == 'number') && (device.intelamt.state != command.intelamt.ProvisioningState)) { changes.push('AMT state'); device.intelamt.state = command.intelamt.ProvisioningState; change = 1; log = 1; }
                    if ((command.intelamt.Flags != null) && (typeof command.intelamt.Flags == 'number') && (device.intelamt.flags != command.intelamt.Flags)) {
                        if (device.intelamt.flags) { changes.push('AMT flags (' + device.intelamt.flags + ' --> ' + command.intelamt.Flags + ')'); } else { changes.push('AMT flags (' + command.intelamt.Flags + ')'); }
                        device.intelamt.flags = command.intelamt.Flags; change = 1; log = 1;
                    }
                    if ((command.intelamt.UUID != null) && (typeof command.intelamt.UUID == 'string') && (device.intelamt.uuid != command.intelamt.UUID)) { changes.push('AMT uuid'); device.intelamt.uuid = command.intelamt.UUID; change = 1; log = 1; }
                }
                if (command.av != null) { // Antivirus
                    if (!device.av) { device.av = []; }
                    if (JSON.stringify(device.av) != JSON.stringify(command.av)) { /*changes.push('AV status');*/ device.av = command.av; change = 1; log = 1; }
                }
                if (command.wsc != null) { // Windows Security Center
                    if (!device.wsc) { device.wsc = {}; }
                    if (JSON.stringify(device.wsc) != JSON.stringify(command.wsc)) { /*changes.push('Windows Security Center status');*/ device.wsc = command.wsc; change = 1; log = 1; }
                }

                // Push Messaging Token
                if ((command.pmt != null) && (typeof command.pmt == 'string') && (device.pmt != command.pmt)) {
                    if (typeof device.pmt == 'string') { db.Remove('pmt_' + device.pmt); }
                    device.pmt = command.pmt;
                    change = 1; // Don't save this change as an event to the db, so no log=1.
                    parent.removePmtFromAllOtherNodes(device); // We need to make sure to remove this push messaging token from any other device on this server, all domains included.
                }

                if ((command.users != null) && (Array.isArray(command.users)) && (device.users != command.users)) { device.users = command.users; change = 1; } // Don't save this to the db.
                if ((mesh.mtype == 2) && (!args.wanonly)) {
                    // In WAN mode, the hostname of a computer is not important. Don't log hostname changes.
                    if (device.host != obj.remoteaddr) { device.host = obj.remoteaddr; change = 1; changes.push('host'); }
                    // TODO: Check that the agent has an interface that is the same as the one we got this websocket connection on. Only set if we have a match.
                }

                // If there are changes, event the new device
                if (change == 1) {
                    // Do some clean up if needed, these values should not be in the database.
                    if (device.conn != null) { delete device.conn; }
                    if (device.pwr != null) { delete device.pwr; }
                    if (device.agct != null) { delete device.agct; }
                    if (device.cict != null) { delete device.cict; }

                    // Save to the database
                    db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, node: parent.CloneSafeNode(device) };
                    if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    if ((log == 0) || ((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(device.meshid, [obj.dbNodeKey]), obj, event);
                }

                // Device change is done.
                delete obj.deviceChanging;
            }
        });
    }

    // Change the current core information string and event it
    function ChangeAgentLocationInfo(command) {
        if (obj.agentInfo.capabilities & 0x40) return;
        if ((command == null) || (command == null)) { return; } // Safety, should never happen.

        // Check that the mesh exists
        const mesh = parent.meshes[obj.dbMeshKey];
        if (mesh == null) return;

        // If the device is pending a change, hold.
        if (obj.deviceChanging === true) { setTimeout(function () { ChangeAgentLocationInfo(command); }, 100); return; }
        obj.deviceChanging = true;

        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { delete obj.deviceChanging; return; }
            const device = nodes[0];
            if (device.agent) {
                var changes = [], change = 0;

                // Check if anything changes
                if ((command.publicip) && (device.publicip != command.publicip)) { device.publicip = command.publicip; change = 1; changes.push('public ip'); }
                if ((command.iploc) && (device.iploc != command.iploc)) { device.iploc = command.iploc; change = 1; changes.push('ip location'); }

                // If there are changes, save and event
                if (change == 1) {
                    // Do some clean up if needed, these values should not be in the database.
                    if (device.conn != null) { delete device.conn; }
                    if (device.pwr != null) { delete device.pwr; }
                    if (device.agct != null) { delete device.agct; }
                    if (device.cict != null) { delete device.cict; }

                    // Save the device
                    db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, node: parent.CloneSafeNode(device), msgid: 59, msgArgs: [device.name, mesh.name, changes.join(', ')], msg: 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', ') };
                    if (obj.agentInfo.capabilities & 0x20) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(device.meshid, [obj.dbNodeKey]), obj, event);
                }
            }

            // Done changing the device
            delete obj.deviceChanging;
        });
    }

    // Update the mesh agent tab in the database
    function ChangeAgentTag(tag) {
        if ((obj.agentInfo == null) || (obj.agentInfo.capabilities & 0x40)) return;
        if ((tag != null) && (tag.length == 0)) { tag = null; }

        // If the device is pending a change, hold.
        if (obj.deviceChanging === true) {
            var func = function ChangeAgentTagFunc() { ChangeAgentCoreInfo(ChangeAgentTagFunc.tag); }
            func.tag = tag;
            setTimeout(func, 100);
            return;
        }
        obj.deviceChanging = true;

        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { delete obj.deviceChanging; return; }
            const device = nodes[0];
            if (device.agent) {
                // Parse the agent tag
                var agentTag = null, serverName = null, serverDesc = null, serverTags = null;
                if (tag != null) {
                    var taglines = tag.split('\r\n').join('\n').split('\r').join('\n').split('\n');
                    for (var i in taglines) {
                        var tagline = taglines[i].trim();
                        if (tagline.length > 0) {
                            if (tagline.startsWith('~')) {
                                if (tagline.startsWith('~ServerName:') && (tagline.length > 12) && (serverName == null)) { serverName = tagline.substring(12).trim(); }
                                if (tagline.startsWith('~ServerDesc:') && (tagline.length > 12) && (serverDesc == null)) { serverDesc = tagline.substring(12).trim(); }
                                if (tagline.startsWith('~ServerTags:') && (tagline.length > 12) && (serverTags == null)) { serverTags = tagline.substring(12).split(','); for (var j in serverTags) { serverTags[j] = serverTags[j].trim(); } }
                            } else { if (agentTag == null) { agentTag = tagline; } }
                        }
                    }
                }

                // Set the agent tag
                var changes = false;
                if (device.agent.tag != agentTag) { device.agent.tag = agentTag; if ((device.agent.tag == null) || (device.agent.tag == '')) { delete device.agent.tag; } changes = true; }
                if (domain.agenttag != null) {
                    // Set the device's server name
                    if ((serverName != null) && (domain.agenttag.servername === 1) && (device.name != serverName)) { device.name = serverName; changes = true; }

                    // Set the device's server description
                    if ((serverDesc != null) && (domain.agenttag.serverdesc === 1) && (device.desc != serverDesc)) { device.desc = serverDesc; changes = true; }

                    // Set the device's server description if there is no description
                    if ((serverDesc != null) && (domain.agenttag.serverdesc === 2) && (device.desc != serverDesc) && ((device.desc == null) || (device.desc == ''))) { device.desc = serverDesc; changes = true; }

                    if ((serverTags != null) && (domain.agenttag.servertags != null) && (domain.agenttag.servertags != 0)) {
                        // Sort the tags
                        serverTags.sort();

                        // Stringify the tags
                        var st2 = '', st1 = serverTags.join(',');
                        if (device.tags != null) { st2 = device.tags.join(','); }

                        // Set the device's server tags
                        if ((domain.agenttag.servertags === 1) && (st1 != st2)) { device.tags = serverTags; changes = true; }

                        // Set the device's server tags if there are not tags
                        if ((domain.agenttag.servertags === 2) && (st2 == '')) { device.tags = serverTags; changes = true; }

                        // Append to device's server tags
                        if ((domain.agenttag.servertags === 3) && (st1 != st2)) {
                            if (device.tags == null) { device.tags = []; }
                            for (var i in serverTags) { if (device.tags.indexOf(serverTags[i]) == -1) { device.tags.push(serverTags[i]); } }
                            device.tags.sort();
                            changes = true;
                        }
                    }
                }

                if (changes == true) {
                    // Do some clean up if needed, these values should not be in the database.
                    if (device.conn != null) { delete device.conn; }
                    if (device.pwr != null) { delete device.pwr; }
                    if (device.agct != null) { delete device.agct; }
                    if (device.cict != null) { delete device.cict; }

                    // Update the device
                    db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, node: parent.CloneSafeNode(device), nolog: 1 };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(device.meshid, [obj.dbNodeKey]), obj, event);
                }
            }

            // Done changing the device
            delete obj.deviceChanging;
        });
    }

    // Check if we need to update this agent, return true if agent binary update required.
    // Return 0 is no update needed, 1 update using native system, 2 update using meshcore system
    function compareAgentBinaryHash(agentExeInfo, agentHash) {
        // If this is a temporary agent and the server is set to not update temporary agents, don't update the agent.
        if ((obj.agentInfo.capabilities & 0x20) && (args.temporaryagentupdate === false)) return 0;
        // If we are testing the agent update system, always return true
        if ((args.agentupdatetest === true) || (args.agentupdatetest === 1)) return 1;
        if (args.agentupdatetest === 2) return 2;
        // If the hash matches or is null, no update required.
        if ((agentExeInfo.hash == agentHash) || (agentHash == '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')) return 0;
        // If this is a macOS x86 or ARM agent type and it matched the universal binary, no update required.
        if ((agentExeInfo.id == 16) || (agentExeInfo.id == 29)) {
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[10005]) {
                if (domain.meshAgentBinaries[10005].hash == agentHash) return 0;
            } else {
                if (parent.parent.meshAgentBinaries[10005].hash == agentHash) return 0;
            }
        }

        // No match, update the agent.
        if (args.agentupdatesystem === 2) return 2; // If set, force a meshcore update.
        if (agentExeInfo.id == 3) return 2; // Due to a bug in Windows 7 SP1 environement variable exec, we always update 32bit Windows agent using MeshCore for now. Upcoming agent will have a fix for this.
        // NOTE: Windows agents with no commit dates may have bad native update system, so use meshcore system instead.
        // NOTE: Windows agents with commit date prior to 1612740413000 did not kill all "meshagent.exe" processes and update could fail as a result executable being locked, meshcore system will do this.
        if (((obj.AgentCommitDate == null) || (obj.AgentCommitDate < 1612740413000)) && ((agentExeInfo.id == 3) || (agentExeInfo.id == 4))) return 2; // For older Windows agents, use the meshcore update technique.
        return 1; // By default, use the native update technique.
    }

    // Request that the core dump file on this agent be uploaded to the server
    obj.RequestCoreDump = function (agenthashhex, corehashhex) {
        if (agenthashhex.length > 16) { agenthashhex = agenthashhex.substring(0, 16); }
        const cookie = parent.parent.encodeCookie({ a: 'aft', b: 'coredump', c: obj.agentInfo.agentId + '-' + agenthashhex + '-' + obj.nodeid + '.dmp' }, parent.parent.loginCookieEncryptionKey);
        obj.send('{"action":"msg","type":"tunnel","value":"*/' + (((domain.dns == null) && (domain.id != '')) ? (domain.id + '/') : '') + 'agenttransfer.ashx?c=' + cookie + '","rights":"4294967295"}');
    }

    // Return true if we need to ignore the agent hash check
    function isIgnoreHashCheck() {
        if ((args.ignoreagenthashcheck === true) || (domain.ignoreagenthashcheck === true)) return true;

        // Check site wide exceptions
        if (Array.isArray(args.ignoreagenthashcheck)) {
            for (var i = 0; i < args.ignoreagenthashcheck.length; i++) {
                if (require('ipcheck').match(obj.remoteaddr, args.ignoreagenthashcheck[i])) return true;
            }
        }

        // Check domain wide exceptions
        if (Array.isArray(domain.ignoreagenthashcheck)) {
            for (var i = 0; i < domain.ignoreagenthashcheck.length; i++) {
                if (require('ipcheck').match(obj.remoteaddr, domain.ignoreagenthashcheck[i])) return true;
            }
        }

        return false;
    }

    // Generate a random Intel AMT password
    function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
    function getRandomAmtPassword() { var p; do { p = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }

    return obj;
};
