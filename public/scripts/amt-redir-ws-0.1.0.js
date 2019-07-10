/** 
* @description Intel AMT Redirection Transport Module - using websocket relay
* @author Ylian Saint-Hilaire
* @version v0.0.1f
*/

// Construct a MeshServer object
var CreateAmtRedirect = function (module, authCookie) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.authCookie = authCookie;
    obj.State = 0;
    obj.socket = null;
    // ###BEGIN###{!Mode-Firmware}
    obj.host = null;
    obj.port = 0;
    obj.user = null;
    obj.pass = null;
    obj.authuri = "/RedirectionService";
    obj.tlsv1only = 0;
    obj.inDataCount = 0;
    // ###END###{!Mode-Firmware}
    obj.connectstate = 0;
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER
    obj.debugmode = 0;

    obj.amtaccumulator = "";
    obj.amtsequence = 1;
    obj.amtkeepalivetimer = null;

    obj.onStateChanged = null;

    // Private method
    //obj.Debug = function (msg) { console.log(msg); }

    obj.Start = function (host, port, user, pass, tls) {
        obj.host = host;
        obj.port = port;
        obj.user = user;
        obj.pass = pass;
        obj.connectstate = 0;
        obj.inDataCount = 0;
        var url = window.location.protocol.replace("http", "ws") + "//" + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + "/webrelay.ashx?p=2&host=" + host + "&port=" + port + "&tls=" + tls + ((user == '*') ? "&serverauth=1" : "") + ((typeof pass === "undefined") ? ("&serverauth=1&user=" + user) : ""); // The "p=2" indicates to the relay that this is a REDIRECTION session
        if ((authCookie != null) && (authCookie != '')) { url += '&auth=' + authCookie; }
        obj.socket = new WebSocket(url);
        obj.socket.onopen = obj.xxOnSocketConnected;
        obj.socket.onmessage = obj.xxOnMessage;
        obj.socket.onclose = obj.xxOnSocketClosed;
        obj.xxStateChange(1);
    }

    obj.xxOnSocketConnected = function () {
        //obj.Debug("Redir Socket Connected");
        if (obj.debugmode == 1) { console.log('onSocketConnected'); }
        obj.xxStateChange(2);
        if (obj.protocol == 1) obj.xxSend(obj.RedirectStartSol); // TODO: Put these strings in higher level module to tighten code
        if (obj.protocol == 2) obj.xxSend(obj.RedirectStartKvm); // Don't need these is the feature is not compiled-in.
        if (obj.protocol == 3) obj.xxSend(obj.RedirectStartIder);
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
        obj.inDataCount++;
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
            // obj.debug("MeshDataChannel - OnData - " + typeof e.data + " - " + e.data.length);
            obj.xxOnSocketData(e.data);
        }
    };
   
    obj.xxOnSocketData = function (data) {
        if (!data || obj.connectstate == -1) return;

        if (typeof data === 'object') {
            // This is an ArrayBuffer, convert it to a string array (used in IE)
            var binary = "";
            var bytes = new Uint8Array(data);
            var length = bytes.byteLength;
            for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
            data = binary;
        }
        else if (typeof data !== 'string') { return; }

        if ((obj.protocol == 2 || obj.protocol == 3) && obj.connectstate == 1) { return obj.m.ProcessData(data); } // KVM traffic, forward it directly.
        obj.amtaccumulator += data;
        //obj.Debug("Redir Recv(" + obj.amtaccumulator.length + "): " + rstr2hex(obj.amtaccumulator));
        while (obj.amtaccumulator.length >= 1) {
            var cmdsize = 0;
            switch (obj.amtaccumulator.charCodeAt(0)) {
                case 0x11: // StartRedirectionSessionReply (17)
                    if (obj.amtaccumulator.length < 4) return;
                    var statuscode = obj.amtaccumulator.charCodeAt(1);
                    switch (statuscode) {
                        case 0: // STATUS_SUCCESS
                            if (obj.amtaccumulator.length < 13) return;
                            var oemlen = obj.amtaccumulator.charCodeAt(12);
                            if (obj.amtaccumulator.length < 13 + oemlen) return;
                            // Query for available authentication
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)); // Query authentication support
                            cmdsize = (13 + oemlen);
                            break;
                        default:
                            obj.Stop(1);
                            break;
                    }
                    break;
                case 0x14: // AuthenticateSessionReply (20)
                    if (obj.amtaccumulator.length < 9) return;
                    var authDataLen = ReadIntX(obj.amtaccumulator, 5);
                    if (obj.amtaccumulator.length < 9 + authDataLen) return;
                    var status = obj.amtaccumulator.charCodeAt(1);
                    var authType = obj.amtaccumulator.charCodeAt(4);
                    var authData = [];
                    for (i = 0; i < authDataLen; i++) { authData.push(obj.amtaccumulator.charCodeAt(9 + i)); }
                    var authDataBuf = obj.amtaccumulator.substring(9, 9 + authDataLen);
                    cmdsize = 9 + authDataLen;
                    if (authType == 0) {
                        // Query
                        if (authData.indexOf(4) >= 0) {
                            // Good Digest Auth (With cnonce and all)
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x04) + IntToStrX(obj.user.length + obj.authuri.length + 8) + String.fromCharCode(obj.user.length) + obj.user + String.fromCharCode(0x00, 0x00) + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(0x00, 0x00, 0x00, 0x00));
                        }
                        else if (authData.indexOf(3) >= 0) {
                            // Bad Digest Auth (Not sure why this is supported, cnonce is not used!)
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x03) + IntToStrX(obj.user.length + obj.authuri.length + 7) + String.fromCharCode(obj.user.length) + obj.user + String.fromCharCode(0x00, 0x00) + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(0x00, 0x00, 0x00));
                        }
                        else if (authData.indexOf(1) >= 0) {
                            // Basic Auth (Probably a good idea to not support this unless this is an old version of Intel AMT)
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x01) + IntToStrX(obj.user.length + obj.pass.length + 2) + String.fromCharCode(obj.user.length) + obj.user + String.fromCharCode(obj.pass.length) + obj.pass);
                        }
                        else obj.Stop(2);
                    }
                    else if ((authType == 3 || authType == 4) && status == 1) {
                        var curptr = 0;

                        // Realm
                        var realmlen = authDataBuf.charCodeAt(curptr);
                        var realm = authDataBuf.substring(curptr + 1, curptr + 1 + realmlen);
                        curptr += (realmlen + 1);

                        // Nonce
                        var noncelen = authDataBuf.charCodeAt(curptr);
                        var nonce = authDataBuf.substring(curptr + 1, curptr + 1 + noncelen);
                        curptr += (noncelen + 1);

                        // QOP
                        var qoplen = 0;
                        var qop = null;
                        var cnonce = obj.xxRandomNonce(32);
                        var snc = '00000002';
                        var extra = '';
                        if (authType == 4) {
                            qoplen = authDataBuf.charCodeAt(curptr);
                            qop = authDataBuf.substring(curptr + 1, curptr + 1 + qoplen);
                            curptr += (qoplen + 1);
                            extra = snc + ":" + cnonce + ":" + qop + ":";
                        }

                        var digest = hex_md5(hex_md5(obj.user + ":" + realm + ":" + obj.pass) + ":" + nonce + ":" + extra + hex_md5("POST:" + obj.authuri));
                        var totallen = obj.user.length + realm.length + nonce.length + obj.authuri.length + cnonce.length + snc.length + digest.length + 7;
                        if (authType == 4) totallen += (qop.length + 1);
                        var buf = String.fromCharCode(0x13, 0x00, 0x00, 0x00, authType) + IntToStrX(totallen) + String.fromCharCode(obj.user.length) + obj.user + String.fromCharCode(realm.length) + realm + String.fromCharCode(nonce.length) + nonce + String.fromCharCode(obj.authuri.length) + obj.authuri + String.fromCharCode(cnonce.length) + cnonce + String.fromCharCode(snc.length) + snc + String.fromCharCode(digest.length) + digest;
                        if (authType == 4) buf += (String.fromCharCode(qop.length) + qop);
                        obj.xxSend(buf);
                    }
                    else
                    if (status == 0) { // Success
                        if (obj.protocol == 1) {
                            // Serial-over-LAN: Send Intel AMT serial settings...
                            var MaxTxBuffer = 10000;
                            var TxTimeout = 100;
                            var TxOverflowTimeout = 0;
                            var RxTimeout = 10000;
                            var RxFlushTimeout = 100;
                            var Heartbeat = 0;//5000;
                            obj.xxSend(String.fromCharCode(0x20, 0x00, 0x00, 0x00) + IntToStrX(obj.amtsequence++) + ShortToStrX(MaxTxBuffer) + ShortToStrX(TxTimeout) + ShortToStrX(TxOverflowTimeout) + ShortToStrX(RxTimeout) + ShortToStrX(RxFlushTimeout) + ShortToStrX(Heartbeat) + IntToStrX(0));
                        }
                        if (obj.protocol == 2) {
                            // Remote Desktop: Send traffic directly...
                            obj.xxSend(String.fromCharCode(0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00));
                        }
                        if (obj.protocol == 3) {
                            // Remote IDER: Send traffic directly...
                            obj.connectstate = 1;
                            obj.xxStateChange(3);
                        }
                    } else obj.Stop(3);
                    break;
                case 0x21: // Response to settings (33)
                    if (obj.amtaccumulator.length < 23) break;
                    cmdsize = 23;
                    obj.xxSend(String.fromCharCode(0x27, 0x00, 0x00, 0x00) + IntToStrX(obj.amtsequence++) + String.fromCharCode(0x00, 0x00, 0x1B, 0x00, 0x00, 0x00));
                    if (obj.protocol == 1) { obj.amtkeepalivetimer = setInterval(obj.xxSendAmtKeepAlive, 2000); }
                    obj.connectstate = 1;
                    obj.xxStateChange(3);
                    break;
                case 0x29: // Serial Settings (41)
                    if (obj.amtaccumulator.length < 10) break;
                    cmdsize = 10;
                    break;
                case 0x2A: // Incoming display data (42)
                    if (obj.amtaccumulator.length < 10) break;
                    var cs = (10 + ((obj.amtaccumulator.charCodeAt(9) & 0xFF) << 8) + (obj.amtaccumulator.charCodeAt(8) & 0xFF));
                    if (obj.amtaccumulator.length < cs) break;
                    obj.m.ProcessData(obj.amtaccumulator.substring(10, cs));
                    cmdsize = cs;
                    break;
                case 0x2B: // Keep alive message (43)
                    if (obj.amtaccumulator.length < 8) break;
                    cmdsize = 8;
                    break;
                case 0x41:
                    if (obj.amtaccumulator.length < 8) break;
                    obj.connectstate = 1;
                    obj.m.Start();
                    // KVM traffic, forward rest of accumulator directly.
                    if (obj.amtaccumulator.length > 8) { obj.m.ProcessData(obj.amtaccumulator.substring(8)); }
                    cmdsize = obj.amtaccumulator.length;
                    break;
                default:
                    console.log("Unknown Intel AMT command: " + obj.amtaccumulator.charCodeAt(0) + " acclen=" + obj.amtaccumulator.length);
                    obj.Stop(4);
                    return;
            }
            if (cmdsize == 0) return;
            obj.amtaccumulator = obj.amtaccumulator.substring(cmdsize);
        }
    }
    
    obj.xxSend = function (x) {
        //obj.Debug("Redir Send(" + x.length + "): " + rstr2hex(x));
        if (obj.socket != null && obj.socket.readyState == WebSocket.OPEN) {
            if (obj.debugmode == 1) { console.log('Send', x); }
            var b = new Uint8Array(x.length);
            for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); }
            try { obj.socket.send(b.buffer); } catch (ex) { }
        }
    }

    obj.send = function (x) {
        if (obj.socket == null || obj.connectstate != 1) return;
        if (obj.protocol == 1) { obj.xxSend(String.fromCharCode(0x28, 0x00, 0x00, 0x00) + IntToStrX(obj.amtsequence++) + ShortToStrX(x.length) + x); } else { obj.xxSend(x); }
    }

    obj.xxSendAmtKeepAlive = function () {
        if (obj.socket == null) return;
        obj.xxSend(String.fromCharCode(0x2B, 0x00, 0x00, 0x00) + IntToStrX(obj.amtsequence++));
    }

    obj.xxRandomNonceX = "abcdef0123456789";
    obj.xxRandomNonce = function (length) {
        var r = "";
        for (var i = 0; i < length; i++) { r += obj.xxRandomNonceX.charAt(Math.floor(Math.random() * obj.xxRandomNonceX.length)); }
        return r;
    }

    obj.xxOnSocketClosed = function () {
        if (obj.debugmode == 1) { console.log('onSocketClosed'); }
        //obj.Debug("Redir Socket Closed");
        if ((obj.inDataCount == 0) && (obj.tlsv1only == 0)) {
            obj.tlsv1only = 1;
            obj.socket = new WebSocket(window.location.protocol.replace("http", "ws") + "//" + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + "/webrelay.ashx?p=2&host=" + obj.host + "&port=" + obj.port + "&tls=" + obj.tls + "&tls1only=1" + ((obj.user == '*') ? "&serverauth=1" : "") + ((typeof pass === "undefined") ? ("&serverauth=1&user=" + obj.user) : "")); // The "p=2" indicates to the relay that this is a REDIRECTION session
            obj.socket.onopen = obj.xxOnSocketConnected;
            obj.socket.onmessage = obj.xxOnMessage;
            obj.socket.onclose = obj.xxOnSocketClosed;
        } else {
            obj.Stop(5);
        }
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    obj.Stop = function (x) {
        if (obj.debugmode == 1) { console.log('onSocketStop', x); }
        //obj.Debug("Redir Socket Stopped");
        obj.xxStateChange(0);
        obj.connectstate = -1;
        obj.amtaccumulator = "";
        if (obj.socket != null) { obj.socket.close(); obj.socket = null; }
        if (obj.amtkeepalivetimer != null) { clearInterval(obj.amtkeepalivetimer); obj.amtkeepalivetimer = null; }
    }

    obj.RedirectStartSol = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x53, 0x4F, 0x4C, 0x20);
    obj.RedirectStartKvm = String.fromCharCode(0x10, 0x01, 0x00, 0x00, 0x4b, 0x56, 0x4d, 0x52);
    obj.RedirectStartIder = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x49, 0x44, 0x45, 0x52);

    return obj;
}
