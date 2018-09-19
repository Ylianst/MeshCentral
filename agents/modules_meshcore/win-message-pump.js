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

var WH_CALLWNDPROC = 4;
var WM_QUIT =  0x0012;

function WindowsMessagePump(options)
{
    this._ObjectID = 'win-message-pump';
    this._options = options;
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('hwnd');
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('message');
    emitterUtils.createEvent('exit');

    this._child = require('ScriptContainer').Create({ processIsolation: 0 });
    this._child.MessagePump = this;
    this._child.prependListener('~', function _childFinalizer() { this.MessagePump.emit('exit', 0); this.MessagePump.stop(); });
    this._child.once('exit', function onExit(code) { this.MessagePump.emit('exit', code); });
    this._child.once('ready', function onReady()
    {
        var execString = 
        "var m = require('_GenericMarshal');\
        var h = null;\
        var k = m.CreateNativeProxy('Kernel32.dll');\
        k.CreateMethod('GetLastError');\
        k.CreateMethod('GetModuleHandleA');\
        var u = m.CreateNativeProxy('User32.dll');\
        u.CreateMethod('GetMessageA');\
        u.CreateMethod('CreateWindowExA');\
        u.CreateMethod('TranslateMessage');\
        u.CreateMethod('DispatchMessageA');\
        u.CreateMethod('RegisterClassExA');\
        u.CreateMethod('DefWindowProcA');\
        var wndclass = m.CreateVariable(m.PointerSize == 4 ? 48 : 80);\
        wndclass.hinstance = k.GetModuleHandleA(0);\
        wndclass.cname = m.CreateVariable('MainWWWClass');\
        wndclass.wndproc = m.GetGenericGlobalCallback(4);\
        wndclass.toBuffer().writeUInt32LE(wndclass._size);\
        wndclass.cname.pointerBuffer().copy(wndclass.Deref(m.PointerSize == 4 ? 40 : 64, m.PointerSize).toBuffer());\
        wndclass.wndproc.pointerBuffer().copy(wndclass.Deref(8, m.PointerSize).toBuffer());\
        wndclass.hinstance.pointerBuffer().copy(wndclass.Deref(m.PointerSize == 4 ? 20 : 24, m.PointerSize).toBuffer());\
        wndclass.wndproc.on('GlobalCallback', function onWndProc(xhwnd, xmsg, wparam, lparam)\
        {\
            if(h==null || h.Val == xhwnd.Val)\
            {\
                require('ScriptContainer').send({message: xmsg.Val, wparam: wparam.Val, lparam: lparam.Val, lparam_hex: lparam.pointerBuffer().toString('hex')});\
                var retVal = u.DefWindowProcA(xhwnd, xmsg, wparam, lparam);\
                return(retVal);\
            }\
        });\
        u.RegisterClassExA(wndclass);\
        h = u.CreateWindowExA(0x00000088, wndclass.cname, 0, 0x00800000, 0, 0, 100, 100, 0, 0, 0, 0);\
        if(h.Val == 0)\
        {\
            require('ScriptContainer').send({error: 'Error Creating Hidden Window'});\
            process.exit();\
        }\
        require('ScriptContainer').send({hwnd: h.pointerBuffer().toString('hex')});\
        require('ScriptContainer').on('data', function onData(jmsg)\
        {\
            if(jmsg.listen)\
            {\
                var msg = m.CreateVariable(m.PointerSize == 4 ? 28 : 48);\
                while(u.GetMessageA(msg, h, 0, 0).Val>0)\
                {\
                    u.TranslateMessage(msg);\
                    u.DispatchMessageA(msg);\
                }\
                process.exit();\
            }\
        });";

        this.ExecuteString(execString);    
    });
    this._child.on('data', function onChildData(msg)
    {
        if (msg.hwnd)
        {
            var m = require('_GenericMarshal');
            this._hwnd = m.CreatePointer(Buffer.from(msg.hwnd, 'hex'));
            this.MessagePump.emit('hwnd', this._hwnd);
            this.send({ listen: this.MessagePump._options.filter });
        }
        else if(msg.message)
        {
            this.MessagePump.emit('message', msg);
        }
        else
        {
            console.log('Received: ', msg);
        }
    });
    this.stop = function stop()
    {
        if(this._child && this._child._hwnd)
        {
            var marshal = require('_GenericMarshal');
            var User32 = marshal.CreateNativeProxy('User32.dll');
            User32.CreateMethod('PostMessageA');
            User32.PostMessageA(this._child._hwnd, WM_QUIT, 0, 0);
        }
    };
}

module.exports = WindowsMessagePump;
