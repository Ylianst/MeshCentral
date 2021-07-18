/**
* @description MeshCentral remote desktop multiplexor
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";


/*
--- KVM Commands ---
MNG_KVM_NOP = 0,
MNG_KVM_KEY = 1,
MNG_KVM_MOUSE = 2,
MNG_KVM_MOUSE_CURSOR = 88,
MNG_KVM_MOUSE_MOVE = 89,
MNG_KVM_PICTURE = 3,
MNG_KVM_COPY = 4,
MNG_KVM_COMPRESSION = 5,
MNG_KVM_REFRESH = 6,
MNG_KVM_SCREEN = 7,
MNG_KVM_PAUSE = 8,
MNG_TERMTEXT = 9,
MNG_CTRLALTDEL = 10,
MNG_KVM_GET_DISPLAYS = 11,
MNG_KVM_SET_DISPLAY = 12,
MNG_KVM_FRAME_RATE_TIMER = 13,
MNG_KVM_INIT_TOUCH = 14,
MNG_KVM_TOUCH = 15,
MNG_KVM_CONNECTCOUNT = 16,
MNG_KVM_MESSAGE = 17,
MNG_ECHO = 21,
MNG_JUMBO = 27,
MNG_GETDIR = 50,
MNG_FILEMOVE = 51,
MNG_FILEDELETE = 52,
MNG_FILECOPY = 53,
MNG_FILECREATEDIR = 54,
MNG_FILETRANSFER = 55,
MNG_FILEUPLOAD = 56,
MNG_FILESEARCH = 57,
MNG_FILETRANSFER2 = 58,
MNG_KVM_DISCONNECT = 59,
MNG_GETDIR2 = 60,						// Same as MNG_GETDIR but with date/time.
MNG_FILEUPLOAD2 = 61,					// Used for slot based fast upload.
MNG_FILEDELETEREC = 62,					// Same as MNG_FILEDELETE but recursive
MNG_USERCONSENT = 63,					// Used to notify management console of user consent state
MNG_DEBUG = 64,							// Debug/Logging Message for ILibRemoteLogging
MNG_ERROR = 65,
MNG_ENCAPSULATE_AGENT_COMMAND = 70,
MNG_KVM_DISPLAY_INFO = 82
*/

function CreateDesktopMultiplexor(parent, domain, nodeid, func) {
    var obj = {};
    obj.nodeid = nodeid;
    obj.parent = parent;
    obj.agent = null;                   // Reference to the connection object that is the agent.
    obj.viewers = [];                   // Array of references to all viewers.
    obj.viewersOverflowCount = 0;       // Number of viewers currently in overflow state.
    obj.width = 0;                      // Current width of the display in pixels.
    obj.height = 0;                     // Current height of the display in pixels.
    obj.swidth = 0;                     // Current width of the display in tiles.
    obj.sheight = 0;                    // Current height of the display in tiles.
    obj.screen = null;                  // The main screen, (x * y) --> tile index. Indicates this image is covering each tile on the screen.
    obj.counter = 1;                    // The main counter, used as index for the obj.images table when now images come in.
    obj.imagesCount = 0;                // Total number of images in the obj.images table.
    obj.imagesCounters = {};            // Main table of indexes --> tile count, the number of tiles still using this image.
    obj.images = {};                    // Main table of indexes --> image data object.
    obj.lastScreenSizeCmd = null;       // Pointer to the last screen size command from the agent.
    obj.lastScreenSizeCounter = 0;      // Index into the image table of the screen size command, this is generally also the first command.
    obj.lastConsoleMessage = null;      // Last agent console message.
    obj.firstData = null;               // Index in the image table of the first image in the table, generally this points to the display resolution command.
    obj.lastData = null;                // Index in the images table of the last image in the table.
    obj.lastDisplayInfoData = null;     // Pointer to the last display information command from the agent (Number of displays).
    obj.lastDisplayLocationData = null; // Pointer to the last display location and size command from the agent.
    obj.desktopPaused = true;           // Current desktop pause state, it's true if all viewers are paused.
    obj.imageCompression = 50;          // Current image compression, this is the highest value of all viewers.
    obj.imageScaling = 1024;            // Current image scaling, this is the highest value of all viewers.
    obj.imageFrameRate = 50;            // Current framerate setting, this is the lowest values of all viewers.
    obj.protocolOptions = null;         // Set to the protocol options of the first viewer that connected.
    obj.viewerConnected = false;        // Set to true if one viewer attempted to connect to the agent.
    obj.recordingFile = null;           // Present if we are recording to file.
    obj.recordingFileSize = 0;          // Current size of the recording file.
    obj.recordingFileWriting = false;   // Set to true is we are in the process if writing to the recording file.
    obj.startTime = null;               // Starting time of the multiplex session.
    obj.userIds = [];                   // List of userid's that have intertracted with this session.

    // Accounting
    parent.trafficStats.desktopMultiplex.sessions++;

    // Add an agent or viewer
    obj.addPeer = function (peer) {
        if (obj.viewers == null) { parent.parent.debug('relay', 'DesktopRelay: Error, addingPeer on disposed session'); return; }
        if (peer.req == null) return; // This peer is already disposed, don't add it.
        if (peer.req.query.browser) {
            //console.log('addPeer-viewer', obj.nodeid);
                        
            // Setup the viewer
            if (obj.viewers.indexOf(peer) >= 0) return true;
            obj.viewers.push(peer);
            peer.desktopPaused = true;
            peer.imageCompression = 30;
            peer.imageScaling = 1024;
            peer.imageFrameRate = 100;
            peer.lastImageNumberSent = null;
            peer.dataPtr = obj.firstData;
            peer.sending = false;
            peer.overflow = false;
            peer.sendQueue = [];
            peer.paused = false;

            // Add the user to the userids list if needed
            if ((peer.user != null) && (obj.userIds.indexOf(peer.user._id) == -1)) { obj.userIds.push(peer.user._id); }

            // Setup slow relay is requested. This will show down sending any data to this viewer.
            if ((peer.req.query.slowrelay != null)) {
                var sr = null;
                try { sr = parseInt(peer.req.query.slowrelay); } catch (ex) { }
                if ((typeof sr == 'number') && (sr > 0) && (sr < 1000)) { peer.slowRelay = sr; }
            }

            // Indicated we are connected
            obj.sendToViewer(peer, obj.recordingFile ? 'cr' : 'c');

            // If the agent sent display information or console message, send it to the viewer
            if (obj.lastDisplayInfoData != null) { obj.sendToViewer(peer, obj.lastDisplayInfoData); }
            if (obj.lastDisplayLocationData != null) { obj.sendToViewer(peer, obj.lastDisplayLocationData); }
            if (obj.lastConsoleMessage != null) { obj.sendToViewer(peer, obj.lastConsoleMessage); }

            // Log joining the multiplex session
            if (obj.startTime != null) {
                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: peer.user._id, username: peer.user.name, msgid: 4, msg: "Joined desktop multiplex session", protocol: 2 };
                parent.parent.DispatchEvent(['*', obj.nodeid, peer.user._id, obj.meshid], obj, event);
            }

            // Send an updated list of all peers to all viewers
            obj.sendSessionMetadata();
        } else {
            //console.log('addPeer-agent', obj.nodeid);
            if (obj.agent != null) { parent.parent.debug('relay', 'DesktopRelay: Error, duplicate agent connection'); return false; }
            
            // Setup the agent
            obj.agent = peer;
            peer.sending = false;
            peer.overflow = false;
            peer.sendQueue = [];
            peer.paused = false;

            // Indicated we are connected and send connection options and protocol if needed
            obj.sendToAgent(obj.recordingFile?'cr':'c');
            if (obj.viewerConnected == true) {
                if (obj.protocolOptions != null) { obj.sendToAgent(JSON.stringify(obj.protocolOptions)); } // Send connection options
                obj.sendToAgent('2'); // Send remote desktop connect
            }
        }

        // Log multiplex session start
        if ((obj.agent != null) && (obj.viewers.length > 0) && (obj.startTime == null)) {
            var event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.viewers[0].user._id, username: obj.viewers[0].user.name, msgid: 6, msg: "Started desktop multiplex session", protocol: 2 };
            parent.parent.DispatchEvent(['*', obj.nodeid, obj.viewers[0].user._id, obj.meshid], obj, event);
            obj.startTime = Date.now();
        }
        return true;
    }

    // Remove an agent or viewer
    // Return true if this multiplexor is no longer needed.
    obj.removePeer = function (peer) {
        if (obj.viewers == null) return;
        if (peer == obj.agent) {
            //console.log('removePeer-agent', obj.nodeid);
            // Clean up the agent
            obj.agent = null;

            // Agent has disconnected, disconnect everyone.
            if (obj.viewers != null) { for (var i in obj.viewers) { obj.viewers[i].close(); } }
            dispose();
            return true;
        } else {
            //console.log('removePeer-viewer', obj.nodeid);
            // Remove a viewer
            if (obj.viewers != null) {
                var i = obj.viewers.indexOf(peer);
                if (i == -1) return false;
                obj.viewers.splice(i, 1);
            }

            // Resume flow control if this was the peer that was limiting traffic (because it was the fastest one).
            if (peer.overflow == true) {
                obj.viewersOverflowCount--;
                peer.overflow = false;
                if ((obj.viewersOverflowCount < obj.viewers.length) && (obj.recordingFileWriting == false) && obj.agent && (obj.agent.paused == true)) { obj.agent.paused = false; obj.agent.ws._socket.resume(); }
            }

            // Aggressive clean up of the viewer
            delete peer.desktopPaused;
            delete peer.imageCompression;
            delete peer.imageScaling;
            delete peer.imageFrameRate;
            delete peer.lastImageNumberSent;
            delete peer.dataPtr;
            delete peer.sending;
            delete peer.overflow;
            delete peer.sendQueue;

            // Log leaving the multiplex session
            if (obj.startTime != null) {
                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: peer.user._id, username: peer.user.name, msgid: 5, msg: "Left the desktop multiplex session", protocol: 2 };
                parent.parent.DispatchEvent(['*', obj.nodeid, peer.user._id, obj.meshid], obj, event);
            }

            // If this is the last viewer, disconnect the agent
            if ((obj.viewers != null) && (obj.viewers.length == 0) && (obj.agent != null)) { obj.agent.close(); dispose(); return true; }

            // Send an updated list of all peers to all viewers
            obj.sendSessionMetadata();
        }
        return false;
    }

    // Clean up ourselves
    function dispose() {
        if (obj.viewers == null) return;
        //console.log('dispose', obj.nodeid);
        delete obj.viewers;
        delete obj.imagesCounters;
        delete obj.images;

        // Close the recording file if needed
        if (obj.recordingFile != null) {
            // Compute session length
            if (obj.startTime != null) { obj.sessionStart = obj.startTime; obj.sessionLength = Math.round((Date.now() - obj.startTime) / 1000); }

            // Write the last record of the recording file
            var rf = obj.recordingFile;
            delete obj.recordingFile;
            recordingEntry(rf.fd, 3, 0, 'MeshCentralMCREC', function (fd, filename) {
                parent.parent.fs.close(fd);

                // Now that the recording file is closed, check if we need to index this file.
                if (domain.sessionrecording.index !== false) { parent.parent.certificateOperations.acceleratorPerformOperation('indexMcRec', filename); }

                // Add a event entry about this recording
                var basefile = parent.parent.path.basename(filename);
                var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: obj.nodeid, msgid: 7, mshArgs: [obj.sessionLength], msg: "Finished recording session" + (obj.sessionLength ? (', ' + obj.sessionLength + ' second(s)') : ''), filename: basefile, size: obj.recordingFileSize, protocol: 2, icon: obj.icon, name: obj.name, meshid: obj.meshid, userids: obj.userIds, multiplex: true };
                var mesh = parent.meshes[obj.meshid];
                if (mesh != null) { event.meshname = mesh.name; }
                if (obj.sessionStart) { event.startTime = obj.sessionStart; event.lengthTime = obj.sessionLength; }
                parent.parent.DispatchEvent(['*', 'recording', obj.nodeid, obj.meshid], obj, event);

                cleanUpRecordings();
            }, rf.filename);
        }

        // Log end of multiplex session
        if (obj.startTime != null) {
            var event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, msgid: 8, msgArgs: [Math.floor((Date.now() - obj.startTime) / 1000)], msg: "Closed desktop multiplex session" + ', ' + Math.floor((Date.now() - obj.startTime) / 1000) + ' second(s)', protocol: 2 };
            parent.parent.DispatchEvent(['*', obj.nodeid, obj.meshid], obj, event);
            obj.startTime = null;
        }

        // Send an updated list of all peers to all viewers
        obj.sendSessionMetadata();

        parent.parent.debug('relay', 'DesktopRelay: Disposing desktop multiplexor');
    }

    // Send data to the agent or queue it up for sending
    obj.sendToAgent = function (data) {
        if ((obj.viewers == null) || (obj.agent == null)) return;
        //console.log('SendToAgent', data.length);
        if (obj.agent.sending) {
            obj.agent.sendQueue.push(data);

            // Flow control, pause all viewers is the queue is backing up
            if (obj.agent.sendQueue > 10) {
                obj.agent.overflow = true;
                for (var i in obj.viewers) {
                    var v = obj.viewers[i];
                    if (v.paused == false) { v.paused = true; v.ws._socket.pause(); }
                }
            }
        } else {
            obj.agent.ws.send(data, sendAgentNext);
        }
    }

    // Send more data to the agent
    function sendAgentNext() {
        if ((obj.viewers == null) || (obj.agent == null)) return;
        if (obj.agent.sendQueue.length > 0) {
            // Send from the pending send queue
            obj.agent.ws.send(obj.agent.sendQueue.shift(), sendAgentNext);
        } else {
            // Nothing to send
            obj.agent.sending = false;

            // Flow control, resume all viewers
            if (obj.agent.overflow == true) {
                obj.agent.overflow = false;
                for (var i in obj.viewers) {
                    var v = obj.viewers[i];
                    if (v.paused == true) { v.paused = false; v.ws._socket.resume(); }
                }
            }
        }
    }

    // Send the list of all users currently vieweing this session to all viewers and servers
    obj.sendSessionMetadata = function () {
        var allUsers = {};
        if (obj.viewers != null) {
            for (var i in obj.viewers) {
                var v = obj.viewers[i];
                if ((v.user != null) && (v.user._id != null)) {
                    var id = v.user._id;
                    if (v.guestName) { id += '/guest:' + Buffer.from(v.guestName).toString('base64'); } // If this is a guest connect, add the Base64 guest name.
                    if (allUsers[id] == null) { allUsers[id] = 1; } else { allUsers[id]++; }
                }
            }
            obj.sendToAllViewers(JSON.stringify({ type: 'metadata', 'ctrlChannel': '102938', users: allUsers, startTime: obj.startTime }));
        }

        // Update the sessions attached the to agent
        if (obj.nodeid != null) {
            const xagent = parent.wsagents[obj.nodeid];
            if (xagent != null) {
                if (xagent.sessions == null) { xagent.sessions = {}; }
                xagent.sessions.multidesk = allUsers;
                xagent.updateSessions();
            }
        }
    }

    // Send this command to all viewers
    obj.sendToAllViewers = function (data) {
        if (obj.viewers == null) return;
        for (var i in obj.viewers) { obj.sendToViewer(obj.viewers[i], data); }
    }

    // Send this command to all viewers
    obj.sendToAllInputViewers = function (data) {
        if (obj.viewers == null) return;
        for (var i in obj.viewers) { if (obj.viewers[i].viewOnly != true) { obj.sendToViewer(obj.viewers[i], data); } }
    }

    // Send data to the viewer or queue it up for sending
    obj.sendToViewer = function (viewer, data) {
        if ((viewer == null) || (obj.viewers == null)) return;
        //console.log('SendToViewer', data.length);
        if (viewer.sending) {
            viewer.sendQueue.push(data);
        } else {
            viewer.sending = true;
            if (viewer.slowRelay) {
                setTimeout(function () { try { viewer.ws.send(data, function () { sendViewerNext(viewer); }); } catch (ex) { } }, viewer.slowRelay);
            } else {
                try { viewer.ws.send(data, function () { sendViewerNext(viewer); }); } catch (ex) { }
            }

            // Flow control, pause the agent if needed
            checkViewerOverflow(viewer);
        }
    }

    // Check if a viewer is in overflow situation
    function checkViewerOverflow(viewer) {
        if ((viewer.overflow == true) || (obj.viewers == null)) return;
        if ((viewer.sendQueue.length > 5) || ((viewer.dataPtr != null) && (viewer.dataPtr != obj.lastData))) {
            viewer.overflow = true;
            obj.viewersOverflowCount++;
            if ((obj.viewersOverflowCount >= obj.viewers.length) && obj.agent && (obj.agent.paused == false)) { obj.agent.paused = true; obj.agent.ws._socket.pause(); }
        }
    }

    // Check if a viewer is in underflow situation
    function checkViewerUnderflow(viewer) {
        if ((viewer.overflow == false) || (obj.viewers == null)) return;
        if ((viewer.sendQueue.length <= 5) && ((viewer.dataPtr == null) || (viewer.dataPtr == obj.lastData))) {
            viewer.overflow = false;
            obj.viewersOverflowCount--;
            if ((obj.viewersOverflowCount < obj.viewers.length) && (obj.recordingFileWriting == false) && obj.agent && (obj.agent.paused == true)) { obj.agent.paused = false; obj.agent.ws._socket.resume(); }
        }
    }

    // Send more data to the viewer
    function sendViewerNext(viewer) {
        if ((viewer.sendQueue == null) || (obj.viewers == null)) return;
        if (viewer.sendQueue.length > 0) {
            // Send from the pending send queue
            if (viewer.sending == false) { viewer.sending = true; }
            if (viewer.slowRelay) {
                setTimeout(function () { try { viewer.ws.send(viewer.sendQueue.shift(), function () { sendViewerNext(viewer); }); } catch (ex) { } }, viewer.slowRelay);
            } else {
                try { viewer.ws.send(viewer.sendQueue.shift(), function () { sendViewerNext(viewer); }); } catch (ex) { }
            }
            checkViewerOverflow(viewer);
        } else {
            if (viewer.dataPtr != null) {
                // Send the next image
                //if ((viewer.lastImageNumberSent != null) && ((viewer.lastImageNumberSent + 1) != (viewer.dataPtr))) { console.log('SVIEW-S1', viewer.lastImageNumberSent, viewer.dataPtr); } // DEBUG
                var image = obj.images[viewer.dataPtr];
                viewer.lastImageNumberSent = viewer.dataPtr;
                //if ((image.next != null) && ((viewer.dataPtr + 1) != image.next)) { console.log('SVIEW-S2', viewer.dataPtr, image.next); } // DEBUG
                viewer.dataPtr = image.next;
                if (viewer.slowRelay) {
                    setTimeout(function () { try { viewer.ws.send(image.data, function () { sendViewerNext(viewer); }); } catch (ex) { } }, viewer.slowRelay);
                } else {
                    try { viewer.ws.send(image.data, function () { sendViewerNext(viewer); }); } catch (ex) { }
                }

                // Flow control, pause the agent if needed
                if (viewer.sending == false) { viewer.sending = true; }
                checkViewerOverflow(viewer);
            } else {
                // Nothing to send
                viewer.sending = false;

                // Flow control, resume agent if needed
                checkViewerUnderflow(viewer);
            }
        }
    }

    // Process data coming from the agent or any viewers
    obj.processData = function (peer, data) {
        if (obj.viewers == null) return;
        if (peer == obj.agent) {
            obj.recordingFileWriting = true;
            recordData(true, data, function () {
                if (obj.viewers == null) return;
                obj.recordingFileWriting = false;
                if ((obj.viewersOverflowCount < obj.viewers.length) && obj.agent && (obj.agent.paused == true)) { obj.agent.paused = false; obj.agent.ws._socket.resume(); }
                obj.processAgentData(data);
            });
        } else {
            obj.processViewerData(peer, data);
        }
    }

    // Process incoming viewer data
    obj.processViewerData = function (viewer, data) {
        if (typeof data == 'string') {
            if (data == '2') {
                if (obj.viewerConnected == false) {
                    if (obj.agent != null) {
                        if (obj.protocolOptions != null) { obj.sendToAgent(JSON.stringify(obj.protocolOptions)); } // Send connection options
                        obj.sendToAgent('2'); // Send remote desktop connect
                    }
                    obj.viewerConnected = true;
                }
                return;
            }
            var json = null;
            try { json = JSON.parse(data); } catch (ex) { }
            if (json == null) return;
            if ((json.type == 'options') && (obj.protocolOptions == null)) { obj.protocolOptions = json; }
            if ((json.ctrlChannel == '102938') && (json.type == 'lock') && (viewer.viewOnly == false)) { obj.sendToAgent('{"ctrlChannel":"102938","type":"lock"}'); } // Account lock support
            return;
        }

        //console.log('ViewerData', data.length, typeof data, data);
        if ((typeof data != 'object') || (data.length < 4)) return; // Ignore all control traffic for now (WebRTC)
        var command = data.readUInt16BE(0);
        var cmdsize = data.readUInt16BE(2);
        //console.log('ViewerData', data.length, command, cmdsize);
        switch (command) {
            case 1: // Key Events, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            case 2: // Mouse events, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            case 5: // Compression
                if (data.length < 10) return;
                //viewer.imageType = data[4]; // Always 1=JPEG
                viewer.imageCompression = data[5];
                viewer.imageScaling = data.readUInt16BE(6);
                viewer.imageFrameRate = data.readUInt16BE(8);
                //console.log('Viewer-Compression', viewer.imageCompression, viewer.imageScaling, viewer.imageFrameRate);
                
                // See if this changes anything
                var viewersimageCompression = null;
                var viewersimageScaling = null;
                var viewersimageFrameRate = null;
                for (var i in obj.viewers) {
                    if ((viewersimageCompression == null) || (obj.viewers[i].imageCompression > viewersimageCompression)) { viewersimageCompression = obj.viewers[i].imageCompression; };
                    if ((viewersimageScaling == null) || (obj.viewers[i].imageScaling > viewersimageScaling)) { viewersimageScaling = obj.viewers[i].imageScaling; };
                    if ((viewersimageFrameRate == null) || (obj.viewers[i].imageFrameRate < viewersimageFrameRate)) { viewersimageFrameRate = obj.viewers[i].imageFrameRate; };
                }
                if ((obj.imageCompression != viewersimageCompression) || (obj.imageScaling != viewersimageScaling) || (obj.imageFrameRate != viewersimageFrameRate)) {
                    // Update and send to agent new compression settings
                    obj.imageCompression = viewersimageCompression;
                    obj.imageScaling = viewersimageScaling;
                    obj.imageFrameRate = viewersimageFrameRate
                    //console.log('Send-Agent-Compression', obj.imageCompression, obj.imageScaling, obj.imageFrameRate);
                    var cmd = Buffer.alloc(10);
                    cmd.writeUInt16BE(5, 0); // Command 5, compression
                    cmd.writeUInt16BE(10, 2); // Command size, 10 bytes long
                    cmd[4] = 1; // Image type, 1 = JPEG
                    cmd[5] = obj.imageCompression; // Image compression level
                    cmd.writeUInt16BE(obj.imageScaling, 6); // Scaling level
                    cmd.writeUInt16BE(obj.imageFrameRate, 8); // Frame rate timer
                    obj.sendToAgent(cmd);
                }
                break;
            case 6: // Refresh, handle this on the server
                //console.log('Viewer-Refresh');
                viewer.dataPtr = obj.firstData; // Start over
                if (viewer.sending == false) { sendViewerNext(viewer); }
                break;
            case 8: // Pause and unpause
                if (data.length != 5) break;
                var pause = data[4]; // 0 = Unpause, 1 = Pause
                if (viewer.desktopPaused == (pause == 1)) break;
                viewer.desktopPaused = (pause == 1);
                //console.log('Viewer-' + ((pause == 1)?'Pause':'UnPause'));
                var viewersPaused = true;
                for (var i in obj.viewers) { if (obj.viewers[i].desktopPaused == false) { viewersPaused = false; }; }
                if (viewersPaused != obj.desktopPaused) {
                    obj.desktopPaused = viewersPaused;
                    //console.log('Send-Agent-' + ((viewersPaused == true) ? 'Pause' : 'UnPause'));
                    data[4] = (viewersPaused == true) ? 1 : 0;
                    obj.sendToAgent(data);
                }
                break;
            case 10: // CTRL-ALT-DEL, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            case 12: // SET DISPLAY, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            case 14: // Touch setup
                break;
            case 82: // Request display information
                if (obj.lastDisplayLocationData != null) { obj.sendToAgent(obj.lastDisplayLocationData); }
                break;
            case 85: // Unicode Key Events, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            case 87: // Remote input lock, forward to agent
                if (viewer.viewOnly == false) { obj.sendToAgent(data); }
                break;
            default:
                console.log('Un-handled viewer command: ' + command);
                break;
        }
    }

    // Process incoming agent data
    obj.processAgentData = function (data) {
        if ((typeof data != 'object') || (data.length < 4)) {
            if (typeof data == 'string') {
                var json = null;
                try { json = JSON.parse(data); } catch (ex) { }
                if (json == null) return;
                if (json.type == 'console') {
                    // This is a console message, store it and forward this to all viewers
                    if (json.msg != null) { obj.lastConsoleMessage = data; } else { obj.lastConsoleMessage = null; }
                    obj.sendToAllViewers(data);
                }
                // All other control messages (notably WebRTC), are ignored for now.
            }
            return; // Ignore all other traffic
        }
        const jumboData = data;
        var command = data.readUInt16BE(0);
        var cmdsize = data.readUInt16BE(2);
        //console.log('AgentData', data.length, command, cmdsize);
        if ((command == 27) && (cmdsize == 8)) {
            // Jumbo packet
            if (data.length >= 12) {
                command = data.readUInt16BE(8);
                cmdsize = data.readUInt32BE(4);
                if (data.length == (cmdsize + 8)) {
                    data = data.slice(8, data.length);
                } else {
                    console.log('TODO-PARTIAL-JUMBO', command, cmdsize, data.length);
                    return; // TODO
                }
            }
        }
            
        switch (command) {
            case 3: // Tile, check dimentions and store
                if ((data.length < 10) || (obj.lastData == null)) break;
                var x = data.readUInt16BE(4), y = data.readUInt16BE(6);
                var dimensions = require('image-size')(data.slice(8));
                var sx = (x / 16), sy = (y / 16), sw = (dimensions.width / 16), sh = (dimensions.height / 16);
                obj.counter++;
                
                // Keep a reference to this image & how many tiles it covers
                obj.images[obj.counter] = { next: null, prev: obj.lastData, data: jumboData };
                obj.images[obj.lastData].next = obj.counter;
                obj.lastData = obj.counter;
                obj.imagesCounters[obj.counter] = (sw * sh);
                obj.imagesCount++;
                if (obj.imagesCount == 2000000000) { obj.imagesCount = 1; } // Loop the counter if needed

                //console.log('Adding Image ' + obj.counter, x, y, dimensions.width, dimensions.height);

                // Update the screen with the correct pointers.
                for (var i = 0; i < sw; i++) {
                    for (var j = 0; j < sh; j++) {
                        var k = ((obj.swidth * (j + sy)) + (i + sx));
                        const oi = obj.screen[k];
                        obj.screen[k] = obj.counter;
                        if ((oi != null) && (--obj.imagesCounters[oi] == 0)) {
                            // Remove data from the link list
                            obj.imagesCount--;
                            var d = obj.images[oi];
                            //console.log('Removing Image', oi, obj.images[oi].prev, obj.images[oi].next);
                            obj.images[d.prev].next = d.next;
                            obj.images[d.next].prev = d.prev;
                            delete obj.images[oi];
                            delete obj.imagesCounters[oi];

                            // If any viewers are currently on image "oi" must be moved to "d.next"
                            for (var l in obj.viewers) { const v = obj.viewers[l]; if (v.dataPtr == oi) { v.dataPtr = d.next; } }
                        }
                    }
                }

                // Any viewer on dataPtr null, change to this image
                for (var i in obj.viewers) {
                    const v = obj.viewers[i];
                    if (v.dataPtr == null) { v.dataPtr = obj.counter; if (v.sending == false) { sendViewerNext(v); } }
                }

                // Debug, display the link list
                //var xx = '', xptr = obj.firstData;
                //while (xptr != null) { xx += '>' + xptr; xptr = obj.images[xptr].next; }
                //console.log('list', xx);
                //console.log('images', obj.imagesCount);
                
                break;
            case 4: // Tile Copy, do nothing.
                break;
            case 7: // Screen Size, clear the screen state and compute the tile count
                if (data.length < 8) break;
                if ((obj.width === data.readUInt16BE(4)) && (obj.height === data.readUInt16BE(6))) break; // Same screen size as before, skip this.
                obj.counter++;
                obj.lastScreenSizeCmd = data;
                obj.lastScreenSizeCounter = obj.counter;
                obj.width = data.readUInt16BE(4);
                obj.height = data.readUInt16BE(6);
                obj.swidth = obj.width / 16;
                obj.sheight = obj.height / 16;
                if (Math.floor(obj.swidth) != obj.swidth) { obj.swidth = Math.floor(obj.swidth) + 1; }
                if (Math.floor(obj.sheight) != obj.sheight) { obj.sheight = Math.floor(obj.sheight) + 1; }
                
                // Reset the display
                obj.screen = new Array(obj.swidth * obj.sheight);
                obj.imagesCount = 0;
                obj.imagesCounters = {};
                obj.images = {};
                obj.images[obj.counter] = { next: null, prev: null, data: data };
                obj.firstData = obj.counter;
                obj.lastData = obj.counter;
                
                // Add viewers must be set to start at "obj.counter"
                for (var i in obj.viewers) {
                    const v = obj.viewers[i];
                    v.dataPtr = obj.counter;
                    if (v.sending == false) { sendViewerNext(v); }
                }

                //console.log("ScreenSize", obj.width, obj.height, obj.swidth, obj.sheight, obj.swidth * obj.sheight);
                break;
            case 11: // GetDisplays
                // Store and send this to all viewers right away
                obj.lastDisplayInfoData = data;
                obj.sendToAllInputViewers(data);
                break;
            case 12: // SetDisplay
                obj.sendToAllInputViewers(data);
                break;
            case 14: // KVM_INIT_TOUCH
                break;
            case 15: // KVM_TOUCH
                break;
            case 16: // MNG_KVM_CONNECTCOUNT
                break;
            case 17: // MNG_KVM_MESSAGE
                // Send this to all viewers right away
                obj.sendToAllViewers(data);
                break;
            case 65: // Alert
                // Send this to all viewers right away
                obj.sendToAllViewers(data);
                break;
            case 82:
                // Display information
                if ((data.length < 14) || (((data.length - 4) % 10) != 0)) break; // Command must be 14 bytes and have header + 10 byte for each display.
                obj.lastDisplayLocationData = data;
                obj.sendToAllInputViewers(data);
                break;
            case 87: // MNG_KVM_INPUT_LOCK
                // Send this to all viewers right away
                // This will update all views on the current state of the input lock
                obj.sendToAllInputViewers(data);
                break;
            case 88: // MNG_KVM_MOUSE_CURSOR
                // Send this to all viewers right away
                obj.sendToAllInputViewers(data);
                break;
            default:
                console.log('Un-handled agent command: ' + command);
                break;
        }
    }

    function recordingSetup(domain, func) {
        // Setup session recording
        if ((domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf(2) >= 0))))) {

            // Check again to make sure we need to start recording
            if (domain.sessionrecording.onlyselecteddevicegroups === true) {
                var mesh = parent.meshes[obj.meshid];
                if ((mesh.flags == null) || ((mesh.flags & 4) == 0)) { func(false); return; } // Do not record the session
            }

            var now = new Date(Date.now());
            var recFilename = 'desktopSession' + ((domain.id == '') ? '' : '-') + domain.id + '-' + now.getUTCFullYear() + '-' + parent.common.zeroPad(now.getUTCMonth(), 2) + '-' + parent.common.zeroPad(now.getUTCDate(), 2) + '-' + parent.common.zeroPad(now.getUTCHours(), 2) + '-' + parent.common.zeroPad(now.getUTCMinutes(), 2) + '-' + parent.common.zeroPad(now.getUTCSeconds(), 2) + '-' + obj.nodeid.split('/')[2] + '.mcrec'
            var recFullFilename = null;
            if (domain.sessionrecording.filepath) {
                try { parent.parent.fs.mkdirSync(domain.sessionrecording.filepath); } catch (e) { }
                recFullFilename = parent.parent.path.join(domain.sessionrecording.filepath, recFilename);
            } else {
                try { parent.parent.fs.mkdirSync(parent.parent.recordpath); } catch (e) { }
                recFullFilename = parent.parent.path.join(parent.parent.recordpath, recFilename);
            }
            parent.parent.fs.open(recFullFilename, 'w', function (err, fd) {
                if (err != null) {
                    parent.parent.debug('relay', 'Relay: Unable to record to file: ' + recFullFilename);
                    func(false);
                    return;
                }
                // Write the recording file header
                parent.parent.debug('relay', 'Relay: Started recoding to file: ' + recFullFilename);
                var metadata = { magic: 'MeshCentralRelaySession', ver: 1, nodeid: obj.nodeid, meshid: obj.meshid, time: new Date().toLocaleString(), protocol: 2, devicename: obj.name, devicegroup: obj.meshname };
                var firstBlock = JSON.stringify(metadata);
                recordingEntry(fd, 1, 0, firstBlock, function () {
                    obj.recordingFile = { fd: fd, filename: recFullFilename };
                    obj.recordingFileWriting = false;
                    func(true);
                });
            });
        } else {
            func(false);
        }
    }

    // Record data to the recording file
    function recordData(isAgent, data, func) {
        try {
            if (obj.recordingFile != null) {
                // Write data to recording file
                recordingEntry(obj.recordingFile.fd, 2, (isAgent ? 0 : 2), data, function () { func(data); });
            } else {
                func(data);
            }
        } catch (ex) { console.log(ex); }
    }

    // Record a new entry in a recording log
    function recordingEntry(fd, type, flags, data, func, tag) {
        try {
            if (typeof data == 'string') {
                // String write
                var blockData = Buffer.from(data), header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                header.writeInt16BE(flags, 2); // Flags (1 = Binary, 2 = User)
                header.writeInt32BE(blockData.length, 4); // Size
                header.writeIntBE(new Date(), 10, 6); // Time
                var block = Buffer.concat([header, blockData]);
                parent.parent.fs.write(fd, block, 0, block.length, function () { func(fd, tag); });
                obj.recordingFileSize += block.length;
            } else {
                // Binary write
                var header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                header.writeInt16BE(flags | 1, 2); // Flags (1 = Binary, 2 = User)
                header.writeInt32BE(data.length, 4); // Size
                header.writeIntBE(new Date(), 10, 6); // Time
                var block = Buffer.concat([header, data]);
                parent.parent.fs.write(fd, block, 0, block.length, function () { func(fd, tag); });
                obj.recordingFileSize += block.length;
            }
        } catch (ex) { console.log(ex); func(fd, tag); }
    }

    // If there is a recording quota, remove any old recordings if needed
    function cleanUpRecordings() {
        if ((parent.cleanUpRecordingsActive !== true) && domain.sessionrecording && ((typeof domain.sessionrecording.maxrecordings == 'number') || (typeof domain.sessionrecording.maxrecordingsizemegabytes == 'number'))) {
            parent.cleanUpRecordingsActive = true;
            setTimeout(function () {
                var recPath = null, fs = require('fs');
                if (domain.sessionrecording.filepath) { recPath = domain.sessionrecording.filepath; } else { recPath = parent.parent.recordpath; }
                fs.readdir(recPath, function (err, files) {
                    if ((err != null) || (files == null)) { delete parent.cleanUpRecordingsActive; return; }
                    var recfiles = [];
                    for (var i in files) {
                        if (files[i].endsWith('.mcrec')) {
                            var j = files[i].indexOf('-');
                            if (j > 0) { recfiles.push({ n: files[i], r: files[i].substring(j + 1), s: fs.statSync(parent.parent.path.join(recPath, files[i])).size }); }
                        }
                    }
                    recfiles.sort(function (a, b) { if (a.r < b.r) return 1; if (a.r > b.r) return -1; return 0; });
                    var totalFiles = 0, totalSize = 0;
                    for (var i in recfiles) {
                        var overQuota = false;
                        if ((typeof domain.sessionrecording.maxrecordings == 'number') && (totalFiles >= domain.sessionrecording.maxrecordings)) { overQuota = true; }
                        else if ((typeof domain.sessionrecording.maxrecordingsizemegabytes == 'number') && (totalSize >= (domain.sessionrecording.maxrecordingsizemegabytes * 1048576))) { overQuota = true; }
                        if (overQuota) { fs.unlinkSync(parent.parent.path.join(recPath, recfiles[i].n)); }
                        totalFiles++;
                        totalSize += recfiles[i].s;
                    }
                    delete parent.cleanUpRecordingsActive;
                });
            });
        }
    }

    // Get node information
    parent.db.Get(nodeid, function (err, nodes) {
        if ((err != null) || (nodes.length != 1)) { func(null); return; }
        obj.meshid = nodes[0].meshid;
        obj.icon = nodes[0].icon;
        obj.name = nodes[0].name;
        recordingSetup(domain, function () { func(obj); });
    });
    return obj;
}

function checkDeviceSharePublicIdentifier(parent, domain, nodeid, pid, func) {
    // Check the public id
    parent.db.GetAllTypeNodeFiltered([nodeid], domain.id, 'deviceshare', null, function (err, docs) {
        if ((err != null) || (docs.length == 0)) { func(false); return; }

        // Search for the device share public identifier
        var found = false;
        for (var i = 0; i < docs.length; i++) { if (docs[i].publicid == pid) { found = true; } }
        func(found);
    });
}

module.exports.CreateMeshRelay = function (parent, ws, req, domain, user, cookie) {
    if ((cookie != null) && (typeof cookie.nid == 'string') && (typeof cookie.pid == 'string')) {
        checkDeviceSharePublicIdentifier(parent, domain, cookie.nid, cookie.pid, function (result) {
            // If the identifier if not found, close the connection
            if (result == false) { try { ws.close(); } catch (e) { } return; }
            // Public device sharing identifier found, continue as normal.
            CreateMeshRelayEx(parent, ws, req, domain, user, cookie);
        });
    } else {
        CreateMeshRelayEx(parent, ws, req, domain, user, cookie);
    }
}

// If we are in multi-server mode, the desktop multiplexor needs to be created on the server with the agent connected to it.
// So, if the agent is connected to a different server, just relay the connection to that server
function CreateMeshRelayEx(parent, ws, req, domain, user, cookie) {
    // Do validation work
    if (cookie) {
        if ((typeof cookie.expire == 'number') && (cookie.expire <= Date.now())) { delete req.query.nodeid; }
        else if (typeof cookie.nid == 'string') { req.query.nodeid = cookie.nid; }
    }
    if ((req.query.nodeid == null) || (req.query.p != '2') || (req.query.id == null) || (domain == null)) { try { ws.close(); } catch (e) { } return; } // Not is not a valid remote desktop connection.

    // Check routing if in multi-server mode
    var nodeid = req.query.nodeid;
    if (parent.parent.multiServer != null) {
        const routing = parent.parent.GetRoutingServerIdNotSelf(nodeid, 1); // 1 = MeshAgent routing type
        if (routing == null) {
            // No need to relay the connection to a different server
            return CreateMeshRelayEx2(parent, ws, req, domain, user, cookie);
        } else {
            // We must relay the connection to a different server
            return parent.parent.multiServer.createPeerRelay(ws, req, routing.serverid, req.session.userid);
        }
    } else {
        // No need to relay the connection to a different server
        return CreateMeshRelayEx2(parent, ws, req, domain, user, cookie);
    }
}

function CreateMeshRelayEx2(parent, ws, req, domain, user, cookie) {
    const currentTime = Date.now();
    var obj = {};
    obj.ws = ws;
    obj.ws.me = obj;
    obj.id = req.query.id;
    obj.nodeid = req.query.nodeid;
    obj.user = user;
    obj.ruserid = null;
    obj.req = req; // Used in multi-server.js
    obj.viewOnly = ((cookie != null) && (cookie.vo == 1)); // set view only mode

    // If the domain has remote desktop viewonly set, force everyone to be in viewonly mode.
    if ((typeof domain.desktop == 'object') && (domain.desktop.viewonly == true)) { obj.viewOnly = true; }

    // Setup traffic accounting
    if (parent.trafficStats.desktopMultiplex == null) { parent.trafficStats.desktopMultiplex = { connections: 1, sessions: 0, in: 0, out: 0 }; } else { parent.trafficStats.desktopMultiplex.connections++; }
    ws._socket.bytesReadEx = 0;
    ws._socket.bytesWrittenEx = 0;

    // Setup subscription for desktop sharing public identifier
    // If the identifier is removed, drop the connection
    if ((cookie != null) && (typeof cookie.pid == 'string')) {
        obj.pid = cookie.pid;
        obj.guestName = cookie.gn;
        parent.parent.AddEventDispatch([obj.nodeid], obj);
        obj.HandleEvent = function (source, event, ids, id) { if ((event.action == 'removedDeviceShare') && (obj.pid == event.publicid)) { obj.close(); } }
    }

    // Check relay authentication
    if ((user == null) && (obj.req.query != null) && (obj.req.query.rauth != null)) {
        const rcookie = parent.parent.decodeCookie(obj.req.query.rauth, parent.parent.loginCookieEncryptionKey, 240); // Cookie with 4 hour timeout
        if (rcookie.ruserid != null) { obj.ruserid = rcookie.ruserid; }
        if (rcookie.nodeid != null) { obj.nodeid = rcookie.nodeid; }
    }

    // If there is no authentication, drop this connection
    if ((obj.id != null) && (obj.user == null) && (obj.ruserid == null)) { try { ws.close(); parent.parent.debug('relay', 'DesktopRelay: Connection with no authentication (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } return; }

    // Relay session count (we may remove this in the future)
    obj.relaySessionCounted = true;
    parent.relaySessionCount++;

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 1;
    const MESHRIGHT_MANAGEUSERS = 2;
    const MESHRIGHT_MANAGECOMPUTERS = 4;
    const MESHRIGHT_REMOTECONTROL = 8;
    const MESHRIGHT_AGENTCONSOLE = 16;
    const MESHRIGHT_SERVERFILES = 32;
    const MESHRIGHT_WAKEDEVICE = 64;
    const MESHRIGHT_SETNOTES = 128;
    const MESHRIGHT_REMOTEVIEW = 256;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 1;
    const SITERIGHT_MANAGEUSERS = 2;
    const SITERIGHT_SERVERRESTORE = 4;
    const SITERIGHT_FILEACCESS = 8;
    const SITERIGHT_SERVERUPDATE = 16;
    const SITERIGHT_LOCKED = 32;

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (addr.startsWith('::ffff:')) { return addr.substring(7); } else { return addr; } }

    // Disconnect this agent
    obj.close = function (arg) {
        if (obj.ws == null) return; // Already closed.

        // Close the connection
        if ((arg == 1) || (arg == null)) { try { ws.close(); parent.parent.debug('relay', 'DesktopRelay: Soft disconnect (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); parent.parent.debug('relay', 'DesktopRelay: Hard disconnect (' + obj.req.clientIp + ')'); } catch (e) { console.log(e); } } // Hard close, close the TCP socket
        if (obj.relaySessionCounted) { parent.relaySessionCount--; delete obj.relaySessionCounted; }
        if ((obj.deskMultiplexor != null) && (typeof obj.deskMultiplexor == 'object') && (obj.deskMultiplexor.removePeer(obj) == true)) { delete parent.desktoprelays[obj.nodeid]; }

        // Aggressive cleanup
        delete obj.id;
        delete obj.ws;
        delete obj.req;
        delete obj.user;
        delete obj.nodeid;
        delete obj.ruserid;
        delete obj.expireTimer;
        delete obj.deskMultiplexor;

        // Clear timers if present
        if (obj.pingtimer != null) { clearInterval(obj.pingtimer); delete obj.pingtimer; }
        if (obj.pongtimer != null) { clearInterval(obj.pongtimer); delete obj.pongtimer; }

        // Unsubscribe
        if (obj.pid != null) { parent.parent.RemoveAllEventDispatch(obj); }
    };

    obj.sendAgentMessage = function (command, userid, domainid) {
        var rights, mesh;
        if (command.nodeid == null) return false;
        var user = parent.users[userid];
        if (user == null) return false;
        var splitnodeid = command.nodeid.split('/');
        // Check that we are in the same domain and the user has rights over this node.
        if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domainid)) {
            // Get the user object
            // See if the node is connected
            var agent = parent.wsagents[command.nodeid];
            if (agent != null) {
                // Check if we have permission to send a message to that node
                rights = parent.GetNodeRights(user, agent.dbMeshKey, agent.dbNodeKey);
                mesh = parent.meshes[agent.dbMeshKey];
                if ((rights != null) && (mesh != null) || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                    if (ws.sessionId) { command.sessionid = ws.sessionId; }   // Set the session id, required for responses.
                    command.rights = rights;            // Add user rights flags to the message
                    if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                    if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                    command.username = user.name;       // Add user name
                    command.realname = user.realname;   // Add real name
                    if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                    delete command.nodeid;              // Remove the nodeid since it's implyed.
                    agent.send(JSON.stringify(command));
                    return true;
                }
            } else {
                // Check if a peer server is connected to this agent
                var routing = parent.parent.GetRoutingServerIdNotSelf(command.nodeid, 1); // 1 = MeshAgent routing type
                if (routing != null) {
                    // Check if we have permission to send a message to that node
                    rights = parent.GetNodeRights(user, routing.meshid, command.nodeid);
                    mesh = parent.meshes[routing.meshid];
                    if (rights != null || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                        if (ws.sessionId) { command.fromSessionid = ws.sessionId; }   // Set the session id, required for responses.
                        command.rights = rights;                // Add user rights flags to the message
                        if (typeof command.consent == 'number') { command.consent = command.consent | mesh.consent; } else { command.consent = mesh.consent; } // Add user consent
                        if (typeof domain.userconsentflags == 'number') { command.consent |= domain.userconsentflags; } // Add server required consent flags
                        command.username = user.name;           // Add user name
                        command.realname = user.realname;       // Add real name
                        if (typeof domain.desktopprivacybartext == 'string') { command.privacybartext = domain.desktopprivacybartext; } // Privacy bar text
                        parent.parent.multiServer.DispatchMessageSingleServer(command, routing.serverid);
                        return true;
                    }
                }
            }
        }
        return false;
    };

    // Send a PING/PONG message
    function sendPing() {
        try { obj.ws.send('{"ctrlChannel":"102938","type":"ping"}'); } catch (ex) { }
        try { if (obj.peer != null) { obj.peer.ws.send('{"ctrlChannel":"102938","type":"ping"}'); } } catch (ex) { }
    }
    function sendPong() {
        try { obj.ws.send('{"ctrlChannel":"102938","type":"pong"}'); } catch (ex) { }
        try { if (obj.peer != null) { obj.peer.ws.send('{"ctrlChannel":"102938","type":"pong"}'); } } catch (ex) { }
    }

    function performRelay(retryCount) {
        if ((obj.id == null) || (retryCount > 20)) { try { obj.close(); } catch (e) { } return null; } // Attempt to connect without id, drop this.
        if (retryCount == 0) { ws._socket.setKeepAlive(true, 240000); } // Set TCP keep alive

        /*
        // Validate that the id is valid, we only need to do this on non-authenticated sessions.
        // TODO: Figure out when this needs to be done.
        if (user == null) {
            // Check the identifier, if running without TLS, skip this.
            var ids = obj.id.split(':');
            if (ids.length != 3) { ws.close(); delete obj.id; return null; } // Invalid ID, drop this.
            if (parent.crypto.createHmac('SHA384', parent.relayRandom).update(ids[0] + ':' + ids[1]).digest('hex') != ids[2]) { ws.close(); delete obj.id; return null; } // Invalid HMAC, drop this.
            if ((Date.now() - parseInt(ids[1])) > 120000) { ws.close(); delete obj.id; return null; } // Expired time, drop this.
            obj.id = ids[0];
        }
        */

        if (retryCount == 0) {
            // Setup the agent PING/PONG timers
            if ((typeof parent.parent.args.agentping == 'number') && (obj.pingtimer == null)) { obj.pingtimer = setInterval(sendPing, parent.parent.args.agentping * 1000); }
            else if ((typeof parent.parent.args.agentpong == 'number') && (obj.pongtimer == null)) { obj.pongtimer = setInterval(sendPong, parent.parent.args.agentpong * 1000); }

            parent.parent.debug('relay', 'DesktopRelay: Connection (' + obj.req.clientIp + ')');
        }

        // Create if needed and add this peer to the desktop multiplexor
        obj.deskMultiplexor = parent.desktoprelays[obj.nodeid];
        if (obj.deskMultiplexor == null) {
            parent.desktoprelays[obj.nodeid] = 1; // Indicate that the creating of the desktop multiplexor is pending.
            parent.parent.debug('relay', 'DesktopRelay: Creating new desktop multiplexor');
            CreateDesktopMultiplexor(parent, domain, obj.nodeid, function (deskMultiplexor) {
                if (deskMultiplexor != null) {
                    // Desktop multiplexor was created, use it.
                    obj.deskMultiplexor = deskMultiplexor;
                    parent.desktoprelays[obj.nodeid] = obj.deskMultiplexor;
                    obj.deskMultiplexor.addPeer(obj);
                    ws._socket.resume(); // Release the traffic
                } else {
                    // An error has occured, close this connection
                    delete parent.desktoprelays[obj.nodeid];
                    ws.close();
                }
            });
        } else {
            if (obj.deskMultiplexor == 1) {
                // The multiplexor is being created, hold a little and try again. This is to prevent a possible race condition.
                setTimeout(function () { performRelay(++retryCount); }, 50);
            } else {
                // Hook up this peer to the multiplexor and release the traffic
                obj.deskMultiplexor.addPeer(obj);
                ws._socket.resume();
            }
        }
    }

    // When data is received from the mesh relay web socket
    ws.on('message', function (data) {
        // Data accounting
        parent.trafficStats.desktopMultiplex.in += (this._socket.bytesRead - this._socket.bytesReadEx);
        parent.trafficStats.desktopMultiplex.out += (this._socket.bytesWritten - this._socket.bytesWrittenEx);
        this._socket.bytesReadEx = this._socket.bytesRead;
        this._socket.bytesWrittenEx = this._socket.bytesWritten;

        // If this data was received by the agent, decode it.
        if (this.me.deskMultiplexor != null) { this.me.deskMultiplexor.processData(this.me, data); }
    });

    // If error, close both sides of the relay.
    ws.on('error', function (err) {
        //console.log('ws-error', err);
        parent.relaySessionErrorCount++;
        console.log('Relay error from ' + obj.req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
        obj.close();
    });

    // If the relay web socket is closed, close both sides.
    ws.on('close', function (req) {
        // Data accounting
        parent.trafficStats.desktopMultiplex.in += (this._socket.bytesRead - this._socket.bytesReadEx);
        parent.trafficStats.desktopMultiplex.out += (this._socket.bytesWritten - this._socket.bytesWrittenEx);
        this._socket.bytesReadEx = this._socket.bytesRead;
        this._socket.bytesWrittenEx = this._socket.bytesWritten;

        //console.log('ws-close', req);
        obj.close();
    });

    // If this session has a expire time, setup the expire timer now.
    setExpireTimer();

    // Mark this relay session as authenticated if this is the user end.
    obj.authenticated = (user != null);
    if (obj.authenticated) {
        // Kick off the routing, if we have agent routing instructions, process them here.
        // Routing instructions can only be given by a authenticated user
        if ((cookie != null) && (cookie.nodeid != null) && (cookie.tcpport != null) && (cookie.domainid != null)) {
            // We have routing instructions in the cookie, but first, check user access for this node.
            parent.db.Get(cookie.nodeid, function (err, docs) {
                if (obj.req == null) return; // This connection was closed.
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (1)'); try { obj.close(); } catch (e) { } return; }

                // Send connection request to agent
                const rcookie = parent.parent.encodeCookie({ ruserid: user._id, nodeid: node._id }, parent.parent.loginCookieEncryptionKey);
                if (obj.id == undefined) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                const command = { nodeid: node._id, action: 'msg', type: 'tunnel', value: '*/meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, tcpport: cookie.tcpport, tcpaddr: cookie.tcpaddr };
                parent.parent.debug('relay', 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user._id, cookie.domainid) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                performRelay(0);
            });
            return obj;
        } else if ((obj.req.query.nodeid != null) && ((obj.req.query.tcpport != null) || (obj.req.query.udpport != null))) {
            // We have routing instructions in the URL arguments, but first, check user access for this node.
            parent.db.Get(obj.req.query.nodeid, function (err, docs) {
                if (obj.req == null) return; // This connection was closed.
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Send connection request to agent
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); } // If there is no connection id, generate one.
                const rcookie = parent.parent.encodeCookie({ ruserid: user._id, nodeid: node._id }, parent.parent.loginCookieEncryptionKey);

                if (obj.req.query.tcpport != null) {
                    const command = { nodeid: node._id, action: 'msg', type: 'tunnel', value: '*/meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, tcpport: obj.req.query.tcpport, tcpaddr: ((obj.req.query.tcpaddr == null) ? '127.0.0.1' : obj.req.query.tcpaddr) };
                    parent.parent.debug('relay', 'Relay: Sending agent TCP tunnel command: ' + JSON.stringify(command));
                    if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                } else if (obj.req.query.udpport != null) {
                    const command = { nodeid: node._id, action: 'msg', type: 'tunnel', value: '*/meshrelay.ashx?id=' + obj.id + '&rauth=' + rcookie, udpport: obj.req.query.udpport, udpaddr: ((obj.req.query.udpaddr == null) ? '127.0.0.1' : obj.req.query.udpaddr) };
                    parent.parent.debug('relay', 'Relay: Sending agent UDP tunnel command: ' + JSON.stringify(command));
                    if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }
                }
                performRelay(0);
            });
            return obj;
        } else if ((cookie != null) && (cookie.nid != null) && (typeof cookie.r == 'number') && (typeof cookie.cf == 'number') && (typeof cookie.gn == 'string')) {
            // We have routing instructions in the cookie, but first, check user access for this node.
            parent.db.Get(cookie.nid, function (err, docs) {
                if (obj.req == null) return; // This connection was closed.
                if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
                const node = docs[0];

                // Check if this user has permission to manage this computer
                if ((parent.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (2)'); try { obj.close(); } catch (e) { } return; }

                // Send connection request to agent
                if (obj.id == null) { obj.id = ('' + Math.random()).substring(2); }
                const rcookie = parent.parent.encodeCookie({ ruserid: user._id, nodeid: node._id }, parent.parent.loginCookieEncryptionKey);
                const command = { nodeid: node._id, action: 'msg', type: 'tunnel', userid: user._id, value: '*/meshrelay.ashx?p=2&id=' + obj.id + '&rauth=' + rcookie + '&nodeid=' + node._id, soptions: {}, usage: 2, rights: cookie.r, guestname: cookie.gn, consent: cookie.cf, remoteaddr: cleanRemoteAddr(obj.req.clientIp) };
                if (typeof domain.consentmessages == 'object') {
                    if (typeof domain.consentmessages.title == 'string') { command.soptions.consentTitle = domain.consentmessages.title; }
                    if (typeof domain.consentmessages.desktop == 'string') { command.soptions.consentMsgDesktop = domain.consentmessages.desktop; }
                    if (typeof domain.consentmessages.terminal == 'string') { command.soptions.consentMsgTerminal = domain.consentmessages.terminal; }
                    if (typeof domain.consentmessages.files == 'string') { command.soptions.consentMsgFiles = domain.consentmessages.files; }
                }
                if (typeof domain.notificationmessages == 'object') {
                    if (typeof domain.notificationmessages.title == 'string') { command.soptions.notifyTitle = domain.notificationmessages.title; }
                    if (typeof domain.notificationmessages.desktop == 'string') { command.soptions.notifyMsgDesktop = domain.notificationmessages.desktop; }
                    if (typeof domain.notificationmessages.terminal == 'string') { command.soptions.notifyMsgTerminal = domain.notificationmessages.terminal; }
                    if (typeof domain.notificationmessages.files == 'string') { command.soptions.notifyMsgFiles = domain.notificationmessages.files; }
                }
                parent.parent.debug('relay', 'Relay: Sending agent tunnel command: ' + JSON.stringify(command));
                if (obj.sendAgentMessage(command, user._id, domain.id) == false) { delete obj.id; parent.parent.debug('relay', 'Relay: Unable to contact this agent (' + obj.req.clientIp + ')'); }

                performRelay(0);
            });
            return obj;
        }
    }

    // Set the session expire timer
    function setExpireTimer() {
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }
        if (cookie && (typeof cookie.expire == 'number')) {
            const timeToExpire = (cookie.expire - Date.now());
            if (timeToExpire < 1) {
                obj.close();
            } else if (timeToExpire >= 0x7FFFFFFF) {
                obj.expireTimer = setTimeout(setExpireTimer, 0x7FFFFFFF); // Since expire timer can't be larger than 0x7FFFFFFF, reset timer after that time.
            } else {
                obj.expireTimer = setTimeout(obj.close, timeToExpire);
            }
        }
    }


    // Check if this user has input access on the device
    if ((obj.user != null) && (obj.viewOnly == false)) {
        obj.viewOnly = true; // Set a view only for now until we figure out otherwise
        parent.db.Get(obj.nodeid, function (err, docs) {
            if (obj.req == null) return; // This connection was closed.
            if (docs.length == 0) { console.log('ERR: Node not found'); try { obj.close(); } catch (e) { } return; } // Disconnect websocket
            const node = docs[0];

            // Check if this user has permission to manage this computer
            const rights = parent.GetNodeRights(obj.user, node.meshid, node._id);
            if ((rights & 0x00000008) == 0) { try { obj.close(); } catch (e) { } return; } // Check MESHRIGHT_ADMIN or MESHRIGHT_REMOTECONTROL
            if ((rights != 0xFFFFFFFF) && ((rights & 0x00010000) != 0)) { try { obj.close(); } catch (e) { } return; } // Check MESHRIGHT_NODESKTOP
            if ((rights == 0xFFFFFFFF) || ((rights & 0x00000100) == 0)) { obj.viewOnly = false; } // Check MESHRIGHT_REMOTEVIEWONLY
            performRelay(0);
        });
    } else {
        // If this is not an authenticated session, or the session does not have routing instructions, just go ahead an connect to existing session.
        performRelay(0);
    }
    return obj;
};

/*
Relay session recording required that "SessionRecording":true be set in the domain section of the config.json.
Once done, a folder "meshcentral-recordings" will be created next to "meshcentral-data" that will contain all
of the recording files with the .mcrec extension.

The recording files are binary and contain a set of:

    <HEADER><DATABLOCK><HEADER><DATABLOCK><HEADER><DATABLOCK><HEADER><DATABLOCK>...

The header is always 16 bytes long and is encoded like this:

    TYPE   2 bytes, 1 = Header, 2 = Network Data, 3 = EndBlock
    FLAGS  2 bytes, 0x0001 = Binary, 0x0002 = User
    SIZE   4 bytes, Size of the data following this header.
    TIME   8 bytes, Time this record was written, number of milliseconds since 1 January, 1970 UTC.

All values are BigEndian encoded. The first data block is of TYPE 1 and contains a JSON string with information
about this recording. It looks something like this:

{
    magic: 'MeshCentralRelaySession',
    ver: 1,
    userid: "user\domain\userid",
    username: "username",
    sessionid: "RandomValue",
    ipaddr1: 1.2.3.4,
    ipaddr2: 1.2.3.5,
    time: new Date().toLocaleString()
}

The rest of the data blocks are all network traffic that was relayed thru the server. They are of TYPE 2 and have
a given size and timestamp. When looking at network traffic the flags are important:

- If traffic has the first (0x0001) flag set, the data is binary otherwise it's a string.
- If the traffic has the second (0x0002) flag set, traffic is coming from the user's browser, if not, it's coming from the MeshAgent.
*/