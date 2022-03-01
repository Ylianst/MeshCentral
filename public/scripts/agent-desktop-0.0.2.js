/** 
* @description Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.2g
*/

// Polyfill Uint8Array.slice() for IE
if (!Uint8Array.prototype.slice) { Object.defineProperty(Uint8Array.prototype, 'slice', { value: function (begin, end) { return new Uint8Array(Array.prototype.slice.call(this, begin, end)); } }); }

// Construct a MeshServer object
var CreateAgentRemoteDesktop = function (canvasid, scrolldiv) {
    var obj = {}
    obj.CanvasId = canvasid;
    if (typeof canvasid === 'string') obj.CanvasId = Q(canvasid);
    obj.Canvas = obj.CanvasId.getContext('2d');
    obj.scrolldiv = scrolldiv;
    obj.State = 0;
    obj.PendingOperations = [];
    obj.tilesReceived = 0;
    obj.TilesDrawn = 0;
    obj.KillDraw = 0;
    obj.ipad = false;
    obj.tabletKeyboardVisible = false;
    obj.LastX = 0;
    obj.LastY = 0;
    obj.touchenabled = 0;
    obj.submenuoffset = 0;
    obj.touchtimer = null;
    obj.TouchArray = {};
    obj.connectmode = 0; // 0 = HTTP, 1 = WebSocket, 2 = WebRTC
    obj.connectioncount = 0;
    obj.rotation = 0;
    obj.protocol = 2; // KVM
    obj.debugmode = 0;
    obj.firstUpKeys = [];
    obj.stopInput = false;
    obj.localKeyMap = true;
    obj.remoteKeyMap = false; // If false, the remote keyboard mapping is not used.
    obj.pressedKeys = [];

    obj.sessionid = 0;
    obj.username;
    obj.oldie = false;
    obj.ImageType = 1; // 1 = JPEG, 2 = PNG, 3 = TIFF, 4 = WebP
    obj.CompressionLevel = 50;
    obj.ScalingLevel = 1024;
    obj.FrameRateTimer = 100;
    obj.SwapMouse = false;
    obj.UseExtendedKeyFlag = true;
    obj.FirstDraw = false;

    // Remote user mouse and keyboard lock
    obj.onRemoteInputLockChanged = null;
    obj.RemoteInputLock = null;

    // Remote keyboard state
    obj.onKeyboardStateChanged = null;
    obj.KeyboardState = 0; // 1 = NumLock, 2 = ScrollLock, 4 = CapsLock

    obj.ScreenWidth = 960;
    obj.ScreenHeight = 701;
    obj.width = 960;
    obj.height = 960;

    obj.displays = null;
    obj.selectedDisplay = null;

    obj.onScreenSizeChange = null;
    obj.onMessage = null;
    obj.onConnectCountChanged = null;
    obj.onDebugMessage = null;
    obj.onTouchEnabledChanged = null;
    obj.onDisplayinfo = null;
    obj.accumulator = null;

    var xMouseCursorActive = true;
    var xMouseCursorCurrent = 'default';
    obj.mouseCursorActive = function (x) { if (xMouseCursorActive == x) return; xMouseCursorActive = x; obj.CanvasId.style.cursor = ((x == true) ? xMouseCursorCurrent : 'default'); }
    var mouseCursors = ['default', 'progress', 'crosshair', 'pointer', 'help', 'text', 'no-drop', 'move', 'nesw-resize', 'ns-resize', 'nwse-resize', 'w-resize', 'alias', 'wait', 'none', 'not-allowed', 'col-resize', 'row-resize', 'copy', 'zoom-in', 'zoom-out'];

    obj.Start = function () {
        obj.State = 0;
        obj.accumulator = null;
    }

    obj.Stop = function () {
        obj.setRotation(0);
        obj.UnGrabKeyInput();
        obj.UnGrabMouseInput();
        obj.touchenabled = 0;
        if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId); }
        obj.Canvas.clearRect(0, 0, obj.CanvasId.width, obj.CanvasId.height);
    }

    obj.xxStateChange = function (newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        obj.CanvasId.style.cursor = 'default';
        //console.log('xxStateChange', newstate);
        switch (newstate) {
            case 0: {
                // Disconnect
                obj.Stop();
                break;
            }
            case 3: {
                // Websocket connected

                break;
            }
        }
    }

    obj.send = function (x) {
        if (obj.debugmode > 2) { console.log('KSend(' + x.length + '): ' + rstr2hex(x)); }
        if (obj.parent != null) { obj.parent.send(x); }
    }

    // KVM Control.
    // Routines for processing incoming packets from the AJAX server, and handling individual messages.
    obj.ProcessPictureMsg = function (data, X, Y) {
        //if (obj.targetnode != null) obj.Debug("ProcessPictureMsg " + X + "," + Y + " - " + obj.targetnode.substring(0, 8));
        var tile = new Image();
        tile.xcount = obj.tilesReceived++;
        var r = obj.tilesReceived, tdata = data.slice(4), ptr = 0, strs = [];
        // String.fromCharCode.apply() can't handle very large argument count, so we have to split like this.
        while ((tdata.byteLength - ptr) > 50000) { strs.push(String.fromCharCode.apply(null, tdata.slice(ptr, ptr + 50000))); ptr += 50000; }
        if (ptr > 0) { strs.push(String.fromCharCode.apply(null, tdata.slice(ptr))); } else { strs.push(String.fromCharCode.apply(null, tdata)); }
        tile.src = 'data:image/jpeg;base64,' + btoa(strs.join(''));
        tile.onload = function () {
            //console.log('DecodeTile #' + this.xcount);
            if ((obj.Canvas != null) && (obj.KillDraw < r) && (obj.State != 0)) {
                obj.PendingOperations.push([r, 2, tile, X, Y]);
                while (obj.DoPendingOperations()) { }
            } else {
                obj.PendingOperations.push([r, 0]);
            }
        }
        tile.error = function () { console.log('DecodeTileError'); }
    }

    obj.DoPendingOperations = function () {
        if (obj.PendingOperations.length == 0) return false;
        for (var i = 0; i < obj.PendingOperations.length; i++) { // && KillDraw < tilesDrawn
            var Msg = obj.PendingOperations[i];
            if (Msg[0] == (obj.TilesDrawn + 1)) {
                if (obj.onPreDrawImage != null) obj.onPreDrawImage(); // Notify that we are about to draw on the canvas.
                if (Msg[1] == 1) { obj.ProcessCopyRectMsg(Msg[2]); }
                else if (Msg[1] == 2) { obj.Canvas.drawImage(Msg[2], obj.rotX(Msg[3], Msg[4]), obj.rotY(Msg[3], Msg[4])); delete Msg[2]; }
                obj.PendingOperations.splice(i, 1);
                delete Msg;
                obj.TilesDrawn++;
                if ((obj.TilesDrawn == obj.tilesReceived) && (obj.KillDraw < obj.TilesDrawn)) { obj.KillDraw = obj.TilesDrawn = obj.tilesReceived = 0; }
                return true;
            }
        }
        if (obj.oldie && obj.PendingOperations.length > 0) { obj.TilesDrawn++; }
        return false;
    }

    obj.ProcessCopyRectMsg = function (str) {
        var SX = ((str.charCodeAt(0) & 0xFF) << 8) + (str.charCodeAt(1) & 0xFF);
        var SY = ((str.charCodeAt(2) & 0xFF) << 8) + (str.charCodeAt(3) & 0xFF);
        var DX = ((str.charCodeAt(4) & 0xFF) << 8) + (str.charCodeAt(5) & 0xFF);
        var DY = ((str.charCodeAt(6) & 0xFF) << 8) + (str.charCodeAt(7) & 0xFF);
        var WIDTH = ((str.charCodeAt(8) & 0xFF) << 8) + (str.charCodeAt(9) & 0xFF);
        var HEIGHT = ((str.charCodeAt(10) & 0xFF) << 8) + (str.charCodeAt(11) & 0xFF);
        obj.Canvas.drawImage(Canvas.canvas, SX, SY, WIDTH, HEIGHT, DX, DY, WIDTH, HEIGHT);
    }

    obj.SendUnPause = function () {
        if (obj.debugmode > 1) { console.log('SendUnPause'); }
        //obj.xxStateChange(3);
        obj.send(String.fromCharCode(0x00, 0x08, 0x00, 0x05, 0x00));
    }

    obj.SendPause = function () {
        if (obj.debugmode > 1) { console.log('SendPause'); }
        //obj.xxStateChange(2);
        obj.send(String.fromCharCode(0x00, 0x08, 0x00, 0x05, 0x01));
    }

    obj.SendCompressionLevel = function (type, level, scaling, frametimer) { // Type: 1 = JPEG, 2 = PNG, 3 = TIFF, 4 = WebP
        obj.ImageType = type;
        if (level) { obj.CompressionLevel = level; }
        if (scaling) { obj.ScalingLevel = scaling; }
        if (frametimer) { obj.FrameRateTimer = frametimer; }
        obj.send(String.fromCharCode(0x00, 0x05, 0x00, 0x0A, type, obj.CompressionLevel) + obj.shortToStr(obj.ScalingLevel) + obj.shortToStr(obj.FrameRateTimer));
    }

    obj.SendRefresh = function () {
        obj.send(String.fromCharCode(0x00, 0x06, 0x00, 0x04));
    }

    obj.ProcessScreenMsg = function (width, height) {
        if (obj.debugmode > 0) { console.log('ScreenSize: ' + width + ' x ' + height); }
        if ((obj.ScreenWidth == width) && (obj.ScreenHeight == height)) return; // Ignore change if screen is same size.
        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.rotation = 0;
        obj.FirstDraw = true;
        obj.ScreenWidth = obj.width = width;
        obj.ScreenHeight = obj.height = height;
        obj.KillDraw = obj.tilesReceived;
        while (obj.PendingOperations.length > 0) { obj.PendingOperations.shift(); }
        obj.SendCompressionLevel(obj.ImageType);
        obj.SendUnPause();
        obj.SendRemoteInputLock(2); // Query input lock state
        // No need to event the display size change now, it will be evented on first draw.
        if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId); }
    }

    obj.ProcessBinaryCommand = function (cmd, cmdsize, view) {
        var X, Y;
        if ((cmd == 3) || (cmd == 4) || (cmd == 7)) { X = (view[4] << 8) + view[5]; Y = (view[6] << 8) + view[7]; }
        if (obj.debugmode > 2) { console.log('CMD', cmd, cmdsize, X, Y); }

        // Record the command if needed
        if (obj.recordedData != null) {
            if (cmdsize > 65000) {
                obj.recordedData.push(recordingEntry(2, 1, obj.shortToStr(27) + obj.shortToStr(8) + obj.intToStr(cmdsize) + obj.shortToStr(cmd) + obj.shortToStr(0) + obj.shortToStr(0) + obj.shortToStr(0) + String.fromCharCode.apply(null, view)));
            } else {
                obj.recordedData.push(recordingEntry(2, 1, String.fromCharCode.apply(null, view)));
            }
        }

        switch (cmd) {
            case 3: // Tile
                if (obj.FirstDraw) obj.onResize();
                //console.log('TILE', X, Y, cmdsize);
                obj.ProcessPictureMsg(view.slice(4), X, Y);
                break;
            case 7: // Screen size
                obj.ProcessScreenMsg(X, Y);
                obj.SendKeyMsgKC(obj.KeyAction.UP, 16); // Shift
                obj.SendKeyMsgKC(obj.KeyAction.UP, 17); // Ctrl
                obj.SendKeyMsgKC(obj.KeyAction.UP, 18); // Alt
                obj.SendKeyMsgKC(obj.KeyAction.UP, 91); // Left-Windows
                obj.SendKeyMsgKC(obj.KeyAction.UP, 92); // Right-Windows
                obj.SendKeyMsgKC(obj.KeyAction.UP, 16); // Shift
                obj.send(String.fromCharCode(0x00, 0x0E, 0x00, 0x04));
                break;
            case 11: // GetDisplays (TODO)
                var selectedDisplay = 0, displays = {}, dcount = (view[4] << 8) + view[5];
                if (dcount > 0) {
                    // Many displays present
                    selectedDisplay = (view[6 + (dcount * 2)] << 8) + view[7 + (dcount * 2)];
                    for (var i = 0; i < dcount; i++) {
                        var disp = (view[6 + (i * 2)] << 8) + view[7 + (i * 2)];
                        if (disp == 65535) { displays[disp] = 'All Displays'; } else { displays[disp] = 'Display ' + disp; }
                    }
                }
                //console.log('Get Displays', displays, selectedDisplay, rstr2hex(str));
                obj.displays = displays; obj.selectedDisplay = selectedDisplay;
                if (obj.onDisplayinfo != null) { obj.onDisplayinfo(obj, displays, selectedDisplay); }
                break;
            case 12: // SetDisplay
                //console.log('SetDisplayConfirmed');
                break;
            case 14: // KVM_INIT_TOUCH
                obj.touchenabled = 1;
                obj.TouchArray = {};
                if (obj.onTouchEnabledChanged != null) obj.onTouchEnabledChanged(obj.touchenabled);
                break;
            case 15: // KVM_TOUCH
                obj.TouchArray = {};
                break;
            case 17: // MNG_KVM_MESSAGE
                var str = String.fromCharCode.apply(null, view.slice(4));
                console.log('Got KVM Message: ' + str);
                if (obj.onMessage != null) obj.onMessage(str, obj);
                break;
            case 18: // MNG_KVM_KEYSTATE
                if ((cmdsize != 5) || (obj.KeyboardState == view[4])) break;
                obj.KeyboardState = view[4]; // 1 = NumLock, 2 = ScrollLock, 4 = CapsLock
                if (obj.onKeyboardStateChanged) { obj.onKeyboardStateChanged(obj, obj.KeyboardState); }
                console.log('MNG_KVM_KEYSTATE:' + ((obj.KeyboardState & 1) ? ' NumLock' : '') + ((obj.KeyboardState & 2) ? ' ScrollLock' : '') + ((obj.KeyboardState & 4) ? ' CapsLock' : ''));
                break;
            case 65: // Alert
                var str = String.fromCharCode.apply(null, view.slice(4));
                if (str[0] != '.') {
                    console.log(str); //alert('KVM: ' + str);
                    if (obj.parent && obj.parent.setConsoleMessage) { obj.parent.setConsoleMessage(str); }
                } else {
                    console.log('KVM: ' + str.substring(1));
                }
                break;
            case 82: // DISPLAY LOCATION & SIZE
                if ((cmdsize < 4) || (((cmdsize - 4) % 10) != 0)) break;
                var screenCount = ((cmdsize - 4) / 10), screenInfo = {}, ptr = 4;
                for (var i = 0; i < screenCount; i++) { screenInfo[(view[ptr + 0] << 8) + view[ptr + 1]] = { x: ((view[ptr + 2] << 8) + view[ptr + 3]), y: ((view[ptr + 4] << 8) + view[ptr + 5]), w: ((view[ptr + 6] << 8) + view[ptr + 7]), h: ((view[ptr + 8] << 8) + view[ptr + 9]) }; ptr += 10; }
                //console.log('ScreenInfo', JSON.stringify(screenInfo, null, 2));
                break;
            case 87: // MNG_KVM_INPUT_LOCK
                if (cmdsize != 5) break;
                if ((obj.RemoteInputLock == null) || (obj.RemoteInputLock !== (view[4] != 0))) {
                    obj.RemoteInputLock = (view[4] != 0);
                    if (obj.onRemoteInputLockChanged) { obj.onRemoteInputLockChanged(obj, obj.RemoteInputLock); }
                }
                break;
            case 88: // MNG_KVM_MOUSE_CURSOR
                if ((cmdsize != 5) || (obj.stopInput)) break;
                var cursorNum = view[4];
                if (cursorNum > mouseCursors.length) { cursorNum = 0; }
                xMouseCursorCurrent = mouseCursors[cursorNum];
                if (xMouseCursorActive) { obj.CanvasId.style.cursor = xMouseCursorCurrent; }
                break;
            default:
                console.log('Unknown command', cmd, cmdsize);
                break;
        }

    }
    
    // Keyboard and Mouse I/O.
    obj.MouseButton = { "NONE": 0x00, "LEFT": 0x02, "RIGHT": 0x08, "MIDDLE": 0x20 };
    obj.KeyAction = { "NONE": 0, "DOWN": 1, "UP": 2, "SCROLL": 3, "EXUP": 4, "EXDOWN": 5, "DBLCLICK": 6 };
    obj.InputType = { "KEY": 1, "MOUSE": 2, "CTRLALTDEL": 10, "TOUCH": 15, "KEYUNICODE": 85 };
    obj.Alternate = 0;

    var convertKeyCodeTable = {
        "Pause": 19,
        "CapsLock": 20,
        "Space": 32,
        "Quote": 222,
        "Minus": 189,
        "NumpadMultiply": 106,
        "NumpadAdd": 107,
        "PrintScreen": 44,
        "Comma": 188,
        "NumpadSubtract": 109,
        "NumpadDecimal": 110,
        "Period": 190,
        "Slash": 191,
        "NumpadDivide": 111,
        "Semicolon": 186,
        "Equal": 187,
        "OSLeft": 91,
        "BracketLeft": 219,
        "OSRight": 91,
        "Backslash": 220,
        "BracketRight": 221,
        "ContextMenu": 93,
        "Backquote": 192,
        "NumLock": 144,
        "ScrollLock": 145,
        "Backspace": 8,
        "Tab": 9,
        "Enter": 13,
        "NumpadEnter": 13,
        "Escape": 27,
        "Delete": 46,
        "Home": 36,
        "PageUp": 33,
        "PageDown": 34,
        "ArrowLeft": 37,
        "ArrowUp": 38,
        "ArrowRight": 39,
        "ArrowDown": 40,
        "End": 35,
        "Insert": 45,
        "F1": 112,
        "F2": 113,
        "F3": 114,
        "F4": 115,
        "F5": 116,
        "F6": 117,
        "F7": 118,
        "F8": 119,
        "F9": 120,
        "F10": 121,
        "F11": 122,
        "F12": 123,
        "ShiftLeft": 16,
        "ShiftRight": 16,
        "ControlLeft": 17,
        "ControlRight": 17,
        "AltLeft": 18,
        "AltRight": 18,
        "MetaLeft": 91,
        "MetaRight": 92,
        "VolumeMute": 181
        //"LaunchMail": 
        //"LaunchApp1":
        //"LaunchApp2":
        //"BrowserStop":
        //"MediaStop":
        //"MediaTrackPrevious":
        //"MediaTrackNext":
        //"MediaPlayPause":
        //"MediaSelect":
    }

    function convertKeyCode(e) {
        if (e.code.startsWith('Key') && e.code.length == 4) { return e.code.charCodeAt(3); }
        if (e.code.startsWith('Digit') && e.code.length == 6) { return e.code.charCodeAt(5); }
        if (e.code.startsWith('Numpad') && e.code.length == 7) { return e.code.charCodeAt(6) + 48; }
        return convertKeyCodeTable[e.code];
    }

    var extendedKeyTable = ['ShiftRight', 'AltRight', 'ControlRight', 'Home', 'End', 'Insert', 'Delete', 'PageUp', 'PageDown', 'NumpadDivide', 'NumpadEnter', 'NumLock', 'Pause'];
    obj.SendKeyMsg = function (action, event) {
        if (action == null) return;
        if (!event) { event = window.event; }

        var extendedKey = false; // Test feature, add ?extkeys=1 to url to use.
        if ((obj.UseExtendedKeyFlag || (urlargs.extkeys == 1)) && (typeof event.code == 'string') && (event.code.startsWith('Arrow') || (extendedKeyTable.indexOf(event.code) >= 0))) { extendedKey = true; }

        if ((extendedKey == false) && event.code && (event.code.startsWith('NumPad') == false) && (obj.localKeyMap == false)) {
            // Convert "event.code" into a scancode. This works the same regardless of the keyboard language.
            // Older browsers will not support this.
            var kc = convertKeyCode(event);
            if (kc != null) { obj.SendKeyMsgKC(action, kc, extendedKey); }
        } else {
            // Use this keycode, this works best with "US-EN" keyboards.
            // Older browser support this.
            var kc = event.keyCode;
            if (kc == 0x3B) { kc = 0xBA; } // Fix the ';' key
            else if (kc == 173) { kc = 189; } // Fix the '-' key for Firefox
            else if (kc == 61) { kc = 187; } // Fix the '=' key for Firefox
            obj.SendKeyMsgKC(action, kc, extendedKey);
        }
    }

    // Send remote input lock. 0 = Unlock, 1 = Lock, 2 = Query
    obj.SendRemoteInputLock = function (code) { obj.send(String.fromCharCode(0x00, 87, 0x00, 0x05, code)); }

    obj.SendMessage = function (msg) {
        if (obj.State == 3) obj.send(String.fromCharCode(0x00, 0x11) + obj.shortToStr(4 + msg.length) + msg); // 0x11 = 17 MNG_KVM_MESSAGE
    }

    obj.SendKeyMsgKC = function (action, kc, extendedKey) {
        if (obj.State != 3) return;
        if (typeof action == 'object') { for (var i in action) { obj.SendKeyMsgKC(action[i][0], action[i][1], action[i][2]); } }
        else {
            if (action == 1) { // Key Down
                if (obj.pressedKeys.indexOf(kc) == -1) { obj.pressedKeys.unshift(kc); } // Add key press to start of array
            } else if (action == 2) { // Key Up
                var i = obj.pressedKeys.indexOf(kc);
                if (i != -1) { obj.pressedKeys.splice(i, 1); } // Remove the key press from the pressed array
            }
            if (obj.debugmode > 0) { console.log('Sending Key ' + kc + ', action ' + action); }

            var up = (action - 1);
            if (extendedKey) { if (up == 1) { up = 3; } else { up = 4; } }
            obj.send(String.fromCharCode(0x00, obj.InputType.KEY, 0x00, 0x06, up, kc));
        }
    }

    obj.SendStringUnicode = function (str) {
        if (obj.State != 3) return;
        for (var i = 0; i < str.length; i++) {
            obj.send(String.fromCharCode(0x00, obj.InputType.KEYUNICODE, 0x00, 0x07, 0) + ShortToStr(str.charCodeAt(i)));
            obj.send(String.fromCharCode(0x00, obj.InputType.KEYUNICODE, 0x00, 0x07, 1) + ShortToStr(str.charCodeAt(i)));
        }
    }

    obj.SendKeyUnicode = function (action, val) {
        if (obj.State != 3) return;
        if (obj.debugmode > 0) { console.log('Sending UnicodeKey ' + val); }
        obj.send(String.fromCharCode(0x00, obj.InputType.KEYUNICODE, 0x00, 0x07, (action - 1)) + ShortToStr(val));
    }

    obj.sendcad = function() { obj.SendCtrlAltDelMsg(); }

    obj.SendCtrlAltDelMsg = function () {
        if (obj.State == 3) { obj.send(String.fromCharCode(0x00, obj.InputType.CTRLALTDEL, 0x00, 0x04)); }
    }

    obj.SendEscKey = function () {
        if (obj.State == 3) obj.send(String.fromCharCode(0x00, obj.InputType.KEY, 0x00, 0x06, 0x00, 0x1B, 0x00, obj.InputType.KEY, 0x00, 0x06, 0x01, 0x1B));
    }

    obj.SendStartMsg = function () {
        obj.SendKeyMsgKC(obj.KeyAction.EXDOWN, 0x5B); // L-Windows
        obj.SendKeyMsgKC(obj.KeyAction.EXUP, 0x5B); // L-Windows
    }

    obj.SendCharmsMsg = function () {
        obj.SendKeyMsgKC(obj.KeyAction.EXDOWN, 0x5B); // L-Windows
        obj.SendKeyMsgKC(obj.KeyAction.DOWN, 67); // C
        obj.SendKeyMsgKC(obj.KeyAction.UP, 67); // C
        obj.SendKeyMsgKC(obj.KeyAction.EXUP, 0x5B); // L-Windows
    }

    obj.SendTouchMsg1 = function (id, flags, x, y) {
        if (obj.State == 3) obj.send(String.fromCharCode(0x00, obj.InputType.TOUCH) + obj.shortToStr(14) + String.fromCharCode(0x01, id) + obj.intToStr(flags) + obj.shortToStr(x) + obj.shortToStr(y));
    }

    obj.SendTouchMsg2 = function (id, flags) {
        var msg = '';
        var flags2;
        var str = "TOUCHSEND: ";
        for (var k in obj.TouchArray) {
            if (k == id) { flags2 = flags; } else {
                if (obj.TouchArray[k].f == 1) { flags2 = 0x00010000 | 0x00000002 | 0x00000004; obj.TouchArray[k].f = 3; str += "START" + k; } // POINTER_FLAG_DOWN
                else if (obj.TouchArray[k].f == 2) { flags2 = 0x00040000; str += "STOP" + k; } // POINTER_FLAG_UP
                else flags2 = 0x00000002 | 0x00000004 | 0x00020000; // POINTER_FLAG_UPDATE
            }
            msg += String.fromCharCode(k) + obj.intToStr(flags2) + obj.shortToStr(obj.TouchArray[k].x) + obj.shortToStr(obj.TouchArray[k].y);
            if (obj.TouchArray[k].f == 2) delete obj.TouchArray[k];
        }
        if (obj.State == 3) obj.send(String.fromCharCode(0x00, obj.InputType.TOUCH) + obj.shortToStr(5 + msg.length) + String.fromCharCode(0x02) + msg);
        if (Object.keys(obj.TouchArray).length == 0 && obj.touchtimer != null) { clearInterval(obj.touchtimer); obj.touchtimer = null; }
    }

    obj.SendMouseMsg = function (Action, event) {
        if (obj.State != 3) return;
        if (Action != null && obj.Canvas != null) {
            if (!event) { var event = window.event; }

            var ScaleFactorHeight = (obj.Canvas.canvas.height / obj.CanvasId.clientHeight);
            var ScaleFactorWidth = (obj.Canvas.canvas.width / obj.CanvasId.clientWidth);
            var Offsets = obj.GetPositionOfControl(obj.Canvas.canvas);
            var X = ((event.pageX - Offsets[0]) * ScaleFactorWidth);
            var Y = ((event.pageY - Offsets[1]) * ScaleFactorHeight);
            if (event.addx) { X += event.addx; }
            if (event.addy) { Y += event.addy; }

            if (X >= 0 && X <= obj.Canvas.canvas.width && Y >= 0 && Y <= obj.Canvas.canvas.height) {
                var Button = 0;
                var Delta = 0;
                if (Action == obj.KeyAction.UP || Action == obj.KeyAction.DOWN) {
                    if (event.which) { ((event.which == 1) ? (Button = obj.MouseButton.LEFT) : ((event.which == 2) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                    else if (event.button) { ((event.button == 0) ? (Button = obj.MouseButton.LEFT) : ((event.button == 1) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                }
                else if (Action == obj.KeyAction.SCROLL) {
                    if (event.detail) { Delta = (-1 * (event.detail * 120)); } else if (event.wheelDelta) { Delta = (event.wheelDelta * 3); }
                }

                // Swap mouse buttons if needed
                if (obj.SwapMouse === true) {
                    if (Button == obj.MouseButton.LEFT) { Button = obj.MouseButton.RIGHT; }
                    else if (Button == obj.MouseButton.RIGHT) { Button = obj.MouseButton.LEFT; }
                }

                var MouseMsg = "";
                if (Action == obj.KeyAction.DBLCLICK) {
                    MouseMsg = String.fromCharCode(0x00, obj.InputType.MOUSE, 0x00, 0x0A, 0x00, 0x88, ((X / 256) & 0xFF), (X & 0xFF), ((Y / 256) & 0xFF), (Y & 0xFF));
                } else if (Action == obj.KeyAction.SCROLL) {
                    var deltaHigh = 0, deltaLow = 0;
                    if (Delta < 0) { deltaHigh = (255 - (Math.abs(Delta) >> 8)); deltaLow = (255 - (Math.abs(Delta) & 0xFF)); } else { deltaHigh = (Delta >> 8); deltaLow = (Delta & 0xFF); }
                    MouseMsg = String.fromCharCode(0x00, obj.InputType.MOUSE, 0x00, 0x0C, 0x00, 0x00, ((X / 256) & 0xFF), (X & 0xFF), ((Y / 256) & 0xFF), (Y & 0xFF), deltaHigh, deltaLow);
                } else {
                    MouseMsg = String.fromCharCode(0x00, obj.InputType.MOUSE, 0x00, 0x0A, 0x00, ((Action == obj.KeyAction.DOWN) ? Button : ((Button * 2) & 0xFF)), ((X / 256) & 0xFF), (X & 0xFF), ((Y / 256) & 0xFF), (Y & 0xFF));
                }

                if (obj.Action == obj.KeyAction.NONE) {
                    if (obj.Alternate == 0 || obj.ipad) { obj.send(MouseMsg); obj.Alternate = 1; } else { obj.Alternate = 0; }
                } else {
                    obj.send(MouseMsg);
                }
            }
        }
    }

    obj.GetDisplayNumbers = function () { obj.send(String.fromCharCode(0x00, 0x0B, 0x00, 0x04)); } // Get Terminal display
    obj.SetDisplay = function (number) { /*console.log('Set display', number);*/ obj.send(String.fromCharCode(0x00, 0x0C, 0x00, 0x06, number >> 8, number & 0xFF)); } // Set Terminal display
    obj.intToStr = function (x) { return String.fromCharCode((x >> 24) & 0xFF, (x >> 16) & 0xFF, (x >> 8) & 0xFF, x & 0xFF); }
    obj.shortToStr = function (x) { return String.fromCharCode((x >> 8) & 0xFF, x & 0xFF); }

    obj.onResize = function () {
        if (obj.ScreenWidth == 0 || obj.ScreenHeight == 0) return;
        if (obj.Canvas.canvas.width == obj.ScreenWidth && obj.Canvas.canvas.height == obj.ScreenHeight) return;
        if (obj.FirstDraw) {
            obj.Canvas.canvas.width = obj.ScreenWidth;
            obj.Canvas.canvas.height = obj.ScreenHeight;
            obj.Canvas.fillRect(0, 0, obj.ScreenWidth, obj.ScreenHeight);
            if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId); }
        }
        obj.FirstDraw = false;
        if (obj.debugmode > 1) { console.log("onResize: " + obj.ScreenWidth + " x " + obj.ScreenHeight); }
    }

    obj.xxMouseInputGrab = false;
    obj.xxKeyInputGrab = false;
    obj.xxMouseMove = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.NONE, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxMouseUp = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.UP, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxMouseDown = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.DOWN, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxMouseDblClick = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.DBLCLICK, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxDOMMouseScroll = function (e) { if (obj.State == 3) { obj.SendMouseMsg(obj.KeyAction.SCROLL, e); return false; } return true; }
    obj.xxMouseWheel = function (e) { if (obj.State == 3) { obj.SendMouseMsg(obj.KeyAction.SCROLL, e); return false; } return true; }
    obj.xxKeyUp = function (e) {
        if ((e.key != 'Dead') && (obj.State == 3)) {
            if ((typeof e.key == 'string') && (e.key.length == 1) && (e.ctrlKey != true) && (e.altKey != true) && (obj.remoteKeyMap == false)) {
                obj.SendKeyUnicode(obj.KeyAction.UP, e.key.charCodeAt(0));
            } else {
                obj.SendKeyMsg(obj.KeyAction.UP, e);
            }
        }
        if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false;
    }
    obj.xxKeyDown = function (e) {
        if ((e.key != 'Dead') && (obj.State == 3)) {
            if (!((typeof e.key == 'string') && (e.key.length == 1) && (e.ctrlKey != true) && (e.altKey != true) && (obj.remoteKeyMap == false))) {
                obj.SendKeyMsg(obj.KeyAction.DOWN, e);
                if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false;
            }
        }
    }
    obj.xxKeyPress = function (e) {
        if ((e.key != 'Dead') && (obj.State == 3)) {
            if ((typeof e.key == 'string') && (e.key.length == 1) && (e.ctrlKey != true) && (e.altKey != true) && (obj.remoteKeyMap == false)) {
                obj.SendKeyUnicode(obj.KeyAction.DOWN, e.key.charCodeAt(0));
            } // else { obj.SendKeyMsg(obj.KeyAction.DOWN, e); }
        }
        if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false;
    }

    // Key handlers
    obj.handleKeys = function (e) {
        //console.log('keypress', e.code, e.key, e.keyCode, (e.key.length == 1) ? e.key.charCodeAt(0) : 0);
        if (obj.stopInput == true || desktop.State != 3) return false;
        return obj.xxKeyPress(e);
    }
    obj.handleKeyUp = function (e) {
        //console.log('keyup', e.code, e.key, e.keyCode, (e.key.length == 1)?e.key.charCodeAt(0):0);
        if (obj.stopInput == true || desktop.State != 3) return false;
        if (obj.firstUpKeys.length < 5) {
            obj.firstUpKeys.push(e.keyCode);
            if ((obj.firstUpKeys.length == 5)) { var j = obj.firstUpKeys.join(','); if ((j == '16,17,91,91,16') || (j == '16,17,18,91,92')) { obj.stopInput = true; } }
        }
        return obj.xxKeyUp(e);
    }
    obj.handleKeyDown = function (e) {
        //console.log('keydown', e.code, e.key, e.keyCode, (e.key.length == 1) ? e.key.charCodeAt(0) : 0);
        if (obj.stopInput == true || desktop.State != 3) return false;
        return obj.xxKeyDown(e);
    }

    // Release the CTRL, ALT, SHIFT keys if they are pressed.
    obj.handleReleaseKeys = function () {
        var p = JSON.parse(JSON.stringify(obj.pressedKeys)); // Clone the pressed array
        for (var i in p) { obj.SendKeyMsgKC(obj.KeyAction.UP, p[i]); } // Release all keys
    }

    // Mouse handlers
    obj.mousedblclick = function (e) { if (obj.stopInput == true) return false; return obj.xxMouseDblClick(e); }
    obj.mousedown = function (e) { if (obj.stopInput == true) return false; return obj.xxMouseDown(e); }
    obj.mouseup = function (e) { if (obj.stopInput == true) return false; return obj.xxMouseUp(e); }
    obj.mousemove = function (e) { if (obj.stopInput == true) return false; return obj.xxMouseMove(e); }
    obj.mousewheel = function (e) { if (obj.stopInput == true) return false; return obj.xxMouseWheel(e); }

    obj.xxMsTouchEvent = function (evt) {
        if (evt.originalEvent.pointerType == 4) return; // If this is a mouse pointer, ignore this event. Touch & pen are ok.
        if (evt.preventDefault) evt.preventDefault();
        if (evt.stopPropagation) evt.stopPropagation();
        if (evt.type == 'MSPointerDown' || evt.type == 'MSPointerMove' || evt.type == 'MSPointerUp') {
            var flags = 0;
            var id = evt.originalEvent.pointerId % 256;
            var X = evt.offsetX * (Canvas.canvas.width / obj.CanvasId.clientWidth);
            var Y = evt.offsetY * (Canvas.canvas.height / obj.CanvasId.clientHeight);

            if (evt.type == 'MSPointerDown') flags = 0x00010000 | 0x00000002 | 0x00000004; // POINTER_FLAG_DOWN
            else if (evt.type == 'MSPointerMove') {
                //if (obj.TouchArray[id] && MuchTheSame(obj.TouchArray[id].x, X) && MuchTheSame(obj.TouchArray[id].y, Y)) return;
                flags = 0x00020000 | 0x00000002 | 0x00000004; // POINTER_FLAG_UPDATE
            }
            else if (evt.type == 'MSPointerUp') flags = 0x00040000; // POINTER_FLAG_UP

            if (!obj.TouchArray[id]) obj.TouchArray[id] = { x: X, y : Y };
            obj.SendTouchMsg2(id, flags)
            if (evt.type == 'MSPointerUp') delete obj.TouchArray[id];
        } else {
            alert(evt.type);
        }
        return true;
    }

    obj.xxTouchStart = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            var t = e.originalEvent.touches[0];
            e.which = 1;
            obj.LastX = e.pageX = t.pageX;
            obj.LastY = e.pageY = t.pageY;
            obj.SendMouseMsg(KeyAction.DOWN, e);
        } else {
            var Offsets = obj.GetPositionOfControl(Canvas.canvas);
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (!obj.TouchArray[id]) { obj.TouchArray[id] = { x: (e.originalEvent.touches[i].pageX - Offsets[0]) * (Canvas.canvas.width / obj.CanvasId.clientWidth), y: (e.originalEvent.touches[i].pageY - Offsets[1]) * (Canvas.canvas.height / obj.CanvasId.clientHeight), f: 1 }; }
            }
            if (Object.keys(obj.TouchArray).length > 0 && touchtimer == null) { obj.touchtimer = setInterval(function () { obj.SendTouchMsg2(256, 0); }, 50); }
        }
    }

    obj.xxTouchMove = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            var t = e.originalEvent.touches[0];
            e.which = 1;
            obj.LastX = e.pageX = t.pageX;
            obj.LastY = e.pageY = t.pageY;
            obj.SendMouseMsg(obj.KeyAction.NONE, e);
        } else {
            var Offsets = obj.GetPositionOfControl(Canvas.canvas);
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (obj.TouchArray[id]) {
                    obj.TouchArray[id].x = (e.originalEvent.touches[i].pageX - Offsets[0]) * (obj.Canvas.canvas.width / obj.CanvasId.clientWidth);
                    obj.TouchArray[id].y = (e.originalEvent.touches[i].pageY - Offsets[1]) * (obj.Canvas.canvas.height / obj.CanvasId.clientHeight);
                }
            }
        }
    }

    obj.xxTouchEnd = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            e.which = 1;
            e.pageX = LastX;
            e.pageY = LastY;
            obj.SendMouseMsg(KeyAction.UP, e);
        } else {
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (obj.TouchArray[id]) obj.TouchArray[id].f = 2;
            }
        }
    }

    obj.GrabMouseInput = function () {
        if (obj.xxMouseInputGrab == true) return;
        var c = obj.CanvasId;
        c.onmousemove = obj.xxMouseMove;
        c.onmouseup = obj.xxMouseUp;
        c.onmousedown = obj.xxMouseDown;
        c.touchstart = obj.xxTouchStart;
        c.touchmove = obj.xxTouchMove;
        c.touchend = obj.xxTouchEnd;
        c.MSPointerDown = obj.xxMsTouchEvent;
        c.MSPointerMove = obj.xxMsTouchEvent;
        c.MSPointerUp = obj.xxMsTouchEvent;
        if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = obj.xxDOMMouseScroll; else c.onmousewheel = obj.xxMouseWheel;
        obj.xxMouseInputGrab = true;
    }

    obj.UnGrabMouseInput = function () {
        if (obj.xxMouseInputGrab == false) return;
        var c = obj.CanvasId;
        c.onmousemove = null;
        c.onmouseup = null;
        c.onmousedown = null;
        c.touchstart = null;
        c.touchmove = null;
        c.touchend = null;
        c.MSPointerDown = null;
        c.MSPointerMove = null;
        c.MSPointerUp = null;
        if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = null; else c.onmousewheel = null;
        obj.xxMouseInputGrab = false;
    }

    obj.GrabKeyInput = function () {
        if (obj.xxKeyInputGrab == true) return;
        document.onkeyup = obj.xxKeyUp;
        document.onkeydown = obj.xxKeyDown;
        document.onkeypress = obj.xxKeyPress;c
        obj.xxKeyInputGrab = true;
    }

    obj.UnGrabKeyInput = function () {
        if (obj.xxKeyInputGrab == false) return;
        document.onkeyup = null;
        document.onkeydown = null;
        document.onkeypress = null;
        obj.xxKeyInputGrab = false;
    }

    obj.GetPositionOfControl = function (Control) {
        var Position = Array(2);
        Position[0] = Position[1] = 0;
        while (Control) { Position[0] += Control.offsetLeft; Position[1] += Control.offsetTop; Control = Control.offsetParent; }
        return Position;
    }

    obj.crotX = function (x, y) {
        if (obj.rotation == 0) return x;
        if (obj.rotation == 1) return y;
        if (obj.rotation == 2) return obj.Canvas.canvas.width - x;
        if (obj.rotation == 3) return obj.Canvas.canvas.height - y;
    }

    obj.crotY = function (x, y) {
        if (obj.rotation == 0) return y;
        if (obj.rotation == 1) return obj.Canvas.canvas.width - x;
        if (obj.rotation == 2) return obj.Canvas.canvas.height - y;
        if (obj.rotation == 3) return x;
    }

    obj.rotX = function (x, y) {
        if (obj.rotation == 0 || obj.rotation == 1) return x;
        if (obj.rotation == 2) return x - obj.Canvas.canvas.width;
        if (obj.rotation == 3) return x - obj.Canvas.canvas.height;
    }

    obj.rotY = function (x, y) {
        if (obj.rotation == 0 || obj.rotation == 3) return y;
        if (obj.rotation == 1) return y - obj.Canvas.canvas.width;
        if (obj.rotation == 2) return y - obj.Canvas.canvas.height;
    }

    obj.tcanvas = null;
    obj.setRotation = function (x) {
        while (x < 0) { x += 4; }
        var newrotation = x % 4;
        if (newrotation == obj.rotation) return true;
        var rw = obj.Canvas.canvas.width;
        var rh = obj.Canvas.canvas.height;
        if (obj.rotation == 1 || obj.rotation == 3) { rw = obj.Canvas.canvas.height; rh = obj.Canvas.canvas.width; }

        // Copy the canvas, put it back in the correct direction
        if (obj.tcanvas == null) obj.tcanvas = document.createElement('canvas');
        var tcanvasctx = obj.tcanvas.getContext('2d');
        tcanvasctx.setTransform(1, 0, 0, 1, 0, 0);
        tcanvasctx.canvas.width = rw;
        tcanvasctx.canvas.height = rh;
        tcanvasctx.rotate((obj.rotation * -90) * Math.PI / 180);
        if (obj.rotation == 0) tcanvasctx.drawImage(obj.Canvas.canvas, 0, 0);
        if (obj.rotation == 1) tcanvasctx.drawImage(obj.Canvas.canvas, -obj.Canvas.canvas.width, 0);
        if (obj.rotation == 2) tcanvasctx.drawImage(obj.Canvas.canvas, -obj.Canvas.canvas.width, -obj.Canvas.canvas.height);
        if (obj.rotation == 3) tcanvasctx.drawImage(obj.Canvas.canvas, 0, -obj.Canvas.canvas.height);

        // Change the size and orientation and copy the canvas back into the rotation
        if (obj.rotation == 0 || obj.rotation == 2) { obj.Canvas.canvas.height = rw; obj.Canvas.canvas.width = rh; }
        if (obj.rotation == 1 || obj.rotation == 3) { obj.Canvas.canvas.height = rh; obj.Canvas.canvas.width = rw; }
        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.Canvas.rotate((newrotation * 90) * Math.PI / 180);
        obj.rotation = newrotation;
        obj.Canvas.drawImage(obj.tcanvas, obj.rotX(0, 0), obj.rotY(0, 0));

        obj.ScreenWidth = obj.Canvas.canvas.width;
        obj.ScreenHeight = obj.Canvas.canvas.height;
        if (obj.onScreenSizeChange != null) { console.log('s4', obj.ScreenWidth, obj.ScreenHeight); obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId); }
        return true;
    }

    obj.StartRecording = function () {
        if (obj.recordedData != null) return;
        // Take a screen shot and save it to file
        obj.CanvasId['toBlob'](function (blob) {
            var fileReader = new FileReader();
            fileReader.readAsArrayBuffer(blob);
            fileReader.onload = function (event) {
                // This is an ArrayBuffer, convert it to a string array
                var binary = '', bytes = new Uint8Array(fileReader.result), length = bytes.byteLength;
                for (var i = 0; i < length; i++) { binary += String.fromCharCode(bytes[i]); }
                obj.recordedData = [];
                obj.recordedStart = Date.now();
                obj.recordedSize = 0;
                obj.recordedData.push(recordingEntry(1, 0, JSON.stringify({ magic: 'MeshCentralRelaySession', ver: 1, time: new Date().toLocaleString(), protocol: 2 }))); // Metadata (nodeid: obj.nodeid)
                obj.recordedData.push(recordingEntry(2, 1, obj.shortToStr(7) + obj.shortToStr(8) + obj.shortToStr(obj.ScreenWidth) + obj.shortToStr(obj.ScreenHeight))); // Screen width and height
                // Save a screenshot
                var cmdlen = (8 + binary.length);
                if (cmdlen > 65000) {
                    // Jumbo Packet
                    obj.recordedData.push(recordingEntry(2, 1, obj.shortToStr(27) + obj.shortToStr(8) + obj.intToStr(cmdlen) + obj.shortToStr(3) + obj.shortToStr(0) + obj.shortToStr(0) + obj.shortToStr(0) + binary));
                } else {
                    // Normal packet
                    obj.recordedData.push(recordingEntry(2, 1, obj.shortToStr(3) + obj.shortToStr(cmdlen) + obj.shortToStr(0) + obj.shortToStr(0) + binary));
                }
            };
        });
    }

    obj.StopRecording = function () {
        if (obj.recordedData == null) return;
        var r = obj.recordedData;
        r.push(recordingEntry(3, 0, 'MeshCentralMCREC'));
        delete obj.recordedData;
        delete obj.recordedStart;
        delete obj.recordedSize;
        return r;
    }

    function recordingEntry(type, flags, data) {
        // Header: Type (2) + Flags (2) + Size(4) + Time(8)
        // Type (1 = Header, 2 = Network Data), Flags (1 = Binary, 2 = User), Size (4 bytes), Time (8 bytes)
        var now = Date.now();
        if (typeof data == 'number') {
            obj.recordedSize += data;
            return obj.shortToStr(type) + obj.shortToStr(flags) + obj.intToStr(data) + obj.intToStr(now >> 32) + obj.intToStr(now & 32);
        } else {
            obj.recordedSize += data.length;
            return obj.shortToStr(type) + obj.shortToStr(flags) + obj.intToStr(data.length) + obj.intToStr(now >> 32) + obj.intToStr(now & 32) + data;
        }
    }

    // Private method
    obj.MuchTheSame = function (a, b) { return (Math.abs(a - b) < 4); }
    obj.Debug = function (msg) { console.log(msg); }
    obj.getIEVersion = function () { var r = -1; if (navigator.appName == 'Microsoft Internet Explorer') { var ua = navigator.userAgent; var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})"); if (re.exec(ua) != null) r = parseFloat(RegExp.$1); } return r; }
    obj.haltEvent = function (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }

    return obj;
}
