/** 
* @description Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.2
*/

// Construct a Intel AMT IDER object
var CreateAmtRemoteIder = function (serverurl) {
    var obj = {};
    obj.protocol = 3; // IDER
    obj.state = 0;
    obj.socket = null;
    obj.serverurl = serverurl;
    obj.bytesToAmt = 0;
    obj.bytesFromAmt = 0;

    // Private method
    obj.Debug = function (msg) { console.log(msg); }

    // Private method, called by parent when it change state
    obj.xxStateChange = function (newstate) {
        //console.log("STATE: " + newstate);
        if (newstate == 0) { obj.Stop(); } // Tell Storage Server to stop IDER
        if (newstate == 3) { obj.StateChange(3); _Send('D'); } // Tell Storage Server to start IDER
    }

    // Private method
    obj.StateChange = function (newstate) { obj.state = newstate; }

    // Private method
    obj.ProcessData = function (data) { _Send('F' + data); obj.bytesFromAmt += data.length; }

    obj.Start = function (host, port, user, pass, tls) {
        //obj.Debug("IDER-Start");
        obj.host = host;
        obj.port = port;
        obj.user = user;
        obj.pass = pass;
        obj.tls = tls;
        obj.bytesToAmt = 0;
        obj.bytesFromAmt = 0;
        obj.socket = new WebSocket(serverurl);
        obj.socket.onopen = _OnSocketConnected;
        obj.socket.onmessage = _OnMessage;
        obj.socket.onclose = _OnSocketClosed;
        obj.StateChange(1);
    }

    obj.Stop = function () {
        if (obj.socket != null) { _Send('G'); obj.socket.close(); obj.socket = null; }
        obj.StateChange(0);
        obj.parent.Stop();
    }

    function _OnSocketConnected() {
        obj.Debug("Socket Connected");
        obj.StateChange(2);
        _Send('C');
    }

    // Setup the file reader
    var fileReader = new FileReader();
    var fileReaderInuse = false, fileReaderAcc = [];
    if (fileReader.readAsBinaryString) {
        // Chrome & Firefox (Draft)
        fileReader.onload = function (e) { _OnSocketData(e.target.result); if (fileReaderAcc.length == 0) { fileReaderInuse = false; } else { fileReader.readAsBinaryString(new Blob([fileReaderAcc.shift()])); } }
    } else if (fileReader.readAsArrayBuffer) {
        // Chrome & Firefox (Spec)
        fileReader.onloadend = function (e) { _OnSocketData(e.target.result); if (fileReaderAcc.length == 0) { fileReaderInuse = false; } else { fileReader.readAsArrayBuffer(fileReaderAcc.shift()); } }
    }

    function _OnMessage(e) {
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
                _OnSocketData(binary);
            }
        } else {
            _OnSocketData(e.data);
        }
    };

    function _OnSocketData(data) {
        if (!data) return;

        if (typeof data === 'object') {
            // This is an ArrayBuffer, convert it to a string array (used in IE)
            var binary = "";
            var bytes = new Uint8Array(data);
            var length = bytes.byteLength;
            for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
            data = binary;
        }
        else if (typeof data !== 'string') { return; }

        // console.log("CMD: " + data.substring(0, 1));

        // Handle commands
        switch (data.substring(0, 1)) {
            case 'A': { data[0] = 'B'; _Send(data); break; } // Echo
            case 'C': { obj.parent.Start(obj.host, obj.port, obj.user, obj.pass, obj.tls); break; } // Session Start
            case 'E': { obj.Stop(); break; } // Stop IDER
            case 'F': { obj.parent.xxSend(data.substring(1)); obj.bytesToAmt += (data.length - 1); break; } // IDER Data
            case 'H': { if (obj.onDialogPrompt) obj.onDialogPrompt(obj, JSON.parse(data.substring(1))); break; } // IDER Dialog Prompt
        }
    }

    function _OnSocketClosed() {
        // obj.Debug("Socket Closed");
        obj.Stop();
    }

    obj.dialogPrompt = function(x) { _Send('H' + JSON.stringify(x)); }

    function _Send(x) {
        // obj.Debug("Send(" + x.length + "): " + rstr2hex(x));
        if (obj.socket != null && obj.socket.readyState == WebSocket.OPEN) {
            var b = new Uint8Array(x.length);
            for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); }
            obj.socket.send(b.buffer);
        }
    }

    return obj;
}
