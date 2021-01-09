/*
Copyright 2018-2021 Intel Corporation

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

var TrayIconFlags =
    {
        NIF_MESSAGE: 0x00000001,
        NIF_ICON: 0x00000002,
        NIF_TIP: 0x00000004,
        NIF_STATE: 0x00000008,
        NIF_INFO: 0x00000010,
        NIF_GUID: 0x00000020,
        NIF_REALTIME: 0x00000040,
        NIF_SHOWTIP: 0x00000080,

        NIM_ADD: 0x00000000,
        NIM_MODIFY: 0x00000001,
        NIM_DELETE: 0x00000002,
        NIM_SETFOCUS: 0x00000003,
        NIM_SETVERSION: 0x00000004
    };
var NOTIFYICON_VERSION_4 = 4;
var MessageTypes = { WM_APP: 0x8000, WM_USER: 0x0400 };
function WindowsConsole()
{
    if (process.platform == 'win32')
    {
        this._ObjectID = 'win-console';
        this._Marshal = require('_GenericMarshal');
        this._kernel32 = this._Marshal.CreateNativeProxy("kernel32.dll");
        this._user32 = this._Marshal.CreateNativeProxy("user32.dll");
        this._kernel32.CreateMethod("GetConsoleWindow");
        this._kernel32.CreateMethod('GetCurrentThread');
        this._user32.CreateMethod("ShowWindow");
        this._user32.CreateMethod("LoadImageA");
        this._user32.CreateMethod({ method: 'GetMessageA', threadDispatch: 1 });
        this._shell32 = this._Marshal.CreateNativeProxy('Shell32.dll');
        this._shell32.CreateMethod('Shell_NotifyIconA');

        this._handle = this._kernel32.GetConsoleWindow();
        this.minimize = function () {
            this._user32.ShowWindow(this._handle, 6);
        };
        this.restore = function () {
            this._user32.ShowWindow(this._handle, 9);
        };
        this.hide = function () {
            this._user32.ShowWindow(this._handle, 0);
        };
        this.show = function () {
            this._user32.ShowWindow(this._handle, 5);
        };


        this._loadicon = function (imagePath) {
            var h = this._user32.LoadImageA(0, this._Marshal.CreateVariable(imagePath), 1, 0, 0, 0x00000010 | 0x00008000 | 0x00000040); // LR_LOADFROMFILE | LR_SHARED | LR_DEFAULTSIZE
            return (h);
        };

        this.SetTrayIcon = function SetTrayIcon(options)
        {
            var data = this._Marshal.CreateVariable(this._Marshal.PointerSize == 4 ? 508 : 528);
            //console.log('struct size = ' + data._size);
            //console.log('TryIcon, WM_MESSAGE filter = ' + options.filter);
            data.toBuffer().writeUInt32LE(data._size, 0);

            var trayType = TrayIconFlags.NIF_TIP | TrayIconFlags.NIF_MESSAGE
            options.filter = MessageTypes.WM_APP + 1;
            data.Deref(this._Marshal.PointerSize == 4 ? 16 : 24, 4).toBuffer().writeUInt32LE(options.filter);

            if (!options.noBalloon) { trayType |= TrayIconFlags.NIF_INFO; }

            if (options.icon)
            {                
                trayType |= TrayIconFlags.NIF_ICON;
                var hIcon = data.Deref(this._Marshal.PointerSize == 4 ? 20 : 32, this._Marshal.PointerSize);
                options.icon.pointerBuffer().copy(hIcon.toBuffer());
            }

            data.Deref(this._Marshal.PointerSize * 2, 4).toBuffer().writeUInt32LE(1);
            data.Deref(this._Marshal.PointerSize == 4 ? 12 : 20, 4).toBuffer().writeUInt32LE(trayType);
            data.Deref(this._Marshal.PointerSize == 4 ? 416 : 432, 4).toBuffer().writeUInt32LE(NOTIFYICON_VERSION_4);

            var szTip = data.Deref(this._Marshal.PointerSize == 4 ? 24 : 40, 128);
            var szInfo = data.Deref(this._Marshal.PointerSize == 4 ? 160 : 176, 256);
            var szInfoTitle = data.Deref(this._Marshal.PointerSize == 4 ? 420 : 436, 64);

            if (options.szTip) { Buffer.from(options.szTip).copy(szTip.toBuffer()); }
            if (options.szInfo) { Buffer.from(options.szInfo).copy(szInfo.toBuffer()); }
            if (options.szInfoTitle) { Buffer.from(options.szInfoTitle).copy(szInfoTitle.toBuffer()); }


            var MessagePump = require('win-message-pump');
            retVal = { _ObjectID: 'WindowsConsole.TrayIcon', MessagePump: new MessagePump(options) };
            var retValEvents = require('events').inherits(retVal);
            retValEvents.createEvent('ToastClicked');
            retValEvents.createEvent('IconHover');
            retValEvents.createEvent('ToastDismissed');
            retVal.Options = options;
            retVal.MessagePump.TrayIcon = retVal;
            retVal.MessagePump.NotifyData = data;
            retVal.MessagePump.WindowsConsole = this;
            retVal.MessagePump.on('exit', function onExit(code) { console.log('Pump Exited'); if (this.TrayIcon) { this.TrayIcon.remove(); } });
            retVal.MessagePump.on('hwnd', function onHwnd(h)
            {
                //console.log('Got HWND');
                options.hwnd = h;
                h.pointerBuffer().copy(this.NotifyData.Deref(this.WindowsConsole._Marshal.PointerSize, this.WindowsConsole._Marshal.PointerSize).toBuffer());

                if(this.WindowsConsole._shell32.Shell_NotifyIconA(TrayIconFlags.NIM_ADD, this.NotifyData).Val == 0)
                {
                    // Something went wrong
                }
            });
            retVal.MessagePump.on('message', function onWindowsMessage(msg)
            {
                if(msg.message == this.TrayIcon.Options.filter)
                {
                    var handled = false;
                    if (msg.wparam == 1 && msg.lparam == 1029)
                    {
                        this.TrayIcon.emit('ToastClicked');
                        handled = true;
                    }
                    if (msg.wparam == 1 && msg.lparam == 512)
                    {
                        this.TrayIcon.emit('IconHover');
                        handled = true;
                    }
                    if (this.TrayIcon.Options.balloonOnly && msg.wparam == 1 && (msg.lparam == 1028 || msg.lparam == 1029))
                    {
                        this.TrayIcon.emit('ToastDismissed');
                        this.TrayIcon.remove();
                        handled = true;
                    }
                }
            });
            retVal.remove = function remove()
            {
                this.MessagePump.WindowsConsole._shell32.Shell_NotifyIconA(TrayIconFlags.NIM_DELETE, this.MessagePump.NotifyData);
                this.MessagePump.stop();
                delete this.MessagePump.TrayIcon;
                delete this.MessagePump;
            };
            return (retVal);
            
        };
    }
}

module.exports = new WindowsConsole();