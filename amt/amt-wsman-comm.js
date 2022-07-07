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

@description Intel AMT WSMAN communication module for NodeJS
@author Ylian Saint-Hilaire
@version v0.3.0
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a WSMAN stack communication object
var CreateWsmanComm = function (host, port, user, pass, tls, tlsoptions, mpsConnection) {
    //console.log('CreateWsmanComm', host, port, user, pass, tls, tlsoptions);

    var obj = {};    
    obj.PendingAjax = [];               // List of pending AJAX calls. When one frees up, another will start.
    obj.ActiveAjaxCount = 0;            // Number of currently active AJAX calls
    obj.MaxActiveAjaxCount = 1;         // Maximum number of activate AJAX calls at the same time.
    obj.FailAllError = 0;               // Set this to non-zero to fail all AJAX calls with that error status, 999 causes responses to be silent.
    obj.challengeParams = null;
    obj.noncecounter = 1;
    obj.authcounter = 0;

    obj.net = require('net');
    obj.tls = require('tls');
    obj.crypto = require('crypto');
    obj.constants = require('constants');
    obj.socket = null;
    obj.socketState = 0;
    obj.kerberosDone = 0;
    obj.amtVersion = null;

    obj.Address = '/wsman';
    obj.cnonce = obj.crypto.randomBytes(16).toString('hex'); // Generate a random client nonce

    obj.host = host;
    obj.port = port;
    obj.user = user;
    obj.pass = pass;
    obj.xtls = tls;
    obj.xtlsoptions = tlsoptions;
    obj.mpsConnection = mpsConnection; // Link to a MPS connection, this can be CIRA, Relay or LMS. If null, local sockets are used as transport.
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

    // Used to add TLS to a steam
    function SerialTunnel(options) {
        var obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { try { this.push(chunk); } catch (ex) { } };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        return obj;
    }

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
        if (!postdata) postdata = '';
        //obj.Debug('SEND: ' + postdata); // DEBUG

        obj.ActiveAjaxCount++;
        return obj.PerformAjaxExNodeJS(postdata, callback, tag, url, action);
    }

    // NODE.js specific private method
    obj.pendingAjaxCall = [];

    // NODE.js specific private method
    obj.PerformAjaxExNodeJS = function (postdata, callback, tag, url, action) { obj.PerformAjaxExNodeJS2(postdata, callback, tag, url, action, 5); }

    // NODE.js specific private method
    obj.PerformAjaxExNodeJS2 = function (postdata, callback, tag, url, action, retry) {
        if ((retry <= 0) || (obj.FailAllError != 0)) {
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
        url = url ? url : '/wsman';
        action = action ? action : 'POST';
        var h = action + ' ' + url + ' HTTP/1.1\r\n';
        if (obj.challengeParams != null) {
            obj.digestRealm = obj.challengeParams['realm'];
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
            var response = hex_md5(hex_md5(obj.user + ':' + obj.challengeParams['realm'] + ':' + obj.pass) + ':' + obj.challengeParams['nonce'] + ':' + nonceHex(obj.noncecounter) + ':' + obj.cnonce + ':' + obj.challengeParams['qop'] + ':' + hex_md5(action + ':' + url + ((obj.challengeParams['qop'] == 'auth-int') ? (':' + hex_md5(postdata)) : '')));
            h += 'Authorization: ' + obj.renderDigest({ 'username': obj.user, 'realm': obj.challengeParams['realm'], 'nonce': obj.challengeParams['nonce'], 'uri': url, 'qop': obj.challengeParams['qop'], 'response': response, 'nc': nonceHex(obj.noncecounter++), 'cnonce': obj.cnonce }) + '\r\n';
        }
        h += 'Host: ' + obj.host + ':' + obj.port + '\r\nContent-Length: ' + postdata.length + '\r\n\r\n' + postdata; // Use Content-Length
        //h += 'Host: ' + obj.host + ':' + obj.port + '\r\nTransfer-Encoding: chunked\r\n\r\n' + postdata.length.toString(16).toUpperCase() + '\r\n' + postdata + '\r\n0\r\n\r\n'; // Use Chunked-Encoding
        obj.xxSend(h);
        //console.log('SEND: ' + h); // Display send packet
    }

    // Parse the HTTP digest header and return a list of key & values.
    obj.parseDigest = function (header) { return correctedQuoteSplit(header.substring(7)).reduce(function (obj, s) { var parts = s.trim().split('='); obj[parts[0]] = parts[1].replace(new RegExp('\"', 'g'), ''); return obj; }, {}) }

    // Split a string on quotes but do not do it when in quotes
    function correctedQuoteSplit(str) { return str.split(',').reduce(function (a, c) { if (a.ic) { a.st[a.st.length - 1] += ',' + c } else { a.st.push(c) } if (c.split('"').length % 2 == 0) { a.ic = !a.ic } return a; }, { st: [], ic: false }).st }
    function nonceHex(v) { var s = ('00000000' + v.toString(16)); return s.substring(s.length - 8); }

    // NODE.js specific private method
    obj.renderDigest = function (params) {
        var paramsnames = [];
        for (var i in params) { paramsnames.push(i); }
        return 'Digest ' + paramsnames.reduce(function (s1, ii) { return s1 + ',' + (((ii == 'nc') || (ii == 'qop')) ? (ii + '=' + params[ii]) : (ii + '="' + params[ii] + '"')); }, '').substring(1);
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

        if (obj.mpsConnection != null) {
            if (obj.xtls != 1) {
                // Setup a new channel using the CIRA/Relay/LMS connection
                obj.socket = obj.mpsConnection.SetupChannel(obj.port);
                if (obj.socket == null) { obj.xxOnSocketClosed(); return; }

                // Connect without TLS
                obj.socket.onData = function (ccon, data) { obj.xxOnSocketData(data); }
                obj.socket.onStateChange = function (ccon, state) {
                    if (state == 0) {
                        // Channel closed
                        obj.socketParseState = 0;
                        obj.socketAccumulator = '';
                        obj.socketHeader = null;
                        obj.socketData = '';
                        obj.socketState = 0;
                        obj.xxOnSocketClosed();
                    } else if (state == 2) {
                        // Channel open success
                        obj.xxOnSocketConnected();
                    }
                }
            } else {
                // Setup a new channel using the CIRA/Relay/LMS connection
                obj.cirasocket = obj.mpsConnection.SetupChannel(obj.port);
                if (obj.cirasocket == null) { obj.xxOnSocketClosed(); return; }

                // Connect with TLS
                var ser = new SerialTunnel();

                // let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                ser.forwardwrite = function (msg) { try { obj.cirasocket.write(msg); } catch (ex) { } }; // TLS ---> CIRA

                // When APF tunnel return something, update SerialTunnel buffer
                obj.cirasocket.onData = function (ciraconn, data) { if (data.length > 0) { try { ser.updateBuffer(Buffer.from(data, 'binary')); } catch (e) { } } }; // CIRA ---> TLS

                // Handle CIRA tunnel state change
                obj.cirasocket.onStateChange = function (ciraconn, state) {
                    if (state == 0) { obj.xxOnSocketClosed(); }
                    if (state == 2) {
                        // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                        var options = { socket: ser, ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                        if (obj.xtlsMethod == 1) { options.secureProtocol = 'TLSv1_method'; }
                        if (obj.xtlsoptions) {
                            if (obj.xtlsoptions.ca) { options.ca = obj.xtlsoptions.ca; }
                            if (obj.xtlsoptions.cert) { options.cert = obj.xtlsoptions.cert; }
                            if (obj.xtlsoptions.key) { options.key = obj.xtlsoptions.key; }
                        }
                        
                        obj.socket = obj.tls.connect(obj.port, obj.host, options, obj.xxOnSocketConnected);
                        obj.socket.setEncoding('binary');
                        obj.socket.setTimeout(60000); // Set socket idle timeout
                        obj.socket.on('error', function (ex) { obj.xtlsMethod = 1 - obj.xtlsMethod; });
                        obj.socket.on('close', obj.xxOnSocketClosed);
                        obj.socket.on('timeout', obj.destroy);

                        // Decrypted tunnel from TLS communcation to be forwarded to websocket
                        obj.socket.on('data', function (data) { try { obj.xxOnSocketData(data.toString('binary')); } catch (e) { } }); // AMT/TLS ---> WS

                        // If TLS is on, forward it through TLSSocket
                        obj.forwardclient = obj.socket;
                        obj.forwardclient.xtls = 1;
                    }
                };
            }
        } else {
            // Direct connection
            if (obj.xtls != 1) {
                // Direct connect without TLS
                obj.socket = new obj.net.Socket();
                obj.socket.setEncoding('binary');
                obj.socket.setTimeout(60000); // Set socket idle timeout
                obj.socket.on('data', obj.xxOnSocketData);
                obj.socket.on('close', obj.xxOnSocketClosed);
                obj.socket.on('timeout', obj.destroy);
                obj.socket.on('error', obj.xxOnSocketClosed);
                obj.socket.connect(obj.port, obj.host, obj.xxOnSocketConnected);
            } else {
                // Direct connect with TLS
                var options = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                if (obj.xtlsMethod != 0) { options.secureProtocol = 'TLSv1_method'; }
                if (obj.xtlsoptions) {
                    if (obj.xtlsoptions.ca) { options.ca = obj.xtlsoptions.ca; }
                    if (obj.xtlsoptions.cert) { options.cert = obj.xtlsoptions.cert; }
                    if (obj.xtlsoptions.key) { options.key = obj.xtlsoptions.key; }
                }
                obj.socket = obj.tls.connect(obj.port, obj.host, options, obj.xxOnSocketConnected);
                obj.socket.setEncoding('binary');
                obj.socket.setTimeout(60000); // Set socket idle timeout
                obj.socket.on('data', obj.xxOnSocketData);
                obj.socket.on('close', obj.xxOnSocketClosed);
                obj.socket.on('timeout', obj.destroy);
                obj.socket.on('error', function (ex) { if (ex.message && ex.message.indexOf('sslv3 alert bad record mac') >= 0) { obj.xtlsMethod = 1 - obj.xtlsMethod; } });
            }
            obj.socket.setNoDelay(true); // Disable nagle. We will encode each WSMAN request as a single send block and want to send it at once. This may help Intel AMT handle pipelining?
        }
    }

    // Get the certificate of Intel AMT
    obj.getPeerCertificate = function () { if (obj.xtls == 1) { return obj.socket.getPeerCertificate(); } return null; }
    obj.getPeerCertificateFingerprint = function () { if (obj.xtls == 1) { return obj.socket.getPeerCertificate().fingerprint.split(':').join('').toLowerCase(); } return null; }

    // Check if the certificate matched the certificate hash.
    function checkCertHash(cert, hash) {
        // Check not required
        if (hash == 0) return true;

        // SHA1 compare
        if (cert.fingerprint.split(':').join('').toLowerCase() == hash) return true;

        // SHA256 compare
        if ((hash.length == 64) && (obj.crypto.createHash('sha256').update(cert.raw).digest('hex') == hash)) { return true; }

        // SHA384 compare
        if ((hash.length == 96) && (obj.crypto.createHash('sha384').update(cert.raw).digest('hex') == hash)) { return true; }

        return false;
    }

    // NODE.js specific private method
    obj.xxOnSocketConnected = function () {
        if (obj.socket == null) return;
        // check TLS certificate for webrelay and direct only
        if (obj.xtls == 1) {
            obj.xtlsCertificate = obj.socket.getPeerCertificate();

            // Setup the forge certificate check
            var camatch = 0;
            if ((obj.xtlsoptions != null) && (obj.xtlsoptions.ca != null)) {
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
            if ((camatch == 0) && (checkCertHash(obj.xtlsCertificate, obj.xtlsFingerprint) == false)) {
                obj.FailAllError = 998; // Cause all new responses to be silent. 998 = TLS Certificate check error
                obj.CancelAllQueries(998);
                return;
            }
            if ((obj.xtlsFingerprint == 0) && (camatch == 0)) { obj.xtlsCheck = 3; } else { obj.xtlsCheck = (camatch == 0) ? 2 : 1; }
        } else { obj.xtlsCheck = 0; }
        obj.socketState = 2;
        obj.socketParseState = 0;
        for (i in obj.pendingAjaxCall) { obj.sendRequest(obj.pendingAjaxCall[i][0], obj.pendingAjaxCall[i][3], obj.pendingAjaxCall[i][4]); }
    }

    // NODE.js specific private method
    obj.xxOnSocketData = function (data) {
        //console.log('RECV: ' + data);
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
                var headersize = obj.socketAccumulator.indexOf('\r\n\r\n');
                if (headersize < 0) return;
                //obj.Debug("Header: "+obj.socketAccumulator.substring(0, headersize)); // Display received HTTP header
                obj.socketHeader = obj.socketAccumulator.substring(0, headersize).split('\r\n');
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
                if ((obj.socketXHeader['connection'] != undefined) && (obj.socketXHeader['connection'].toLowerCase() == 'close') && ((obj.socketXHeader["transfer-encoding"] == undefined) || (obj.socketXHeader["transfer-encoding"].toLowerCase() != 'chunked'))) {
                    // The body ends with a close, in this case, we will only process the header
                    csize = 0;
                } else if (obj.socketXHeader['content-length'] != undefined) {
                    // The body length is specified by the content-length
                    csize = parseInt(obj.socketXHeader['content-length']);
                    if (obj.socketAccumulator.length < csize) return;
                    var data = obj.socketAccumulator.substring(0, csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(csize);
                    obj.socketData = data;
                    csize = 0;
                } else {
                    // The body is chunked
                    var clen = obj.socketAccumulator.indexOf('\r\n');
                    if (clen < 0) return; // Chunk length not found, exit now and get more data.
                    // Chunk length if found, lets see if we can get the data.
                    csize = parseInt(obj.socketAccumulator.substring(0, clen), 16);
                    if (obj.socketAccumulator.length < clen + 2 + csize + 2) return;
                    // We got a chunk with all of the data, handle the chunck now.
                    var data = obj.socketAccumulator.substring(clen + 2, clen + 2 + csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(clen + 2 + csize + 2);
                    try { obj.socketData += data; } catch (ex) { console.log(ex, typeof data, data.length); }
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
            if (obj.challengeParams['qop'] != null) {
                var qopList = obj.challengeParams['qop'].split(',');
                for (var i in qopList) { qopList[i] = qopList[i].trim(); }
                if (qopList.indexOf('auth-int') >= 0) { obj.challengeParams['qop'] = 'auth-int'; } else { obj.challengeParams['qop'] = 'auth'; }
            }
            if (obj.mpsConnection == null) { obj.socket.end(); } else { obj.socket.close(); }
        } else {
            var r = obj.pendingAjaxCall.shift();
            if ((r == null) || (r.length < 1)) { /*console.log("pendingAjaxCall error, " + r);*/ return; } // Get a response without any pending requests.
            //if (s != 200) { obj.Debug("Error, status=" + s + "\r\n\r\nreq=" + r[0] + "\r\n\r\nresp=" + data); } // Debug: Display the request & response if something did not work.
            obj.authcounter = 0;
            obj.ActiveAjaxCount--;
            obj.gotNextMessages(data, 'success', { status: s }, r);
            obj.PerformNextAjax();
        }
    }

    // NODE.js specific private method
    obj.xxOnSocketClosed = function () {
        //obj.Debug("xxOnSocketClosed");
        obj.socketState = 0;
        if (obj.socket != null) {
            if (obj.socket.removeAllListeners) {
                // Do not remove the error handler since it may still get triggered.
                obj.socket.removeAllListeners('data');
                obj.socket.removeAllListeners('close');
                obj.socket.removeAllListeners('timeout');
            }
            try {
                if (obj.mpsConnection == null) {
                    obj.socket.destroy();
                } else {
                    if (obj.cirasocket != null) { obj.cirasocket.close(); } else { obj.socket.close(); } 
                }
            } catch (ex) { }
            obj.socket = null;
            obj.cirasocket = null;
        }
        if (obj.pendingAjaxCall.length > 0) {
            var r = obj.pendingAjaxCall.shift(), retry = r[5];
            setTimeout(function () { obj.PerformAjaxExNodeJS2(r[0], r[1], r[2], r[3], r[4], --retry) }, 500); // Wait half a second and try again
        }
    }

    obj.destroy = function () {
        if (obj.socket != null) {
            if (obj.socket.removeAllListeners) {
                // Do not remove the error handler since it may still get triggered.
                obj.socket.removeAllListeners('data');
                obj.socket.removeAllListeners('close');
                obj.socket.removeAllListeners('timeout');
            }
            try {
                if (obj.mpsConnection == null) {
                    obj.socket.destroy();
                } else {
                    if (obj.cirasocket != null) { obj.cirasocket.close(); } else { obj.socket.close(); }
                }
            } catch (ex) { }
            delete obj.socket;
            delete obj.cirasocket;
            obj.socketState = 0;
        }
    }

    // NODE.js specific private method
    obj.xxSend = function (x) {
        //console.log('xxSend', x);
        if (obj.socketState == 2) { obj.socket.write(Buffer.from(x, 'binary')); }
    }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function (s) {
        obj.FailAllError = s;
        while (obj.PendingAjax.length > 0) { var x = obj.PendingAjax.shift(); x[1](null, s, x[2]); }
        obj.destroy();
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

    // MD5 digest hash
    function hex_md5(str) { return obj.crypto.createHash('md5').update(str).digest('hex'); }

    return obj;
}

module.exports = CreateWsmanComm;