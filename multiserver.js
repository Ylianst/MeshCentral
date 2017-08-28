/**
* @description Meshcentral Multi-Server Support
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a Mesh Multi-Server object. This is used for MeshCentral-to-MeshCentral communication.
module.exports.CreateMultiServer = function (parent, args) {
    var obj = {};
    obj.parent = parent;
    obj.crypto = require('crypto');

    // Generate a cryptographic key used to encode and decode cookies
    obj.generateCookieKey = function () {
        return new Buffer(obj.crypto.randomBytes(32), 'binary').toString('ascii');
    }

    // Encode an object as a cookie using a key
    obj.encodeCookie = function (o, key) {
        try {
            if (key == undefined) { key = obj.serverKey; }
            o.time = Math.floor(Date.now() / 1000); // Add the cookie creation time
            var msg = JSON.stringify(o);
            msg = obj.crypto.createHmac('sha256', key.substring(16)).update(msg, 'binary', 'binary').digest('binary') + msg;
            var iv = new Buffer(obj.crypto.randomBytes(16), 'binary');
            var cipher = obj.crypto.createCipheriv('aes-128-cbc', key.substring(0, 16), iv);
            crypted = cipher.update(msg, 'binary', 'binary');
            crypted += cipher.final('binary');
            var total = new Buffer(iv, 'binary').toString('hex') + new Buffer(crypted, 'binary').toString('hex'); // HEX: This is not an efficient concat, but it's very compatible.
            var cookie = new Buffer(total, 'hex').toString('base64');
            return cookie.replace(/\+/g, '@').replace(/\//g, '$');
        } catch (e) { return null; }
    }

    // Decode a cookie back into an object using a key. Return null if it's not a valid cookie.
    obj.decodeCookie = function (cookie, key) {
        try {
            if (key == undefined) { key = obj.serverKey; }
            cookie = new Buffer(cookie.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex'); // HEX: This is not an efficient split, but it's very compatible.
            var iv = new Buffer(cookie.substring(0, 32), 'hex');
            var msg = new Buffer(cookie.substring(32), 'hex');
            var decipher = obj.crypto.createDecipheriv('aes-128-cbc', key.substring(0, 16), iv)
            var dec = decipher.update(msg, 'binary', 'binary')
            dec += decipher.final('binary');
            var msg = dec.substring(32);
            var hash1 = dec.substring(0, 32);
            var hash2 = obj.crypto.createHmac('sha256', key.substring(16)).update(msg, 'binary', 'binary').digest('binary');
            if (hash1 !== hash2) { return null; }
            var o = JSON.parse(msg);
            if ((o.time == null) || (o.time == undefined) || (typeof o.time != 'number')) { return null; }
            o.time = o.time * 1000; // Decode the cookie creation time
            o.dtime = Date.now() - o.time; // Decode how long ago the cookie was created
            return o;
        } catch (e) { return null; }
    }

    // Dispatch an event to other MeshCentral2 peer servers
    obj.DispatchEvent = function (ids, source, event) {
        // TODO
    }

    // Handle websocket requests on "/meshserver.ashx" from other MeshCentral2 peer servers.
    obj.handleServerWebSocket = function (ws, req) {
        Debug(1, 'MeshServer connection open.');

        // Handle data from another mesh server
        ws.on('message', function (msg) {
            Debug(1, 'MeshServer data of length ' + msg.length);
            // TODO
        });

        // If error, do nothing
        ws.on('error', function (err) { console.log(err); });

        // Another mesh server connection has closed
        ws.on('close', function (req) {
            Debug(1, 'MeshServer connection closed.');
            // TODO
        });
    }

    obj.serverKey = obj.generateCookieKey();
    return obj;
}
