/**
* @description MeshCentral v1 legacy Swarm Server, used to update agents and get them on MeshCentral2
* @author Ylian Saint-Hilaire
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

// Construct a legacy Swarm Server server object
module.exports.CreateSwarmServer = function (parent, db, args, certificates) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = certificates;
    obj.legacyAgentConnections = {};
    obj.migrationAgents = {};
    obj.agentActionCount = {};
    obj.stats = { blockedConnect: 0, connectCount: 0, clientCertConnectCount: 0, noCertConnectCount: 0, bytesIn: 0, bytesOut: 0, httpGetRequest: 0, pushedAgents: {}, close: 0, onclose: 0, agentType: {} }
    const tls = require('tls');
    const forge = require('node-forge');
    const common = require('./common.js');

    const LegacyMeshProtocol = {
        NODEPUSH: 1,	           // Used to send a node block to another peer.
        NODEPULL: 2,	           // Used to send a pull block to another peer.
        NODENOTIFY: 3,	           // Used to indicate the node ID to other peers.
        NODECHALLENGE: 4,	       // Used to challenge a node identity.
        NODECRESPONSE: 5,          // Used to respond to a node challenge.
        TARGETSTATUS: 6,	       // Used to send the peer connection status list.
        LOCALEVENT: 7,	           // Used to send local events to subscribers.
        AESCRYPTO: 8,	           // Used to send an encrypted block of data.
        SESSIONKEY: 9,	           // Used to send a session key to a remote node.
        SYNCSTART: 10,	           // Used to send kick off the SYNC request, send the start NodeID.
        SYNCMETADATA: 11,	       // Used to send a sequence of NodeID & serial numbers.
        SYNCREQUEST: 12,	       // Used to send a sequence of NodeID's to request.
        NODEID: 13,                // Used to send the NodeID in the clear. Used for multicast.
        AGENTID: 14,	           // Used to send the AgentID & version to the other node.
        PING: 15,                  // Used to query a target for the presence of the mesh agent (PB_NODEID response expected).
        SETUPADMIN: 16,            // Used to set the trusted mesh identifier, this code can only be used from local settings file.
        POLICY: 17,                // Used to send a policy block to another peer.
        POLICYSECRET: 18,          // Used to encode the PKCS12 private key of a policy block.
        EVENTMASK: 19,             // Used by the mesh service to change the event mask.
        RECONNECT: 20,             // Used by the mesh service to indicate disconnect & reconnection after n seconds.
        GETSTATE: 21,              // Used by the mesh service to obtain agent state.
        CERTENCRYPTED: 22,         // Used to send a certificate encrypted message to a node.
        GETCOOKIE: 23,             // Used to request a certificate encryption anti-replay cookie.
        COOKIE: 24,                // Used to carry an anti-replay cookie to a requestor.
        SESSIONCKEY: 25,           // Used to send a session key to a remote console.
        INTERFACE: 26,	           // Used to send a local interface blob to a management console.
        MULTICAST: 27,	           // Used by the mesh service to cause the agent to send a multicast.
        SELFEXE: 28,	           // Used to transfer our own agent executable.
        LEADERBADGE: 29,           // User to send a leadership badge.
        NODEINFO: 30,	           // Used to indicate a block information update to the web service.
        TARGETEVENT: 31,           // Used to send a single target update event.
        DEBUG: 33,                 // Used to send debug information to web service.
        TCPRELAY: 34,              // Used to operate mesh leader TCP relay sockets
        CERTSIGNED: 35,            // Used to send a certificate signed message to a node.
        ERRORCODE: 36,             // Used to notify of an error.
        MESSAGE: 37,               // Used to route messages between nodes.
        CMESSAGE: 38,              // Used to embed a interface identifier along with a PB_MESSAGE.
        EMESSAGE: 39,              // Used to embed a target encryption certificate along with a MESSAGE or CMESSAGE.
        SEARCH: 40,                // Used to send a custom search to one or more remote nodes.
        MESSAGERELAY: 41,          // Used by no-certificate consoles to send hopping messages to nodes.
        USERINPUT: 42,             // Used to send user keyboard input to a target computer
        APPID: 43,                 // Used to send a block of data to a specific application identifier.
        APPSUBSCRIBE: 44,          // Used to perform local app subscription to an agent.
        APPDIRECT: 45,             // Used to send message directly to remote applications.
        APPREQACK: 46,             // Used to request an ack message.
        APPACK: 47,                // Used to ack a received message.
        SERVERECHO: 48,            // Server will echo this message, used for testing.
        KVMINFO: 49,               // Used to send local KVM secondary process information to mesh agent.
        REMOTEWAKE: 50,            // Used to send remote wake information to server.
        NEWCONNECTTOKEN: 51,       // Used to send a new connection token to the Swarm Server.
        WIFISCAN: 52,              // Used to send visible WIFI AP's to the server.
        AMTPROVISIONING: 53,       // Used by the agent to send Intel AMT provisioning information to the server.
        ANDROIDCOMMAND: 54,        // Send a Android OS specific command (Android only).
        NODEAPPDATA: 55,           // Used to send application specific data block to the server for storage.
        PROXY: 56,                 // Used to indicate the currently used proxy setting string.
        FILEOPERATION: 57,         // Used to perform short file operations.
        APPSUBSCRIBERS: 58,        // Used request and send to the mesh server the list of subscribed applications
        CUSTOM: 100,               // Message containing application specific data.
        USERAUTH: 1000,            // Authenticate a user to the swarm server.
        USERMESH: 1001,            // Request or return the mesh list for this console.
        USERMESHS: 1002,           // Send mesh overview information to the console.
        USERNODES: 1003,           // Send node overview information to the console.
        JUSERMESHS: 1004,          // Send mesh overview information to the console in JSON format.
        JUSERNODES: 1005,          // Send node overview information to the console in JSON format.
        USERPOWERSTATE: 1006,      // Used to send a power command from the console to the server.
        JMESHPOWERTIMELINE: 1007,  // Send the power timeline for all nodes in a mesh.
        JMESHPOWERSUMMARY: 1008,   // Send the power summary for sum of all nodes in a mesh.
        USERCOMMAND: 1009,         // Send a user admin text command to and from the server.
        POWERBLOCK: 1010,          // Request/Response of block of power state information.
        MESHACCESSCHANGE: 1011,    // Notify a console of a change in accessible meshes.
        COOKIEAUTH: 1012,          // Authenticate a user using a crypto cookie.
        NODESTATECHANGE: 1013,     // Indicates a node has changed power state.
        JUSERNODE: 1014,           // Send node overview information to the console in JSON format.
        AMTWSMANEVENT: 1015,       // Intel AMT WSMAN event sent to consoles.
        ROUTINGCOOKIE: 1016,       // Used by a console to request a routing cookie.
        JCOLLABORATION: 1017,      // Request/send back JSON collaboration state.
        JRELATIONS: 1018,          // Request/send back JSON relations state.
        SETCOLLABSTATE: 1019,      // Set the collaboration state for this session.
        ADDRELATION: 1020,         // Request that a new relation be added.
        DELETERELATION: 1021,      // Request a relation be deleted.
        ACCEPTRELATION: 1022,      // Request relation invitation be accepted.
        RELATIONCHANGEEVENT: 1023, // Notify that a relation has changed.
        COLLBCHANGEEVENT: 1024,    // Notify that a collaboration state has change.
        MULTICONSOLEMESSAGE: 1025, // Send a message to one or more console id's.
        CONSOLEID: 1026,           // Notify a console of it's console id.
        CHANGERELATIONDATA: 1027,  // Request that relation data be changed.
        SETUSERDATA: 1028,         // Set user data
        GETUSERDATA: 1029,         // Get user data
        SERVERAUTH: 1030,          // Used to verify the certificate of the server
        USERAUTH2: 1031,           // Authenticate a user to the swarm server (Uses SHA1 SALT)
        GUESTREMOTEDESKTOP: 2001,  // Guest usage: Remote Desktop
        GUESTWEBRTCMESH: 2002      // Guest usage: WebRTC Mesh
    };

    obj.server = tls.createServer({ key: certificates.swarmserver.key, cert: certificates.swarmserver.cert, requestCert: true, rejectUnauthorized: false }, onConnection);
    obj.server.listen(args.swarmport, function () { console.log('MeshCentral Legacy Swarm Server running on ' + certificates.CommonName + ':' + args.swarmport + '.'); obj.parent.updateServerState('swarm-port', args.swarmport); }).on('error', function (err) { console.error('ERROR: MeshCentral Swarm Server server port ' + args.swarmport + ' is not available.'); if (args.exactports) { process.exit(); } });
    loadMigrationAgents();

    // Load all migration agents along with full executable in memory
    function loadMigrationAgents() {
        var migrationAgentsDir = null, migrationAgentsPath = obj.parent.path.join(obj.parent.datapath, 'migrationagents');
        try { migrationAgentsDir = obj.parent.fs.readdirSync(migrationAgentsPath); } catch (e) { }
        if (migrationAgentsDir != null) {
            for (var i in migrationAgentsDir) {
                if (migrationAgentsDir[i].toLowerCase().startsWith('meshagent-')) {
                    var migrationAgentName = obj.parent.path.join(migrationAgentsPath, migrationAgentsDir[i]);
                    var agentInfo = migrationAgentsDir[i].substring(10).split('.');
                    var agentVersion = parseInt(agentInfo[0]);
                    var agentArch = parseInt(agentInfo[1]);
                    if (obj.migrationAgents[agentArch] == null) { obj.migrationAgents[agentArch] = {}; }
                    if (obj.migrationAgents[agentArch][agentVersion] == null) { obj.migrationAgents[agentArch][agentVersion] = { arch: agentArch, ver: agentVersion, path: migrationAgentName }; }
                }
            }
        }
    }

    function onData(data) {
        if (this.relaySocket) { var ps = this; try { this.relaySocket.write(data, 'binary', function () { ps.resume(); }); } catch (ex) { } return; }
        if (args.swarmdebug) { var buf = Buffer.from(data, "binary"); console.log('SWARM <-- (' + buf.length + '):' + buf.toString('hex')); } // Print out received bytes
        obj.stats.bytesIn += data.length;
        this.tag.accumulator += data;

        // Detect if this is an HTTPS request, if it is, return a simple answer and disconnect. This is useful for debugging access to the MPS port.
        if (this.tag.first == true) {
            if (this.tag.accumulator.length < 3) return;
            if ((this.tag.accumulator.substring(0, 3) == 'GET') || (this.tag.accumulator.substring(0, 3) == 'POS')) {
                obj.stats.httpGetRequest++;
                /*console.log("Swarm Connection, HTTP GET detected: " + socket.remoteAddress);*/
                //socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>MeshCentral2 legacy swarm server.<br />MeshCentral1 mesh agents should connect here for updates.</body></html>');
                //socket.end();

                // Relay this connection to the main TLS port
                this.pause();
                var relaySocket = tls.connect(obj.args.port, { rejectUnauthorized: false }, function () { this.write(this.parentSocket.tag.accumulator); this.parentSocket.resume(); });
                relaySocket.on('data', function (data) { try { var rs = this; this.pause(); this.parentSocket.write(data, 'binary', function () { rs.resume(); }); } catch (ex) { } });
                relaySocket.on('error', function (err) { try { this.parentSocket.end(); } catch (ex) { } });
                relaySocket.on('end', function () { try { this.parentSocket.end(); } catch (ex) { } });
                this.relaySocket = relaySocket;
                relaySocket.parentSocket = this;
                return;
            }
            this.tag.first = false;
        }

        // A client certificate is required
        if ((this.tag.clientCert == null) || (this.tag.clientCert.subject == null)) {
            /*console.log("Swarm Connection, no client cert: " + socket.remoteAddress);*/
            this.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMeshCentral2 legacy swarm server.\r\nNo client certificate given.');
            //this.end(); // If we don't close the connection, it may lead to less reconnection traffic.
            return;
        }

        try {
            // Parse all of the agent binary command data we can
            var l = 0;
            do { l = ProcessCommand(this); if (l > 0) { this.tag.accumulator = this.tag.accumulator.substring(l); } } while (l > 0);
            if (l < 0) { this.end(); }
        } catch (e) {
            console.log(e);
        }
    }

    // Process one AFP command
    function ProcessCommand(socket) {
        if (socket.tag.accumulator.length < 4) return 0;
        var cmd = common.ReadShort(socket.tag.accumulator, 0);
        var len = common.ReadShort(socket.tag.accumulator, 2);
        if (len > socket.tag.accumulator.length) return 0;
        var data = socket.tag.accumulator.substring(4, len);
        //console.log('Swarm: Cmd=' + cmd + ', Len=' + len + '.');

        switch (cmd) {
            case LegacyMeshProtocol.NODEPUSH: {
                parent.debug('swarmcmd', 'NODEPUSH');
                var nodeblock = obj.decodeNodeBlock(data);
                if ((nodeblock != null) && (nodeblock.agenttype != null) && (nodeblock.agentversion != null)) {
                    if (socket.pingTimer == null) { socket.pingTimer = setInterval(function () { obj.SendCommand(socket, LegacyMeshProtocol.PING); }, 20000); }
                    parent.debug('swarmcmd', 'NODEPUSH:' + JSON.stringify(nodeblock));

                    // Log the agent type
                    if (obj.stats.agenttype[nodeblock.agenttype] == null) { obj.stats.agenttype[nodeblock.agenttype] = 1; } else { obj.stats.agenttype[nodeblock.agenttype]++; }

                    // Check if this agent is asking of updates over and over again.
                    var actionCount = obj.agentActionCount[nodeblock.nodeidhex];
                    if (actionCount == null) { actionCount = 0; }
                    if (actionCount > 2) {
                        // Already tried to update this agent two times, something is not right.
                        //console.log('SWARM: ' + actionCount + ' update actions on ' + nodeblock.nodeidhex + ', holding.');
                    } else {
                        // Figure out what is the next agent version we need.
                        var nextAgentVersion = 0;
                        if (nodeblock.agentversion < 201) { nextAgentVersion = 201; } // If less then 201, move to transitional MC1 agent.
                        if (nodeblock.agentversion == 201) { nextAgentVersion = 202; } // If at 201, move to first MC2 agent.

                        // See if we need to start the agent update
                        if ((nextAgentVersion > 0) && (obj.migrationAgents[nodeblock.agenttype] != null) && (obj.migrationAgents[nodeblock.agenttype][nextAgentVersion] != null)) {
                            // Start the update
                            socket.tag.update = obj.migrationAgents[nodeblock.agenttype][nextAgentVersion];
                            socket.tag.updatePtr = 0;
                            //console.log('Performing legacy agent update from ' + nodeblock.agentversion + '.' + nodeblock.agenttype + ' to ' + socket.tag.update.ver + '.' + socket.tag.update.arch + ' on ' + nodeblock.agentname + '.');

                            // Update stats
                            if (obj.stats.pushedAgents[nodeblock.agenttype] == null) { obj.stats.pushedAgents[nodeblock.agenttype] = {}; }
                            if (obj.stats.pushedAgents[nodeblock.agenttype][nextAgentVersion] == null) { obj.stats.pushedAgents[nodeblock.agenttype][nextAgentVersion] = 1; } else { obj.stats.pushedAgents[nodeblock.agenttype][nextAgentVersion]++; }

                            // Start the agent download using the task limiter so not to flood the server. Low priority task
                            obj.parent.taskLimiter.launch(function (socket, taskid, taskLimiterQueue) {
                                if (socket.xclosed == 1) {
                                    // Socket is closed, do nothing
                                    obj.parent.taskLimiter.completed(taskid); // Indicate this task complete
                                } else {
                                    // Start the agent update
                                    socket.tag.taskid = taskid;
                                    obj.SendCommand(socket, LegacyMeshProtocol.GETSTATE, common.IntToStr(5) + common.IntToStr(0)); // agent.SendQuery(5, 0); // Start the agent download
                                }
                            }, socket, 2);
                        } else {
                            //console.log('No legacy agent update for ' + nodeblock.agentversion + '.' + nodeblock.agenttype + ' on ' + nodeblock.agentname + '.');
                        }
                    }

                    // Mark this agent
                    obj.agentActionCount[nodeblock.nodeidhex] = ++actionCount;
                }
                break;
            }
            case LegacyMeshProtocol.AMTPROVISIONING: {
                parent.debug('swarmcmd', 'AMTPROVISIONING');
                obj.SendCommand(socket, LegacyMeshProtocol.AMTPROVISIONING, common.ShortToStr(1));
                break;
            }
            case LegacyMeshProtocol.GETSTATE: {
                parent.debug('swarmcmd', 'GETSTATE');
                if (len < 12) break;
                var statecmd = common.ReadInt(data, 0);
                //var statesync = common.ReadInt(data, 4);
                switch (statecmd) {
                    case 6: { // Ask for agent block
                        if (socket.tag.update != null) {
                            // Send an agent block
                            if (socket.tag.update.binary == null) { socket.tag.update.binary = obj.parent.fs.readFileSync(socket.tag.update.path); }
                            var l = Math.min(socket.tag.update.binary.length - socket.tag.updatePtr, 16384);
                            obj.SendCommand(socket, LegacyMeshProtocol.GETSTATE, common.IntToStr(6) + common.IntToStr(socket.tag.updatePtr) + socket.tag.update.binary.toString('binary', socket.tag.updatePtr, socket.tag.updatePtr + l)); // agent.SendQuery(6, AgentFileLen + AgentBlock);
                            parent.debug('swarmcmd', 'Sending agent block, ptr = ' + socket.tag.updatePtr + ', len = ' + l);

                            socket.tag.updatePtr += l;
                            if (socket.tag.updatePtr >= socket.tag.update.binary.length) {
                                // Send end-of-transfer
                                obj.SendCommand(socket, LegacyMeshProtocol.GETSTATE, common.IntToStr(7) + common.IntToStr(socket.tag.update.binary.length)); //agent.SendQuery(7, AgentFileLen);
                                parent.debug('swarmcmd', 'Sending end of agent, ptr = ' + socket.tag.updatePtr);
                                obj.parent.taskLimiter.completed(socket.tag.taskid); // Indicate this task complete
                                delete socket.tag.taskid;
                                delete socket.tag.update;
                                delete socket.tag.updatePtr;
                            }
                        }
                        break;
                    }
                    default: {
                        // All other state commands from the legacy agent must be ignored.
                        break;
                    }
                }
                break;
            }
            case LegacyMeshProtocol.APPSUBSCRIBERS: {
                parent.debug('swarmcmd', 'APPSUBSCRIBERS');
                break;
            }
            default: {
                parent.debug('swarmcmd', 'Unknown command: ' + cmd + ' of len ' + len + '.');
            }
        }
        return len;
    }

    // Called when a legacy agent connects to this server
    function onConnection(socket) {
        // Check for blocked IP address
        if (checkSwarmIpAddress(socket, obj.args.swarmallowedip) == false) { obj.stats.blockedConnect++; parent.debug('swarm', "New blocked agent connection"); return; }
        obj.stats.connectCount++;

        socket.tag = { first: true, clientCert: socket.getPeerCertificate(true), accumulator: "" };
        parent.debug('swarm', 'New legacy agent connection');

        if ((socket.tag.clientCert == null) || (socket.tag.clientCert.subject == null)) { obj.stats.noCertConnectCount++; } else { obj.stats.clientCertConnectCount++; }

        socket.addListener("data", onData);
        socket.addListener("close", function () {
            obj.stats.onclose++;
            parent.debug('swarm', 'Connection closed');
            
            // Perform aggressive cleanup
            if (this.relaySocket) { try { this.relaySocket.end(); this.relaySocket.removeAllListeners(["data", "end", "error"]); delete this.relaySocket; } catch (ex) { } }
            if (this.pingTimer != null) { clearInterval(this.pingTimer); delete this.pingTimer; }
            if (this.tag && (typeof this.tag.taskid == 'number')) {
                obj.parent.taskLimiter.completed(this.tag.taskid); // Indicate this task complete
                delete this.tag.taskid;
            }
            if (this.tag) {
                if (this.tag.accumulator) { delete this.tag.accumulator; }
                if (this.tag.clientCert) { delete this.tag.clientCert; }
                delete this.tag;
            }
            this.removeAllListeners([ "data", "close", "error" ]);
        });

        socket.addListener("error", function () {
            //console.log("Swarm Error: " + socket.remoteAddress);
        });
    }

    function getTagClass(data, tagClass, type) {
        if ((data == null) || (data.value == null)) return;
        for (var i in data.value) {
            //console.log(JSON.stringify(data.value[i]));
            if ((data.value[i].tagClass == tagClass) && (data.value[i].type == type)) {
                return data.value[i];
            }
        }
    }

    // Decode a node push block
    obj.decodeNodeBlock = function (data) {
        try {
            // Traverse the DER to get the raw data (Not sure if this works all the time)
            var info = {}, ptr = 68, der = forge.asn1.fromDer(forge.util.createBuffer(data, 'binary'));
            der = getTagClass(der, 128, 0);
            der = getTagClass(der, 0, 16);
            der = getTagClass(der, 0, 16);
            der = getTagClass(der, 128, 0);
            der = getTagClass(der, 0, 4);
            var binarydata = der.value;

            // Get the basic header values
            info.certhashhex = common.rstr2hex(binarydata.substring(0, 32)); // Hash of the complete mesh agent certificate
            info.nodeidhex = common.rstr2hex(binarydata.substring(32, 64)); // Old mesh agent nodeid
            info.serialNumber = common.ReadIntX(binarydata, 64); // Block serial number

            // Got thru the sub-blocks
            while (ptr < binarydata.length) {
                var btyp = common.ReadShort(binarydata, ptr), blen = common.ReadShort(binarydata, ptr + 2), bdata = binarydata.substring(ptr + 4, ptr + 4 + blen);
                switch (btyp) {
                    case 1: { // PBST_COMPUTERINFO
                        info.agenttype = common.ReadShortX(bdata, 0);
                        info.agentbuild = common.ReadShortX(bdata, 2);
                        info.agentversion = common.ReadIntX(bdata, 4);
                        info.agentname = bdata.substring(8, 64 + 8);
                        var xx = info.agentname.indexOf('\u0000');
                        if (xx >= 0) { info.agentname = info.agentname.substring(0, xx); }
                        info.agentosdesc = bdata.substring(64 + 8, 64 + 64 + 8);
                        xx = info.agentosdesc.indexOf('\u0000');
                        if (xx >= 0) { info.agentosdesc = info.agentosdesc.substring(0, xx); }
                        return info;
                    }
                    default: {
                        // All other commands from the legacy agent must be ignored.
                        break;
                    }
                }
                ptr += blen;
            }
            return info;
        } catch (e) { }
        return null;
    };

    // Disconnect legacy agent connection
    obj.close = function (socket) {
        obj.stats.close++;
        try { socket.close(); } catch (e) { }
        socket.xclosed = 1;
    };

    obj.SendCommand = function (socket, cmdid, data) {
        if (data == null) { data = ''; }
        Write(socket, common.ShortToStr(cmdid) + common.ShortToStr(data.length + 4) + data);
    };

    function Write(socket, data) {
        obj.stats.bytesOut += data.length;
        if (args.swarmdebug) {
            // Print out sent bytes
            var buf = Buffer.from(data, "binary");
            console.log('SWARM --> (' + buf.length + '):' + buf.toString('hex'));
            socket.write(buf);
        } else {
            socket.write(Buffer.from(data, "binary"));
        }
    }

    // Check if the source IP address is allowed for a given allowed list, return false if not
    function checkSwarmIpAddress(socket, allowedIpList) {
        if (allowedIpList == null) { return true; }
        try {
            var ip = socket.remoteAddress;
            if (ip) { for (var i = 0; i < allowedIpList.length; i++) { if (require('ipcheck').match(ip, allowedIpList[i])) { return true; } } }
        } catch (e) { console.log(e); }
        return false;
    }

    return obj;
};
