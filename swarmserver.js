/**
* @description Meshcentral1 legacy swarm server, used to update agents and get them on MeshCentral2
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a legacy Swarm Server server object
module.exports.CreateSwarmServer = function (parent, db, args, certificates) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = certificates;
    //obj.legacyAgentConnections = {};
    var common = require('./common.js');
    var net = require('net');
    var tls = require('tls');

    var LegacyMeshProtocol = {
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
        KVMINFO: 49,               // Used to send local KVM slave process information to mesh agent.
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
    }

    obj.server = tls.createServer({ key: certificates.swarmserver.key, cert: certificates.swarmserver.cert, requestCert: true }, onConnection);
    obj.server.listen(args.swarmport, function () { console.log('MeshCentral Legacy Swarm Server running on ' + certificates.CommonName + ':' + args.swarmport + '.'); }).on('error', function (err) { console.error('ERROR: MeshCentral Swarm Server server port ' + args.swarmport + ' is not available.'); if (args.exactports) { process.exit(); } });
    
    function onConnection(socket) {
        socket.tag = { first: true, clientCert: socket.getPeerCertificate(true), accumulator: "", socket: socket };
        socket.setEncoding('binary');
        Debug(1, 'SWARM:New legacy agent connection');
        
        socket.addListener("data", function (data) {
            if (args.swarmdebug) { var buf = new Buffer(data, "binary"); console.log('SWARM <-- (' + buf.length + '):' + buf.toString('hex')); } // Print out received bytes
            socket.tag.accumulator += data;
            
            // Detect if this is an HTTPS request, if it is, return a simple answer and disconnect. This is useful for debugging access to the MPS port.
            if (socket.tag.first == true) {
                if (socket.tag.accumulator.length < 3) return;
                if (socket.tag.accumulator.substring(0, 3) == 'GET') { console.log("Swarm Connection, HTTP GET detected: " + socket.remoteAddress); socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>MeshCentral2 legacy swarm server.<br />MeshCentral1 mesh agents should connect here for updates.</body></html>'); socket.end(); return; }
                socket.tag.first = false;
            }

            // A client certificate is required
            if (!socket.tag.clientCert.subject) { console.log("Swarm Connection, no client cert: " + socket.remoteAddress); socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMeshCentral2 legacy swarm server.\r\nNo client certificate given.'); socket.end(); return; }

            try {
                // Parse all of the APF data we can
                var l = 0;
                do { l = ProcessCommand(socket); if (l > 0) { socket.tag.accumulator = socket.tag.accumulator.substring(l); } } while (l > 0);
                if (l < 0) { socket.end(); }
            } catch (e) {
                console.log(e);
            }
        });

        // Process one AFP command
        function ProcessCommand(socket) {
            if (socket.tag.accumulator.length < 4) return 0;
            var cmd = common.ReadShort(socket.tag.accumulator, 0);
            var len = common.ReadShort(socket.tag.accumulator, 2);
            if (len > socket.tag.accumulator.length) return 0;

            console.log('Swarm: Cmd=' + cmd + ', Len=' + len + '.');

            switch (cmd) {
                case LegacyMeshProtocol.NODEPUSH: {
                    Debug(3, 'Swarm:NODEPUSH');
                }
                default: {
                    Debug(1, 'Swarm:Unknown command: ' + cmd + ' of len ' + len + '.');
                }
            }
            return len;
        }
        
        socket.addListener("close", function () {
            Debug(1, 'Swarm:Connection closed');
            try { delete obj.ciraConnections[socket.tag.nodeid]; } catch (e) { }
            obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2);
        });
        
        socket.addListener("error", function () {
            //console.log("Swarm Error: " + socket.remoteAddress);
        });
    }
    
    // Disconnect legacy agent connection
    obj.close = function (socket) {
        try { socket.close(); } catch (e) { }
        try { delete obj.ciraConnections[socket.tag.nodeid]; } catch (e) { }
        obj.parent.ClearConnectivityState(socket.tag.meshid, socket.tag.nodeid, 2);
    }

    function Write(socket, data) {
        if (args.swarmdebug) {
            // Print out sent bytes
            var buf = new Buffer(data, "binary");
            console.log('Swarm --> (' + buf.length + '):' + buf.toString('hex'));
            socket.write(buf);
        } else {
            socket.write(new Buffer(data, "binary"));
        }
    }
    
    // Debug
    function Debug(lvl) {
        if (lvl > obj.parent.debugLevel) return;
        if (arguments.length == 2) { console.log(arguments[1]); }
        else if (arguments.length == 3) { console.log(arguments[1], arguments[2]); }
        else if (arguments.length == 4) { console.log(arguments[1], arguments[2], arguments[3]); }
        else if (arguments.length == 5) { console.log(arguments[1], arguments[2], arguments[3], arguments[4]); }
        else if (arguments.length == 6) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]); }
        else if (arguments.length == 7) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]); }
    }

    return obj;
}
