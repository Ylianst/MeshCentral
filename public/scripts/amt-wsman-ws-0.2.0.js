/** 
* @description WSMAN communication using websocket
* @author Ylian Saint-Hilaire
* @version v0.2.0c
*/

// Construct a WSMAN communication object
var CreateWsmanComm = function (host, port, user, pass, tls) {
    var obj = {};
    obj.PendingAjax = [];               // List of pending AJAX calls. When one frees up, another will start.
    obj.ActiveAjaxCount = 0;            // Number of currently active AJAX calls
    obj.MaxActiveAjaxCount = 1;         // Maximum number of activate AJAX calls at the same time.
    obj.FailAllError = 0;               // Set this to non-zero to fail all AJAX calls with that error status, 999 causes responses to be silent.
    obj.challengeParams = null;
    obj.noncecounter = 1;
    obj.authcounter = 0;
    obj.socket = null;
    obj.socketState = 0;
    obj.host = host;
    obj.port = port;
    obj.user = user;
    obj.pass = pass;
    obj.tls = tls;
    obj.tlsv1only = 1;
    obj.cnonce = Math.random().toString(36).substring(7); // Generate a random client nonce

    // Private method
    //obj.Debug = function (msg) { console.log(msg); }

    function arrToStr(arr) { return String.fromCharCode.apply(null, arr); }

    // Private method
    //   pri = priority, if set to 1, the call is high priority and put on top of the stack.
    obj.PerformAjax = function (postdata, callback, tag, pri, url, action) {
        if (obj.ActiveAjaxCount < obj.MaxActiveAjaxCount && obj.PendingAjax.length == 0) {
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
        //console.log("SEND: " + postdata); // DEBUG

        // We are in a websocket relay environment 
        obj.ActiveAjaxCount++;
        return obj.PerformAjaxExNodeJS(postdata, callback, tag, url, action);
    }

    // Websocket relay specific private method
    obj.pendingAjaxCall = [];

    // Websocket relay specific private method
    obj.PerformAjaxExNodeJS = function (postdata, callback, tag, url, action) { obj.PerformAjaxExNodeJS2(postdata, callback, tag, url, action, 3); }

    // Websocket relay specific private method
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

    // Websocket relay specific private method (Content Length Encoding)
    obj.sendRequest = function (postdata, url, action) {
        url = url ? url : '/wsman';
        action = action ? action : 'POST';
        var h = action + ' ' + url + ' HTTP/1.1\r\n';
        if (obj.challengeParams != null) {
            var response = hex_md5(hex_md5(obj.user + ':' + obj.challengeParams['realm'] + ':' + obj.pass) + ':' + obj.challengeParams['nonce'] + ':' + nonceHex(obj.noncecounter) + ':' + obj.cnonce + ':' + obj.challengeParams['qop'] + ':' + hex_md5(action + ':' + url + ((obj.challengeParams['qop'] == 'auth-int') ? (':' + hex_md5(postdata)) : '')));
            h += 'Authorization: ' + obj.renderDigest({ 'username': obj.user, 'realm': obj.challengeParams['realm'], 'nonce': obj.challengeParams['nonce'], 'uri': url, 'qop': obj.challengeParams['qop'], 'response': response, 'nc': nonceHex(obj.noncecounter++), 'cnonce': obj.cnonce }) + '\r\n';
        }
        //h += 'Host: ' + obj.host + ':' + obj.port + '\r\nContent-Length: ' + postdata.length + '\r\n\r\n' + postdata; // Use Content-Length
        h += 'Host: ' + obj.host + ':' + obj.port + '\r\nTransfer-Encoding: chunked\r\n\r\n' + postdata.length.toString(16).toUpperCase() + '\r\n' + postdata + '\r\n0\r\n\r\n'; // Use Chunked-Encoding
        _Send(h);
        //obj.Debug("SEND: " + h); // Display send packet
    }

    // Parse the HTTP digest header and return a list of key & values.
    obj.parseDigest = function (header) { return correctedQuoteSplit(header.substring(7)).reduce(function (obj, s) { var parts = s.trim().split('='); obj[parts[0]] = parts[1].replace(new RegExp('\"', 'g'), ''); return obj; }, {}) }

    // Split a string on quotes but do not do it when in quotes
    function correctedQuoteSplit(str) { return str.split(',').reduce(function (a, c) { if (a.ic) { a.st[a.st.length - 1] += ',' + c } else { a.st.push(c) } if (c.split('"').length % 2 == 0) { a.ic = !a.ic } return a; }, { st: [], ic: false }).st }
    function nonceHex(v) { var s = ('00000000' + v.toString(16)); return s.substring(s.length - 8); }

    // Websocket relay specific private method
    obj.renderDigest = function (params) {
        var paramsnames = [];
        for (i in params) { paramsnames.push(i); }
        return 'Digest ' + paramsnames.reduce(function (s1, ii) { return s1 + ',' + (((ii == 'nc') || (ii == 'qop')) ? (ii + '=' + params[ii]) : (ii + '="' + params[ii] + '"')); }, '').substring(1);
    }

    // Websocket relay specific private method
    obj.xxConnectHttpSocket = function () {
        //obj.Debug("xxConnectHttpSocket");
        obj.socketParseState = 0;
        obj.socketAccumulator = '';
        obj.socketHeader = null;
        obj.socketData = '';
        obj.socketState = 1;
        obj.socket = new WebSocket(window.location.protocol.replace('http', 'ws') + '//' + window.location.host + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/webrelay.ashx?p=1&host=' + obj.host + '&port=' + obj.port + '&tls=' + obj.tls + '&tlsv1only=' + obj.tlsv1only + ((user == '*') ? '&serverauth=1' : '') + ((typeof pass === 'undefined') ? ('&serverauth=1&user=' + user) : '')); // The "p=1" indicates to the relay that this is a WSMAN session
        obj.socket.binaryType = 'arraybuffer';
        obj.socket.onopen = _OnSocketConnected;
        obj.socket.onmessage = _OnMessage;
        obj.socket.onclose = _OnSocketClosed;
    }

    // Websocket relay specific private method
    function _OnSocketConnected() {
        //obj.Debug("xxOnSocketConnected");
        obj.socketState = 2;
        for (i in obj.pendingAjaxCall) { obj.sendRequest(obj.pendingAjaxCall[i][0], obj.pendingAjaxCall[i][3], obj.pendingAjaxCall[i][4]); }
    }

    // Websocket relay specific private method
    function _OnMessage(e) {
        //obj.Debug("_OnSocketData (" + data.byteLength + "): " + data);
        obj.socketAccumulator += arrToStr(new Uint8Array(e.data));
        while (true) {
            if (obj.socketParseState == 0) {
                var headersize = obj.socketAccumulator.indexOf('\r\n\r\n');
                if (headersize < 0) return;
                //obj.Debug(obj.socketAccumulator.substring(0, headersize)); // Display received HTTP header
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
                    var clen = obj.socketAccumulator.indexOf("\r\n");
                    if (clen < 0) return; // Chunk length not found, exit now and get more data.
                    // Chunk length if found, lets see if we can get the data.
                    csize = parseInt(obj.socketAccumulator.substring(0, clen), 16);
                    if (isNaN(csize)) { if (obj.websocket) { obj.websocket.close(); } return; } // Critical error, close the socket and exit.
                    if (obj.socketAccumulator.length < clen + 2 + csize + 2) return;
                    // We got a chunk with all of the data, handle the chunck now.
                    var data = obj.socketAccumulator.substring(clen + 2, clen + 2 + csize);
                    obj.socketAccumulator = obj.socketAccumulator.substring(clen + 2 + csize + 2);
                    obj.socketData += data;
                }
                if (csize == 0) {
                    //obj.Debug("_OnSocketData DONE: (" + obj.socketData.length + "): " + obj.socketData);
                    _ProcessHttpResponse(obj.socketXHeader, obj.socketData);
                    obj.socketParseState = 0;
                    obj.socketHeader = null;
                }
            }
        }
    }

    // Websocket relay specific private method
    function _ProcessHttpResponse(header, data) {
        //obj.Debug("_ProcessHttpResponse: " + header.Directive[1]);

        var s = parseInt(header.Directive[1]);
        if (isNaN(s)) s = 602;
        if (s == 401 && ++(obj.authcounter) < 3) {
            obj.challengeParams = obj.parseDigest(header['www-authenticate']); // Set the digest parameters, after this, the socket will close and we will auto-retry
            if (obj.challengeParams['qop'] != null) {
                var qopList = obj.challengeParams['qop'].split(',');
                for (var i in qopList) { qopList[i] = qopList[i].trim(); }
                if (qopList.indexOf('auth-int') >= 0) { obj.challengeParams['qop'] = 'auth-int'; } else { obj.challengeParams['qop'] = 'auth'; }
            }
        } else {
            var r = obj.pendingAjaxCall.shift();
            // if (s != 200) { obj.Debug("Error, status=" + s + "\r\n\r\nreq=" + r[0] + "\r\n\r\nresp=" + data); } // Debug: Display the request & response if something did not work.
            obj.authcounter = 0;
            obj.ActiveAjaxCount--;
            obj.gotNextMessages(data, 'success', { status: s }, r);
            obj.PerformNextAjax();
        }
    }

    // Websocket relay specific private method
    function _OnSocketClosed(data) {
        //obj.Debug("_OnSocketClosed");
        obj.socketState = 0;
        if (obj.socket != null) { obj.socket.close(); obj.socket = null; }
        if (obj.pendingAjaxCall.length > 0) {
            var r = obj.pendingAjaxCall.shift();
            var retry = r[5];
            obj.PerformAjaxExNodeJS2(r[0], r[1], r[2], r[3], r[4], --retry);
        }
    }

    // Websocket relay specific private method
    function _Send(x) {
        //console.log("SEND: " + x); // DEBUG
        if (obj.socketState == 2 && obj.socket != null && obj.socket.readyState == WebSocket.OPEN) {
            var b = new Uint8Array(x.length);
            for (var i = 0; i < x.length; ++i) { b[i] = x.charCodeAt(i); }
            try { obj.socket.send(b.buffer); } catch (e) { }
        }
    }

    // Private method
    obj.gotNextMessages = function (data, status, request, callArgs) {
        if (obj.FailAllError == 999) return;
        if (obj.FailAllError != 0) { callArgs[1](null, obj.FailAllError, callArgs[2]); return; }
        if (request.status != 200) { callArgs[1](null, request.status, callArgs[2]); return; }
        callArgs[1](data, 200, callArgs[2]);
    }

    // Private method
    obj.gotNextMessagesError = function (request, status, errorThrown, callArgs) {
        if (obj.FailAllError == 999) return;
        if (obj.FailAllError != 0) { callArgs[1](null, obj.FailAllError, callArgs[2]); return; }
        callArgs[1](obj, null, { Header: { HttpError: request.status } }, request.status, callArgs[2]);
    }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function (s) {
        while (obj.PendingAjax.length > 0) { var x = obj.PendingAjax.shift(); x[1](null, s, x[2]); }
        if (obj.websocket != null) { obj.websocket.close(); obj.websocket = null; obj.socketState = 0; }
    }

    return obj;
}

