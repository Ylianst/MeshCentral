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

var GM = require('_GenericMarshal');

function WindowsMessagePump(options)
{
    this._ObjectID = 'win-message-pump';
    this._options = options;
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('hwnd');
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('message');
    emitterUtils.createEvent('exit');

    this._msg = GM.CreateVariable(GM.PointerSize == 4 ? 28 : 48);
    this._kernel32 = GM.CreateNativeProxy('Kernel32.dll');
    this._kernel32.mp = this;
    this._kernel32.CreateMethod('GetLastError');
    this._kernel32.CreateMethod('GetModuleHandleA');

    this._user32 = GM.CreateNativeProxy('User32.dll');
    this._user32.mp = this;
    this._user32.CreateMethod('GetMessageA');
    this._user32.CreateMethod('CreateWindowExA');
    this._user32.CreateMethod('TranslateMessage');
    this._user32.CreateMethod('DispatchMessageA');
    this._user32.CreateMethod('RegisterClassExA');
    this._user32.CreateMethod('DefWindowProcA');
    this._user32.CreateMethod('PostMessageA');


    this.wndclass = GM.CreateVariable(GM.PointerSize == 4 ? 48 : 80);
    this.wndclass.mp = this;
    this.wndclass.hinstance = this._kernel32.GetModuleHandleA(0);
    this.wndclass.cname = GM.CreateVariable('MainWWWClass');
    this.wndclass.wndproc = GM.GetGenericGlobalCallback(4);
    this.wndclass.wndproc.mp = this;
    this.wndclass.toBuffer().writeUInt32LE(this.wndclass._size);
    this.wndclass.cname.pointerBuffer().copy(this.wndclass.Deref(GM.PointerSize == 4 ? 40 : 64, GM.PointerSize).toBuffer());
    this.wndclass.wndproc.pointerBuffer().copy(this.wndclass.Deref(8, GM.PointerSize).toBuffer());
    this.wndclass.hinstance.pointerBuffer().copy(this.wndclass.Deref(GM.PointerSize == 4 ? 20 : 24, GM.PointerSize).toBuffer());
    this.wndclass.wndproc.on('GlobalCallback', function onWndProc(xhwnd, xmsg, wparam, lparam)
    {
        if (this.mp._hwnd != null && this.mp._hwnd.Val == xhwnd.Val)
        {
            // This is for us
            this.mp.emit('message', { message: xmsg.Val, wparam: wparam.Val, lparam: lparam.Val, lparam_hex: lparam.pointerBuffer().toString('hex') });
            return (this.mp._user32.DefWindowProcA(xhwnd, xmsg, wparam, lparam));
        }
        else if(this.mp._hwnd == null && this.CallingThread() == this.mp._user32.RegisterClassExA.async.threadId())
        {
            // This message was generated from our CreateWindowExA method
            return (this.mp._user32.DefWindowProcA(xhwnd, xmsg, wparam, lparam));
        }
    });

    this._user32.RegisterClassExA.async(this.wndclass).then(function ()
    {
        this.nativeProxy.CreateWindowExA.async(this.nativeProxy.RegisterClassExA.async, 0x00000088, this.nativeProxy.mp.wndclass.cname, 0, 0x00800000, 0, 0, 100, 100, 0, 0, 0, 0)
            .then(function(h)
            {
                if (h.Val == 0)
                {
                    // Error creating hidden window
                    this.nativeProxy.mp.emit('error', 'Error creating hidden window');
                }
                else
                {
                    this.nativeProxy.mp._hwnd = h;
                    this.nativeProxy.mp.emit('hwnd', h);
                    this.nativeProxy.mp._startPump();
                }
            });
    });
    this._startPump = function _startPump()
    {
        this._user32.GetMessageA.async(this._user32.RegisterClassExA.async, this._msg, this._hwnd, 0, 0).then(function (r)
        {
            if(r.Val > 0)
            {
                this.nativeProxy.TranslateMessage.async(this.nativeProxy.RegisterClassExA.async, this.nativeProxy.mp._msg).then(function ()
                {
                    this.nativeProxy.DispatchMessageA.async(this.nativeProxy.RegisterClassExA.async, this.nativeProxy.mp._msg).then(function ()
                    {
                        this.nativeProxy.mp._startPump();
                    });
                });
            }
            else
            {
                // We got a 'QUIT' message
                delete this.nativeProxy.mp._hwnd;
                this.nativeProxy.mp.emit('exit', 0);
            }
        }, function (err) { this.nativeProxy.mp.stop(); });
    }

    this.stop = function stop()
    {
        if (this._hwnd)
        {
            this._user32.PostMessageA(this._hwnd, WM_QUIT, 0, 0);
        }
    };
}

module.exports = WindowsMessagePump;
