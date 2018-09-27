/**
* @description MeshCentral MeshAgent communication module
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018
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

var AgentConnectCount = 0;

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
    obj.agentInfo = null;
    obj.agentUpdate = null;
    const agentUpdateBlockSize = 65520;
    obj.remoteaddr = obj.ws._socket.remoteAddress;
    obj.useSHA386 = false;
    obj.agentConnectCount = ++AgentConnectCount;
    if (obj.remoteaddr.startsWith('::ffff:')) { obj.remoteaddr = obj.remoteaddr.substring(7); }
    ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive, 4 minutes

    // Send a message to the mesh agent
    obj.send = function (data) { try { if (typeof data == 'string') { obj.ws.send(new Buffer(data, 'binary')); } else { obj.ws.send(data); } } catch (e) { } };

    // Disconnect this agent
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { obj.ws.close(); if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Soft disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); } } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { obj.ws._socket._parent.end(); if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Hard disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); } } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        if (arg == 3) { obj.authenticated = -1; } // Don't communicate with this agent anymore, but don't disconnect (Duplicate agent).
        if (obj.parent.wsagents[obj.dbNodeKey] == obj) {
            delete obj.parent.wsagents[obj.dbNodeKey];
            obj.parent.parent.ClearConnectivityState(obj.dbMeshKey, obj.dbNodeKey, 1);
        }

        // Get the current mesh
        var mesh = obj.parent.meshes[obj.dbMeshKey];

        // Other clean up may be needed here
        if (obj.unauth) { delete obj.unauth; }
        if (obj.agentUpdate != null) { obj.fs.close(obj.agentUpdate.fd); obj.agentUpdate = null; }
        if (((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || ((mesh) && (mesh.flags) && (mesh.flags & 1))) { // This is a temporary agent, remote it
            // Delete this node including network interface information and events
            obj.db.Remove(obj.dbNodeKey); // Remove node with that id
            obj.db.Remove('if' + obj.dbNodeKey); // Remove interface information
            obj.db.Remove('nt' + obj.dbNodeKey); // Remove notes
            obj.db.Remove('lc' + obj.dbNodeKey); // Remove last connect time
            obj.db.Remove('sm' + obj.dbNodeKey); // Remove SMBios data
            obj.db.RemoveNode(obj.dbNodeKey); // Remove all entries with node:id

            // Event node deletion
            obj.parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'removenode', nodeid: obj.dbNodeKey, domain: obj.domain.id, nolog: 1 });

            // Disconnect all connections if needed
            var state = obj.parent.parent.GetConnectivityState(obj.dbNodeKey);
            if ((state != null) && (state.connectivity != null)) {
                if ((state.connectivity & 1) != 0) { obj.parent.wsagents[obj.dbNodeKey].close(); } // Disconnect mesh agent
                if ((state.connectivity & 2) != 0) { obj.parent.parent.mpsserver.close(obj.parent.parent.mpsserver.ciraConnections[obj.dbNodeKey]); } // Disconnect CIRA connection
            }
        } else {
            // Update the last connect time
            obj.db.Set({ _id: 'lc' + obj.dbNodeKey, type: 'lastconnect', domain: domain.id, time: obj.connectTime });
        }
        delete obj.nodeid;
    };

    // When data is received from the mesh agent web socket
    ws.on('message', function (msg) {
        if (msg.length < 2) return;
        if (typeof msg == 'object') { msg = msg.toString('binary'); } // TODO: Could change this entire method to use Buffer instead of binary string

        if (obj.authenticated == 2) { // We are authenticated
            if ((obj.agentUpdate == null) && (msg.charCodeAt(0) == 123)) { processAgentData(msg); } // Only process JSON messages if meshagent update is not in progress
            if (msg.length < 2) return;
            var cmdid = obj.common.ReadShort(msg, 0);
            if (cmdid == 11) { // MeshCommand_CoreModuleHash
                if (msg.length == 4) { ChangeAgentCoreInfo({ "caps": 0 }); } // If the agent indicated that no core is running, clear the core information string.
                // Mesh core hash, sent by agent with the hash of the current mesh core.
                if (obj.agentCoreCheck == 1000) return; // If we are using a custom core, don't try to update it.
                // We need to check if the core is current.
                // TODO: Check if we have a mesh specific core. If so, use that.
                var agentMeshCoreHash = null;
                if (msg.length == 52) { agentMeshCoreHash = msg.substring(4, 52); }
                if ((agentMeshCoreHash != obj.parent.parent.defaultMeshCoreHash) && (agentMeshCoreHash != obj.parent.parent.defaultMeshCoreNoMeiHash)) {
                    if (obj.agentCoreCheck < 5) { // This check is in place to avoid a looping core update.
                        if (obj.parent.parent.defaultMeshCoreHash == null) {
                            // Update no core
                            obj.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0)); // Command 10, ask mesh agent to clear the core
                        } else {
                            // Update new core
                            if (obj.parent.parent.meshAgentsArchitectureNumbers[obj.agentInfo.agentId].amt == true) {
                                obj.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + obj.parent.parent.defaultMeshCoreHash + obj.parent.parent.defaultMeshCore); // Command 10, ask mesh agent to set the core (with MEI support)
                            } else {
                                obj.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + obj.parent.parent.defaultMeshCoreNoMeiHash + obj.parent.parent.defaultMeshCoreNoMei); // Command 10, ask mesh agent to set the core (No MEI)
                            }
                        }
                        obj.agentCoreCheck++;
                    }
                } else {
                    obj.agentCoreCheck = 0;
                }
            }
            else if (cmdid == 12) { // MeshCommand_AgentHash
                if ((msg.length == 52) && (obj.agentExeInfo != null) && (obj.agentExeInfo.update == true)) {
                    var agenthash = obj.common.rstr2hex(msg.substring(4)).toLowerCase();
                    if (agenthash != obj.agentExeInfo.hash) {
                        // Mesh agent update required
                        if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Agent update required, NodeID=0x' + obj.nodeid.substring(0, 16) + ', ' + obj.agentExeInfo.desc); }
                        obj.fs.open(obj.agentExeInfo.path, 'r', function (err, fd) {
                            if (err) { return console.error(err); }
                            obj.agentUpdate = { oldHash: agenthash, ptr: 0, buf: new Buffer(agentUpdateBlockSize + 4), fd: fd };

                            // We got the agent file open on the server side, tell the agent we are sending an update starting with the SHA384 hash of the result
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
                            //console.log("Agent update send next block", obj.agentUpdate.ptr, len);
                            if (len == agentUpdateBlockSize) { obj.send(obj.agentUpdate.buf); } else { obj.send(obj.agentUpdate.buf.slice(0, len + 4)); } // Command 14, mesh agent next data block

                            if (len < agentUpdateBlockSize) {
                                //console.log("Agent update sent");
                                obj.send(obj.common.ShortToStr(13) + obj.common.ShortToStr(0) + obj.common.hex2rstr(obj.agentExeInfo.hash)); // Command 13, end mesh agent download, send agent SHA384 hash
                                obj.fs.close(obj.agentUpdate.fd);
                                obj.agentUpdate = null;
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
            var cmd = obj.common.ReadShort(msg, 0);
            if (cmd == 1) {
                // Agent authentication request
                if ((msg.length != 98) || ((obj.receivedCommands & 1) != 0)) return;
                obj.receivedCommands += 1; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Check that the server hash matches our own web certificate hash (SHA386)
                if (getWebCertHash(obj.domain) != msg.substring(2, 50)) { console.log('Agent connected with bad web certificate hash, holding connection (' + obj.remoteaddr + ').'); return; }

                // Use our server private key to sign the ServerHash + AgentNonce + ServerNonce
                obj.agentnonce = msg.substring(50);

                // Check if we got the agent auth confirmation
                if ((obj.receivedCommands & 8) == 0) {
                    // If we did not get an indication that the agent already validated this server, send the server signature.
                    if (obj.useSwarmCert == true) {
                        // Perform the hash signature using older swarm server certificate
                        obj.parent.parent.certificateOperations.acceleratorPerformSignature(1, msg.substring(2) + obj.nonce, obj, function (obj2, signature) {
                            // Send back our certificate + signature
                            obj2.send(obj2.common.ShortToStr(2) + obj2.common.ShortToStr(obj2.parent.swarmCertificateAsn1.length) + obj2.parent.swarmCertificateAsn1 + signature); // Command 2, certificate + signature
                        });
                    } else {
                        // Perform the hash signature using the server agent certificate
                        obj.parent.parent.certificateOperations.acceleratorPerformSignature(0, msg.substring(2) + obj.nonce, obj, function (obj2, signature) {
                            // Send back our certificate + signature
                            obj2.send(obj2.common.ShortToStr(2) + obj2.common.ShortToStr(obj2.parent.agentCertificateAsn1.length) + obj2.parent.agentCertificateAsn1 + signature); // Command 2, certificate + signature
                        });
                    }
                }

                // Check the agent signature if we can
                if (obj.unauthsign != null) {
                    if (processAgentSignature(obj.unauthsign) == false) { console.log('Agent connected with bad signature, holding connection (' + obj.remoteaddr + ').'); return; } else { completeAgentConnection(); }
                }
            }
            else if (cmd == 2) {
                // Agent certificate
                if ((msg.length < 4) || ((obj.receivedCommands & 2) != 0)) return;
                obj.receivedCommands += 2; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Decode the certificate
                var certlen = obj.common.ReadShort(msg, 2);
                obj.unauth = {};
                try { obj.unauth.nodeid = new Buffer(obj.forge.pki.getPublicKeyFingerprint(obj.forge.pki.certificateFromAsn1(obj.forge.asn1.fromDer(msg.substring(4, 4 + certlen))).publicKey, { md: obj.forge.md.sha384.create() }).data, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); } catch (e) { return; }
                obj.unauth.nodeCertPem = '-----BEGIN CERTIFICATE-----\r\n' + new Buffer(msg.substring(4, 4 + certlen), 'binary').toString('base64') + '\r\n-----END CERTIFICATE-----';

                // Check the agent signature if we can
                if (obj.agentnonce == null) { obj.unauthsign = msg.substring(4 + certlen); } else { if (processAgentSignature(msg.substring(4 + certlen)) == false) { console.log('Agent connected with bad signature, holding connection (' + obj.remoteaddr + ').'); return; } }
                completeAgentConnection();
            }
            else if (cmd == 3) {
                // Agent meshid
                if ((msg.length < 72) || ((obj.receivedCommands & 4) != 0)) return;
                obj.receivedCommands += 4; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.

                // Set the meshid
                obj.agentInfo = {};
                obj.agentInfo.infoVersion = obj.common.ReadInt(msg, 2);
                obj.agentInfo.agentId = obj.common.ReadInt(msg, 6);
                obj.agentInfo.agentVersion = obj.common.ReadInt(msg, 10);
                obj.agentInfo.platformType = obj.common.ReadInt(msg, 14);
                if (obj.agentInfo.platformType > 6 || obj.agentInfo.platformType < 1) { obj.agentInfo.platformType = 1; }
                if (msg.substring(50, 66) == '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0') {
                    obj.meshid = new Buffer(msg.substring(18, 50), 'binary').toString('hex'); // Older HEX MeshID
                } else {
                    obj.meshid = new Buffer(msg.substring(18, 66), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); // New Base64 MeshID
                }
                //console.log('MeshID', obj.meshid);
                obj.agentInfo.capabilities = obj.common.ReadInt(msg, 66);
                var computerNameLen = obj.common.ReadShort(msg, 70);
                obj.agentInfo.computerName = msg.substring(72, 72 + computerNameLen);
                obj.dbMeshKey = 'mesh/' + obj.domain.id + '/' + obj.meshid;
                completeAgentConnection();
            } else if (cmd == 4) {
                if ((msg.length < 2) || ((obj.receivedCommands & 8) != 0)) return;
                obj.receivedCommands += 8; // Agent can't send the same command twice on the same connection ever. Block DOS attack path.
                // Agent already authenticated the server, wants to skip the server signature - which is great for server performance.
            } else if (cmd == 5) {
                // ServerID. Agent is telling us what serverid it expects. Useful if we have many server certificates.
                if ((msg.substring(2, 34) == obj.parent.swarmCertificateHash256) || (msg.substring(2, 50) == obj.parent.swarmCertificateHash384)) { obj.useSwarmCert = true; }
            }
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { console.log('AGENT WSERR: ' + err); });

    // If the mesh agent web socket is closed, clean up.
    ws.on('close', function (req) { if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Agent disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); } obj.close(0); });
    // obj.ws._socket._parent.on('close', function (req) { if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Agent TCP disconnect ' + obj.nodeid + ' (' + obj.remoteaddr + ')'); } });

    // Start authenticate the mesh agent by sending a auth nonce & server TLS cert hash.
    // Send 384 bits SHA384 hash of TLS cert public key + 384 bits nonce
    obj.nonce = obj.parent.crypto.randomBytes(48).toString('binary');
    obj.send(obj.common.ShortToStr(1) + getWebCertHash(obj.domain) + obj.nonce); // Command 1, hash + nonce

    // Once we get all the information about an agent, run this to hook everything up to the server
    function completeAgentConnection() {
        if ((obj.authenticated != 1) || (obj.meshid == null) || obj.pendingCompleteAgentConnection) return;
        obj.pendingCompleteAgentConnection = true;

        // Check that the mesh exists
        var mesh = obj.parent.meshes[obj.dbMeshKey];
        if (mesh == null) { console.log('Agent connected with invalid domain/mesh, holding connection (' + obj.remoteaddr + ', ' + obj.dbMeshKey + ').'); return; } // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.
        if (mesh.mtype != 2) { console.log('Agent connected with invalid mesh type, holding connection (' + obj.remoteaddr + ').'); return; } // If we disconnect, the agnet will just reconnect. We need to log this or tell agent to connect in a few hours.

        // Check that the node exists
        obj.db.Get(obj.dbNodeKey, function (err, nodes) {
            var device;

            // Mark when we connected to this agent
            obj.connectTime = Date.now();
            obj.db.Set({ _id: 'lc' + obj.dbNodeKey, type: 'lastconnect', domain: domain.id, time: obj.connectTime });

            // See if this node exists in the database
            if (nodes.length == 0) {
                // This node does not exist, create it.
                device = { type: 'node', mtype: mesh.mtype, _id: obj.dbNodeKey, icon: obj.agentInfo.platformType, meshid: obj.dbMeshKey, name: obj.agentInfo.computerName, rname: obj.agentInfo.computerName, domain: domain.id, agent: { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }, host: null };
                obj.db.Set(device);

                // Event the new node
                if (obj.agentInfo.capabilities & 0x20) {
                    // This is a temporary agent, don't log.
                    obj.parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'addnode', node: device, domain: domain.id, nolog: 1 });
                } else {
                    obj.parent.parent.DispatchEvent(['*', obj.dbMeshKey], obj, { etype: 'node', action: 'addnode', node: device, msg: ('Added device ' + obj.agentInfo.computerName + ' to mesh ' + mesh.name), domain: domain.id });
                }
            } else {
                // Device already exists, look if changes has occured
                device = nodes[0];
                var changes = [], change = 0, log = 0;
                if (device.agent == null) { device.agent = { ver: obj.agentInfo.agentVersion, id: obj.agentInfo.agentId, caps: obj.agentInfo.capabilities }; change = 1; }
                if (device.rname != obj.agentInfo.computerName) { device.rname = obj.agentInfo.computerName; change = 1; changes.push('computer name'); }
                if (device.agent.ver != obj.agentInfo.agentVersion) { device.agent.ver = obj.agentInfo.agentVersion; change = 1; changes.push('agent version'); }
                if (device.agent.id != obj.agentInfo.agentId) { device.agent.id = obj.agentInfo.agentId; change = 1; changes.push('agent type'); }
                if ((device.agent.caps & 24) != (obj.agentInfo.capabilities & 24)) { device.agent.caps = obj.agentInfo.capabilities; change = 1; changes.push('agent capabilities'); } // If agent console or javascript support changes, update capabilities
                if (device.meshid != obj.dbMeshKey) { device.meshid = obj.dbMeshKey; change = 1; log = 1; changes.push('agent meshid'); } // TODO: If the meshid changes, we need to event a device add/remove on both meshes
                if (change == 1) {
                    obj.db.Set(device);

                    // If this is a temporary device, don't log changes
                    if (obj.agentInfo.capabilities & 0x20) { log = 0; }

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id };
                    if (log == 0) { event.nolog = 1; } else { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    var device2 = obj.common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }

            // Check if this agent is already connected
            var dupAgent = obj.parent.wsagents[obj.dbNodeKey];
            obj.parent.wsagents[obj.dbNodeKey] = obj;
            if (dupAgent) {
                // Close the duplicate agent
                if (obj.nodeid != null) { obj.parent.parent.debug(1, 'Duplicate agent ' + obj.nodeid + ' (' + obj.remoteaddr + ':' + obj.ws._socket.remotePort + ')'); }
                dupAgent.close(3);
            } else {
                // Indicate the agent is connected
                obj.parent.parent.SetConnectivityState(obj.dbMeshKey, obj.dbNodeKey, obj.connectTime, 1, 1);
            }

            // We are done, ready to communicate with this agent
            delete obj.pendingCompleteAgentConnection;
            obj.authenticated = 2;

            // Command 4, inform mesh agent that it's authenticated.
            obj.send(obj.common.ShortToStr(4));

            // Check the mesh core, if the agent is capable of running one
            if ((obj.agentInfo.capabilities & 16) != 0) { obj.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); } // Command 11, ask for mesh core hash.

            // Check if we need to make an native update check
            obj.agentExeInfo = obj.parent.parent.meshAgentBinaries[obj.agentInfo.agentId];
            if ((obj.agentExeInfo != null) && (obj.agentExeInfo.update == true)) { obj.send(obj.common.ShortToStr(12) + obj.common.ShortToStr(0)); } // Ask the agent for it's executable binary hash

            // Check if we already have IP location information for this node
            obj.db.Get('iploc_' + obj.remoteaddr, function (err, iplocs) {
                if (iplocs.length == 1) {
                    // We have a location in the database for this remote IP
                    var iploc = nodes[0], x = {};
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
    }

    // Get the web certificate hash for the speficied domain
    function getWebCertHash(domain) {
        var hash = obj.parent.webCertificateHashs[domain.id];
        if (hash != null) return hash;
        return obj.parent.webCertificateHash;
    }

    // Verify the agent signature
    function processAgentSignature(msg) {
        // Verify the signature. This is the fast way, without using forge.
        const verify = obj.parent.crypto.createVerify('SHA384');
        verify.end(new Buffer(getWebCertHash(obj.domain) + obj.nonce + obj.agentnonce, 'binary'));
        if (verify.verify(obj.unauth.nodeCertPem, new Buffer(msg, 'binary')) !== true) { return false; }

        // Connection is a success, clean up
        obj.nodeid = obj.unauth.nodeid;
        obj.dbNodeKey = 'node/' + domain.id + '/' + obj.nodeid;
        delete obj.nonce;
        delete obj.agentnonce;
        delete obj.unauth;
        if (obj.unauthsign) delete obj.unauthsign;
        obj.parent.parent.debug(1, 'Verified agent connection to ' + obj.nodeid + ' (' + obj.remoteaddr + ':' + obj.ws._socket.remotePort + ').');
        obj.authenticated = 1;
        return true;
    }

    // Process incoming agent JSON data
    function processAgentData(msg) {
        var i;
        var str = msg.toString('utf8'), command = null;
        if (str[0] == '{') {
            try { command = JSON.parse(str); } catch (ex) { console.log('Unable to parse agent JSON (' + obj.remoteaddr + '): ' + str, ex); return; } // If the command can't be parsed, ignore it.
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
                                var ws = obj.parent.wssessions2[command.sessionid];
                                if (ws != null) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.sessionid;       // Remove the sessionid, since we are sending to that sessionid, so it's implyed.
                                    try { ws.send(JSON.stringify(command)); } catch (ex) { }
                                } else if (obj.parent.parent.multiServer != null) {
                                    // See if we can send this to a peer server
                                    var serverid = obj.parent.wsPeerSessions2[command.sessionid];
                                    if (serverid != null) {
                                        command.fromNodeid = obj.dbNodeKey;
                                        obj.parent.parent.multiServer.DispatchMessageSingleServer(command, serverid);
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
                                var sessions = obj.parent.wssessions[command.userid];

                                // Go ahead and send this message to the target node
                                if (sessions != null) {
                                    command.nodeid = obj.dbNodeKey; // Set the nodeid, required for responses.
                                    delete command.userid;          // Remove the userid, since we are sending to that userid, so it's implyed.
                                    for (i in sessions) { sessions[i].send(JSON.stringify(command)); }
                                }

                                if (obj.parent.parent.multiServer != null) {
                                    // TODO: Add multi-server support
                                }
                            }
                        } else { // Route this command to the mesh
                            command.nodeid = obj.dbNodeKey;
                            var cmdstr = JSON.stringify(command);
                            for (var userid in obj.parent.wssessions) { // Find all connected users for this mesh and send the message
                                var user = obj.parent.users[userid];
                                if ((user != null) && (user.links != null)) {
                                    var rights = user.links[obj.dbMeshKey];
                                    if (rights != null) { // TODO: Look at what rights are needed for message routing
                                        var xsessions = obj.parent.wssessions[userid];
                                        // Send the message to all users on this server
                                        for (i in xsessions) { try { xsessions[i].send(cmdstr); } catch (e) { } }
                                    }
                                }
                            }

                            // Send the message to all users of other servers
                            if (obj.parent.parent.multiServer != null) {
                                delete command.nodeid;
                                command.fromNodeid = obj.dbNodeKey;
                                command.meshid = obj.dbMeshKey;
                                obj.parent.parent.multiServer.DispatchMessage(command);
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
                        // The RAW SMBios table of this computer
                        obj.db.Set({ _id: 'sm' + obj.dbNodeKey, type: 'smbios', domain: domain.id, time: Date.now(), smbios: command.value });

                        // Event the node interface information change (This is a lot of traffic, probably don't need this).
                        //obj.parent.parent.DispatchEvent(['*', obj.meshid], obj, { action: 'smBiosChange', nodeid: obj.dbNodeKey, domain: domain.id, smbios: command.value,  nolog: 1 });

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
                        if ((command.type == 'publicip') && (command.value != null) && (typeof command.value == 'object') && (command.value.ip) && (command.value.loc)) {
                            var x = {};
                            x.publicip = command.value.ip;
                            x.iploc = command.value.loc + ',' + (Math.floor(Date.now() / 1000));
                            ChangeAgentLocationInfo(x);
                            command.value._id = 'iploc_' + command.value.ip;
                            command.value.type = 'iploc';
                            command.value.date = Date.now();
                            obj.db.Set(command.value); // Store the IP to location data in the database
                            // Sample Value: { ip: '192.55.64.246', city: 'Hillsboro', region: 'Oregon', country: 'US', loc: '45.4443,-122.9663', org: 'AS4983 Intel Corporation', postal: '97123' }
                        }
                        break;
                    }
                case 'mc1migration':
                    {
                        if (command.oldnodeid.length != 64) break;
                        var oldNodeKey = 'node//' + command.oldnodeid.toLowerCase();
                        obj.db.Get(oldNodeKey, function (err, nodes) {
                            if (nodes.length != 1) return;
                            var node = nodes[0];
                            if (node.meshid == obj.dbMeshKey) {
                                // Update the device name & host
                                var newNode = { "name": node.name };
                                if (node.intelamt != null) { newNode.intelamt = node.intelamt; }
                                ChangeAgentCoreInfo(newNode);

                                // Delete this node including network interface information and events
                                obj.db.Remove(node._id);
                                obj.db.Remove('if' + node._id);

                                // Event node deletion
                                var change = 'Migrated device ' + node.name;
                                obj.parent.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', action: 'removenode', nodeid: node._id, msg: change, domain: node.domain });
                            }
                        });
                        break;
                    }
            }
        }
    }

    // Change the current core information string and event it
    function ChangeAgentCoreInfo(command) {
        if ((command == null) || (command == null)) return; // Safety, should never happen.

        // Check that the mesh exists
        var mesh = obj.parent.meshes[obj.dbMeshKey];
        if (mesh == null) return;

        // Get the node and change it if needed
        obj.db.Get(obj.dbNodeKey, function (err, nodes) {
            if (nodes.length != 1) return;
            var device = nodes[0];
            if (device.agent) {
                var changes = [], change = 0;

                //if (command.users) { console.log(command.users); }

                // Check if anything changes
                if (command.name && (command.name != device.name)) { change = 1; device.name = command.name; changes.push('name'); }
                if ((command.caps != null) && (device.agent.core != command.value)) { if ((command.value == null) && (device.agent.core != null)) { delete device.agent.core; } else { device.agent.core = command.value; } change = 1; changes.push('agent core'); }
                if ((command.caps != null) && ((device.agent.caps & 0xFFFFFFE7) != (command.caps & 0xFFFFFFE7))) { device.agent.caps = ((device.agent.caps & 24) + (command.caps & 0xFFFFFFE7)); change = 1; changes.push('agent capabilities'); } // Allow Javascript on the agent to change all capabilities except console and javascript support
                if ((command.osdesc != null) && (device.osdesc != command.osdesc)) { device.osdesc = command.osdesc; change = 1; changes.push('os desc'); }
                if (command.intelamt) {
                    if (!device.intelamt) { device.intelamt = {}; }
                    if ((command.intelamt.ver != null) && (device.intelamt.ver != command.intelamt.ver)) { changes.push('AMT version'); device.intelamt.ver = command.intelamt.ver; change = 1; }
                    if ((command.intelamt.state != null) && (device.intelamt.state != command.intelamt.state)) { changes.push('AMT state'); device.intelamt.state = command.intelamt.state; change = 1; }
                    if ((command.intelamt.flags != null) && (device.intelamt.flags != command.intelamt.flags)) {
                        if (device.intelamt.flags) { changes.push('AMT flags (' + device.intelamt.flags + ' --> ' + command.intelamt.flags + ')'); } else { changes.push('AMT flags (' + command.intelamt.flags + ')'); }
                        device.intelamt.flags = command.intelamt.flags; change = 1;
                    }
                    if ((command.intelamt.host != null) && (device.intelamt.host != command.intelamt.host)) { changes.push('AMT host'); device.intelamt.host = command.intelamt.host; change = 1; }
                    if ((command.intelamt.uuid != null) && (device.intelamt.uuid != command.intelamt.uuid)) { changes.push('AMT uuid'); device.intelamt.uuid = command.intelamt.uuid; change = 1; }
                }
                if ((command.users != null) && (device.users != command.users)) { device.users = command.users; change = 1; } // Would be nice not to save this to the db.
                if (mesh.mtype == 2) {
                    if (device.host != obj.remoteaddr) { device.host = obj.remoteaddr; change = 1; changes.push('host'); }
                    // TODO: Check that the agent has an interface that is the same as the one we got this websocket connection on. Only set if we have a match.
                }

                // If there are changes, event the new device
                if (change == 1) {
                    // Save to the database
                    obj.db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id };
                    if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    if ((obj.agentInfo.capabilities & 0x20) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    var device2 = obj.common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }
        });
    }

    // Change the current core information string and event it
    function ChangeAgentLocationInfo(command) {
        if ((command == null) || (command == null)) { return; } // Safety, should never happen.

        // Check that the mesh exists
        var mesh = obj.parent.meshes[obj.dbMeshKey];
        if (mesh == null) return;

        // Get the node and change it if needed
        obj.db.Get(obj.dbNodeKey, function (err, nodes) {
            if (nodes.length != 1) { return; }
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
                    var event = { etype: 'node', action: 'changenode', nodeid: obj.dbNodeKey, domain: domain.id, msg: 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', ') };
                    if (obj.agentInfo.capabilities & 0x20) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    var device2 = obj.common.Clone(device);
                    if (device2.intelamt && device2.intelamt.pass) { delete device2.intelamt.pass; } // Remove the Intel AMT password before eventing this.
                    event.node = device;
                    obj.parent.parent.DispatchEvent(['*', device.meshid], obj, event);
                }
            }
        });
    }

    // Update the mesh agent tab in the database
    function ChangeAgentTag(tag) {
        if (tag.length == 0) { tag = null; }
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
};
