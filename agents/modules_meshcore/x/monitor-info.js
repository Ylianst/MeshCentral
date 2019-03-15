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
var _NET_WM_STATE_REMOVE = 0;    // remove/unset property
var _NET_WM_STATE_ADD = 1;    // add/set property
var _NET_WM_STATE_TOGGLE = 2;    // toggle property
var SubstructureRedirectMask = (1 << 20);
var SubstructureNotifyMask = (1 << 19);

function getLibInfo(libname)
{
    if (process.platform != 'linux') { throw ('Only supported on linux'); }

    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = '';
    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
    child.stdin.write("ldconfig -p | grep '" + libname + ".so.'\nexit\n");
    child.waitExit();

    var v = [];
    var lines = child.stdout.str.split('\n');
    for (var i in lines) {
        if (lines[i]) {
            var info = lines[i].split('=>');
            var pth = info[1].trim();
            var libinfo = info[0].trim().split(' ');
            var lib = libinfo[0];
            var plat = libinfo[1].substring(1, libinfo[1].length - 1).split(',');

            if (lib.startsWith(libname + '.so.')) {
                v.push({ lib: lib, path: pth, info: plat });
            }
        }
    }
    return (v);
}

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
        // First thing we need to do, is determine where the X11 libraries are
        var askOS = false;
        try
        {
            if (require('user-sessions').isRoot()) { askOS = true; }
        }
        catch (e)
        { }

        if (askOS)
        {
            // Sufficient access rights to use ldconfig
            var x11info = getLibInfo('libX11');
            var xtstinfo = getLibInfo('libXtst');
            var xextinfo = getLibInfo('libXext');
            var ix;

            for(ix in x11info)
            {
                try
                {
                    this._gm.CreateNativeProxy(x11info[ix].path);
                    Object.defineProperty(this, 'Location_X11LIB', { value: x11info[ix].path });
                    break;
                }
                catch(ex)
                {
                }
            }
            for (ix in xtstinfo)
            {
                try
                {
                    this._gm.CreateNativeProxy(xtstinfo[ix].path);
                    Object.defineProperty(this, 'Location_X11TST', { value: xtstinfo[ix].path });
                    break;
                }
                catch (ex)
                {
                }
            }
            for (ix in xextinfo)
            {
                try
                {
                    this._gm.CreateNativeProxy(xextinfo[ix].path);
                    Object.defineProperty(this, 'Location_X11EXT', { value: xextinfo[ix].path });
                    break;
                }
                catch (ex)
                {
                }
            }
        }
        else
        {
            // Not enough access rights to use ldconfig, so manually search
            var fs = require('fs');
            var files = fs.readdirSync('/usr/lib');
            var files2;

            for (var i in files) {
                try {
                    if (files[i].split('libX11.so.').length > 1 && files[i].split('.').length == 3) {
                        Object.defineProperty(this, 'Location_X11LIB', { value: '/usr/lib/' + files[i] });
                    }
                    if (files[i].split('libXtst.so.').length > 1 && files[i].split('.').length == 3) {
                        Object.defineProperty(this, 'Location_X11TST', { value: '/usr/lib/' + files[i] });
                    }
                    if (files[i].split('libXext.so.').length > 1 && files[i].split('.').length == 3) {
                        Object.defineProperty(this, 'Location_X11EXT', { value: '/usr/lib/' + files[i] });
                    }

                    if (files[i].split('-linux-').length > 1) {
                        files2 = fs.readdirSync('/usr/lib/' + files[i]);
                        for (j in files2) {
                            if (files2[j].split('libX11.so.').length > 1 && files2[j].split('.').length == 3) {
                                Object.defineProperty(this, 'Location_X11LIB', { value: '/usr/lib/' + files[i] + '/' + files2[j] });
                            }
                            if (files2[j].split('libXtst.so.').length > 1 && files2[j].split('.').length == 3) {
                                Object.defineProperty(this, 'Location_X11TST', { value: '/usr/lib/' + files[i] + '/' + files2[j] });
                            }
                            if (files2[j].split('libXext.so.').length > 1 && files2[j].split('.').length == 3) {
                                Object.defineProperty(this, 'Location_X11EXT', { value: '/usr/lib/' + files[i] + '/' + files2[j] });
                            }
                        }
                    }
                } catch (ex) { }
            }
        }
        Object.defineProperty(this, 'kvm_x11_support', { value: (this.Location_X11LIB && this.Location_X11TST && this.Location_X11EXT)?true:false });

        if (this.Location_X11LIB)
        {
            this._X11 = this._gm.CreateNativeProxy(this.Location_X11LIB);
            this._X11.CreateMethod('XChangeProperty');
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
            this._X11.CreateMethod('XGetWindowProperty');
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
            this._X11.CreateMethod('XSetSubwindowMode');
            this._X11.CreateMethod('XSync');
            this._X11.CreateMethod('XBlackPixel');
            this._X11.CreateMethod('XWhitePixel');
        }

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



