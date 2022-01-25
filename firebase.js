/**
* @description MeshCentral Firebase communication module
* @author Ylian Saint-Hilaire
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

// Construct the Firebase object
module.exports.CreateFirebase = function (parent, senderid, serverkey) {
    var obj = {};
    obj.messageId = 0;
    obj.relays = {};
    obj.stats = {
        mode: "Real",
        sent: 0,
        sendError: 0,
        received: 0,
        receivedNoRoute: 0,
        receivedBadArgs: 0
    }

    const Sender = require('node-xcs').Sender;
    const Message = require('node-xcs').Message;
    const Notification = require('node-xcs').Notification;
    const xcs = new Sender(senderid, serverkey);

    var tokenToNodeMap = {} // Token --> { nid: nodeid, mid: meshid }

    // Setup logging
    if (parent.config.firebase && (parent.config.firebase.log === true)) {
        obj.logpath = parent.path.join(parent.datapath, 'firebase.txt');
        obj.log = function (msg) { try { parent.fs.appendFileSync(obj.logpath, new Date().toLocaleString() + ': ' + msg + '\r\n'); } catch (ex) { console.log('ERROR: Unable to write to firebase.txt.'); } }
    } else {
        obj.log = function () { }
    }

    // Messages received from client (excluding receipts)
    xcs.on('message', function (messageId, from, data, category) {
        const jsonData = JSON.stringify(data);
        obj.log('Firebase-Message: ' + jsonData);
        parent.debug('email', 'Firebase-Message: ' + jsonData);

        if (typeof data.r == 'string') {
            // Lookup push relay server
            parent.debug('email', 'Firebase-RelayRoute: ' + data.r);
            const wsrelay = obj.relays[data.r];
            if (wsrelay != null) {
                delete data.r;
                try { wsrelay.send(JSON.stringify({ from: from, data: data, category: category })); } catch (ex) { }
            }
        } else {
            // Lookup node information from the cache
            var ninfo = tokenToNodeMap[from];
            if (ninfo == null) { obj.stats.receivedNoRoute++; return; }

            if ((data != null) && (data.con != null) && (data.s != null)) { // Console command
                obj.stats.received++;
                parent.webserver.routeAgentCommand({ action: 'msg', type: 'console', value: data.con, sessionid: data.s }, ninfo.did, ninfo.nid, ninfo.mid);
            } else {
                obj.stats.receivedBadArgs++;
            }
        }
    });

    // Only fired for messages where options.delivery_receipt_requested = true
    /*
    xcs.on('receipt', function (messageId, from, data, category) { console.log('Firebase-Receipt', messageId, from, data, category); });
    xcs.on('connected', function () { console.log('Connected'); });
    xcs.on('disconnected', function () { console.log('disconnected'); });
    xcs.on('online', function () { console.log('online'); });
    xcs.on('error', function (e) { console.log('error', e); });
    xcs.on('message-error', function (e) { console.log('message-error', e); });
    */

    xcs.start();

    obj.log('CreateFirebase-Setup');
    parent.debug('email', 'CreateFirebase-Setup');

    // EXAMPLE
    //var payload = { notification: { title: command.title, body: command.msg }, data: { url: obj.msgurl } };
    //var options = { priority: 'High', timeToLive: 5 * 60 }; // TTL: 5 minutes, priority 'Normal' or 'High'

    obj.sendToDevice = function (node, payload, options, func) {
        if (typeof node == 'string') {
            parent.db.Get(node, function (err, docs) { if ((err == null) && (docs != null) && (docs.length == 1)) { obj.sendToDeviceEx(docs[0], payload, options, func); } else { func(0, 'error'); } })
        } else {
            obj.sendToDeviceEx(node, payload, options, func);
        }
    }

    // Send an outbound push notification
    obj.sendToDeviceEx = function (node, payload, options, func) {
        parent.debug('email', 'Firebase-sendToDevice');
        if ((node == null) || (typeof node.pmt != 'string')) return;
        obj.log('sendToDevice, node:' + node._id + ', payload: ' + JSON.stringify(payload) + ', options: ' + JSON.stringify(options));

        // Fill in our lookup table
        if (node._id != null) { tokenToNodeMap[node.pmt] = { nid: node._id, mid: node.meshid, did: node.domain } }

        // Built the on-screen notification
        var notification = null;
        if (payload.notification) {
            var notification = new Notification('ic_message')
                .title(payload.notification.title)
                .body(payload.notification.body)
                .build();
        }

        // Build the message
        var message = new Message('msg_' + (++obj.messageId));
        if (options.priority) { message.priority(options.priority); }
        if (payload.data) { for (var i in payload.data) { message.addData(i, payload.data[i]); } }
        if ((payload.data == null) || (payload.data.shash == null)) { message.addData('shash', parent.webserver.agentCertificateHashBase64); } // Add the server agent hash, new Android agents will reject notifications that don't have this.
        if (notification) { message.notification(notification) }
        message.build();

        // Send the message
        function callback(result) {
            if (result.getError() == null) { obj.stats.sent++; obj.log('Success'); } else { obj.stats.sendError++; obj.log('Fail'); }
            callback.func(result.getMessageId(), result.getError(), result.getErrorDescription())
        }
        callback.func = func;
        parent.debug('email', 'Firebase-sending');
        xcs.sendNoRetry(message, node.pmt, callback);
    }

    // Setup a two way relay
    obj.setupRelay = function (ws) {
        // Select and set a relay identifier
        ws.relayId = getRandomPassword();
        while (obj.relays[ws.relayId] != null) { ws.relayId = getRandomPassword(); }
        obj.relays[ws.relayId] = ws;
        
        // On message, parse it
        ws.on('message', function (msg) {
            parent.debug('email', 'FBWS-Data(' + this.relayId + '): ' + msg);
            if (typeof msg == 'string') {
                obj.log('Relay: ' + msg);

                // Parse the incoming push request
                var data = null;
                try { data = JSON.parse(msg) } catch (ex) { return; }
                if (typeof data != 'object') return;
                if (parent.common.validateObjectForMongo(data, 4096) == false) return; // Perform sanity checking on this object.
                if (typeof data.pmt != 'string') return;
                if (typeof data.payload != 'object') return;
                if (typeof data.payload.notification == 'object') {
                    if (typeof data.payload.notification.title != 'string') return;
                    if (typeof data.payload.notification.body != 'string') return;
                }
                if (typeof data.options != 'object') return;
                if ((data.options.priority != 'Normal') && (data.options.priority != 'High')) return;
                if ((typeof data.options.timeToLive != 'number') || (data.options.timeToLive < 1)) return;
                if (typeof data.payload.data != 'object') { data.payload.data = {}; }
                data.payload.data.r = ws.relayId; // Set the relay id.

                // Send the push notification
                obj.sendToDevice({ pmt: data.pmt }, data.payload, data.options, function (id, err, errdesc) {
                    if (err == null) {
                        try { wsrelay.send(JSON.stringify({ sent: true })); } catch (ex) { }
                    } else {
                        try { wsrelay.send(JSON.stringify({ sent: false })); } catch (ex) { }
                    }
                });
            }
        });

        // If error, close the relay
        ws.on('error', function (err) {
            parent.debug('email', 'FBWS-Error(' + this.relayId + '): ' + err);
            delete obj.relays[this.relayId];
        });

        // Close the relay
        ws.on('close', function () {
            parent.debug('email', 'FBWS-Close(' + this.relayId + ')');
            delete obj.relays[this.relayId];
        });

    }

    function getRandomPassword() { return Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); }

    return obj;
};


// Construct the Firebase object
module.exports.CreateFirebaseRelay = function (parent, url, key) {
    var obj = {};
    obj.messageId = 0;
    obj.stats = {
        mode: "Relay",
        sent: 0,
        sendError: 0,
        received: 0,
        receivedNoRoute: 0,
        receivedBadArgs: 0
    }
    const WebSocket = require('ws');
    const https = require('https');
    const querystring = require('querystring');
    const relayUrl = require('url').parse(url);
    parent.debug('email', 'CreateFirebaseRelay-Setup');

    // Setup logging
    if (parent.config.firebaserelay && (parent.config.firebaserelay.log === true)) {
        obj.logpath = parent.path.join(parent.datapath, 'firebaserelay.txt');
        obj.log = function (msg) { try { parent.fs.appendFileSync(obj.logpath, new Date().toLocaleString() + ': ' + msg + '\r\n'); } catch (ex) { console.log('ERROR: Unable to write to firebaserelay.txt.'); } }
    } else {
        obj.log = function () { }
    }

    obj.log('Starting relay to: ' + relayUrl.href);
    if (relayUrl.protocol == 'wss:') {
        // Setup two-way push notification channel
        obj.wsopen = false;
        obj.tokenToNodeMap = {}; // Token --> { nid: nodeid, mid: meshid }
        obj.backoffTimer = 0;
        obj.connectWebSocket = function () {
            if (obj.reconnectTimer != null) { try { clearTimeout(obj.reconnectTimer); } catch (ex) { } delete obj.reconnectTimer; }
            if (obj.wsclient != null) return;
            obj.wsclient = new WebSocket(relayUrl.href + (key ? ('?key=' + key) : ''), { rejectUnauthorized: false })
            obj.wsclient.on('open', function () {
                obj.lastConnect = Date.now();
                parent.debug('email', 'FBWS-Connected');
                obj.wsopen = true;
            });
            obj.wsclient.on('message', function (msg) {
                parent.debug('email', 'FBWS-Data(' + msg.length + '): ' + msg);
                obj.log('Received(' + msg.length + '): ' + msg);
                var data = null;
                try { data = JSON.parse(msg) } catch (ex) { }
                if (typeof data != 'object') return;
                if (typeof data.from != 'string') return;
                if (typeof data.data != 'object') return;
                if (typeof data.category != 'string') return;
                processMessage(data.messageId, data.from, data.data, data.category);
            });
            obj.wsclient.on('error', function (err) { obj.log('Error: ' + err); });
            obj.wsclient.on('close', function (a, b, c) {
                parent.debug('email', 'FBWS-Disconnected');
                obj.wsclient = null;
                obj.wsopen = false;

                // Compute the backoff timer
                if (obj.reconnectTimer == null) {
                    if ((obj.lastConnect != null) && ((Date.now() - obj.lastConnect) > 10000)) { obj.backoffTimer = 0; }
                    obj.backoffTimer += 1000;
                    obj.backoffTimer = obj.backoffTimer * 2;
                    if (obj.backoffTimer > 1200000) { obj.backoffTimer = 600000; } // Maximum 10 minutes backoff.
                    obj.reconnectTimer = setTimeout(obj.connectWebSocket, obj.backoffTimer);
                }
            });
        }

        function processMessage(messageId, from, data, category) {
            // Lookup node information from the cache
            var ninfo = obj.tokenToNodeMap[from];
            if (ninfo == null) { obj.stats.receivedNoRoute++; return; }

            if ((data != null) && (data.con != null) && (data.s != null)) { // Console command
                obj.stats.received++;
                parent.webserver.routeAgentCommand({ action: 'msg', type: 'console', value: data.con, sessionid: data.s }, ninfo.did, ninfo.nid, ninfo.mid);
            } else {
                obj.stats.receivedBadArgs++;
            }
        }

        obj.sendToDevice = function (node, payload, options, func) {
            if (typeof node == 'string') {
                parent.db.Get(node, function (err, docs) { if ((err == null) && (docs != null) && (docs.length == 1)) { obj.sendToDeviceEx(docs[0], payload, options, func); } else { func(0, 'error'); } })
            } else {
                obj.sendToDeviceEx(node, payload, options, func);
            }
        }

        obj.sendToDeviceEx = function (node, payload, options, func) {
            parent.debug('email', 'Firebase-sendToDevice-webSocket');
            if ((node == null) || (typeof node.pmt != 'string')) { func(0, 'error'); return; }
            obj.log('sendToDevice, node:' + node._id + ', payload: ' + JSON.stringify(payload) + ', options: ' + JSON.stringify(options));

            // Fill in our lookup table
            if (node._id != null) { obj.tokenToNodeMap[node.pmt] = { nid: node._id, mid: node.meshid, did: node.domain } }

            // Fill in the server agent cert hash
            if (payload.data == null) { payload.data = {}; }
            if (payload.data.shash == null) { payload.data.shash = parent.webserver.agentCertificateHashBase64; } // Add the server agent hash, new Android agents will reject notifications that don't have this.

            // If the web socket is open, send now
            if (obj.wsopen == true) {
                try { obj.wsclient.send(JSON.stringify({ pmt: node.pmt, payload: payload, options: options })); } catch (ex) { func(0, 'error'); obj.stats.sendError++; return; }
                obj.stats.sent++;
                obj.log('Sent');
                func(1);
            } else {
                // TODO: Buffer the push messages until TTL.
                obj.stats.sendError++;
                obj.log('Error');
                func(0, 'error');
            }
        }
        obj.connectWebSocket();
    } else if (relayUrl.protocol == 'https:') {
        // Send an outbound push notification using an HTTPS POST
        obj.pushOnly = true;

        obj.sendToDevice = function (node, payload, options, func) {
            if (typeof node == 'string') {
                parent.db.Get(node, function (err, docs) { if ((err == null) && (docs != null) && (docs.length == 1)) { obj.sendToDeviceEx(docs[0], payload, options, func); } else { func(0, 'error'); } })
            } else {
                obj.sendToDeviceEx(node, payload, options, func);
            }
        }

        obj.sendToDeviceEx = function (node, payload, options, func) {
            parent.debug('email', 'Firebase-sendToDevice-httpPost');
            if ((node == null) || (typeof node.pmt != 'string')) return;

            // Fill in the server agent cert hash
            if (payload.data == null) { payload.data = {}; }
            if (payload.data.shash == null) { payload.data.shash = parent.webserver.agentCertificateHashBase64; } // Add the server agent hash, new Android agents will reject notifications that don't have this.

            obj.log('sendToDevice, node:' + node._id + ', payload: ' + JSON.stringify(payload) + ', options: ' + JSON.stringify(options));
            const querydata = querystring.stringify({ 'msg': JSON.stringify({ pmt: node.pmt, payload: payload, options: options }) });

            // Send the message to the relay
            const httpOptions = {
                hostname: relayUrl.hostname,
                port: relayUrl.port ? relayUrl.port : 443,
                path: relayUrl.path + (key ? ('?key=' + key) : ''),
                method: 'POST',
                //rejectUnauthorized: false, // DEBUG
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': querydata.length
                }
            }
            const req = https.request(httpOptions, function (res) {
                obj.log('Response: ' + res.statusCode);
                if (res.statusCode == 200) { obj.stats.sent++; } else { obj.stats.sendError++; }
                if (func != null) { func(++obj.messageId, (res.statusCode == 200) ? null : 'error'); }
            });
            parent.debug('email', 'Firebase-sending');
            req.on('error', function (error) { obj.stats.sent++; func(++obj.messageId, 'error'); });
            req.write(querydata);
            req.end();
        }
    }

    return obj;
};