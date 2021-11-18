/** 
* @description Mesh Agent Transport Module - using websocket relay
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a MeshServer agent direction object
var CreateKvmDataChannel = function (webchannel, module, keepalive) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.webchannel = webchannel;
    obj.State = 0;
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER, 4 = Files, 5 = FileTransfer
    obj.onStateChanged = null;
    obj.onControlMsg = null;
    obj.debugmode = 0;
    obj.keepalive = keepalive;
    obj.rtcKeepAlive = null;

    // Private method
    //obj.debug = function (msg) { console.log(msg); }

    obj.Start = function () {
        if (obj.debugmode == 1) { console.log('start'); }
        obj.xxStateChange(3);
        obj.webchannel.onmessage = obj.xxOnMessage;
        obj.rtcKeepAlive = setInterval(obj.xxSendRtcKeepAlive, 30000);
    }

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

    obj.xxOnMessage = function (e) {
        //if (obj.debugmode == 1) { console.log('Recv', e.data); }
        //if (urlvars && urlvars['webrtctrace']) { console.log('WebRTC-Recv(' + obj.State + '): ', typeof e.data, e.data); }
        if (typeof e.data == 'string') { if (obj.onControlMsg != null) { obj.onControlMsg(e.data); } return; } // If this is a control message, handle it here.
        if (typeof e.data == 'object') {
            if (fileReaderInuse == true) { fileReaderAcc.push(e.data); return; }
            if (fileReader.readAsBinaryString) {
                // Chrome & Firefox (Draft)
                fileReaderInuse = true;
                fileReader.readAsBinaryString(new Blob([e.data]));
            } else if (f.readAsArrayBuffer) {
                // Chrome & Firefox (Spec)
                fileReaderInuse = true;
                fileReader.readAsArrayBuffer(e.data);
            } else {
                // IE10, readAsBinaryString does not exist, use an alternative.
                var binary = '', bytes = new Uint8Array(e.data), length = bytes.byteLength;
                for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
                obj.xxOnSocketData(binary);
            }
        } else {
            // If we get a string object, it maybe the WebRTC confirm. Ignore it.
            //obj.debug("Agent Redir Relay - OnData - " + typeof e.data + " - " + e.data.length);
            obj.xxOnSocketData(e.data);
        }
    };

    /*
    obj.xxOnMessage = function (e) {
        //if (obj.debugmode == 1) { console.log('Recv', e.data); }
        //if (urlvars && urlvars['webrtctrace']) { console.log('WebRTC-Recv(' + obj.State + '): ', typeof e.data, e.data); }
        if (typeof e.data == 'string') { if (obj.onControlMsg != null) { obj.onControlMsg(e.data); } return; } // If this is a control message, handle it here.
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
                var binary = '', bytes = new Uint8Array(e.data), length = bytes.byteLength;
                for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
                obj.xxOnSocketData(binary);
            }
        } else {
            // If we get a string object, it maybe the WebRTC confirm. Ignore it.
            //obj.debug("Agent Redir Relay - OnData - " + typeof e.data + " - " + e.data.length);
            obj.xxOnSocketData(e.data);
        }
    };
    */

    obj.xxOnSocketData = function (data) {
        if (!data) return;
        if (typeof data === 'object') {
            // This is an ArrayBuffer, convert it to a string array (used in IE)
            var binary = '', bytes = new Uint8Array(data), length = bytes.byteLength;
            for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
            data = binary;
        }
        else if (typeof data !== 'string') return;
        //console.log("xxOnSocketData", rstr2hex(data));
        return obj.m.ProcessData(data);
    }

    // Send a control message over the WebRTC data channel
    obj.sendCtrlMsg = function (x) {
        if (typeof x == 'string') {
            obj.webchannel.send(x);
            //if (urlvars && urlvars['webrtctrace']) { console.log('WebRTC-Send(' + obj.State + '): ', typeof x, x); }
            if (obj.keepalive != null) obj.keepalive.sendKeepAlive();
        }
    }
    
    // Send a binary message over the WebRTC data channel
    obj.send = function (x) {
        if (typeof x == 'string') { var b = new Uint8Array(x.length); for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); } x = b; }
        //if (urlvars && urlvars['webrtctrace']) { console.log('WebRTC-Send(' + obj.State + '): ', typeof x, x); }
        obj.webchannel.send(x);
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    obj.Stop = function () {
        if (obj.debugmode == 1) { console.log('stop'); }
        if (obj.rtcKeepAlive != null) { clearInterval(obj.rtcKeepAlive); obj.rtcKeepAlive = null; }
        obj.xxStateChange(0);
    }

    obj.xxSendRtcKeepAlive = function () {
        //if (urlvars && urlvars['webrtctrace']) { console.log('WebRTC-SendKeepAlive()'); }
        obj.sendCtrlMsg(JSON.stringify({ action: 'ping' }));
    }

    return obj;
}
