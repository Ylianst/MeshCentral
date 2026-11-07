/**
 * MeshCentral desktop-tab adapter for the Guacamole Web-RDP page.
 * Loaded after the legacy adapter and only activated by mstscClient=guacamole.
 */

if (typeof webRdpClient !== 'undefined' && webRdpClient === 'guacamole') {
    CreateRDPDesktop = function (canvasid, domainUrl) {
        var obj = {};
        obj.State = 0;
        obj.contype = 4;
        obj.CanvasId = (typeof canvasid === 'string') ? document.getElementById(canvasid) : canvasid;
        obj.m = {
            KeyAction: { NONE: 0, DOWN: 1, UP: 2, SCROLL: 3, EXUP: 4, EXDOWN: 5, DBLCLICK: 6 },
            ScreenWidth: 1280,
            ScreenHeight: 720,
            onClipboardChanged: null,
            onScreenSizeChange: null,
            SwapMouse: false,
            ReverseMouseWheel: false,
            setRotation: function () { },
            mouseCursorActive: function () { },
            GrabMouseInput: function () { },
            UnGrabMouseInput: function () { },
            releaseModifiers: function () { },
            handleKeys: function () { return true; },
            handleKeyDown: function () { return true; },
            handleKeyUp: function () { return true; },
            handleReleaseKeys: function () { return true; },
            SendRefresh: function () { if (obj.frame && obj.frame.contentWindow) obj.frame.contentWindow.postMessage({ action: 'meshcentral-rdp-resize' }, window.location.origin); },
            sendcad: function () { if (obj.frame && obj.frame.contentWindow) obj.frame.contentWindow.postMessage({ action: 'meshcentral-rdp-cad' }, window.location.origin); },
            setClipboard: function (text) { if (obj.frame && obj.frame.contentWindow) obj.frame.contentWindow.postMessage({ action: 'meshcentral-rdp-clipboard', text: text }, window.location.origin); },
            getClipboard: function () { return obj.lastClipboardContent; }
        };

        function changeState(state) {
            if (obj.State === state) return;
            obj.State = state;
            if (obj.onStateChanged) obj.onStateChanged(obj, state);
        }

        function onMessage(event) {
            if ((event.origin !== window.location.origin) || !obj.frame || (event.source !== obj.frame.contentWindow) || !event.data) return;
            if (event.data.action === 'meshcentral-rdp-state') {
                changeState(event.data.state);
                if (event.data.message) {
                    obj.consoleMessage = event.data.message;
                    obj.consoleMessageTimeout = 8;
                    if (obj.onConsoleMessageChange) obj.onConsoleMessageChange();
                }
            } else if (event.data.action === 'meshcentral-rdp-size') {
                obj.m.ScreenWidth = event.data.width;
                obj.m.ScreenHeight = event.data.height;
                if (obj.m.onScreenSizeChange) obj.m.onScreenSizeChange(obj, event.data.width, event.data.height, obj.CanvasId);
            } else if (event.data.action === 'meshcentral-rdp-clipboard') {
                obj.lastClipboardContent = event.data.text;
                if (obj.m.onClipboardChanged) obj.m.onClipboardChanged(event.data.text);
            }
        }

        obj.Start = function (nodeid, port, credentials) {
            obj.nodeid = nodeid;
            obj.credentials = credentials || {};
            changeState(1);
            var parent = obj.CanvasId.parentNode;
            obj.CanvasId.style.display = 'none';
            obj.frame = document.createElement('iframe');
            obj.frame.setAttribute('title', 'Web-RDP');
            obj.frame.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#000;';
            obj.frame.src = domainUrl + 'mstsc.html?node=' + encodeURIComponent(nodeid) + '&embed=1' + ((port && port !== 3389) ? ('&port=' + encodeURIComponent(port)) : '');
            obj.frame.onload = function () {
                obj.frame.contentWindow.postMessage({
                    action: 'meshcentral-rdp-connect',
                    credentials: obj.credentials
                }, window.location.origin);
            };
            parent.appendChild(obj.frame);
            window.addEventListener('message', onMessage);
        };

        obj.Stop = function () {
            window.removeEventListener('message', onMessage);
            if (obj.frame) { try { obj.frame.contentWindow.postMessage({ action: 'meshcentral-rdp-disconnect' }, window.location.origin); } catch (ex) { } obj.frame.remove(); obj.frame = null; }
            obj.CanvasId.style.display = '';
            changeState(0);
        };

        return obj;
    };
}
