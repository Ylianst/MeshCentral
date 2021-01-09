/*
Copyright 2018-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/** 
* @description WSMAN communication using duktape http
* @author Ylian Saint-Hilaire
* @version v0.2.0c
*/

// Construct a WSMAN communication object
function CreateWsmanComm(/*host, port, user, pass, tls, extra*/) {
    var obj = {};
    obj.PendingAjax = [];               // List of pending AJAX calls. When one frees up, another will start.
    obj.ActiveAjaxCount = 0;            // Number of currently active AJAX calls
    obj.MaxActiveAjaxCount = 1;         // Maximum number of activate AJAX calls at the same time.
    obj.FailAllError = 0;               // Set this to non-zero to fail all AJAX calls with that error status, 999 causes responses to be silent.
    obj.digest = null;
    obj.RequestCount = 0;

    if (arguments.length == 1 && typeof (arguments[0] == 'object')) {
        obj.host = arguments[0].host;
        obj.port = arguments[0].port;
        obj.authToken = arguments[0].authToken;
        obj.tls = arguments[0].tls;
    }
    else {
        obj.host = arguments[0];
        obj.port = arguments[1];
        obj.user = arguments[2];
        obj.pass = arguments[3];
        obj.tls = arguments[4];
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
        if (obj.FailAllError != 0) { if (obj.FailAllError != 999) { obj.gotNextMessagesError({ status: obj.FailAllError }, 'error', null, [postdata, callback, tag]); } return; }
        if (!postdata) postdata = "";
        if (globalDebugFlags & 1) { console.log("SEND: " + postdata + "\r\n\r\n"); } // DEBUG

        // We are in a DukTape environement
        if (obj.digest == null) {
            if (obj.authToken) {
                obj.digest = require('http-digest').create({ authToken: obj.authToken });
            } else {
                obj.digest = require('http-digest').create(obj.user, obj.pass);
            }
            obj.digest.http = require('http');
        }
        var request = { protocol: (obj.tls == 1 ? 'https:' : 'http:'), method: 'POST', host: obj.host, path: '/wsman', port: obj.port, rejectUnauthorized: false, checkServerIdentity: function (cert) { console.log('checkServerIdentity', JSON.stringify(cert)); } };
        var req = obj.digest.request(request);
        //console.log('Request ' + (obj.RequestCount++));
        req.on('error', function (e) { obj.gotNextMessagesError({ status: 600 }, 'error', null, [postdata, callback, tag]); });
        req.on('response', function (response) {
            if (globalDebugFlags & 1) { console.log('Response: ' + response.statusCode); }
            if (response.statusCode != 200) {
                if (globalDebugFlags & 1) { console.log('ERR:' + JSON.stringify(response)); }
                obj.gotNextMessagesError({ status: response.statusCode }, 'error', null, [postdata, callback, tag]);
            } else {
                response.acc = '';
                response.on('data', function (data2) { this.acc += data2; });
                response.on('end', function () { obj.gotNextMessages(response.acc, 'success', { status: response.statusCode }, [postdata, callback, tag]); });
            }
        });

        // Send POST body, this work with binary.
        req.end(postdata);
        obj.ActiveAjaxCount++;
        return req;
    }

    // AJAX specific private method
    obj.pendingAjaxCall = [];

    // Private method
    obj.gotNextMessages = function (data, status, request, callArgs) {
        obj.ActiveAjaxCount--;
        if (obj.FailAllError == 999) return;
        if (globalDebugFlags & 1) { console.log("RECV: " + data + "\r\n\r\n"); } // DEBUG
        if (obj.FailAllError != 0) { callArgs[1](null, obj.FailAllError, callArgs[2]); return; }
        if (request.status != 200) { callArgs[1](null, request.status, callArgs[2]); return; }
        callArgs[1](data, 200, callArgs[2]);
        obj.PerformNextAjax();
    }

    // Private method
    obj.gotNextMessagesError = function (request, status, errorThrown, callArgs) {
        obj.ActiveAjaxCount--;
        if (obj.FailAllError == 999) return;
        if (obj.FailAllError != 0) { callArgs[1](null, obj.FailAllError, callArgs[2]); return; }
        //if (status != 200) { console.log("ERROR, status=" + status + "\r\n\r\nreq=" + callArgs[0]); } // Debug: Display the request & response if something did not work.
        if (obj.FailAllError != 999) { callArgs[1]({ Header: { HttpError: request.status } }, request.status, callArgs[2]); }
        obj.PerformNextAjax();
    }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function (s) {
        while (obj.PendingAjax.length > 0) { var x = obj.PendingAjax.shift(); x[1](null, s, x[2]); }
    }

    return obj;
}

module.exports = CreateWsmanComm;
