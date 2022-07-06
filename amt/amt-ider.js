/*
Copyright 2020-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

@description MeshCentral Server IDER handler
@author Ylian Saint-Hilaire
@version v0.3.0
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a MeshAgent object, called upon connection
module.exports.CreateAmtIderSession = function (parent, db, ws, req, args, domain, user) {
    const fs = require('fs');
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
            if (obj.ider) { obj.ider.Stop(); delete obj.ider; }
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
            case 'start': {
                // Get the list of disk images
                var domainx = 'domain' + ((domain.id == '') ? '' : ('-' + domain.id));
                var useridx = user._id.split('/')[2];
                var userPath = parent.parent.path.join(parent.parent.filespath, domainx, 'user-' + useridx);

                // Look for a list of disk images for the user to select.
                if (fs.existsSync(userPath)) {
                    // Do something
                    readFsRec(userPath, function (err, results) {
                        var floppyImages = [], cdromImages = [];
                        for (var i in results) {
                            if (results[i].toLowerCase().endsWith('.img')) { floppyImages.push(results[i].substring(userPath.length + 1)); }
                            else if (results[i].toLowerCase().endsWith('.iso')) { cdromImages.push(results[i].substring(userPath.length + 1)); }
                        }
                        var xx, sel = true, html = "<div style='margin:10px 5px 10px 5px'>Select disk images & start type.</div>";

                        // Floppy image selection
                        xx = "<select style=width:240px id=xxFloppyImagesSelect><option value=''>None</option>";
                        for (var i in floppyImages) { xx += "<option value='" + encodeURIComponent(floppyImages[i]) + "'" + (sel?" selected":"") + ">" + floppyImages[i] + "</option>"; sel = false; }
                        xx += "</select>";
                        html += "<div style=margin:5px>" + addHtmlValue("Floppy Image", xx) + "</div>";

                        // CDROM image selection
                        sel = true;
                        xx = "<select style=width:240px id=xxCdromImagesSelect><option value=''>None</option>";
                        for (var i in cdromImages) { xx += "<option value='" + encodeURIComponent(cdromImages[i]) + "'" + (sel ? " selected" : "") + ">" + cdromImages[i] + "</option>"; sel = false; }
                        xx += "</select>";
                        html += "<div style=margin:5px>" + addHtmlValue("CDROM Image", xx) + "</div>";

                        // Start type
                        xx = "<select style=width:240px id=xxIderStartType><option value=0>On next boot<option value=1>Graceful<option value=2>Immediate</select>";
                        html += "<div style=margin:5px>" + addHtmlValue("Session Start", xx) + "</div>";

                        var js = "function iderServerCall() { return { ider: 1, floppyPath: Q('xxFloppyImagesSelect').value, cdromPath: Q('xxCdromImagesSelect').value, iderStart: Q('xxIderStartType').value }; }";

                        try { ws.send(JSON.stringify({ action: 'dialog', args: { html: html, js: js }, buttons: 3 })); } catch (ex) { }
                    });
                } else {
                    // No user folder
                    try { ws.send(JSON.stringify({ action: 'dialog', args: { html: 'No disk images found on remote server. Upload .img and .iso files to server "My Files" folder to enable this feature.' }, buttons: 2 })); } catch (ex) { }
                }

                break;
            }
            case 'dialogResponse': {
                if (command.args.ider == 1) { // Start IDER Session
                    // Decode and validate file paths
                    if ((command.args.floppyPath != null) && (typeof command.args.floppyPath != 'string')) { command.args.floppyPath = null; } else { command.args.floppyPath = decodeURIComponent(command.args.floppyPath); }
                    if ((command.args.cdromPath != null) && (typeof command.args.cdromPath != 'string')) { command.args.cdromPath = null; } else { command.args.cdromPath = decodeURIComponent(command.args.cdromPath); }
                    // TODO: Double check that "." or ".." are not used.
                    if ((command.args.floppyPath != null) && (command.args.floppyPath.indexOf('..') >= 0)) { delete command.args.floppyPath; }
                    if ((command.args.cdromPath != null) && (command.args.cdromPath.indexOf('..') >= 0)) { delete command.args.cdromPath; }

                    // Get the disk image paths
                    var domainx = 'domain' + ((domain.id == '') ? '' : ('-' + domain.id));
                    var useridx = user._id.split('/')[2];
                    var floppyPath = null, cdromPath = null;
                    if (command.args.floppyPath) { floppyPath = parent.parent.path.join(parent.parent.filespath, domainx, 'user-' + useridx, command.args.floppyPath); }
                    if (command.args.cdromPath) { cdromPath = parent.parent.path.join(parent.parent.filespath, domainx, 'user-' + useridx, command.args.cdromPath); }

                    // Setup the IDER session
                    obj.ider = amtMeshRedirModule.CreateAmtRedirect(amtMeshIderModule.CreateAmtRemoteIder(parent, parent.parent), domain, user, parent, parent.parent);
                    obj.ider.onStateChanged = onIderStateChange;
                    obj.ider.m.iderStart = command.args.iderStart;
                    obj.ider.m.sectorStats = iderSectorStats;
                    obj.ider.tlsv1only = req.query.tlsv1only;

                    // Setup disk images
                    var iderError = obj.ider.m.diskSetup(floppyPath, cdromPath);

                    // Error with the disk images, unable to start IDER
                    if (iderError != 0) { try { ws.send(JSON.stringify({ action: 'error', code: iderError })); } catch (ex) { } break; }

                    // Start the IDER session
                    obj.ider.Start(req.query.host, req.query.port, req.query.tls);
                }

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

    // Recursivly read all of the files in a fonder
    function readFsRec(dir, func) {
        var results = [];
        fs.readdir(dir, function (err, list) {
            if (err) return func(err);
            var pending = list.length;
            if (!pending) return func(null, results);
            list.forEach(function (file) {
                file = path.resolve(dir, file);
                fs.stat(file, function (err, stat) {
                    if (stat && stat.isDirectory()) {
                        readFsRec(file, function (err, res) { results = results.concat(res); if (!--pending) func(null, results); });
                    } else {
                        results.push(file); if (!--pending) func(null, results);
                    }
                });
            });
        });
    };

    function addHtmlValue(t, v) { return '<div style=height:20px><div style=float:right;width:240px;overflow:hidden><b title="' + v + '">' + v + '</b></div><div>' + t + '</div></div>'; }

    return obj;
};