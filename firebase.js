/**
* @description MeshCentral Firebase communication module
* @author Ylian Saint-Hilaire
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

// Initialize the Firebase Admin SDK
module.exports.CreateFirebase = function (parent, serviceAccount) {
    
    // Import the Firebase Admin SDK
    const admin = require('firebase-admin');
    
    const obj = {};
    obj.messageId = 0;
    obj.relays = {};
    obj.stats = {
        mode: 'Real',
        sent: 0,
        sendError: 0,
        received: 0,
        receivedNoRoute: 0,
        receivedBadArgs: 0
    };
    
    const tokenToNodeMap = {}; // Token --> { nid: nodeid, mid: meshid }
    
    // Initialize Firebase Admin with server key and project ID
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    
    // Setup logging
    if (parent.config.firebase && (parent.config.firebase.log === true)) {
        obj.logpath = parent.path.join(parent.datapath, 'firebase.txt');
        obj.log = function (msg) { try { parent.fs.appendFileSync(obj.logpath, new Date().toLocaleString() + ': ' + msg + '\r\n'); } catch (ex) { console.log('ERROR: Unable to write to firebase.txt.'); } }
    } else {
        obj.log = function () { }
    }
    
    // Function to send notifications
    obj.sendToDevice = function (node, payload, options, func) {
        if (typeof node === 'string') {
            parent.db.Get(node, function (err, docs) {
                if (!err && docs && docs.length === 1) {
                    obj.sendToDeviceEx(docs[0], payload, options, func);
                } else {
                    func(0, 'error');
                }
            });
        } else {
            obj.sendToDeviceEx(node, payload, options, func);
        }
    };
    
    // Send an outbound push notification
    obj.sendToDeviceEx = function (node, payload, options, func) {
        if (!node || typeof node.pmt !== 'string') {
            func(0, 'error');
            return;
        }
        
        obj.log('sendToDevice, node:' + node._id + ', payload: ' + JSON.stringify(payload) + ', options: ' + JSON.stringify(options));
        
        // Fill in our lookup table
        if (node._id) {
            tokenToNodeMap[node.pmt] = {
                nid: node._id,
                mid: node.meshid,
                did: node.domain
            };
        }
        
        const message = {
            token: node.pmt,
            notification: payload.notification,
            data: payload.data,
            android: {
                priority: options.priority || 'high',
                ttl: options.timeToLive ? options.timeToLive * 1000 : undefined
            }
        };
        
        admin.messaging().send(message).then(function (response) {
            obj.stats.sent++;
            obj.log('Success');
            func(response);
        }).catch(function (error) {
            obj.stats.sendError++;
            obj.log('Fail: ' + error);
            func(0, error);
        });
    };
    
    // Setup a two way relay
    obj.setupRelay = function (ws) {
        ws.relayId = getRandomPassword();
        while (obj.relays[ws.relayId]) { ws.relayId = getRandomPassword(); }
        obj.relays[ws.relayId] = ws;
        
        ws.on('message', function (msg) {
            parent.debug('email', 'FBWS-Data(' + this.relayId + '): ' + msg);
            if (typeof msg === 'string') {
                obj.log('Relay: ' + msg);
                
                let data;
                try { data = JSON.parse(msg); } catch (ex) { return; }
                if (typeof data !== 'object') return;
                if (!parent.common.validateObjectForMongo(data, 4096)) return;
                if (typeof data.pmt !== 'string' || typeof data.payload !== 'object') return;
                
                data.payload.data = data.payload.data || {};
                data.payload.data.r = ws.relayId;
                
                obj.sendToDevice({ pmt: data.pmt }, data.payload, data.options, function (id, err) {
                    if (!err) {
                        try { ws.send(JSON.stringify({ sent: true })); } catch (ex) { }
                    } else {
                        try { ws.send(JSON.stringify({ sent: false })); } catch (ex) { }
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
    };
    
    function getRandomPassword() {
        return Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').replace(/\//g, '@');
    }
    
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