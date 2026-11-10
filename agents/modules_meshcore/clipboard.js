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

var AnyPropertyType = 0;
var CurrentTime = 0;
var None = 0;
var PropModeReplace = 0;
var SelectionClear = 29;
var SelectionNotify = 31;
var SelectionRequest = 30;
var XA_PRIMARY = 1;
var CF_TEXT = 1;
var CF_UNICODETEXT = 13;

var xclipTable = {};

function nativeAddCompressedModule(name)
{
    var value = getJSModule(name);
    var valuex = '';
    try
    {
        valuex = getJSModuleDate(name);
        if(valuex>0)
        {
            valuex = (new Date(valuex*1000)).toString().split(' ').join('T');
            valuex = ", '" + valuex + "'";

        }
        else
        {
            valuex = '';
        }
    }
    catch(e)
    {
        valuex = '';
    }

    var zip = require('compressed-stream').createCompressor();
    zip.buffer = null;
    zip.on('data', function (c)
    {
        if(this.buffer == null)
        {
            this.buffer = Buffer.concat([c]);
        }
        else
        {
            this.buffer = Buffer.concat([this.buffer, c]);
        }
    });
    zip.end(value);
    var vstring = zip.buffer.toString('base64');
    var ret = "duk_peval_string_noresult(ctx, \"addCompressedModule('" + name + "', Buffer.from('" + vstring + "', 'base64')" + valuex + ");\");";
    if (ret.length > 16300)
    {
        // MS Visual Studio has a maxsize limitation
        var tmp = vstring;
        ret = 'char *_' + name.split('-').join('') + ' = ILibMemory_Allocate(' + (tmp.length + 1) + ', 0, NULL, NULL);\n';
        var i = 0;
        while (i < tmp.length)
        {
            var chunk = tmp.substring(i, i + 16000);
            ret += ('memcpy_s(_' + name.split('-').join('') + ' + ' + i + ', ' + (tmp.length - i) + ', "' + chunk + '", ' + chunk.length + ');\n');
            i += chunk.length;
        }
        valuex = valuex.split("'").join('"');
        ret += ('ILibDuktape_AddCompressedModuleEx(ctx, "' + name + '", _' + name.split('-').join('') + valuex + ');\n');
        ret += ('free(_' + name.split('-').join('') + ');\n');
    }
    module.exports(ret);
}
function nativeBase64(name)
{
    var value = Buffer.from(getJSModule(name)).toString('base64');
    var ret = "char *" + name + " = NULL;\n";
    ret += (name + '[ILibBase64Decode((unsigned char*)"' + value + '", ' + value.length + ', (unsigned char **)&' + name + ')] = 0;\n');
    ret += ('duk_peval_string_noresult(ex, ' + name + ');\n');
    ret += ('free(' + name + ');\n');
    module.exports(ret);
}
function nativeAddModule(name,single)
{
    var value = getJSModule(name);
    var ret = "duk_peval_string_noresult(ctx, \"addModule('" + name + "', Buffer.from('" + Buffer.from(value).toString('base64') + "', 'base64').toString());\");";
    if (ret.length > 16300 && (single==null || single==false))
    {
        // MS Visual Studio has a maxsize limitation
        var tmp = Buffer.from(value).toString('base64');
        ret = 'char *_' + name.split('-').join('') + ' = ILibMemory_Allocate(' + (tmp.length + value.length + 2) + ', 0, NULL, NULL);\n';
        var i = 0;
        while (i < tmp.length)
        {
            var chunk = tmp.substring(i, i+16000);
            ret += ('memcpy_s(_' + name.split('-').join('') + ' + ' + i + ', ' + (tmp.length - i) + ', "' + chunk + '", ' + chunk.length + ');\n');
            i += chunk.length;
        }
        ret += ('ILibBase64DecodeEx((unsigned char*)_' + name.split('-').join('') + ', ' + tmp.length + ', (unsigned char*)_' + name.split('-').join('') + ' + ' + tmp.length + ');\n');
        ret += ('duk_push_global_object(ctx);duk_get_prop_string(ctx, -1, "addModule");duk_swap_top(ctx, -2);duk_push_string(ctx, "' + name + '");duk_push_string(ctx, _' + name.split('-').join('') + ' + ' + tmp.length + ');\n');
        ret += ('duk_pcall_method(ctx, 2); duk_pop(ctx);\n');
        ret += ('free(_' + name.split('-').join('') + ');\n');
    }
    module.exports(ret);
}
function dispatchRead(sid)
{
    var id = 0;

    if(sid==null)
    {
        if (process.platform == 'win32')
        {
            var active = require('user-sessions').Current().Active;
            if (active.length > 0)
            {
                id = parseInt(active[0].SessionId);
            }
        }
        else
        {
            id = require('user-sessions').consoleUid();
        }
    }
    else
    {
        id = sid;
    }

    if (id == 0 || process.platform == 'darwin' || process.platform == 'freebsd' || (process.platform == 'linux' && require('clipboard').xclip))
    {
        return (module.exports.read());
    }
    else
    {
        var childProperties = { sessionId: id };
        if (process.platform == 'linux')
        {
            xinfo = require('monitor-info').getXInfo(id);
            childProperties.env = { XAUTHORITY: xinfo.xauthority, DISPLAY: xinfo.display };
        }

        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret.success = false;
        ret.master = require('ScriptContainer').Create(childProperties);
        ret.master.promise = ret;
        ret.master.on('data', function (d)
        {
            this.promise.success = true;
            this.promise._res(d);
            this.exit();
        });
        ret.master.on('exit', function (code)
        {
            if (!this.promise.success)
            {
                this.promise._rej('Error reading clipboard');
            }
            delete this.promise.master;
        });
        ret.master.ExecuteString("var parent = require('ScriptContainer'); require('clipboard').read().then(function(v){parent.send(v);}, function(e){console.error(e);process.exit();});");
        return (ret);
    }
}

function dispatchWrite(data, sid)
{
    var id = 0;

    if(sid == null)
    {
        if(process.platform == 'win32')
        {
            var active = require('user-sessions').Current().Active;
            if(active.length>0)
            {
                id = parseInt(active[0].SessionId);
            }
        }
        else
        {
            id = require('user-sessions').consoleUid();
        }
    }
    else
    {
        id = sid;
    }

    if (id == 0 || process.platform == 'darwin' || process.platform == 'freebsd' || (process.platform == 'linux' && require('clipboard').xclip))
    {
        return(module.exports(data));
    }
    else
    {
        var childProperties = { sessionId: id };
        if (process.platform == 'linux')
        {
            xinfo = require('monitor-info').getXInfo(id);
            childProperties.env = { XAUTHORITY: xinfo.xauthority, DISPLAY: xinfo.display };
        }

        if (process.platform == 'win32' || !this.master)
        {
            this.master = require('ScriptContainer').Create(childProperties);
            this.master.parent = this;
            this.master.on('exit', function (code) { if (this.parent.master) { delete this.parent.master; } });
            this.master.on('data', function (d) { console.log(d); });
            this.master.ExecuteString("var parent = require('ScriptContainer'); parent.on('data', function(d){try{require('clipboard')(d);}catch(e){require('ScriptContainer').send(e);}if(process.platform == 'win32'){process.exit();}});");
        }
        this.master.send(data);

        if(process.platform == 'linux' && this.master)
        {
            if(this.master.timeout)
            {
                clearTimeout(this.master.timeout);
                this.master.timeout = null;
            }
            this.master.timeout = setTimeout(function (self)
            {
                self.master.exit();
                self.master = null;
            }, 60000, this);
        }

    }
}

function lin_xclip_readtext(ret)
{
    var id;
    try
    {
        id = require('user-sessions').consoleUid();
    }
    catch (e)
    {
        ret._rej(e);
        return (ret);
    }

    var xinfo = require('monitor-info').getXInfo(id);
    ret.child = require('child_process').execFile(require('clipboard').xclip, ['xlclip', '-selection', 'c', '-o'], { uid: id, env: xinfo.exportEnv() });
    ret.child.promise = ret;
    ret.child.stderr.str = ''; ret.child.stderr.on('data', function (c) { this.str += c.toString(); });
    ret.child.stdout.str = ''; ret.child.stdout.on('data', function (c) { this.str += c.toString(); });
    ret.child.on('exit', function ()
    {
        if (this.stderr.str != '')
        {
            this.promise._rej(this.stderr.str.trim());
        }
        else
        {
            this.promise._res(this.stdout.str);
        }
    });

    return (ret);
}

function bsd_xclip_readtext()
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    lin_xclip_readtext(ret);
    return (ret);
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
        if (require('clipboard').xclip)
        {
            lin_xclip_readtext(ret);
            return (ret);
        }

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
                X11.XConvertSelection(mon[0].display, this._masterPromise.CLIPID, this._masterPromise.FMTID, this._masterPromise.PROPID, this._masterPromise.FAKEWIN, CurrentTime);
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
        }, console.error);
    }
    return (ret);
}

function lin_xclip_copy(txt)
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var id;
    try
    {
        id = require('user-sessions').consoleUid();
    }
    catch(e)
    {
        ret._rej(e);
        return (ret);
    }

    var xinfo = require('monitor-info').getXInfo(id);
    ret.child = require('child_process').execFile(require('clipboard').xclip, ['xclip(' + ret._hashCode() + ')', '-selection', 'c'], { uid: id, env: xinfo.exportEnv() });
    ret.child.promise = ret;
    ret.child.stderr.on('data', function (c) { console.log(c.toString()); });
    ret.child.stdout.on('data', function (c) { console.log(c.toString()); });
    ret.child._helper = function _helper(p)
    {
        var ch = require('child_process').execFile('/bin/sh', ['sh']);
        ch.stdout.str = ''; ch.stdout.on('data', function (c) { this.str += c.toString(); });
        ch.stderr.on('data', function (c) { console.log(c.toString()); });
        if (process.platform == 'freebsd')
        {
            ch.stdin.write('ps -axo pid -o command ')
        }
        else
        {
            ch.stdin.write('ps -e -o pid -o cmd ')
        }
        ch.stdin.write('| grep "xclip(' + p._hashCode() + ')" | ' + " tr '\\n' '`' | awk -F'`' '");
        ch.stdin.write('{');
        ch.stdin.write('   for(i=1;i<NF;++i)');
        ch.stdin.write('   {');
        ch.stdin.write('       split($i,tokens," ");');
        ch.stdin.write('       name=tokens[2];');
        ch.stdin.write('       chkname=substr(name,1,6);')
        ch.stdin.write('       if(chkname=="xclip(")');
        ch.stdin.write('       {');
        ch.stdin.write('          printf "%s", tokens[1];');
        ch.stdin.write('       }');
        ch.stdin.write('   }');
        ch.stdin.write("}'\nexit\n");
        ch.waitExit();
        if (ch.stdout.str != '')
        {
            try
            {
                return (parseInt(ch.stdout.str.trim()));
            }
            catch (x)
            {
                return (-1);
            }
        }
        return (-1);
    };
    ret.child._cleanup = function _cleanup(p)
    {
        if (this.cleaned) { return; }
        this.cleaned = true;

        // During Cleanup, we need to kill the xclip process that was spawned, becuase xclip likes to hang around
        console.info1('XCLIP/' + (this._xclip_PID) + ' => SIGKILL');
        if (this._xclip_PID > 0) { process.kill(this._xclip_PID, 'SIGKILL'); }
        delete xclipTable[p._hashCode()];
    };
    ret.child.on('exit', function ()
    {
        xclipTable[this.promise._hashCode()] = setTimeout(function (p)
        {
            p.child._cleanup(p);
        }, 20000, this.promise);
        this.promise._res();
    });
    ret.child.stdin.write(txt, function ()
    {
        this.end();
    });
    ret.child.on('~', function ()
    {
        this._cleanup(this.promise);
    });
    ret.child._xclip_PID = ret.child._helper(ret);
    return (ret);
}

function lin_copytext(txt)
{
    var X11 = require('monitor-info')._X11;
    if (!X11)
    {
        throw('X11 required for Clipboard Manipulation');
    }
    else
    {
        if (require('clipboard').xclip)
        {
            return (lin_xclip_copy(txt));
        }
        var GM = require('monitor-info')._gm;
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret._txt = txt;
        ret._getInfoPromise = require('monitor-info').getInfo();
        ret._getInfoPromise._masterPromise = ret;
        ret._getInfoPromise.then(function (mon)
        {
            if (mon.length > 0)
            {
                var white = X11.XWhitePixel(mon[0].display, mon[0].screenId).Val;
                this._masterPromise.CLIPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('CLIPBOARD'), 0);
                this._masterPromise.FMTID = X11.XInternAtom(mon[0].display, GM.CreateVariable('UTF8_STRING'), 0);
                this._masterPromise.ROOTWIN = X11.XRootWindow(mon[0].display, mon[0].screenId);
                this._masterPromise.FAKEWIN = X11.XCreateSimpleWindow(mon[0].display, this._masterPromise.ROOTWIN, 0, 0, mon[0].right, 5, 0, white, white);

                X11.XSetSelectionOwner(mon[0].display, XA_PRIMARY, this._masterPromise.FAKEWIN, CurrentTime);
                X11.XSetSelectionOwner(mon[0].display, this._masterPromise.CLIPID, this._masterPromise.FAKEWIN, CurrentTime);
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
                        switch (XE.Deref(0, 4).toBuffer().readUInt32LE())
                        {
                            case SelectionClear:
                                console.info1('Somebody else owns clipboard');
                                break;
                            case SelectionRequest:
                                console.info1('Somebody wants us to send them data');

                                var ev = GM.CreateVariable(GM.PointerSize == 8 ? 72 : 36);
                                var sr_requestor = GM.PointerSize == 8 ? XE.Deref(40, 8) : XE.Deref(20, 4);
                                var sr_selection = GM.PointerSize == 8 ? XE.Deref(48, 8) : XE.Deref(24, 4);
                                var sr_property = GM.PointerSize == 8 ? XE.Deref(64, 8) : XE.Deref(32, 4);
                                var sr_target = GM.PointerSize == 8 ? XE.Deref(56, 8) : XE.Deref(28, 4);
                                var sr_time = GM.PointerSize == 8 ? XE.Deref(72, 8) : XE.Deref(36, 4);
                                var sr_display = GM.PointerSize == 8 ? XE.Deref(24, 8) : XE.Deref(12, 4);

                                ev.Deref(0, 4).toBuffer().writeUInt32LE(SelectionNotify);
                                var ev_requestor = GM.PointerSize == 8 ? ev.Deref(32, 8) : ev.Deref(16, 4);
                                var ev_selection = GM.PointerSize == 8 ? ev.Deref(40, 8) : ev.Deref(20, 4);
                                var ev_target = GM.PointerSize == 8 ? ev.Deref(48, 8) : ev.Deref(24, 4);
                                var ev_time = GM.PointerSize == 8 ? ev.Deref(64, 8) : ev.Deref(32, 4);
                                var ev_property = GM.PointerSize == 8 ? ev.Deref(56, 8) : ev.Deref(28, 4);
                                var cliptext = GM.CreateVariable(this._masterPromise._txt);

                                sr_requestor.Deref().pointerBuffer().copy(ev_requestor.toBuffer()); console.info1('REQUESTOR: ' + sr_requestor.Deref().pointerBuffer().toString('hex'));
                                sr_selection.Deref().pointerBuffer().copy(ev_selection.toBuffer()); console.info1('SELECTION: ' + sr_selection.Deref().pointerBuffer().toString('hex'));
                                sr_target.Deref().pointerBuffer().copy(ev_target.toBuffer()); console.info1('TARGET: ' + sr_target.Deref().pointerBuffer().toString('hex'));
                                sr_time.Deref().pointerBuffer().copy(ev_time.toBuffer()); console.info1('TIME: ' + sr_time.Deref().pointerBuffer().toString('hex'));

                                if (sr_target.Deref().Val == this._masterPromise.FMTID.Val)
                                {
                                    console.info1('UTF8 Request for: ' + cliptext.String);
                                    console.info1(sr_display.Val, sr_requestor.Deref().Val, sr_property.Deref().Val, sr_target.Deref().Val);
                                    X11.XChangeProperty(sr_display.Deref(), sr_requestor.Deref(), sr_property.Deref(), sr_target.Deref(), 8, PropModeReplace, cliptext, cliptext._size - 1);
                                    X11.XSync(sr_display.Deref(), 0);
                                    sr_property.Deref().pointerBuffer().copy(ev_property.toBuffer()); 
                                }
                                else
                                {
                                    console.info1('Unknown Format Request');
                                    ev_property.pointerBuffer().writeUInt32LE(None);
                                }

                                X11.XSendEvent(sr_display.Deref(), sr_requestor.Deref(), 1, 0, ev);
                                break;
                        }
                    }
                });
            }
        }, console.log);
    }
}

function win_readtext()
{
    var h;
    var ret = '';
    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('GlobalAlloc');
    kernel32.CreateMethod('GlobalLock');
    kernel32.CreateMethod('GlobalUnlock');

    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('IsClipboardFormatAvailable');
    user32.CreateMethod('GetClipboardData');
    user32.CreateMethod('OpenClipboard');

    user32.OpenClipboard(0);

    if (user32.IsClipboardFormatAvailable(CF_UNICODETEXT).Val != 0)
    {
        h = user32.GetClipboardData(CF_UNICODETEXT);
        if (h.Val != 0)
        {
            var hbuffer = kernel32.GlobalLock(h);
            hbuffer._size = -1;
            ret = hbuffer.Wide2UTF8;
            kernel32.GlobalUnlock(h);
        }
    }
    else
    {
        var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        p._rej('Unknown Clipboard Data');
        return (p);
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
    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('EmptyClipboard');
    user32.CreateMethod('IsClipboardFormatAvailable');
    user32.CreateMethod('OpenClipboard');
    user32.CreateMethod('SetClipboardData');

    var mtxt = GM.CreateVariable(txt, { wide: true }); 
    var h = kernel32.GlobalAlloc(GMEM_MOVEABLE, mtxt._size);
    h.autoFree(false);
    var hbuffer = kernel32.GlobalLock(h);
    hbuffer.autoFree(false);

    mtxt.toBuffer().copy(hbuffer.Deref(0, (2 * txt.length) + 2).toBuffer());
    kernel32.GlobalUnlock(h);

    user32.OpenClipboard(0);
    user32.EmptyClipboard();
    user32.SetClipboardData(CF_UNICODETEXT, h);
    user32.CloseClipboard();
}
function macos_copytext(clipText)
{
    return (require('message-box').setClipboard(clipText));
}
function macos_readtext()
{
    return (require('message-box').getClipboard());
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
        Object.defineProperty(module.exports, "xclip",
            {
                get: function ()
                {
                    if (this._xclip) { return (this._xclip); }
                    var child = require('child_process').execFile('/bin/sh', ['sh']);
                    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
                    child.stdin.write("whereis xclip | awk '{ print $2; }'\nexit\n");
                    child.waitExit();
                    if (child.stdout.str.trim() != "")
                    {
                        Object.defineProperty(this, "_xclip", { value: child.stdout.str.trim() });
                    }

                    return (child.stdout.str.trim() != "" ? child.stdout.str.trim() : null);
                }
            });
        break;
    case 'freebsd':
        if (require('fs').existsSync('/usr/local/bin/xclip'))
        {
            module.exports = lin_xclip_copy;
            module.exports.read = bsd_xclip_readtext;
            Object.defineProperty(module.exports, "xclip", { value: '/usr/local/bin/xclip' });
        }
        else
        {
            throw ('Clipboard Support on BSD requires xclip');
        }
        break;
    case 'darwin':
        module.exports = macos_copytext;
        module.exports.read = macos_readtext;
        break;
}
module.exports.nativeAddModule = nativeAddModule;
module.exports.nativeAddCompressedModule = nativeAddCompressedModule;
module.exports.nativeBase64 = nativeBase64;
module.exports.dispatchWrite = dispatchWrite;
module.exports.dispatchRead = dispatchRead;