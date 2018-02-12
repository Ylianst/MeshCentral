/** 
* @fileoverview Meshcentral.js
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

var MeshServerCreateControl = function (domain) {
    var obj = {};
    obj.State = 0;
    obj.connectstate = 0;
    
    obj.xxStateChange = function (newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        if (obj.onStateChanged) obj.onStateChanged(obj, obj.State);
    }

    obj.Start = function () {
        obj.connectstate = 0;
        obj.socket = new WebSocket(window.location.protocol.replace("http", "ws") + "//" + window.location.host + domain + "control.ashx");
        obj.socket.onopen = function () { obj.connectstate = 1; obj.xxStateChange(2); }
        obj.socket.onmessage = obj.xxOnMessage;
        obj.socket.onclose = function () { obj.Stop(); }
        obj.xxStateChange(1);
    }
    
    obj.Stop = function () {
        obj.connectstate = 0;
        if (obj.socket) { obj.socket.close(); delete obj.socket; }
        obj.xxStateChange(0);
    }
    
    obj.xxOnMessage = function (e) {
        // console.log('xxOnMessage', e.data);
        var message;
        try { message = JSON.parse(e.data); } catch (e) { return; }
        if (obj.onMessage) obj.onMessage(obj, message);
    };
    
    obj.send = function (x) { if (obj.socket != null && obj.connectstate == 1) { obj.socket.send(JSON.stringify(x)); } }

    return obj;    
}
