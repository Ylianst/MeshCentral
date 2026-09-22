/** 
* @description Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.2g
*/

// Polyfill Uint8Array.slice() for IE
if (!Uint8Array.prototype.slice) { Object.defineProperty(Uint8Array.prototype, 'slice', { value: function (begin, end) { return new Uint8Array(Array.prototype.slice.call(this, begin, end)); } }); }

function isWindowsBrowser() {
    return navigator && !!(/win/i).exec(navigator.platform);
}

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
    var drawGeneration = 0, decodeRefreshRequested = false, renderStats = null;
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
    obj._altGrArmed = false;       // Windows AltGr detection
    obj._altGrTimeout = 0;
    obj._altGrDeferredDown = false; // a ControlLeft keydown is held back pending AltGr detection
    obj.isWindowsBrowser = isWindowsBrowser();

    obj.sessionid = 0;
    obj.username;
    obj.oldie = false;
    obj.ImageType = 1; // 1 = JPEG, 2 = PNG, 3 = TIFF, 4 = WebP
    obj.ImageBitmapMinBytes = 65536;
    obj.CompressionLevel = 50;
    obj.AutoWebP = (typeof webpSupport != 'undefined') && (webpSupport === true);
    obj.AutoAVIF = null;
    obj.AutoEncoding = null;
    var encodingProbe = null, avifPending = false;
    // Direct-relay auto mode has no multiplexor to measure the link, so the viewer estimates its own
    // receive rate and per-codec decode cost and reports them straight to the agent (bytes, active ms,
    // per-codec ms-per-megapixel, and the last time a multiplexor probe was seen so we defer to it).
    var directFeedback = { bytes: 0, ms: 0, last: 0, decode: [0, 0, 0, 0], probed: 0 };
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
        obj.AutoEncoding = null;
        obj.State = 0;
        obj.accumulator = null;
        obj.ResetDraw();
    }

    obj.Stop = function () {
        obj.AutoEncoding = null;
        obj.State = 0;
        obj.ResetDraw();
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
    function renderTime() { return ((typeof performance != 'undefined') && performance.now) ? performance.now() : Date.now(); }

    obj.SetRenderStats = function (enabled) {
        renderStats = enabled ? { started: renderTime(), tiles: 0, bytes: 0, drawn: 0, failed: 0, discarded: 0, bitmap: 0, image: 0, fallback: 0, pendingMax: 0, decodeMs: 0, decodeMaxMs: 0, queueMs: 0, queueMaxMs: 0, drawMs: 0, drawMaxMs: 0 } : null;
    }

    obj.GetRenderStats = function () {
        if (renderStats == null) return null;
        var stats = {};
        for (var key in renderStats) { if (key != 'started') stats[key] = renderStats[key]; }
        stats.elapsedMs = renderTime() - renderStats.started;
        stats.pending = obj.PendingOperations.length;
        return stats;
    }

    function releaseTile(op) {
        clearTimeout(op.timer);
        if (op.image && op.image.close) { op.image.close(); }
        if (op.element) { op.element.onload = op.element.onerror = null; op.element.removeAttribute('src'); }
        if (op.url) { URL.revokeObjectURL(op.url); }
        op.image = op.element = op.url = null;
    }

    obj.ResetDraw = function () {
        encodingProbe = null;
        directFeedback.bytes = directFeedback.ms = directFeedback.last = 0;
        // Decode callbacks from an earlier screen or connection must not draw on this one.
        drawGeneration++;
        for (var i = 0; i < obj.PendingOperations.length; i++) {
            var op = obj.PendingOperations[i];
            if (op.stats) op.stats.discarded++;
            releaseTile(op);
        }
        obj.PendingOperations = [];
        obj.tilesReceived = obj.TilesDrawn = 0;
        decodeRefreshRequested = false;
    }

    function renderError(stats, source, error) {
        var message = (source + ': ' + String(error)).slice(0, 512);
        if (stats) { stats.failed++; stats.lastError = message; stats.lastErrorMs = renderTime() - stats.started; }
        if (obj.debugmode > 0) console.log(message);
    }

    function failedTile(op, error) {
        renderError(op.stats, 'Image', error);
        if (op.avif && obj.ImageType == 0 && obj.AutoAVIF === true && obj.parent && obj.State != 0) {
            obj.AutoAVIF = false;
            decodeRefreshRequested = true;
            obj.SendCompressionLevel(0);
            return;
        }
        // Retry once until a manual refresh, format change or screen reset. A bad cached tile must not cause a refresh loop.
        if (!decodeRefreshRequested && obj.parent && obj.State != 0) {
            decodeRefreshRequested = true;
            obj.send(String.fromCharCode(0x00, 0x06, 0x00, 0x04));
        }
    }

    // Report the estimated link rate and per-codec decode cost straight to the agent. Used in direct-relay
    // auto mode; when a multiplexor is probing (it measures the link more precisely) this stays quiet.
    function sendDirectFeedback() {
        if (obj.ImageType != 0 || !obj.AutoEncoding || obj.State == 0 || !obj.parent) return;
        if (directFeedback.probed && (Date.now() - directFeedback.probed < 5000)) return;
        if (directFeedback.ms < 700 || directFeedback.bytes < 8192) return; // Wait for a real burst before estimating.
        var rate = Math.max(1024, Math.min(125000000, Math.round(directFeedback.bytes * 1000 / directFeedback.ms)));
        var avif = obj.AutoEncoding.formats & 4;
        obj.send(String.fromCharCode(0, 90, 0, avif ? 14 : 12) + obj.intToStr(rate) + obj.shortToStr(Math.ceil(directFeedback.decode[0])) + obj.shortToStr(Math.ceil(directFeedback.decode[1])) + (avif ? obj.shortToStr(Math.ceil(directFeedback.decode[2])) : ''));
        directFeedback.bytes = 0; directFeedback.ms = 0;
    }

    obj.ProcessPictureMsg = function (data, X, Y) {
        if (obj.State == 0) return;
        var probe = encodingProbe;
        var tdata = data.subarray(4), blob = null, mime = 'image/jpeg';
        if ((tdata[0] == 137) && (tdata[1] == 80)) { mime = 'image/png'; }
        else if ((tdata[0] == 82) && (tdata[1] == 73)) { mime = 'image/webp'; }
        else if (((tdata[0] == 73) && (tdata[1] == 73)) || ((tdata[0] == 77) && (tdata[1] == 77))) { mime = 'image/tiff'; }
        else if (tdata[4] == 102 && tdata[5] == 116 && tdata[6] == 121 && tdata[7] == 112 && tdata[8] == 97 && tdata[9] == 118 && tdata[10] == 105 && tdata[11] == 102) { mime = 'image/avif'; }
        var codecIndex = mime == 'image/avif' ? 2 : mime == 'image/webp' ? 1 : 0;
        if (obj.ImageType == 0 && obj.AutoEncoding) obj.AutoEncoding.type = mime == 'image/avif' ? 5 : mime == 'image/webp' ? 4 : 1;
        var recv = renderTime();
        // Pair each tile's size with the gap since the previous tile; during a burst that gap is the link transfer time.
        if (obj.ImageType == 0) {
            if (directFeedback.last && (recv - directFeedback.last) > 0 && (recv - directFeedback.last) < 1000) { directFeedback.ms += (recv - directFeedback.last); directFeedback.bytes += tdata.byteLength; }
            directFeedback.last = recv;
            sendDirectFeedback();
        }
        obj.tilesReceived++;
        var op = { generation: drawGeneration, x: X, y: Y, ready: false, image: null, stats: renderStats, probe: probe, avif: mime == 'image/avif', started: recv, recv: recv, codecIndex: codecIndex };
        encodingProbe = null;
        if (op.stats) {
            op.started = renderTime();
            op.stats.tiles++;
            op.stats.bytes += tdata.byteLength;
            op.stats.pendingMax = Math.max(op.stats.pendingMax, obj.PendingOperations.length + 1);
        }
        obj.PendingOperations.push(op);
        op.timer = setTimeout(function () { finish(null, 'Decode timed out'); }, 15000);

        function finish(image, error) {
            if (op.ready || (op.generation != drawGeneration)) {
                if (image && image.close) image.close();
                return;
            }
            clearTimeout(op.timer);
            op.ready = true;
            op.image = image;
            if (op.element) { op.element.onload = op.element.onerror = null; }
            // Record decode cost per codec (ms per megapixel) for the direct-relay feedback.
            if (obj.ImageType == 0 && image) { var px = (image.width * image.height) || 0; if (px > 0) directFeedback.decode[op.codecIndex] = Math.min(1000, (renderTime() - op.recv) * 1000000 / px); }
            if (op.stats) {
                op.decoded = renderTime();
                var elapsed = op.decoded - op.started;
                op.stats.decodeMs += elapsed;
                op.stats.decodeMaxMs = Math.max(op.stats.decodeMaxMs, elapsed);
            }
            if (image == null) failedTile(op, error);
            while (obj.DoPendingOperations()) { }
        }

        function loadImage() {
            if (op.ready || (op.generation != drawGeneration)) return;
            if (op.stats) op.stats.image++;
            var tile = op.element = new Image();
            tile.onload = function () { finish(tile); }
            tile.onerror = function () { finish(null, 'Decode failed'); }
            try {
                if (blob && (typeof URL != 'undefined') && URL.createObjectURL) {
                    op.url = URL.createObjectURL(blob);
                    tile.src = op.url;
                } else {
                    var strs = [];
                    for (var ptr = 0; ptr < tdata.byteLength; ptr += 50000) { strs.push(String.fromCharCode.apply(null, tdata.subarray(ptr, ptr + 50000))); }
                    tile.src = 'data:' + mime + ';base64,' + btoa(strs.join(''));
                }
            } catch (ex) { finish(null, ex); }
        }

        function fallback() {
            if (op.ready || (op.generation != drawGeneration)) return;
            if (op.stats) op.stats.fallback++;
            loadImage();
        }

        // Blob setup costs more than base64 for small tiles in Chromium.
        try { if ((tdata.byteLength >= obj.ImageBitmapMinBytes) && (typeof Blob != 'undefined')) blob = new Blob([tdata], { type: mime }); } catch (ex) { }
        if (blob && (typeof createImageBitmap == 'function')) {
            if (op.stats) op.stats.bitmap++;
            try { createImageBitmap(blob).then(finish, fallback); } catch (ex) { fallback(); }
        } else {
            loadImage();
        }
    }

    obj.DoPendingOperations = function () {
        if ((obj.PendingOperations.length == 0) || !obj.PendingOperations[0].ready) return false;
        var op = obj.PendingOperations.shift();
        obj.TilesDrawn++;
        try {
            if (op.image && obj.Canvas && (obj.State != 0)) {
                if (obj.onPreDrawImage != null) obj.onPreDrawImage();
                if ((op.generation == drawGeneration) && (obj.State != 0)) {
                    var started = op.stats ? renderTime() : 0;
                    obj.Canvas.drawImage(op.image, obj.rotX(op.x, op.y), obj.rotY(op.x, op.y));
                    if (op.probe && obj.ImageType == 0 && obj.parent) {
                        var elapsed = Math.min(15000, Math.max(0, Math.ceil(renderTime() - op.started)));
                        obj.send(String.fromCharCode(0, 90, 0, 12) + op.probe + obj.intToStr(elapsed));
                    }
                    if (op.stats) {
                        var drawMs = renderTime() - started, queueMs = started - op.decoded;
                        op.stats.drawn++;
                        op.stats.drawMs += drawMs;
                        op.stats.drawMaxMs = Math.max(op.stats.drawMaxMs, drawMs);
                        op.stats.queueMs += queueMs;
                        op.stats.queueMaxMs = Math.max(op.stats.queueMaxMs, queueMs);
                    }
                }
            }
        } catch (ex) { failedTile(op, ex); }
        finally { releaseTile(op); }
        if (obj.PendingOperations.length == 0) { obj.TilesDrawn = obj.tilesReceived = 0; }
        return true;
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

    function checkAvifSupport() {
        if (obj.AutoAVIF != null || avifPending) return;
        avifPending = true;
        function available(supported) {
            avifPending = false;
            obj.AutoAVIF = supported;
            if (supported && obj.ImageType == 0 && obj.State != 0) obj.SendCompressionLevel(0);
        }
        var factory = CreateAgentRemoteDesktop;
        if (typeof factory.avifSupport == 'boolean') { available(factory.avifSupport); return; }
        if (factory.avifCallbacks) { factory.avifCallbacks.push(available); return; }
        factory.avifCallbacks = [available];
        var probe = new Image(), timer = setTimeout(function () { finish(false); }, 5000);
        function finish(supported) {
            if (!factory.avifCallbacks) return;
            clearTimeout(timer);
            probe.onload = probe.onerror = null;
            probe.removeAttribute('src');
            factory.avifSupport = supported;
            var callbacks = factory.avifCallbacks;
            factory.avifCallbacks = null;
            for (var i = 0; i < callbacks.length; i++) callbacks[i](supported);
        }
        probe.onload = function () { finish(probe.width == 1 && probe.height == 1); };
        probe.onerror = function () { finish(false); };
        probe.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAJAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAALG1kYXQSAAoHOAAGkBDQaTIXGUJjBMPPPPNBIACQQRHVQ0SY9gqP6M4=';
    }

    obj.SendCompressionLevel = function (type, level, scaling, frametimer) { // Type: 0 = Auto, 1 = JPEG, 2 = PNG, 3 = TIFF, 4 = WebP, 5 = AVIF
        if (obj.ImageType != type) decodeRefreshRequested = false;
        obj.ImageType = type;
        if (level) { obj.CompressionLevel = level; }
        if (scaling) { obj.ScalingLevel = scaling; }
        if (frametimer) { obj.FrameRateTimer = frametimer; }
        if (type != 0) { obj.AutoEncoding = null; encodingProbe = null; }
        // Auto mode advertises the image formats this browser can decode; the agent replies with the ones it can encode.
        obj.send(String.fromCharCode(0, 5, 0, type == 0 ? 16 : 10, type == 0 ? 1 : type, obj.CompressionLevel) + obj.shortToStr(obj.ScalingLevel) + obj.shortToStr(obj.FrameRateTimer) + (type == 0 ? 'AUTO' + String.fromCharCode(1, 1 | (obj.AutoWebP ? 2 : 0) | (obj.AutoAVIF === true ? 4 : 0)) : ''));
        if (type == 0) checkAvifSupport();
    }

    obj.SendRefresh = function () {
        obj.ResetDraw();
        obj.send(String.fromCharCode(0x00, 0x06, 0x00, 0x04));
    }

    obj.ProcessScreenMsg = function (width, height) {
        if (obj.debugmode > 0) { console.log('ScreenSize: ' + width + ' x ' + height); }
        if ((obj.ScreenWidth == width) && (obj.ScreenHeight == height)) {
            // A replacement capture child needs the settings even when its dimensions match.
            obj.SendCompressionLevel(obj.ImageType);
            return;
        }
        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.rotation = 0;
        obj.FirstDraw = true;
        obj.ScreenWidth = obj.width = width;
        obj.ScreenHeight = obj.height = height;
        obj.ResetDraw();
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
            var result = '';
            for (var i = 0; i < view.length; i += 10000) { result += String.fromCharCode.apply(null, view.subarray(i, i + 10000)); }
            if (cmdsize > 65000) {
                obj.recordedData.push(recordingEntry(2, 1, obj.shortToStr(27) + obj.shortToStr(8) + obj.intToStr(cmdsize) + result));
            } else {
                obj.recordedData.push(recordingEntry(2, 1, result));
            }
        }

        switch (cmd) {
            case 5:
                // Agent reply to an AUTO request: view[9] is the bitmask of image formats it can encode (1 JPEG, 2 WebP, 4 AVIF).
                if (cmdsize == 12 && view[4] == 65 && view[5] == 85 && view[6] == 84 && view[7] == 79 && view[8] == 1 && obj.ImageType == 0) {
                    obj.AutoEncoding = { formats: view[9] & 7 };
                }
                break;
            case 90:
                if (cmdsize == 8 && obj.ImageType == 0 && obj.AutoEncoding && obj.State != 0) { encodingProbe = String.fromCharCode(view[4], view[5], view[6], view[7]); directFeedback.probed = Date.now(); }
                if (cmdsize == 12 && view[8] == 80 && view[9] == 73 && view[10] == 78 && view[11] == 71 && obj.ImageType == 0 && obj.AutoEncoding && obj.State != 0 && obj.parent) {
                    obj.send(String.fromCharCode(0, 90, 0, 8, view[4], view[5], view[6], view[7]));
                }
                break;
            case 3: // Tile
                if (obj.FirstDraw) obj.onResize();
                //console.log('TILE', X, Y, cmdsize);
                obj.ProcessPictureMsg(view.subarray(4), X, Y);
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

    var extendedKeyTable = ['AltRight', 'ControlRight', 'Home', 'End', 'Insert', 'Delete', 'PageUp', 'PageDown', 'NumpadDivide', 'NumpadEnter', 'NumLock', 'Pause'];
    obj.SendKeyMsg = function (action, event) {
        if (action == null) return;
        if (!event) { event = window.event; }

        var extendedKey = false; // Test feature, add ?extkeys=1 to url to use.

        if ((obj.UseExtendedKeyFlag || (urlargs.extkeys == 1)) && (typeof event.code == 'string') && (event.code.startsWith('Arrow') || (extendedKeyTable.indexOf(event.code) >= 0))) {
            extendedKey = true; 
        }

        if (obj.isWindowsBrowser) {
            if( obj.checkAltGr(obj, event, action) ) {
              return;
            }; 
        }

        if ((obj.UseExtendedKeyFlag || (urlargs.extkeys == 1)) && ((event.code == 'ShiftRight') || ((event.keyCode == 16) && (event.location == 2)))) {
            // Right Shift has its own scan code, not an extended Left Shift scan code.
            obj.SendKeyMsgKC(action, 161, false);
        } else if ((extendedKey == false) && event.code && (event.code.startsWith('NumPad') == false) && (obj.localKeyMap == false)) {
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

    const ControlLeftKc = 17;
    const AltGrKc = 225;
    //return true: Key is alredy handled. 
    obj.checkAltGr = function (obj, event, action) {
        // Windows doesn't have a proper AltGr, but handles it using
        // fake Ctrl+Alt. However the remote end might not be Windows,
        // so we need to merge those into a single AltGr event. We
        // detect this case by seeing the two key events directly after
        // each other with a very short time between them (<50ms).
        if (obj._altGrArmed) {
            obj._altGrArmed = false;
            clearTimeout(obj._altGrTimeout);
            var deferredCtrlDown = obj._altGrDeferredDown;
            obj._altGrDeferredDown = false;

            if ((event.code === "AltRight") &&  ((event.timeStamp - obj._altGrCtrlTime) < 50)) {
                //AltGr detected.
                obj.SendKeyMsgKC( action, AltGrKc, false);
                return true;
            } 

            // Not an AltGr sequence: flush the deferred ControlLeft keydown BEFORE processing
            // this event, so the remote sees Ctrl go down first. Previously it was dropped
            // here, which lost fast Left-Ctrl taps and delivered "C before Ctrl" on a quick
            // Ctrl+C (issue #6491).
            if (deferredCtrlDown) {
                obj.SendKeyMsgKC( 1, ControlLeftKc, false);
            }
        }

        // Possible start of AltGr sequence? 
        // NOTE: `in` on an array tests INDICES, not membership — must be indexOf. Arming on
        // keyup (no timer, falls through to return false so the keyup still sends) is
        // intentional: it lets the AltRight keyup that follows merge into an AltGr keyup.
        if ((event.code === "ControlLeft") && (obj.pressedKeys.indexOf(ControlLeftKc) == -1)) {
          obj._altGrArmed = true;
            obj._altGrCtrlTime = event.timeStamp;
          if( action == 1 ) {
            obj._altGrDeferredDown = true;
            obj._altGrTimeout = setTimeout(obj._handleAltGrTimeout.bind(obj), 100);
            return true;
          }
        }
        return false;
    }

    obj._handleAltGrTimeout = function () { //Windows and no Ctrl+Alt -> send only Ctrl.
        obj._altGrArmed = false;
        obj._altGrDeferredDown = false;
        clearTimeout(obj._altGrTimeout);
        obj.SendKeyMsgKC( 1, ControlLeftKc, false); // (KeyDown, "ControlLeft", false)
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
        if (obj.debugmode > 0) { console.log('Sending UnicodeKey ' + val + ', action ' + action); }
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
                // Map the displayed (view-rotated) canvas position back to desktop coordinates,
                // like amt-desktop does; without this every rotated view sends wrong mouse positions.
                if (obj.rotation != 0) { var rotatedX = obj.crotX(X, Y); Y = obj.crotY(X, Y); X = rotatedX; }
                var Button = 0;
                var Delta = 0;
                if (Action == obj.KeyAction.UP || Action == obj.KeyAction.DOWN) {
                    if (event.which) { ((event.which == 1) ? (Button = obj.MouseButton.LEFT) : ((event.which == 2) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                    else if (typeof event.button == 'number') { ((event.button == 0) ? (Button = obj.MouseButton.LEFT) : ((event.button == 1) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                }
                else if (Action == obj.KeyAction.SCROLL) {
                    if (event.detail) { Delta = (-1 * (event.detail * 120)); } else if (event.wheelDelta) { Delta = (event.wheelDelta * 3); }
                }

                // Swap mouse buttons if needed
                if (obj.SwapMouse === true) {
                    if (Button == obj.MouseButton.LEFT) { Button = obj.MouseButton.RIGHT; }
                    else if (Button == obj.MouseButton.RIGHT) { Button = obj.MouseButton.LEFT; }
                }

                // Reverse mouse wheel if needed
                if (obj.ReverseMouseWheel) { Delta = -1 * Delta; }

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
        if ((obj.Canvas.canvas.width == obj.ScreenWidth) && (obj.Canvas.canvas.height == obj.ScreenHeight)) return;
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
        // Save the current handlers so UnGrabKeyInput can restore them instead of
        // leaving the document without any keyboard handler. Only take ownership
        // of slots this instance does not already own.
        if (document.onkeydown !== obj.xxKeyDown) { obj._savedOnKeyDown = document.onkeydown; }
        if (document.onkeyup !== obj.xxKeyUp) { obj._savedOnKeyUp = document.onkeyup; }
        if (document.onkeypress !== obj.xxKeyPress) { obj._savedOnKeyPress = document.onkeypress; }
        document.onkeyup = obj.xxKeyUp;
        document.onkeydown = obj.xxKeyDown;
        document.onkeypress = obj.xxKeyPress;
        obj.xxKeyInputGrab = true;
    }

    obj.UnGrabKeyInput = function () {
        if (obj.xxKeyInputGrab == false) return;
        // Restore the handlers that were in place before GrabKeyInput, but only
        // for slots this instance still owns. A newer session may have taken over
        // the slots meanwhile (disconnect + reconnect of a grabbed session), in
        // which case leave the current handlers alone.
        if (document.onkeydown === obj.xxKeyDown) { document.onkeydown = obj._savedOnKeyDown || null; }
        if (document.onkeyup === obj.xxKeyUp) { document.onkeyup = obj._savedOnKeyUp || null; }
        if (document.onkeypress === obj.xxKeyPress) { document.onkeypress = obj._savedOnKeyPress || null; }
        obj._savedOnKeyDown = obj._savedOnKeyUp = obj._savedOnKeyPress = null;
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
            return obj.shortToStr(type) + obj.shortToStr(flags) + obj.intToStr(data) + obj.intToStr(Math.floor(now / 0x100000000)) + obj.intToStr(now);
        } else {
            obj.recordedSize += data.length;
            return obj.shortToStr(type) + obj.shortToStr(flags) + obj.intToStr(data.length) + obj.intToStr(Math.floor(now / 0x100000000)) + obj.intToStr(now) + data;
        }
    }

    // Private method
    obj.MuchTheSame = function (a, b) { return (Math.abs(a - b) < 4); }
    obj.Debug = function (msg) { console.log(msg); }
    obj.getIEVersion = function () { var r = -1; if (navigator.appName == 'Microsoft Internet Explorer') { var ua = navigator.userAgent; var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})"); if (re.exec(ua) != null) r = parseFloat(RegExp.$1); } return r; }
    obj.haltEvent = function (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }

    return obj;
}
