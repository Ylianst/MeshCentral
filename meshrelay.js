/**
* @description Meshcentral MeshRelay
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a MeshRelay object, called upon connection
module.exports.CreateMeshRelayKey = function (parent, func) {
    parent.crypto.randomBytes(16, function (err, buf) {
        var key = buf.toString('hex').toUpperCase() + ':' + Date.now();
        key += ':' + parent.crypto.createHmac('SHA256', parent.relayRandom).update(key).digest('hex');
        func(key);
    });
}

module.exports.CreateMeshRelay = function (parent, ws, req) {
    var obj = {};
    obj.ws = ws;
    obj.req = req;
    obj.peer = null;
    obj.parent = parent;
    obj.id = req.query['id'];
    obj.remoteaddr = obj.ws._socket.remoteAddress;
    if (obj.remoteaddr.startsWith('::ffff:')) { obj.remoteaddr = obj.remoteaddr.substring(7); }

    if (obj.id == undefined) { obj.ws.close(); obj.id = null; return null; } // Attempt to connect without id, drop this.

    if (req.query.auth == null) {
        // Use ExpressJS session, check if this session is a logged in user, at least one of the two connections will need to be authenticated.
        try { if ((req.session) && (req.session.userid) || (req.session.domainid == getDomain(req).id)) { obj.authenticated = true; } } catch (e) { }
    } else {
        // Get the session from the cookie
        if ((obj.parent.parent.multiServer != null) && (obj.parent.parent.multiServer.decodeCookie(req.query.auth) != null)) { obj.authenticated = true; }
    }

    // Validate that the id is valid, we only need to do this on non-authenticated sessions.
    // TODO: Figure out when this needs to be done.
    /*
    if (!parent.args.notls) {
        // Check the identifier, if running without TLS, skip this.
        var ids = obj.id.split(':');
        if (ids.length != 3) { obj.ws.close(); obj.id = null; return null; } // Invalid ID, drop this.
        if (parent.crypto.createHmac('SHA256', parent.relayRandom).update(ids[0] + ':' + ids[1]).digest('hex') != ids[2]) { obj.ws.close(); obj.id = null; return null; } // Invalid HMAC, drop this.
        if ((Date.now() - parseInt(ids[1])) > 120000) { obj.ws.close(); obj.id = null; return null; } // Expired time, drop this.
        obj.id = ids[0];
    }
    */

    // Check the peer connection status
    {
        var relayinfo = parent.wsrelays[obj.id];
        if (relayinfo) {
            if (relayinfo.state == 1) {
                // Check that at least one connection is authenticated
                if ((obj.authenticated != true) && (relayinfo.peer1.authenticated != true)) {
                    obj.id = null;
                    obj.ws.close();
                    obj.parent.parent.debug(1, 'Relay without-auth: ' + obj.id + ' (' + obj.remoteaddr + ')');
                    return null;
                }

                // Connect to peer
                obj.peer = relayinfo.peer1;
                obj.peer.peer = obj;
                relayinfo.peer2 = obj;
                relayinfo.state = 2;
                obj.ws.send('c'); // Send connect to both peers
                relayinfo.peer1.ws.send('c');
                relayinfo.peer1.ws.resume(); // Release the traffic

                relayinfo.peer1.ws.peer = relayinfo.peer2.ws;
                relayinfo.peer2.ws.peer = relayinfo.peer1.ws;

                obj.parent.parent.debug(1, 'Relay connected: ' + obj.id + ' (' + obj.remoteaddr + ' --> ' + obj.peer.remoteaddr +  ')');
            } else {
                // Connected already, drop (TODO: maybe we should re-connect?)
                obj.id = null;
                obj.ws.close();
                obj.parent.parent.debug(1, 'Relay duplicate: ' + obj.id + ' (' + obj.remoteaddr + ')');
                return null;
            }
        } else {
            // Wait for other relay connection
            ws.pause(); // Hold traffic until the other connection
            parent.wsrelays[obj.id] = { peer1: obj, state: 1 };
            obj.parent.parent.debug(1, 'Relay holding: ' + obj.id + ' (' + obj.remoteaddr + ')');

            // Check if a peer server has this connection
            if (parent.parent.multiServer != null) {
                var rsession = obj.parent.wsPeerRelays[obj.id];
                if ((rsession != null) && (rsession.serverId > obj.parent.parent.serverId)) {
                    // We must initiate the connection to the peer
                    parent.parent.multiServer.createPeerRelay(ws, req, rsession.serverId, req.session.userid);
                    delete parent.wsrelays[obj.id];
                } else {
                    // Send message to other peers that we have this connection
                    parent.parent.multiServer.DispatchMessage(JSON.stringify({ action: 'relay', id: obj.id }));
                }
            }
        }
    }
    
    ws.flushSink = function () {
        try { ws.resume(); } catch (e) { }
    };

    // When data is received from the mesh relay web socket
    ws.on('message', function (data) {
        if (this.peer != null) { try { this.pause(); this.peer.send(data, ws.flushSink); } catch (e) { } }
    });

    // If error, do nothing
    ws.on('error', function (err) { console.log(err); });

    // If the mesh relay web socket is closed
    ws.on('close', function (req) {
        if (obj.id != null) {
            var relayinfo = parent.wsrelays[obj.id];
            if (relayinfo != null) {
                if (relayinfo.state == 2) {
                    // Disconnect the peer
                    var peer = (relayinfo.peer1 == obj) ? relayinfo.peer2 : relayinfo.peer1;
                    obj.parent.parent.debug(1, 'Relay disconnect: ' + obj.id + ' (' + obj.remoteaddr + ' --> ' + peer.remoteaddr + ')');
                    peer.id = null;
                    try { peer.ws.close(); } catch (e) { } // Soft disconnect
                    try { peer.ws._socket._parent.end(); } catch (e) { } // Hard disconnect
                } else {
                    obj.parent.parent.debug(1, 'Relay disconnect: ' + obj.id + ' (' + obj.remoteaddr + ')');
                }
                delete parent.wsrelays[obj.id];
            }
            obj.peer = null;
            obj.id = null;
        }
    });
    
    return obj;
}
