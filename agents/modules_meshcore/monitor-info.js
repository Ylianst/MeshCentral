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
    var p = require('lib-finderV2').findLibrary(libname);
    return (p ? [{ path: p }] : []);
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
    else if ((process.platform == 'linux') || (process.platform == 'freebsd'))
    {
        // First thing we need to do, is determine where the X11 libraries are, lib-finderV2 asks the loader for the one this agent can load
        this._check = function _check()
        {
            var names = { Location_X11LIB: 'libX11', Location_X11TST: 'libXtst', Location_X11EXT: 'libXext', Location_X11FIXES: 'libXfixes', Location_X11KB: 'libxkbfile' };
            for (var prop in names)
            {
                if (this[prop]) { continue; }
                var path = process.env[prop];
                // Not the agent's embedded lib-finder, whose find() calls back into monitor-info while this constructor runs
                if (!path) { path = require('lib-finderV2').findLibrary(names[prop]); }
                if (path) { try { Object.defineProperty(this, prop, { value: path }); } catch (ex) { } }
            }
        };
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

                // seat0's active session from logind, consoleUid() only without it, on systemd 257 it picks a logged-out user's manager session
                try { var seat = require('seat-info').active(); if (seat != null) { uid = seat.uid; } } catch (z) { uid = 0; }
                if (!(uid > 0))
                {
                    try
                    {
                        uid = require('user-sessions').consoleUid({ active: true });
                        if (Array.isArray(uid)) { uid = (uid.length > 0 ? parseInt(uid[0]) : 0); }
                    }
                    catch (z) { }
                    if (uid == null || uid <= 0) { try { uid = require('user-sessions').consoleUid(); } catch (zz) { uid = 0; } }
                }

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
            // Any throw is a retry, a lookup that fails while the core starts costs one 10 s try
            var found = false;
            try
            {
                found = this._kvmcheck_wayland();
                if (!found)
                {
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
                        found = xServerRunning();
                    }
                }
            }
            catch (e) { }
            if (found)
            {
                this.kvm_x11_serverFound = true;
                this.emit('kvmSupportDetected', true);
            }
            else if (this._xtries++ < 18)
            {
                this._xtry = setTimeout(function (that) { that._kvmcheck.call(that); }, 10000, this);
            }
        };
        this._kvmcheck();
        // A login or logout runs the 18 tries again, so a desktop that starts later still gets the Desktop tab.
        // With logind only while someone is at seat0, 'changed' also fires for SSH logins. Without logind every change counts.
        var self = this;
        var seatActive = function () { try { var si = require('seat-info'); return (!si.hasLogind() || (si.active() != null)); } catch (e) { return (true); } };
        try { require('user-sessions').on('changed', function () { if (!self.kvm_x11_serverFound && seatActive()) { self._xtries = 0; if (self._xtry) { try { clearTimeout(self._xtry); } catch (e) { } self._xtry = null; } self._kvmcheck(); } }); } catch (e) { }
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
                if (xinfo == null || !xinfo.display) { ret._rej('No X display found'); return (ret); }
                if (xinfo.xauthority) { process.setenv('XAUTHORITY', xinfo.xauthority); }
                process.setenv('DISPLAY', xinfo.display);
            }

            var display = info._X11.XOpenDisplay(info._gm.CreateVariable(process.env.DISPLAY));
            if (display.Val == 0)
            {
                ret._rej('XOpenDisplay Failed');
                return (ret);
            }
            // Closed when the last holder of the display is gone, like workspaceSetup() does. Xorg takes no more than 256 clients
            try { display._X11 = info._X11; display.on('~', function () { display._X11.XCloseDisplay(display); }); } catch (e) { }

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
        // The result of every lookup, xauthority is left out when none is known
        function xinfo(uid, display, xauthority, tty) { return ({ tty: tty || '?', xauthority: xauthority, display: display, uid: uid, exportEnv: exportEnv }); }
        // This user's X server when it names its key file: rootless Xorg, or Xwayland under mutter and KWin. null otherwise
        function xinfoFromXServer(procs, xs, uid)
        {
            if ((xs == null) || (xs.auth == '')) { return (null); }
            var ret = xinfo(uid, xs.display, xs.auth), v;
            if ((ret.display == '') && ((v = procEnvValues(procs, ['DISPLAY'])) != null)) { ret.display = v.DISPLAY; }
            return (ret);
        }
        // Both values from one of the user's processes, else DISPLAY alone, null without one
        function xinfoFromEnv(procs, uid)
        {
            var v = procEnvValues(procs, ['XAUTHORITY', 'DISPLAY']);
            if (v != null) { return (xinfo(uid, v.DISPLAY, v.XAUTHORITY)); }
            if ((v = procEnvValues(procs, ['DISPLAY'])) != null) { return (xinfo(uid, v.DISPLAY)); }
            return (null);
        }
        // Xwayland's key file in the user's runtime folder, mutter's .mutter-Xwaylandauth.* or KWin's xauth_*, null without one
        function xinfo_runtimeAuth(uid)
        {
            try
            {
                var dir = '/run/user/' + uid, files = require('fs').readdirSync(dir);
                for (var i = 0; i < files.length; ++i)
                {
                    if ((files[i].indexOf('.mutter-Xwaylandauth.') == 0) || (files[i].indexOf('xauth_') == 0)) { return (dir + '/' + files[i]); }
                }
            }
            catch (e) { }
            return (null);
        }

        // The agent's Buffer.toString() stops at the first NUL, so a NUL-separated cmdline or environ is split by byte before it is decoded
        function nulSplit(b)
        {
            var ret = [], start = 0;
            for (var i = 0; (b != null) && (i < b.length); ++i) { if (b[i] == 0) { if (i > start) { ret.push(b.slice(start, i).toString()); } start = i + 1; } }
            if ((b != null) && (start < b.length)) { ret.push(b.slice(start).toString()); }
            return (ret);
        }

        // The processes of a uid from /proc, each with its argv and a lazy env(). The real uid is read from status, because /proc/<pid> is owned by root for a process that is not dumpable.
        // The agent itself is left out, its environment carries the DISPLAY and XAUTHORITY getInfo() set for an earlier session.
        function procList(uid)
        {
            var fs = require('fs'), ret = [], pids;
            try { pids = fs.readdirSync('/proc'); } catch (e) { return (ret); }
            for (var i = 0; i < pids.length; ++i)
            {
                if (!/^[0-9]+$/.test(pids[i]) || (parseInt(pids[i]) == process.pid)) { continue; }
                try
                {
                    var m = /^Uid:\s+([0-9]+)/m.exec(bufStr(fs.readFileSync('/proc/' + pids[i] + '/status')));
                    if ((m == null) || (parseInt(m[1]) != uid)) { continue; }
                    var argv = nulSplit(fs.readFileSync('/proc/' + pids[i] + '/cmdline'));
                    ret.push({ pid: parseInt(pids[i]), argv: argv, env: procEnv });
                }
                catch (e) { }
            }
            return (ret);
        }
        function procEnv()
        {
            if (this._env == null)
            {
                this._env = {};
                try
                {
                    var parts = nulSplit(require('fs').readFileSync('/proc/' + this.pid + '/environ'));
                    for (var i = 0; i < parts.length; ++i) { var k = parts[i].indexOf('='); if (k > 0) { this._env[parts[i].substring(0, k)] = parts[i].substring(k + 1); } }
                }
                catch (e) { }
            }
            return (this._env);
        }
        // The first process that has every name set, as { name: value }, null when none has
        function procEnvValues(procs, names)
        {
            for (var i = 0; i < procs.length; ++i)
            {
                var env = procs[i].env(), ret = {}, j;
                for (j = 0; j < names.length; ++j) { if (!env[names[j]]) { break; } ret[names[j]] = env[names[j]]; }
                if (j == names.length) { return (ret); }
            }
            return (null);
        }

        // logind's sessions of a uid from its state files, as the KEY=VALUE pairs it writes (UID, SEAT, CLASS, TTY, DISPLAY, STATE, LEADER), the active one first.
        // Only sessions on a seat and not a manager session, like the loginctl list this replaces. The files say "private data", so a missing key counts as no session
        function logindSessions(uid)
        {
            var fs = require('fs'), ret = [], files;
            try { files = fs.readdirSync('/run/systemd/sessions'); } catch (e) { return (ret); }
            for (var i = 0; i < files.length; ++i)
            {
                if (/\.ref$/.test(files[i])) { continue; }
                var s = { id: files[i] }, lines;
                try { lines = bufStr(fs.readFileSync('/run/systemd/sessions/' + files[i])).split('\n'); } catch (e) { continue; }
                for (var j = 0; j < lines.length; ++j) { var k = lines[j].indexOf('='); if ((k > 0) && (lines[j].charAt(0) != '#')) { s[lines[j].substring(0, k)] = lines[j].substring(k + 1).trim(); } }
                if ((parseInt(s.UID) != uid) || !s.SEAT || (s.CLASS == 'manager') || (s.STATE == 'closing')) { continue; }     // A closing session's compositor is already gone
                ret.push(s);
            }
            ret.sort(function (a, b) { return ((b.STATE == 'active') - (a.STATE == 'active')); });
            return (ret);
        }

        // An X server of any user (X, Xorg, Xwayland, Xvfb), from /proc so no shell and no waitExit() while the core starts.
        // FreeBSD has no /proc and keeps the shell, a throw there is a retry in _kvmcheck()
        function xServerRunning()
        {
            if (process.platform == 'freebsd')
            {
                var ch = require('child_process').execFile('/bin/sh', ['sh']);
                ch.stderr.on('data', function () { });
                ch.stdout.str = ''; ch.stdout.on('data', function (c) { this.str += c.toString(); });
                ch.stdin.write('ps -ax | grep X\nexit\n');
                ch.waitExit();
                return (ch.stdout.str.trim() != '');
            }
            var fs = require('fs'), pids;
            try { pids = fs.readdirSync('/proc'); } catch (e) { return (false); }
            for (var i = 0; i < pids.length; ++i)
            {
                if (!/^[0-9]+$/.test(pids[i])) { continue; }
                try { if (/X/.test(bufStr(fs.readFileSync('/proc/' + pids[i] + '/comm')))) { return (true); } } catch (e) { }
            }
            return (false);
        }

        // This user's X server (X, Xorg, Xwayland) with its ':N' and '-auth <file>' arguments, the one with -auth when there are several, null without one
        function xServerOf(procs)
        {
            var ret = null;
            for (var i = 0; i < procs.length; ++i)
            {
                var argv = procs[i].argv;
                if ((argv.length == 0) || !/^X/.test(argv[0].split('/').pop())) { continue; }
                var xs = { pid: procs[i].pid, display: '', auth: '' };
                for (var j = 1; j < argv.length; ++j)
                {
                    if (/^:[0-9]/.test(argv[j])) { xs.display = argv[j]; }
                    else if ((argv[j] == '-auth') && (j + 1 < argv.length)) { xs.auth = argv[++j]; }
                }
                if (xs.auth != '') { return (xs); }
                if (ret == null) { ret = xs; }
            }
            return (ret);
        }

        // The display of the X11 socket this user owns in /tmp/.X11-unix. mutter and KWin bind it themselves, so it is there before an on-demand Xwayland runs
        function x11SocketOf(uid)
        {
            var fs = require('fs'), files;
            try { files = fs.readdirSync('/tmp/.X11-unix'); } catch (e) { return (null); }
            for (var i = 0; i < files.length; ++i)
            {
                var m = /^X([0-9]+)$/.exec(files[i]);
                if (m == null) { continue; }
                try { if (fs.statSync('/tmp/.X11-unix/' + files[i]).uid == uid) { return (':' + m[1]); } } catch (e) { }
            }
            return (null);
        }

        // ':N' is stale when the pid in /tmp/.XN-lock is dead, a logout leaves the socket and the lock behind. Xorg, mutter and KWin write the lock, a display without one counts as live
        function displayAlive(display)
        {
            var fs = require('fs'), m = /^:([0-9]+)/.exec(display || '');
            if (m == null) { return (false); }
            try { var pid = parseInt(bufStr(fs.readFileSync('/tmp/.X' + m[1] + '-lock')).trim()); return (isNaN(pid) || fs.existsSync('/proc/' + pid)); } catch (e) { return (true); }
        }

        // Linux, from /proc and logind's state files, so no process runs and nothing can hang
        function xinfo_linux(consoleuid)
        {
            var fs = require('fs'), procs = procList(consoleuid), ret = xinfoFromXServer(procs, xServerOf(procs), consoleuid), v;
            if (ret != null) { return (ret); }

            var sessions = logindSessions(consoleuid);
            if (sessions.length > 0)
            {
                // The session's display, logind names none for a Wayland session, then the X11 socket the compositor owns
                var pw = passwdEntry(consoleuid);
                ret = xinfo(consoleuid, '', ((pw.home || '') + '/.Xauthority').split('//').join('/'), sessions[0].TTY);
                for (var i = 0; i < sessions.length; ++i) { if (sessions[i].DISPLAY) { ret.display = sessions[i].DISPLAY; break; } }
                if ((ret.display == '') && ((v = x11SocketOf(consoleuid)) != null)) { ret.display = v; }
                // The key file in the runtime folder first, on-demand Xwayland has no key in ~/.Xauthority ("Can't open display: :0", GNOME 50)
                var wlAuth = xinfo_runtimeAuth(consoleuid);
                if (wlAuth != null) { ret.xauthority = wlAuth; }
                if (!fs.existsSync(ret.xauthority))
                {
                    // XAUTHORITY from the user's processes, then the system locations of lightdm and sddm
                    if ((v = procEnvValues(procs, ['XAUTHORITY'])) != null) { ret.xauthority = v.XAUTHORITY; }
                    if ((pw.name != null) && fs.existsSync('/run/lightdm/' + pw.name + '/xauthority')) { ret.xauthority = '/run/lightdm/' + pw.name + '/xauthority'; }
                    if ((consoleuid == require('user-sessions').gdmUid) && fs.existsSync('/run/sddm'))
                    {
                        var files = fs.readdirSync('/run/sddm');
                        for (var j = 0; j < files.length; ++j)
                        {
                            try { if (fs.statSync('/run/sddm/' + files[j]).uid == consoleuid) { ret.xauthority = '/run/sddm/' + files[j]; break; } } catch (e) { }
                        }
                    }
                }
                if ((ret.display == '') && ((v = procEnvValues(procs, ['DISPLAY'])) != null)) { ret.display = v.DISPLAY; }
                if (!displayAlive(ret.display)) { ret.display = ''; }
                return (ret);
            }

            // No X server and no session, the environment of the user's processes is all that is left
            ret = xinfoFromEnv(procs, consoleuid);
            return (((ret != null) && !displayAlive(ret.display)) ? null : ret);
        }

        // FreeBSD, from sysctl kern.proc.* through libc, so no process runs and nothing can hang. null where libc has no sysctlbyname (OpenBSD)
        var bsdLibc = null;
        function bsdSysctl(name)
        {
            var gm = require('_GenericMarshal');
            if (bsdLibc == null) { bsdLibc = gm.CreateNativeProxy('libc.so.7'); bsdLibc.CreateMethod('sysctlbyname'); }
            // One call for the size, one for the data, with room for what starts in between
            var len = gm.CreateVariable(8);
            if (bsdLibc.sysctlbyname(gm.CreateVariable(name), 0, len, 0, 0).Val != 0) { return (null); }
            var size = len.Deref(0, 4).toBuffer().readUInt32LE(0) + 16384, buf = gm.CreateVariable(size);
            len.Deref(0, 4).toBuffer().writeUInt32LE(size, 0);
            if (bsdLibc.sysctlbyname(gm.CreateVariable(name), buf, len, 0, 0).Val != 0) { return (null); }
            return (buf.Deref(0, len.Deref(0, 4).toBuffer().readUInt32LE(0)).toBuffer());
        }
        function bsdProcList(uid)
        {
            var all, ret = [];
            try { all = bsdSysctl('kern.proc.proc'); } catch (e) { return (null); }
            if (all == null) { return (null); }
            // struct kinfo_proc: ki_structsize first, ki_pid after two ints and eight pointers, ki_uid 96 bytes later (six pids, two shorts, ki_tdev_freebsd11, four sigsets)
            var ps = require('_GenericMarshal').PointerSize, pidOff = 8 + 8 * ps, uidOff = pidOff + 96;
            for (var off = 0; off + uidOff + 4 <= all.length; )
            {
                var size = all.readInt32LE(off), pid = all.readInt32LE(off + pidOff);
                if (size <= 0) { break; }
                if ((all.readUInt32LE(off + uidOff) == uid) && (pid != process.pid))
                {
                    var args = bsdSysctl('kern.proc.args.' + pid);
                    if (args != null) { ret.push({ pid: pid, argv: nulSplit(args), env: bsdProcEnv }); }
                }
                off += size;
            }
            return (ret);
        }
        function bsdProcEnv()
        {
            if (this._env == null)
            {
                this._env = {};
                var e = nulSplit(bsdSysctl('kern.proc.env.' + this.pid));
                for (var i = 0; i < e.length; ++i) { var k = e[i].indexOf('='); if (k > 0) { this._env[e[i].substring(0, k)] = e[i].substring(k + 1); } }
            }
            return (this._env);
        }

        // FreeBSD: the user's X server with its key file, else both values from one of the user's processes, else DISPLAY alone. No logind and no /proc here, so nothing checks a stale display
        function xinfo_ps(consoleuid)
        {
            var procs = bsdProcList(consoleuid);
            if (procs == null) { return (xinfo_ps_shell(consoleuid)); }
            var ret = xinfoFromXServer(procs, xServerOf(procs), consoleuid);
            return ((ret != null) ? ret : xinfoFromEnv(procs, consoleuid));
        }

        // The shell version, OpenBSD only now: no sysctlbyname there. These waitExit() calls have no timeout
        function xinfo_ps_shell(consoleuid)
        {
            var ret = null;
            var uname = passwdEntry(consoleuid).name;
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("ps -ax -e -o uid -o tty -o command | grep X | ");
            child.stdin.write("awk '{ ");
            child.stdin.write('        display="";');
            child.stdin.write('        if($4~/^:/)');
            child.stdin.write('        {');
            child.stdin.write('           display=$4;');
            child.stdin.write('        }');
            child.stdin.write('        match($0, /-auth .+/);');
            child.stdin.write('       split(substr($0,RSTART+6,RLENGTH-6), _authtok, " ");');
            child.stdin.write('        _auth = _authtok[1];');
            child.stdin.write('        if($1=="' + consoleuid + '" && _auth!="")');
            child.stdin.write("        {");
            child.stdin.write("           printf \"%s,%s,%s,%s\\n\",$1,$2,_auth,display;");
            child.stdin.write("        }");
            child.stdin.write("     }'\nexit\n");
            child.waitExit();
            var tokens = child.stdout.str.trim().split('\n')[0].split(',');     // One line per X server, a user can have Xorg and Xwayland
            if (tokens.length == 4) { ret = xinfo(consoleuid, tokens[3], tokens[2], tokens[1]); }
            if ((ret != null) || (uname == null)) { return (ret); }

            // No X server with a key file, so the environment of every process of this user is inspected
            child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("ps -ax -e -o pid -o user | grep \" " + uname + "$\" | awk '{ print $1 }'\nexit\n");
            child.waitExit();
            var lines = child.stdout.str.split('\n'), envs = [];
            for (var n = 0; n < lines.length; ++n)
            {
                var ln = lines[n].trim();
                if (ln.length == 0) { continue; }
                var e = require('user-sessions').getEnvFromPid(ln);
                if (e.XAUTHORITY && e.DISPLAY) { return (xinfo(consoleuid, e.DISPLAY, e.XAUTHORITY)); }
                envs.push(e);
            }
            for (n = 0; n < envs.length; ++n) { if (envs[n].DISPLAY) { return (xinfo(consoleuid, envs[n].DISPLAY)); } }
            return (null);
        }

        // display, xauthority and uid of the console user's X session, with exportEnv() for a child's environment. null when none is found
        this.getXInfo = function getXInfo(consoleuid)
        {
            var ret = (process.platform == 'linux') ? xinfo_linux(consoleuid) : xinfo_ps(consoleuid);
            console.info1('xinfo => ' + JSON.stringify(ret));
            return (ret);
        };

        // Called by agentcore.c of agents with the session picker for every X11 capture child.
        // A greeter is captured as root: LightDM and SDDM run its X server as root, GDM runs it as the greeter account, whose key root can read.
        this.getCaptureXInfo = function getCaptureXInfo(uid)
        {
            var mi = require('monitor-info'), ret = mi.getXInfo(uid);     // agentcore.c also calls this without a this object
            if ((uid == 0) && ((ret == null) || !ret.display))
            {
                try
                {
                    var greeter = require('user-sessions').gdmUid;
                    var g = (greeter > 0) ? mi.getXInfo(greeter) : null;
                    if ((g != null) && g.xauthority && g.display) { ret = g; }
                }
                catch (e) { }
            }
            return (ret);
        };
    }
}

// toString() of an empty buffer gives null on these agents
function bufStr(b) { return ((b != null && b.length > 0) ? b.toString() : ''); }

// name and home of a uid from /etc/passwd, null for a field that is not found. user-sessions (getent in a shell) only for a user the file lacks (LDAP, SSSD)
function passwdEntry(uid)
{
    try
    {
        var lines = bufStr(require('fs').readFileSync('/etc/passwd')).split('\n');
        for (var i = 0; i < lines.length; ++i) { var f = lines[i].split(':'); if ((f.length >= 7) && (parseInt(f[2]) == uid)) { return ({ name: f[0], home: f[5] }); } }
    }
    catch (e) { }
    var us = require('user-sessions'), ret = { name: null, home: null };
    try { ret.name = us.getUsername(uid); } catch (e) { }
    try { ret.home = us.getHomeFolder(uid); } catch (e) { }
    return (ret);
}

// Left out when none was found, an empty XAUTHORITY stops libX11's fallback to ~/.Xauthority (xclip then says "Can't open display"). HOME is the user's for that fallback
function exportEnv()
{
    var r =
        {
            DISPLAY: this.display,
            Location_X11LIB: require('monitor-info').Location_X11LIB,
            Location_X11TST: require('monitor-info').Location_X11TST,
            Location_X11EXT: require('monitor-info').Location_X11EXT,
            Location_X11FIXES: require('monitor-info').Location_X11FIXES
        };
    if (this.xauthority) { r.XAUTHORITY = this.xauthority; }
    if (this.uid != null) { var home = passwdEntry(this.uid).home; if (home) { r.HOME = home; } }
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
