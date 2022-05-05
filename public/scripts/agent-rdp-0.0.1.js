/** 
* @description RDP Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a RDP remote desktop object
var CreateRDPDesktop = function (canvasid) {
    var obj = {}
    obj.m = {};
    obj.State = 0;
    obj.canvas = Q(canvasid);
    obj.CanvasId = canvasid;
    if (typeof canvasid === 'string') obj.CanvasId = Q(canvasid);
    obj.Canvas = obj.CanvasId.getContext('2d');
    obj.ScreenWidth = obj.width = 1280;
    obj.ScreenHeight = obj.height = 1024;

    function mouseButtonMap(button) {
        // Swap mouse buttons if needed
        if (obj.m.SwapMouse === true) return [2, 0, 1, 0, 0][button];
        return [1, 0, 2, 0, 0][button];
    };
    
    obj.Start = function (nodeid, port, credentials) {
        changeState(1);
        obj.nodeid = nodeid;
        obj.port = port;
        obj.credentials = credentials;
        var options = { savepass: credentials.savecred, useServerCreds: credentials.servercred, width: credentials.width, height: credentials.height, flags: credentials.flags };
        if (credentials.width && credentials.height) {
            options.width = obj.ScreenWidth = obj.width = credentials.width;
            options.height = obj.ScreenHeight = obj.height = credentials.height;
            delete credentials.width;
            delete credentials.height;
        }
        obj.render = new Mstsc.Canvas.create(obj.canvas);
        obj.socket = new WebSocket('wss://' + window.location.host + '/mstscrelay.ashx'); // TODO: Support domains
        obj.socket.binaryType = 'arraybuffer';
        obj.socket.onopen = function () {
            changeState(2); // Setup state
            obj.socket.send(JSON.stringify(['infos', {
                    ip: obj.nodeid,
                    port: obj.port,
                    screen: { width: obj.width, height: obj.height },
                    domain: credentials.domain,
                    username: credentials.username,
                    password: credentials.password,
                    options: options,
                    locale: Mstsc.locale()
                }]));
        };
        obj.socket.onmessage = function (evt) {
            if (typeof evt.data == 'string') {
                // This is a JSON text string, parse it.
                var msg = JSON.parse(evt.data);
                switch (msg[0]) {
                    case 'rdp-connect': {
                        changeState(3);
                        obj.rotation = 0;
                        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
                        obj.Canvas.canvas.width = obj.ScreenWidth;
                        obj.Canvas.canvas.height = obj.ScreenHeight;
                        obj.Canvas.fillRect(0, 0, obj.ScreenWidth, obj.ScreenHeight);
                        if (obj.m.onScreenSizeChange != null) { obj.m.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId); }
                        break;
                    }
                    case 'rdp-bitmap': {
                        if (obj.bitmapData == null) break;
                        var bitmap = msg[1];
                        bitmap.data = obj.bitmapData; // Use the binary data that was sent earlier.
                        delete obj.bitmapData;
                        obj.render.update(bitmap);
                        break;
                    }
                    case 'rdp-close': {
                        obj.Stop();
                        break;
                    }
                    case 'rdp-error': {
                        var err = msg[1];
                        console.log('[mstsc.js] error : ' + err.code + '(' + err.message + ')');
                        obj.Stop();
                        break;
                    }
                    case 'ping': { obj.socket.send('["pong"]'); break; }
                    case 'pong': { break; }
                }
            } else {
                // This is binary bitmap data, store it.
                obj.bitmapData = evt.data;
            }
        };
        obj.socket.onclose = function () { changeState(0); };
        changeState(1);
    }

    obj.Stop = function () {
        obj.Canvas.fillRect(0, 0, obj.ScreenWidth, obj.ScreenHeight);
        if (obj.socket) { obj.socket.close(); }
    }
    
    function changeState(newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        if (obj.onStateChanged != null) obj.onStateChanged(obj, obj.State);
    }
    
    function getPositionOfControl(Control) {
        var Position = Array(2);
        Position[0] = Position[1] = 0;
        while (Control) { Position[0] += Control.offsetLeft; Position[1] += Control.offsetTop; Control = Control.offsetParent; }
        return Position;
    }
    
    function getMousePosition(event) {
        var ScaleFactorHeight = (obj.Canvas.canvas.height / obj.CanvasId.clientHeight);
        var ScaleFactorWidth = (obj.Canvas.canvas.width / obj.CanvasId.clientWidth);
        var Offsets = getPositionOfControl(obj.Canvas.canvas);
        var X = ((event.pageX - Offsets[0]) * ScaleFactorWidth);
        var Y = ((event.pageY - Offsets[1]) * ScaleFactorHeight);
        if (event.addx) { X += event.addx; }
        if (event.addy) { Y += event.addy; }
        return { x: X, y: Y };
    }

    obj.m.mousemove = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        var m = getMousePosition(e);
        if ((m.x < 0) || (m.y < 0) || (m.x > obj.ScreenWidth) || (m.y > obj.ScreenHeight)) return;
        obj.mouseNagleData = ['mouse', m.x, m.y, 0, false];
        if (obj.mouseNagleTimer == null) { obj.mouseNagleTimer = setTimeout(function () { obj.socket.send(JSON.stringify(obj.mouseNagleData)); obj.mouseNagleTimer = null; }, 50); }
        e.preventDefault();
        return false;
    }
    obj.m.mouseup = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        var m = getMousePosition(e);
        if ((m.x < 0) || (m.y < 0) || (m.x > obj.ScreenWidth) || (m.y > obj.ScreenHeight)) return;
        if (obj.mouseNagleTimer != null) { clearTimeout(obj.mouseNagleTimer); obj.mouseNagleTimer = null; }
        obj.socket.send(JSON.stringify(['mouse', m.x, m.y, mouseButtonMap(e.button), false]));
        e.preventDefault();
        return false;
    }
    obj.m.mousedown = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        var m = getMousePosition(e);
        if ((m.x < 0) || (m.y < 0) || (m.x > obj.ScreenWidth) || (m.y > obj.ScreenHeight)) return;
        if (obj.mouseNagleTimer != null) { clearTimeout(obj.mouseNagleTimer); obj.mouseNagleTimer = null; }
        obj.socket.send(JSON.stringify(['mouse', m.x, m.y, mouseButtonMap(e.button), true]));
        e.preventDefault();
        return false;
    }
    obj.m.handleKeyUp = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        obj.socket.send(JSON.stringify(['scancode', Mstsc.scancode(e), false]));
        e.preventDefault();
        return false;
    }
    obj.m.handleKeyDown = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        obj.socket.send(JSON.stringify(['scancode', Mstsc.scancode(e), true]));
        e.preventDefault();
        return false;
    }
    obj.m.mousewheel = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        var m = getMousePosition(e);
        if ((m.x < 0) || (m.y < 0) || (m.x > obj.ScreenWidth) || (m.y > obj.ScreenHeight)) return;
        if (obj.mouseNagleTimer != null) { clearTimeout(obj.mouseNagleTimer); obj.mouseNagleTimer = null; }
        var delta = 0;
        if (e.detail) { delta = (e.detail * 120); } else if (e.wheelDelta) { delta = (e.wheelDelta * 3); }
        if (delta != 0) { obj.socket.send(JSON.stringify(['wheel', m.x, m.y, delta, false, false])); }
        e.preventDefault();
        return false;
    }
    obj.m.mousedblclick = function () { }
    obj.m.handleKeyPress = function () { }
    obj.m.setRotation = function () { }
    
    return obj;
}
