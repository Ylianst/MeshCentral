/**
* @description MeshCentral MeshAgent communication module
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2019
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
    const agentUpdateBlockSize = 65531;
    parent.agentStats.createMeshAgentCount++;

    var obj = {};
    obj.domain = domain;
    obj.authenticated = 0;
    obj.receivedCommands = 0;
    obj.agentCoreCheck = 0;
    obj.remoteaddr = (req.ip.startsWith('::ffff:')) ? (req.ip.substring(7)) : req.ip;
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

    // Send a message to the mesh agent
    obj.send = function (data, func) { try { if (typeof data == 'string') { ws.send(Buffer.from(data), func); } else { ws.send(data, func); } } catch (e) { } };
    obj.sendBinary = function (data, func) { try { if (typeof data == 'string') { ws.send(Buffer.from(data, 'binary'), func); } else { ws.send(data, func); } } catch (e) { } };

    // Disconnect this agent
    obj.close = function (arg) {
        obj.authenticated = -1;
        if ((arg == 1) || (arg == null)) { try { ws.close(); if (obj.nodeid != null) { parent.parent.debug(1, 'Soft disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); } } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); if (obj.nodeid != null) { parent.parent.debug(1, 'Hard disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); } } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        // If arg == 3, don't communicate with this agent anymore, but don't disconnect (Duplicate agent).

        // Remove this agent from the webserver list
        if (parent.wsagents[obj.dbNodeKey] == obj) {
            delete parent.wsagents[obj.dbNodeKey];
            parent.parent.ClearConnectivityState(obj.dbMeshKey, obj.dbNodeKey, 1);
        }

        // Get the current mesh
        const mesh = parent.meshes[obj.dbMeshKey];

        // If this is a temporary or recovery agent, or all devices in this group are temporary, remove the agent (0x20 = Temporary, 0x40 = Recovery)
        if (((obj.agentInfo) && (obj.agentInfo.capabilities) && ((obj.agentInfo.capabilities & 0x20) || (obj.agentInfo.capabilities & 0x40))) || ((mesh) && (mesh.flags) && (mesh.flags & 1))) {
            // Delete this node including network interface information and events
            db.Remove(obj.dbNodeKey);                       // Remove node with that id
            db.Remove('if' + obj.dbNodeKey);                // Remove interface information
            db.Remove('nt' + obj.dbNodeKey);                // Remove notes
            db.Remove('lc' + obj.dbNodeKey);                // Remove last connect time
            db.Remove('si' + obj.dbNodeKey);                // Remove system information
            db.RemoveSMBIOS(obj.dbNodeKey);                 // Remove SMBios data
            db.RemoveAllNodeEvents(obj.dbNodeKey);          // Remove all events for this node
            db.removeAllPowerEventsForNode(obj.dbNodeKey);  // Remove all power events for this node

            // Event node deletion
            parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'removenode', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 });

            // Disconnect all connections if needed
            const state = parent.parent.GetConnectivityState(obj.dbNodeKey);
            if ((state != null) && (state.connectivity != null)) {
                if ((state.connectivity & 1) != 0) { parent.wsagents[obj.dbNodeKey].close(); } // Disconnect mesh agent
                if ((state.connectivity & 2) != 0) { parent.parent.mpsserver.close(parent.parent.mpsserver.ciraConnections[obj.dbNodeKey]); } // Disconnect CIRA connection
            }
        } else {
            // Update the last connect time
            if (obj.authenticated == 2) { db.Set({ _id: 'lc' + obj.dbNodeKey, type: 'lastconnect', domain: domain.id, time: obj.connectTime, addr: obj.remoteaddrport }); }
        }

        // If we where updating the agent, clean that up.
        if (obj.agentUpdate != null) {
            if (obj.agentUpdate.fd) { try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { } }
            parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
            delete obj.agentUpdate.buf;
            delete obj.agentUpdate;
        }

        // Perform timer cleanup
        if (obj.pingtimer) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Perform aggressive cleanup
        if (obj.nonce) { delete obj.nonce; }
        if (obj.nodeid) { delete obj.nodeid; }
        if (obj.unauth) { delete obj.unauth; }
        if (obj.remoteaddr) { delete obj.remoteaddr; }
        if (obj.remoteaddrport) { delete obj.remoteaddrport; }
        if (obj.meshid) { delete obj.meshid; }
        if (obj.dbNodeKey) { delete obj.dbNodeKey; }
        if (obj.dbMeshKey) { delete obj.dbMeshKey; }
        if (obj.connectTime) { delete obj.connectTime; }
        if (obj.agentInfo) { delete obj.agentInfo; }
        if (obj.agentExeInfo) { delete obj.agentExeInfo; }
        ws.removeAllListeners(["message", "close", "error"]);
    };

    // When data is received from the mesh agent web socket
    ws.on('message', function (msg) {
        if (msg.length < 2) return;
        if (typeof msg == 'object') { msg = msg.toString('binary'); } // TODO: Could change this entire method to use Buffer instead of binary string

        if (obj.authenticated == 2) { // We are authenticated
            if ((obj.agentUpdate == null) && (msg.charCodeAt(0) == 123)) { processAgentData(msg); } // Only process JSON messages if meshagent update is not in progress
            if (msg.length < 2) return;
            const cmdid = common.ReadShort(msg, 0);
            if (cmdid == 11) { // MeshCommand_CoreModuleHash
                if (msg.length == 4) { ChangeAgentCoreInfo({ "caps": 0 }); } // If the agent indicated that no core is running, clear the core information string.
                // Mesh core hash, sent by agent with the hash of the current mesh core.

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
                if (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId] != null) {
                    if (obj.agentCoreCheck == 1001) {
                        // If the user asked, use the recovery core.
                        corename = parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].rcore;
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
                        if ((obj.agentCoreCheck < 5) || (obj.agentCoreCheck == 1001)) {
                            if (meshcorehash == null) {
                                // Clear the core
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0)); // MeshCommand_CoreModule, ask mesh agent to clear the core
                                parent.agentStats.clearingCoreCount++;
                                parent.parent.debug(1, 'Clearing core');
                            } else {
                                // Update new core
                                //obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + meshcorehash + parent.parent.defaultMeshCores[corename]); // MeshCommand_CoreModule, start core update
                                //parent.parent.debug(1, 'Updating code ' + corename);

                                // Update new core with task limiting so not to flood the server. This is a high priority task.
                                obj.agentCoreUpdatePending = true;
                                parent.parent.taskLimiter.launch(function (argument, taskid, taskLimiterQueue) {
                                    if (obj.authenticated == 2) {
                                        // Send the updated code.
                                        delete obj.agentCoreUpdatePending;
                                        obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + argument.hash + argument.core, function () { parent.parent.taskLimiter.completed(taskid); }); // MeshCommand_CoreModule, start core update
                                        parent.agentStats.updatingCoreCount++;
                                        parent.parent.debug(1, 'Updating core ' + argument.name);
                                        agentCoreIsStable();
                                    } else {
                                        // This agent is probably disconnected, nothing to do.
                                        parent.parent.taskLimiter.completed(taskid);
                                    }
                                }, { hash: meshcorehash, core: parent.parent.defaultMeshCores[corename], name: corename }, 0);
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
                            if (parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].amt == true) {
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
                    if ((agenthash != obj.agentExeInfo.hash) && (agenthash != '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')) {
                        // Mesh agent update required, do it using task limiter so not to flood the network. Medium priority task.
                        parent.parent.taskLimiter.launch(function (argument, taskid, taskLimiterQueue) {
                            if (obj.authenticated != 2) { parent.parent.taskLimiter.completed(taskid); return; } // If agent disconnection, complete and exit now.
                            if (obj.nodeid != null) { parent.parent.debug(1, 'Agent update required, NodeID=0x' + obj.nodeid.substring(0, 16) + ', ' + obj.agentExeInfo.desc); }
                            parent.agentStats.agentBinaryUpdate++;
                            if (obj.agentExeInfo.data == null) {
                                // Read the agent from disk
                                parent.fs.open(obj.agentExeInfo.path, 'r', function (err, fd) {
                                    if (obj.agentExeInfo == null) return; // Agent disconnected during this call.
                                    if (err) { return console.error(err); }
                                    obj.agentUpdate = { ptr: 0, buf: Buffer.alloc(agentUpdateBlockSize + 4), fd: fd, taskid: taskid };

                                    // MeshCommand_CoreModule, ask mesh agent to clear the core.
                                    // The new core will only be sent after the agent updates.
                                    obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));

                                    // We got the agent file open on the server side, tell the agent we are sending an update starting with the SHA384 hash of the result
                                    //console.log("Agent update file open.");
                                    obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0)); // Command 13, start mesh agent download

                                    // Send the first mesh agent update data block
                                    obj.agentUpdate.buf[0] = 0;
                                    obj.agentUpdate.buf[1] = 14;
                                    obj.agentUpdate.buf[2] = 0;
                                    obj.agentUpdate.buf[3] = 1;
                                    parent.fs.read(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, agentUpdateBlockSize, obj.agentUpdate.ptr, function (err, bytesRead, buffer) {
                                        if ((err != null) || (bytesRead == 0)) {
                                            // Error reading the agent file, stop here.
                                            try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { }
                                            parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                            delete obj.agentUpdate.buf;
                                            delete obj.agentUpdate;
                                        } else {
                                            // Send the first block to the agent
                                            obj.agentUpdate.ptr += bytesRead;
                                            //console.log("Agent update send first block: " + bytesRead);
                                            obj.sendBinary(obj.agentUpdate.buf); // Command 14, mesh agent first data block
                                        }
                                    });
                                });
                            } else {
                                // Send the agent from RAM
                                obj.agentUpdate = { ptr: 0, buf: Buffer.alloc(agentUpdateBlockSize + 4), taskid: taskid };

                                // MeshCommand_CoreModule, ask mesh agent to clear the core.
                                // The new core will only be sent after the agent updates.
                                obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));

                                // We got the agent file open on the server side, tell the agent we are sending an update starting with the SHA384 hash of the result
                                obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0)); // Command 13, start mesh agent download

                                // Send the first mesh agent update data block
                                obj.agentUpdate.buf[0] = 0;
                                obj.agentUpdate.buf[1] = 14;
                                obj.agentUpdate.buf[2] = 0;
                                obj.agentUpdate.buf[3] = 1;

                                const len = Math.min(agentUpdateBlockSize, obj.agentExeInfo.data.length - obj.agentUpdate.ptr);
                                if (len > 0) {
                                    // Send the first block
                                    obj.agentExeInfo.data.copy(obj.agentUpdate.buf, 4, obj.agentUpdate.ptr, obj.agentUpdate.ptr + len);
                                    obj.agentUpdate.ptr += len;
                                    obj.sendBinary(obj.agentUpdate.buf); // Command 14, mesh agent first data block
                                } else {
                                    // Error
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
                            parent.fs.read(obj.agentUpdate.fd, obj.agentUpdate.buf, 4, agentUpdateBlockSize, obj.agentUpdate.ptr, function (err, bytesRead, buffer) {
                                if ((obj.agentExeInfo == null) || (obj.agentUpdate == null)) return; // Agent disconnected during this async call.
                                if ((err != null) || (bytesRead < 0)) {
                                    // Error reading the agent file, stop here.
                                    try { parent.fs.close(obj.agentUpdate.fd); } catch (ex) { }
                                    parent.parent.taskLimiter.completed(obj.agentUpdate.taskid); // Indicate this task complete
                                    delete obj.agentUpdate.buf;
                                    delete obj.agentUpdate;
                                } else {
                                    // Send the next block to the agent
                                    obj.agentUpdate.ptr += bytesRead;
                                    //console.log("Agent update send next block", obj.agentUpdate.ptr, bytesRead);
                                    if (bytesRead == agentUpdateBlockSize) { obj.sendBinary(obj.agentUpdate.buf); } else { obj.sendBinary(obj.agentUpdate.buf.slice(0, bytesRead + 4)); } // Command 14, mesh agent next data block
                                    if (bytesRead < agentUpdateBlockSize) {
                                        //console.log("Agent update sent from disk.");
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
                            const len = Math.min(agentUpdateBlockSize, obj.agentExeInfo.data.length - obj.agentUpdate.ptr);
                            if (len > 0) {
                                obj.agentExeInfo.data.copy(obj.agentUpdate.buf, 4, obj.agentUpdate.ptr, obj.agentUpdate.ptr + len);
                                if (len == agentUpdateBlockSize) { obj.sendBinary(obj.agentUpdate.buf); } else { obj.sendBinary(obj.agentUpdate.buf.slice(0, len + 4)); } // Command 14, mesh agent next data block
                                obj.agentUpdate.ptr += len;
                            }

                            if (obj.agentUpdate.ptr == obj.agentExeInfo.data.length) {
                                //console.log("Agent update sent from RAM.");
                                obj.sendBinary(common.ShortToStr(13) + common.ShortToStr(0) + obj.agentExeInfo.hash); // Command 13, end mesh agent download, send agent SHA384 hash
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
            const cmd = common.ReadShort(msg, 0);
            if (cmd == 1) {
                // Agent authentication request
                if ((msg.length != 98) || ((obj.receivedCommands & 1) != 0)) return;
                obj.receivedCommands += 1; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                if (args.ignoreagenthashcheck === true) {
                    // Send the agent web hash back to the agent
                    obj.sendBinary(common.ShortToStr(1) + msg.substring(2, 50) + obj.nonce); // Command 1, hash + nonce. Use the web hash given by the agent.
                } else {
                    // Check that the server hash matches our own web certificate hash (SHA384)
                    if ((getWebCertHash(domain) != msg.substring(2, 50)) && (getWebCertFullHash(domain) != msg.substring(2, 50))) {
                        parent.agentStats.agentBadWebCertHashCount++;
                        console.log('Agent bad web cert hash (Agent:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex').substring(0, 10)) + ' != Server:' + (Buffer.from(getWebCertHash(domain), 'binary').toString('hex').substring(0, 10)) + ' or ' + (new Buffer(getWebCertFullHash(domain), 'binary').toString('hex').substring(0, 10)) + '), holding connection (' + obj.remoteaddrport + ').');
                        console.log('Agent reported web cert hash:' + (Buffer.from(msg.substring(2, 50), 'binary').toString('hex')) + '.');
                        return;
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
                try { obj.unauth.nodeid = Buffer.from(forge.pki.getPublicKeyFingerprint(forge.pki.certificateFromAsn1(forge.asn1.fromDer(msg.substring(4, 4 + certlen))).publicKey, { md: forge.md.sha384.create() }).data, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); } catch (ex) { console.log(ex); return; }
                obj.unauth.nodeCertPem = '-----BEGIN CERTIFICATE-----\r\n' + Buffer.from(msg.substring(4, 4 + certlen), 'binary').toString('base64') + '\r\n-----END CERTIFICATE-----';

                // Check the agent signature if we can
                if (obj.agentnonce == null) { obj.unauthsign = msg.substring(4 + certlen); } else {
                    if (processAgentSignature(msg.substring(4 + certlen)) == false) {
                        parent.agentStats.agentBadSignature2Count++;
                        console.log('Agent connected with bad signature, holding connection (' + obj.remoteaddrport + ').'); return;
                    }
                }
                completeAgentConnection();
            }
            else if (cmd == 3) {
                // Agent meshid
                if ((msg.length < 72) || ((obj.receivedCommands & 4) != 0)) return;
                obj.receivedCommands += 4; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Set the meshid
                obj.agentInfo = {};
                obj.agentInfo.infoVersion = common.ReadInt(msg, 2);
                obj.agentInfo.agentId = common.ReadInt(msg, 6);
                obj.agentInfo.agentVersion = common.ReadInt(msg, 10);
                obj.agentInfo.platformType = common.ReadInt(msg, 14);
                if (obj.agentInfo.platformType > 6 || obj.agentInfo.platformType < 1) { obj.agentInfo.platformType = 1; }
                if (msg.substring(50, 66) == '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0') {
                    obj.meshid = Buffer.from(msg.substring(18, 50), 'binary').toString('hex'); // Older HEX MeshID
                } else {
                    obj.meshid = Buffer.from(msg.substring(18, 66), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); // New Base64 MeshID
                }
                //console.log('MeshID', obj.meshid);
                obj.agentInfo.capabilities = common.ReadInt(msg, 66);
                const computerNameLen = common.ReadShort(msg, 70);
                obj.agentInfo.computerName = msg.substring(72, 72 + computerNameLen);
                obj.dbMeshKey = 'mesh/' + domain.id + '/' + obj.meshid;
                completeAgentConnection();
            } else if (cmd == 4) {
                if ((msg.length < 2) || ((obj.receivedCommands & 8) != 0)) return;
                obj.receivedCommands += 8; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.
                // Agent already authenticated the server, wants to skip the server signature - which is great for server performance.
            } else if (cmd == 5) {
                // ServerID. Agent is telling us what serverid it expects. Useful if we have many server certificates.
                if ((msg.substring(2, 34) == parent.swarmCertificateHash256) || (msg.substring(2, 50) == parent.swarmCertificateHash384)) { obj.useSwarmCert = true; }
            }
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { console.log('AGENT WSERR: ' + err); obj.close(0); });

    // If the mesh agent web socket is closed, clean up.
    ws.on('close', function (req) {
        parent.agentStats.agentClose++;
        if (obj.nodeid != null) {
            const agentId = (obj.agentInfo && obj.agentInfo.agentId) ? obj.agentInfo.agentId : 'Unknown';
            //console.log('Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ') id=' + agentId);
            parent.parent.debug(1, 'Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddrport + ') id=' + agentId);

            // Log the agent disconnection
            if (parent.wsagentsDisconnections[obj.nodeid] == null) {
                parent.wsagentsDisconnections[obj.nodeid] = 1;
            } else {
                parent.wsagentsDisconnections[obj.nodeid] = ++parent.wsagentsDisconnections[obj.nodeid];
            }
        }
        obj.close(0);
    });

    // Start authenticate the mesh agent by sending a auth nonce & server TLS cert hash.
    // Send 384 bits SHA384 hash of TLS cert public key + 384 bits nonce
    if (args.ignoreagenthashcheck !== true) {
        obj.sendBinary(common.ShortToStr(1) + getWebCertHash(domain) + obj.nonce); // Command 1, hash + nonce
    }

    // Return the mesh for this device, in some cases, we may auto-create the mesh.
    function getMeshAutoCreate() {
        var mesh = parent.meshes[obj.dbMeshKey];
        if ((mesh == null) && (typeof domain.orphanagentuser == 'string')) {
            const adminUser = parent.users['user/' + domain.id + '/' + domain.orphanagentuser.toLowerCase()];
            if ((adminUser != null) && (adminUser.siteadmin == 0xFFFFFFFF)) {
                // Mesh name is hex instead of base64
                const meshname = obj.meshid.substring(0, 18);

                // Create a new mesh for this device
                const links = {};
                links[adminUser._id] = { name: adminUser.name, rights: 0xFFFFFFFF };
                mesh = { type: 'mesh', _id: obj.dbMeshKey, name: meshname, mtype: 2, desc: '', domain: domain.id, links: links };
                db.Set(common.escapeLinksFieldName(mesh));
                parent.meshes[obj.dbMeshKey] = mesh;

                if (adminUser.links == null) adminUser.links = {};
                adminUser.links[obj.dbMeshKey] = { rights: 0xFFFFFFFF };
                db.SetUser(adminUser);
                parent.parent.DispatchEvent(['*', obj.dbMeshKey, adminUser._id], obj, { etype: 'mesh', username: adminUser.name, meshid: obj.dbMeshKey, name: meshname, mtype: 2, desc: '', action: 'createmesh', links: links, msg: 'Mesh created: ' + obj.meshid, domain: domain.id });
            }
        } else {
            if ((mesh != null) && (mesh.deleted != null) && (mesh.links)) {
                // Must un-delete this mesh
                var ids = ['*', mesh._id];

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
                parent.parent.DispatchEvent(ids, obj, { etype: 'mesh', meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'createmesh', links: mesh.links, msg: 'Mesh undeleted: ' + mesh._id, domain: domain.id });

                // Mark the mesh as active
                delete mesh.deleted;
                db.Set(common.escapeLinksFieldName(mesh));
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
                    db.Set(common.escapeLinksFieldName(mesh));
                    parent.meshes[obj.meshid] = mesh;
                    parent.parent.AddEventDispatch([obj.meshid], ws);

                    if (adminUser.links == null) user.links = {};
                    adminUser.links[obj.meshid] = { rights: 0xFFFFFFFF };
                    //adminUser.subscriptions = parent.subscribe(adminUser._id, ws);
                    db.SetUser(user);
                    parent.parent.DispatchEvent(['*', meshid, user._id], obj, { etype: 'mesh', username: user.name, meshid: obj.meshid, name: obj.meshid, mtype: 2, desc: '', action: 'createmesh', links: links, msg: 'Mesh created: ' + obj.meshid, domain: domain.id });
                }
            }

            if (holdConnection == true) {
                // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                return;
            }
        } 
        if (mesh.mtype != 2) { console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').'); return; } // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.
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

                // This device exists, meshid given by the device must be ignored, use the server side one.
                if (device.meshid != obj.dbMeshKey) {
                    obj.dbMeshKey = device.meshid;
                    obj.meshid = device.meshid.split('/')[2];
                }

                // See if this mesh exists, if it does not we may want to create it.
                mesh = getMeshAutoCreate();

                // Check if the mesh exists
                if (mesh == null) {
                    // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                    parent.agentStats.invalidDomainMesh2Count++;
                    console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
                    return;
                }

                // Check if the mesh is the right type
                if (mesh.mtype != 2) {
                    // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
                    parent.agentStats.invalidMeshType2Count++;
                    console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
                    return;
                } 

                // Mark when this device connected
                obj.connectTime = Date.now();
                db.Set({ _id: 'lc' + obj.dbNodeKey, type: 'lastconnect', domain: domain.id, time: obj.connectTime, addr: obj.remoteaddrport });

                // Device already exists, look if changes have occured
                var changes = [], change = 0, log = 0;
                if (device.agent == null) { device.agent = { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }; change = 1; }
                if (device.rname != obj.agentInfo.computerName) { device.rname = obj.agentInfo.computerName; change = 1; changes.push('computer name'); }
                if (device.agent.ver != obj.agentInfo.agentVersion) { device.agent.ver = obj.agentInfo.agentVersion; change = 1; changes.push('agent version'); }
                if (device.agent.id != obj.agentInfo.agentId) { device.agent.id = obj.agentInfo.agentId; change = 1; changes.push('agent type'); }
                if ((device.agent.caps & 24) != (obj.agentInfo.capabilities & 24)) { device.agent.caps = obj.agentInfo.capabilities; change = 1; changes.push('agent capabilities'); } // If agent console or javascript support changes, update capabilities
                if (mesh.flags && (mesh.flags & 2) && (device.name != obj.agentInfo.computerName)) { device.name = obj.agentInfo.computerName; change = 1; } // We want the server name to be sync'ed to the hostname

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
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id };
                    if (log == 0) { event.nolog = 1; } else { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    const device2 = common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(['*', device.meshid], obj, event);
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
            console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddrport + ', ' + obj.dbMeshKey + ').');
            return;
        }

        // Check if the mesh is the right type
        if (mesh.mtype != 2) {
            // If we disconnect, the agent will just reconnect. We need to log this or tell agent to connect in a few hours.
            parent.agentStats.invalidMeshTypeCount++;
            console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddrport + ').');
            return;
        }

        // Mark when this device connected
        obj.connectTime = Date.now();
        db.Set({ _id: 'lc' + obj.dbNodeKey, type: 'lastconnect', domain: domain.id, time: obj.connectTime, addr: obj.remoteaddrport });

        // This node does not exist, create it.
        var device = { type: 'node', mtype: mesh.mtype, _id: obj.dbNodeKey, icon: obj.agentInfo.platformType, meshid: obj.dbMeshKey, name: obj.agentInfo.computerName, rname: obj.agentInfo.computerName, domain: domain.id, agent: { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }, host: null };
        db.Set(device);

        // Event the new node
        if (obj.agentInfo.capabilities & 0x20) {
            // This is a temporary agent, don't log.
            parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'addnode', node: device, domain: domain.id, nolog: 1 });
        } else {
            parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'addnode', node: device, msg: ('Added device ' + obj.agentInfo.computerName + ' to mesh ' + mesh.name), domain: domain.id });
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
            if (obj.nodeid != null) { parent.parent.debug(1, 'Duplicate agent ' + obj.nodeid + ' (' + obj.remoteaddrport + ')'); }
            dupAgent.close(3);
        } else {
            // Indicate the agent is connected
            parent.parent.SetConnectivityState(obj.dbMeshKey, obj.dbNodeKey, obj.connectTime, 1, 1);
        }

        // We are done, ready to communicate with this agent
        delete obj.pendingCompleteAgentConnection;
        obj.authenticated = 2;

        // Check how many times this agent disconnected in the last few minutes.
        const disconnectCount = parent.wsagentsDisconnections[obj.nodeid];
        if (disconnectCount > 6) {
            console.log('Agent in big trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            // TODO: Log or do something to recover?
            return;
        }

        // Command 4, inform mesh agent that it's authenticated.
        obj.sendBinary(common.ShortToStr(4));

        if (disconnectCount > 4) {
            // Too many disconnections, this agent has issues. Just clear the core.
            obj.sendBinary(common.ShortToStr(10) + common.ShortToStr(0));
            //console.log('Agent in trouble: NodeId=' + obj.nodeid + ', IP=' + obj.remoteaddrport + ', Agent=' + obj.agentInfo.agentId + '.');
            // TODO: Log or do something to recover?
            return;
        }

        // Not sure why, but in rare cases, obj.agentInfo is undefined here.
        if ((obj.agentInfo == null) || (typeof obj.agentInfo.capabilities != 'number')) { return; } // This is an odd case.

        // Check if we need to make an native update check
        obj.agentExeInfo = parent.parent.meshAgentBinaries[obj.agentInfo.agentId];
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

    // Take a basic Intel AMT policy and add all server information to it, making it ready to send to this agent.
    function completeIntelAmtPolicy(amtPolicy) {
        var r = amtPolicy;
        if (amtPolicy == null) return null;
        if (amtPolicy.type == 2) {
            // CCM - Add server root certificate
            if (parent.parent.certificates.rootex == null) { parent.parent.certificates.rootex = parent.parent.certificates.root.cert.split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('').split('\r').join('').split('\n').join(''); }
            r.rootcert = parent.parent.certificates.rootex;
            if ((amtPolicy.cirasetup == 2) && (parent.parent.mpsserver != null) && (parent.parent.certificates.AmtMpsName != null) && (args.lanonly != true) && (args.mpsport != 0)) {
                // Add server CIRA settings
                r.ciraserver = {
                    name: parent.parent.certificates.AmtMpsName,
                    port: (typeof args.mpsaliasport == 'number' ? args.mpsaliasport : args.mpsport),
                    user: obj.meshid.replace(/\@/g, 'X').replace(/\$/g, 'X').substring(0, 16),
                    pass: args.mpspass ? args.mpspass : 'A@xew9rt', // If the MPS password is not set, just use anything. TODO: Use the password as an agent identifier?
                    home: ['sdlwerulis3wpj95dfj'] // Use a random FQDN to not have any home network.
                };
                if (Array.isArray(args.ciralocalfqdn)) { r.ciraserver.home = args.ciralocalfqdn; }
            }
        } else if ((amtPolicy.type == 3) && (domain.amtacmactivation.acmmatch)) {
            // ACM - In this mode, don't send much to Intel AMT. Just indicate ACM policy and let the agent try activation when possible.
            r = { type: 3, match: domain.amtacmactivation.acmmatch };
        }
        return r;
    }

    // Send Intel AMT policy
    obj.sendUpdatedIntelAmtPolicy = function (policy) {
        if (obj.agentExeInfo && (obj.agentExeInfo.amt == true)) { // Only send Intel AMT policy to agents what could have AMT.
            if (policy == null) { var mesh = parent.meshes[obj.dbMeshKey]; if (mesh == null) return; policy = mesh.amt; }
            if (policy != null) { try { obj.send(JSON.stringify({ action: 'amtPolicy', amtPolicy: completeIntelAmtPolicy(common.Clone(policy)) })); } catch (ex) { } }
        }
    }

    function recoveryAgentCoreIsStable(mesh) {
        parent.agentStats.recoveryCoreIsStableCount++;

        // Recovery agent is doing ok, lets perform main agent checking.
        //console.log('recoveryAgentCoreIsStable()');

        // Fetch the the real agent nodeid
        db.Get('da' + obj.dbNodeKey, function (err, nodes, self)
        {
            if ((nodes != null) && (nodes.length == 1))
            {
                self.realNodeKey = nodes[0].raid;

                // Get agent connection state
                var agentConnected = false;
                var state = parent.parent.GetConnectivityState(self.realNodeKey);
                if (state) { agentConnected = ((state.connectivity & 1) != 0) }

                self.send(JSON.stringify({ action: 'diagnostic', value: { command: 'query', value: self.realNodeKey, agent: agentConnected } }));
            } else
            {
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

        // Send Intel AMT policy
        if (obj.agentExeInfo && (obj.agentExeInfo.amt == true) && (mesh.amt != null)) {  // Only send Intel AMT policy to agents what could have AMT.
            try { obj.send(JSON.stringify({ action: 'amtPolicy', amtPolicy: completeIntelAmtPolicy(common.Clone(mesh.amt)) })); } catch (ex) { }
        }

        /*
        // Fetch system information
        db.GetHash('si' + obj.dbNodeKey, function (err, results) {
            if ((results != null) && (results.length == 1)) { obj.send(JSON.stringify({ action: 'sysinfo', hash: results[0].hash })); } else { obj.send(JSON.stringify({ action: 'sysinfo' })); }
        });
        */

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
        if (args.ignoreagenthashcheck !== true) {
            var verified = false;

            if (msg.length != 384) {
                // Verify a PKCS7 signature.
                var msgDer = null;
                try { msgDer = forge.asn1.fromDer(forge.util.createBuffer(msg, 'binary')); } catch (ex) { }
                if (msgDer != null) {
                    try {
                        var p7 = forge.pkcs7.messageFromAsn1(msgDer);
                        var sig = p7.rawCapture.signature;

                        // Verify with key hash
                        var buf = Buffer.from(getWebCertHash(domain) + obj.nonce + obj.agentnonce, 'binary');
                        var verifier = parent.crypto.createVerify('RSA-SHA384');
                        verifier.update(buf);
                        verified = verifier.verify(obj.unauth.nodeCertPem, sig, 'binary');
                        if (verified == false) {
                            // Verify with full hash
                            buf = Buffer.from(getWebCertFullHash(domain) + obj.nonce + obj.agentnonce, 'binary');
                            verifier = parent.crypto.createVerify('RSA-SHA384');
                            verifier.update(buf);
                            verified = verifier.verify(obj.unauth.nodeCertPem, sig, 'binary');
                        }
                        if (verified == false) {
                            // Not a valid signature
                            parent.agentStats.invalidPkcsSignatureCount++;
                            return false;
                        } 
                    } catch (ex) { };
                }
            }

            if (verified == false) {
                // Verify the RSA signature. This is the fast way, without using forge.
                const verify = parent.crypto.createVerify('SHA384');
                verify.end(Buffer.from(getWebCertHash(domain) + obj.nonce + obj.agentnonce, 'binary')); // Test using the private key hash
                if (verify.verify(obj.unauth.nodeCertPem, Buffer.from(msg, 'binary')) !== true) {
                    const verify2 = parent.crypto.createVerify('SHA384');
                    verify2.end(Buffer.from(getWebCertFullHash(domain) + obj.nonce + obj.agentnonce, 'binary'));  // Test using the full cert hash
                    if (verify2.verify(obj.unauth.nodeCertPem, Buffer.from(msg, 'binary')) !== true) {
                        parent.agentStats.invalidRsaSignatureCount++;
                        return false;
                    }
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
        if (obj.unauthsign) delete obj.unauthsign;
        parent.agentStats.verifiedAgentConnectionCount++;
        parent.parent.debug(1, 'Verified agent connection to ' + obj.nodeid + ' (' + obj.remoteaddrport + ').');
        obj.authenticated = 1;
        return true;
    }

    // Process incoming agent JSON data
    function processAgentData(msg) {
        var i, str = msg.toString('utf8'), command = null;
        if (str[0] == '{') {
            try { command = JSON.parse(str); } catch (ex) { parent.agentStats.invalidJsonCount++; console.log('Unable to parse agent JSON (' + obj.remoteaddrport + '): ' + str, ex); return; } // If the command can't be parsed, ignore it.
            if (typeof command != 'object') { return; }
            switch (command.action) {
                case 'msg':
                    {
                        // Route a message.
                        // If this command has a sessionid, that is the target.
                        if (command.sessionid != null) {
                            if (typeof command.sessionid != 'string') break;
                            var splitsessionid = command.sessionid.split('/');
                            // Check that we are in the same domain and the user has rights over this node.
                            if ((splitsessionid[0] == 'user') && (splitsessionid[1] == domain.id)) {
                                // Check if this user has rights to get this message
                                //if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 16) == 0)) return; // TODO!!!!!!!!!!!!!!!!!!!!!

                                // See if the session is connected. If so, go ahead and send this message to the target node
                                var ws = parent.wssessions2[command.sessionid];
                                if (ws != null) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.sessionid;       // Remove the sessionid, since we are sending to that sessionid, so it's implyed.
                                    try { ws.send(JSON.stringify(command)); } catch (ex) { }
                                } else if (parent.parent.multiServer != null) {
                                    // See if we can send this to a peer server
                                    var serverid = parent.wsPeerSessions2[command.sessionid];
                                    if (serverid != null) {
                                        command.fromNodeid = obj.dbNodeKey;
                                        parent.parent.multiServer.DispatchMessageSingleServer(command, serverid);
                                    }
                                }
                            }
                        } else if (command.userid != null) { // If this command has a userid, that is the target.
                            if (typeof command.userid != 'string') break;
                            var splituserid = command.userid.split('/');
                            // Check that we are in the same domain and the user has rights over this node.
                            if ((splituserid[0] == 'user') && (splituserid[1] == domain.id)) {
                                // Check if this user has rights to get this message
                                //if (mesh.links[user._id] == null || ((mesh.links[user._id].rights & 16) == 0)) return; // TODO!!!!!!!!!!!!!!!!!!!!!

                                // See if the session is connected
                                var sessions = parent.wssessions[command.userid];

                                // Go ahead and send this message to the target node
                                if (sessions != null) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.userid;          // Remove the userid, since we are sending to that userid, so it's implyed.
                                    for (i in sessions) { sessions[i].send(JSON.stringify(command)); }
                                }

                                if (parent.parent.multiServer != null) {
                                    // TODO: Add multi-server support
                                }
                            }
                        } else { // Route this command to the mesh
                            command.nodeid = obj.dbNodeKey;
                            var cmdstr = JSON.stringify(command);
                            for (var userid in parent.wssessions) { // Find all connected users for this mesh and send the message
                                var user = parent.users[userid];
                                if ((user != null) && (user.links != null)) {
                                    var rights = user.links[obj.dbMeshKey];
                                    if (rights != null) { // TODO: Look at what rights are needed for message routing
                                        var xsessions = parent.wssessions[userid];
                                        // Send the message to all users on this server
                                        for (i in xsessions) { try { xsessions[i].send(cmdstr); } catch (e) { } }
                                    }
                                }
                            }

                            // Send the message to all users of other servers
                            if (parent.parent.multiServer != null) {
                                delete command.nodeid;
                                command.fromNodeid = obj.dbNodeKey;
                                command.meshid = obj.dbMeshKey;
                                parent.parent.multiServer.DispatchMessage(command);
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
                case 'smbios':
                    {
                        // Store the RAW SMBios table of this computer
                        // We store SMBIOS information as a string because we don't want the MongoDB to attempt to store all of the sub-documents seperatly.
                        // If an agent sends an insanely large SMBIOS table, don't store it.
                        try {
                            var smbiosstr = JSON.stringify(command.value);
                            if (smbiosstr.length < 65535) { db.SetSMBIOS({ _id: obj.dbNodeKey, domain: domain.id, time: new Date(), value: smbiosstr }); }
                        } catch (ex) { }

                        // Event the node interface information change (This is a lot of traffic, probably don't need this).
                        //parent.parent.DispatchEvent(['*', obj.meshid], obj, { action: 'smBiosChange', nodeid: obj.dbNodeKey, domain: domain.id, smbios: command.value,  nolog: 1 });

                        break;
                    }
                case 'netinfo':
                    {
                        // Sent by the agent to update agent network interface information
                        delete command.action;
                        command.updateTime = Date.now();
                        command._id = 'if' + obj.dbNodeKey;
                        command.type = 'ifinfo';
                        db.Set(command);

                        // Event the node interface information change
                        parent.parent.DispatchEvent(['*', obj.meshid], obj, { action: 'ifchange', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 });

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
                            if ((nodes != null) && (nodes.length != 1)) return;
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
                                parent.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', action: 'removenode', nodeid: node._id, msg: change, domain: node.domain });
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
                            if (typeof command.userid == 'string') {
                                var loguser = parent.users[command.userid];
                                if (loguser) { event.userid = command.userid; event.username = loguser.name; }
                            }
                            if ((typeof command.sessionid == 'string') && (command.sessionid.length < 500)) { event.sessionid = command.sessionid; }
                            parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, event);
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
                case 'acmactivate':
                    {
                        if (obj.agentInfo.capabilities & 0x20) return; // If this is a temporary device, don't do ACM activation.

                        // Get the current Intel AMT policy
                        var mesh = parent.meshes[obj.dbMeshKey];
                        if ((mesh == null) || (mesh.amt == null) || (mesh.amt.type != 3) || (domain.amtacmactivation == null) || (domain.amtacmactivation.acmmatch == null) || (mesh.amt.password == null)) break; // If this is not the right policy, ignore this.

                        // Get the Intel AMT admin password, randomize if needed.
                        var amtpassword = ((mesh.amt.password == '') ? getRandomAmtPassword() : mesh.amt.password);
                        if (checkAmtPassword(amtpassword) == false) return; // Invalid Intel AMT password, this should never happen.

                        // Agent is asking the server to sign an Intel AMT ACM activation request
                        var signResponse = parent.parent.certificateOperations.signAcmRequest(domain, command, 'admin', amtpassword, obj.remoteaddrport, obj.dbNodeKey, obj.dbMeshKey, obj.agentInfo.computerName, obj.agentInfo.agentId); // TODO: Place account credentials!!!
                        if ((signResponse != null) && (signResponse.error == null)) {
                            // Log this activation event
                            var event = { etype: 'node', action: 'amtactivate', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Device requested Intel AMT ACM activation, FQDN: ' + command.fqdn, ip: obj.remoteaddrport };
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                            parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, event);

                            // Update the device Intel AMT information
                            ChangeAgentCoreInfo({ "intelamt": { user: 'admin', pass: amtpassword, uuid: command.uuid, realm: command.realm } });

                            // Send the activation response
                            obj.send(JSON.stringify(signResponse));
                        }
                        break;
                    }
                case 'diagnostic':
                    {
                        if (typeof command.value == 'object') {
                            switch (command.value.command) {
                                case 'register': {
                                    // Only main agent can do this
                                    if (((obj.agentInfo.capabilities & 0x40) == 0) && (typeof command.value.value == 'string') && (command.value.value.length == 64))
                                    {
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
                                            if (nodes.length == 1) {
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
                                        var event = { etype: 'node', action: 'diagnostic', nodeid: obj.realNodeKey, domain: domain.id, msg: command.value.value };
                                        parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, event);
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                    }
                case 'sysinfo': {
                    console.log('sysinfo', obj.nodeid, JSON.stringify(command.data.hash));
                    command.data._id = 'si' + obj.dbNodeKey;
                    db.Set(command.data); // Update system information in the database.
                    break;
                }
                case 'sysinfocheck': {
                    // Check system information update
                    db.GetHash('si' + obj.dbNodeKey, function (err, results) {
                        if ((results != null) && (results.length == 1)) { obj.send(JSON.stringify({ action: 'sysinfo', hash: results[0].hash })); } else { obj.send(JSON.stringify({ action: 'sysinfo' })); }
                    });
                    break;
                }
                default: {
                    parent.agentStats.unknownAgentActionCount++; 
                    console.log('Unknown agent action (' + obj.remoteaddrport + '): ' + command.action + '.');
                    break;
                }
            }
        }
    }

    // Change the current core information string and event it
    function ChangeAgentCoreInfo(command) {
        if (obj.agentInfo.capabilities & 0x40) return;
        if ((command == null) || (command == null)) return; // Safety, should never happen.

        // Check that the mesh exists
        const mesh = parent.meshes[obj.dbMeshKey];
        if (mesh == null) return;

        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) { // TODO: THIS IS A BIG RACE CONDITION HERE, WE NEED TO FIX THAT. If this call is made twice at the same time on the same device, data will be missed.
            if ((nodes == null) || (nodes.length != 1)) return;
            const device = nodes[0];
            if (device.agent) {
                var changes = [], change = 0, log = 0;

                //if (command.users) { console.log(command.users); }

                // Check if anything changes
                if (command.name && (command.name != device.name)) { change = 1; log = 1; device.name = command.name; changes.push('name'); }
                if ((command.caps != null) && (device.agent.core != command.value)) { if ((command.value == null) && (device.agent.core != null)) { delete device.agent.core; } else { device.agent.core = command.value; } change = 1; } // Don't save this as an event to the db.
                if ((command.caps != null) && ((device.agent.caps & 0xFFFFFFE7) != (command.caps & 0xFFFFFFE7))) { device.agent.caps = ((device.agent.caps & 24) + (command.caps & 0xFFFFFFE7)); change = 1; } // Allow Javascript on the agent to change all capabilities except console and javascript support, Don't save this as an event to the db.
                if ((command.osdesc != null) && (device.osdesc != command.osdesc)) { device.osdesc = command.osdesc; change = 1; changes.push('os desc'); } // Don't save this as an event to the db.
                if (device.ip != obj.remoteaddr) { device.ip = obj.remoteaddr; change = 1; }
                if (command.intelamt) {
                    if (!device.intelamt) { device.intelamt = {}; }
                    if ((command.intelamt.ver != null) && (device.intelamt.ver != command.intelamt.ver)) { changes.push('AMT version'); device.intelamt.ver = command.intelamt.ver; change = 1; log = 1; }
                    if ((command.intelamt.state != null) && (device.intelamt.state != command.intelamt.state)) { changes.push('AMT state'); device.intelamt.state = command.intelamt.state; change = 1; log = 1; }
                    if ((command.intelamt.flags != null) && (device.intelamt.flags != command.intelamt.flags)) {
                        if (device.intelamt.flags) { changes.push('AMT flags (' + device.intelamt.flags + ' --> ' + command.intelamt.flags + ')'); } else { changes.push('AMT flags (' + command.intelamt.flags + ')'); }
                        device.intelamt.flags = command.intelamt.flags; change = 1; log = 1;
                    }
                    if ((command.intelamt.realm != null) && (device.intelamt.realm != command.intelamt.realm)) { changes.push('AMT realm'); device.intelamt.realm = command.intelamt.realm; change = 1; log = 1; }
                    if ((command.intelamt.host != null) && (device.intelamt.host != command.intelamt.host)) { changes.push('AMT host'); device.intelamt.host = command.intelamt.host; change = 1; log = 1; }
                    if ((command.intelamt.uuid != null) && (device.intelamt.uuid != command.intelamt.uuid)) { changes.push('AMT uuid'); device.intelamt.uuid = command.intelamt.uuid; change = 1; log = 1; }
                    if ((command.intelamt.user != null) && (device.intelamt.user != command.intelamt.user)) { changes.push('AMT user'); device.intelamt.user = command.intelamt.user; change = 1; log = 1; }
                    if ((command.intelamt.pass != null) && (device.intelamt.pass != command.intelamt.pass)) { changes.push('AMT pass'); device.intelamt.pass = command.intelamt.pass; change = 1; log = 1; }
                }
                if (command.av) {
                    if (!device.av) { device.av = []; }
                    if ((command.av != null) && (JSON.stringify(device.av) != JSON.stringify(command.av))) { changes.push('AV status'); device.av = command.av; change = 1; log = 1; }
                }

                if ((command.users != null) && (device.users != command.users)) { device.users = command.users; change = 1; } // Don't save this to the db.
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
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id };
                    if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    if ((log == 0) || ((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    var device2 = common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) { delete device2.intelamt.pass; } // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
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

        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { return; }
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
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', ') };
                    if (obj.agentInfo.capabilities & 0x20) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    var device2 = common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) { delete device2.intelamt.pass; } // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }
        });
    }

    // Update the mesh agent tab in the database
    function ChangeAgentTag(tag) {
        if (obj.agentInfo.capabilities & 0x40) return;
        if (tag.length == 0) { tag = null; }
        // Get the node and change it if needed
        db.Get(obj.dbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) return;
            const device = nodes[0];
            if (device.agent) {
                if (device.agent.tag != tag) {
                    // Do some clean up if needed, these values should not be in the database.
                    if (device.conn != null) { delete device.conn; }
                    if (device.pwr  != null) { delete device.pwr; }
                    if (device.agct != null) { delete device.agct; }
                    if (device.cict != null) { delete device.cict; }

                    // Set the new tag
                    device.agent.tag = tag;
                    db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, nolog: 1 };
                    var device2 = common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }
        });
    }

    // Generate a random Intel AMT password
    function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
    function getRandomAmtPassword() { var p; do { p = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }

    return obj;
};
