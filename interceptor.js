/** 
* @description MeshCentral Intel(R) AMT Interceptor
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.3
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
'use strict';

const crypto = require('crypto');
const common = require('./common.js');

var HttpInterceptorAuthentications = {};
//var RedirInterceptorAuthentications = {};

// Construct a HTTP interceptor object
module.exports.CreateHttpInterceptor = function (args) {
    var obj = {};

    // Create a random hex string of a given length
    obj.randomValueHex = function (len) { return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len); };

    obj.args = args;
    obj.amt = { acc: '', mode: 0, count: 0, error: false };  // mode: 0:Header, 1:LengthBody, 2:ChunkedBody, 3:UntilClose
    obj.ws = { acc: '', mode: 0, count: 0, error: false, authCNonce: obj.randomValueHex(10), authCNonceCount: 1 };
    obj.blockAmtStorage = false;

    // Private method
    obj.Debug = function (msg) { console.log(msg); };

    // Process data coming from Intel AMT
    obj.processAmtData = function (data) {
        obj.amt.acc += data.toString('binary'); // Add data to accumulator
        data = '';
        var datalen = 0;
        do { datalen = data.length; data += obj.processAmtDataEx(); } while (datalen != data.length); // Process as much data as possible
        return Buffer.from(data, 'binary');
    };

    // Process data coming from AMT in the accumulator
    obj.processAmtDataEx = function () {
        var i, r, headerend;
        if (obj.amt.mode == 0) { // Header Mode
            // Decode the HTTP header
            headerend = obj.amt.acc.indexOf('\r\n\r\n');
            if (headerend < 0) return '';
            var headerlines = obj.amt.acc.substring(0, headerend).split('\r\n');
            obj.amt.acc = obj.amt.acc.substring(headerend + 4);
            obj.amt.directive = headerlines[0].split(' ');
            var headers = headerlines.slice(1);
            obj.amt.headers = {};
            obj.amt.mode = 3; // UntilClose
            for (i in headers) {
                var j = headers[i].indexOf(':');
                if (j > 0) {
                    var v1 = headers[i].substring(0, j).trim().toLowerCase();
                    var v2 = headers[i].substring(j + 1).trim();
                    obj.amt.headers[v1] = v2;
                    if (v1.toLowerCase() == 'www-authenticate') {
                        HttpInterceptorAuthentications[obj.args.host + ':' + obj.args.port] = v2;
                    } else if (v1.toLowerCase() == 'content-length') {
                        obj.amt.count = parseInt(v2);
                        if (obj.amt.count > 0) {
                            obj.amt.mode = 1; // LengthBody
                        } else {
                            obj.amt.mode = 0; // Header
                        }
                    } else if (v1.toLowerCase() == 'transfer-encoding' && v2.toLowerCase() == 'chunked') {
                        obj.amt.mode = 2; // ChunkedBody
                    }
                }
            }

            // Reform the HTTP header
            r = obj.amt.directive.join(' ') + '\r\n';
            for (i in obj.amt.headers) { r += (i + ': ' + obj.amt.headers[i] + '\r\n'); }
            r += '\r\n';
            return r;
        } else if (obj.amt.mode == 1) { // Length Body Mode
            // Send the body of content-length size
            var rl = obj.amt.count;
            if (rl < obj.amt.acc.length) rl = obj.amt.acc.length;
            r = obj.amt.acc.substring(0, rl);
            obj.amt.acc = obj.amt.acc.substring(rl);
            obj.amt.count -= rl;
            if (obj.amt.count == 0) { obj.amt.mode = 0; }
            return r;
        } else if (obj.amt.mode == 2) { // Chunked Body Mode
            // Send data one chunk at a time
            headerend = obj.amt.acc.indexOf('\r\n');
            if (headerend < 0) return '';
            var chunksize = parseInt(obj.amt.acc.substring(0, headerend), 16);
            if ((chunksize == 0) && (obj.amt.acc.length >= headerend + 4)) {
                // Send the ending chunk (NOTE: We do not support trailing headers)
                r = obj.amt.acc.substring(0, headerend + 4);
                obj.amt.acc = obj.amt.acc.substring(headerend + 4);
                obj.amt.mode = 0;
                return r;
            } else if ((chunksize > 0) && (obj.amt.acc.length >= (headerend + 4 + chunksize))) {
                // Send a chunk
                r = obj.amt.acc.substring(0, headerend + chunksize + 4);
                obj.amt.acc = obj.amt.acc.substring(headerend + chunksize + 4);
                return r;
            }
        } else if (obj.amt.mode == 3) { // Until Close Mode
            r = obj.amt.acc;
            obj.amt.acc = '';
            return r;
        }
        return '';
    };

    // Process data coming from the Browser
    obj.processBrowserData = function (data) {
        obj.ws.acc += data.toString('binary'); // Add data to accumulator
        data = '';
        var datalen = 0;
        do { datalen = data.length; data += obj.processBrowserDataEx(); } while (datalen != data.length); // Process as much data as possible
        return Buffer.from(data, 'binary');
    };

    // Process data coming from the Browser in the accumulator
    obj.processBrowserDataEx = function () {
        var i, r, headerend;
        if (obj.ws.mode == 0) { // Header Mode
            // Decode the HTTP header
            headerend = obj.ws.acc.indexOf('\r\n\r\n');
            if (headerend < 0) return '';
            var headerlines = obj.ws.acc.substring(0, headerend).split('\r\n');
            obj.ws.acc = obj.ws.acc.substring(headerend + 4);
            obj.ws.directive = headerlines[0].split(' ');
            // If required, block access to amt-storage. This is needed when web storage is not supported on CIRA.
            if ((obj.blockAmtStorage == true) && (obj.ws.directive.length > 1) && (obj.ws.directive[1].indexOf('/amt-storage') == 0)) { obj.ws.directive[1] = obj.ws.directive[1].replace('/amt-storage', '/amt-dummy-storage'); }
            var headers = headerlines.slice(1);
            obj.ws.headers = {};
            obj.ws.mode = 3; // UntilClose
            for (i in headers) {
                var j = headers[i].indexOf(':');
                if (j > 0) {
                    var v1 = headers[i].substring(0, j).trim().toLowerCase();
                    var v2 = headers[i].substring(j + 1).trim();
                    obj.ws.headers[v1] = v2;
                    if (v1.toLowerCase() == 'www-authenticate') {
                        HttpInterceptorAuthentications[obj.args.host + ':' + obj.args.port] = v2;
                    } else if (v1.toLowerCase() == 'content-length') {
                        obj.ws.count = parseInt(v2);
                        if (obj.ws.count > 0) {
                            obj.ws.mode = 1; // LengthBody
                        } else {
                            obj.ws.mode = 0; // Header
                        }
                    } else if (v1.toLowerCase() == 'transfer-encoding' && v2.toLowerCase() == 'chunked') {
                        obj.ws.mode = 2; // ChunkedBody
                    }
                }
            }

            // Insert authentication
            if (obj.args.user && obj.args.pass && HttpInterceptorAuthentications[obj.args.host + ':' + obj.args.port]) {
                // We have authentication data, lets use it.
                var AuthArgs = obj.GetAuthArgs(HttpInterceptorAuthentications[obj.args.host + ':' + obj.args.port]);

                // If different QOP options are proposed, always use 'auth' for now.
                AuthArgs.qop = 'auth';

                // In the future, we should support auth-int, but that will required the body of the request to be accumulated and hashed.
                /*
                if (AuthArgs.qop != null) { // If Intel AMT supports auth-int, use it.
                    var qopList = AuthArgs.qop.split(',');
                    for (var i in qopList) { qopList[i] = qopList[i].trim(); }
                    if (qopList.indexOf('auth-int') >= 0) { AuthArgs.qop = 'auth-int'; } else { AuthArgs.qop = 'auth'; }
                }
                */

                var hash = obj.ComputeDigesthash(obj.args.user, obj.args.pass, AuthArgs.realm, obj.ws.directive[0], obj.ws.directive[1], AuthArgs.qop, AuthArgs.nonce, obj.ws.authCNonceCount, obj.ws.authCNonce);
                var authstr = 'Digest username="' + obj.args.user + '",realm="' + AuthArgs.realm + '",nonce="' + AuthArgs.nonce + '",uri="' + obj.ws.directive[1] + '",qop=' + AuthArgs.qop + ',nc=' + obj.ws.authCNonceCount + ',cnonce="' + obj.ws.authCNonce + '",response="' + hash + '"';
                if (AuthArgs.opaque) { authstr += (',opaque="' + AuthArgs.opaque + '"'); }
                obj.ws.headers.authorization = authstr;
                obj.ws.authCNonceCount++;
            } else {
                // We don't have authentication, clear it out of the header if needed.
                if (obj.ws.headers.authorization) { delete obj.ws.headers.authorization; }
            }

            // Reform the HTTP header
            r = obj.ws.directive.join(' ') + '\r\n';
            for (i in obj.ws.headers) { r += (i + ': ' + obj.ws.headers[i] + '\r\n'); }
            r += '\r\n';
            return r;
        } else if (obj.ws.mode == 1) { // Length Body Mode
            // Send the body of content-length size
            var rl = obj.ws.count;
            if (rl < obj.ws.acc.length) rl = obj.ws.acc.length;
            r = obj.ws.acc.substring(0, rl);
            obj.ws.acc = obj.ws.acc.substring(rl);
            obj.ws.count -= rl;
            if (obj.ws.count == 0) { obj.ws.mode = 0; }
            return r;
        } else if (obj.amt.mode == 2) { // Chunked Body Mode
            // Send data one chunk at a time
            headerend = obj.amt.acc.indexOf('\r\n');
            if (headerend < 0) return '';
            var chunksize = parseInt(obj.amt.acc.substring(0, headerend), 16);
            if (isNaN(chunksize)) { // TODO: Check this path
                // Chunk is not in this batch, move one
                r = obj.amt.acc.substring(0, headerend + 2);
                obj.amt.acc = obj.amt.acc.substring(headerend + 2);
                // Peek if we next is the end of chunked transfer
                headerend = obj.amt.acc.indexOf('\r\n');
                if (headerend > 0) {
                    chunksize = parseInt(obj.amt.acc.substring(0, headerend), 16);
                    if (chunksize == 0) { obj.amt.mode = 0; }
                }
                return r;
            } else if (chunksize == 0 && obj.amt.acc.length >= headerend + 4) {
                // Send the ending chunk (NOTE: We do not support trailing headers)
                r = obj.amt.acc.substring(0, headerend + 4);
                obj.amt.acc = obj.amt.acc.substring(headerend + 4);
                obj.amt.mode = 0;
                return r;
            } else if (chunksize > 0 && obj.amt.acc.length >= headerend + 4) {
                // Send a chunk
                r = obj.amt.acc.substring(0, headerend + chunksize + 4);
                obj.amt.acc = obj.amt.acc.substring(headerend + chunksize + 4);
                return r;
            }
        } else if (obj.ws.mode == 3) { // Until Close Mode
            r = obj.ws.acc;
            obj.ws.acc = '';
            return r;
        }
        return '';
    };

    // Parse authentication values from the HTTP header
    obj.GetAuthArgs = function (authheader) {
        var authargs = {};
        var authargsstr = authheader.substring(7).split(',');
        for (var j in authargsstr) {
            var argstr = authargsstr[j];
            var i = argstr.indexOf('=');
            var k = argstr.substring(0, i).trim().toLowerCase();
            var v = argstr.substring(i + 1).trim();
            if (v.substring(0, 1) == '\"') { v = v.substring(1, v.length - 1); }
            if (i > 0) authargs[k] = v;
        }
        return authargs;
    };

    // Compute the MD5 digest hash for a set of values
    obj.ComputeDigesthash = function (username, password, realm, method, path, qop, nonce, nc, cnonce) {
        var ha1 = crypto.createHash('md5').update(username + ':' + realm + ':' + password).digest('hex');
        var ha2 = crypto.createHash('md5').update(method + ':' + path).digest('hex');
        return crypto.createHash('md5').update(ha1 + ':' + nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2).digest('hex');
    };

    return obj;
};


// Construct a redirection interceptor object
module.exports.CreateRedirInterceptor = function (args) {
    var obj = {};

    // Create a random hex string of a given length
    obj.randomValueHex = function (len) { return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len); };

    obj.args = args;
    obj.amt = { acc: '', mode: 0, count: 0, error: false, direct: false };
    obj.ws = { acc: '', mode: 0, count: 0, error: false, direct: false, authCNonce: obj.randomValueHex(10), authCNonceCount: 1 };

    obj.RedirectCommands = { StartRedirectionSession: 0x10, StartRedirectionSessionReply: 0x11, EndRedirectionSession: 0x12, AuthenticateSession: 0x13, AuthenticateSessionReply: 0x14 };
    obj.StartRedirectionSessionReplyStatus = { SUCCESS: 0, TYPE_UNKNOWN: 1, BUSY: 2, UNSUPPORTED: 3, ERROR: 0xFF };
    obj.AuthenticationStatus = { SUCCESS: 0, FALIURE: 1, NOTSUPPORTED: 2 };
    obj.AuthenticationType = { QUERY: 0, USERPASS: 1, KERBEROS: 2, BADDIGEST: 3, DIGEST: 4 };

    // Private method
    obj.Debug = function (msg) { console.log(msg); };

    // Process data coming from Intel AMT
    obj.processAmtData = function (data) {
        if ((obj.amt.direct == true) && (obj.amt.acc == '')) { return data; } // Interceptor fast path
        obj.amt.acc += data.toString('binary'); // Add data to accumulator
        data = '';
        var datalen = 0;
        do { datalen = data.length; data += obj.processAmtDataEx(); } while (datalen != data.length); // Process as much data as possible
        return Buffer.from(data, 'binary');
    };

    // Process data coming from AMT in the accumulator
    obj.processAmtDataEx = function () {
        var r;
        if (obj.amt.acc.length == 0) return '';
        if (obj.amt.direct == true) {
            var data = obj.amt.acc;
            obj.amt.acc = '';
            return data;
        } else {
            //console.log(obj.amt.acc.charCodeAt(0));
            switch (obj.amt.acc.charCodeAt(0)) {
                case obj.RedirectCommands.StartRedirectionSessionReply: {
                    if (obj.amt.acc.length < 4) return '';
                    if (obj.amt.acc.charCodeAt(1) == obj.StartRedirectionSessionReplyStatus.SUCCESS) {
                        if (obj.amt.acc.length < 13) return '';
                        var oemlen = obj.amt.acc.charCodeAt(12);
                        if (obj.amt.acc.length < 13 + oemlen) return '';
                        r = obj.amt.acc.substring(0, 13 + oemlen);
                        obj.amt.acc = obj.amt.acc.substring(13 + oemlen);
                        return r;
                    }
                    break;
                }
                case obj.RedirectCommands.AuthenticateSessionReply: {
                    if (obj.amt.acc.length < 9) return '';
                    var l = common.ReadIntX(obj.amt.acc, 5);
                    if (obj.amt.acc.length < 9 + l) return '';
                    var authstatus = obj.amt.acc.charCodeAt(1);
                    var authType = obj.amt.acc.charCodeAt(4);

                    if ((authType == obj.AuthenticationType.DIGEST) && (authstatus == obj.AuthenticationStatus.FALIURE)) {
                        // Grab and keep all authentication parameters
                        var realmlen = obj.amt.acc.charCodeAt(9);
                        obj.amt.digestRealm = obj.amt.acc.substring(10, 10 + realmlen);
                        var noncelen = obj.amt.acc.charCodeAt(10 + realmlen);
                        obj.amt.digestNonce = obj.amt.acc.substring(11 + realmlen, 11 + realmlen + noncelen);
                        var qoplen = obj.amt.acc.charCodeAt(11 + realmlen + noncelen);
                        obj.amt.digestQOP = obj.amt.acc.substring(12 + realmlen + noncelen, 12 + realmlen + noncelen + qoplen);
                    }
                    else if (authType != obj.AuthenticationType.QUERY && authstatus == obj.AuthenticationStatus.SUCCESS) {
                        // Intel AMT relayed that authentication was successful, go to direct relay mode in both directions.
                        obj.ws.direct = true;
                        obj.amt.direct = true;
                    }

                    r = obj.amt.acc.substring(0, 9 + l);
                    obj.amt.acc = obj.amt.acc.substring(9 + l);
                    return r;
                }
                default: {
                    obj.amt.error = true;
                    return '';
                }
            }
        }
        return '';
    };

    // Process data coming from the Browser
    obj.processBrowserData = function (data) {
        if ((obj.ws.direct == true) && (obj.ws.acc == '')) { return data; } // Interceptor fast path
        obj.ws.acc += data.toString('binary'); // Add data to accumulator
        data = '';
        var datalen = 0;
        do { datalen = data.length; data += obj.processBrowserDataEx(); } while (datalen != data.length); // Process as much data as possible
        return Buffer.from(data, 'binary');
    };

    // Process data coming from the Browser in the accumulator
    obj.processBrowserDataEx = function () {
        var r;
        if (obj.ws.acc.length == 0) return '';
        if (obj.ws.direct == true) {
            var data = obj.ws.acc;
            obj.ws.acc = '';
            return data;
        } else {
            switch (obj.ws.acc.charCodeAt(0)) {
                case obj.RedirectCommands.StartRedirectionSession: {
                    if (obj.ws.acc.length < 8) return '';
                    r = obj.ws.acc.substring(0, 8);
                    obj.ws.acc = obj.ws.acc.substring(8);
                    return r;
                }
                case obj.RedirectCommands.EndRedirectionSession: {
                    if (obj.ws.acc.length < 4) return '';
                    r = obj.ws.acc.substring(0, 4);
                    obj.ws.acc = obj.ws.acc.substring(4);
                    return r;
                }
                case obj.RedirectCommands.AuthenticateSession: {
                    if (obj.ws.acc.length < 9) return '';
                    var l = common.ReadIntX(obj.ws.acc, 5);
                    if (obj.ws.acc.length < 9 + l) return '';

                    var authType = obj.ws.acc.charCodeAt(4);
                    if (authType == obj.AuthenticationType.DIGEST && obj.args.user && obj.args.pass) {
                        var authurl = '/RedirectionService';
                        if (obj.amt.digestRealm) {
                            // Replace this authentication digest with a server created one
                            // We have everything we need to authenticate
                            var nc = '0'+ (10000000 + obj.ws.authCNonceCount).toString().substring(1);// set NC at least 8 bytes
                            obj.ws.authCNonceCount++;
                            var digest = obj.ComputeDigesthash(obj.args.user, obj.args.pass, obj.amt.digestRealm, 'POST', authurl, obj.amt.digestQOP, obj.amt.digestNonce, nc, obj.ws.authCNonce);

                            // Replace this authentication digest with a server created one
                            // We have everything we need to authenticate
                            r = String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x04);
                            r += common.IntToStrX(obj.args.user.length + obj.amt.digestRealm.length + obj.amt.digestNonce.length + authurl.length + obj.ws.authCNonce.length + nc.toString().length + digest.length + obj.amt.digestQOP.length + 8);
                            r += String.fromCharCode(obj.args.user.length);         // Username Length
                            r += obj.args.user;                                     // Username
                            r += String.fromCharCode(obj.amt.digestRealm.length);   // Realm Length
                            r += obj.amt.digestRealm;                               // Realm
                            r += String.fromCharCode(obj.amt.digestNonce.length);   // Nonce Length
                            r += obj.amt.digestNonce;                               // Nonce
                            r += String.fromCharCode(authurl.length);               // Authentication URL "/RedirectionService" Length
                            r += authurl;                                           // Authentication URL
                            r += String.fromCharCode(obj.ws.authCNonce.length);     // CNonce Length
                            r += obj.ws.authCNonce;                                 // CNonce
                            r += String.fromCharCode(nc.toString().length);         // NonceCount Length
                            r += nc.toString();                                     // NonceCount
                            r += String.fromCharCode(digest.length);                // Response Length
                            r += digest;                                            // Response
                            r += String.fromCharCode(obj.amt.digestQOP.length);     // QOP Length
                            r += obj.amt.digestQOP;                                 // QOP

                            obj.ws.acc = obj.ws.acc.substring(9 + l); // Don't relay the original message
                            return r;
                        } else {
                            // Replace this authentication digest with a server created one
                            // Since we don't have authentication parameters, fill them in with blanks to get an error back what that info.
                            r = String.fromCharCode(0x13, 0x00, 0x00, 0x00, 0x04);
                            r += common.IntToStrX(obj.args.user.length + authurl.length + 8);
                            r += String.fromCharCode(obj.args.user.length);
                            r += obj.args.user;
                            r += String.fromCharCode(0x00, 0x00, authurl.length);
                            r += authurl;
                            r += String.fromCharCode(0x00, 0x00, 0x00, 0x00);
                            obj.ws.acc = obj.ws.acc.substring(9 + l); // Don't relay the original message
                            return r;
                        }
                    }

                    r = obj.ws.acc.substring(0, 9 + l);
                    obj.ws.acc = obj.ws.acc.substring(9 + l);
                    return r;
                }
                default: {
                    obj.ws.error = true;
                }
            }
        }
        return '';
    };

    // Compute the MD5 digest hash for a set of values
    obj.ComputeDigesthash = function (username, password, realm, method, path, qop, nonce, nc, cnonce) {
        var ha1 = crypto.createHash('md5').update(username + ':' + realm + ':' + password).digest('hex');
        var ha2 = crypto.createHash('md5').update(method + ':' + path).digest('hex');
        return crypto.createHash('md5').update(ha1 + ':' + nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2).digest('hex');
    };

    return obj;
};