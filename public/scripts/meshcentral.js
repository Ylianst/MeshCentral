/** 
* @fileoverview Meshcentral.js
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

var MeshServerCreateControl = function (domain, authCookie) {
    var obj = {};
    obj.State = 0;
    obj.connectstate = 0;
    obj.pingTimer = null;
    obj.authCookie = authCookie;
    //obj.trace = false;
    
    obj.xxStateChange = function (newstate, errCode) {
        if (obj.State == newstate) return;
        var previousState = obj.State;
        obj.State = newstate;
        if (obj.onStateChanged) obj.onStateChanged(obj, obj.State, previousState, errCode);
    }

    obj.Start = function () {
        if (obj.connectstate != 0) return;
        obj.connectstate = 0;
        var url = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + domain + 'control.ashx' + (urlargs.key ? ('?key=' + urlargs.key) : '');
        if (obj.authCookie && (obj.authCookie != '')) { url += '?moreargs=1' }
        obj.socket = new WebSocket(url);
        obj.socket.onopen = function (e) { obj.connectstate = 1; if (obj.authCookie && (obj.authCookie != '')) { obj.send({ 'action': 'urlargs', 'args': { 'auth': obj.authCookie } }); } }
        obj.socket.onmessage = obj.xxOnMessage;
        obj.socket.onclose = function(e) { obj.Stop(e.code); }
        obj.xxStateChange(1, 0);
        if (obj.pingTimer != null) { clearInterval(obj.pingTimer); }
        obj.pingTimer = setInterval(function () { obj.send({ action: 'ping' }); }, 29000); // Ping the server every 29 seconds, stops corporate proxies from disconnecting.
    }
    
    obj.Stop = function (errCode) {
        obj.connectstate = 0;
        if (obj.socket) { obj.socket.close(); delete obj.socket; }
        if (obj.pingTimer != null) { clearInterval(obj.pingTimer); obj.pingTimer = null; }
        obj.xxStateChange(0, errCode);
    }
    
    obj.xxOnMessage = function (e) {
        if (obj.State == 1) { obj.xxStateChange(2); }
        //console.log('xxOnMessage', e.data);
        var message;
        try { message = JSON.parse(e.data); } catch (e) { return; }
        if ((typeof message != 'object') || (message.action == 'pong')) { return; }
        if (message.action == 'ping') { obj.send({ action: 'pong' }); }
        if (message.action == 'close') { if (message.msg) { console.log(message.msg); } obj.Stop(message.cause); return; }
        if (obj.trace == 1) { console.log('RECV', message); }
        else if (obj.trace == 2) { console.log('RECV', JSON.stringify(message)); }
        if (obj.onMessage) obj.onMessage(obj, message);
    };
    
    obj.send = function (x) {
        if (obj.socket != null && obj.connectstate == 1) {
            if (x.action != 'ping') {
                if (obj.trace == 1) { console.log('SEND', x); }
                else if (obj.trace == 2) { console.log('SEND', JSON.stringify(x)); }
            }
            obj.socket.send(JSON.stringify(x));
        }
    }

    return obj;    
}
