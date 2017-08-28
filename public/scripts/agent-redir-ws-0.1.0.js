/** 
* @description Mesh Agent Transport Module - using websocket relay
* @author Ylian Saint-Hilaire
* @version v0.0.1f
*/

// Construct a MeshServer agent direction object
var CreateAgentRedirect = function (meshserver, module, serverPublicNamePort) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.meshserver = meshserver;
    obj.nodeid = null;
    obj.State = 0;
    obj.socket = null;
    obj.connectstate = -1;
    obj.tunnelid = Math.random().toString(36).substring(2); // Generate a random client tunnel id
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER, 4 = Files, 5 = FileTransfer

    obj.onStateChanged = null;

    // Private method
    //obj.debug = function (msg) { console.log(msg); }

    obj.Start = function (nodeid) {
        var url2, url = window.location.protocol.replace("http", "ws") + "//" + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + "/meshrelay.ashx?id=" + obj.tunnelid;
        if (serverPublicNamePort) { url2 = window.location.protocol.replace("http", "ws") + "//" + serverPublicNamePort + "/meshrelay.ashx?id=" + obj.tunnelid; } else { url2 = url; }
        obj.nodeid = nodeid;
        obj.connectstate = 0;
        obj.socket = new WebSocket(url);
        obj.socket.onopen = obj.xxOnSocketConnected;
        obj.socket.onmessage = obj.xxOnMessage;
        obj.socket.onclose = obj.xxOnSocketClosed;
        obj.xxStateChange(1);
        obj.meshserver.Send({ action: 'msg', type: 'tunnel', nodeid: obj.nodeid, value: url2 });
        //obj.debug("Agent Redir Start: " + url);
    }

    obj.xxOnSocketConnected = function () {
        //obj.debug("Agent Redir Socket Connected");
        obj.xxStateChange(2);
    }

    obj.xxOnMessage = function (e) {
        if (obj.State < 3) { if (e.data == 'c') { obj.socket.send(obj.protocol); obj.xxStateChange(3); return; } }
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
            //obj.debug("Agent Redir Relay - OnData - " + typeof e.data + " - " + e.data.length);
            obj.xxOnSocketData(e.data);
        }
    };
   
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

        return obj.m.ProcessData(data);
    }
    
    obj.Send = function (x) {
        //obj.debug("Agent Redir Send(" + x.length + "): " + rstr2hex(x));
        if (obj.socket != null && obj.socket.readyState == WebSocket.OPEN) {
            if (typeof x == 'string') {
                var b = new Uint8Array(x.length);
                for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); }
                obj.socket.send(b.buffer);
            } else {
                obj.socket.send(x);
            }
        }
    }

    obj.xxOnSocketClosed = function () {
        //obj.debug("Agent Redir Socket Closed");
        obj.Stop();
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    obj.Stop = function () {
        //obj.debug("Agent Redir Socket Stopped");
        obj.xxStateChange(0);
        obj.connectstate = -1;
        if (obj.socket != null) { obj.socket.close(); obj.socket = null; }
    }

    return obj;
}
