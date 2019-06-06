/** 
* @description Intel AMT Redirection Transport Module - using Node
* @author Ylian Saint-Hilaire
* @version v0.0.1f
*/

// Construct a MeshServer object
module.exports = function CreateAmtRedirect(module) {
    var obj = {};
    obj.m = module; // This is the inner module (Terminal or Desktop)
    module.parent = obj;
    obj.State = 0;
    obj.net = require('net');
    obj.tls = require('tls');
    obj.socket = null;
    obj.host = null;
    obj.port = 0;
    obj.user = null;
    obj.pass = null;
    obj.connectstate = 0;
    obj.protocol = module.protocol; // 1 = SOL, 2 = KVM, 3 = IDER
    obj.xtlsoptions = null;

    obj.amtaccumulator = null;
    obj.amtsequence = 1;
    obj.amtkeepalivetimer = null;
    obj.authuri = "/RedirectionService";
    obj.digestRealmMatch = null;

    obj.onStateChanged = null;

    // Private method
    obj.Debug = function (msg) { console.log(msg); }
    var urlvars = null;

    obj.Start = function (host, port, user, pass, tls, tlsFingerprint, tlsoptions) {
        obj.host = host;
        obj.port = port;
        obj.user = user;
        obj.pass = pass;
        obj.xtls = tls;
        obj.xtlsoptions = tlsoptions;
        obj.xtlsFingerprint = tlsFingerprint;
        obj.connectstate = 0;

        if (tls == true) {
            obj.socket = obj.tls.connect({ host: host, port: port, rejectUnauthorized: false, checkServerIdentity: obj.onCheckServerIdentity }, obj.xxOnSocketConnected);
        } else {
            obj.socket = obj.net.createConnection({ host: host, port: port }, obj.xxOnSocketConnected);
        }
        obj.socket.on('data', obj.xxOnSocketData);
        obj.socket.on('close', obj.xxOnSocketClosed);
        obj.socket.on('error', obj.xxOnSocketClosed);
        obj.xxStateChange(1);
    }

    // Get the certificate of Intel AMT
    //obj.getPeerCertificate = function () { if (obj.xtls == true) { return obj.socket.getPeerCertificate(); } return null; }

    obj.onCheckServerIdentity = function (cert) {
        var f = cert[0].fingerprint.split(':').join('').toLowerCase();
        if ((obj.xtlsFingerprint != null) && (obj.xtlsFingerprint != f)) {
            console.log('Invalid TLS Cert, SHA384: ' + f);
            process.exit(2);
            return;
        } else {
            if (obj.xtlsFingerprint == null) {
                obj.xtlsFingerprint = f;
                console.log('TLS Cert SHA384: ' + f);
            }
        }
    }

    obj.xxOnSocketConnected = function () {
        if (obj.socket == null) return;
        /*
        if (obj.xtls == true) {
            obj.xtlsCertificate = obj.socket.getPeerCertificate();
            if ((obj.xtlsFingerprint != 0) && (obj.xtlsCertificate.fingerprint.split(':').join('').toLowerCase() != obj.xtlsFingerprint)) { obj.Stop(); return; }
        }
        */

        if (urlvars && urlvars['redirtrace']) { console.log("REDIR-CONNECTED"); }
        //obj.Debug("Socket Connected");
        obj.xxStateChange(2);
        if (obj.protocol == 1) obj.xxSend(obj.RedirectStartSol); // TODO: Put these strings in higher level module to tighten code
        else if (obj.protocol == 2) obj.xxSend(obj.RedirectStartKvm); // Don't need these is the feature if not compiled-in.
        else if (obj.protocol == 3) obj.xxSend(obj.RedirectStartIder);
    }
   
    obj.xxOnSocketData = function (data) {
        //console.log('xxOnSocketData: ' + data.toString('hex'), data.length);
        if (!data || obj.connectstate == -1) return;
        if (urlvars && urlvars['redirtrace']) { console.log("REDIR-RECV(" + data.length + "): " + data.toString('hex')); }
        //obj.Debug("Recv(" + data.length + "): " + rstr2hex(data));
        if ((obj.protocol == 2 || obj.protocol == 3) && obj.connectstate == 1) { return obj.m.ProcessData(data); } // KVM or IDER traffic, forward it directly.
        if (obj.amtaccumulator == null) { obj.amtaccumulator = data; } else { obj.amtaccumulator = Buffer.concat(obj.amtaccumulator, data); }
        //obj.Debug("Recv(" + obj.amtaccumulator.length + "): " + rstr2hex(obj.amtaccumulator));
        while (obj.amtaccumulator != null) {
            var cmdsize = 0;
            //console.log('CMD: ' + obj.amtaccumulator[0]);
            switch (obj.amtaccumulator[0]) {
                case 0x11: // StartRedirectionSessionReply (17)
                    if (obj.amtaccumulator.length < 4) return;
                    var statuscode = obj.amtaccumulator[1];
                    switch (statuscode) {
                        case 0: // STATUS_SUCCESS
                            if (obj.amtaccumulator.length < 13) return;
                            var oemlen = obj.amtaccumulator[12];
                            if (obj.amtaccumulator.length < 13 + oemlen) return;
                            obj.xxSend(String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)); // Query authentication support
                            cmdsize = (13 + oemlen);
                            break;
                        default:
                            obj.Stop();
                            break;
                    }
                    break;
                case 0x14: // AuthenticateSessionReply (20)
                    if (obj.amtaccumulator.length < 9) return;
                    var authDataLen = obj.amtaccumulator.readInt32LE(5);
                    if (obj.amtaccumulator.length < 9 + authDataLen) return;
                    var status = obj.amtaccumulator[1];
                    var authType = obj.amtaccumulator[4];
                    var authData = [];
                    for (i = 0; i < authDataLen; i++) { authData.push(obj.amtaccumulator[9 + i]); }
                    var authDataBuf = obj.amtaccumulator.slice(9, 9 + authDataLen);
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
                        else obj.Stop();
                    }
                    else if ((authType == 3 || authType == 4) && status == 1) {
                        var curptr = 0;

                        // Realm
                        var realmlen = authDataBuf[curptr];
                        var realm = authDataBuf.slice(curptr + 1, curptr + 1 + realmlen).toString();
                        curptr += (realmlen + 1);

                        // Check the digest realm. If it does not match, close the connection.
                        if (obj.digestRealmMatch && (obj.digestRealmMatch != realm)) { obj.Stop(); return; }

                        // Nonce
                        var noncelen = authDataBuf[curptr];
                        var nonce = authDataBuf.slice(curptr + 1, curptr + 1 + noncelen).toString();
                        curptr += (noncelen + 1);

                        // QOP
                        var qoplen = 0;
                        var qop = null;
                        var cnonce = obj.xxRandomValueHex(32);
                        var snc = '00000002';
                        var extra = '';
                        if (authType == 4) {
                            qoplen = authDataBuf[curptr];
                            qop = authDataBuf.slice(curptr + 1, curptr + 1 + qoplen).toString();
                            curptr += (qoplen + 1);
                            extra = snc + ":" + cnonce + ":" + qop + ":";
                        }
                        var digest = hex_md5(hex_md5(obj.user + ":" + realm + ":" + obj.pass) + ":" + nonce + ":" + extra + hex_md5("POST:" + obj.authuri));
                        var totallen = obj.user.length + realm.length + nonce.length + obj.authuri.length + cnonce.length + snc.length + digest.length + 7;
                        if (authType == 4) totallen += (qop.length + 1);
                        var buf = Buffer.concat([new Buffer([0x13, 0x00, 0x00, 0x00, authType]), new Buffer([totallen & 0xFF, (totallen >> 8) & 0xFF, 0x00, 0x00]), new Buffer([obj.user.length]), new Buffer(obj.user), new Buffer([realm.length]), new Buffer(realm), new Buffer([nonce.length]), new Buffer(nonce), new Buffer([obj.authuri.length]), new Buffer(obj.authuri), new Buffer([cnonce.length]), new Buffer(cnonce), new Buffer([snc.length]), new Buffer(snc), new Buffer([digest.length]), new Buffer(digest)]);
                        if (authType == 4) buf = Buffer.concat([ buf, new Buffer([qop.length]), new Buffer(qop) ]);
                        obj.xxSend(buf);
                    }
                    else if (status == 0) { // Success
                        if (obj.protocol == 1) {
                            /*
                            // Serial-over-LAN: Send Intel AMT serial settings...
                            var MaxTxBuffer = 10000;
                            var TxTimeout = 100;
                            var TxOverflowTimeout = 0;
                            var RxTimeout = 10000;
                            var RxFlushTimeout = 100;
                            var Heartbeat = 0;//5000;
                            obj.xxSend(String.fromCharCode(0x20, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + ToShortStr(MaxTxBuffer) + ToShortStr(TxTimeout) + ToShortStr(TxOverflowTimeout) + ToShortStr(RxTimeout) + ToShortStr(RxFlushTimeout) + ToShortStr(Heartbeat) + ToIntStr(0));
                            */
                        }
                        if (obj.protocol == 2) {
                            // Remote Desktop: Send traffic directly...
                            obj.xxSend(new Buffer([0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        }
                        if (obj.protocol == 3) {
                            // Remote IDER: Send traffic directly...
                            obj.connectstate = 1;
                            obj.xxStateChange(3);
                        }
                    } else obj.Stop();
                    break;
                case 0x21: // Response to settings (33)
                    if (obj.amtaccumulator.length < 23) break;
                    cmdsize = 23;
                    obj.xxSend(String.fromCharCode(0x27, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + String.fromCharCode(0x00, 0x00, 0x1B, 0x00, 0x00, 0x00));
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
                    var cs = (10 + ((obj.amtaccumulator[9] & 0xFF) << 8) + (obj.amtaccumulator[8] & 0xFF));
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
                    console.log("Unknown Intel AMT command: " + obj.amtaccumulator[0] + " acclen=" + obj.amtaccumulator.length);
                    obj.Stop();
                    return;
            }
            if (cmdsize == 0) return;
            if (cmdsize == obj.amtaccumulator.length) { obj.amtaccumulator = null; } else { obj.amtaccumulator = obj.amtaccumulator.slice(cmdsize); }
        }
    }
    
    obj.xxSend = function (x) {
        if (urlvars && urlvars['redirtrace']) { console.log("REDIR-SEND(" + x.length + "): " + rstr2hex(x)); }
        //obj.Debug("Send(" + x.length + "): " + new Buffer(x, "binary").toString('hex'));
        if (typeof x == 'string') { obj.socket.write(new Buffer(x, "binary")); } else { obj.socket.write(x); }
    }

    obj.Send = function (x) {
        if (obj.socket == null || obj.connectstate != 1) return;
        if (obj.protocol == 1) { obj.xxSend(String.fromCharCode(0x28, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++) + ToShortStr(x.length) + x); } else { obj.xxSend(x); }
    }

    obj.xxSendAmtKeepAlive = function () {
        if (obj.socket == null) return;
        obj.xxSend(String.fromCharCode(0x2B, 0x00, 0x00, 0x00) + ToIntStr(obj.amtsequence++));
    }

    // Uses OpenSSL random to generate a hex string
    obj.xxRandomValueHex = function (len) {
        var t = [], l = Math.floor(len / 2);
        for (var i = 0; i < l; i++) { t.push(obj.tls.generateRandomInteger("0", "255")); }
        return new Buffer(t).toString('hex');
    }

    obj.xxOnSocketClosed = function () {
        obj.socket = null;
        if (urlvars && urlvars['redirtrace']) { console.log("REDIR-CLOSED"); }
        //obj.Debug("Socket Closed");
        obj.Stop();
    }

    obj.xxStateChange = function(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.m.xxStateChange(obj.State);
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }

    obj.Stop = function () {
        if (urlvars && urlvars['redirtrace']) { console.log("REDIR-CLOSED"); }
        //obj.Debug("Socket Stopped");
        obj.xxStateChange(0);
        obj.connectstate = -1;
        obj.amtaccumulator = "";
        if (obj.socket != null) { obj.socket.destroy(); obj.socket = null; }
        if (obj.amtkeepalivetimer != null) { clearInterval(obj.amtkeepalivetimer); obj.amtkeepalivetimer = null; }
    }

    obj.RedirectStartSol = new Buffer([0x10, 0x00, 0x00, 0x00, 0x53, 0x4F, 0x4C, 0x20]);
    obj.RedirectStartKvm = new Buffer([0x10, 0x01, 0x00, 0x00, 0x4b, 0x56, 0x4d, 0x52]);
    obj.RedirectStartIder = new Buffer([0x10, 0x00, 0x00, 0x00, 0x49, 0x44, 0x45, 0x52]);

    return obj;
}

function ToIntStr(v) { return String.fromCharCode((v & 0xFF), ((v >> 8) & 0xFF), ((v >> 16) & 0xFF), ((v >> 24) & 0xFF)); }
function ToShortStr(v) { return String.fromCharCode((v & 0xFF), ((v >> 8) & 0xFF)); }

function ShortToStr(v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); }
function ShortToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); }
function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
function IntToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }

var md5hasher = require('MD5Stream').create();
function hex_md5(a) { return md5hasher.syncHash(a).toString('hex').toLowerCase(); }