/**
* @description MQTT broker reference implementation based on AEDES
* @author Joko Banu Sastriawan, Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

module.exports.CreateMQTTBroker = function (parent, db, args) {

    var obj = {}
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.aedes = require("aedes")();
    obj.handle = obj.aedes.handle;
    obj.connections = {}; // NodesID --> client array

    // Connection Authentication
    obj.aedes.authenticate = function (client, username, password, callback) {
        // TODO: add authentication handler
        obj.parent.debug("mqtt", "Authentication with " + username + ":" + password + ":" + client.id + ", " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip));

        var usersplit = username.split(':');
        if (usersplit.length != 5) { callback(null, false); return; }

        // Setup the identifiers
        var xnodeid = usersplit[1];
        var xmeshid = usersplit[2];
        var xdomainid = usersplit[3];

        // Convert meshid from HEX to Base64 if needed
        if (xmeshid.length == 96) { xmeshid = Buffer.from(xmeshid, 'hex').toString('base64'); }
        if ((xmeshid.length != 64) || (xnodeid.length != 64)) { callback(null, false); return; }

        client.xdbNodeKey = 'node/' + xdomainid + '/' + xnodeid;
        client.xdbMeshKey = 'mesh/' + xdomainid + '/' + xmeshid;

        // Check if this node exists in the database
        db.Get(client.xdbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { callback(null, false); return; } // Node does not exist

            // If this device now has a different meshid, fix it here.
            client.xdbMeshKey = nodes[0].meshid;

            if (obj.connections[client.xdbNodeKey] == null) {
                obj.connections[client.xdbNodeKey] = [client];
                parent.SetConnectivityState(client.xdbMeshKey, client.xdbNodeKey, Date.now(), 16, 7); // Indicate this node has a MQTT connection, 7 = Present state
            } else {
                obj.connections[client.xdbNodeKey].push(client);
            }

            client.conn.parent = client;
            client.conn.on('end', function () {
                // client is "this.parent"
                obj.parent.debug("mqtt", "Connection closed, " + this.parent.conn.xtransport + "://" + cleanRemoteAddr(this.parent.conn.xip));

                // Remove this client from the connections list
                if ((this.parent.xdbNodeKey != null) && (obj.connections[this.parent.xdbNodeKey] != null)) {
                    var clients = obj.connections[this.parent.xdbNodeKey], i = clients.indexOf(client);
                    if (i >= 0) {
                        if (clients.length == 1) {
                            delete obj.connections[this.parent.xdbNodeKey];
                            parent.ClearConnectivityState(this.parent.xdbMeshKey, this.parent.xdbNodeKey, 16); // Remove the MQTT connection for this node
                        } else { clients.splice(i, 1); }
                    }
                }

                this.parent.close();
            });
            callback(null, true);
        });
    }

    // Check if a client can publish a packet
    obj.aedes.authorizePublish = function (client, packet, callback) {
        // TODO: add authorized publish control
        obj.parent.debug("mqtt", "AuthorizePublish, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip));
        callback(null);
    }

    // Check if a client can publish a packet
    obj.aedes.authorizeSubscribe = function (client, sub, callback) {
        // TODO: add subscription control here
        obj.parent.debug("mqtt", "AuthorizeSubscribe, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip));
        callback(null, sub);
    }

    // Check if a client can publish a packet
    obj.aedes.authorizeForward = function (client, packet) {
        // TODO: add forwarding control
        obj.parent.debug("mqtt", "AuthorizeForward, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip));
        //return packet;
        return packet;
    }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (typeof addr != 'string') { return null; } if (addr.indexOf('::ffff:') == 0) { return addr.substring(7); } else { return addr; } }

    return obj;
}
