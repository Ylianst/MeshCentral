/*
Copyright 2018 Intel Corporation

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

var promise = require('promise');
var PPosition = 4;
var PSize = 8;
var PMinSize = 1 << 4;
var PMaxSize = 1 << 5;
var _NET_WM_STATE_REMOVE = 0;    // remove/unset property
var _NET_WM_STATE_ADD = 1;    // add/set property
var _NET_WM_STATE_TOGGLE = 2;    // toggle property
var SubstructureRedirectMask = (1 << 20);
var SubstructureNotifyMask = (1 << 19);
var PropModeReplace = 0;
var XA_ATOM = 4;
var MWM_HINTS_FUNCTIONS = (1 << 0);
var MWM_HINTS_DECORATIONS = (1 << 1);
var ClientMessage = 33;
var CWEventMask = (1 << 11);
var PropertyChangeMask = (1 << 22);
var PropertyNotify = 28;
var AnyPropertyType = 0;

function getLibInfo(libname)
{
    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = '';
    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
    child.stdin.write("whereis ldconfig | awk '{ print $2 }'\nexit\n");
    child.waitExit();

    if (child.stdout.str.trim() != '')
    {
        var ldconfig = child.stdout.str.trim();
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        child.stdin.write(ldconfig + " -p | grep '" + libname + ".so.' | tr '\\n' '^' | awk -F^ '{ printf \"[\"; for(i=1;i<=NF;++i) {" + ' split($i, plat, ")"); split(plat[1], plat2, "("); ifox=split(plat2[2], ifo, ","); libc=""; hwcap="0"; for(ifoi=1;ifoi<=ifox;++ifoi) { if(split(ifo[ifoi], jnk, "libc")==2) { libc=ifo[ifoi]; } if(split(ifo[ifoi], jnk, "hwcap:")==2) { split(ifo[ifoi], jnk, "0x"); hwcap=jnk[2]; }   }      x=split($i, tok, " "); if(tok[1]!="") { printf "%s{\\"lib\\": \\"%s\\", \\"path\\": \\"%s\\", \\"hwcap\\": \\"%s\\", \\"libc\\": \\"%s\\"}", (i!=1?",":""), tok[1], tok[x], hwcap, libc; }} printf "]"; }\'\nexit\n');
        child.waitExit();

        try
        {
            var v = JSON.parse(child.stdout.str.trim());
            if (v.length != 0) { return (v); }
        }
        catch (e)
        {
        }
    }

    // No ldconfig, or no result returned;
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.on('data', function () { });
    child.stdin.write('ls /lib/' + libname + '.*' + " | tr '\\n' '`' | awk -F'`' '{" + ' DEL=""; printf "["; for(i=1;i<NF;++i) { if($1~/((\\.so)(\\.[0-9]+)*)$/) { printf "%s{\\"path\\": \\"%s\\"}",DEL,$i; DEL=","; } } printf "]"; }\'\nexit\n');
    child.waitExit();
    try
    {
        return (JSON.parse(child.stdout.str.trim()));
    }
    catch (e)
    {
        return ([]);
    }
}

function monitorinfo()
{
    this._ObjectID = 'monitor-info';
    this._gm = require('_GenericMarshal');

    if (process.platform == 'win32')
    {
        this._user32 = this._gm.CreateNativeProxy('user32.dll');
        this._user32.CreateMethod('EnumDisplayMonitors');
        this._user32.CreateMethod('MonitorFromWindow');
        this._kernel32 = this._gm.CreateNativeProxy('kernel32.dll');
        this._kernel32.CreateMethod('GetLastError');

        try
        {
            this._shcore = this._gm.CreateNativeProxy('SHCore.dll');
            this._shcore.CreateMethod('GetDpiForMonitor');
        }
        catch (xx)
        {
            this._shcore = null;
        }
        

        this.getInfo = function getInfo()
        {
            var info = this;
            return (new promise(function (resolver, rejector) {
                this._monitorinfo = { resolver: resolver, rejector: rejector, self: info, callback: info._gm.GetGenericGlobalCallback(4) };
                this._monitorinfo.callback.info = this._monitorinfo;
                this._monitorinfo.dwData = info._gm.ObjectToPtr(this._monitorinfo);

                this._monitorinfo.callback.results = [];
                this._monitorinfo.callback.on('GlobalCallback', function OnMonitorInfo(hmon, hdc, r, user) {
                    if (this.ObjectToPtr_Verify(this.info, user))
                    {
                        var dpi = 96;
                        var sh = require('monitor-info')._shcore;
                        if (sh != null)
                        {
                            var xdpi = require('_GenericMarshal').CreateVariable(4);
                            var ydpi = require('_GenericMarshal').CreateVariable(4);

                            sh.GetDpiForMonitor(hmon, 0, xdpi, ydpi);
                            dpi = xdpi.toBuffer().readUInt32LE();
                        }

                        var rb = r.Deref(0, 16).toBuffer();
                        this.results.push({ left: rb.readInt32LE(0), top: rb.readInt32LE(4), right: rb.readInt32LE(8), bottom: rb.readInt32LE(12), dpi: dpi });

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
    else if (process.platform == 'linux')
    {
        // First thing we need to do, is determine where the X11 libraries are
        this._check = function _check()
        {
            var ix;
            if(!this.Location_X11LIB)
            {
                var x11info = getLibInfo('libX11');
                for (ix in x11info)
                {
                    if (x11info.length == 1 || x11info[ix].hwcap == "0")
                    {
                        try
                        {
                            Object.defineProperty(this, 'Location_X11LIB', { value: x11info[ix].path });
                            break;
                        }
                        catch (ex)
                        {
                        }
                    }
                }
                try
                {
                    if (process.env['Location_X11LIB']) { Object.defineProperty(this, 'Location_X11LIB', { value: process.env['Location_X11LIB'] }); }
                }
                catch(xx)
                {
                }
            }
            if(!this.Location_X11TST)
            {
                var xtstinfo = getLibInfo('libXtst');
                for (ix in xtstinfo)
                {
                    if (xtstinfo.length == 1 || xtstinfo[ix].hwcap == "0")
                    {
                        try
                        {
                            Object.defineProperty(this, 'Location_X11TST', { value: xtstinfo[ix].path });
                            break;
                        }
                        catch (ex)
                        {
                        }
                    }
                }
                try
                {
                    if (process.env['Location_X11TST']) { Object.defineProperty(this, 'Location_X11TST', { value: process.env['Location_X11TST'] }); }
                }
                catch (xx)
                {
                }

            }
            if(!this.Location_X11EXT)
            {
                var xextinfo = getLibInfo('libXext');
                for (ix in xextinfo)
                {
                    if (xextinfo.length == 1 || xextinfo[ix].hwcap == "0")
                    {
                        try
                        {
                            Object.defineProperty(this, 'Location_X11EXT', { value: xextinfo[ix].path });
                            break;
                        }
                        catch (ex)
                        {
                        }
                    }
                }
                try
                {
                    if (process.env['Location_X11EXT']) { Object.defineProperty(this, 'Location_X11EXT', { value: process.env['Location_X11EXT'] }); }
                }
                catch(xx)
                {
                }

            }
            if(!this.Location_X11FIXES)
            {
                var xfixesinfo = getLibInfo('libXfixes');
                for (ix in xfixesinfo)
                {
                    if (xfixesinfo.length == 1 || xfixesinfo[ix].hwcap == "0")
                    {
                        try
                        {
                            Object.defineProperty(this, 'Location_X11FIXES', { value: xfixesinfo[ix].path });
                            break;
                        }
                        catch (ex)
                        {
                        }
                    }
                }
                try
                {
                    if (process.env['Location_X11FIXES']) { Object.defineProperty(this, 'Location_X11FIXES', { value: process.env['Location_X11FIXES'] }); }
                }
                catch(xx)
                {
                }
            }
            if (!this.Location_X11KB)
            {
                var xkbinfo = getLibInfo('libxkbfile');
                for (ix in xkbinfo)
                {
                    if (xkbinfo.length == 1 || xkbinfo[ix].hwcap == "0")
                    {
                        try
                        {
                            Object.defineProperty(this, 'Location_X11KB', { value: xkbinfo[ix].path });
                            break;
                        }
                        catch (ex)
                        {
                        }
                    }
                }
                try
                {
                    if (process.env['Location_X11KB']) { Object.defineProperty(this, 'Location_X11KB', { value: process.env['Location_X11KB'] }); }
                }
                catch (xx)
                {
                }
            }
        };
    }
    if(process.platform == 'freebsd')
    {
        this._check = function _check()
        {
            var lib;
            if(!this.Location_X11LIB)
            {
                if ((lib = require('lib-finder')('libX11')[0])) { Object.defineProperty(this, 'Location_X11LIB', { value: lib.location }); }
            }
            if(!this.Location_X11TST)
            {
                if ((lib = require('lib-finder')('libXtst')[0])) { Object.defineProperty(this, 'Location_X11TST', { value: lib.location }); }
            }
            if (!this.Location_X11EXT)
            {
                if ((lib = require('lib-finder')('libXext')[0])) { Object.defineProperty(this, 'Location_X11EXT', { value: lib.location }); }
            }
            if (!this.Location_X11FIXES)
            {
                if ((lib = require('lib-finder')('libXfixes')[0])) { Object.defineProperty(this, 'Location_X11FIXES', { value: lib.location }); }
            }
        }
    }

    if(process.platform == 'linux' || process.platform == 'freebsd')
    {
        require('events').EventEmitter.call(this, true).createEvent('kvmSupportDetected');
        this.kvm_x11_serverFound = false;
        this.MOTIF_FLAGS = 
        {
            MWM_FUNC_ALL        : (1 << 0) ,
            MWM_FUNC_RESIZE     : (1 << 1) ,
            MWM_FUNC_MOVE       : (1 << 2) ,
            MWM_FUNC_MINIMIZE   : (1 << 3) ,
            MWM_FUNC_MAXIMIZE   : (1 << 4) ,
            MWM_FUNC_CLOSE      : (1 << 5) 
        };
        this._xtries = 0;
        this._kvmcheck_wayland_user = function _kvmcheck_wayland_user(uid)
        {
            try
            {
                var fs = require('fs');
                if (uid != null && uid > 0)
                {
                    var runtimeDir = '/run/user/' + uid;
                    var waylandDisplay = process.env['WAYLAND_DISPLAY'];

                    if (waylandDisplay && fs.existsSync(runtimeDir + '/' + waylandDisplay)) { return true; }
                    if (fs.existsSync(runtimeDir + '/wayland-0') || fs.existsSync(runtimeDir + '/wayland-1')) { return true; }
                }
            }
            catch (e)
            {
            }
            return false;
        };
        this._kvmcheck_wayland = function _kvmcheck_wayland()
        {
            if (process.platform != 'linux') { return false; }
            try
            {
                var uid = 0;

                try
                {
                    uid = require('user-sessions').consoleUid({ active: true });
                    if (Array.isArray(uid)) { uid = (uid.length > 0 ? parseInt(uid[0]) : 0); }
                }
                catch (z) { }
                if (uid == null || uid <= 0) { try { uid = require('user-sessions').consoleUid(); } catch (zz) { uid = 0; } }

                if (this._kvmcheck_wayland_user(uid)) { return true; }

                // Fall back to the display-manager (greeter) session so the Wayland login screen
                // is detected before any user logs in (e.g. GDM/LightDM Wayland greeter).
                var dmUid = 0;
                try { dmUid = require('user-sessions').gdmUid; } catch (zz) { dmUid = 0; }
                if (dmUid != null && dmUid > 0 && dmUid != uid && this._kvmcheck_wayland_user(dmUid)) { return true; }
            }
            catch (e)
            {
            }
            return false;
        };
        this._kvmcheck = function _kvmcheck()
        {
            var retry = false;
            if (this._kvmcheck_wayland())
            {
                this.kvm_x11_serverFound = true;
                this.emit('kvmSupportDetected', true);
                return;
            }
            if (!(this.Location_X11LIB && this.Location_X11TST && this.Location_X11EXT))
            {
                this._check();
            }
            if (this.Location_X11LIB && this.Location_X11TST && this.Location_X11EXT)
            {
                if (!this._X11)
                {
                    this._X11 = this._gm.CreateNativeProxy(this.Location_X11LIB);
                    this._X11.CreateMethod('XChangeProperty');
                    this._X11.CreateMethod('XChangeWindowAttributes');
                    this._X11.CreateMethod('XCloseDisplay');
                    this._X11.CreateMethod('XConnectionNumber');
                    this._X11.CreateMethod('XConvertSelection');
                    this._X11.CreateMethod('XCreateGC');
                    this._X11.CreateMethod('XCreateWindow');
                    this._X11.CreateMethod('XCreateSimpleWindow');
                    this._X11.CreateMethod('XDefaultColormap');
                    this._X11.CreateMethod('XDefaultScreen');
                    this._X11.CreateMethod('XDestroyWindow');
                    this._X11.CreateMethod('XDrawLine');
                    this._X11.CreateMethod('XDisplayHeight');
                    this._X11.CreateMethod('XDisplayWidth');
                    this._X11.CreateMethod('XFetchName');
                    this._X11.CreateMethod('XFlush');
                    this._X11.CreateMethod('XFree');
                    this._X11.CreateMethod('XCreateGC');
                    this._X11.CreateMethod('XGetAtomName');
                    this._X11.CreateMethod('XGetWindowProperty');
                    this._X11.CreateMethod('XKeysymToKeycode');
                    this._X11.CreateMethod('XInternAtom');
                    this._X11.CreateMethod('XMapWindow');
                    this._X11.CreateMethod({ method: 'XNextEvent', threadDispatch: true });
                    this._X11.CreateMethod({ method: 'XNextEvent', newName: 'XNextEventSync' });
                    this._X11.CreateMethod('XOpenDisplay');
                    this._X11.CreateMethod('XPending');
                    this._X11.CreateMethod('XRootWindow');
                    this._X11.CreateMethod('XSelectInput');
                    this._X11.CreateMethod('XScreenCount');
                    this._X11.CreateMethod('XScreenOfDisplay');
                    this._X11.CreateMethod('XSelectInput');
                    this._X11.CreateMethod('XSendEvent');
                    this._X11.CreateMethod('XSetForeground');
                    this._X11.CreateMethod('XSetFunction');
                    this._X11.CreateMethod('XSetLineAttributes');
                    this._X11.CreateMethod('XSetNormalHints');
                    this._X11.CreateMethod('XSetSelectionOwner');
                    this._X11.CreateMethod('XSetSubwindowMode');
                    this._X11.CreateMethod('XSetWMProtocols');
                    this._X11.CreateMethod('XStoreName');
                    this._X11.CreateMethod('XSync');
                    this._X11.CreateMethod('XBlackPixel');
                    this._X11.CreateMethod('XWhitePixel');
                    this._X11.CreateMethod('Xutf8SetWMProperties');

                    this._X11.CreateMethod('XDisplayKeycodes');
                    this._X11.CreateMethod('XGetKeyboardMapping');
                    this._X11.CreateMethod('XStringToKeysym');
                    this._X11.CreateMethod('XChangeKeyboardMapping');
                }

                var ch = require('child_process').execFile('/bin/sh', ['sh']);
                ch.stderr.on('data', function () { });
                ch.stdout.str = ''; ch.stdout.on('data', function (c) { this.str += c.toString(); });
                if (process.platform == 'freebsd')
                {
                    ch.stdin.write('ps -ax | grep X\nexit\n');
                }
                else
                {
                    ch.stdin.write('ps -e | grep X\nexit\n');
                }
                ch.waitExit();

                if (ch.stdout.str.trim() != '')
                {
                    // X Server found
                    this.kvm_x11_serverFound = true;
                    this.emit('kvmSupportDetected', true);
                }
                else
                {
                    retry = true;
                }
            }
            else
            {
                retry = true;
            }
            if(retry && this._xtries++ < 18)
            {
                this._xtry = setTimeout(function (that) { that._kvmcheck.call(that); }, 10000, this);
            }
        };
        this._kvmcheck();
        Object.defineProperty(this, 'kvm_x11_support', { get: function () { return (this.kvm_x11_serverFound); } });
        this.on('newListener', function (name, handler)
        {
            if (name == 'kvmSupportDetected' && this.kvm_x11_serverFound)
            {
                handler.call(this, true);
            }
        });

        this.isUnity = function isUnity()
        {
            return (process.env['XDG_CURRENT_DESKTOP'] == 'Unity');
        }

        this.unDecorateWindow = function unDecorateWindow(display, window)
        {
            var MwmHints = this._gm.CreateVariable(40);
            var mwmHintsProperty = this._X11.XInternAtom(display, this._gm.CreateVariable('_MOTIF_WM_HINTS'), 0);
            MwmHints.Deref(0, 4).toBuffer().writeUInt32LE(1 << 1);
            this._X11.XChangeProperty(display, window, mwmHintsProperty, mwmHintsProperty, 32, 0, MwmHints, 5);
        }
        this.setAllowedActions = function setAllowedActions(display, window, flags)
        {
            /*
                MWM_HINTS_FUNCTIONS = (1L << 0),
                MWM_HINTS_DECORATIONS =  (1L << 1),

                MWM_FUNC_ALL = (1L << 0),
                MWM_FUNC_RESIZE = (1L << 1),
                MWM_FUNC_MOVE = (1L << 2),
                MWM_FUNC_MINIMIZE = (1L << 3),
                MWM_FUNC_MAXIMIZE = (1L << 4),
                MWM_FUNC_CLOSE = (1L << 5)
            */

            var MwmHints = this._gm.CreateVariable(40);
            var mwmHintsProperty = this._X11.XInternAtom(display, this._gm.CreateVariable('_MOTIF_WM_HINTS'), 0);

            MwmHints.Deref(0, 4).toBuffer().writeUInt32LE(MWM_HINTS_FUNCTIONS);
            MwmHints.Deref(this._gm.PointerSize, 4).toBuffer().writeUInt32LE(flags);

            this._X11.XChangeProperty(display, window, mwmHintsProperty, mwmHintsProperty, 32, PropModeReplace, MwmHints, 5);
        }
        this.setWindowSizeHints = function setWindowSizeHints(display, window, x, y, width, height, minWidth, minHeight, maxWidth, maxHeight)
        {
            var sizeHints = this._gm.CreateVariable(80);
            var spec = PPosition | PSize;
            if (minWidth != null && minHeight != null) { spec |= PMinSize; }
            if (maxWidth != null && maxHeight != null) { spec |= PMaxSize; }

            sizeHints.Deref(0, 4).toBuffer().writeUInt32LE(spec);
            sizeHints.Deref(this._gm.PointerSize, 4).toBuffer().writeUInt32LE(x);
            sizeHints.Deref(this._gm.PointerSize + 4, 4).toBuffer().writeUInt32LE(y);
            sizeHints.Deref(this._gm.PointerSize + 8, 4).toBuffer().writeUInt32LE(width);
            sizeHints.Deref(this._gm.PointerSize + 12, 4).toBuffer().writeUInt32LE(height);
            if (minWidth != null) { sizeHints.Deref(this._gm.PointerSize + 16, 4).toBuffer().writeUInt32LE(minWidth); }
            if (minHeight != null) { sizeHints.Deref(this._gm.PointerSize + 20, 4).toBuffer().writeUInt32LE(minHeight); }
            if (maxWidth != null) { sizeHints.Deref(this._gm.PointerSize + 24, 4).toBuffer().writeUInt32LE(maxWidth); }
            if (maxHeight != null) { sizeHints.Deref(this._gm.PointerSize + 28, 4).toBuffer().writeUInt32LE(maxHeight); }

            this._X11.XSetNormalHints(display, window, sizeHints);
        }
        this.setAlwaysOnTop = function setAlwaysOnTop(display, rootWindow, window)
        {
            var wmNetWmState = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE'), 1);
            var wmStateAbove = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE_ABOVE'), 1);

            var xclient = this._gm.CreateVariable(96);
            xclient.Deref(0, 4).toBuffer().writeUInt32LE(33);                   // ClientMessage type
            xclient.Deref(this._gm.PointerSize == 8 ? 48 : 24, 4).toBuffer().writeUInt32LE(32);   // Format 32
            wmNetWmState.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize == 8 ? 40 : 20, this._gm.PointerSize).toBuffer()); // message_type
            xclient.Deref(this._gm.PointerSize == 8 ? 56 : 28, this._gm.PointerSize).toBuffer().writeUInt32LE(_NET_WM_STATE_ADD);   // data.l[0]
            wmStateAbove.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize == 8 ? 64 : 32, this._gm.PointerSize).toBuffer());  // data.l[1]
            window.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize == 8 ? 32 : 16, this._gm.PointerSize).toBuffer());       // window
            this._X11.XSendEvent(display, rootWindow, 0, SubstructureRedirectMask | SubstructureNotifyMask, xclient);
        }
        this.hideWindowIcon = function hideWindowIcon(display, rootWindow, window)
        {
            var wmNetWmState = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE'), 1);
            var wmStateSkip = this._X11.XInternAtom(display, this._gm.CreateVariable('_NET_WM_STATE_SKIP_TASKBAR'), 1);

            var xclient = this._gm.CreateVariable(96);
            xclient.Deref(0, 4).toBuffer().writeUInt32LE(33);                               // ClientMessage type
            xclient.Deref(this._gm.PointerSize==8?48:24, 4).toBuffer().writeUInt32LE(32);   // Format 32
            wmNetWmState.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize==8?40:20, this._gm.PointerSize).toBuffer()); // message_type
            xclient.Deref(this._gm.PointerSize==8?56:28, this._gm.PointerSize).toBuffer().writeUInt32LE(_NET_WM_STATE_ADD);   // data.l[0]
            wmStateSkip.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize==8?64:32, this._gm.PointerSize).toBuffer());  // data.l[1]

            window.pointerBuffer().copy(xclient.Deref(this._gm.PointerSize==8?32:16, this._gm.PointerSize).toBuffer());       // window
            this._X11.XSendEvent(display, rootWindow, 0, SubstructureRedirectMask | SubstructureNotifyMask, xclient);
        }

        this.getInfo = function getInfo()
        {
            var info = this;
            var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
            ret.parent = this;

            if (!process.env.XAUTHORITY || !process.env.DISPLAY)
            {
                var xinfo = this.getXInfo(require('user-sessions').getUid(require('user-sessions').whoami()));
                process.setenv('XAUTHORITY', xinfo.xauthority);
                process.setenv('DISPLAY', xinfo.display);
            }

            var display = info._X11.XOpenDisplay(info._gm.CreateVariable(process.env.DISPLAY));
            if (display.Val == 0)
            {
                require('fs').writeFileSync('/var/tmp/agentSlave', 'XOpenDisplay Failed', { flags: 'a' });
                ret._rej('XOpenDisplay Failed');
                return (ret);
            }

            var screenCount = info._X11.XScreenCount(display).Val;
            var ifo = [];
            for(var i=0;i<screenCount;++i)
            {
                var screen = info._X11.XScreenOfDisplay(display, i);
                ifo.push({ left: 0, top: 0, right: info._X11.XDisplayWidth(display, i).Val, bottom: info._X11.XDisplayHeight(display, i).Val, screen: screen, screenId: i, display: display });
            }
            if (i > 0)
            {
                addWorkspaceHandler(display, info._X11);
            }
            ret._res(ifo);

            return (ret);
        }
        function xinfo_xdm(info, uid)
        {
            if (process.platform != 'linux') { return(info); }
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("ps -e -o uid -o cmd | grep X | grep " + uid + " | tr '\\n' '`' | awk '{ xl=split($2,x,\"/\"); print x[xl]; }'\nexit\n");
            child.waitExit();
            if(child.stdout.str.trim() != '')
            {
                if (info == null) { info = {}; }
                info.xdm = child.stdout.str.trim().toLowerCase();
            }
            return (info);
        }
        this.getXInfo = function getXInfo(consoleuid)
        {
            var ret = null;
            var uname = require('user-sessions').getUsername(consoleuid);
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("ps " + (process.platform == 'freebsd' ? "-ax " : "") + "-e -o uid -o tty -o command | grep X | ");
            child.stdin.write("awk '{ ");
            child.stdin.write('        display="";');
            child.stdin.write('        if($4~/^:/)');
            child.stdin.write('        {');
            child.stdin.write('           display=$4;');
            child.stdin.write('        }');
            child.stdin.write('        match($0, /-auth .+/);');
            child.stdin.write('       split(substr($0,RSTART+6,RLENGTH-6), _authtok, " ");');
            child.stdin.write('        _auth = _authtok[1];');
            //child.stdin.write('        _auth = substr($0,RSTART+6,RLENGTH-6);');
            child.stdin.write('        if($1=="' + consoleuid + '" && _auth!="")');
            child.stdin.write("        {");
            child.stdin.write("           printf \"%s,%s,%s,%s\",$1,$2,_auth,display;");
            child.stdin.write("        }");
            child.stdin.write("     }'\nexit\n");

            child.waitExit();
            var tokens = child.stdout.str.trim().split(',');
            console.info1(JSON.stringify(tokens));
            if (tokens.length == 4)
            {
                ret = { tty: tokens[1], xauthority: tokens[2], display: tokens[3], exportEnv: exportEnv };
                console.info1('ret => ' + JSON.stringify(ret));
            }

            if (ret == null)
            {
                // This Linux Distro does not spawn an XServer instance in the user session, that specifies the XAUTHORITY.
                if (process.platform == 'linux' && require('user-sessions').hasLoginCtl)
                {
                    child = require('child_process').execFile('/bin/sh', ['sh']);
                    child.stdout.str = ''; child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                    child.stderr.str = ''; child.stderr.on('data', function (chunk) { this.str += chunk.toString(); });

                    child.stdin.write("loginctl list-sessions | tr '\\n' '`' | awk '{");
                    child.stdin.write('printf "[";');
                    child.stdin.write('del="";');
                    child.stdin.write('n=split($0, lines, "`");');
                    child.stdin.write('for(i=1;i<n;++i)');
                    child.stdin.write('{');
                    child.stdin.write('   split(lines[i], tok, " ");');
                    child.stdin.write('   if((tok[2]+0)==' + consoleuid + ')');
                    child.stdin.write('   {');
                    child.stdin.write('      if(tok[4]=="") { continue; }');
                    child.stdin.write('      printf "%s{\\"Username\\": \\"%s\\", \\"SessionId\\": \\"%s\\", \\"State\\": \\"Online\\", \\"uid\\": \\"%s\\", \\"tty\\": \\"%s\\"}", del, tok[3], tok[1], tok[2], tok[5];');
                    child.stdin.write('      del=",";');
                    child.stdin.write('   }');
                    child.stdin.write('}');
                    child.stdin.write('printf "]";');
                    child.stdin.write("}'\nexit\n");
                    child.waitExit();

                    console.info1('loginctl => ' + child.stdout.str);
                    var info1 = JSON.parse(child.stdout.str);
                    var sids = [];
                    var ttys = [];
                    var i;
                    for (i = 0; i < info1.length; ++i)
                    {
                        sids.push(info1[i].SessionId);
                        if (info1[i].tty != '') { ttys.push(info1[i].tty); }
                    }
                    child = require('child_process').execFile('/bin/sh', ['sh']);
                    child.stdout.str = ''; child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                    child.stderr.str = ''; child.stderr.on('data', function (chunk) { this.str += chunk.toString(); });
                    child.stdin.write("loginctl show-session -p State -p Display " + sids.join(' ') + " | tr '\\n' '`' | awk '{");
                    child.stdin.write('   len=split($0,tok,"``");');
                    child.stdin.write('   for(n=1;n<=len;++n)');
                    child.stdin.write('   {');
                    child.stdin.write('      len2=split(tok[n],val,"`");');
                    child.stdin.write('      display="";');
                    child.stdin.write('      active="";');
                    child.stdin.write('      for(i=1;i<=len2;++i)');
                    child.stdin.write('      {');
                    child.stdin.write('         if(val[i] ~ /^Display=/)');
                    child.stdin.write('         {');
                    child.stdin.write('             gsub(/^Display=/,"",val[i]);');
                    child.stdin.write('             display=val[i];');
                    child.stdin.write('         }');
                    child.stdin.write('         if(val[i] ~ /^State=/)');
                    child.stdin.write('         {');
                    child.stdin.write('            gsub(/^State=/,"",val[i]);');
                    child.stdin.write('            active=val[i];');
                    child.stdin.write('         }');
                    child.stdin.write('      }');
                    child.stdin.write('      if(active=="active") { print display; break; }');
                    child.stdin.write('   }');
                    child.stdin.write("}'\nexit\n");
                    child.waitExit();

                    ret = { tty: '?', xauthority: (require('user-sessions').getHomeFolder(consoleuid) + '/.Xauthority').split('//').join('/'), display: child.stdout.str.trim(), exportEnv: exportEnv };
                    if (!require('fs').existsSync(ret.xauthority))
                    {
                        console.info1(ret.xauthority + ' => DOES NOT EXIST');
                        child = require('child_process').execFile('/bin/sh', ['sh']);
                        child.stdout.str = ''; child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                        child.stderr.str = ''; child.stderr.on('data', function (chunk) { this.str += chunk.toString(); });
                        child.stdin.write('loginctl session-status ' + sids.join(' ') + " | tr '\\n' '`' | awk '{");
                        child.stdin.write('len=split($0,X,"`");');
                        child.stdin.write('Z="";');
                        child.stdin.write('printf "[";');
                        child.stdin.write('for(i=1;i<=len;++i)');
                        child.stdin.write('{');
                        child.stdin.write('   if(X[i]~/^.+├─/)');
                        child.stdin.write('   {');
                        child.stdin.write('      gsub(/^.+├─/,"",X[i]);');
                        child.stdin.write('      split(X[i],VAL," ");');
                        child.stdin.write('      printf "%s%s",Z,VAL[1];');
                        child.stdin.write('      Z=",";');
                        child.stdin.write('   }');
                        child.stdin.write('}');
                        child.stdin.write('printf "]";');
                        child.stdin.write("}'\nexit\n");
                        child.waitExit();

                        var pids = null;
                        try
                        {
                            pids = JSON.parse(child.stdout.str);
                        }
                        catch(z)
                        {
                        }

                        console.info1('Detected PIDS => ' + JSON.stringify(pids));

                        if (pids != null)
                        {
                            var e, i;
                            for (i in pids)
                            {
                                e = require('user-sessions').getEnvFromPid(pids[i]);
                                if (e.XAUTHORITY)
                                {
                                    ret.xauthority = e.XAUTHORITY;
                                    console.info1('  => Setting Xauthority: ' + e.XAUTHORITY + ' from PID: ' + pids[i]);
                                    break;
                                }
                            }
                        }

                        // Still no Xauthority found, so lets check the system location for lightdm
                        if(require('fs').existsSync('/run/lightdm/' + uname + '/xauthority'))
                        {
                            ret.xauthority = '/run/lightdm/' + uname + '/xauthority';
                        }
                        if(consoleuid == require('user-sessions').gdmUid && require('fs').existsSync('/run/sddm'))
                        {
                            var info;
                            var files = require('fs').readdirSync('/run/sddm');
                            var gdmuid = require('user-sessions').gdmUid;
                            for(var i=0;i<files.length;++i)
                            {
                                info = require('fs').statSync('/run/sddm/' + files[i]);
                                if(info.uid == gdmuid)
                                {
                                    ret.xauthority = '/run/sddm/' + files[i];
                                    break;
                                }
                            }
                        }
                    }
                    if (ret.display == '' && ttys.length > 0)
                    {
                        // We need to find $DISPLAY by looking at all the processes running on the same tty as the XServer instance for this user session
                        while (ttys.length > 0)
                        {
                            var tty = ttys.pop();
                            child = require('child_process').execFile('/bin/sh', ['sh']);
                            child.stdout.str = '';
                            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                            child.stdin.write("ps -e -o tty -o pid -o uid | grep " + tty + " | grep " + consoleuid + " | awk '{ print $2 }' \nexit\n");
                            child.waitExit();

                            var lines = child.stdout.str.split('\n');
                            var ps, psx, v, vs = 0;
                            for (var x in lines)
                            {
                                if (lines[x].trim().length > 0)
                                {
                                    try
                                    {
                                        ps = require('fs').readFileSync('/proc/' + lines[x].trim() + '/environ');
                                    }
                                    catch (pse)
                                    {
                                        continue;
                                    }
                                    vs = 0;
                                    for (psx = 0; psx < ps.length; ++psx)
                                    {
                                        if (ps[psx] == 0)
                                        {
                                            v = ps.slice(vs, psx).toString().split('=');
                                            if (v[0] == 'DISPLAY')
                                            {
                                                ret.display = v[1];
                                                ret.tty = tty;
                                                return (xinfo_xdm(ret, consoleuid));
                                            }
                                            vs = psx + 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    return (xinfo_xdm(ret, consoleuid));
                }


                // So we're going to brute force it, by enumerating all processes owned by this user, and inspect the environment variables
                var child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stdout.str = '';
                child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                child.stdin.write("ps " + (process.platform=='freebsd'?"-ax ":"") + "-e -o pid -o user | grep \" " + uname + "$\" | awk '{ print $1 }'\nexit\n");
                child.waitExit();

                var lines = child.stdout.str.split('\n');
                for(var n in lines)
                {
                    var ln = lines[n].trim();
                    if(ln.length>0)
                    {
                        var e = require('user-sessions').getEnvFromPid(ln);
                        if(e.XAUTHORITY && e.DISPLAY)
                        {
                            ret = { tty: '?', xauthority: e.XAUTHORITY, display: e.DISPLAY, exportEnv: exportEnv };
                            return (xinfo_xdm(ret, consoleuid));
                        }
                    }
                }
                if(ret == null)
                {
                    // We couldn't find XAUTHORITY and DISPLAY, so as a last ditch effort, lets just look for DISPLAY
                    for (var n in lines)
                    {
                        var ln = lines[n].trim();
                        if (ln.length > 0)
                        {
                            var e = require('user-sessions').getEnvFromPid(ln);
                            if (e.DISPLAY)
                            {
                                ret = { tty: '?', display: e.DISPLAY, exportEnv: exportEnv };
                                return (xinfo_xdm(ret, consoleuid));
                            }
                        }
                    }
                }
            }
            else if(ret.display == null || ret.display === '')
            {
                // We need to find $DISPLAY by looking at all the processes running on the same tty as the XServer instance for this user session
                child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stdout.str = '';
                child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                child.stdin.write("ps -e -o tty -o pid -o user:9999 | grep " + ret.tty + " | grep " + uname + " | awk '{ print $2 }' \nexit\n");
                child.waitExit();

                var lines = child.stdout.str.split('\n');
                var ps, psx, v, vs = 0;
                for(var x in lines)
                {
                    if(lines[x].trim().length>0)
                    {
                        try
                        {
                            ps = require('fs').readFileSync('/proc/' + lines[x].trim() + '/environ');
                        }
                        catch(pse)
                        {
                            continue;
                        }
                        vs = 0;
                        for(psx=0;psx<ps.length;++psx)
                        {
                            if (ps[psx] == 0)
                            {
                                if (psx == 0) { continue; }
                                v = ps.slice(vs, psx).toString().split('=');
                                if (v[0] == 'DISPLAY')
                                {
                                    ret.display = v[1];
                                    return (xinfo_xdm(ret, consoleuid));
                                }
                                vs = psx + 1;
                            }
                        }
                    }
                }
            }
            return (xinfo_xdm(ret, consoleuid));
        };
    }
}

function exportEnv()
{
    var r =
        {
            XAUTHORITY: this.xauthority?this.xauthority:"", DISPLAY: this.display,
            Location_X11LIB: require('monitor-info').Location_X11LIB,
            Location_X11TST: require('monitor-info').Location_X11TST,
            Location_X11EXT: require('monitor-info').Location_X11EXT,
            Location_X11FIXES: require('monitor-info').Location_X11FIXES
        };
    return (r);
}

function workspaceSetup(oldV)
{
    var GM = require('_GenericMarshal');
    Object.defineProperty(oldV, "_setup", { value: true });

    var v = oldV._X11.XOpenDisplay(GM.CreateVariable(process.env.DISPLAY));
    v._X11 = oldV._X11;
    v.parent = oldV;
    v.on('~', function ()
    {
        v._X11.XCloseDisplay(v);
    });
    
    Object.defineProperty(oldV, "_v2", { value: v });
    Object.defineProperty(v, "_ROOTWIN", { value: v._X11.XRootWindow(v, 0) });
    Object.defineProperty(v, "_ACTIVE_DESKTOP", { value: v._X11.XInternAtom(v, GM.CreateVariable('_NET_CURRENT_DESKTOP'), 0) });

    var mask = GM.CreateVariable(GM.PointerSize == 8 ? 112 : 60);
    mask.Deref(GM.PointerSize == 8 ? 72 : 40, 4).toBuffer().writeUInt32LE(PropertyChangeMask);

    v._X11.XChangeWindowAttributes(v, v._ROOTWIN, CWEventMask, mask);
    v._X11.XSync(v, 0);

    v._DescriptorEvent = require('DescriptorEvents').addDescriptor(v._X11.XConnectionNumber(v).Val, { readset: true });
    v._DescriptorEvent._display = v;
    v._DescriptorEvent.on('readset', function (fd)
    {
        var XE = require('_GenericMarshal').CreateVariable(1024);
        while (this._display._X11.XPending(this._display).Val)
        {
            this._display._X11.XNextEventSync(this._display, XE);
            switch (XE.Deref(0, 4).toBuffer().readUInt32LE())
            {
                case PropertyNotify:
                    if (XE.Deref(require('_GenericMarshal').PointerSize == 8 ? 40 : 20, 4).toBuffer().readUInt32LE() == this._display._ACTIVE_DESKTOP.Val)
                    {
                        this._display.parent.emit('workspaceChanged', this._display.parent.getCurrentWorkspace());
                    }
                    break;
                default:
                    break;
            }
        }
    });
}

function addWorkspaceHandler(v,X11)
{
    if (!v._X11) { Object.defineProperty(v, "_X11", { value: X11 }); }
    require('events').EventEmitter.call(v, true)
        .createEvent('workspaceChanged');
    v.on('newListener', function (name, handler)
    {
        if (name != 'workspaceChanged' || this._setup) { return; }
        workspaceSetup(v);
    });
    v.getCurrentWorkspace = function getCurrentWorkspace()
    {
        if (!this._setup) { workspaceSetup(this); }
        var GM = require('_GenericMarshal');

        var id = GM.CreatePointer();
        var bits = GM.CreatePointer();
        var sz = GM.CreatePointer();
        var tail = GM.CreatePointer();
        var result = GM.CreatePointer();

        this._X11.XGetWindowProperty(this._v2, this._v2._ROOTWIN, this._v2._ACTIVE_DESKTOP, 0, 64, 0, AnyPropertyType, id, bits, sz, tail, result);
        if (sz.Deref().Val > 0)
        {
            return (result.Deref().Deref(0, 4).toBuffer().readUInt32LE());
        }
        else
        {
            throw ('Error fetching current workspace');
        }
    }
}

if (process.platform != 'darwin')
{
    module.exports = new monitorinfo();
}

if (process.platform == 'linux' || process.platform == 'freebsd')
{
    module.exports.getLibInfo = getLibInfo;
}
