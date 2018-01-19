/** 
* @fileoverview Dynamic interface to MeshCentral2
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

var createMeshConnection = function (connectionId) {
    var obj = {};
    obj.connectionId = connectionId;
    obj.state = 0;
    obj.websocket = null;
    obj.onStateChanged = null;
    obj.onData = null;
        
    obj.connect = function () {
        if (obj.state == 0) {
            obj.websocket = new WebSocket(window.location.protocol.replace('http', 'ws') + '//' + window.location.host + '/meshrelay.ashx?id=' + obj.connectionId);
            obj.websocket.binaryType = "arraybuffer";
            obj.websocket.onopen = function (e) { console.log('WebSocket Connected', e); };
            obj.websocket.onmessage = function (e) {
                console.log('WebSocket Message', e);
                if ((obj.state = 1) && (e.data == 'c')) {
                    obj.state = 2;
                    if (obj.onStateChanged) { onStateChanged(obj, 2); }
                    console.log('WebSocket Peer Connection', e);
                    obj.send('bob');
                } else {
                    if (obj.onData != null) { obj.onData(obj, e.data); }
                }
            };
            obj.websocket.onclose = function (e) {
                console.log('WebSocket Closed', e);
                obj.state = 0;
                if (obj.onStateChanged) { onStateChanged(obj, 0); }
            };
            obj.websocket.onerror = function (e) { console.log('WebSocket Error', e); };
            obj.state = 1;
            if (obj.onStateChanged) { onStateChanged(obj, 1); }
        }
        return obj;
    };
    
    obj.send = function (data) {
        if ((obj.state == 2) && (obj.websocket != null)) { obj.websocket.send(data); }
    };

    return obj;
}