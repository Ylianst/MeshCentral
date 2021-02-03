/**
* @description MeshCentral Firebase communication module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2021
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

    // Messages received from client (excluding receipts)
    xcs.on('message', function (messageId, from, data, category) {
        //console.log('Firebase-Message', messageId, from, data, category);

        // Lookup node information from the cache
        var ninfo = tokenToNodeMap[from];
        if (ninfo == null) { obj.stats.receivedNoRoute++; return; }

        if ((data != null) && (data.con != null) && (data.s != null)) { // Console command
            obj.stats.received++;
            parent.webserver.routeAgentCommand({ action: 'msg', type: 'console', value: data.con, sessionid: data.s }, ninfo.did, ninfo.nid, ninfo.mid);
        } else {
            obj.stats.receivedBadArgs++;
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

    parent.debug('email', 'CreateFirebase-Setup');

    // EXAMPLE
    //var payload = { notification: { title: command.title, body: command.msg }, data: { url: obj.msgurl } };
    //var options = { priority: 'High', timeToLive: 5 * 60 }; // TTL: 5 minutes, priority 'Normal' or 'High'

    // Send an outbound push notification
    obj.sendToDevice = function (node, payload, options, func) {
        parent.debug('email', 'Firebase-sendToDevice');
        if ((node == null) || (typeof node.pmt != 'string')) return;

        // Fill in our lookup table
        if (node._id != null) { tokenToNodeMap[node.pmt] = { nid: node._id, mid: node.meshid, did: node.domain } }

        // Built the on-screen notification
        var notification = null;
        if (payload.notification) {
            var notification = new Notification('ic_launcher')
                .title(payload.notification.title)
                .body(payload.notification.body)
                .build();
        }

        // Build the message
        var message = new Message('msg_' + (++obj.messageId));
        if (options.priority) { message.priority(options.priority); }
        if (payload.data) { for (var i in payload.data) { message.addData(i, payload.data[i]); } }
        if (notification) { message.notification(notification) }
        message.build();

        // Send the message
        function callback(result) {
            if (result.getError() == null) { obj.stats.sent++; } else { obj.stats.sendError++; }
            callback.func(result.getMessageId(), result.getError(), result.getErrorDescription())
        }
        callback.func = func;
        parent.debug('email', 'Firebase-sending');
        xcs.sendNoRetry(message, node.pmt, callback);
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
    obj.pushOnly = true;
    const https = require('https');
    const querystring = require('querystring');
    const relayUrl = require('url').parse(url);

    parent.debug('email', 'CreateFirebaseRelay-Setup');

    // Send an outbound push notification
    obj.sendToDevice = function (node, payload, options, func) {
        parent.debug('email', 'Firebase-sendToDevice');
        if ((node == null) || (typeof node.pmt != 'string')) return;

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
            if (res.statusCode == 200) { obj.stats.sent++; } else { obj.stats.sendError++; }
            if (func != null) { func(++obj.messageId, (res.statusCode == 200) ? null : 'error'); }
        });
        parent.debug('email', 'Firebase-sending');
        req.on('error', function (error) { obj.stats.sent++; func(++obj.messageId, 'error'); });
        req.write(querydata);
        req.end();
    }

    return obj;
};