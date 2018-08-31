
var promise = require('promise');
var PPosition = 4;
var PSize = 8;
var _NET_WM_STATE_REMOVE = 0;    // remove/unset property
var _NET_WM_STATE_ADD = 1;    // add/set property
var _NET_WM_STATE_TOGGLE = 2;    // toggle property
var SubstructureRedirectMask = (1 << 20);
var SubstructureNotifyMask = (1 << 19);


function monitorinfo()
{
    this._ObjectID = 'monitor-info';
    this._gm = require('_GenericMarshal');

    if (process.platform == 'win32')
    {
        this._user32 = this._gm.CreateNativeProxy('user32.dll');
        this._user32.CreateMethod('EnumDisplayMonitors');
        this._kernel32 = this._gm.CreateNativeProxy('kernel32.dll');
        this._kernel32.CreateMethod('GetLastError');

        this.getInfo = function getInfo()
        {
            var info = this;
            return (new promise(function (resolver, rejector) {
                this._monitorinfo = { resolver: resolver, rejector: rejector, self: info, callback: info._gm.GetGenericGlobalCallback(4) };
                this._monitorinfo.callback.info = this._monitorinfo;
                this._monitorinfo.dwData = info._gm.ObjectToPtr(this._monitorinfo);

                this._monitorinfo.callback.results = [];
                this._monitorinfo.callback.on('GlobalCallback', function OnMonitorInfo(hmon, hdc, r, user) {
                    if (this.ObjectToPtr_Verify(this.info, user)) {
                        var rb = r.Deref(0, 16).toBuffer();
                        this.results.push({ left: rb.readInt32LE(0), top: rb.readInt32LE(4), right: rb.readInt32LE(8), bottom: rb.readInt32LE(12) });

                        var r = this.info.self._gm.CreateInteger();
                        r.Val = 1;
                        return (r);
                    }
                });

                if (info._user32.EnumDisplayMonitors(0, 0, this._monitorinfo.callback, this._monitorinfo.dwData).Val == 0) {
                    rejector('LastError=' + info._kernel32.GetLastError().Val);
                    return;
                }
                else {
                    resolver(this._monitorinfo.callback.results);
                }

            }));
        }
    }
    else if(process.platform == 'linux')
    {
        this._X11 = this._gm.CreateNativeProxy('libX11.so');
        this._X11.CreateMethod('XChangeProperty');
        this._X11.CreateMethod('XCloseDisplay');
        this._X11.CreateMethod('XCreateGC');
        this._X11.CreateMethod('XCreateWindow');
        this._X11.CreateMethod('XCreateSimpleWindow');
        this._X11.CreateMethod('XDefaultColormap');
        this._X11.CreateMethod('XDefaultScreen');
        this._X11.CreateMethod('XDrawLine');
        this._X11.CreateMethod('XDisplayHeight');
        this._X11.CreateMethod('XDisplayWidth');
        this._X11.CreateMethod('XFetchName');
        this._X11.CreateMethod('XFlush');
        this._X11.CreateMethod('XFree');
        this._X11.CreateMethod('XCreateGC');
        this._X11.CreateMethod('XGetWindowProperty');
        this._X11.CreateMethod('XInternAtom');
        this._X11.CreateMethod('XMapWindow');
        this._X11.CreateMethod({ method: 'XNextEvent', threadDispatch: true });
        this._X11.CreateMethod('XOpenDisplay');
        this._X11.CreateMethod('XRootWindow');
        this._X11.CreateMethod('XScreenCount');
        this._X11.CreateMethod('XScreenOfDisplay');
        this._X11.CreateMethod('XSelectInput');
        this._X11.CreateMethod('XSendEvent');
        this._X11.CreateMethod('XSetForeground');
        this._X11.CreateMethod('XSetFunction');
        this._X11.CreateMethod('XSetLineAttributes');
        this._X11.CreateMethod('XSetNormalHints');
        this._X11.CreateMethod('XSetSubwindowMode');
 
        this._X11.CreateMethod('XBlackPixel');
        this._X11.CreateMethod('XWhitePixel');     
        
        this.isUnity = function isUnity()
        {
            var ret = false;
            var display = this._X11.XOpenDisplay(this._gm.CreateVariable(':0'));
            var rootWindow = this._X11.XRootWindow(display, this._X11.XDefaultScreen(display));

            var a = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_CLIENT_LIST'), 1);
            var actualType = this._gm.CreateVariable(8);
            var format = this._gm.CreateVariable(4);
            var numItems = this._gm.CreateVariable(8);
            var bytesAfter = this._gm.CreateVariable(8);
            var data = this._gm.CreatePointer();

            this._X11.XGetWindowProperty(display, rootWindow, a, 0, ~0, 0, 0, actualType, format, numItems, bytesAfter, data);
            for (var i = 0; i < numItems.Deref(0, 4).toBuffer().readUInt32LE(0) ; ++i)
            {
                var w = data.Deref().Deref(i * 8, 8).Deref(8);
                var name = this._gm.CreatePointer();
                var ns = this._X11.XFetchName(display, w, name);
                if (name.Deref().String == 'unity-launcher')
                {
                    ret = true;
                    break;
                }
            }
            this._X11.XCloseDisplay(display);
            return (ret);
        }

        this.unDecorateWindow = function unDecorateWindow(display, window)
        {
            var MwmHints = this._gm.CreateVariable(40);
            var mwmHintsProperty = this._X11.XInternAtom(display, this._gm.CreateVariable('_MOTIF_WM_HINTS'), 0);
            MwmHints.Deref(0, 4).toBuffer().writeUInt32LE(1 << 1);
            this._X11.XChangeProperty(display, window, mwmHintsProperty, mwmHintsProperty, 32, 0, MwmHints, 5);
        }
        this.setWindowSizeHints = function setWindowSizeHints(display, window, x, y, width, height)
        {
            var sizeHints = this._gm.CreateVariable(80);
            sizeHints.Deref(0, 4).toBuffer().writeUInt32LE(PPosition | PSize);
            sizeHints.Deref(8, 4).toBuffer().writeUInt32LE(x);
            sizeHints.Deref(12, 4).toBuffer().writeUInt32LE(y);
            sizeHints.Deref(16, 4).toBuffer().writeUInt32LE(width);
            sizeHints.Deref(20, 4).toBuffer().writeUInt32LE(height);
            this._X11.XSetNormalHints(display, window, sizeHints);
        }
        this.setAlwaysOnTop = function setAlwaysOnTop(display, rootWindow, window)
        {
            var wmNetWmState = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE'), 1);
            var wmStateAbove = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE_ABOVE'), 1);

            var xclient = this._gm.CreateVariable(96);
            xclient.Deref(0, 4).toBuffer().writeUInt32LE(33);                   // ClientMessage type
            xclient.Deref(48, 4).toBuffer().writeUInt32LE(32);                  // Format 32
            wmNetWmState.pointerBuffer().copy(xclient.Deref(40, 8).toBuffer()); // message_type
            xclient.Deref(56, 8).toBuffer().writeUInt32LE(_NET_WM_STATE_ADD);   // data.l[0]
            wmStateAbove.pointerBuffer().copy(xclient.Deref(64, 8).toBuffer()); // data.l[1]

            window.pointerBuffer().copy(xclient.Deref(32, 8).toBuffer());       // window
            this._X11.XSendEvent(display, rootWindow, 0, SubstructureRedirectMask | SubstructureNotifyMask, xclient);
        }
        this.hideWindowIcon = function hideWindowIcon(display, rootWindow, window)
        {
            var wmNetWmState = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE'), 1);
            var wmStateSkip = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE_SKIP_TASKBAR'), 1);

            var xclient = this._gm.CreateVariable(96);
            xclient.Deref(0, 4).toBuffer().writeUInt32LE(33);                   // ClientMessage type
            xclient.Deref(48, 4).toBuffer().writeUInt32LE(32);                  // Format 32
            wmNetWmState.pointerBuffer().copy(xclient.Deref(40, 8).toBuffer()); // message_type
            xclient.Deref(56, 8).toBuffer().writeUInt32LE(_NET_WM_STATE_ADD);   // data.l[0]
            wmStateSkip.pointerBuffer().copy(xclient.Deref(64, 8).toBuffer());  // data.l[1]

            window.pointerBuffer().copy(xclient.Deref(32, 8).toBuffer());       // window
            this._X11.XSendEvent(display, rootWindow, 0, SubstructureRedirectMask | SubstructureNotifyMask, xclient);
        }

        this.getInfo = function getInfo()
        {
            var info = this;
            return (new promise(function (resolver, rejector)
            {
                var display = info._X11.XOpenDisplay(info._gm.CreateVariable(':0'));
                var screenCount = info._X11.XScreenCount(display).Val;
                var ret = [];
                for(var i=0;i<screenCount;++i)
                {
                    var screen = info._X11.XScreenOfDisplay(display, i);
                    ret.push({ left: 0, top: 0, right: info._X11.XDisplayWidth(display, i).Val, bottom: info._X11.XDisplayHeight(display, i).Val, screen: screen, screenId: i, display: display });
                }
                resolver(ret);
            }));
        }
    }
    else
    {
        throw (process.platform + ' not supported');
    }
}

module.exports = new monitorinfo();



