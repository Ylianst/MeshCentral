/** 
* @description Mesh Agent Transport Module - using websocket relay
* @author Ylian Saint-Hilaire
* @version v0.0.1f
*/

// Construct a MeshServer agent direction object
var CreateAgentRedirect = function (meshserver, module, serverPublicNamePort, authCookie, rauthCookie, domainUrl) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.meshserver = meshserver;
    obj.authCookie = authCookie;
    obj.rauthCookie = rauthCookie;
    obj.State = 0; // 0 = Disconnected, 1 = Connected, 2 = Connected to server, 3 = End-to-end connection.
    obj.nodeid = null;
    obj.options = null;
    obj.socket = null;
    obj.connectstate = -1;
    obj.tunnelid = Math.random().toString(36).substring(2); // Generate a random client tunnel id
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER, 4 = Files, 5 = FileTransfer
    obj.onStateChanged = null;
    obj.ctrlMsgAllowed = true;
    obj.attemptWebRTC = false;
    obj.webRtcActive = false;
    obj.webSwitchOk = false;
    obj.webchannel = null;
    obj.webrtc = null;
    obj.debugmode = 0;
    obj.serverIsRecording = false;
    obj.urlname = 'meshrelay.ashx';
    obj.latency = { lastSend: null, current: -1, callback: null };
    if (domainUrl == null) { domainUrl = '/'; }

    // Console Message
    obj.consoleMessage = null;
    obj.onConsoleMessageChange = null;

    // Session Metadata
    obj.metadata = null;
    obj.onMetadataChange = null;

    // Private method
    //obj.debug = function (msg) { console.log(msg); }

    // Display websocket or webrtc data to the console
    function logData(e, name) {
        if (typeof e.data == 'object') {
            var view = new Uint8Array(e.data), cmd = (view[0] << 8) + view[1], cmdsize = (view[2] << 8) + view[3];
            console.log(name + ' binary data', cmd, cmdsize, e.data.byteLength, buf2hex(e.data).substring(0, 24));
        } else if (typeof e.data == 'string') {
            console.log(name + ' string data', e.data.length, e.data);
        } else {
            console.log(name + ' unknown data', e.data);
        }
    }

    obj.Start = function (nodeid) {
        var url2, url = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/' + obj.urlname + '?browser=1&p=' + obj.protocol + (nodeid?('&nodeid=' + nodeid):'') + '&id=' + obj.tunnelid;
        //if (serverPublicNamePort) { url2 = window.location.protocol.replace('http', 'ws') + '//' + serverPublicNamePort + '/meshrelay.ashx?id=' + obj.tunnelid; } else { url2 = url; }
        if ((authCookie != null) && (authCookie != '')) { url += '&auth=' + authCookie; }
        if ((urlargs != null) && (urlargs.slowrelay != null)) { url += '&slowrelay=' + urlargs.slowrelay; }
        obj.nodeid = nodeid;
        obj.connectstate = 0;
        obj.socket = new WebSocket(url);
        obj.socket.binaryType = 'arraybuffer';
        obj.socket.onopen = obj.xxOnSocketConnected;
        obj.socket.onmessage = obj.xxOnMessage;
        //obj.socket.onmessage = function (e) { logData(e, 'WebSocket'); obj.xxOnMessage(e); }
        obj.socket.onerror = function (e) { /* console.error(e); */ }
        obj.socket.onclose = obj.xxOnSocketClosed;
        obj.xxStateChange(1);
        if (obj.meshserver != null) {
            var rurl = '*' + domainUrl + 'meshrelay.ashx?p=' + obj.protocol + '&nodeid=' + nodeid + '&id=' + obj.tunnelid;
            if ((rauthCookie != null) && (rauthCookie != '')) { rurl += ('&rauth=' + rauthCookie); }
            obj.meshserver.send({ action: 'msg', type: 'tunnel', nodeid: obj.nodeid, value: rurl, usage: obj.protocol });
            //obj.debug('Agent Redir Start: ' + url);
        }
    }

    obj.xxOnSocketConnected = function () {
        if (obj.debugmode == 1) { console.log('onSocketConnected'); }
        //obj.debug('Agent Redir Socket Connected');
        obj.xxStateChange(2);
    }

    // Called to pass websocket control messages
    obj.xxOnControlCommand = function (msg) {
        var controlMsg;
        try { controlMsg = JSON.parse(msg); } catch (e) { return; }
        if (controlMsg.ctrlChannel != '102938') { if (obj.m.ProcessData) { obj.m.ProcessData(msg); } else { console.log(msg); } return; }
        if ((typeof args != 'undefined') && args.redirtrace) { console.log('RedirRecv', controlMsg); }
        if (controlMsg.type == 'console') {
            obj.setConsoleMessage(controlMsg.msg, controlMsg.msgid, controlMsg.msgargs, controlMsg.timeout);
        } else if (controlMsg.type == 'metadata') {
            obj.metadata = controlMsg;
            if (obj.onMetadataChange) obj.onMetadataChange(obj.metadata);
        } else if ((controlMsg.type == 'rtt') && (typeof controlMsg.time == 'number')) {
            obj.latency.current = (new Date().getTime()) - controlMsg.time;
            if (obj.latency.callbacks != null) { obj.latency.callback(obj.latency.current); }
        } else if (obj.webrtc != null) {
            if (controlMsg.type == 'answer') {
                obj.webrtc.setRemoteDescription(new RTCSessionDescription(controlMsg), function () { /*console.log('WebRTC remote ok');*/ }, obj.xxCloseWebRTC);
            } else if (controlMsg.type == 'webrtc0') {
                obj.webSwitchOk = true; // Other side is ready for switch over
                performWebRtcSwitch();
            } else if (controlMsg.type == 'webrtc1') {
                obj.sendCtrlMsg('{"ctrlChannel":"102938","type":"webrtc2"}'); // Confirm we got end of data marker, indicates data will no longer be received on websocket.
            } else if (controlMsg.type == 'webrtc2') {
                // TODO: Resume/Start sending data over WebRTC
            }
        } else if (controlMsg.type == 'ping') { // if we get a ping, respond with a pong.
            obj.sendCtrlMsg('{"ctrlChannel":"102938","type":"pong"}');
        }
    }

    // Set the console message
    obj.setConsoleMessage = function (str, id, args, timeout) {
        if (obj.consoleMessage == str) return;
        obj.consoleMessage = str;
        obj.consoleMessageId = id;
        obj.consoleMessageArgs = args;
        obj.consoleMessageTimeout = timeout;
        if (obj.onConsoleMessageChange) { obj.onConsoleMessageChange(obj, obj.consoleMessage, obj.consoleMessageId); }
    }

    obj.sendCtrlMsg = function (x) { if (obj.ctrlMsgAllowed == true) { if ((typeof args != 'undefined') && args.redirtrace) { console.log('RedirSend', typeof x, x); } try { obj.socket.send(x); } catch (ex) { } } }

    function performWebRtcSwitch() {
        if ((obj.webSwitchOk == true) && (obj.webRtcActive == true)) {
            obj.latency.current = -1; // RTT will no longer be calculated when WebRTC is enabled
            obj.sendCtrlMsg('{"ctrlChannel":"102938","type":"webrtc0"}'); // Indicate to the meshagent that it can start traffic switchover
            obj.sendCtrlMsg('{"ctrlChannel":"102938","type":"webrtc1"}'); // Indicate to the meshagent that data traffic will no longer be sent over websocket.
            // TODO: Hold/Stop sending data over websocket
            if (obj.onStateChanged != null) { obj.onStateChanged(obj, obj.State); }
        }
    }
        
    obj.xxOnMessage = function (e) {
        //console.log('Recv', e.data, e.data.byteLength, obj.State);
        if (obj.State < 3) {
            if ((e.data == 'c') || (e.data == 'cr')) {
                if (e.data == 'cr') { obj.serverIsRecording = true; }
                if (obj.options != null) { delete obj.options.action; obj.options.type = 'options'; try { obj.sendCtrlMsg(JSON.stringify(obj.options)); } catch (ex) { } }
                try { obj.socket.send(obj.protocol); } catch (ex) { }
                obj.xxStateChange(3);

                if (obj.attemptWebRTC == true) {
                    // Try to get WebRTC setup
                    var configuration = null; //{ "iceServers": [ { 'urls': 'stun:stun.services.mozilla.com' }, { 'urls': 'stun:stun.l.google.com:19302' } ] };
                    if (typeof RTCPeerConnection !== 'undefined') { obj.webrtc = new RTCPeerConnection(configuration); }
                    else if (typeof webkitRTCPeerConnection !== 'undefined') { obj.webrtc = new webkitRTCPeerConnection(configuration); }
                    if ((obj.webrtc != null) && (obj.webrtc.createDataChannel)) {
                        obj.webchannel = obj.webrtc.createDataChannel('DataChannel', {}); // { ordered: false, maxRetransmits: 2 }
                        obj.webchannel.binaryType = 'arraybuffer';
                        obj.webchannel.onmessage = obj.xxOnMessage;
                        //obj.webchannel.onmessage = function (e) { logData(e, 'WebRTC'); obj.xxOnMessage(e); }
                        obj.webchannel.onopen = function () { obj.webRtcActive = true; performWebRtcSwitch(); };
                        obj.webchannel.onclose = function (event) { if (obj.webRtcActive) { obj.Stop(); } }
                        obj.webrtc.onicecandidate = function (e) {
                            if (e.candidate == null) {
                                try { obj.sendCtrlMsg(JSON.stringify(obj.webrtcoffer)); } catch (ex) { } // End of candidates, send the offer
                            } else {
                                obj.webrtcoffer.sdp += ('a=' + e.candidate.candidate + '\r\n'); // New candidate, add it to the SDP
                            }
                        }
                        obj.webrtc.oniceconnectionstatechange = function () {
                            if (obj.webrtc != null) {
                                if (obj.webrtc.iceConnectionState == 'disconnected') { if (obj.webRtcActive == true) { obj.Stop(); } else { obj.xxCloseWebRTC(); } }
                                else if (obj.webrtc.iceConnectionState == 'failed') { obj.xxCloseWebRTC(); }
                            }
                        }
                        obj.webrtc.createOffer(function (offer) {
                            // Got the offer
                            obj.webrtcoffer = offer;
                            obj.webrtc.setLocalDescription(offer, function () { /*console.log('WebRTC local ok');*/ }, obj.xxCloseWebRTC);
                        }, obj.xxCloseWebRTC, { mandatory: { OfferToReceiveAudio: false, OfferToReceiveVideo: false } });
                    }
                }

                return;
            }
        }

        // Control messages, most likely WebRTC setup 
        //console.log('New data', e.data.byteLength);
        if (typeof e.data == 'string') {
            if (e.data[0] == '~') { obj.m.ProcessData(e.data); } else { obj.xxOnControlCommand(e.data); }
        } else {
            // Send the data to the module
            if (obj.m.ProcessBinaryCommand) {
                // If only 1 byte
                if ((cmdAccLen == 0) && (e.data.byteLength < 4)) return; // Ignore any commands less than 4 bytes.

                // Send as Binary Command
                if (cmdAccLen != 0) {
                    // Accumulator is active
                    var view = new Uint8Array(e.data);
                    cmdAcc.push(view);
                    cmdAccLen += view.byteLength;
                    //console.log('Accumulating', cmdAccLen);
                    if (cmdAccCmdSize <= cmdAccLen) {
                        var tmp = new Uint8Array(cmdAccLen), tmpPtr = 0;
                        for (var i in cmdAcc) { tmp.set(cmdAcc[i], tmpPtr); tmpPtr += cmdAcc[i].byteLength; }
                        //console.log('AccumulatorCompleted');
                        obj.m.ProcessBinaryCommand(cmdAccCmd, cmdAccCmdSize, tmp);
                        cmdAccCmd = 0, cmdAccCmdSize = 0, cmdAccLen = 0, cmdAcc = [];
                    }
                } else {
                    // Accumulator is not active
                    var view = new Uint8Array(e.data), cmd = (view[0] << 8) + view[1], cmdsize = (view[2] << 8) + view[3];
                    if ((cmd == 27) && (cmdsize == 8)) { cmd = (view[8] << 8) + view[9]; cmdsize = (view[5] << 16) + (view[6] << 8) + view[7]; view = view.slice(8); }
                    //console.log(cmdsize, view.byteLength);
                    if (cmdsize != view.byteLength) {
                        //console.log('AccumulatorRequired', cmd, cmdsize, view.byteLength);
                        cmdAccCmd = cmd; cmdAccCmdSize = cmdsize; cmdAccLen = view.byteLength, cmdAcc = [view];
                    } else {
                        obj.m.ProcessBinaryCommand(cmd, cmdsize, view);
                    }
                }
            } else if (obj.m.ProcessBinaryData) {
                // Send as Binary
                obj.m.ProcessBinaryData(new Uint8Array(e.data));
            } else {
                // Send as Text
                if (e.data.byteLength < 16000) { // Process small data block
                    obj.m.ProcessData(String.fromCharCode.apply(null, new Uint8Array(e.data))); // This will stack overflow on Chrome with 100k+ blocks.
                } else { // Process large data block
                    var bb = new Blob([new Uint8Array(e.data)]), f = new FileReader();
                    f.onload = function (e) { obj.m.ProcessData(e.target.result); };
                    f.readAsBinaryString(bb);
                }
            }
        }
    };

    // Command accumulator, this is used for WebRTC fragmentation
    var cmdAccCmd = 0, cmdAccCmdSize = 0, cmdAccLen = 0, cmdAcc = [];

    obj.sendText = function (x) {
        if (typeof x != 'string') { x = JSON.stringify(x); } // Turn into a string if needed
        obj.send(encode_utf8(x)); // Encode UTF8 correctly
    }

    obj.send = function (x) {
        //obj.debug('Agent Redir Send(' + obj.webRtcActive + ', ' + x.length + '): ' + rstr2hex(x));
        //console.log('Agent Redir Send(' + obj.webRtcActive + ', ' + x.length + '): ' + ((typeof x == 'string')?x:rstr2hex(x)));
        if ((typeof args != 'undefined') && args.redirtrace) { console.log('RedirSend', typeof x, x.length, (x[0] == '{') ? x : rstr2hex(x).substring(0, 64)); }
        try {
            if (obj.socket != null && obj.socket.readyState == WebSocket.OPEN) {
                if (typeof x == 'string') {
                    if (obj.debugmode == 1) {
                        var b = new Uint8Array(x.length), c = [];
                        for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); c.push(x.charCodeAt(i)); }
                        if (obj.webRtcActive == true) { obj.webchannel.send(b.buffer); } else { obj.socket.send(b.buffer); }
                        //console.log('Send', c);
                    } else {
                        var b = new Uint8Array(x.length);
                        for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); }
                        if (obj.webRtcActive == true) { obj.webchannel.send(b.buffer); } else { obj.socket.send(b.buffer); }
                    }
                } else {
                    //if (obj.debugmode == 1) { console.log('Send', x); }
                    if (obj.webRtcActive == true) { obj.webchannel.send(x); } else { obj.socket.send(x); }
                }
            }
        } catch (ex) { }
    }

    obj.xxOnSocketClosed = function () {
        //obj.debug('Agent Redir Socket Closed');
        //if (obj.debugmode == 1) { console.log('onSocketClosed'); }
        obj.Stop(1);
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    // Close the WebRTC connection, should be called if a problem occurs during WebRTC setup.
    obj.xxCloseWebRTC = function () {
        if (obj.webchannel != null) { try { obj.webchannel.close(); } catch (e) { } obj.webchannel = null; }
        if (obj.webrtc != null) { try { obj.webrtc.close(); } catch (e) { } obj.webrtc = null; }
        obj.webRtcActive = false;
    }

    obj.Stop = function (x) {
        if (obj.debugmode == 1) { console.log('stop', x); }

        // Clean up WebRTC
        obj.xxCloseWebRTC();

        //obj.debug('Agent Redir Socket Stopped');
        obj.connectstate = -1;
        if (obj.socket != null) {
            try { if (obj.socket.readyState == 1) { obj.sendCtrlMsg('{"ctrlChannel":"102938","type":"close"}'); } } catch (ex) { } // If connected, send the close command
            try { if (obj.socket.readyState <= 1) { obj.socket.close(); } } catch (ex) { } // If connecting or connected, close the websocket
            obj.socket = null;
        }
        obj.xxStateChange(0);
    }

    // Buffer is an ArrayBuffer
    function buf2hex(buffer) { return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join(''); }

    return obj;
}
