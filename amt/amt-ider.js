/**
* @description MeshCentral Server IDER handler
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a MeshAgent object, called upon connection
module.exports.CreateAmtIderSession = function (parent, db, ws, req, args, domain, user) {
    const path = require('path');
    const common = parent.common;
    const amtMeshRedirModule = require('./amt-redir-mesh.js');
    const amtMeshIderModule = require('./amt-ider-module.js');

    //console.log('New Server IDER session from ' + user.name);

    var obj = {};
    obj.user = user;
    obj.domain = domain;
    obj.ider = null;

    // Disconnect this user
    obj.close = function (arg) {
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug(1, 'Soft disconnect'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug(1, 'Hard disconnect'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
    };

    try {

        // Check if the user is logged in
        if (user == null) { try { ws.close(); } catch (e) { } return; }

        // When data is received from the web socket
        ws.on('message', processWebSocketData);

        // If error, do nothing
        ws.on('error', function (err) { console.log(err); obj.close(0); });

        // If the web socket is closed
        ws.on('close', function (req) {
            // Close the IDER session
            obj.ider.Stop();
            delete obj.ider;
        });

        // We are all set, start receiving data
        ws._socket.resume();

    } catch (e) { console.log(e); }

    // Process incoming web socket data from the browser
    function processWebSocketData(msg) {
        var command, i = 0, mesh = null, meshid = null, nodeid = null, meshlinks = null, change = 0;
        try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
        if (common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

        switch (command.action) {
            case 'ping': { try { ws.send(JSON.stringify({ action: 'pong' })); } catch (ex) { } break; }
            case 'selector': {
                var r = { action: 'selector', args: { html: 'Click ok to start IDER session.' }, buttons: 3 };
                // TODO: Return a list of disk images for the user to select.
                try { ws.send(JSON.stringify(r)); } catch (ex) { }
                break;
            }
            case 'selectorResponse': {
                //console.log('selectorResponse', command.args, req.query);
                // Start IDER Session

                command.args = {
                    floppyPath: 'C:\\Users\\Default.DESKTOP-M9I88C9\\Desktop\\AmtWebApp\\meshcentral-files\\domain\\user-admin\\msdos.img',
                    cdromPath: 'C:\\Users\\Default.DESKTOP-M9I88C9\\Desktop\\AmtWebApp\\meshcentral-files\\domain\\user-admin\\recovery.iso',
                    iderStart: 1,
                    tlsv1only: true
                };

                // Setup the IDER session
                obj.ider = amtMeshRedirModule.CreateAmtRedirect(amtMeshIderModule.CreateAmtRemoteIder(parent, parent.parent), domain, user, parent, parent.parent);
                obj.ider.onStateChanged = onIderStateChange;
                obj.ider.m.iderStart = command.args.iderStart;
                obj.ider.m.sectorStats = iderSectorStats;
                obj.ider.tlsv1only = req.query.tlsv1only;

                // Setup disk images
                if (obj.ider.m.diskSetup(command.args.floppyPath, command.args.cdromPath) != 0) {
                    // Error with the disk images, unable to start IDER
                    obj.ider.onStateChanged = null;
                    obj.ider.m.sectorStats = null;
                    delete obj.ider;
                    obj.close();
                    break;
                }

                // Start the IDER session
                obj.ider.Start(req.query.host, req.query.port, req.query.tls);

                break;
            }
            default: {
                // Unknown user action
                console.log('Unknown IDER action from user ' + user.name + ': ' + command.action + '.');
                break;
            }
        }
    }

    function onIderStateChange(sender, state) {
        try { ws.send(JSON.stringify({ action: 'state', state: state })); } catch (ex) { }
        switch (state) {
            case 0:
                // Close the websocket connection and clean up.
                obj.ider.onStateChanged = null;
                obj.ider.m.sectorStats = null;
                obj.ider = null;
                obj.close();
                break;
        }
    }

    function iderSectorStats(mode, dev, total, start, len) {
        try { ws.send(JSON.stringify({ action: 'stats', mode: mode, dev: dev, total: total, start: start, len: len, toAmt: obj.ider.m.bytesToAmt, fromAmt: obj.ider.m.bytesFromAmt })); } catch (ex) { }
    }

    return obj;
};