/**
* @description MQTT broker reference implementation based on AEDES
* @author Joko Banu Sastriawan, Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

module.exports.CreateMQTTBroker = function (parent, db, args) {

    var obj = {}
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.connections = {}; // NodesID --> client array
    const aedes = require('aedes')();
    obj.handle = aedes.handle;
    const allowedSubscriptionTopics = ['presence', 'console', 'powerAction'];
    const denyError = new Error('denied');
    var authError = new Error('Auth error')
    authError.returnCode = 1

    // Generate a username and password for MQTT login
    obj.generateLogin = function (meshid, nodeid) {
        const meshidsplit = meshid.split('/'), nodeidsplit = nodeid.split('/');
        const xmeshid = meshidsplit[2], xnodeid = nodeidsplit[2], xdomainid = meshidsplit[1];
        const username = 'MCAuth1:' + xnodeid + ':' + xmeshid + ':' + xdomainid;
        const nonce = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64');
        return { meshid: meshid, nodeid: nodeid, user: username, pass: parent.config.settings.mqtt.auth.keyid + ':' + nonce + ':' + parent.crypto.createHash('sha384').update(username + ':' + nonce + ':' + parent.config.settings.mqtt.auth.key).digest("base64") };
    }

    // Connection Authentication
    aedes.authenticate = function (client, username, password, callback) {
        obj.parent.debug('mqtt', "Authentication User:" + username + ", Pass:" + password.toString() + ", ClientID:" + client.id + ", " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip));

        // Parse the username and password
        var usersplit = username.split(':');
        var passsplit = password.toString().split(':');
        if ((usersplit.length !== 4) || (passsplit.length !== 3)) { obj.parent.debug('mqtt', "Invalid user/pass format, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip)); callback(authError, null); return; }
        if (usersplit[0] !== 'MCAuth1') { obj.parent.debug('mqtt', "Invalid auth method, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip)); callback(authError, null); return; }

        // Check authentication
        if (passsplit[0] !== parent.config.settings.mqtt.auth.keyid) { obj.parent.debug('mqtt', "Invalid auth keyid, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip)); callback(authError, null); return; }
        if (parent.crypto.createHash('sha384').update(username + ':' + passsplit[1] + ':' + parent.config.settings.mqtt.auth.key).digest("base64") !== passsplit[2]) { obj.parent.debug("mqtt", "Invalid password, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip)); callback(authError, null); return; }

        // Setup the identifiers
        const xnodeid = usersplit[1];
        var xmeshid = usersplit[2];
        const xdomainid = usersplit[3];

        // Check the domain
        if ((typeof client.conn.xdomain == 'object') && (xdomainid != client.conn.xdomain.id)) { obj.parent.debug('mqtt', "Invalid domain connection, " + client.conn.xtransport + "://" + cleanRemoteAddr(client.conn.xip)); callback(null, false); return; }

        // Convert meshid from HEX to Base64 if needed
        if (xmeshid.length === 96) { xmeshid = Buffer.from(xmeshid, 'hex').toString('base64'); }
        if ((xmeshid.length !== 64) || (xnodeid.length != 64)) { callback(authError, null); return; }

        // Set the client nodeid and meshid
        client.xdbNodeKey = 'node/' + xdomainid + '/' + xnodeid;
        client.xdbMeshKey = 'mesh/' + xdomainid + '/' + xmeshid;
        client.xdomainid = xdomainid;

        // Check if this node exists in the database
        db.Get(client.xdbNodeKey, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { callback(authError, null); return; } // Node does not exist

            // If this device now has a different meshid, fix it here.
            client.xdbMeshKey = nodes[0].meshid;

            if (obj.connections[client.xdbNodeKey] == null) {
                obj.connections[client.xdbNodeKey] = [client];
                parent.SetConnectivityState(client.xdbMeshKey, client.xdbNodeKey, Date.now(), 16, 7, null, { name: nodes[0].name }); // Indicate this node has a MQTT connection, 7 = Present state
            } else {
                obj.connections[client.xdbNodeKey].push(client);
            }

            client.conn.parent = client;
            client.conn.on('end', function () {
                // client is "this.parent"
                obj.parent.debug('mqtt', "Connection closed, " + this.parent.conn.xtransport + '://' + cleanRemoteAddr(this.parent.conn.xip));

                // Remove this client from the connections list
                if ((this.parent.xdbNodeKey != null) && (obj.connections[this.parent.xdbNodeKey] != null)) {
                    var clients = obj.connections[this.parent.xdbNodeKey], i = clients.indexOf(client);
                    if (i >= 0) {
                        if (clients.length == 1) {
                            delete obj.connections[this.parent.xdbNodeKey];
                            parent.ClearConnectivityState(this.parent.xdbMeshKey, this.parent.xdbNodeKey, 16, null, { name: nodes[0].name }); // Remove the MQTT connection for this node
                        } else { clients.splice(i, 1); }
                    }
                }

                this.parent.close();
            });
            callback(null, true);
        });
    }

    // Check if a client can publish a packet
    aedes.authorizeSubscribe = function (client, sub, callback) {
        // Subscription control
        obj.parent.debug('mqtt', "AuthorizeSubscribe \"" + sub.topic + '", ' + client.conn.xtransport + '://' + cleanRemoteAddr(client.conn.xip));
        if (allowedSubscriptionTopics.indexOf(sub.topic) === -1) { sub = null; } // If not a supported subscription, deny it.
        callback(null, sub); // We authorize supported topics, but will not allow agents to publish anything to other agents.
    }

    // Check if a client can publish a packet
    aedes.authorizePublish = function (client, packet, callback) {
        // Handle a published message
        obj.parent.debug('mqtt', "AuthorizePublish, " + client.conn.xtransport + '://' + cleanRemoteAddr(client.conn.xip));
        handleMessage(client.xdbNodeKey, client.xdbMeshKey, client.xdomainid, packet.topic, packet.payload);
        // We don't accept that any client message be published, so don't call the callback.
    }

    // Publish a message to a specific nodeid & topic, also send this to peer servers.
    obj.publish = function (nodeid, topic, message) {
        // Publish this message on peer servers.
        if (parent.multiServer != null) { parent.multiServer.DispatchMessage(JSON.stringify({ action: 'mqtt', nodeid: nodeid, topic: topic, message: message })); }
        obj.publishNoPeers(nodeid, topic, message);
    }

    // Publish a message to a specific nodeid & topic, don't send to peer servers.
    obj.publishNoPeers = function (nodeid, topic, message) {
        // Look for any MQTT connections to send this to
        var clients = obj.connections[nodeid];
        if (clients == null) return;
        if (typeof message == 'string') { message = Buffer.from(message); }
        for (var i in clients) {
            // Only publish to client that subscribe to the topic
            if (clients[i].subscriptions[topic] != null) {
                clients[i].publish({ cmd: 'publish', qos: 0, topic: topic, payload: message, retain: false }, function () { });
            }
        }
    }

    // Handle messages coming from clients
    function handleMessage(nodeid, meshid, domainid, topic, message) {
        // Handle messages here
        if (topic == 'console') { parent.webserver.routeAgentCommand({ action: 'msg', type: 'console', value: message.toString(), source: 'MQTT' }, domainid, nodeid, meshid); return; } // Handle console messages

        //console.log('handleMessage', nodeid, topic, message.toString());
        //obj.publish(nodeid, 'echoTopic', "Echo: " + message.toString());
    }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (typeof addr != 'string') { return null; } if (addr.indexOf('::ffff:') == 0) { return addr.substring(7); } else { return addr; } }

    // Change a node to a new meshid
    obj.changeDeviceMesh = function(nodeid, newMeshId) {
        var nodes = obj.connections[nodeid];
        if (nodes != null) { for (var i in nodes) { nodes[i].xdbMeshKey = newMeshId; } }
    }

    return obj;
}
