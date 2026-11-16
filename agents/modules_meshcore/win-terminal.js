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
var CTRL_C_EVENT = 0;
var EVENT_CONSOLE_UPDATE_REGION = 0x4002;
var EVENT_CONSOLE_UPDATE_SIMPLE = 0x4003;
var EVENT_CONSOLE_UPDATE_SCROLL = 0x4004;
var EVENT_CONSOLE_LAYOUT = 0x4005;
var EVENT_CONSOLE_START_APPLICATION = 0x4006;
var KEY_EVENT = 0x1;
var MAPVK_VK_TO_VSC = 0;
var WM_QUIT = 0x12;

var GM = require('_GenericMarshal');
var CONSOLE_BUFFER_HEIGHT = 9001;   // Lines of console buffer, see _SetConsoleSize(). Same as the Windows 10 console default.
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
    this._kernel32.CreateMethod('GenerateConsoleCtrlEvent');
    this._kernel32.CreateMethod('GetLargestConsoleWindowSize');
    this._kernel32.CreateMethod('SetConsoleCtrlHandler');
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

    //
    // Set the console window to exactly width x height, so the console matches the remote terminal.
    // The remote terminal is drawn by sending whole console lines to absolute positions, so if the console was wider than
    // the remote terminal, lines would wrap there, the bottom line wrap would scroll the remote terminal and everything
    // drawn after that would be off by one or more lines. The size is limited to the largest console Windows allows.
    // The console buffer is CONSOLE_BUFFER_HEIGHT lines tall, so lines that scroll out of the window are kept and can be
    // sent to the remote terminal's scroll back even when they scrolled by faster than we read the console.
    // Returns the size that was set as { width, height }.
    //
    this._SetConsoleSize = function _SetConsoleSize(width, height)
    {
        width = parseInt(width); height = parseInt(height);
        if (!(width > 0)) { width = 80; }
        if (!(height > 0)) { height = 25; }
        if (width < 20) { width = 20; }
        if (height < 5) { height = 5; }

        // Reference for GetLargestConsoleWindowSize can be found at:
        // https://learn.microsoft.com/en-us/windows/console/getlargestconsolewindowsize
        var largest = this._kernel32.GetLargestConsoleWindowSize(this._stdoutput).Val; // COORD returned as a DWORD, X in the low word
        var maxWidth = largest & 0xFFFF, maxHeight = (largest >> 16) & 0xFFFF;
        if ((maxWidth > 0) && (width > maxWidth)) { width = maxWidth; }
        if ((maxHeight > 0) && (height > maxHeight)) { height = maxHeight; }

        // The window must always fit inside the buffer, so first grow the buffer if needed, then set the window, then set
        // the buffer to its final size.
        var info = GM.CreateVariable(22);
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, info).Val == 0) { throw ('Error getting screen buffer info'); }
        var b = info.toBuffer();
        var curWidth = b.readUInt16LE(0), curHeight = b.readUInt16LE(2), cursorY = b.readUInt16LE(6), curTop = b.readInt16LE(12);
        var bufHeight = Math.max(CONSOLE_BUFFER_HEIGHT, height);

        var coord = GM.CreateVariable(4);
        coord.Deref(0, 2).toBuffer().writeUInt16LE(Math.max(curWidth, width));
        coord.Deref(2, 2).toBuffer().writeUInt16LE(Math.max(curHeight, bufHeight));
        if (this._kernel32.SetConsoleScreenBufferSize(this._stdoutput, coord.Deref(0, 4).toBuffer().readUInt32LE()).Val == 0)
        {
            throw ('Failed to set Console Buffer Size');
        }

        // Keep the window where it is, but with the cursor in view and inside the final buffer
        var top = curTop;
        if (cursorY > top + height - 1) { top = cursorY - height + 1; }
        if (cursorY < top) { top = cursorY; }
        top = Math.max(0, Math.min(top, bufHeight - height));

        // Reference for SetConsoleWindowInfo can be found at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolewindowinfo
        var rect = GM.CreateVariable(8);
        rect.Deref(0, 2).toBuffer().writeUInt16LE(0);
        rect.Deref(2, 2).toBuffer().writeUInt16LE(top);
        rect.Deref(4, 2).toBuffer().writeUInt16LE(width - 1);
        rect.Deref(6, 2).toBuffer().writeUInt16LE(top + height - 1);
        if (this._kernel32.SetConsoleWindowInfo(this._stdoutput, 1, rect).Val == 0)
        {
            throw ('Failed to set Console Screen Size');
        }

        // Reference for SetConsoleScreenBufferSize can be found at:
        // https://learn.microsoft.com/en-us/windows/console/setconsolescreenbuffersize
        coord.Deref(0, 2).toBuffer().writeUInt16LE(width);
        coord.Deref(2, 2).toBuffer().writeUInt16LE(bufHeight);
        if (this._kernel32.SetConsoleScreenBufferSize(this._stdoutput, coord.Deref(0, 4).toBuffer().readUInt32LE()).Val == 0)
        {
            throw ('Failed to set Console Buffer Size');
        }
        return ({ width: width, height: height });
    }

    //
    // Screen synchronization
    //
    // The console WinEvents only say that something changed, the console is read later, and some Windows versions
    // (for example Server 2016) do not reliably send the scroll events. So instead of drawing each event, every event
    // (and a periodic poll) schedules a sync: read the whole visible console, work out how many lines it scrolled since
    // the last sync by comparing with what the remote terminal has, scroll the remote terminal by that many lines (so the
    // lines leaving the top go into its scroll back) and redraw only the lines that are different.
    //

    // Redraw everything on the next sync, for example after a resize
    this._Redraw = function _Redraw()
    {
        this._screen = null;
        this._Sync();
    }

    // Schedule a sync soon, many events in a burst only cause one sync
    this._ScheduleSync = function _ScheduleSync()
    {
        if (this._syncTimer != null) { return; }
        this._syncTimer = setTimeout(function (self) { self._syncTimer = null; try { self._Sync(); } catch (ex) { } }, 15, this);
    }

    // Read 'count' console rows, starting at buffer row 'top', columns 'left' to 'left + width - 1'
    this._ReadRows = function _ReadRows(left, top, width, count)
    {
        var rows = [], chunk = Math.max(1, Math.floor(4000 / width)); // Keep each ReadConsoleOutput call small, it has a size limit
        for (var r = 0; r < count; r += chunk)
        {
            var n = Math.min(chunk, count - r);
            var buf = this._GetScreenBuffer(left, top + r, left + width - 1, top + r + n - 1);
            for (var i = 0; i < n; ++i)
            {
                var d = buf.data[i], a = buf.attributes[i];
                rows.push({ data: d, attr: a, key: d.toString('hex') + a.toString('hex'), blank: (d.toString().trim().length == 0) });
            }
        }
        return (rows);
    }

    // Returns by how many lines 'cur' is scrolled up compared to 'prev': the shift that makes the most non blank lines match
    this._DetectScroll = function _DetectScroll(prev, cur)
    {
        var H = cur.length, k, j, score, best = 0, bestScore = 0;
        for (k = 0; k < H; ++k)
        {
            score = 0;
            for (j = 0; j + k < H; ++j) { if (!cur[j].blank && (prev[j + k] != null) && (cur[j].key == prev[j + k].key)) { ++score; } }
            if (score > bestScore) { bestScore = score; best = k; }
        }
        return (best);
    }

    this._Sync = function _Sync()
    {
        if (this._stream == null) { return; }
        var info = GM.CreateVariable(22);
        if (this._kernel32.GetConsoleScreenBufferInfo(this._stdoutput, info).Val == 0) { return; }
        var b = info.toBuffer();
        var cx = b.readUInt16LE(4), cy = b.readUInt16LE(6);
        var left = b.readInt16LE(10), top = b.readInt16LE(12), right = b.readInt16LE(14), bottom = b.readInt16LE(16);
        var W = right - left + 1, H = bottom - top + 1, r, i;
        if ((W <= 0) || (H <= 0)) { return; }

        var cur, prev = this._screen, out = [];
        if ((prev == null) || (prev.length != H) || (this._screenWidth != W) || (top < this._screenTop))
        {
            // Full redraw (first time, resized, or the window moved up, for example after "cls")
            cur = this._ReadRows(left, top, W, H);
            out.push(Buffer.from('\x1B[0m\x1B[2J'));
            for (r = 0; r < H; ++r) { out.push(TranslateLine(1, r + 1, cur[r].data, cur[r].attr)); }
        }
        else if (top > this._screenTop)
        {
            // The console window moved down its buffer by d lines since the last sync. The buffer still has every line,
            // so read from the top of what the remote terminal shows down to the bottom of the window: first correct the
            // lines the remote terminal shows, then scroll it one line at a time, drawing each new line at the bottom.
            // Every line ends up in the remote terminal's scroll back, even if it was only in the window very briefly.
            var d = top - this._screenTop;
            var rows = this._ReadRows(left, this._screenTop, W, d + H);
            for (r = 0; r < H; ++r)
            {
                if (rows[r].key != prev[r].key) { out.push(TranslateLine(1, r + 1, rows[r].data, rows[r].attr)); }
            }
            out.push(Buffer.from('\x1B[0m'), GetEsc('r', [1, H]));
            for (i = 0; i < d; ++i)
            {
                out.push(GetEsc('H', [H, 1]), Buffer.from('\x1B[0m\n'), TranslateLine(1, H, rows[H + i].data, rows[H + i].attr));
            }
            cur = rows.slice(d, d + H);
        }
        else
        {
            // Same window position, but the content may still have scrolled (when the buffer is full, the console scrolls
            // the whole buffer instead of moving the window), so detect that by comparing the lines
            cur = this._ReadRows(left, top, W, H);
            var k = this._DetectScroll(prev, cur);
            if (k > 0)
            {
                // Scroll the remote terminal up by k lines. The scrolling region is limited to the console height, as the
                // remote terminal can be taller than the console if the console size had to be limited.
                out.push(Buffer.from('\x1B[0m'), GetEsc('r', [1, H]), GetEsc('H', [H, 1]));
                for (i = 0; i < k; ++i) { out.push(Buffer.from('\n')); }
                prev = prev.slice(k);
                while (prev.length < H) { prev.push(null); }
            }
            for (r = 0; r < H; ++r)
            {
                if ((prev[r] == null) || (prev[r].key != cur[r].key)) { out.push(TranslateLine(1, r + 1, cur[r].data, cur[r].attr)); }
            }
        }

        // Cursor position
        var ccx = cx - left, ccy = cy - top;
        if ((ccx >= 0) && (ccx < W) && (ccy >= 0) && (ccy < H) && ((out.length > 0) || (ccx != this._cursorX) || (ccy != this._cursorY)))
        {
            out.push(GetEsc('H', [ccy + 1, ccx + 1]));
            this._cursorX = ccx; this._cursorY = ccy;
        }

        this._screen = cur;
        this._screenWidth = W;
        this._screenTop = top;
        if (out.length > 0) { this._stream.push(Buffer.concat(out)); }
    }

    //
    // Keyboard input: the remote terminal sends special keys as VT escape sequences, these are turned into key presses
    // (they used to be typed as their characters, so for example the up arrow typed "[A").
    //
    var VK_BACK = 0x08, VK_ESCAPE = 0x1B, VK_PRIOR = 0x21, VK_NEXT = 0x22, VK_END = 0x23, VK_HOME = 0x24, VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28, VK_INSERT = 0x2D, VK_DELETE = 0x2E, VK_F1 = 0x70;
    var ENHANCED_KEY = 0x0100, SHIFT_PRESSED = 0x0010, LEFT_ALT_PRESSED = 0x0002, LEFT_CTRL_PRESSED = 0x0008;
    var vtFinalKeys = { 'A': VK_UP, 'B': VK_DOWN, 'C': VK_RIGHT, 'D': VK_LEFT, 'H': VK_HOME, 'F': VK_END, 'P': VK_F1, 'Q': VK_F1 + 1, 'R': VK_F1 + 2, 'S': VK_F1 + 3 };
    var vtTildeKeys = { 1: VK_HOME, 2: VK_INSERT, 3: VK_DELETE, 4: VK_END, 5: VK_PRIOR, 6: VK_NEXT, 7: VK_HOME, 8: VK_END, 15: VK_F1 + 4, 17: VK_F1 + 5, 18: VK_F1 + 6, 19: VK_F1 + 7, 20: VK_F1 + 8, 21: VK_F1 + 9, 23: VK_F1 + 10, 24: VK_F1 + 11 };

    // Write a key press of a virtual key, with an optional character and control key state
    this._WriteVirtualKey = function _WriteVirtualKey(vk, ch, controlState)
    {
        var rec = GM.CreateVariable(20);
        rec.Deref(0, 2).toBuffer().writeUInt16LE(KEY_EVENT);                                            // rec.EventType
        rec.Deref(4, 4).toBuffer().writeUInt32LE(1);                                                    // rec.Event.KeyEvent.bKeyDown
        rec.Deref(8, 2).toBuffer().writeUInt16LE(1);                                                    // rec.Event.KeyEvent.wRepeatCount
        rec.Deref(10, 2).toBuffer().writeUInt16LE(vk);                                                  // rec.Event.KeyEvent.wVirtualKeyCode
        rec.Deref(12, 2).toBuffer().writeUInt16LE(this._user32.MapVirtualKeyA(vk, MAPVK_VK_TO_VSC).Val); // rec.Event.KeyEvent.wVirtualScanCode
        rec.Deref(14, 1).toBuffer()[0] = ch;                                                            // rec.Event.KeyEvent.uChar.AsciiChar
        rec.Deref(16, 4).toBuffer().writeUInt32LE(controlState);                                        // rec.Event.KeyEvent.dwControlKeyState
        var dwWritten = GM.CreateVariable(4);
        if (this._kernel32.WriteConsoleInputA(this._stdinput, rec, 1, dwWritten).Val == 0) { return (false); }
        rec.Deref(4, 4).toBuffer().writeUInt32LE(0);                                                    // rec.Event.KeyEvent.bKeyDown
        return (this._kernel32.WriteConsoleInputA(this._stdinput, rec, 1, dwWritten).Val != 0);
    }

    // Handle a VT sequence "ESC <intro> <params> <final>", returns true if it was a known key
    this._WriteVtKey = function _WriteVtKey(intro, params, finalChar)
    {
        var p = params.split(';'), vk = null, state = 0;
        if (finalChar == '~') { vk = vtTildeKeys[parseInt(p[0])]; } else { vk = vtFinalKeys[finalChar]; }
        if (vk == null) { return (false); }
        var mod = parseInt(p[1]) - 1; // xterm modifier parameter: 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)
        if (mod > 0) { if (mod & 1) { state |= SHIFT_PRESSED; } if (mod & 2) { state |= LEFT_ALT_PRESSED; } if (mod & 4) { state |= LEFT_CTRL_PRESSED; } }
        if ((vk < VK_F1) || (vk > VK_F1 + 11)) { state |= ENHANCED_KEY; } // Arrows, home, end, insert, delete, page up/down are enhanced keys
        this._WriteVirtualKey(vk, 0, state);
        return (true);
    }

    // Starts a Legacy Windows Terminal Session
    this.StartEx = function Start(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT, terminalTarget)
    {
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

        // Make the console the same size as the remote terminal (used to always be 80x25, which garbled the remote
        // terminal as soon as it scrolled if it was not exactly 80x25)
        this._SetConsoleSize(CONSOLE_SCREEN_WIDTH, CONSOLE_SCREEN_HEIGHT);

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
        // Called when the remote terminal is resized: resize the console to match and redraw everything.
        // When running in a user session this is called through win-dispatcher's invoke('resizeTerminal', [cols, rows]).
        this._stream.resizeTerminal = function resizeTerminal(cols, rows)
        {
            try
            {
                this.terminal._SetConsoleSize(cols, rows);
                this.terminal._Redraw();
            }
            catch (ex) { }
        };
        this._stream._promise = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        this._stream._promise.terminal = this;
        this._stream.prependOnceListener('end', function ()
        {
            if (this.terminal._pollTimer != null) { clearInterval(this.terminal._pollTimer); this.terminal._pollTimer = null; }
            if (this.terminal._syncTimer != null) { clearTimeout(this.terminal._syncTimer); this.terminal._syncTimer = null; }
            this.terminal._screen = null;
            this.terminal._stream = null;
        });

        // Also sync periodically, in case console events are missed
        this._screen = null;
        var pollSelf = this;
        this._pollTimer = setInterval(function () { pollSelf._ScheduleSync(); }, 250);
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
                case EVENT_CONSOLE_CARET:           // The console caret has moved
                case EVENT_CONSOLE_UPDATE_REGION:   // More than one character has changed
                case EVENT_CONSOLE_UPDATE_SIMPLE:   // A single character has changed
                case EVENT_CONSOLE_UPDATE_SCROLL:   // The console has scrolled
                case EVENT_CONSOLE_LAYOUT:          // The console layout has changed
                    if ((dwEvent.Val != EVENT_CONSOLE_CARET) && !this.terminal.connected && (this.terminal._stream != null)) {
                        // The console is drawing, so it is ready for input
                        this.terminal.connected = true;
                        this.terminal._stream._promise._res();
                    }
                    // The screen is read and sent by _Sync(), see above
                    this.terminal._ScheduleSync();
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
        var c = [], i, j, n;
        for (i = 0; i < buf.length; ++i) { c.push((typeof (buf) == 'string') ? buf.charCodeAt(i) : buf[i]); }
        n = c.length;
        for (i = 0; i < n; ++i)
        {
            if ((c[i] == 0x1B) && (i + 2 < n) && ((c[i + 1] == 0x5B) || (c[i + 1] == 0x4F)))
            {
                // VT sequence: ESC '[' or ESC 'O', parameters (digits and ';'), then a final character
                j = i + 2;
                var params = '';
                while ((j < n) && (c[j] >= 0x30) && (c[j] <= 0x3F)) { params += String.fromCharCode(c[j]); ++j; }
                if (j < n)
                {
                    this._WriteVtKey(String.fromCharCode(c[i + 1]), params, String.fromCharCode(c[j])); // Unknown sequences are ignored
                    i = j;
                    continue;
                }
            }
            if (c[i] == 0x03)
            {
                // Ctrl+C: typing it into the console input does not interrupt anything, only real keyboard input is turned
                // into a Ctrl+C signal, so send the signal to the processes on the console. This process ignores it, see StartCommand().
                this._kernel32.GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0);
                continue;
            }
            if (c[i] == 0x1B) { this._WriteVirtualKey(VK_ESCAPE, 0x1B, 0); continue; }   // Escape key
            if (c[i] == 0x7F) { this._WriteVirtualKey(VK_BACK, 0x08, 0); continue; }     // The remote terminal sends DEL for backspace
            this._WriteCharacter(c[i], false);
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

        // Scrolling is now detected by _Sync() by comparing screens, this just schedules a sync
        this._ScheduleSync();
    }
    
    this.StartCommand = function StartCommand(target) {
        // The shell must handle Ctrl+C, so it is not started in a new process group (that disables Ctrl+C for it), and it
        // must not inherit "ignore Ctrl+C" from this process. Once it is started, this process ignores Ctrl+C, so the Ctrl+C
        // signals sent to the console (see _WriteBuffer) only reach the shell and the commands it runs.
        this._kernel32.SetConsoleCtrlHandler(0, 0);
        var ok = this._kernel32.CreateProcessA(GM.CreateVariable(target), 0, 0, 0, 1, 0, 0, 0, si, pi).Val;
        this._kernel32.SetConsoleCtrlHandler(0, 1);
        if (ok == 0)
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