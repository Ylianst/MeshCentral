/*
Copyright 2019 Intel Corporation

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

function nativeAddModule(name)
{
    var value = getJSModule(name);
    var ret = "duk_peval_string_noresult(ctx, \"addModule('" + name + "', Buffer.from('" + Buffer.from(value).toString('base64') + "', 'base64').toString());\");";
    module.exports(ret);
}

function lin_readtext()
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    try
    {
        require('monitor-info')
    }
    catch(exc)
    {
        ret._rej(exc);
        return (ret);
    }

    var X11 = require('monitor-info')._X11;
    if (!X11)
    {
        ret._rej('X11 required for Clipboard Manipulation');
    }
    else
    {
        var SelectionNotify = 31;
        var AnyPropertyType = 0;
        var GM = require('monitor-info')._gm;

        ret._getInfoPromise = require('monitor-info').getInfo();
        ret._getInfoPromise._masterPromise = ret;
        ret._getInfoPromise.then(function (mon)
        {
            if (mon.length > 0)
            {
                var white = X11.XWhitePixel(mon[0].display, mon[0].screenId).Val;

                this._masterPromise.CLIPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('CLIPBOARD'), 0);
                this._masterPromise.FMTID = X11.XInternAtom(mon[0].display, GM.CreateVariable('UTF8_STRING'), 0);
                this._masterPromise.PROPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('XSEL_DATA'), 0);
                this._masterPromise.INCRID = X11.XInternAtom(mon[0].display, GM.CreateVariable('INCR'), 0);
                this._masterPromise.ROOTWIN = X11.XRootWindow(mon[0].display, mon[0].screenId);
                this._masterPromise.FAKEWIN = X11.XCreateSimpleWindow(mon[0].display, this._masterPromise.ROOTWIN, 0, 0, mon[0].right, 5, 0, white, white);

                X11.XSync(mon[0].display, 0);
                X11.XConvertSelection(mon[0].display, this._masterPromise.CLIPID, this._masterPromise.FMTID, this._masterPromise.PROPID, this._masterPromise.FAKEWIN, 0);
                X11.XSync(mon[0].display, 0);

                this._masterPromise.DescriptorEvent = require('DescriptorEvents').addDescriptor(X11.XConnectionNumber(mon[0].display).Val, { readset: true });
                this._masterPromise.DescriptorEvent._masterPromise = this._masterPromise;
                this._masterPromise.DescriptorEvent._display = mon[0].display;
                this._masterPromise.DescriptorEvent.on('readset', function (fd)
                {
                    var XE = GM.CreateVariable(1024);
                    while (X11.XPending(this._display).Val)
                    {
                        X11.XNextEventSync(this._display, XE);
                        if(XE.Deref(0, 4).toBuffer().readUInt32LE() == SelectionNotify)
                        {
                            var id = GM.CreatePointer();
                            var bits = GM.CreatePointer();
                            var sz = GM.CreatePointer();
                            var tail = GM.CreatePointer();
                            var result = GM.CreatePointer();

                            X11.XGetWindowProperty(this._display, this._masterPromise.FAKEWIN, this._masterPromise.PROPID, 0, 65535, 0, AnyPropertyType, id, bits, sz, tail, result);
                            this._masterPromise._res(result.Deref().String);
                            X11.XFree(result.Deref());
                            X11.XDestroyWindow(this._display, this._masterPromise.FAKEWIN);

                            this.removeDescriptor(fd);
                            break;
                        }
                    }
                });
            }
        });
    }
    return (ret);
}
function lin_copytext()
{
}

function win_readtext()
{
    var ret = '';
    var CF_TEXT = 1;
    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('GlobalAlloc');
    kernel32.CreateMethod('GlobalLock');
    kernel32.CreateMethod('GlobalUnlock');
    user32.CreateMethod('OpenClipboard');
    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('GetClipboardData');

    user32.OpenClipboard(0);
    var h = user32.GetClipboardData(CF_TEXT);
    if(h.Val!=0)
    {
        var hbuffer = kernel32.GlobalLock(h);
        ret = hbuffer.String;
        kernel32.GlobalUnlock(h);
    }
    user32.CloseClipboard();

    var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    p._res(ret);
    return (p);
}

function win_copytext(txt)
{
    var GMEM_MOVEABLE = 0x0002;
    var CF_TEXT = 1;

    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('GlobalAlloc');
    kernel32.CreateMethod('GlobalLock');
    kernel32.CreateMethod('GlobalUnlock');
    user32.CreateMethod('OpenClipboard');
    user32.CreateMethod('EmptyClipboard');
    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('SetClipboardData');

    var h = kernel32.GlobalAlloc(GMEM_MOVEABLE, txt.length + 2);
    h.autoFree(false);
    var hbuffer = kernel32.GlobalLock(h);
    hbuffer.autoFree(false);
    var tmp = Buffer.alloc(txt.length + 1);
    Buffer.from(txt).copy(tmp);
    tmp.copy(hbuffer.Deref(0, txt.length + 1).toBuffer());
    kernel32.GlobalUnlock(h);

    user32.OpenClipboard(0);
    user32.EmptyClipboard();
    user32.SetClipboardData(CF_TEXT, h);
    user32.CloseClipboard();
}

switch(process.platform)
{
    case 'win32':
        module.exports = win_copytext;
        module.exports.read = win_readtext;
        break;
    case 'linux':
        module.exports = lin_copytext;
        module.exports.read = lin_readtext;
        break;
    case 'darwin':
        break;
}
module.exports.nativeAddModule = nativeAddModule;