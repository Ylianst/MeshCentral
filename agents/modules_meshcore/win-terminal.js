/*
Copyright 2018-2022 Intel Corporation

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
var duplex = require('stream').Duplex;

var SW_HIDE = 0;
var SW_MINIMIZE = 6;
var STARTF_USESHOWWINDOW = 0x1;
var STD_INPUT_HANDLE = -10;
var STD_OUTPUT_HANDLE = -11;
var EVENT_CONSOLE_CARET = 0x4001;
var EVENT_CONSOLE_END_APPLICATION = 0x4007;
var WINEVENT_OUTOFCONTEXT = 0x000;
var WINEVENT_SKIPOWNPROCESS = 0x0002;
var CREATE_NEW_PROCESS_GROUP = 0x200;
var EVENT_CONSOLE_UPDATE_REGION = 0x4002;
var EVENT_CONSOLE_UPDATE_SIMPLE = 0x4003;
var EVENT_CONSOLE_UPDATE_SCROLL = 0x4004;
var EVENT_CONSOLE_LAYOUT = 0x4005;
var EVENT_CONSOLE_START_APPLICATION = 0x4006;
var KEY_EVENT = 0x1;
var MAPVK_VK_TO_VSC = 0;
var WM_QUIT = 0x12;

var GM = require('_GenericMarshal');
var si = GM.CreateVariable(GM.PointerSize == 4 ? 68 : 104);
var pi = GM.CreateVariable(GM.PointerSize == 4 ? 16 : 24);

si.Deref(0, 4).toBuffer().writeUInt32LE(GM.PointerSize == 4 ? 68 : 104);                    // si.cb
si.Deref(GM.PointerSize == 4 ? 48 : 64, 2).toBuffer().writeUInt16LE(SW_HIDE | SW_MINIMIZE); // si.wShowWindow
si.Deref(GM.PointerSize == 4 ? 44 : 60, 4).toBuffer().writeUInt32LE(STARTF_USESHOWWINDOW);  // si.dwFlags;

var MSG = GM.CreateVariable(GM.PointerSize == 4 ? 28 : 48);

function windows_terminal() {
    this._ObjectID = 'windows_terminal';
    this._user32 = GM.CreateNativeProxy('User32.dll');
    this._user32.CreateMethod('DispatchMessageA');
    this._user32.CreateMethod('GetMessageA');
    this._user32.CreateMethod('MapVirtualKeyA');
    this._user32.CreateMethod('PostThreadMessageA');
    this._user32.CreateMethod('SetWinEventHook');
    this._user32.CreateMethod('ShowWindow');
    this._user32.CreateMethod('TranslateMessage');
    this._user32.CreateMethod('UnhookWinEvent');
    this._user32.CreateMethod('VkKeyScanA');
    this._user32.terminal = this;
    
    this._kernel32 = GM.CreateNativeProxy('Kernel32.dll');
    this._kernel32.CreateMethod('AllocConsole');
    this._kernel32.CreateMethod('CreateProcessA');
    this._kernel32.CreateMethod('CloseHandle');
    this._kernel32.CreateMethod('FillConsoleOutputAttribute');
    this._kernel32.CreateMethod('FillConsoleOutputCharacterA');
    this._kernel32.CreateMethod('GetConsoleScreenBufferInfo');
    this._kernel32.CreateMethod('GetConsoleWindow');
    this._kernel32.CreateMethod('GetLastError');
    this._kernel32.CreateMethod('GetStdHandle');
    this._kernel32.CreateMethod('GetThreadId');
    this._kernel32.CreateMethod('ReadConsoleOutputA');
    this._kernel32.CreateMethod('SetConsoleCursorPosition');
    this._kernel32.CreateMethod('SetConsoleScreenBufferSize');
    this._kernel32.CreateMethod('SetConsoleWindowInfo');
    this._kernel32.CreateMethod('TerminateProcess');
    this._kernel32.CreateMethod('WaitForSingleObject');
    this._kernel32.CreateMethod('WriteConsoleInputA');
    
    var currentX = 0;
    var currentY = 0;
    
    this._scrx = 0;
    this._scry = 0;
    
    this.SendCursorUpdate = function () {
        var newCsbi = GM.CreateVariable(22);
        
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, newCsbi).Val == 0) { return; }
        if (newCsbi.Deref(4, 2).toBuffer().readUInt16LE() != this.currentX || newCsbi.Deref(6, 2).toBuffer().readUInt16LE() != this.currentY)
        {
            //
            // Reference for CONSOLE_SCREEN_BUFFER_INFO can be found at:
            // https://learn.microsoft.com/en-us/windows/console/console-screen-buffer-info-str
            //

            this.currentX = newCsbi.Deref(4, 2).toBuffer().readUInt16LE();
            this.currentY = newCsbi.Deref(6, 2).toBuffer().readUInt16LE();
        }
    }

    this.ClearScreen = function ()
    {
        //
        // Reference for CONSOLE_SCREEN_BUFFER_INFO can be found at:
        // https://learn.microsoft.com/en-us/windows/console/console-screen-buffer-info-str
        //

        // 
        // Reference for GetConsoleScreenBufferInfo can be found at:
        // https://learn.microsoft.com/en-us/windows/console/getconsolescreenbufferinfo
        //

        //
        // Reference for FillConsoleOutputCharacter can be found at:
        // https://learn.microsoft.com/en-us/windows/console/fillconsoleoutputcharacter
        //

        // 
        // Reference for FillConsoleOutputAttribute can be found at:
        // https://learn.microsoft.com/en-us/windows/console/fillconsoleoutputattribute
        //

        //
        // Reference for SetConsoleCursorPosition can be found at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolecursorposition
        //

        // 
        // Reference for SetConsoleWindowInfo can be fount at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolewindowinfo
        //

        var CONSOLE_SCREEN_BUFFER_INFO = GM.CreateVariable(22);
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, CONSOLE_SCREEN_BUFFER_INFO).Val == 0) { return; }
        
        var coordScreen = GM.CreateVariable(4);
        var dwConSize = CONSOLE_SCREEN_BUFFER_INFO.Deref(0, 2).toBuffer().readUInt16LE(0) * CONSOLE_SCREEN_BUFFER_INFO.Deref(2, 2).toBuffer().readUInt16LE(0);
        var cCharsWritten = GM.CreateVariable(4);
        
        // Fill the entire screen with blanks.
        if (this._kernel32.FillConsoleOutputCharacterA(this._stdoutput, 32, dwConSize, coordScreen.Deref(0, 4).toBuffer().readUInt32LE(), cCharsWritten).Val == 0) { return; }
        
        // Get the current text attribute.
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, CONSOLE_SCREEN_BUFFER_INFO).Val == 0) { return; }
        
        // Set the buffer's attributes accordingly.
        if (this._kernel32.FillConsoleOutputAttribute(this._stdoutput, CONSOLE_SCREEN_BUFFER_INFO.Deref(8, 2).toBuffer().readUInt16LE(0), dwConSize, coordScreen.Deref(0, 4).toBuffer().readUInt32LE(), cCharsWritten).Val == 0) { return; }
        
        // Put the cursor at its home coordinates.
        this._kernel32.SetConsoleCursorPosition(this._stdoutput, coordScreen.Deref(0, 4).toBuffer().readUInt32LE());
        
        // Put the window to top-left.
        var rect = GM.CreateVariable(8);
        var srWindow = CONSOLE_SCREEN_BUFFER_INFO.Deref(10, 8).toBuffer();
        rect.Deref(4, 2).toBuffer().writeUInt16LE(srWindow.readUInt16LE(4) - srWindow.readUInt16LE(0));
        rect.Deref(6, 2).toBuffer().writeUInt16LE(srWindow.readUInt16LE(6) - srWindow.readUInt16LE(2));
        
        this._kernel32.SetConsoleWindowInfo(this._stdoutput, 1, rect);
    }
    
    // This does a rudimentary check if the platform is capable of PowerShell
    this.PowerShellCapable = function()
    {
        if (require('os').arch() == 'x64')
        {
            return (require('fs').existsSync(process.env['windir'] + '\\SysWow64\\WindowsPowerShell\\v1.0\\powershell.exe'));
        }
        else
        {
            return (require('fs').existsSync(process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'));
        }
    }

    // Starts a Legacy Windows Terminal Session
    this.StartEx = function Start(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, terminalTarget)
    {
        // The older windows terminal does not support 
        CONSOLE_SCREEN_WIDTH = 80;
        CONSOLE_SCREEN_HEIGHT = 25;

        if (this._stream != null)
        {
            throw ('Concurrent terminal sessions are not supported on Windows.');
        }
        this.stopping = null;
        if (this._kernel32.GetConsoleWindow().Val == 0) {
            if (this._kernel32.AllocConsole().Val == 0) {
                throw ('AllocConsole failed with: ' + this._kernel32.GetLastError().Val);
            }
        }
        
        this._stdinput = this._kernel32.GetStdHandle(STD_INPUT_HANDLE);
        this._stdoutput = this._kernel32.GetStdHandle(STD_OUTPUT_HANDLE);
        this._connected = false;

        // Coord structure can be found at: https://learn.microsoft.com/en-us/windows/console/coord-str
        var coordScreen = GM.CreateVariable(4); 
        coordScreen.Deref(0, 2).toBuffer().writeUInt16LE(CONSOLE_SCREEN_WIDTH);
        coordScreen.Deref(2, 2).toBuffer().writeUInt16LE(CONSOLE_SCREEN_HEIGHT);
        
        var rect = GM.CreateVariable(8);
        rect.Deref(4, 2).toBuffer().writeUInt16LE(CONSOLE_SCREEN_WIDTH - 1);
        rect.Deref(6, 2).toBuffer().writeUInt16LE(CONSOLE_SCREEN_HEIGHT - 1);
        
        // 
        // Reference for SetConsoleWindowInfo can be found at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolewindowinfo
        //
        if (this._kernel32.SetConsoleWindowInfo(this._stdoutput, 1, rect).Val == 0)
        {
            throw ('Failed to set Console Screen Size');
        }

        //
        // Reference for SetConsoleScreenBufferSize can be found at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolescreenbuffersize
        //
        if (this._kernel32.SetConsoleScreenBufferSize(this._stdoutput, coordScreen.Deref(0, 4).toBuffer().readUInt32LE()).Val == 0)
        {
            throw ('Failed to set Console Buffer Size');
        }

        // Hide the console window
        this._user32.ShowWindow(this._kernel32.GetConsoleWindow().Val, SW_HIDE);

        this.ClearScreen();
        this._hookThread(terminalTarget).then(function ()
        {
            // Hook Ready
            this.terminal.StartCommand(this.userArgs[0]);
        }, console.log);
        this._stream = new duplex(
            {
                'write': function (chunk, flush)
                {
                    if (!this.terminal.connected)
                    {
                        //console.log('_write: ' + chunk);
                        if (!this._promise.chunk)
                        {
                            this._promise.chunk = [];
                        }
                        if (typeof (chunk) == 'string')
                        {
                            this._promise.chunk.push(chunk);
                        } else
                        {
                            this._promise.chunk.push(Buffer.alloc(chunk.length));
                            chunk.copy(this._promise.chunk.peek());
                        }
                        this._promise.chunk.peek().flush = flush;
                        this._promise.then(function ()
                        {
                            var buf;
                            while (this.chunk.length > 0)
                            {
                                buf = this.chunk.shift();
                                this.terminal._WriteBuffer(buf);
                                buf.flush();
                            }
                        });
                    }
                    else
                    {
                        //console.log('writeNOW: ' + chunk);
                        this.terminal._WriteBuffer(chunk);
                        flush();
                    }
                    return (true);
                },
                'final': function (flush)
                {
                    var p = this.terminal._stop();
                    p.__flush = flush;
                    p.then(function () { this.__flush(); });
                }
            });
        this._stream.terminal = this;
        this._stream._promise = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        this._stream._promise.terminal = this;
        this._stream.prependOnceListener('end', function ()
        {
            this.terminal._stream = null;
        });
        return (this._stream);
    };
    this.Start = function Start(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT)
    {
        return (this.StartEx(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, process.env['windir'] + '\\System32\\cmd.exe'));
    }
    this.StartPowerShell = function StartPowerShell(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT)
    {
        if (require('os').arch() == 'x64')
        {
            if (require('fs').existsSync(process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
            {
                return (this.StartEx(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'));
            }
            else
            {
                return (this.StartEx(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, process.env['windir'] + '\\SysWow64\\WindowsPowerShell\\v1.0\\powershell.exe'));
            }
        }
        else
        {
            return (this.StartEx(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'));
        }
    }

    this._stop = function () {
        if (this.stopping) { return (this.stopping); }
        //console.log('Stopping Terminal...');
        this._ConsoleWinEventProc.removeAllListeners('GlobalCallback');
        this.stopping = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        
        var threadID = this._kernel32.GetThreadId(this._user32.SetWinEventHook.async.thread()).Val;
        this._user32.PostThreadMessageA(threadID, WM_QUIT, 0, 0);
        this._stream.emit('end');
        return (this.stopping);
    }
    
    //
    // This function uses the SetWinEventHook() method, so we can hook 
    // All events between EVENT_CONSOLE_CARET and EVENT_CONSOLE_END_APPLICATION
    //
    this._hookThread = function ()
    {
        // 
        // Reference for SetWinEventHook() can be found at:
        // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook
        //
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret.userArgs = [];
        for (var a in arguments)
        {
            ret.userArgs.push(arguments[a]);
        }
        ret.terminal = this;
        this._ConsoleWinEventProc = GM.GetGenericGlobalCallback(7);
        this._ConsoleWinEventProc.terminal = this;
        var p = this._user32.SetWinEventHook.async(EVENT_CONSOLE_CARET, EVENT_CONSOLE_END_APPLICATION, 0, this._ConsoleWinEventProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        p.ready = ret;
        p.terminal = this;
        p.then(function (hwinEventHook)
        {
            if (hwinEventHook.Val == 0)
            {
                this.ready._rej('Error calling SetWinEventHook');
            } else
            {
                this.terminal.hwinEventHook = hwinEventHook;
                this.ready._res();
                this.terminal._GetMessage();
            }
        });

        //
        // This is the WINEVENTPROC callback for the WinEventHook we set
        //
        this._ConsoleWinEventProc.on('GlobalCallback', function (hhook, dwEvent, hwnd, idObject, idChild, idEventThread, swmsEventTime)
        {
            //
            // Reference for WINEVENTPROC can be found at:
            // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-wineventproc
            //
            if (!this.terminal.hwinEventHook || this.terminal.hwinEventHook.Val != hhook.Val) { return; }
            var buffer = null;
            
            //
            // Reference for Console WinEvents can be found at:
            // https://learn.microsoft.com/en-us/windows/console/console-winevents
            //

            switch (dwEvent.Val)
            {          
                case EVENT_CONSOLE_CARET:
                    // The console caret has moved
                    break;
                case EVENT_CONSOLE_UPDATE_REGION:
                    // More than one character has changed
                    if (!this.terminal.connected) {
                        this.terminal.connected = true;
                        this.terminal._stream._promise._res();
                    }
                    if (this.terminal._scrollTimer == null) {
                        buffer = this.terminal._GetScreenBuffer(LOWORD(idObject.Val), HIWORD(idObject.Val), LOWORD(idChild.Val), HIWORD(idChild.Val));
                        //console.log('UPDATE REGION: [Left: ' + LOWORD(idObject.Val) + ' Top: ' +  HIWORD(idObject.Val) + ' Right: ' + LOWORD(idChild.Val) + ' Bottom: ' + HIWORD(idChild.Val) + ']');
                        this.terminal._SendDataBuffer(buffer);
                    }
                    break;
                case EVENT_CONSOLE_UPDATE_SIMPLE:
                    // A single character has changed
                    //console.log('UPDATE SIMPLE: [X: ' + LOWORD(idObject.Val) + ' Y: ' + HIWORD(idObject.Val) + ' Char: ' + LOWORD(idChild.Val) + ' Attr: ' + HIWORD(idChild.Val) + ']');
                    var simplebuffer = { data: [ Buffer.alloc(1, LOWORD(idChild.Val)) ], attributes: [ HIWORD(idChild.Val) ], width: 1, height: 1, x: LOWORD(idObject.Val), y: HIWORD(idObject.Val) };
                    this.terminal._SendDataBuffer(simplebuffer);
                    break;
                case EVENT_CONSOLE_UPDATE_SCROLL:
                    // The console has scrolled
                    //console.log('UPDATE SCROLL: [dx: ' + idObject.Val + ' dy: ' + idChild.Val + ']');
                    this.terminal._SendScroll(idObject.Val, idChild.Val);
                    break;
                case EVENT_CONSOLE_LAYOUT:
                    // The console layout has changed.
                    //console.log('CONSOLE_LAYOUT');
                    //snprintf( Buf, 512, "Event Console LAYOUT!\r\n");
                    //SendLayout();
                    break;
                case EVENT_CONSOLE_START_APPLICATION:
                    // A new console process has started
                    //console.log('START APPLICATION: [PID: ' + idObject.Val + ' CID: ' + idChild.Val + ']');
                    //snprintf( Buf, 512, "Event Console START APPLICATION!\r\nProcess ID: %d  -  Child ID: %d\r\n\r\n", (int)idObject, (int)idChild);
                    //SendConsoleEvent(dwEvent, idObject, idChild);
                    break;
                case EVENT_CONSOLE_END_APPLICATION:
                    // A console process has exited
                    if (idObject.Val == this.terminal._hProcessID)
                    {
                        //console.log('END APPLICATION: [PID: ' + idObject.Val + ' CID: ' + idChild.Val + ']');
                        this.terminal._hProcess = null;
                        this.terminal._stop().then(function () { console.log('STOPPED'); });
                    }
                    break;
                default:
                    //snprintf(Buf, 512, "unknown console event.\r\n");
                    console.log('Unknown event: ' + dwEvent.Val);
                    break;
            }

            //mbstowcs_s(&l, wBuf, Buf, 512);
            //OutputDebugString(wBuf);

        });
        return (ret);
    }
    
    // Retrieves a message from the calling thread's message queue
    this._GetMessage = function ()
    {
        //
        // Reference for GetMessage() can be found at:
        // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmessage
        //

        //
        // Reference for TranslateMessage() can be found at:
        // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-translatemessage
        //

        //
        // Reference for DispatchMessage() can be found at:
        // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-dispatchmessage
        //

        if (this._user32.abort) { console.log('aborting loop'); return; }
        this._user32.GetMessageA.async(this._user32.SetWinEventHook.async, MSG, 0, 0, 0).then(function (ret)
        {
            //console.log('GetMessage Response');
            if (ret.Val != 0)
            {
                if (ret.Val == -1)
                {
                    // handle the error and possibly exit
                }
                else
                {
                    // Translates virtual-key messages into character messages
                    //console.log('TranslateMessage');
                    this.nativeProxy._user32.TranslateMessage.async(this.nativeProxy.user32.SetWinEventHook.async, MSG).then(function ()
                    {
                        // Dispatches a message to a window procedure
                        //console.log('DispatchMessage');
                        this.nativeProxy._user32.DispatchMessageA.async(this.nativeProxy.user32.SetWinEventHook.async, MSG).then(function ()
                        {
                            this.nativeProxy.terminal._GetMessage();
                        }, console.log);
                    }, console.log);
                }
            } else
            {
                this.nativeProxy.UnhookWinEvent.async(this.nativeProxy.terminal._user32.SetWinEventHook.async, this.nativeProxy.terminal.hwinEventHook)
                    .then(function ()
                    {
                        if (this.nativeProxy.terminal._hProcess == null) { return; }

                        this.nativeProxy.terminal.stopping._res();
                        if (this.nativeProxy.terminal._kernel32.TerminateProcess(this.nativeProxy.terminal._hProcess, 1067).Val == 0)
                        {
                            var e = this.nativeProxy.terminal._kernel32.GetLastError().Val;
                            console.log('Unable to kill Terminal Process, error: ' + e);
                        }
                        this.nativeProxy.terminal.stopping = null;
                    }, function (err)
                    {
                        console.log('REJECTED_UnhookWinEvent: ' + err);
                    });
            }
        }, function (err)
        {
            // Get Message Failed
            console.log('REJECTED_GETMessage: ' + err);
        });
    }

    this._WriteBuffer = function (buf)
    {
        for (var i = 0; i < buf.length; ++i)
        {
            if (typeof (buf) == 'string')
            {
                this._WriteCharacter(buf.charCodeAt(i), false);
            } else
            {
                this._WriteCharacter(buf[i], false);
            }
        }
    }
    this._WriteCharacter = function (key, bControlKey)
    {
        //
        // Reference for WriteConsoleInput() can be found at:
        // https://learn.microsoft.com/en-us/windows/console/writeconsoleinput
        //

        //
        // Reference for INPUT_RECORD can be found at:
        // https://learn.microsoft.com/en-us/windows/console/input-record-str
        //

        var rec = GM.CreateVariable(20);
        rec.Deref(0, 2).toBuffer().writeUInt16LE(KEY_EVENT);                                // rec.EventType 
        rec.Deref(4, 4).toBuffer().writeUInt16LE(1);                                        // rec.Event.KeyEvent.bKeyDown
        rec.Deref(16, 4).toBuffer().writeUInt32LE(bControlKey);                             // rec.Event.KeyEvent.dwControlKeyState
        rec.Deref(14, 1).toBuffer()[0] = key;                                               // rec.Event.KeyEvent.uChar.AsciiChar
        rec.Deref(8, 2).toBuffer().writeUInt16LE(1);                                        // rec.Event.KeyEvent.wRepeatCount
        rec.Deref(10, 2).toBuffer().writeUInt16LE(this._user32.VkKeyScanA(key).Val);        // rec.Event.KeyEvent.wVirtualKeyCode
        rec.Deref(12, 2).toBuffer().writeUInt16LE(this._user32.MapVirtualKeyA(this._user32.VkKeyScanA(key).Val, MAPVK_VK_TO_VSC).Val);

        var dwWritten = GM.CreateVariable(4);
        if (this._kernel32.WriteConsoleInputA(this._stdinput, rec, 1, dwWritten).Val == 0) { return (false); }

        rec.Deref(4, 4).toBuffer().writeUInt16LE(0);                                         // rec.Event.KeyEvent.bKeyDown
        return (this._kernel32.WriteConsoleInputA(this._stdinput, rec, 1, dwWritten).Val != 0);
    }
    
    // Get the current visible screen buffer
    this._GetScreenBuffer = function (sx, sy, ex, ey)
    {
        //
        // Reference for GetConsoleScreenBufferInfo() can be found at:
        // https://learn.microsoft.com/en-us/windows/console/getconsolescreenbufferinfo
        //

        //
        // Reference for ReadConsoleOutput() can be found at:
        // https://learn.microsoft.com/en-us/windows/console/readconsoleoutput
        //

        var info = GM.CreateVariable(22);
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, info).Val == 0) { throw ('Error getting screen buffer info'); }

        var nWidth = info.Deref(14, 2).toBuffer().readUInt16LE() - info.Deref(10, 2).toBuffer().readUInt16LE() + 1;
        var nHeight = info.Deref(16, 2).toBuffer().readUInt16LE() - info.Deref(12, 2).toBuffer().readUInt16LE() + 1;

        if (arguments[3] == null)
        {
            // Use Default Parameters
            sx = 0;
            sy = 0;
            ex = nWidth - 1;
            ey = nHeight - 1;
        } else
        {
            if (this._scrx != 0) { sx += this._scrx; ex += this._scrx; }
            if (this._scry != 0) { sy += this._scry; ey += this._scry; }
            this._scrx = this._scry = 0;
        }

        var nBuffer = GM.CreateVariable((ex - sx + 1) * (ey - sy + 1) * 4);
        var size = GM.CreateVariable(4);
        size.Deref(0, 2).toBuffer().writeUInt16LE(ex - sx + 1, 0);
        size.Deref(2, 2).toBuffer().writeUInt16LE(ey - sy + 1, 0);

        var startCoord = GM.CreateVariable(4);
        startCoord.Deref(0, 2).toBuffer().writeUInt16LE(0, 0);
        startCoord.Deref(2, 2).toBuffer().writeUInt16LE(0, 0);

        var region = GM.CreateVariable(8);
        region.buffer = region.toBuffer();
        region.buffer.writeUInt16LE(sx, 0);
        region.buffer.writeUInt16LE(sy, 2);
        region.buffer.writeUInt16LE(ex, 4);
        region.buffer.writeUInt16LE(ey, 6);

        if (this._kernel32.ReadConsoleOutputA(this._stdoutput, nBuffer, size.Deref(0, 4).toBuffer().readUInt32LE(), startCoord.Deref(0, 4).toBuffer().readUInt32LE(), region).Val == 0)
        {
            throw ('Unable to read Console Output');
        }

        // Lets convert the buffer into something simpler
        //var retVal = { data: Buffer.alloc((dw - dx + 1) * (dh - dy + 1)), attributes: Buffer.alloc((dw - dx + 1) * (dh - dy + 1)), width: dw - dx + 1, height: dh - dy + 1, x: dx, y: dy };

        var retVal = { data: [], attributes: [], width: ex - sx + 1, height: ey - sy + 1, x: sx, y: sy };
        var x, y, line, ifo, tmp, lineWidth = ex - sx + 1;

        for (y = 0; y <= (ey - sy) ; ++y)
        {
            retVal.data.push(Buffer.alloc(lineWidth));
            retVal.attributes.push(Buffer.alloc(lineWidth));

            line = nBuffer.Deref(y * lineWidth * 4, lineWidth * 4).toBuffer();
            for (x = 0; x < lineWidth; ++x)
            {
                retVal.data.peek()[x] = line[x * 4];
                retVal.attributes.peek()[x] = line[2 + (x * 4)];
            }
        }

        return (retVal);
    }
    
    this._SendDataBuffer = function (data)
    {
        // { data, attributes, width, height, x, y }
        if (this._stream != null)
        {
            var dy, line, attr;
            for (dy = 0; dy < data.height; ++dy)
            {
                line = data.data[dy];
                attr = data.attributes[dy];
                line.s = line.toString();

                //line = data.data.slice(data.width * dy, (data.width * dy) + data.width);
                //attr = data.attributes.slice(data.width * dy, (data.width * dy) + data.width);
                this._stream.push(TranslateLine(data.x + 1, data.y + dy + 1, line, attr));
            }
        }
    }

    this._SendScroll = function _SendScroll(dx, dy)
    {
        //
        // Reference for GetConsoleScreenBufferInfo() can be found at:
        // https://learn.microsoft.com/en-us/windows/console/getconsolescreenbufferinfo
        //

        if (this._scrollTimer || this._stream == null) { return; }
        
        var info = GM.CreateVariable(22);
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, info).Val == 0) { throw ('Error getting screen buffer info'); }
        
        var nWidth = info.Deref(14, 2).toBuffer().readUInt16LE() - info.Deref(10, 2).toBuffer().readUInt16LE() + 1;
        var nHeight = info.Deref(16, 2).toBuffer().readUInt16LE() - info.Deref(12, 2).toBuffer().readUInt16LE() + 1;
        
        this._stream.push(GetEsc('H', [nHeight - 1, 0]));
        for (var i = 0; i > nHeight; ++i) { this._stream.push(Buffer.from('\r\n')); }
        
        var buffer = this._GetScreenBuffer(0, 0, nWidth - 1, nHeight - 1);
        this._SendDataBuffer(buffer);
        
        this._scrollTimer = setTimeout(function (self, nw, nh) {
            var buffer = self._GetScreenBuffer(0, 0, nw - 1, nh - 1);
            self._SendDataBuffer(buffer);
            self._scrollTimer = null;
        }, 250, this, nWidth, nHeight);
    }
    
    this.StartCommand = function StartCommand(target) {
        if (this._kernel32.CreateProcessA(GM.CreateVariable(target), 0, 0, 0, 1, CREATE_NEW_PROCESS_GROUP, 0, 0, si, pi).Val == 0)
        {
            console.log('Error Spawning CMD');
            return;
        }
        
        this._kernel32.CloseHandle(pi.Deref(GM.PointerSize, GM.PointerSize).Deref());           // pi.hThread
        this._hProcess = pi.Deref(0, GM.PointerSize).Deref();                                   // pi.hProcess
        this._hProcessID = pi.Deref(GM.PointerSize == 4 ? 8 : 16, 4).toBuffer().readUInt32LE(); // pi.dwProcessId
        //console.log('Ready => hProcess: ' + this._hProcess._ptr + ' PID: ' + this._hProcessID);
    }
}

function LOWORD(val) { return (val & 0xFFFF); }
function HIWORD(val) { return ((val >> 16) & 0xFFFF); }
function GetEsc(op, args) { return (Buffer.from('\x1B[' + args.join(';') + op)); }
function MeshConsole(msg) { require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": JSON.stringify(msg) }); }
function TranslateLine(x, y, data, attributes)
{
    var i, fcolor, bcolor, rcolor, fbright, bbright, lastAttr, fc, bc, rc, fb, bb, esc = [], output = [GetEsc('H', [y, x])];
    if (typeof attributes == 'number') { attributes = [attributes]; } // If we get a single attribute, turn it into an array.

    for (i = 0; i < data.length; i++)
    {
        if (lastAttr != attributes[i])
        { // To boost performance, if the attribute is the same as the last one, skip this entire part.
            fc = (attributes[i] & 0x0007);
            fc = ((fc & 0x0001) << 2) + (fc & 0x0002) + ((fc & 0x0004) >> 2); // Foreground color
            bc = (attributes[i] & 0x0070) >> 4;
            bc = ((bc & 0x0001) << 2) + (bc & 0x0002) + ((bc & 0x0004) >> 2); // Background color
            rc = (attributes[i] & 0x4000); // Reverse color set
            fb = (attributes[i] & 0x0008) >> 3; // Bright foreground set
            bb = (attributes[i] & 0x0080); // Bright background set

            if (rc != rcolor) { if (rc != 0) { esc.push(7); } else { esc.push(0); fcolor = 7; bcolor = 0; fbright = 0; bbright = 0; } rcolor = rc; } // Reverse Color
            if (fc != fcolor) { esc.push(fc + 30); fcolor = fc; } // Set the foreground color if needed
            if (bc != bcolor) { esc.push(bc + 40); bcolor = bc; } // Set the background color if needed
            if (fb != fbright) { esc.push(2 - fb); fbright = fb; } // Set the bright foreground color if needed
            if (bb != bbright) { if (bb == 0) { esc.push(bcolor + 40); } else { esc.push(bcolor + 100); bbright = bb; } } // Set bright Background color if needed

            if (esc.length > 0) { output.push(GetEsc('m', esc)); esc = []; }
            lastAttr = attributes[i];
        }
        output.push(Buffer.from(String.fromCharCode(data[i])));
    }

    return Buffer.concat(output);
}

module.exports = new windows_terminal();