/** 
* @description Intel(r) AMT WSMAN communication using Node.js TLS
* @author Ylian Saint-Hilaire/Joko Sastriawan
* @version v0.2.0b
*/

// Construct a MeshServer object
var CreateWsmanComm = function (host, port, user, pass, tls, tlsoptions, parent, mode) {
    //console.log('CreateWsmanComm', host, port, user, pass, tls, tlsoptions);

    var obj = {};    
    obj.PendingAjax = [];               // List of pending AJAX calls. When one frees up, another will start.
    obj.ActiveAjaxCount = 0;            // Number of currently active AJAX calls
    obj.MaxActiveAjaxCount = 1;         // Maximum number of activate AJAX calls at the same time.
    obj.FailAllError = 0;               // Set this to non-zero to fail all AJAX calls with that error status, 999 causes responses to be silent.
    obj.challengeParams = null;
    obj.noncecounter = 1;
    obj.authcounter = 0;

    obj.Address = '/wsman';
    obj.challengeParams = null;
    obj.noncecounter = 1;
    obj.authcounter = 0;
    obj.cnonce = Math.random().toString(36).substring(7); // Generate a random client nonce

    obj.net = require('net');
    obj.tls = require('tls');
    obj.crypto = require('crypto');
    obj.constants = require('constants');
    obj.socket = null;
    obj.socketState = 0;
    obj.kerberosDone = 0;
    obj.amtVersion = null;

    obj.host = host;
    obj.port = port;
    obj.user = user;
    obj.pass = pass;
    obj.xtls = tls;
    obj.xtlsoptions = tlsoptions;
    obj.parent = parent;
    obj.mode = mode;//1: direct, 2: CIRA, 3: APF relay
    obj.xtlsFingerprint;
    obj.xtlsCertificate = null;
    obj.xtlsCheck = 0; // 0 = No TLS, 1 = CA Checked, 2 = Pinned, 3 = Untrusted
    obj.xtlsSkipHostCheck = 0;
    obj.xtlsMethod = 0;
    obj.xtlsDataReceived = false;
    obj.digestRealmMatch = null;
    obj.digestRealm = null;

    // Private method
    obj.Debug = function (msg) { console.log(msg); }

    // Private method
    //   pri = priority, if set to 1, the call is high priority and put on top of the stack.
    obj.PerformAjax = function (postdata, callback, tag, pri, url, action) {
        if ((obj.ActiveAjaxCount == 0 || ((obj.ActiveAjaxCount < obj.MaxActiveAjaxCount) && (obj.challengeParams != null))) && obj.PendingAjax.length == 0) {
            // There are no pending AJAX calls, perform the call now.
            obj.PerformAjaxEx(postdata, callback, tag, url, action);
        } else {
            // If this is a high priority call, put this call in front of the array, otherwise put it in the back.
            if (pri == 1) { obj.PendingAjax.unshift([postdata, callback, tag, url, action]); } else { obj.PendingAjax.push([postdata, callback, tag, url, action]); }
        }
    }

    // Private method
    obj.PerformNextAjax = function () {
        if (obj.ActiveAjaxCount >= obj.MaxActiveAjaxCount || obj.PendingAjax.length == 0) return;
        var x = obj.PendingAjax.shift();
        obj.PerformAjaxEx(x[0], x[1], x[2], x[3], x[4]);
        obj.PerformNextAjax();
    }

    // Private method
    obj.PerformAjaxEx = function (postdata, callback, tag, url, action) {
        if (obj.FailAllError != 0) { obj.gotNextMessagesError({ status: obj.FailAllError }, 'error', null, [postdata, callback, tag, url, action]); return; }
        if (!postdata) postdata = "";
        //obj.Debug("SEND: " + postdata); // DEBUG

        obj.ActiveAjaxCount++;
        return obj.PerformAjaxExNodeJS(postdata, callback, tag, url, action);
    }

    // NODE.js specific private method
    obj.pendingAjaxCall = [];

    // NODE.js specific private method
    obj.PerformAjaxExNodeJS = function (postdata, callback, tag, url, action) { obj.PerformAjaxExNodeJS2(postdata, callback, tag, url, action, 5); }

    // NODE.js specific private method
    obj.PerformAjaxExNodeJS2 = function (postdata, callback, tag, url, action, retry) {
        if (retry <= 0 || obj.FailAllError != 0) {
            // Too many retry, fail here.
            obj.ActiveAjaxCount--;
            if (obj.FailAllError != 999) obj.gotNextMessages(null, 'error', { status: ((obj.FailAllError == 0) ? 408 : obj.FailAllError) }, [postdata, callback, tag, url, action]); // 408 is timeout error
            obj.PerformNextAjax();
            return;
        }
        obj.pendingAjaxCall.push([postdata, callback, tag, url, action, retry]);
        if (obj.socketState == 0) { obj.xxConnectHttpSocket(); }
        else if (obj.socketState == 2) { obj.sendRequest(postdata, url, action); }
    }

    // NODE.js specific private method
    obj.sendRequest = function (postdata, url, action) {
        url = url ? url : "/wsman";
        action = action ? action : "POST";
        var h = action + " " + url + " HTTP/1.1\r\n";
        if (obj.challengeParams != null) {
            obj.digestRealm = obj.challengeParams["realm"];
            if (obj.digestRealmMatch && (obj.digestRealm != obj.digestRealmMatch)) {
                obj.FailAllError = 997; // Cause all new responses to be silent. 997 = Digest Realm check error
                obj.CancelAllQueries(997);
                return;
            }
        }
        if ((obj.user == '*') && (kerberos != null)) {
            // Kerberos Auth
            if (obj.kerberosDone == 0) {
                var ticketName = 'HTTP' + ((obj.tls == 1) ? 'S' : '') + '/' + ((obj.pass == '') ? (obj.host + ':' + obj.port) : obj.pass);
                // Ask for the new Kerberos ticket
                //console.log('kerberos.getTicket', ticketName);
                var ticketReturn = kerberos.getTicket(ticketName);
                if (ticketReturn.returnCode == 0 || ticketReturn.returnCode == 0x90312) {
                    h += 'Authorization: Negotiate ' + ticketReturn.ticket + '\r\n';
                    if (process.platform.indexOf('win') >= 0) {
                        // Clear kerberos tickets on both 32 and 64bit Windows platforms
                        try { require('child_process').exec('%windir%\\system32\\klist purge', function (error, stdout, stderr) { if (error) { require('child_process').exec('%windir%\\sysnative\\klist purge', function (error, stdout, stderr) { if (error) { console.error('Unable to purge kerberos tickets'); } }); } }); } catch (e) { console.log(e); }
                    }
                } else {
                    console.log('Unexpected Kerberos error code: ' + ticketReturn.returnCode);
                }
                obj.kerberosDone = 1;
            }
        } else if (obj.challengeParams != null) {
            var response = hex_md5(hex_md5(obj.user + ':' + obj.challengeParams["realm"] + ':' + obj.pass) + ':' + obj.challengeParams["nonce"] + ':' + obj.noncecounter + ':' + obj.cnonce + ':' + obj.challengeParams["qop"] + ':' + hex_md5(action + ':' + url));
            h += 'Authorization: ' + obj.renderDigest({ "username": obj.user, "realm": obj.challengeParams["realm"], "nonce": obj.challengeParams["nonce"], "uri": url, "qop": obj.challengeParams["qop"], "response": response, "nc": obj.noncecounter++, "cnonce": obj.cnonce }) + '\r\n';
        }
        h += 'Host: ' + obj.host + ':' + obj.port + '\r\nContent-Length: ' + postdata.length + '\r\n\r\n' + postdata; // Use Content-Length
        //h += 'Host: ' + obj.host + ':' + obj.port + '\r\nTransfer-Encoding: chunked\r\n\r\n' + postdata.length.toString(16).toUpperCase() + '\r\n' + postdata + '\r\n0\r\n\r\n'; // Use Chunked-Encoding
        obj.xxSend(h);
        //console.log("SEND: " + h); // Display send packet
    }

    // NODE.js specific private method
    obj.parseDigest = function (header) {
        var t = header.substring(7).split(',');
        for (i in t) t[i] = t[i].trim();
        return t.reduce(function (obj, s) { var parts = s.split('='); obj[parts[0]] = parts[1].replace(new RegExp('\"', 'g'), ''); return obj; }, {})
    }

    // NODE.js specific private method
    obj.renderDigest = function (params) {
        var paramsnames = [];
        for (i in params) { paramsnames.push(i); }
        return 'Digest ' + paramsnames.reduce(function (s1, ii) { return s1 + ',' + ii + '="' + params[ii] + '"' }, '').substring(1);
    }

    // NODE.js specific private method
    obj.xxConnectHttpSocket = function () {
        //obj.Debug("xxConnectHttpSocket");
        obj.socketParseState = 0;
        obj.socketAccumulator = '';
        obj.socketHeader = null;
        obj.socketData = '';
        obj.socketState = 1;
        obj.kerberosDone = 0;

        if ((obj.parent != null) && (obj.mode === 2) || (obj.mode === 3)) { // CIRA and APF            
            if (obj.mode == 2) { // CIRA
                var ciraconn = obj.parent.mpsserver.ciraConnections[obj.host];
                obj.socket = obj.parent.mpsserver.SetupCiraChannel(ciraconn, obj.port);
            } else { // APF
                var apfconn = obj.parent.apfserver.apfConnections[obj.host];
                obj.socket = obj.parent.apfserver.SetupCiraChannel(apfconn, obj.port);
            }
            obj.socket.onData = function (ccon, data) { obj.xxOnSocketData(data); }
            obj.socket.onStateChange = function (ccon, state) {
                if (state == 0) {
                    try {
                        obj.socketParseState = 0;
                        obj.socketAccumulator = '';
                        obj.socketHeader = null;
                        obj.socketData = '';
                        obj.socketState = 0;
                        obj.xxOnSocketClosed();
                    } catch (e) { }
                } else if (state == 2) {
                    // channel open success
                    obj.xxOnSocketConnected();
                }
            }
        } else {
            // Direct connection
            if (obj.xtls != 1) {
                // Connect without TLS
                obj.socket = new obj.net.Socket();
                obj.socket.setEncoding('binary');
                obj.socket.setTimeout(6000); // Set socket idle timeout
                obj.socket.on('data', obj.xxOnSocketData);
                obj.socket.on('close', obj.xxOnSocketClosed);
                obj.socket.on('timeout', obj.xxOnSocketClosed);
                obj.socket.connect(obj.port, obj.host, obj.xxOnSocketConnected);
            } else {
                // Connect with TLS
                var options = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                if (obj.xtlsMethod != 0) { options.secureProtocol = 'TLSv1_method'; }
                if (obj.xtlsoptions) {
                    if (obj.xtlsoptions.ca) options.ca = obj.xtlsoptions.ca;
                    if (obj.xtlsoptions.cert) options.cert = obj.xtlsoptions.cert;
                    if (obj.xtlsoptions.key) options.key = obj.xtlsoptions.key;
                    obj.xtlsoptions = options;
                }
                obj.socket = obj.tls.connect(obj.port, obj.host, obj.xtlsoptions, obj.xxOnSocketConnected);
                obj.socket.setEncoding('binary');
                obj.socket.setTimeout(6000); // Set socket idle timeout
                obj.socket.on('data', obj.xxOnSocketData);
                obj.socket.on('close', obj.xxOnSocketClosed);
                obj.socket.on('timeout', obj.xxOnSocketClosed);
                obj.socket.on('error', function (e) { if (e.message && e.message.indexOf('sslv3 alert bad record mac') >= 0) { obj.xtlsMethod = 1 - obj.xtlsMethod; } });
            }
            obj.socket.setNoDelay(true); // Disable nagle. We will encode each WSMAN request as a single send block and want to send it at once. This may help Intel AMT handle pipelining?
        }
    }

    // Get the certificate of Intel AMT
    obj.getPeerCertificate = function () { if (obj.xtls == 1) { return obj.socket.getPeerCertificate(); } return null; }
    obj.getPeerCertificateFingerprint = function () { if (obj.xtls == 1) { return obj.socket.getPeerCertificate().fingerprint.split(':').join('').toLowerCase(); } return null; }

    // NODE.js specific private method
    obj.xxOnSocketConnected = function () {
        if (obj.socket == null) return;
        // check TLS certificate for webrelay and direct only
        if (obj.mode < 2 && obj.xtls == 1) {
            obj.xtlsCertificate = obj.socket.getPeerCertificate();

            // ###BEGIN###{Certificates}
            // Setup the forge certificate check
            var camatch = 0;
            if (obj.xtlsoptions.ca) {
                var forgeCert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(atob(obj.xtlsCertificate.raw.toString('base64'))));
                var caStore = forge.pki.createCaStore(obj.xtlsoptions.ca);
                // Got thru all certificates in the store and look for a match.
                for (var i in caStore.certs) {
                    if (camatch == 0) {
                        var c = caStore.certs[i], verified = false;
                        try { verified = c.verify(forgeCert); } catch (e) { }
                        if (verified == true) { camatch = c; }
                    }
                }
                // We found a match, check that the CommonName matches the hostname
                if ((obj.xtlsSkipHostCheck == 0) && (camatch != 0)) {
                    amtcertname = forgeCert.subject.getField('CN').value;
                    if (amtcertname.toLowerCase() != obj.host.toLowerCase()) { camatch = 0; }
                }
            }
            if ((camatch == 0) && (obj.xtlsFingerprint != 0) && (obj.xtlsCertificate.fingerprint.split(':').join('').toLowerCase() != obj.xtlsFingerprint)) {
                obj.FailAllError = 998; // Cause all new responses to be silent. 998 = TLS Certificate check error
                obj.CancelAllQueries(998);
                return;
            }
            if ((obj.xtlsFingerprint == 0) && (camatch == 0)) { obj.xtlsCheck = 3; } else { obj.xtlsCheck = (camatch == 0) ? 2 : 1; }
            // ###END###{Certificates}
            // ###BEGIN###{!Certificates}
            if ((obj.xtlsFingerprint != 0) && (obj.xtlsCertificate.fingerprint.split(':').join('').toLowerCase() != obj.xtlsFingerprint)) {
                obj.FailAllError = 998; // Cause all new responses to be silent. 998 = TLS Certificate check error
                obj.CancelAllQueries(998);
                return;
            }
            obj.xtlsCheck = 2;
            // ###END###{!Certificates}
        } else { obj.xtlsCheck = 0; }
        obj.socketState = 2;
        obj.socketParseState = 0;
        for (i in obj.pendingAjaxCall) { obj.sendRequest(obj.pendingAjaxCall[i][0], obj.pendingAjaxCall[i][3], obj.pendingAjaxCall[i][4]); }
    }

    // NODE.js specific private method
    obj.xxOnSocketData = function (data) {
        //console.log("RECV:"+data);
        obj.xtlsDataReceived = true;        
        if (typeof data === 'object') {
            // This is an ArrayBuffer, convert it to a string array (used in IE)
            var binary = "", bytes = new Uint8Array(data), length = bytes.byteLength;
            for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
            data = binary;
        }
        else if (typeof data !== 'string') return;

        obj.socketAccumulator += data;
        while (true) {
            //console.log('ACC(' + obj.socketAccumulator + '): ' + obj.socketAccumulator);
            if (obj.socketParseState == 0) {
                var headersize = obj.socketAccumulator.indexOf("\r\n\r\n");
                if (headersize < 0) return;
                //obj.Debug("Header: "+obj.socketAccumulator.substring(0, headersize)); // Display received HTTP header
                obj.socketHeader = obj.socketAccumulator.substring(0, headersize).split("\r\n");
                if (obj.amtVersion == null) { for (var i in obj.socketHeader) { if (obj.socketHeader[i].indexOf('Server: Intel(R) Active Management Technology ') == 0) { obj.amtVersion = obj.socketHeader[i].substring(46); } } }
                obj.socketAccumulator = obj.socketAccumulator.substring(headersize + 4);
                obj.socketParseState = 1;
                obj.socketData = '';
                obj.socketXHeader = { Directive: obj.socketHeader[0].split(' ') };
                for (i in obj.socketHeader) {
                    if (i != 0) {
                        var x2 = obj.socketHeader[i].indexOf(':');
                        obj.socketXHeader[obj.socketHeader[i].substring(0, x2).toLowerCase()] = obj.socketHeader[i].substring(x2 + 2);
                    }
                }
            }
            if (obj.socketParseState == 1) {
                var csize = -1;
                if ((obj.socketXHeader["connection"] != undefined) && (obj.socketXHeader["connection"].toLowerCase() == 'close') && ((obj.socketXHeader["transfer-encoding"] == undefined) || (obj.socketXHeader["transfer-encoding"].toLowerCase() != 'chunked'))) {
                    // The body ends with a close, in this case, we will only process the header
                    csize = 0;
                } else if (obj.socketXHeader["content-length"] != undefined) {
                    // The body length is specified by the content-length
                    csize = parseInt(obj.socketXHeader["content-length"]);
                    if (obj.socketAccumulator.length < csize) return;
                    var data = obj.socketAccumulator.substring(0, csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(csize);
                    obj.socketData = data;
                    csize = 0;
                } else {
                    // The body is chunked
                    var clen = obj.socketAccumulator.indexOf("\r\n");
                    if (clen < 0) return; // Chunk length not found, exit now and get more data.
                    // Chunk length if found, lets see if we can get the data.
                    csize = parseInt(obj.socketAccumulator.substring(0, clen), 16);
                    if (obj.socketAccumulator.length < clen + 2 + csize + 2) return;
                    // We got a chunk with all of the data, handle the chunck now.
                    var data = obj.socketAccumulator.substring(clen + 2, clen + 2 + csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(clen + 2 + csize + 2);
                    obj.socketData += data;
                }
                if (csize == 0) {
                    //obj.Debug("xxOnSocketData DONE: (" + obj.socketData.length + "): " + obj.socketData);
                    obj.xxProcessHttpResponse(obj.socketXHeader, obj.socketData);
                    obj.socketParseState = 0;
                    obj.socketHeader = null;
                }
            }
        }
    }

    // NODE.js specific private method
    obj.xxProcessHttpResponse = function (header, data) {
        //obj.Debug("xxProcessHttpResponse: " + header.Directive[1]);

        var s = parseInt(header.Directive[1]);
        if (isNaN(s)) s = 500;
        if (s == 401 && ++(obj.authcounter) < 3) {
            obj.challengeParams = obj.parseDigest(header['www-authenticate']); // Set the digest parameters, after this, the socket will close and we will auto-retry            
            if (obj.mode==1) {
                obj.socket.end();
            } 
        } else {
            var r = obj.pendingAjaxCall.shift();
            if (r == null || r.length < 1) { console.log("pendingAjaxCall error, " + r); return; }
            //if (s != 200) { obj.Debug("Error, status=" + s + "\r\n\r\nreq=" + r[0] + "\r\n\r\nresp=" + data); } // Debug: Display the request & response if something did not work.
            obj.authcounter = 0;
            obj.ActiveAjaxCount--;
            obj.gotNextMessages(data, 'success', { status: s }, r);
            obj.PerformNextAjax();
        }
    }

    // NODE.js specific private method
    obj.xxOnSocketClosed = function (data) {
        //obj.Debug("xxOnSocketClosed");
        obj.socketState = 0;
        if (obj.mode ==1 && obj.socket != null) { obj.socket.destroy(); obj.socket = null; }
        if (obj.pendingAjaxCall.length > 0) {
            var r = obj.pendingAjaxCall.shift();
            var retry = r[5];
            setTimeout(function () { obj.PerformAjaxExNodeJS2(r[0], r[1], r[2], r[3], r[4], --retry) }, 500); // Wait half a second and try again
        }
    }

    // NODE.js specific private method
    obj.xxSend = function (x) {
        if (obj.socketState == 2) {
            obj.socket.write(Buffer.from(x, "binary"));
        }
    }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function (s) {
        obj.FailAllError = s;
        while (obj.PendingAjax.length > 0) { var x = obj.PendingAjax.shift(); x[1](null, s, x[2]); }
        if (obj.socket != null) { obj.socket.end(); obj.socket = null; obj.socketState = 0; }
    }

    // Private method
    obj.gotNextMessages = function (data, status, request, callArgs) {
        if (obj.FailAllError == 999) return;
        if (obj.FailAllError != 0) { try { callArgs[1](null, obj.FailAllError, callArgs[2]); } catch (ex) { console.error(ex); } return; }
        if (request.status != 200) { try { callArgs[1](null, request.status, callArgs[2]); } catch (ex) { console.error(ex); } return; }
        try { callArgs[1](data, 200, callArgs[2]); } catch (ex) { console.error(ex); }
    }

    // Private method
    obj.gotNextMessagesError = function (request, status, errorThrown, callArgs) {
        if (obj.FailAllError == 999) return;
        if (obj.FailAllError != 0) { try { callArgs[1](null, obj.FailAllError, callArgs[2]); } catch (ex) { console.error(ex); } return; }
        try { callArgs[1](obj, null, { Header: { HttpError: request.status } }, request.status, callArgs[2]); } catch (ex) { console.error(ex); }
    }

    /*
      * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
      * Digest Algorithm, as defined in RFC 1321.
      * Version 2.1 Copyright (C) Paul Johnston 1999 - 2002.
      * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
      * Distributed under the BSD License
      * See http://pajhome.org.uk/crypt/md5 for more info.
      */

    /*
     * Configurable variables. You may need to tweak these to be compatible with
     * the server-side, but the defaults work in most cases.
     */
    var hexcase = 0;  /* hex output format. 0 - lowercase; 1 - uppercase        */
    var b64pad = ""; /* base-64 pad character. "=" for strict RFC compliance   */
    var chrsz = 8;  /* bits per input character. 8 - ASCII; 16 - Unicode      */

    /*
     * These are the functions you'll usually want to call
     * They take string arguments and return either hex or base-64 encoded strings
     */
    function hex_md5(s) { return binl2hex(core_md5(str2binl(s), s.length * chrsz)); }
    function b64_md5(s) { return binl2b64(core_md5(str2binl(s), s.length * chrsz)); }
    function str_md5(s) { return binl2str(core_md5(str2binl(s), s.length * chrsz)); }
    function hex_hmac_md5(key, data) { return binl2hex(core_hmac_md5(key, data)); }
    function b64_hmac_md5(key, data) { return binl2b64(core_hmac_md5(key, data)); }
    function str_hmac_md5(key, data) { return binl2str(core_hmac_md5(key, data)); }

    /*
     * Perform a simple self-test to see if the VM is working
     */
    function md5_vm_test() {
        return hex_md5("abc") == "900150983cd24fb0d6963f7d28e17f72";
    }

    /*
     * Calculate the MD5 of an array of little-endian words, and a bit length
     */
    function core_md5(x, len) {
        /* append padding */
        x[len >> 5] |= 0x80 << ((len) % 32);
        x[(((len + 64) >>> 9) << 4) + 14] = len;

        var a = 1732584193;
        var b = -271733879;
        var c = -1732584194;
        var d = 271733878;

        for (var i = 0; i < x.length; i += 16) {
            var olda = a;
            var oldb = b;
            var oldc = c;
            var oldd = d;

            a = md5_ff(a, b, c, d, x[i + 0], 7, -680876936);
            d = md5_ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = md5_ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = md5_ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = md5_ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = md5_ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = md5_ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = md5_ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = md5_ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = md5_ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = md5_ff(c, d, a, b, x[i + 10], 17, -42063);
            b = md5_ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = md5_ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = md5_ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = md5_ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = md5_ff(b, c, d, a, x[i + 15], 22, 1236535329);

            a = md5_gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = md5_gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = md5_gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = md5_gg(b, c, d, a, x[i + 0], 20, -373897302);
            a = md5_gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = md5_gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = md5_gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = md5_gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = md5_gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = md5_gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = md5_gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = md5_gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = md5_gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = md5_gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = md5_gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = md5_gg(b, c, d, a, x[i + 12], 20, -1926607734);

            a = md5_hh(a, b, c, d, x[i + 5], 4, -378558);
            d = md5_hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = md5_hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = md5_hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = md5_hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = md5_hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = md5_hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = md5_hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = md5_hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = md5_hh(d, a, b, c, x[i + 0], 11, -358537222);
            c = md5_hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = md5_hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = md5_hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = md5_hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = md5_hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = md5_hh(b, c, d, a, x[i + 2], 23, -995338651);

            a = md5_ii(a, b, c, d, x[i + 0], 6, -198630844);
            d = md5_ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = md5_ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = md5_ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = md5_ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = md5_ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = md5_ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = md5_ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = md5_ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = md5_ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = md5_ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = md5_ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = md5_ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = md5_ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = md5_ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = md5_ii(b, c, d, a, x[i + 9], 21, -343485551);

            a = safe_add(a, olda);
            b = safe_add(b, oldb);
            c = safe_add(c, oldc);
            d = safe_add(d, oldd);
        }
        return Array(a, b, c, d);

    }

    /*
     * These functions implement the four basic operations the algorithm uses.
     */
    function md5_cmn(q, a, b, x, s, t) {
        return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s), b);
    }
    function md5_ff(a, b, c, d, x, s, t) {
        return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }
    function md5_gg(a, b, c, d, x, s, t) {
        return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }
    function md5_hh(a, b, c, d, x, s, t) {
        return md5_cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function md5_ii(a, b, c, d, x, s, t) {
        return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
    }

    /*
     * Calculate the HMAC-MD5, of a key and some data
     */
    function core_hmac_md5(key, data) {
        var bkey = str2binl(key);
        if (bkey.length > 16) bkey = core_md5(bkey, key.length * chrsz);

        var ipad = Array(16), opad = Array(16);
        for (var i = 0; i < 16; i++) {
            ipad[i] = bkey[i] ^ 0x36363636;
            opad[i] = bkey[i] ^ 0x5C5C5C5C;
        }

        var hash = core_md5(ipad.concat(str2binl(data)), 512 + data.length * chrsz);
        return core_md5(opad.concat(hash), 512 + 128);
    }

    /*
     * Add integers, wrapping at 2^32. This uses 16-bit operations internally
     * to work around bugs in some JS interpreters.
     */
    function safe_add(x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF);
        var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }

    /*
     * Bitwise rotate a 32-bit number to the left.
     */
    function bit_rol(num, cnt) {
        return (num << cnt) | (num >>> (32 - cnt));
    }

    /*
     * Convert a string to an array of little-endian words
     * If chrsz is ASCII, characters >255 have their hi-byte silently ignored.
     */
    function str2binl(str) {
        var bin = Array();
        var mask = (1 << chrsz) - 1;
        for (var i = 0; i < str.length * chrsz; i += chrsz)
            bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << (i % 32);
        return bin;
    }

    /*
     * Convert an array of little-endian words to a string
     */
    function binl2str(bin) {
        var str = "";
        var mask = (1 << chrsz) - 1;
        for (var i = 0; i < bin.length * 32; i += chrsz)
            str += String.fromCharCode((bin[i >> 5] >>> (i % 32)) & mask);
        return str;
    }

    /*
     * Convert an array of little-endian words to a hex string.
     */
    function binl2hex(binarray) {
        var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
        var str = "";
        for (var i = 0; i < binarray.length * 4; i++) {
            str += hex_tab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xF) +
                hex_tab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xF);
        }
        return str;
    }

    /*
     * Convert an array of little-endian words to a base-64 string
     */
    function binl2b64(binarray) {
        var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var str = "";
        for (var i = 0; i < binarray.length * 4; i += 3) {
            var triplet = (((binarray[i >> 2] >> 8 * (i % 4)) & 0xFF) << 16)
                | (((binarray[i + 1 >> 2] >> 8 * ((i + 1) % 4)) & 0xFF) << 8)
                | ((binarray[i + 2 >> 2] >> 8 * ((i + 2) % 4)) & 0xFF);
            for (var j = 0; j < 4; j++) {
                if (i * 8 + j * 6 > binarray.length * 32) str += b64pad;
                else str += tab.charAt((triplet >> 6 * (3 - j)) & 0x3F);
            }
        }
        return str;
    }
    return obj;
}

module.exports = CreateWsmanComm;