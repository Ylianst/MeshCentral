/** 
* @description RDP Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a RDP remote desktop object
var CreateRDPDesktop = function (canvasid, domainUrl) {
    var obj = {}
    obj.m = { KeyAction: { 'NONE': 0, 'DOWN': 1, 'UP': 2, 'SCROLL': 3, 'EXUP': 4, 'EXDOWN': 5, 'DBLCLICK': 6 } };
    obj.State = 0;
    obj.canvas = Q(canvasid);
    obj.CanvasId = canvasid;
    if (typeof canvasid === 'string') obj.CanvasId = Q(canvasid);
    obj.Canvas = obj.CanvasId.getContext('2d');
    obj.ScreenWidth = obj.width = 1280;
    obj.ScreenHeight = obj.height = 1024;
    obj.m.onClipboardChanged = null;
    obj.onConsoleMessageChange = null;

    var xMouseCursorActive = true;
    var xMouseCursorCurrent = 'default';
    obj.mouseCursorActive = function (x) { if (xMouseCursorActive == x) return; xMouseCursorActive = x; obj.CanvasId.style.cursor = ((x == true) ? xMouseCursorCurrent : 'default'); }

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
        var options = { savepass: credentials.savecred, useServerCreds: credentials.servercred, width: credentials.width, height: credentials.height, flags: credentials.flags, workingDir: credentials.workdir, alternateShell: credentials.altshell };
        if (credentials.width && credentials.height) {
            options.width = obj.ScreenWidth = obj.width = credentials.width;
            options.height = obj.ScreenHeight = obj.height = credentials.height;
            delete credentials.width;
            delete credentials.height;
        }
        obj.render = new Mstsc.Canvas.create(obj.canvas);
        obj.socket = new WebSocket('wss://' + window.location.host + domainUrl + 'mstscrelay.ashx');
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
                    case 'rdp-pointer': {
                        var pointer = msg[1];
                        xMouseCursorCurrent = pointer;
                        if (xMouseCursorActive) { obj.CanvasId.style.cursor = pointer; }
                        break;
                    }
                    case 'rdp-close': {
                        obj.Stop();
                        break;
                    }
                    case 'rdp-error': {
                        obj.consoleMessageTimeout = 5; // Seconds
                        obj.consoleMessage = msg[1];
                        delete obj.consoleMessageArgs;
                        if (msg.length > 2) { obj.consoleMessageArgs = [ msg[2] ]; }
                        switch (msg[1]) {
                            case 'NODE_RDP_PROTOCOL_X224_NEG_FAILURE':
                                if (msg[2] == 1) { obj.consoleMessageId = 9; } // "SSL required by server";
                                else if (msg[2] == 2) { obj.consoleMessageId = 10; } // "SSL not allowed by server";
                                else if (msg[2] == 3) { obj.consoleMessageId = 11; } // "SSL certificate not on server";
                                else if (msg[2] == 4) { obj.consoleMessageId = 12; } // "Inconsistent flags";
                                else if (msg[2] == 5) { obj.consoleMessageId = 13; } // "Hybrid required by server";
                                else if (msg[2] == 6) { obj.consoleMessageId = 14; } // "SSL with user auth required by server";
                                else obj.consoleMessageId = 7; // "Protocol negotiation failed";
                                break;
                            case 'NODE_RDP_PROTOCOL_X224_NLA_NOT_SUPPORTED':
                                obj.consoleMessageId = 8; // "NLA not supported";
                                break;
                            default:
                                obj.consoleMessageId = null;
                                break;
                        }
                        if (obj.onConsoleMessageChange) { obj.onConsoleMessageChange(); }
                        obj.Stop();
                        break;
                    }
                    case 'rdp-clipboard': { obj.lastClipboardContent = msg[1]; if (obj.m.onClipboardChanged) { obj.m.onClipboardChanged(msg[1]); } break; }
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

    obj.m.setClipboard = function (content) { if (obj.socket) { obj.socket.send(JSON.stringify(['clipboard', content])); } }
    obj.m.getClipboard = function () { return obj.lastClipboardContent; }

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
        //console.log('handleKeyUp', Mstsc.scancode(e));
        obj.socket.send(JSON.stringify(['scancode', Mstsc.scancode(e), false]));
        e.preventDefault();
        return false;
    }
    obj.m.handleKeyDown = function (e) {
        if (!obj.socket || (obj.State != 3)) return;
        //console.log('handleKeyDown', Mstsc.scancode(e));
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
        if (obj.m.ReverseMouseWheel) { delta = -1 * delta; } // Reverse the mouse wheel
        if (delta != 0) { obj.socket.send(JSON.stringify(['wheel', m.x, m.y, delta, false, false])); }
        e.preventDefault();
        return false;
    }
    obj.m.SendStringUnicode = function (txt) {
        if (!obj.socket || (obj.State != 3)) return;
        obj.socket.send(JSON.stringify(['utype', txt]));
    }
    obj.m.SendKeyMsgKC = function (action, kc, extendedKey) {
        if (obj.State != 3) return;
        if (typeof action == 'object') { for (var i in action) { obj.m.SendKeyMsgKC(action[i][0], action[i][1], action[i][2]); } }
        else {
            var scan = shortcutToScan[kc];
            if (scan != null) { obj.socket.send(JSON.stringify(['scancode', scan, ((action & 1) != 0)])); }
        }
    }
    obj.m.mousedblclick = function () { }
    obj.m.handleKeyPress = function () { }
    obj.m.setRotation = function () { }
    obj.m.sendcad = function () { // Ctrl-Alt-Del
        obj.socket.send(JSON.stringify(['scancode', 29, true])); // CTRL
        obj.socket.send(JSON.stringify(['scancode', 56, true])); // ALT
        obj.socket.send(JSON.stringify(['scancode', 57427, true])); // DEL
        obj.socket.send(JSON.stringify(['scancode', 57427, false]));
        obj.socket.send(JSON.stringify(['scancode', 56, false]));
        obj.socket.send(JSON.stringify(['scancode', 29, false]));
    }

    var shortcutToScan = {
        9: 15, // Tab
        16: 42, // Shift
        17: 29, // Ctrl
        18: 56, // Alt
        27: 1, // ESC
        33: 57417, // Page Up
        34: 57425, // Page Down
        35: 57423, // End
        36: 57415, // Home
        37: 57419, // Left
        38: 57416, // Up
        39: 57421, // Right
        40: 57424, // Down
        44: 57399, // Print Screen
        45: 57426, // Insert
        46: 57427, // Del
        65: 30, // A
        66: 48, // B
        67: 46, // C
        68: 32, // D
        69: 18, // E
        70: 33, // F
        71: 34, // G
        72: 35, // H
        73: 23, // I
        74: 36, // J
        75: 37, // K
        76: 38, // L
        77: 50, // M
        78: 49, // N
        79: 24, // O
        80: 25, // P
        81: 16, // Q
        82: 19, // R
        83: 31, // S
        84: 20, // T
        85: 22, // U
        86: 47, // V
        87: 17, // W
        88: 45, // X
        89: 21, // Y
        90: 44, // Z
        91: 57435, // Windows left
        112: 59, // F1
        113: 60, // F2
        114: 61, // F3
        115: 62, // F4
        116: 63, // F5
        117: 64, // F6
        118: 65, // F7
        119: 66, // F8
        120: 67, // F9
        121: 68, // F10
        122: 87, // F11
        123: 88 // F12
    }

    return obj;
}
