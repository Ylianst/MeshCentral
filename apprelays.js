/**
* @description MeshCentral MSTSC & SSH relay
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

/*
Protocol numbers
10 = RDP
11 = SSH-TERM
12 = VNC
13 = SSH-FILES
14 = Web-TCP
*/

// Protocol Numbers
const PROTOCOL_TERMINAL = 1;
const PROTOCOL_DESKTOP = 2;
const PROTOCOL_FILES = 5;
const PROTOCOL_AMTWSMAN = 100;
const PROTOCOL_AMTREDIR = 101;
const PROTOCOL_MESSENGER = 200;
const PROTOCOL_WEBRDP = 201;
const PROTOCOL_WEBSSH = 202;
const PROTOCOL_WEBSFTP = 203;
const PROTOCOL_WEBVNC = 204;

// Mesh Rights
const MESHRIGHT_EDITMESH            = 0x00000001; // 1
const MESHRIGHT_MANAGEUSERS         = 0x00000002; // 2
const MESHRIGHT_MANAGECOMPUTERS     = 0x00000004; // 4
const MESHRIGHT_REMOTECONTROL       = 0x00000008; // 8
const MESHRIGHT_AGENTCONSOLE        = 0x00000010; // 16
const MESHRIGHT_SERVERFILES         = 0x00000020; // 32
const MESHRIGHT_WAKEDEVICE          = 0x00000040; // 64
const MESHRIGHT_SETNOTES            = 0x00000080; // 128
const MESHRIGHT_REMOTEVIEWONLY      = 0x00000100; // 256
const MESHRIGHT_NOTERMINAL          = 0x00000200; // 512
const MESHRIGHT_NOFILES             = 0x00000400; // 1024
const MESHRIGHT_NOAMT               = 0x00000800; // 2048
const MESHRIGHT_DESKLIMITEDINPUT    = 0x00001000; // 4096
const MESHRIGHT_LIMITEVENTS         = 0x00002000; // 8192
const MESHRIGHT_CHATNOTIFY          = 0x00004000; // 16384
const MESHRIGHT_UNINSTALL           = 0x00008000; // 32768
const MESHRIGHT_NODESKTOP           = 0x00010000; // 65536
const MESHRIGHT_REMOTECOMMAND       = 0x00020000; // 131072
const MESHRIGHT_RESETOFF            = 0x00040000; // 262144
const MESHRIGHT_GUESTSHARING        = 0x00080000; // 524288
const MESHRIGHT_DEVICEDETAILS       = 0x00100000; // 1048576
const MESHRIGHT_RELAY               = 0x00200000; // 2097152
const MESHRIGHT_ADMIN               = 0xFFFFFFFF;

// SerialTunnel object is used to embed TLS within another connection.
function SerialTunnel(options) {
    var obj = new require('stream').Duplex(options);
    obj.forwardwrite = null;
    obj.updateBuffer = function (chunk) { this.push(chunk); };
    obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); }; // Pass data written to forward
    obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
    return obj;
}

// Construct a Web relay object
module.exports.CreateWebRelaySession = function (parent, db, req, args, domain, userid, nodeid, addr, port, appid, sessionid, expire, mtype) {
    const obj = {};
    obj.parent = parent;
    obj.lastOperation = Date.now();
    obj.domain = domain;
    obj.userid = userid;
    obj.nodeid = nodeid;
    obj.addr = addr;
    obj.port = port;
    obj.appid = appid;
    obj.sessionid = sessionid;
    obj.expireTimer = null;
    obj.mtype = mtype;
    var pendingRequests = [];
    var nextTunnelId = 1;
    var tunnels = {};
    var errorCount = 0; // If we keep closing tunnels without processing requests, fail the requests

    parent.parent.debug('webrelay', 'CreateWebRelaySession, userid:' + userid + ', addr:' + addr + ', port:' + port);

    // Any HTTP cookie set by the device is going to be shared between all tunnels to that device.
    obj.webCookies = {};

    // Setup an expire time if needed
    if (expire != null) {
        var timeout = (expire - Date.now());
        if (timeout < 10) { timeout = 10; }
        parent.parent.debug('webrelay', 'timeout set to ' + Math.floor(timeout / 1000) + ' second(s).');
        obj.expireTimer = setTimeout(function () { parent.parent.debug('webrelay', 'timeout'); close(); }, timeout);
    }
    
    // Events
    obj.closed = false;
    obj.onclose = null;

    // Check if any tunnels need to be cleaned up
    obj.checkTimeout = function () {
        const limit = Date.now() - (1 * 60 * 1000); // This is is 5 minutes before current time

        // Close any old non-websocket tunnels
        const tunnelToRemove = [];
        for (var i in tunnels) { if ((tunnels[i].lastOperation < limit) && (tunnels[i].isWebSocket !== true)) { tunnelToRemove.push(tunnels[i]); } }
        for (var i in tunnelToRemove) { tunnelToRemove[i].close(); }

        // Close this session if no longer used
        if (obj.lastOperation < limit) {
            var count = 0;
            for (var i in tunnels) { count++; }
            if (count == 0) { close(); } // Time limit reached and no tunnels, clean up.
        }
    }

    // Handle new HTTP request
    obj.handleRequest = function (req, res) {
        parent.parent.debug('webrelay', 'handleRequest, url:' + req.url);
        pendingRequests.push([req, res, false]);
        handleNextRequest();
    }

    // Handle new websocket request
    obj.handleWebSocket = function (ws, req) {
        parent.parent.debug('webrelay', 'handleWebSocket, url:' + req.url);
        pendingRequests.push([req, ws, true]);
        handleNextRequest();
    }

    // Handle request
    function handleNextRequest() {
        if (obj.closed == true) return;

        // if there are not pending requests, do nothing
        if (pendingRequests.length == 0) return;

        // If the errorCount is high, something is really wrong, we are opening lots of tunnels and not processing any requests.
        if (errorCount > 5) { close(); return; }

        // Check to see if any of the tunnels are free
        var count = 0;
        for (var i in tunnels) {
            count += ((tunnels[i].isWebSocket || tunnels[i].isStreaming) ? 0 : 1);
            if ((tunnels[i].relayActive == true) && (tunnels[i].res == null) && (tunnels[i].isWebSocket == false) && (tunnels[i].isStreaming == false)) {
                // Found a free tunnel, use it
                const x = pendingRequests.shift();
                if (x[2] == true) { tunnels[i].processWebSocket(x[0], x[1]); } else { tunnels[i].processRequest(x[0], x[1]); }
                return;
            }
        }
        
        if (count > 0) return;
        launchNewTunnel();
    }

    function launchNewTunnel() {
        // Launch a new tunnel
        if (obj.closed == true) return;
        parent.parent.debug('webrelay', 'launchNewTunnel');
        const tunnel = module.exports.CreateWebRelay(obj, db, args, domain, obj.mtype);
        tunnel.onclose = function (tunnelId, processedCount) {
            if (tunnels == null) return;
            parent.parent.debug('webrelay', 'tunnel-onclose');
            if (processedCount == 0) { errorCount++; } // If this tunnel closed without processing any requests, mark this as an error
            delete tunnels[tunnelId];
            handleNextRequest();
        }
        tunnel.onconnect = function (tunnelId) {
            if (tunnels == null) return;
            parent.parent.debug('webrelay', 'tunnel-onconnect');
            if (pendingRequests.length > 0) {
                const x = pendingRequests.shift();
                if (x[2] == true) { tunnels[tunnelId].processWebSocket(x[0], x[1]); } else { tunnels[tunnelId].processRequest(x[0], x[1]); }
            }
        }
        tunnel.oncompleted = function (tunnelId, closed) {
            if (tunnels == null) return;
            if (closed === true) {
                parent.parent.debug('webrelay', 'tunnel-oncompleted and closed');
            } else {
                parent.parent.debug('webrelay', 'tunnel-oncompleted');
            }
            if (closed !== true) {
                errorCount = 0; // Something got completed, clear any error count
                if (pendingRequests.length > 0) {
                    const x = pendingRequests.shift();
                    if (x[2] == true) { tunnels[tunnelId].processWebSocket(x[0], x[1]); } else { tunnels[tunnelId].processRequest(x[0], x[1]); }
                }
            }
        }
        tunnel.onNextRequest = function () {
            if (tunnels == null) return;
            parent.parent.debug('webrelay', 'tunnel-onNextRequest');
            handleNextRequest();
        }
        tunnel.connect(userid, nodeid, addr, port, appid);
        tunnel.tunnelId = nextTunnelId++;
        tunnels[tunnel.tunnelId] = tunnel;
    }

    // Close all tunnels
    obj.close = function () { close(); }

    // Close all tunnels
    function close() {
        // Set the session as closed
        if (obj.closed == true) return;
        parent.parent.debug('webrelay', 'tunnel-close');
        obj.closed = true;

        // Clear the time if present
        if (obj.expireTimer != null) { clearTimeout(obj.expireTimer); delete obj.expireTimer; }

        // Close all tunnels
        for (var i in tunnels) { tunnels[i].close(); }
        tunnels = null;

        // Close any pending requests
        for (var i in pendingRequests) { if (pendingRequests[i][2] == true) { pendingRequests[i][1].close(); } else { pendingRequests[i][1].end(); } }

        // Notify of session closure
        if (obj.onclose) { obj.onclose(obj.sessionid); }

        // Cleanup
        delete obj.userid;
        delete obj.lastOperation;
    }

    return obj;
}


// Construct a Web relay object
module.exports.CreateWebRelay = function (parent, db, args, domain, mtype) {
    //const Net = require('net');
    const WebSocket = require('ws')

    const obj = {};
    obj.lastOperation = Date.now();
    obj.relayActive = false;
    obj.closed = false;
    obj.isWebSocket = false; // If true, this request will not close and so, it can't be allowed to hold up other requests
    obj.isStreaming = false; // If true, this request will not close and so, it can't be allowed to hold up other requests
    obj.processedRequestCount = 0;
    obj.mtype = mtype;
    const constants = (require('crypto').constants ? require('crypto').constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Events
    obj.onclose = null;
    obj.oncompleted = null;
    obj.onconnect = null;
    obj.onNextRequest = null;

    // Called when we need to close the tunnel because the response stream has closed
    function handleResponseClosure() { obj.close(); }

    // Return cookie name and values
    function parseRequestCookies(cookiesString) {
        var r = {};
        if (typeof cookiesString != 'string') return r;
        var cookieString = cookiesString.split('; ');
        for (var i in cookieString) { var j = cookieString[i].indexOf('='); if (j > 0) { r[cookieString[i].substring(0, j)] = cookieString[i].substring(j + 1); } }
        return r;
    }

    // Process a HTTP request
    obj.processRequest = function (req, res) {
        if (obj.relayActive == false) { console.log("ERROR: Attempt to use an unconnected tunnel"); return false; }
        parent.lastOperation = obj.lastOperation = Date.now();

        // Check if this is a websocket
        if (req.headers['upgrade'] == 'websocket') { console.log('Attempt to process a websocket in HTTP tunnel method.'); res.end(); return false; }

        // If the response stream is closed, close this tunnel right away
        res.socket.on('end', handleResponseClosure);

        // Construct the HTTP request
        var request = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
        const blockedHeaders = ['cookie', 'upgrade-insecure-requests', 'sec-ch-ua', 'sec-ch-ua-mobile', 'dnt', 'sec-fetch-user', 'sec-ch-ua-platform', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']; // These are headers we do not forward
        for (var i in req.headers) { if (blockedHeaders.indexOf(i) == -1) { request += i + ': ' + req.headers[i] + '\r\n'; } }
        var cookieStr = '';
        for (var i in parent.webCookies) { if (cookieStr != '') { cookieStr += '; ' } cookieStr += (i + '=' + parent.webCookies[i].value); }
        var reqCookies = parseRequestCookies(req.headers.cookie);
        for (var i in reqCookies) { if ((i != 'xid') && (i != 'xid.sig')) { if (cookieStr != '') { cookieStr += '; ' } cookieStr += (i + '=' + reqCookies[i]); } }
        if (cookieStr.length > 0) { request += 'cookie: ' + cookieStr + '\r\n' } // If we have session cookies, set them in the header here
        request += '\r\n';

        if (req.headers['content-length'] != null) {
            // Stream the HTTP request and body, this is a content-length HTTP request, just forward the body data
            send(Buffer.from(request));
            req.on('data', function (data) { send(data); }); // TODO: Flow control (Not sure how to do this in ExpressJS)
            req.on('end', function () { });
        } else if (req.headers['transfer-encoding'] != null) {
            // Stream the HTTP request and body, this is a chunked encoded HTTP request
            // TODO: Flow control (Not sure how to do this in ExpressJS)
            send(Buffer.from(request));
            req.on('data', function (data) { send(Buffer.concat([Buffer.from(data.length.toString(16) + '\r\n', 'binary'), data, send(Buffer.from('\r\n', 'binary'))])); }); 
            req.on('end', function () { send(Buffer.from('0\r\n\r\n', 'binary')); });
        } else {
            // Request has no body, send it now
            send(Buffer.from(request));
        }
        obj.res = res;
    }

    // Process a websocket request
    obj.processWebSocket = function (req, ws) {
        if (obj.relayActive == false) { console.log("ERROR: Attempt to use an unconnected tunnel"); return false; }
        parent.lastOperation = obj.lastOperation = Date.now();

        // Mark this tunnel as being a web socket tunnel
        obj.isWebSocket = true;
        obj.ws = ws;

        // Pause the websocket until we get a tunnel connected
        obj.ws._socket.pause();

        // If the response stream is closed, close this tunnel right away
        obj.ws._socket.on('end', function () { obj.close(); });

        // Remove the trailing '/.websocket' if needed
        var baseurl = req.url, i = req.url.indexOf('?');
        if (i > 0) { baseurl = req.url.substring(0, i); }
        if (baseurl.endsWith('/.websocket')) { req.url = baseurl.substring(0, baseurl.length - 11) + ((i < 1) ? '' : req.url.substring(i)); }

        // Construct the HTTP request
        var request = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
        const blockedHeaders = ['cookie', 'sec-websocket-extensions']; // These are headers we do not forward
        for (var i in req.headers) { if (blockedHeaders.indexOf(i) == -1) { request += i + ': ' + req.headers[i] + '\r\n'; } }
        var cookieStr = '';
        for (var i in parent.webCookies) { if (cookieStr != '') { cookieStr += '; ' } cookieStr += (i + '=' + parent.webCookies[i].value); }
        if (cookieStr.length > 0) { request += 'cookie: ' + cookieStr + '\r\n' } // If we have session cookies, set them in the header here
        request += '\r\n';
        send(Buffer.from(request));

        // Hook up the websocket events
        obj.ws.on('message', function (data) {
            // Setup opcode and payload
            var op = 2, payload = data;
            if (typeof data == 'string') { op = 1; payload = Buffer.from(data, 'binary'); } // Text frame
            sendWebSocketFrameToDevice(op, payload);
        });

        obj.ws.on('ping', function (data) { sendWebSocketFrameToDevice(9, data); }); // Forward ping frame
        obj.ws.on('pong', function (data) { sendWebSocketFrameToDevice(10, data); }); // Forward pong frame
        obj.ws.on('close', function () { obj.close(); });
        obj.ws.on('error', function (err) { obj.close(); });
    }

    function sendWebSocketFrameToDevice(op, payload) {
        // Select a random mask
        const mask = parent.parent.parent.crypto.randomBytes(4)

        // Setup header and mask
        var header = null;
        if (payload.length < 126) {
            header = Buffer.alloc(6);                   // Header (2) + Mask (4)
            header[0] = 0x80 + op;                      // FIN + OP
            header[1] = 0x80 + payload.length;          // Mask + Length
            mask.copy(header, 2, 0, 4);                 // Copy the mask
        } else if (payload.length <= 0xFFFF) {
            header = Buffer.alloc(8);                   // Header (2) + Length (2) + Mask (4)
            header[0] = 0x80 + op;                      // FIN + OP
            header[1] = 0x80 + 126;                     // Mask + 126
            header.writeInt16BE(payload.length, 2);     // Payload size
            mask.copy(header, 4, 0, 4);                 // Copy the mask
        } else {
            header = Buffer.alloc(14);                  // Header (2) + Length (8) + Mask (4)
            header[0] = 0x80 + op;                      // FIN + OP
            header[1] = 0x80 + 127;                     // Mask + 127
            header.writeInt32BE(payload.length, 6);     // Payload size
            mask.copy(header, 10, 0, 4);                // Copy the mask
        }

        // Mask the payload
        for (var i = 0; i < payload.length; i++) { payload[i] = (payload[i] ^ mask[i % 4]); }

        // Send the frame
        //console.log(obj.tunnelId, '-->', op, payload.length);
        send(Buffer.concat([header, payload]));
    }

    // Disconnect
    obj.close = function (arg) {
        if (obj.closed == true) return;
        obj.closed = true;

        // If we are processing a http response that terminates when it closes, do this now.
        if ((obj.socketParseState == 1) && (obj.socketXHeader['connection'] != null) && (obj.socketXHeader['connection'].toLowerCase() == 'close')) {
            processHttpResponse(null, obj.socketAccumulator, true, true); // Indicate this tunnel is done and also closed, do not put a new request on this tunnel.
            obj.socketAccumulator = '';
            obj.socketParseState = 0;
        }

        if (obj.tls) {
            try { obj.tls.end(); } catch (ex) { console.log(ex); }
            delete obj.tls;
        }

        /*
        // Event the session ending
        if ((obj.startTime) && (obj.meshid != null)) {
            // Collect how many raw bytes where received and sent.
            // We sum both the websocket and TCP client in this case.
            var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
            if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const user = parent.users[obj.cookie.userid];
            const username = (user != null) ? user.name : null;
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.cookie.userid, username: username, sessionid: obj.sessionid, msgid: 123, msgArgs: [sessionSeconds, obj.sessionid], msg: "Left Web-SSH session \"" + obj.sessionid + "\" after " + sessionSeconds + " second(s).", protocol: PROTOCOL_WEBSSH, bytesin: inTraffc, bytesout: outTraffc };
            parent.DispatchEvent(['*', obj.nodeid, obj.cookie.userid, obj.meshid], obj, event);
            delete obj.startTime;
            delete obj.sessionid;
        }
        */
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        // Close any pending request
        if (obj.res) { obj.res.socket.removeListener('end', handleResponseClosure); obj.res.end(); delete obj.res; }
        if (obj.ws) { obj.ws.close(); delete obj.ws; }

        // Event disconnection
        if (obj.onclose) { obj.onclose(obj.tunnelId, obj.processedRequestCount); }

        obj.relayActive = false;
    };

    // Start the loopback server
    obj.connect = function (userid, nodeid, addr, port, appid) {
        if (obj.relayActive || obj.closed) return;
        obj.addr = addr;
        obj.port = port;
        obj.appid = appid;

        // Encode a cookie for the mesh relay
        const cookieContent = { userid: userid, domainid: domain.id, nodeid: nodeid, tcpport: port };
        if (addr != null) { cookieContent.tcpaddr = addr; }
        const cookie = parent.parent.parent.encodeCookie(cookieContent, parent.parent.parent.loginCookieEncryptionKey);

        try {
            // Setup the correct URL with domain and use TLS only if needed.
            const options = { rejectUnauthorized: false };
            const protocol = (args.tlsoffload) ? 'ws' : 'wss';
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            const url = protocol + '://localhost:' + args.port + '/' + domainadd + (((obj.mtype == 3) && (obj.relaynodeid == null)) ? 'local' : 'mesh') + 'relay.ashx?p=14&auth=' + cookie; // Protocol 14 is Web-TCP
            if (domain.id != '') { url += '&domainid=' + domain.id; } // Since we are using "localhost", we are going to signal what domain we are on using a URL argument.
            parent.parent.parent.debug('relay', 'TCP: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.parent.debug('relay', 'TCP: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if (obj.tls) {
                    // WS --> TLS
                    processRawHttpData(data);
                } else if (obj.relayActive == false) {
                    if ((data == 'c') || (data == 'cr')) {
                        if (appid == 2) {
                            // TLS needs to be setup
                            obj.ser = new SerialTunnel();
                            obj.ser.forwardwrite = function (data) { if (data.length > 0) { try { obj.wsClient.send(data); } catch (ex) { } } }; // TLS ---> WS

                            // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel
                            const tlsoptions = { socket: obj.ser, rejectUnauthorized: false };
                            obj.tls = require('tls').connect(tlsoptions, function () {
                                parent.parent.parent.debug('relay', "Web Relay Secure TLS Connection");
                                obj.relayActive = true;
                                parent.lastOperation = obj.lastOperation = Date.now(); // Update time of last opertion performed
                                if (obj.onconnect) { obj.onconnect(obj.tunnelId); } // Event connection
                            });
                            obj.tls.setEncoding('binary');
                            obj.tls.on('error', function (err) { parent.parent.parent.debug('relay', "Web Relay TLS Connection Error", err); obj.close(); });

                            // Decrypted tunnel from TLS communcation to be forwarded to the browser
                            obj.tls.on('data', function (data) { processHttpData(data); }); // TLS ---> Browser
                        } else {
                            // No TLS needed, tunnel is now active
                            obj.relayActive = true;
                            parent.lastOperation = obj.lastOperation = Date.now(); // Update time of last opertion performed
                            if (obj.onconnect) { obj.onconnect(obj.tunnelId); } // Event connection
                        }
                    }
                } else {
                    processRawHttpData(data);
                }
            });
            obj.wsClient.on('close', function () { parent.parent.parent.debug('relay', 'TCP: Relay websocket closed'); obj.close(); });
            obj.wsClient.on('error', function (err) { parent.parent.parent.debug('relay', 'TCP: Relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    function processRawHttpData(data) {
        if (typeof data == 'string') {
            // Forward any ping/pong commands to the browser
            var cmd = null;
            try { cmd = JSON.parse(data); } catch (ex) { }
            if ((cmd != null) && (cmd.ctrlChannel == '102938') && (cmd.type == 'ping')) { cmd.type = 'pong'; obj.wsClient.send(JSON.stringify(cmd)); }
            return;
        }
        if (obj.tls) {
            // If TLS is in use, WS --> TLS
            if (data.length > 0) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
        } else {
            // Relay WS --> TCP, event data coming in
            processHttpData(data.toString('binary'));
        }
    }

    // Process incoming HTTP data
    obj.socketAccumulator = '';
    obj.socketParseState = 0;
    obj.socketContentLengthRemaining = 0;
    function processHttpData(data) {
        //console.log('processHttpData', data.length);
        obj.socketAccumulator += data;
        while (true) {
            //console.log('ACC(' + obj.socketAccumulator + '): ' + obj.socketAccumulator);
            if (obj.socketParseState == 0) {
                var headersize = obj.socketAccumulator.indexOf('\r\n\r\n');
                if (headersize < 0) return;
                //obj.Debug("Header: "+obj.socketAccumulator.substring(0, headersize)); // Display received HTTP header
                obj.socketHeader = obj.socketAccumulator.substring(0, headersize).split('\r\n');
                obj.socketAccumulator = obj.socketAccumulator.substring(headersize + 4);
                obj.socketXHeader = { Directive: obj.socketHeader[0].split(' ') };
                for (var i in obj.socketHeader) {
                    if (i != 0) {
                        var x2 = obj.socketHeader[i].indexOf(':');
                        const n = obj.socketHeader[i].substring(0, x2).toLowerCase();
                        const v = obj.socketHeader[i].substring(x2 + 2);
                        if (n == 'set-cookie') { // Since "set-cookie" can be present many times in the header, handle it as an array of values
                            if (obj.socketXHeader[n] == null) { obj.socketXHeader[n] = [v]; } else { obj.socketXHeader[n].push(v); }
                        } else {
                            obj.socketXHeader[n] = v;
                        }
                    }
                }

                // Check if this is a streaming response
                if ((obj.socketXHeader['content-type'] != null) && (obj.socketXHeader['content-type'].toLowerCase().indexOf('text/event-stream') >= 0)) {
                    obj.isStreaming = true; // This tunnel is now a streaming tunnel and will not close anytime soon.
                    if (obj.onNextRequest != null) obj.onNextRequest(); // Call this so that any HTTP requests that are waitting for this one to finish get handled by a new tunnel.
                }

                // Check if this HTTP request has a body
                if (obj.socketXHeader['content-length'] != null) { obj.socketParseState = 1; }
                if ((obj.socketXHeader['connection'] != null) && (obj.socketXHeader['connection'].toLowerCase() == 'close')) { obj.socketParseState = 1; }
                if ((obj.socketXHeader['transfer-encoding'] != null) && (obj.socketXHeader['transfer-encoding'].toLowerCase() == 'chunked')) { obj.socketParseState = 1; }
                if (obj.isWebSocket) {
                    if ((obj.socketXHeader['connection'] != null) && (obj.socketXHeader['connection'].toLowerCase() == 'upgrade')) {
                        obj.processedRequestCount++;
                        obj.socketParseState = 2; // Switch to decoding websocket frames
                        obj.ws._socket.resume(); // Resume the browser's websocket
                    } else {
                        obj.close(); // Failed to upgrade to websocket
                    }
                }

                // Forward the HTTP request into the tunnel, if no body is present, close the request.
                processHttpResponse(obj.socketXHeader, null, (obj.socketParseState == 0));
            }
            if (obj.socketParseState == 1) {
                var csize = -1;
                if (obj.socketXHeader['content-length'] != null) {
                    // The body length is specified by the content-length
                    if (obj.socketContentLengthRemaining == 0) { obj.socketContentLengthRemaining = parseInt(obj.socketXHeader['content-length']); } // Set the remaining content-length if not set
                    var data = obj.socketAccumulator.substring(0, obj.socketContentLengthRemaining); // Grab the available data, not passed the expected content-length
                    obj.socketAccumulator = obj.socketAccumulator.substring(data.length); // Remove the data from the accumulator
                    obj.socketContentLengthRemaining -= data.length; // Substract the obtained data from the expected size
                    if (obj.socketContentLengthRemaining > 0) {
                        // Send any data we have, if we are done, signal the end of the response
                        processHttpResponse(null, data, false);
                        return; // More data is needed, return now so we exit the while() loop.
                    } else {
                        // We are done with this request
                        const closing = (obj.socketXHeader['connection'] != null) && (obj.socketXHeader['connection'].toLowerCase() == 'close');
                        if (closing) {
                            // We need to close this tunnel.
                            processHttpResponse(null, data, false);
                            obj.close();
                        } else {
                            // Proceed with the next request.
                            processHttpResponse(null, data, true);
                        }
                    }
                    csize = 0; // We are done
                } else if ((obj.socketXHeader['connection'] != null) && (obj.socketXHeader['connection'].toLowerCase() == 'close')) {
                    // The body ends with a close, in this case, we will only process the header
                    processHttpResponse(null, obj.socketAccumulator, false);
                    obj.socketAccumulator = '';
                    return;
                } else if ((obj.socketXHeader['transfer-encoding'] != null) && (obj.socketXHeader['transfer-encoding'].toLowerCase() == 'chunked')) {
                    // The body is chunked
                    var clen = obj.socketAccumulator.indexOf('\r\n');
                    if (clen < 0) { return; } // Chunk length not found, exit now and get more data.
                    // Chunk length if found, lets see if we can get the data.
                    csize = parseInt(obj.socketAccumulator.substring(0, clen), 16);
                    if (obj.socketAccumulator.length < clen + 2 + csize + 2) return;
                    // We got a chunk with all of the data, handle the chunck now.
                    var data = obj.socketAccumulator.substring(clen + 2, clen + 2 + csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(clen + 2 + csize + 2);
                    processHttpResponse(null, data, (csize == 0));
                }
                if (csize == 0) {
                    //obj.Debug("xxOnSocketData DONE: (" + obj.socketData.length + "): " + obj.socketData);
                    obj.socketParseState = 0;
                    obj.socketHeader = null;
                }
            }
            if (obj.socketParseState == 2) {
                // We are in websocket pass-thru mode, decode the websocket frame
                if (obj.socketAccumulator.length < 2) return; // Need at least 2 bytes to decode a websocket header
                //console.log('WebSocket frame', obj.socketAccumulator.length, Buffer.from(obj.socketAccumulator, 'binary'));

                // Decode the websocket frame
                const buf = Buffer.from(obj.socketAccumulator, 'binary');
                const fin = ((buf[0] & 0x80) != 0);
                const rsv = ((buf[0] & 0x70) != 0);
                const op = buf[0] & 0x0F;
                const mask = ((buf[1] & 0x80) != 0);
                var len = buf[1] & 0x7F;
                //console.log(obj.tunnelId, 'fin: ' + fin + ', rsv: ' + rsv + ', op: ' + op + ', len: ' + len);

                // Calculate the total length
                var payload = null;
                if (len < 126) {
                    // 1 byte length
                    if (buf.length < (2 + len)) return; // Insuffisent data
                    payload = buf.slice(2, 2 + len);
                    obj.socketAccumulator = obj.socketAccumulator.substring(2 + len); // Remove data from accumulator
                } else if (len == 126) {
                    // 2 byte length
                    if (buf.length < 4) return;
                    len = buf.readUInt16BE(2);
                    if (buf.length < (4 + len)) return; // Insuffisent data
                    payload = buf.slice(4, 4 + len);
                    obj.socketAccumulator = obj.socketAccumulator.substring(4 + len); // Remove data from accumulator
                } if (len == 127) {
                    // 8 byte length
                    if (buf.length < 10) return;
                    len = buf.readUInt32BE(2);
                    if (len > 0) { obj.close(); return; } // This frame is larger than 4 gigabyte, close the connection.
                    len = buf.readUInt32BE(6);
                    if (buf.length < (10 + len)) return; // Insuffisent data
                    payload = buf.slice(10, 10 + len);
                    obj.socketAccumulator = obj.socketAccumulator.substring(10 + len); // Remove data from accumulator
                }
                if (buf.length < len) return;

                // If the mask or reserved bit are true, we are not decoding this right, close the connection.
                if ((mask == true) || (rsv == true)) { obj.close(); return; }

                // TODO: If FIN is not set, we need to add support for continue frames
                //console.log(obj.tunnelId, '<--', op, payload ? payload.length : 0);

                // Perform operation
                switch (op) {
                    case 0: { break; } // Continue frame (TODO)
                    case 1: { try { obj.ws.send(payload.toString('binary')); } catch (ex) { } break; } // Text frame
                    case 2: { try { obj.ws.send(payload); } catch (ex) { } break; } // Binary frame
                    case 8: { obj.close(); return; } // Connection close
                    case 9: { try { obj.ws.ping(payload); } catch (ex) { } break; } // Ping frame
                    case 10: { try { obj.ws.pong(payload); } catch (ex) { } break; } // Pong frame
                }
            }
        }
    }

    // This is a fully parsed HTTP response from the remote device
    function processHttpResponse(header, data, done, closed) {
        //console.log('processHttpResponse', header, data ? data.length : 0, done, closed);
        if (obj.isWebSocket == false) {
            if (obj.res == null) return;
            parent.lastOperation = obj.lastOperation = Date.now(); // Update time of last opertion performed

            // If there is a header, send it
            if (header != null) {
                const statusCode = parseInt(header.Directive[1]);
                if ((!isNaN(statusCode)) && (statusCode > 0) && (statusCode <= 999)) { obj.res.status(statusCode); } // Set the status
                const blockHeaders = ['Directive', 'sec-websocket-extensions', 'connection', 'transfer-encoding', 'last-modified', 'content-security-policy', 'cache-control']; // We do not forward these headers 
                for (var i in header) {
                    if (i == 'set-cookie') {
                        for (var ii in header[i]) {
                            // Decode the new cookie
                            //console.log('set-cookie', header[i][ii]);
                            const cookieSplit = header[i][ii].split(';');
                            var newCookieName = null, newCookie = {};
                            for (var j in cookieSplit) {
                                var l = cookieSplit[j].indexOf('='), k = null, v = null;
                                if (l == -1) { k = cookieSplit[j].trim(); } else { k = cookieSplit[j].substring(0, l).trim(); v = cookieSplit[j].substring(l + 1).trim(); }
                                if (j == 0) { newCookieName = k; newCookie.value = v; } else { newCookie[k.toLowerCase()] = (v == null) ? true : v; }
                            }
                            if (newCookieName != null) {
                                if ((typeof newCookie['max-age'] == 'string') && (parseInt(newCookie['max-age']) <= 0)) {
                                    delete parent.webCookies[newCookieName]; // Remove a expired cookie
                                    //console.log('clear-cookie', newCookieName);
                                } else if (((newCookie.secure != true) || (obj.tls != null))) {
                                    parent.webCookies[newCookieName] = newCookie; // Keep this cookie in the session
                                    if (newCookie.httponly != true) { obj.res.set(i, header[i]); } // if the cookie is not HTTP-only, forward it to the browser. We need to do this to allow JavaScript to read it.
                                    //console.log('new-cookie', newCookieName, newCookie);
                                }
                            }
                        }
                    }
                    else if (blockHeaders.indexOf(i) == -1) { obj.res.set(i, header[i]); } // Set the headers if not blocked
                }
                obj.res.set('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;"); // Set an "allow all" policy, see if the can restrict this in the future
                //obj.res.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';"); // Set an "allow all" policy, see if the can restrict this in the future
                obj.res.set('Cache-Control', 'no-store'); // Tell the browser not to cache the responses since since the relay port can be used for many relays
            }

            // If there is data, send it
            if (data != null) { try { obj.res.write(data, 'binary'); } catch (ex) { } }

            // If we are done, close the response
            if (done == true) {
                // Close the response
                obj.res.socket.removeListener('end', handleResponseClosure);
                obj.res.end();
                delete obj.res;

                // Event completion
                obj.processedRequestCount++;
                if (obj.oncompleted) { obj.oncompleted(obj.tunnelId, closed); }
            }
        } else {
            // Tunnel is now in web socket pass-thru mode
            if (header != null) {
                if ((typeof header.connection == 'string') && (header.connection.toLowerCase() == 'upgrade')) {
                    // Websocket upgrade succesful
                    obj.socketParseState = 2;
                } else {
                    // Unable to upgrade to web socket
                    obj.close();
                }
            }
        }
    }

    // Send data thru the relay tunnel. Written to use TLS if needed.
    function send(data) { try { if (obj.tls) { obj.tls.write(data); } else { obj.wsClient.send(data); } } catch (ex) { } }

    parent.parent.parent.debug('relay', 'TCP: Request for web relay');
    return obj;
};


// Construct a MSTSC Relay object, called upon connection
// This implementation does not have TLS support
// This is a bit of a hack as we are going to run the RDP connection thru a loopback connection.
// If the "node-rdpjs-2" module supported passing a socket, we would do something different.
module.exports.CreateMstscRelay = function (parent, db, ws, req, args, domain) {
    const Net = require('net');
    const WebSocket = require('ws');

    const obj = {};
    obj.ws = ws;
    obj.tcpServerPort = 0;
    obj.relayActive = false;
    var rdpClient = null;

    parent.parent.debug('relay', 'RDP: Request for RDP relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Event the session ending
        if ((obj.startTime) && (obj.meshid != null)) {
            // Collect how many raw bytes where received and sent.
            // We sum both the websocket and TCP client in this case.
            var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
            if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const user = parent.users[obj.userid];
            const username = (user != null) ? user.name : null;
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.userid, username: username, sessionid: obj.sessionid, msgid: 125, msgArgs: [sessionSeconds, obj.sessionid], msg: "Left Web-RDP session \"" + obj.sessionid + "\" after " + sessionSeconds + " second(s).", protocol: PROTOCOL_WEBRDP, bytesin: inTraffc, bytesout: outTraffc };
            parent.parent.DispatchEvent(['*', obj.nodeid, obj.userid, obj.meshid], obj, event);
            delete obj.startTime;
            delete obj.sessionid;
        }

        if (obj.wsClient) { obj.wsClient.close(); delete obj.wsClient; }
        if (obj.tcpServer) { obj.tcpServer.close(); delete obj.tcpServer; }
        if (rdpClient) { rdpClient.close(); rdpClient = null; }
        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (ex) { console.log(ex); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (ex) { console.log(ex); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();
        obj.relayActive = false;

        delete obj.ws;
        delete obj.nodeid;
        delete obj.meshid;
        delete obj.userid;
    };

    // Start the looppback server
    function startTcpServer() {
        obj.tcpServer = new Net.Server();
        obj.tcpServer.listen(0, 'localhost', function () { obj.tcpServerPort = obj.tcpServer.address().port; startRdp(obj.tcpServerPort); });
        obj.tcpServer.on('connection', function (socket) {
            if (obj.relaySocket != null) {
                socket.close();
            } else {
                obj.relaySocket = socket;
                obj.relaySocket.pause();
                obj.relaySocket.on('data', function (chunk) { // Make sure to handle flow control.
                    if (obj.relayActive == true) { obj.relaySocket.pause(); if (obj.wsClient != null) { obj.wsClient.send(chunk, function () { obj.relaySocket.resume(); }); } }
                });
                obj.relaySocket.on('end', function () { obj.close(); });
                obj.relaySocket.on('error', function (err) { obj.close(); });

                // Setup the correct URL with domain and use TLS only if needed.
                const options = { rejectUnauthorized: false };
                const protocol = (args.tlsoffload) ? 'ws' : 'wss';
                var domainadd = '';
                if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
                var url = protocol + '://localhost:' + args.port + '/' + domainadd + (((obj.mtype == 3) && (obj.relaynodeid == null)) ? 'local' : 'mesh') + 'relay.ashx?p=10&auth=' + obj.infos.ip;  // Protocol 10 is Web-RDP
                if (domain.id != '') { url += '&domainid=' + domain.id; } // Since we are using "localhost", we are going to signal what domain we are on using a URL argument.
                parent.parent.debug('relay', 'RDP: Connection websocket to ' + url);
                obj.wsClient = new WebSocket(url, options);
                obj.wsClient.on('open', function () { parent.parent.debug('relay', 'RDP: Relay websocket open'); });
                obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                    if (obj.relayActive == false) {
                        if ((data == 'c') || (data == 'cr')) {
                            obj.relayActive = true;
                            obj.relaySocket.resume();
                        }
                    } else {
                        if (typeof data == 'string') {
                            // Forward any ping/pong commands to the browser
                            var cmd = null;
                            try { cmd = JSON.parse(data); } catch (ex) { }
                            if ((cmd != null) && (cmd.ctrlChannel == '102938')) {
                                if (cmd.type == 'ping') { send(['ping']); }
                                else if (cmd.type == 'pong') { send(['pong']); }
                            }
                            return;
                        }
                        obj.wsClient._socket.pause();
                        try {
                            obj.relaySocket.write(data, function () {
                                if (obj.wsClient && obj.wsClient._socket) { try { obj.wsClient._socket.resume(); } catch (ex) { console.log(ex); } }
                            });
                        } catch (ex) { console.log(ex); obj.close(); }
                    }
                });
                obj.wsClient.on('close', function () { parent.parent.debug('relay', 'RDP: Relay websocket closed'); obj.close(); });
                obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'RDP: Relay websocket error: ' + err); obj.close(); });
                obj.tcpServer.close();
                obj.tcpServer = null;
            }
        });
    }

    // Start the RDP client
    function startRdp(port) {
        parent.parent.debug('relay', 'RDP: Starting RDP client on loopback port ' + port);
        try {
            const args = {
                logLevel: 'NONE', // 'ERROR',
                domain: obj.infos.domain,
                userName: obj.infos.username,
                password: obj.infos.password,
                enablePerf: true,
                autoLogin: true,
                screen: obj.infos.screen,
                locale: obj.infos.locale,
            };
            if (obj.infos.options) {
                if (obj.infos.options.flags != null) { args.perfFlags = obj.infos.options.flags; delete obj.infos.options.flags; }
                if ((obj.infos.options.workingDir != null) && (obj.infos.options.workingDir != '')) { args.workingDir = obj.infos.options.workingDir; }
                if ((obj.infos.options.alternateShell != null) && (obj.infos.options.alternateShell != '')) { args.alternateShell = obj.infos.options.alternateShell; }
            }
            rdpClient = require('./rdp').createClient(args).on('connect', function () {
                send(['rdp-connect']);
                if ((typeof obj.infos.options == 'object') && (obj.infos.options.savepass == true)) { saveRdpCredentials(); } // Save the credentials if needed
                obj.sessionid = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                obj.startTime = Date.now();

                // Event session start
                try {
                    const user = parent.users[obj.userid];
                    const username = (user != null) ? user.name : null;
                    const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.userid, username: username, sessionid: obj.sessionid, msgid: 150, msgArgs: [obj.sessionid], msg: "Started Web-RDP session \"" + obj.sessionid + "\".", protocol: PROTOCOL_WEBRDP };
                    parent.parent.DispatchEvent(['*', obj.nodeid, obj.userid, obj.meshid], obj, event);
                } catch (ex) { console.log(ex); }
            }).on('bitmap', function (bitmap) {
                try { ws.send(bitmap.data); } catch (ex) { } // Send the bitmap data as binary
                delete bitmap.data;
                send(['rdp-bitmap', bitmap]); // Send the bitmap metadata seperately, without bitmap data.
            }).on('clipboard', function (content) {
                send(['rdp-clipboard', content]); // The clipboard data has changed
            }).on('pointer', function (cursorId, cursorStr) {
                if (cursorStr == null) { cursorStr = 'default'; }
                if (obj.lastCursorStrSent != cursorStr) {
                    obj.lastCursorStrSent = cursorStr;
                    //console.log('pointer', cursorStr);
                    send(['rdp-pointer', cursorStr]); // The mouse pointer has changed
                }
            }).on('close', function () {
                send(['rdp-close']); // This RDP session has closed
            }).on('error', function (err) {
                if (typeof err == 'string') { send(['rdp-error', err]); }
                if ((typeof err == 'object') && (err.err) && (err.code)) { send(['rdp-error', err.err, err.code]); }
            }).connect('localhost', obj.tcpServerPort);
        } catch (ex) {
            console.log('startRdpException', ex);
            obj.close();
        }
    }

    // Save RDP credentials into database
    function saveRdpCredentials() {
        if (domain.allowsavingdevicecredentials == false) return;
        parent.parent.db.Get(obj.nodeid, function (err, nodes) {
            if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
            const node = nodes[0];
            if (node.rdp == null) { node.rdp = {}; }

            // Check if credentials are already set
            if ((typeof node.rdp[obj.userid] == 'object') && (node.rdp[obj.userid].d == obj.infos.domain) && (node.rdp[obj.userid].u == obj.infos.username) && (node.rdp[obj.userid].p == obj.infos.password)) return;

            // Clear up any existing credentials or credentials for users that don't exist anymore
            for (var i in node.rdp) { if (!i.startsWith('user/') || (parent.users[i] == null)) { delete node.rdp[i]; } }

            // Clear legacy credentials
            delete node.rdp.d;
            delete node.rdp.u;
            delete node.rdp.p;

            // Save the credentials
            node.rdp[obj.userid] = { d: obj.infos.domain, u: obj.infos.username, p: obj.infos.password };
            parent.parent.db.Set(node);

            // Event the node change
            const event = { etype: 'node', action: 'changenode', nodeid: obj.nodeid, domain: domain.id, userid: obj.userid, node: parent.CloneSafeNode(node), msg: "Changed RDP credentials" };
            if (parent.parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.nodeid]), obj, event);
        });
    }

    // When data is received from the web socket
    // RDP default port is 3389
    ws.on('message', function (data) {
        try {
            var msg = null;
            try { msg = JSON.parse(data); } catch (ex) { }
            if ((msg == null) || (typeof msg != 'object')) return;
            switch (msg[0]) {
                case 'infos': {
                    obj.infos = msg[1];

                    if (obj.infos.ip.startsWith('node/')) {
                        // Use the user session
                        obj.nodeid = obj.infos.ip;
                        obj.userid = req.session.userid;
                    } else {
                        // Decode the authentication cookie
                        obj.cookie = parent.parent.decodeCookie(obj.infos.ip, parent.parent.loginCookieEncryptionKey);
                        if ((obj.cookie == null) || (typeof obj.cookie.nodeid != 'string') || (typeof obj.cookie.userid != 'string')) { obj.close(); return; }
                        obj.nodeid = obj.cookie.nodeid;
                        obj.userid = obj.cookie.userid;
                    }

                    // Get node and rights
                    parent.GetNodeWithRights(domain, obj.userid, obj.nodeid, function (node, rights, visible) {
                        if (obj.ws == null) return; // obj has been cleaned up, just exit.
                        if ((node == null) || (visible == false) || ((rights & MESHRIGHT_REMOTECONTROL) == 0)) { obj.close(); return; }
                        if ((rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_REMOTEVIEWONLY) != 0)) { obj.viewonly = true; }
                        if ((rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_DESKLIMITEDINPUT) != 0)) { obj.limitedinput = true; }
                        obj.mtype = node.mtype; // Store the device group type
                        obj.meshid = node.meshid; // Store the MeshID

                        // Check if we need to relay thru a different agent
                        const mesh = parent.meshes[obj.meshid];
                        if (mesh && mesh.relayid) {
                            obj.relaynodeid = mesh.relayid;
                            obj.tcpaddr = node.host;

                            // Get the TCP port to use
                            var tcpport = 3389;
                            if ((obj.cookie != null) && (obj.cookie.tcpport != null)) { tcpport = obj.cookie.tcpport; } else { if (node.rdpport) { tcpport = node.rdpport } }

                            // Re-encode a cookie with a device relay
                            const cookieContent = { userid: obj.userid, domainid: domain.id, nodeid: mesh.relayid, tcpaddr: node.host, tcpport: tcpport };
                            obj.infos.ip = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
                        } else if (obj.infos.ip.startsWith('node/')) {
                            // Encode a cookie with a device relay
                            const cookieContent = { userid: obj.userid, domainid: domain.id, nodeid: obj.nodeid, tcpport: node.rdpport ? node.rdpport : 3389 };
                            obj.infos.ip = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
                        }

                        // Check if we have rights to the relayid device, does nothing if a relay is not used
                        checkRelayRights(parent, domain, obj.userid, obj.relaynodeid, function (allowed) {
                            if (obj.ws == null) return; // obj has been cleaned up, just exit.
                            if (allowed !== true) { parent.parent.debug('relay', 'RDP: Attempt to use un-authorized relay'); obj.close(); return; }

                            // Check if we need to load server stored credentials
                            if ((typeof obj.infos.options == 'object') && (obj.infos.options.useServerCreds == true)) {
                                // Check if RDP credentials exist
                                if ((domain.allowsavingdevicecredentials !== false) && (typeof node.rdp == 'object') && (typeof node.rdp[obj.userid] == 'object') && (typeof node.rdp[obj.userid].d == 'string') && (typeof node.rdp[obj.userid].u == 'string') && (typeof node.rdp[obj.userid].p == 'string')) {
                                    obj.infos.domain = node.rdp[obj.userid].d;
                                    obj.infos.username = node.rdp[obj.userid].u;
                                    obj.infos.password = node.rdp[obj.userid].p;
                                    startTcpServer();
                                } else {
                                    // No server credentials.
                                    obj.infos.domain = '';
                                    obj.infos.username = '';
                                    obj.infos.password = '';
                                    startTcpServer();
                                }
                            } else {
                                startTcpServer();
                            }
                        });
                    });
                    break;
                }
                case 'mouse': { if (rdpClient && (obj.viewonly != true)) { rdpClient.sendPointerEvent(msg[1], msg[2], msg[3], msg[4]); } break; }
                case 'wheel': { if (rdpClient && (obj.viewonly != true)) { rdpClient.sendWheelEvent(msg[1], msg[2], msg[3], msg[4]); } break; }
                case 'clipboard': { rdpClient.setClipboardData(msg[1]); break; }
                case 'scancode': {
                    if (obj.limitedinput == true) { // Limit keyboard input
                        var ok = false, k = msg[1];
                        if ((k >= 2) && (k <= 11)) { ok = true; } // Number keys 1 to 0
                        if ((k >= 16) && (k <= 25)) { ok = true; } // First keyboard row
                        if ((k >= 30) && (k <= 38)) { ok = true; } // Second keyboard row
                        if ((k >= 44) && (k <= 50)) { ok = true; } // Third keyboard row
                        if ((k == 14) || (k == 28)) { ok = true; } // Enter and backspace
                        if (ok == false) return;
                    }
                    if (rdpClient && (obj.viewonly != true)) { rdpClient.sendKeyEventScancode(msg[1], msg[2]); } break;
                }
                case 'unicode': { if (rdpClient && (obj.viewonly != true)) { rdpClient.sendKeyEventUnicode(msg[1], msg[2]); } break; }
                case 'utype': {
                    if (!rdpClient) return;
                    obj.utype = msg[1];
                    if (obj.utypetimer == null) {
                        obj.utypetimer = setInterval(function () {
                            if ((obj.utype == null) || (obj.utype.length == 0)) { clearInterval(obj.utypetimer); obj.utypetimer = null; return; }
                            var c = obj.utype.charCodeAt(0);
                            obj.utype = obj.utype.substring(1);
                            if (c == 13) return;
                            if (c == 10) { rdpClient.sendKeyEventScancode(28, true); rdpClient.sendKeyEventScancode(28, false); }
                            else { rdpClient.sendKeyEventUnicode(c, true); rdpClient.sendKeyEventUnicode(c, false); }
                        }, 5);
                    }
                    break;
                }
                case 'ping': { try { obj.wsClient.send('{"ctrlChannel":102938,"type":"ping"}'); } catch (ex) { } break; }
                case 'pong': { try { obj.wsClient.send('{"ctrlChannel":102938,"type":"pong"}'); } catch (ex) { } break; }
                case 'disconnect': { obj.close(); break; }
            }
        } catch (ex) {
            console.log('RdpMessageException', msg, ex);
            obj.close();
        }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'RDP: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'RDP: Browser websocket closed'); obj.close(); });

    // Send an object with flow control
    function send(obj) {
        try { rdpClient.bufferLayer.socket.pause(); } catch (ex) { }
        try { ws.send(JSON.stringify(obj), function () { try { rdpClient.bufferLayer.socket.resume(); } catch (ex) { } }); } catch (ex) { }
    }

    // We are all set, start receiving data
    ws._socket.resume();

    return obj;
};


// Construct a SSH Relay object, called upon connection
module.exports.CreateSshRelay = function (parent, db, ws, req, args, domain) {
    const Net = require('net');
    const WebSocket = require('ws');
    
    // SerialTunnel object is used to embed SSH within another connection.
    function SerialTunnel(options) {
        const obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        obj.destroy = function () { delete obj.forwardwrite; }
        return obj;
    }

    const obj = {};
    obj.ws = ws;
    obj.relayActive = false;

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Event the session ending
        if ((obj.startTime) && (obj.meshid != null)) {
            // Collect how many raw bytes where received and sent.
            // We sum both the websocket and TCP client in this case.
            var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
            if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const user = parent.users[obj.cookie.userid];
            const username = (user != null) ? user.name : null;
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.cookie.userid, username: username, sessionid: obj.sessionid, msgid: 123, msgArgs: [sessionSeconds, obj.sessionid], msg: "Left Web-SSH session \"" + obj.sessionid + "\" after " + sessionSeconds + " second(s).", protocol: PROTOCOL_WEBSSH, bytesin: inTraffc, bytesout: outTraffc };
            parent.parent.DispatchEvent(['*', obj.nodeid, obj.cookie.userid, obj.meshid], obj, event);
            delete obj.startTime;
            delete obj.sessionid;
        }

        if (obj.sshShell) {
            obj.sshShell.destroy();
            obj.sshShell.removeAllListeners('data');
            obj.sshShell.removeAllListeners('close');
            try { obj.sshShell.end(); } catch (ex) { console.log(ex); }
            delete obj.sshShell;
        }
        if (obj.sshClient) {
            obj.sshClient.destroy();
            obj.sshClient.removeAllListeners('ready');
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); }
            delete obj.sshClient;
        }
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (ex) { console.log(ex); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (ex) { console.log(ex); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();

        obj.relayActive = false;
        delete obj.termSize;
        delete obj.cookie;
        delete obj.nodeid;
        delete obj.meshid;
        delete obj.userid;
        delete obj.ws;
    };

    // Save SSH credentials into database
    function saveSshCredentials(keep) {
        if (((keep != 1) && (keep != 2)) || (domain.allowsavingdevicecredentials == false)) return;
        parent.parent.db.Get(obj.nodeid, function (err, nodes) {
            if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
            const node = nodes[0];
            if (node.ssh == null) { node.ssh = {}; }

            // Check if credentials are the same
            //if ((typeof node.ssh[obj.userid] == 'object') && (node.ssh[obj.userid].u == obj.username) && (node.ssh[obj.userid].p == obj.password)) return; // TODO

            // Clear up any existing credentials or credentials for users that don't exist anymore
            for (var i in node.ssh) { if (!i.startsWith('user/') || (parent.users[i] == null)) { delete node.ssh[i]; } }

            // Clear legacy credentials
            delete node.ssh.u;
            delete node.ssh.p;
            delete node.ssh.k;
            delete node.ssh.kp;

            // Save the credentials
            if (obj.password != null) {
                node.ssh[obj.userid] = { u: obj.username, p: obj.password };
            } else if (obj.privateKey != null) {
                node.ssh[obj.userid] = { u: obj.username, k: obj.privateKey };
                if (keep == 2) { node.ssh[obj.userid].kp = obj.privateKeyPass; }
            } else return;
            parent.parent.db.Set(node);

            // Event the node change
            const event = { etype: 'node', action: 'changenode', nodeid: obj.nodeid, domain: domain.id, userid: obj.userid, node: parent.CloneSafeNode(node), msg: "Changed SSH credentials" };
            if (parent.parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.nodeid]), obj, event);
        });
    }

    // Start the looppback server
    function startRelayConnection() {
        try {
            // Setup the correct URL with domain and use TLS only if needed.
            const options = { rejectUnauthorized: false };
            const protocol = (args.tlsoffload) ? 'ws' : 'wss';
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            const url = protocol + '://localhost:' + args.port + '/' + domainadd + (((obj.mtype == 3) && (obj.relaynodeid == null)) ? 'local' : 'mesh') + 'relay.ashx?p=11&auth=' + obj.xcookie; // Protocol 11 is Web-SSH
            if (domain.id != '') { url += '&domainid=' + domain.id; } // Since we are using "localhost", we are going to signal what domain we are on using a URL argument.
            parent.parent.debug('relay', 'SSH: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.debug('relay', 'SSH: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if (obj.relayActive == false) {
                    if ((data == 'c') || (data == 'cr')) {
                        obj.relayActive = true;

                        // Create a serial tunnel && SSH module
                        obj.ser = new SerialTunnel();
                        const Client = require('ssh2').Client;
                        obj.sshClient = new Client();
                        obj.sshClient.on('ready', function () { // Authentication was successful.
                            // If requested, save the credentials
                            saveSshCredentials(obj.keep);
                            obj.sessionid = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            obj.startTime = Date.now();

                            // Event start of session
                            try {
                                const user = parent.users[obj.cookie.userid];
                                const username = (user != null) ? user.name : null;
                                const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 148, msgArgs: [obj.sessionid], msg: "Started Web-SSH session \"" + obj.sessionid + "\".", protocol: PROTOCOL_WEBSSH };
                                parent.parent.DispatchEvent(['*', obj.nodeid, user._id, obj.meshid], obj, event);
                            } catch (ex) { console.log(ex); }

                            obj.sshClient.shell(function (err, stream) { // Start a remote shell
                                if (err) { obj.close(); return; }
                                obj.sshShell = stream;
                                obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width);
                                obj.sshShell.on('close', function () { obj.close(); });
                                obj.sshShell.on('data', function (data) { obj.ws.send('~' + data.toString()); });
                            });
                            obj.ws.send(JSON.stringify({ action: 'connected' }));
                        });
                        obj.sshClient.on('error', function (err) {
                            if (err.level == 'client-authentication') { try { obj.ws.send(JSON.stringify({ action: 'autherror' })); } catch (ex) { } }
                            if (err.level == 'client-timeout') { try { obj.ws.send(JSON.stringify({ action: 'sessiontimeout' })); } catch (ex) { } }
                            obj.close();
                        });

                        // Setup the serial tunnel, SSH ---> Relay WS
                        obj.ser.forwardwrite = function (data) { if ((data.length > 0) && (obj.wsClient != null)) { try { obj.wsClient.send(data); } catch (ex) { } } };

                        // Connect the SSH module to the serial tunnel
                        const connectionOptions = { sock: obj.ser }
                        if (typeof obj.username == 'string') { connectionOptions.username = obj.username; }
                        if (typeof obj.password == 'string') { connectionOptions.password = obj.password; }
                        if (typeof obj.privateKey == 'string') { connectionOptions.privateKey = obj.privateKey; }
                        if (typeof obj.privateKeyPass == 'string') { connectionOptions.passphrase = obj.privateKeyPass; }
                        try {
                            obj.sshClient.connect(connectionOptions);
                        } catch (ex) {
                            // Exception, this is generally because we did not provide proper credentials. Ask again.
                            obj.relayActive = false;
                            delete obj.sshClient;
                            delete obj.ser.forwardwrite;
                            obj.close();
                            return;
                        }

                        // We are all set, start receiving data
                        ws._socket.resume();
                    }
                } else {
                    if (typeof data == 'string') {
                        // Forward any ping/pong commands to the browser
                        var cmd = null;
                        try { cmd = JSON.parse(data); } catch (ex) { }
                        if ((cmd != null) && (cmd.ctrlChannel == '102938') && ((cmd.type == 'ping') || (cmd.type == 'pong'))) { obj.ws.send(data); }
                        return;
                    }

                    // Relay WS --> SSH
                    if ((data.length > 0) && (obj.ser != null)) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
                }
            });
            obj.wsClient.on('close', function () { parent.parent.debug('relay', 'SSH: Relay websocket closed'); obj.close(); });
            obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'SSH: Relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    // When data is received from the web socket
    // SSH default port is 22
    ws.on('message', function (data) {
        try {
            if (typeof data != 'string') return;
            if (data[0] == '{') {
                // Control data
                var msg = null;
                try { msg = JSON.parse(data); } catch (ex) { }
                if ((msg == null) || (typeof msg != 'object')) return;
                if ((msg.ctrlChannel == '102938') && ((msg.type == 'ping') || (msg.type == 'pong'))) { try { obj.wsClient.send(data); } catch (ex) { } return; }
                if (typeof msg.action != 'string') return;
                switch (msg.action) {
                    case 'connect': {
                        if (msg.useexisting) {
                            // Check if we have SSH credentials for this device
                            parent.parent.db.Get(obj.cookie.nodeid, function (err, nodes) {
                                if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
                                const node = nodes[0];
                                if ((domain.allowsavingdevicecredentials === false) || (node.ssh == null) || (typeof node.ssh != 'object') || (node.ssh[obj.userid] == null) || (typeof node.ssh[obj.userid].u != 'string') || ((typeof node.ssh[obj.userid].p != 'string') && (typeof node.ssh[obj.userid].k != 'string'))) {
                                    // Send a request for SSH authentication
                                    try { ws.send(JSON.stringify({ action: 'sshauth' })) } catch (ex) { }
                                } else if ((domain.allowsavingdevicecredentials !== false) && (node.ssh != null) && (typeof node.ssh[obj.userid].k == 'string') && (node.ssh[obj.userid].kp == null)) {
                                    // Send a request for SSH authentication with option for only the private key password
                                    obj.username = node.ssh[obj.userid].u;
                                    obj.privateKey = node.ssh[obj.userid].k;
                                    try { ws.send(JSON.stringify({ action: 'sshauth', askkeypass: true })) } catch (ex) { }
                                } else {
                                    // Use our existing credentials
                                    obj.termSize = msg;
                                    delete obj.keep;
                                    obj.username = node.ssh[obj.userid].u;
                                    if (typeof node.ssh[obj.userid].p == 'string') {
                                        obj.password = node.ssh[obj.userid].p;
                                    } else if (typeof node.ssh[obj.userid].k == 'string') {
                                        obj.privateKey = node.ssh[obj.userid].k;
                                        obj.privateKeyPass = node.ssh[obj.userid].kp;
                                    }
                                    startRelayConnection();
                                }
                            });
                        } else {
                            // Verify inputs
                            if ((typeof msg.username != 'string') || ((typeof msg.password != 'string') && (typeof msg.key != 'string'))) break;
                            if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                            obj.termSize = msg;
                            if (msg.keep === true) { msg.keep = 1; } // If true, change to 1. For user/pass, 1 to store user/pass in db. For user/key/pass, 1 to store user/key in db, 2 to store everything in db.
                            obj.keep = msg.keep; // If set, keep store credentials on the server if the SSH tunnel connected succesfully.
                            obj.username = msg.username;
                            obj.password = msg.password;
                            obj.privateKey = msg.key;
                            obj.privateKeyPass = msg.keypass;
                            startRelayConnection();
                        }
                        break;
                    }
                    case 'connectKeyPass': {
                        // Verify inputs
                        if (typeof msg.keypass != 'string') break;

                        // Check if we have SSH credentials for this device
                        obj.privateKeyPass = msg.keypass;
                        obj.termSize = msg;
                        parent.parent.db.Get(obj.cookie.nodeid, function (err, nodes) {
                            if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
                            const node = nodes[0];
                            if (node.ssh != null) {
                                obj.username = node.ssh.u;
                                obj.privateKey = node.ssh.k;
                                startRelayConnection();
                            }
                        });
                        break;
                    }
                    case 'resize': {
                        // Verify inputs
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        if (obj.sshShell != null) { obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width); }
                        break;
                    }
                }
            } else if (data[0] == '~') {
                // Terminal data
                if (obj.sshShell != null) { obj.sshShell.write(data.substring(1)); }
            }
        } catch (ex) { obj.close(); }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });

    parent.parent.debug('relay', 'SSH: Request for SSH relay (' + req.clientIp + ')');

    // Decode the authentication cookie
    obj.cookie = parent.parent.decodeCookie(req.query.auth, parent.parent.loginCookieEncryptionKey);
    if ((obj.cookie == null) || (obj.cookie.userid == null) || (parent.users[obj.cookie.userid] == null)) { obj.ws.send(JSON.stringify({ action: 'sessionerror' })); obj.close(); return; }
    obj.userid = obj.cookie.userid;

    // Get the meshid for this device
    parent.parent.db.Get(obj.cookie.nodeid, function (err, nodes) {
        if (obj.cookie == null) return; // obj has been cleaned up, just exit.
        if ((err != null) || (nodes == null) || (nodes.length != 1)) { parent.parent.debug('relay', 'SSH: Invalid device'); obj.close(); }
        const node = nodes[0];
        obj.nodeid = node._id; // Store the NodeID
        obj.meshid = node.meshid; // Store the MeshID
        obj.mtype = node.mtype; // Store the device group type

        // Check if we need to relay thru a different agent
        const mesh = parent.meshes[obj.meshid];
        if (mesh && mesh.relayid) {
            obj.relaynodeid = mesh.relayid;
            obj.tcpaddr = node.host;

            // Check if we have rights to the relayid device, does nothing if a relay is not used
            checkRelayRights(parent, domain, obj.cookie.userid, obj.relaynodeid, function (allowed) {
                if (obj.cookie == null) return; // obj has been cleaned up, just exit.
                if (allowed !== true) { parent.parent.debug('relay', 'SSH: Attempt to use un-authorized relay'); obj.close(); return; }

                // Re-encode a cookie with a device relay
                const cookieContent = { userid: obj.cookie.userid, domainid: obj.cookie.domainid, nodeid: mesh.relayid, tcpaddr: node.host, tcpport: obj.cookie.tcpport };
                obj.xcookie = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
            });
        } else {
            obj.xcookie = req.query.auth;
        }
    });

    return obj;
};


// Construct a SSH Terminal Relay object, called upon connection
module.exports.CreateSshTerminalRelay = function (parent, db, ws, req, domain, user, cookie, args) {
    const Net = require('net');
    const WebSocket = require('ws');

    // SerialTunnel object is used to embed SSH within another connection.
    function SerialTunnel(options) {
        const obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        obj.destroy = function () { delete obj.forwardwrite; }
        return obj;
    }

    const obj = {};
    obj.ws = ws;
    obj.relayActive = false;

    parent.parent.debug('relay', 'SSH: Request for SSH terminal relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Event the session ending
        if (obj.startTime) {
            // Collect how many raw bytes where received and sent.
            // We sum both the websocket and TCP client in this case.
            var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
            if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 123, msgArgs: [sessionSeconds, obj.sessionid], msg: "Left Web-SSH session \"" + obj.sessionid + "\" after " + sessionSeconds + " second(s).", protocol: PROTOCOL_WEBSSH, bytesin: inTraffc, bytesout: outTraffc };
            parent.parent.DispatchEvent(['*', obj.nodeid, user._id, obj.meshid], obj, event);
            delete obj.startTime;
            delete obj.sessionid;
        }

        if (obj.sshShell) {
            obj.sshShell.destroy();
            obj.sshShell.removeAllListeners('data');
            obj.sshShell.removeAllListeners('close');
            try { obj.sshShell.end(); } catch (ex) { console.log(ex); }
            delete obj.sshShell;
        }
        if (obj.sshClient) {
            obj.sshClient.destroy();
            obj.sshClient.removeAllListeners('ready');
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); }
            delete obj.sshClient;
        }
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (ex) { console.log(ex); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (ex) { console.log(ex); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();

        obj.relayActive = false;
        delete obj.termSize;
        delete obj.nodeid;
        delete obj.meshid;
        delete obj.ws;
    };

    // Save SSH credentials into device
    function saveSshCredentials(keep) {
        if (((keep != 1) && (keep != 2)) || (domain.allowsavingdevicecredentials == false)) return;
        parent.parent.db.Get(obj.nodeid, function (err, nodes) {
            if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
            const node = nodes[0];
            if (node.ssh == null) { node.ssh = {}; }

            // Check if credentials are the same
            //if ((typeof node.ssh == 'object') && (node.ssh.u == obj.username) && (node.ssh.p == obj.password)) return; // TODO

            // Clear up any existing credentials or credentials for users that don't exist anymore
            for (var i in node.ssh) { if (!i.startsWith('user/') || (parent.users[i] == null)) { delete node.ssh[i]; } }

            // Clear legacy credentials
            delete node.ssh.u;
            delete node.ssh.p;
            delete node.ssh.k;
            delete node.ssh.kp;

            // Save the credentials
            if (obj.password != null) {
                node.ssh[user._id] = { u: obj.username, p: obj.password };
            } else if (obj.privateKey != null) {
                node.ssh[user._id] = { u: obj.username, k: obj.privateKey };
                if (keep == 2) { node.ssh[user._id].kp = obj.privateKeyPass; }
            } else return;
            parent.parent.db.Set(node);

            // Event the node change
            const event = { etype: 'node', action: 'changenode', nodeid: obj.nodeid, domain: domain.id, userid: user._id, username: user.name, node: parent.CloneSafeNode(node), msg: "Changed SSH credentials" };
            if (parent.parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.nodeid]), obj, event);
        });
    }


    // Start the looppback server
    function startRelayConnection(authCookie) {
        try {
            // Setup the correct URL with domain and use TLS only if needed.
            const options = { rejectUnauthorized: false };
            const protocol = (args.tlsoffload) ? 'ws' : 'wss';
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            const url = protocol + '://localhost:' + args.port + '/' + domainadd + (((obj.mtype == 3) && (obj.relaynodeid == null)) ? 'local' : 'mesh') + 'relay.ashx?p=11&auth=' + authCookie // Protocol 11 is Web-SSH
            if (domain.id != '') { url += '&domainid=' + domain.id; } // Since we are using "localhost", we are going to signal what domain we are on using a URL argument.
            parent.parent.debug('relay', 'SSH: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.debug('relay', 'SSH: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if (obj.relayActive == false) {
                    if ((data == 'c') || (data == 'cr')) {
                        obj.relayActive = true;

                        // Create a serial tunnel && SSH module
                        obj.ser = new SerialTunnel();
                        const Client = require('ssh2').Client;
                        obj.sshClient = new Client();
                        obj.sshClient.on('ready', function () { // Authentication was successful.
                            // If requested, save the credentials
                            saveSshCredentials(obj.keep);
                            obj.sessionid = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            obj.startTime = Date.now();

                            try {
                                // Event start of session
                                const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 148, msgArgs: [obj.sessionid], msg: "Started Web-SSH session \"" + obj.sessionid + "\".", protocol: PROTOCOL_WEBSSH };
                                parent.parent.DispatchEvent(['*', obj.nodeid, user._id, obj.meshid], obj, event);
                            } catch (ex) {
                                console.log(ex);
                            }

                            obj.sshClient.shell(function (err, stream) { // Start a remote shell
                                if (err) { obj.close(); return; }
                                obj.sshShell = stream;
                                obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width);
                                obj.sshShell.on('close', function () { obj.close(); });
                                obj.sshShell.on('data', function (data) { obj.ws.send('~' + data.toString()); });
                            });

                            obj.connected = true;
                            obj.ws.send('c');
                        });
                        obj.sshClient.on('error', function (err) {
                            if (err.level == 'client-authentication') { try { obj.ws.send(JSON.stringify({ action: 'autherror' })); } catch (ex) { } }
                            if (err.level == 'client-timeout') { try { obj.ws.send(JSON.stringify({ action: 'sessiontimeout' })); } catch (ex) { } }
                            obj.close();
                        });

                        // Setup the serial tunnel, SSH ---> Relay WS
                        obj.ser.forwardwrite = function (data) { if ((data.length > 0) && (obj.wsClient != null)) { try { obj.wsClient.send(data); } catch (ex) { } } };

                        // Connect the SSH module to the serial tunnel
                        const connectionOptions = { sock: obj.ser }
                        if (typeof obj.username == 'string') { connectionOptions.username = obj.username; }
                        if (typeof obj.password == 'string') { connectionOptions.password = obj.password; }
                        if (typeof obj.privateKey == 'string') { connectionOptions.privateKey = obj.privateKey; }
                        if (typeof obj.privateKeyPass == 'string') { connectionOptions.passphrase = obj.privateKeyPass; }
                        try {
                            obj.sshClient.connect(connectionOptions);
                        } catch (ex) {
                            // Exception, this is generally because we did not provide proper credentials. Ask again.
                            obj.relayActive = false;
                            delete obj.sshClient;
                            delete obj.ser.forwardwrite;
                            try { ws.send(JSON.stringify({ action: 'sshauth', askkeypass: ((obj.username != null) && (obj.privateKey != null)) })) } catch (ex) { }
                        }

                        // We are all set, start receiving data
                        ws._socket.resume();
                    }
                } else {
                    if (typeof data == 'string') {
                        // Forward any ping/pong commands to the browser
                        var cmd = null;
                        try { cmd = JSON.parse(data); } catch (ex) { }
                        if ((cmd != null) && (cmd.ctrlChannel == '102938') && ((cmd.type == 'ping') || (cmd.type == 'pong'))) { try { obj.ws.send(data); } catch (ex) { console.log(ex); } }
                        return;
                    }

                    // Relay WS --> SSH
                    if ((data.length > 0) && (obj.ser != null)) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
                }
            });
            obj.wsClient.on('close', function () {
                if (obj.connected !== true) { try { obj.ws.send(JSON.stringify({ action: 'connectionerror' })); } catch (ex) { } }
                parent.parent.debug('relay', 'SSH: Relay websocket closed'); obj.close();
            });
            obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'SSH: Relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    // When data is received from the web socket
    // SSH default port is 22
    ws.on('message', function (data) {
        try {
            if (typeof data != 'string') return;
            if (data[0] == '{') {
                // Control data
                var msg = null;
                try { msg = JSON.parse(data); } catch (ex) { }
                if ((msg == null) || (typeof msg != 'object')) return;
                if ((msg.ctrlChannel == '102938') && ((msg.type == 'ping') || (msg.type == 'pong'))) { try { obj.wsClient.send(data); } catch (ex) { } return; }
                switch (msg.action) {
                    case 'sshauth': {
                        // Verify inputs
                        if ((typeof msg.username != 'string') || ((typeof msg.password != 'string') && (typeof msg.key != 'string'))) break;
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        if (msg.keep === true) { msg.keep = 1; } // If true, change to 1. For user/pass, 1 to store user/pass in db. For user/key/pass, 1 to store user/key in db, 2 to store everything in db.
                        obj.keep = msg.keep; // If set, keep store credentials on the server if the SSH tunnel connected succesfully.
                        obj.termSize = msg;
                        obj.username = msg.username;
                        obj.password = msg.password;
                        obj.privateKey = msg.key;
                        obj.privateKeyPass = msg.keypass;

                        // Create a mesh relay authentication cookie
                        const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.relaynodeid) {
                            cookieContent.nodeid = obj.relaynodeid;
                            cookieContent.tcpaddr = obj.tcpaddr;
                        } else {
                            if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        }
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                    case 'sshkeyauth': {
                        // Verify inputs
                        if (typeof msg.keypass != 'string') break;
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        delete obj.keep;
                        obj.termSize = msg;
                        obj.privateKeyPass = msg.keypass;

                        // Create a mesh relay authentication cookie
                        const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.relaynodeid) {
                            cookieContent.nodeid = obj.relaynodeid;
                            cookieContent.tcpaddr = obj.tcpaddr;
                        } else {
                            if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        }
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                    case 'sshautoauth': {
                        // Verify inputs
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;
                        obj.termSize = msg;

                        if ((obj.username == null) || ((obj.password == null) && (obj.privateKey == null))) return;

                        // Create a mesh relay authentication cookie
                        const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.relaynodeid) {
                            cookieContent.nodeid = obj.relaynodeid;
                            cookieContent.tcpaddr = obj.tcpaddr;
                        } else {
                            if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        }
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                    case 'resize': {
                        // Verify inputs
                        if ((typeof msg.rows != 'number') || (typeof msg.cols != 'number') || (typeof msg.height != 'number') || (typeof msg.width != 'number')) break;

                        obj.termSize = msg;
                        if (obj.sshShell != null) { obj.sshShell.setWindow(obj.termSize.rows, obj.termSize.cols, obj.termSize.height, obj.termSize.width); }
                        break;
                    }
                }
            } else if (data[0] == '~') {
                // Terminal data
                if (obj.sshShell != null) { obj.sshShell.write(data.substring(1)); }
            }
        } catch (ex) { obj.close(); }
    });

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });

    // Check that we have a user and nodeid
    if ((user == null) || (req.query.nodeid == null)) { obj.close(); return; } // Invalid nodeid
    parent.GetNodeWithRights(domain, user, req.query.nodeid, function (node, rights, visible) {
        if (obj.ws == null) return; // obj has been cleaned up, just exit.

        // Check permissions
        if ((rights & 8) == 0) { obj.close(); return; } // No MESHRIGHT_REMOTECONTROL rights
        if ((rights != 0xFFFFFFFF) && (rights & 0x00000200)) { obj.close(); return; } // MESHRIGHT_NOTERMINAL is set
        obj.mtype = node.mtype; // Store the device group type
        obj.nodeid = node._id; // Store the NodeID
        obj.meshid = node.meshid; // Store the MeshID

        // Check the SSH port
        obj.tcpport = 22;
        if (typeof node.sshport == 'number') { obj.tcpport = node.sshport; }

        // Check if we need to relay thru a different agent
        const mesh = parent.meshes[obj.meshid];
        if (mesh && mesh.relayid) { obj.relaynodeid = mesh.relayid; obj.tcpaddr = node.host; }

        // Check if we have rights to the relayid device, does nothing if a relay is not used
        checkRelayRights(parent, domain, user, obj.relaynodeid, function (allowed) {
            if (obj.ws == null) return; // obj has been cleaned up, just exit.
            if (allowed !== true) { parent.parent.debug('relay', 'SSH: Attempt to use un-authorized relay'); obj.close(); return; }

            // We are all set, start receiving data
            ws._socket.resume();

            // Check if we have SSH credentials for this device
            if ((domain.allowsavingdevicecredentials === false) || (node.ssh == null) || (typeof node.ssh != 'object') || (node.ssh[user._id] == null) || (typeof node.ssh[user._id].u != 'string') || ((typeof node.ssh[user._id].p != 'string') && (typeof node.ssh[user._id].k != 'string'))) {
                // Send a request for SSH authentication
                try { ws.send(JSON.stringify({ action: 'sshauth' })) } catch (ex) { }
            } else if ((typeof node.ssh[user._id].k == 'string') && (typeof node.ssh[user._id].kp != 'string')) {
                // Send a request for SSH authentication with option for only the private key password
                obj.username = node.ssh[user._id].u;
                obj.privateKey = node.ssh[user._id].k;
                try { ws.send(JSON.stringify({ action: 'sshauth', askkeypass: true })) } catch (ex) { }
            } else {
                // Use our existing credentials
                obj.username = node.ssh[user._id].u;
                if (typeof node.ssh[user._id].p == 'string') {
                    obj.password = node.ssh[user._id].p;
                } else if (typeof node.ssh[user._id].k == 'string') {
                    obj.privateKey = node.ssh[user._id].k;
                    obj.privateKeyPass = node.ssh[user._id].kp;
                }
                try { ws.send(JSON.stringify({ action: 'sshautoauth' })) } catch (ex) { }
            }
        });

    });

    return obj;
};



// Construct a SSH Files Relay object, called upon connection
module.exports.CreateSshFilesRelay = function (parent, db, ws, req, domain, user, cookie, args) {
    const Net = require('net');
    const WebSocket = require('ws');

    // SerialTunnel object is used to embed SSH within another connection.
    function SerialTunnel(options) {
        const obj = new require('stream').Duplex(options);
        obj.forwardwrite = null;
        obj.updateBuffer = function (chunk) { this.push(chunk); };
        obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } if (callback) callback(); }; // Pass data written to forward
        obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
        obj.destroy = function () { delete obj.forwardwrite; }
        return obj;
    }

    const obj = {};
    obj.ws = ws;
    obj.path = require('path');
    obj.relayActive = false;
    obj.firstMessage = true;

    parent.parent.debug('relay', 'SSH: Request for SSH files relay (' + req.clientIp + ')');

    // Disconnect
    obj.close = function (arg) {
        if (obj.ws == null) return;

        // Event the session ending
        if (obj.startTime) {
            // Collect how many raw bytes where received and sent.
            // We sum both the websocket and TCP client in this case.
            var inTraffc = obj.ws._socket.bytesRead, outTraffc = obj.ws._socket.bytesWritten;
            if (obj.wsClient != null) { inTraffc += obj.wsClient._socket.bytesRead; outTraffc += obj.wsClient._socket.bytesWritten; }
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: user._id, username: user.name, sessionid: obj.sessionid, msgid: 124, msgArgs: [sessionSeconds, obj.sessionid], msg: "Left Web-SFTP session \"" + obj.sessionid + "\" after " + sessionSeconds + " second(s).", protocol: PROTOCOL_WEBSFTP, bytesin: inTraffc, bytesout: outTraffc };
            parent.parent.DispatchEvent(['*', obj.nodeid, user._id, obj.meshid], obj, event);
            delete obj.startTime;
            delete obj.sessionid;
        }

        if (obj.sshClient) {
            obj.sshClient.destroy();
            obj.sshClient.removeAllListeners('ready');
            try { obj.sshClient.end(); } catch (ex) { console.log(ex); }
            delete obj.sshClient;
        }
        if (obj.wsClient) {
            obj.wsClient.removeAllListeners('open');
            obj.wsClient.removeAllListeners('message');
            obj.wsClient.removeAllListeners('close');
            try { obj.wsClient.close(); } catch (ex) { console.log(ex); }
            delete obj.wsClient;
        }

        if ((arg == 1) || (arg == null)) { try { ws.close(); } catch (ex) { console.log(ex); } } // Soft close, close the websocket
        if (arg == 2) { try { ws._socket._parent.end(); } catch (ex) { console.log(ex); } } // Hard close, close the TCP socket
        obj.ws.removeAllListeners();

        obj.relayActive = false;
        delete obj.sftp;
        delete obj.nodeid;
        delete obj.meshid;
        delete obj.ws;
    };

    // Save SSH credentials into device
    function saveSshCredentials(keep) {
        if (((keep != 1) && (keep != 2)) || (domain.allowsavingdevicecredentials == false)) return;
        parent.parent.db.Get(obj.nodeid, function (err, nodes) {
            if ((err != null) || (nodes == null) || (nodes.length != 1)) return;
            const node = nodes[0];
            if (node.ssh == null) { node.ssh = {}; }

            // Check if credentials are the same
            //if ((typeof node.ssh[obj.userid] == 'object') && (node.ssh[obj.userid].u == obj.username) && (node.ssh[obj.userid].p == obj.password)) return; // TODO

            // Clear up any existing credentials or credentials for users that don't exist anymore
            for (var i in node.ssh) { if (!i.startsWith('user/') || (parent.users[i] == null)) { delete node.ssh[i]; } }

            // Clear legacy credentials
            delete node.ssh.u;
            delete node.ssh.p;
            delete node.ssh.k;
            delete node.ssh.kp;

            // Save the credentials
            if (obj.password != null) {
                node.ssh[user._id] = { u: obj.username, p: obj.password };
            } else if (obj.privateKey != null) {
                node.ssh[user._id] = { u: obj.username, k: obj.privateKey };
                if (keep == 2) { node.ssh[user._id].kp = obj.privateKeyPass; }
            } else return;
            parent.parent.db.Set(node);

            // Event the node change
            const event = { etype: 'node', action: 'changenode', nodeid: obj.nodeid, domain: domain.id, userid: user._id, username: user.name, node: parent.CloneSafeNode(node), msg: "Changed SSH credentials" };
            if (parent.parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.nodeid]), obj, event);
        });
    }


    // Start the looppback server
    function startRelayConnection(authCookie) {
        try {
            // Setup the correct URL with domain and use TLS only if needed.
            const options = { rejectUnauthorized: false };
            const protocol = (args.tlsoffload) ? 'ws' : 'wss';
            var domainadd = '';
            if ((domain.dns == null) && (domain.id != '')) { domainadd = domain.id + '/' }
            const url = protocol + '://localhost:' + args.port + '/' + domainadd + (((obj.mtype == 3) && (obj.relaynodeid == null)) ? 'local' : 'mesh') + 'relay.ashx?p=13&auth=' + authCookie // Protocol 13 is Web-SSH-Files
            if (domain.id != '') { url += '&domainid=' + domain.id; } // Since we are using "localhost", we are going to signal what domain we are on using a URL argument.
            parent.parent.debug('relay', 'SSH: Connection websocket to ' + url);
            obj.wsClient = new WebSocket(url, options);
            obj.wsClient.on('open', function () { parent.parent.debug('relay', 'SSH: Relay websocket open'); });
            obj.wsClient.on('message', function (data) { // Make sure to handle flow control.
                if (obj.relayActive == false) {
                    if ((data == 'c') || (data == 'cr')) {
                        obj.relayActive = true;

                        // Create a serial tunnel && SSH module
                        obj.ser = new SerialTunnel();
                        const Client = require('ssh2').Client;
                        obj.sshClient = new Client();
                        obj.sshClient.on('ready', function () { // Authentication was successful.
                            // If requested, save the credentials
                            saveSshCredentials(obj.keep);
                            obj.sessionid = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
                            obj.startTime = Date.now();

                            // Event start of session
                            try {
                                const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 149, msgArgs: [obj.sessionid], msg: "Started Web-SFTP session \"" + obj.sessionid + "\".", protocol: PROTOCOL_WEBSFTP };
                                parent.parent.DispatchEvent(['*', obj.nodeid, user._id, obj.meshid], obj, event);
                            } catch (ex) { console.log(ex); }

                            obj.sshClient.sftp(function (err, sftp) {
                                if (err) { obj.close(); return; }
                                obj.connected = true;
                                obj.sftp = sftp;
                                obj.ws.send('c');
                            });
                        });
                        obj.sshClient.on('error', function (err) {
                            if (err.level == 'client-authentication') { try { obj.ws.send(JSON.stringify({ action: 'autherror' })); } catch (ex) { } }
                            if (err.level == 'client-timeout') { try { obj.ws.send(JSON.stringify({ action: 'sessiontimeout' })); } catch (ex) { } }
                            obj.close();
                        });

                        // Setup the serial tunnel, SSH ---> Relay WS
                        obj.ser.forwardwrite = function (data) { if ((data.length > 0) && (obj.wsClient != null)) { try { obj.wsClient.send(data); } catch (ex) { } } };

                        // Connect the SSH module to the serial tunnel
                        const connectionOptions = { sock: obj.ser }
                        if (typeof obj.username == 'string') { connectionOptions.username = obj.username; }
                        if (typeof obj.password == 'string') { connectionOptions.password = obj.password; }
                        if (typeof obj.privateKey == 'string') { connectionOptions.privateKey = obj.privateKey; }
                        if (typeof obj.privateKeyPass == 'string') { connectionOptions.passphrase = obj.privateKeyPass; }
                        try {
                            obj.sshClient.connect(connectionOptions);
                        } catch (ex) {
                            // Exception, this is generally because we did not provide proper credentials. Ask again.
                            obj.relayActive = false;
                            delete obj.sshClient;
                            delete obj.ser.forwardwrite;
                            try { ws.send(JSON.stringify({ action: 'sshauth', askkeypass: ((obj.username != null) && (obj.privateKey != null)) })) } catch (ex) { }
                        }

                        // We are all set, start receiving data
                        ws._socket.resume();
                    }
                } else {
                    if (typeof data == 'string') {
                        // Forward any ping/pong commands to the browser
                        var cmd = null;
                        try { cmd = JSON.parse(data); } catch (ex) { }
                        if ((cmd != null) && (cmd.ctrlChannel == '102938') && ((cmd.type == 'ping') || (cmd.type == 'pong'))) { obj.ws.send(data); }
                        return;
                    }

                    // Relay WS --> SSH
                    if ((data.length > 0) && (obj.ser != null)) { try { obj.ser.updateBuffer(data); } catch (ex) { console.log(ex); } }
                }
            });
            obj.wsClient.on('close', function () {
                if (obj.connected !== true) { try { obj.ws.send(JSON.stringify({ action: 'connectionerror' })); } catch (ex) { } }
                parent.parent.debug('relay', 'SSH: Files relay websocket closed'); obj.close();
            });
            obj.wsClient.on('error', function (err) { parent.parent.debug('relay', 'SSH: Files relay websocket error: ' + err); obj.close(); });
        } catch (ex) {
            console.log(ex);
        }
    }

    // When data is received from the web socket
    // SSH default port is 22
    ws.on('message', function (data) {
        //if ((obj.firstMessage === true) && (msg != 5)) { obj.close(); return; } else { delete obj.firstMessage; }
        try {
            if (typeof data != 'string') {
                if (data[0] == 123) {
                    data = data.toString();
                } else if ((obj.sftp != null) && (obj.uploadHandle != null)) {
                    const off = (data[0] == 0) ? 1 : 0;
                    obj.sftp.write(obj.uploadHandle, data, off, data.length - off, obj.uploadPosition, function (err) {
                        if (err != null) {
                            obj.sftp.close(obj.uploadHandle, function () { });
                            try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploaddone', reqid: obj.uploadReqid }))) } catch (ex) { }
                            delete obj.uploadHandle;
                            delete obj.uploadFullpath;
                            delete obj.uploadSize;
                            delete obj.uploadReqid;
                            delete obj.uploadPosition;
                        } else {
                            try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploadack', reqid: obj.uploadReqid }))) } catch (ex) { }
                        }
                    });
                    obj.uploadPosition += (data.length - off);
                    return;
                }
            }
            if (data[0] == '{') {
                // Control data
                var msg = null;
                try { msg = JSON.parse(data); } catch (ex) { }
                if ((msg == null) || (typeof msg != 'object')) return;
                if ((msg.ctrlChannel == '102938') && ((msg.type == 'ping') || (msg.type == 'pong'))) { try { obj.wsClient.send(data); } catch (ex) { } return; }
                if (typeof msg.action != 'string') return;
                switch (msg.action) {
                    case 'ls': {
                        if (obj.sftp == null) return;
                        var requestedPath = msg.path;
                        if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                        obj.sftp.readdir(requestedPath, function(err, list) {
                            if (err) { console.log(err); obj.close(); }
                            const r = { path: requestedPath, reqid: msg.reqid, dir: [] };
                            for (var i in list) {
                                const file = list[i];
                                if (file.longname[0] == 'd') { r.dir.push({ t: 2, n: file.filename, d: new Date(file.attrs.mtime * 1000).toISOString() }); }
                                else { r.dir.push({ t: 3, n: file.filename, d: new Date(file.attrs.mtime * 1000).toISOString(), s: file.attrs.size }); }
                            }
                            try { obj.ws.send(Buffer.from(JSON.stringify(r))) } catch (ex) { }
                        });
                        break;
                    }
                    case 'mkdir': {
                        if (obj.sftp == null) return;
                        var requestedPath = msg.path;
                        if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                        obj.sftp.mkdir(requestedPath, function (err) { });

                        // Event the file delete
                        const targets = ['*', 'server-users'];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        parent.parent.DispatchEvent(targets, obj, { etype: 'node', action: 'agentlog', nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 44, msgArgs: [requestedPath], msg: 'Create folder: \"' + requestedPath + '\"', domain: domain.id });
                        break;
                    }
                    case 'rm': {
                        if (obj.sftp == null) return;
                        var requestedPath = msg.path;
                        if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                        for (var i in msg.delfiles) {
                            const ul = obj.path.join(requestedPath, msg.delfiles[i]).split('\\').join('/');
                            obj.sftp.unlink(ul, function (err) { });
                            if (msg.rec === true) { obj.sftp.rmdir(ul + '/', function (err) { }); }

                            // Event the file delete
                            const targets = ['*', 'server-users'];
                            if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                            parent.parent.DispatchEvent(targets, obj, { etype: 'node', action: 'agentlog', nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 45, msgArgs: [ul], msg: 'Delete: \"' + ul + '\"', domain: domain.id });
                        }

                        break;
                    }
                    case 'rename': {
                        if (obj.sftp == null) return;
                        var requestedPath = msg.path;
                        if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                        const oldpath = obj.path.join(requestedPath, msg.oldname).split('\\').join('/');
                        const newpath = obj.path.join(requestedPath, msg.newname).split('\\').join('/');
                        obj.sftp.rename(oldpath, newpath, function (err) { });

                        // Event the file rename
                        const targets = ['*', 'server-users'];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        parent.parent.DispatchEvent(targets, obj, { etype: 'node', action: 'agentlog', nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 48, msgArgs: [oldpath, msg.newname], msg: 'Rename: \"' + oldpath + '\" to \"' + msg.newname + '\"', domain: domain.id });
                        break;
                    }
                    case 'upload': {
                        if (obj.sftp == null) return;
                        var requestedPath = msg.path;
                        if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                        obj.uploadFullpath = obj.path.join(requestedPath, msg.name).split('\\').join('/');
                        obj.uploadSize = msg.size;
                        obj.uploadReqid = msg.reqid;
                        obj.uploadPosition = 0;
                        obj.sftp.open(obj.uploadFullpath, 'w', 0o666, function (err, handle) {
                            if (err != null) {
                                try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploaderror', reqid: obj.uploadReqid }))) } catch (ex) { }
                            } else {
                                obj.uploadHandle = handle;
                                try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploadstart', reqid: obj.uploadReqid }))) } catch (ex) { }

                                // Event the file upload
                                const targets = ['*', 'server-users'];
                                if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                                parent.parent.DispatchEvent(targets, obj, { etype: 'node', action: 'agentlog', nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 105, msgArgs: [obj.uploadFullpath, obj.uploadSize], msg: 'Upload: ' + obj.uploadFullpath + ', Size: ' + obj.uploadSize, domain: domain.id });
                            }
                        });
                        break;
                    }
                    case 'uploaddone': {
                        if (obj.sftp == null) return;
                        if (obj.uploadHandle != null) {
                            obj.sftp.close(obj.uploadHandle, function () { });
                            try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploaddone', reqid: obj.uploadReqid }))) } catch (ex) { }
                            delete obj.uploadHandle;
                            delete obj.uploadFullpath;
                            delete obj.uploadSize;
                            delete obj.uploadReqid;
                            delete obj.uploadPosition;
                        }
                        break;
                    }
                    case 'uploadcancel': {
                        if (obj.sftp == null) return;
                        if (obj.uploadHandle != null) {
                            obj.sftp.close(obj.uploadHandle, function () { });
                            obj.sftp.unlink(obj.uploadFullpath, function (err) { });
                            try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'uploadcancel', reqid: obj.uploadReqid }))) } catch (ex) { }
                            delete obj.uploadHandle;
                            delete obj.uploadFullpath;
                            delete obj.uploadSize;
                            delete obj.uploadReqid;
                            delete obj.uploadPosition;
                        }
                        break;
                    }
                    case 'download': {
                        if (obj.sftp == null) return;
                        switch (msg.sub) {
                            case 'start': {
                                var requestedPath = msg.path;
                                if (requestedPath.startsWith('/') == false) { requestedPath = '/' + requestedPath; }
                                obj.downloadFullpath = requestedPath;
                                obj.downloadId = msg.id;
                                obj.downloadPosition = 0;
                                obj.downloadBuffer = Buffer.alloc(16384);
                                obj.sftp.open(obj.downloadFullpath, 'r', function (err, handle) {
                                    if (err != null) {
                                        try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'download', sub: 'cancel', id: obj.downloadId }))) } catch (ex) { }
                                    } else {
                                        obj.downloadHandle = handle;
                                        try { obj.ws.send(JSON.stringify({ action: 'download', sub: 'start', id: obj.downloadId })) } catch (ex) { }

                                        // Event the file download
                                        const targets = ['*', 'server-users'];
                                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                                        parent.parent.DispatchEvent(targets, obj, { etype: 'node', action: 'agentlog', nodeid: obj.nodeid, userid: user._id, username: user.name, msgid: 49, msgArgs: [obj.downloadFullpath], msg: 'Download: ' + obj.downloadFullpath, domain: domain.id });
                                    }
                                });
                                break;
                            }
                            case 'startack': {
                                if ((obj.downloadHandle == null) || (obj.downloadId != msg.id)) break;
                                obj.downloadPendingBlockCount = (typeof msg.ack == 'number') ? msg.ack : 8;
                                uploadNextBlock();
                                break;
                            }
                            case 'ack': {
                                if ((obj.downloadHandle == null) || (obj.downloadId != msg.id)) break;
                                if (obj.downloadPendingBlockCount == 0) { obj.downloadPendingBlockCount = 1; uploadNextBlock(); }
                                break;
                            }
                            case 'stop': {
                                if ((obj.downloadHandle == null) || (obj.downloadId != msg.id)) break;
                                if (obj.downloadHandle != null) { obj.sftp.close(obj.downloadHandle, function () { }); }
                                delete obj.downloadId;
                                delete obj.downloadBuffer;
                                delete obj.downloadHandle;
                                delete obj.downloadFullpath;
                                delete obj.downloadPosition;
                                delete obj.downloadPendingBlockCount;
                                break;
                            }
                        }
                        break;
                    }
                    case 'sshauth': {
                        if (obj.sshClient != null) return;

                        // Verify inputs
                        if ((typeof msg.username != 'string') || ((typeof msg.password != 'string') && (typeof msg.key != 'string'))) break;

                        if (msg.keep === true) { msg.keep = 1; } // If true, change to 1. For user/pass, 1 to store user/pass in db. For user/key/pass, 1 to store user/key in db, 2 to store everything in db.
                        obj.keep = msg.keep; // If set, keep store credentials on the server if the SSH tunnel connected succesfully.
                        obj.username = msg.username;
                        obj.password = msg.password;
                        obj.privateKey = msg.key;
                        obj.privateKeyPass = msg.keypass;

                        // Create a mesh relay authentication cookie
                        const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.relaynodeid) {
                            cookieContent.nodeid = obj.relaynodeid;
                            cookieContent.tcpaddr = obj.tcpaddr;
                        } else {
                            if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        }
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                    case 'sshkeyauth': {
                        if (obj.sshClient != null) return;

                        // Verify inputs
                        if (typeof msg.keypass != 'string') break;

                        delete obj.keep;
                        obj.privateKeyPass = msg.keypass;

                        // Create a mesh relay authentication cookie
                        const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                        if (obj.relaynodeid) {
                            cookieContent.nodeid = obj.relaynodeid;
                            cookieContent.tcpaddr = obj.tcpaddr;
                        } else {
                            if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                        }
                        startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
                        break;
                    }
                }
            }
        } catch (ex) { obj.close(); }
    });

    function uploadNextBlock() {
        if (obj.downloadBuffer == null) return;
        obj.sftp.read(obj.downloadHandle, obj.downloadBuffer, 4, obj.downloadBuffer.length - 4, obj.downloadPosition, function (err, len, buf) {
            obj.downloadPendingBlockCount--;
            if (obj.downloadBuffer == null) return;
            if (err != null) {
                try { obj.ws.send(Buffer.from(JSON.stringify({ action: 'download', sub: 'cancel', id: obj.downloadId }))) } catch (ex) { }
            } else {
                obj.downloadPosition += len;
                if (len < (obj.downloadBuffer.length - 4)) {
                    obj.downloadBuffer.writeInt32BE(0x01000001, 0)
                    if (len > 0) { try { obj.ws.send(obj.downloadBuffer.slice(0, len + 4)); } catch (ex) { console.log(ex); } }
                } else {
                    obj.downloadBuffer.writeInt32BE(0x01000000, 0);
                    try { obj.ws.send(obj.downloadBuffer.slice(0, len + 4)); } catch (ex) { console.log(ex); }
                    if (obj.downloadPendingBlockCount > 0) { uploadNextBlock(); }
                    return;
                }
            }
            if (obj.downloadHandle != null) { obj.sftp.close(obj.downloadHandle, function () { }); }
            delete obj.downloadId;
            delete obj.downloadBuffer;
            delete obj.downloadHandle;
            delete obj.downloadFullpath;
            delete obj.downloadPosition;
            delete obj.downloadPendingBlockCount;
        });
    }

    // If error, do nothing
    ws.on('error', function (err) { parent.parent.debug('relay', 'SSH: Browser websocket error: ' + err); obj.close(); });

    // If the web socket is closed
    ws.on('close', function (req) { parent.parent.debug('relay', 'SSH: Browser websocket closed'); obj.close(); });

    // Check that we have a user and nodeid
    if ((user == null) || (req.query.nodeid == null)) { obj.close(); return; } // Invalid nodeid
    parent.GetNodeWithRights(domain, user, req.query.nodeid, function (node, rights, visible) {
        if (obj.ws == null) return; // obj has been cleaned up, just exit.

        // Check permissions
        if ((rights & 8) == 0) { obj.close(); return; } // No MESHRIGHT_REMOTECONTROL rights
        if ((rights != 0xFFFFFFFF) && (rights & 0x00000200)) { obj.close(); return; } // MESHRIGHT_NOTERMINAL is set
        obj.mtype = node.mtype; // Store the device group type
        obj.nodeid = node._id; // Store the NodeID
        obj.meshid = node.meshid; // Store the MeshID

        // Check the SSH port
        obj.tcpport = 22;
        if (typeof node.sshport == 'number') { obj.tcpport = node.sshport; }

        // Check if we need to relay thru a different agent
        const mesh = parent.meshes[obj.meshid];
        if (mesh && mesh.relayid) { obj.relaynodeid = mesh.relayid; obj.tcpaddr = node.host; }

        // Check if we have rights to the relayid device, does nothing if a relay is not used
        checkRelayRights(parent, domain, user, obj.relaynodeid, function (allowed) {
            if (obj.ws == null) return; // obj has been cleaned up, just exit.
            if (allowed !== true) { parent.parent.debug('relay', 'SSH: Attempt to use un-authorized relay'); obj.close(); return; }

            // We are all set, start receiving data
            ws._socket.resume();

            // Check if we have SSH credentials for this device
            if ((domain.allowsavingdevicecredentials === false) || (node.ssh == null) || (typeof node.ssh != 'object') || (node.ssh[user._id] == null) || (typeof node.ssh[user._id].u != 'string') || ((typeof node.ssh[user._id].p != 'string') && (typeof node.ssh[user._id].k != 'string'))) {
                // Send a request for SSH authentication
                try { ws.send(JSON.stringify({ action: 'sshauth' })) } catch (ex) { }
            } else if ((typeof node.ssh[user._id].k == 'string') && (typeof node.ssh[user._id].kp != 'string')) {
                // Send a request for SSH authentication with option for only the private key password
                obj.username = node.ssh[user._id].u;
                obj.privateKey = node.ssh[user._id].k;
                try { ws.send(JSON.stringify({ action: 'sshauth', askkeypass: true })) } catch (ex) { }
            } else {
                // Use our existing credentials
                obj.username = node.ssh[user._id].u;
                if (typeof node.ssh[user._id].p == 'string') {
                    obj.password = node.ssh[user._id].p;
                } else if (typeof node.ssh[user._id].k == 'string') {
                    obj.privateKey = node.ssh[user._id].k;
                    obj.privateKeyPass = node.ssh[user._id].kp;
                }

                // Create a mesh relay authentication cookie
                const cookieContent = { userid: user._id, domainid: user.domain, nodeid: obj.nodeid, tcpport: obj.tcpport };
                if (obj.relaynodeid) {
                    cookieContent.nodeid = obj.relaynodeid;
                    cookieContent.tcpaddr = obj.tcpaddr;
                } else {
                    if (obj.mtype == 3) { cookieContent.lc = 1; } // This is a local device
                }
                startRelayConnection(parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey));
            }
        });
    });

    return obj;
};


// Check that the user has full rights on a relay device before allowing it.
function checkRelayRights(parent, domain, user, relayNodeId, func) {
    if (relayNodeId == null) { func(true); return; } // No relay, do nothing.
    parent.GetNodeWithRights(domain, user, relayNodeId, function (node, rights, visible) {
        func((node != null) && ((rights & 0x00200008) != 0)); // MESHRIGHT_REMOTECONTROL or MESHRIGHT_RELAY rights
    });
}
