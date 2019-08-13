/** 
* @description Mesh Agent Transport Module - using websocket relay
* @author Ylian Saint-Hilaire
* @version v0.0.1f
*/

// Construct a MeshServer agent direction object
var CreateAgentRedirect = function (meshserver, module, serverPublicNamePort, authCookie, domainUrl) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.meshserver = meshserver;
    obj.authCookie = authCookie;
    obj.State = 0;
    obj.nodeid = null;
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
    if (domainUrl == null) { domainUrl = '/'; }

    // Console Message
    obj.consoleMessage = null;
    obj.onConsoleMessageChange = null;

    // Private method
    //obj.debug = function (msg) { console.log(msg); }

    obj.Start = function (nodeid) {
        var url2, url = window.location.protocol.replace("http", "ws") + "//" + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + "/meshrelay.ashx?browser=1&p=" + obj.protocol + "&nodeid=" + nodeid + "&id=" + obj.tunnelid;
        //if (serverPublicNamePort) { url2 = window.location.protocol.replace("http", "ws") + "//" + serverPublicNamePort + "/meshrelay.ashx?id=" + obj.tunnelid; } else { url2 = url; }
        if ((authCookie != null) && (authCookie != '')) { url += '&auth=' + authCookie; }
        obj.nodeid = nodeid;
        obj.connectstate = 0;
        obj.socket = new WebSocket(url);
        obj.socket.onopen = obj.xxOnSocketConnected;
        obj.socket.onmessage = obj.xxOnMessage;
        //obj.socket.onmessage = function (e) { console.log('Websocket data', e.data); obj.xxOnMessage(e); }
        obj.socket.onerror = function (e) { /* console.error(e); */ }
        obj.socket.onclose = obj.xxOnSocketClosed;
        obj.xxStateChange(1);
        //obj.meshserver.send({ action: 'msg', type: 'tunnel', nodeid: obj.nodeid, value: url2 });
        obj.meshserver.send({ action: 'msg', type: 'tunnel', nodeid: obj.nodeid, value: "*" + domainUrl + "meshrelay.ashx?p=" + obj.protocol + "&nodeid=" + nodeid + "&id=" + obj.tunnelid, usage: obj.protocol });
        //obj.debug("Agent Redir Start: " + url);
    }

    obj.xxOnSocketConnected = function () {
        if (obj.debugmode == 1) { console.log('onSocketConnected'); }
        //obj.debug("Agent Redir Socket Connected");
        obj.xxStateChange(2);
    }

    // Called to pass websocket control messages
    obj.xxOnControlCommand = function (msg) {
        var controlMsg;
        try { controlMsg = JSON.parse(msg); } catch (e) { return; }
        if (controlMsg.ctrlChannel != '102938') { obj.xxOnSocketData(msg); return; }
        //console.log(controlMsg);
        if (controlMsg.type == 'console') {
            obj.consoleMessage = controlMsg.msg;
            if (obj.onConsoleMessageChange) { obj.onConsoleMessageChange(obj, obj.consoleMessage); }
        } else if (obj.webrtc != null) {
            if (controlMsg.type == 'answer') {
                obj.webrtc.setRemoteDescription(new RTCSessionDescription(controlMsg), function () { /*console.log('WebRTC remote ok');*/ }, obj.xxCloseWebRTC);
            } else if (controlMsg.type == 'webrtc0') {
                obj.webSwitchOk = true; // Other side is ready for switch over
                performWebRtcSwitch();
            } else if (controlMsg.type == 'webrtc1') {
                obj.sendCtrlMsg("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc2\"}"); // Confirm we got end of data marker, indicates data will no longer be received on websocket.
            } else if (controlMsg.type == 'webrtc2') {
                // TODO: Resume/Start sending data over WebRTC
            }
        }
    }

    obj.sendCtrlMsg = function (x) { if (obj.ctrlMsgAllowed == true) { if ((typeof args != 'undefined') && args.redirtrace) { console.log('RedirSend', typeof x, x); } try { obj.socket.send(x); } catch (ex) { } } }

    function performWebRtcSwitch() {
        if ((obj.webSwitchOk == true) && (obj.webRtcActive == true)) {
            obj.sendCtrlMsg("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc0\"}"); // Indicate to the meshagent that it can start traffic switchover
            obj.sendCtrlMsg("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc1\"}"); // Indicate to the meshagent that data traffic will no longer be sent over websocket.
            // TODO: Hold/Stop sending data over websocket
            if (obj.onStateChanged != null) { obj.onStateChanged(obj, obj.State); }
        }
    }

    obj.xxOnMessage = function (e) {
        //console.log('Recv', e.data, e.data.byteLength, obj.State);
        if (obj.State < 3) {
            if ((e.data == 'c') || (e.data == 'cr')) {
                if (e.data == 'cr') { obj.serverIsRecording = true; }
                try { obj.socket.send(obj.protocol); } catch (ex) { }
                obj.xxStateChange(3);

                if (obj.attemptWebRTC == true) {
                    // Try to get WebRTC setup
                    var configuration = null; //{ "iceServers": [ { 'urls': 'stun:stun.services.mozilla.com' }, { 'urls': 'stun:stun.l.google.com:19302' } ] };
                    if (typeof RTCPeerConnection !== 'undefined') { obj.webrtc = new RTCPeerConnection(configuration); }
                    else if (typeof webkitRTCPeerConnection !== 'undefined') { obj.webrtc = new webkitRTCPeerConnection(configuration); }
                    if (obj.webrtc != null) {
                        obj.webchannel = obj.webrtc.createDataChannel("DataChannel", {}); // { ordered: false, maxRetransmits: 2 }
                        obj.webchannel.onmessage = obj.xxOnMessage;
                        //obj.webchannel.onmessage = function (e) { console.log('WebRTC data', e.data); obj.xxOnMessage(e); }
                        obj.webchannel.onopen = function () { obj.webRtcActive = true; performWebRtcSwitch(); };
                        obj.webchannel.onclose = function (event) { if (obj.webRtcActive) { obj.Stop(); } }
                        obj.webrtc.onicecandidate = function (e) {
                            if (e.candidate == null) {
                                try { obj.socket.send(JSON.stringify(obj.webrtcoffer)); } catch (ex) { } // End of candidates, send the offer
                            } else {
                                obj.webrtcoffer.sdp += ("a=" + e.candidate.candidate + "\r\n"); // New candidate, add it to the SDP
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

        if (typeof e.data == 'string') {
            // Control messages, most likely WebRTC setup 
            obj.xxOnControlCommand(e.data);
            return;
        }

        /*
        if (typeof e.data == 'object') {
            var f = new FileReader();
            if (f.readAsBinaryString) {
                // Chrome & Firefox (Draft)
                f.onload = function (e) { obj.xxOnSocketData(e.target.result); }
                f.readAsBinaryString(new Blob([e.data]));
            } else if (f.readAsArrayBuffer) {
                // Chrome & Firefox (Spec)
                f.onloadend = function (e) { obj.xxOnSocketData(e.target.result); }
                f.readAsArrayBuffer(e.data);
            } else {
                // IE10, readAsBinaryString does not exist, use an alternative.
                var binary = "";
                var bytes = new Uint8Array(e.data);
                var length = bytes.byteLength;
                for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
                obj.xxOnSocketData(binary);
            }
        } else {
            // If we get a string object, it maybe the WebRTC confirm. Ignore it.
            obj.xxOnSocketData(e.data);
        }
        */

        if (typeof e.data == 'object') {
            if (fileReaderInuse == true) { fileReaderAcc.push(e.data); return; }
            if (fileReader.readAsBinaryString) {
                // Chrome & Firefox (Draft)
                fileReaderInuse = true;
                fileReader.readAsBinaryString(new Blob([e.data]));
            } else if (fileReader.readAsArrayBuffer) {
                // Chrome & Firefox (Spec)
                fileReaderInuse = true;
                fileReader.readAsArrayBuffer(e.data);
            } else {
                // IE10, readAsBinaryString does not exist, use an alternative.
                var binary = "", bytes = new Uint8Array(e.data), length = bytes.byteLength;
                for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
                obj.xxOnSocketData(binary);
            }
        } else {
            // If we get a string object, it maybe the WebRTC confirm. Ignore it.
            obj.xxOnSocketData(e.data);
        }
    };

    // Setup the file reader
    var fileReader = new FileReader();
    var fileReaderInuse = false, fileReaderAcc = [];
    if (fileReader.readAsBinaryString) {
        // Chrome & Firefox (Draft)
        fileReader.onload = function (e) { obj.xxOnSocketData(e.target.result); if (fileReaderAcc.length == 0) { fileReaderInuse = false; } else { fileReader.readAsBinaryString(new Blob([fileReaderAcc.shift()])); } }
    } else if (fileReader.readAsArrayBuffer) {
        // Chrome & Firefox (Spec)
        fileReader.onloadend = function (e) { obj.xxOnSocketData(e.target.result); if (fileReaderAcc.length == 0) { fileReaderInuse = false; } else { fileReader.readAsArrayBuffer(fileReaderAcc.shift()); } }
    }

    obj.xxOnSocketData = function (data) {
        if (!data || obj.connectstate == -1) return;
        if (typeof data === 'object') {
            // This is an ArrayBuffer, convert it to a string array (used in IE)
            var binary = "", bytes = new Uint8Array(data), length = bytes.byteLength;
            for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
            data = binary;
        }
        else if (typeof data !== 'string') return;
        //console.log("xxOnSocketData", rstr2hex(data));
        if ((typeof args != 'undefined') && args.redirtrace) { console.log("RedirRecv", typeof data, data.length, data); }
        return obj.m.ProcessData(data);
    }

    obj.sendText = function (x) {
        if (typeof x != 'string') { x = JSON.stringify(x); } // Turn into a string if needed
        obj.send(encode_utf8(x)); // Encode UTF8 correctly
    }

    obj.send = function (x) {
        //obj.debug("Agent Redir Send(" + obj.webRtcActive + ", " + x.length + "): " + rstr2hex(x));
        //console.log("Agent Redir Send(" + obj.webRtcActive + ", " + x.length + "): " + ((typeof x == 'string')?x:rstr2hex(x)));
        if ((typeof args != 'undefined') && args.redirtrace) { console.log('RedirSend', typeof x, x.length, x); }
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
        //obj.debug("Agent Redir Socket Closed");
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

        //obj.debug("Agent Redir Socket Stopped");
        obj.connectstate = -1;
        if (obj.socket != null) {
            try { if (obj.socket.readyState == 1) { obj.sendCtrlMsg("{\"ctrlChannel\":\"102938\",\"type\":\"close\"}"); obj.socket.close(); } } catch (e) { }
            obj.socket = null;
        }
        obj.xxStateChange(0);
    }

    return obj;
}
