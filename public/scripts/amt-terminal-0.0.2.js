/** 
* @description Remote Terminal
* @author Ylian Saint-Hilaire
* @version v0.0.2c
*/

// https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
// https://www.x.org/docs/xterm/ctlseqs.pdf

// Construct a MeshServer object
var CreateAmtRemoteTerminal = function (divid, options) {
    var obj = {};
    obj.DivId = divid;
    obj.DivElement = document.getElementById(divid);
    obj.protocol = 1; // SOL
    // ###BEGIN###{Terminal-Enumation-All}
    obj.terminalEmulation = 1;
    // ###END###{Terminal-Enumation-All}
    obj.fxEmulation = 0;
    obj.lineFeed = '\r\n';
    obj.debugmode = 0;

    obj.width = 80; // 80 or 100
    obj.height = 25; // 25 or 30
    obj.heightLock = 0;

    var _Terminal_CellHeight = 21;
    var _Terminal_CellWidth = 13;
    var _TermColors = ['000000', 'BB0000', '00BB00', 'BBBB00', '0000BB', 'BB00BB', '00BBBB', 'BBBBBB', '555555', 'FF5555', '55FF55', 'FFFF55', '5555FF', 'FF55FF', '55FFFF', 'FFFFFF'];
    var _TermCurrentReverse = 0;
    var _TermCurrentFColor = 7;
    var _TermCurrentBColor = 0;
    var _TermLineWrap = true;
    var _termx = 0;
    var _termy = 0;
    var _termsavex = 0;
    var _termsavey = 0;
    var _termstate = 0;
    var _escNumber = [];
    var _escNumberPtr = 0;
    var _escNumberMode = 0;
    var _scratt = [];
    var _tscreen = [];
    var _VTUNDERLINE = 1;
    var _VTREVERSE = 2;
    var _backSpaceErase = false;
    var _cursorVisible = true;
    var _scrollRegion;
    var _altKeypadMode = false;
    var scrollBackBuffer = [];
    obj.title = null;
    obj.onTitleChange = null;

    obj.Start = function () { }

    obj.Init = function (width, height) {
        obj.width = width ? width : 80;
        obj.height = height ? height : 25;
        for (var y = 0; y < obj.height; y++) {
            _tscreen[y] = [];
            _scratt[y] = [];
            for (var x = 0; x < obj.width; x++) { _tscreen[y][x] = ' '; _scratt[y][x] = (7 << 6); }
        }
        obj.TermInit();
        obj.TermDraw();
    }

    obj.xxStateChange = function (newstate) {
        if ((newstate == 3) && (options != null) && (options.xterm == true)) { obj.TermSendKeys('stty rows ' + obj.height + ' cols ' + obj.width + '\nclear\n'); }
    }

    obj.ProcessData = function (str) {
        if (obj.debugmode == 2) { console.log("TRecv(" + str.length + "): " + rstr2hex(str)); }
        // ###BEGIN###{Terminal-Enumation-UTF8}
        //str = decode_utf8(str);
        // ###END###{Terminal-Enumation-UTF8}
        // ###BEGIN###{Terminal-Enumation-All}
        if (obj.terminalEmulation == 0) { str = decode_utf8(str); }
        // ###END###{Terminal-Enumation-All}
        if (obj.capture != null) obj.capture += str; _ProcessVt100EscString(str); obj.TermDraw();
    }

    function _ProcessVt100EscString(str) { for (var i = 0; i < str.length; i++) _ProcessVt100EscChar(String.fromCharCode(str.charCodeAt(i)), str.charCodeAt(i)); }

    function _ProcessVt100EscChar(b, c) {
        switch (_termstate) {
            case 0: // Normal Term State
                switch (c) {
                    case 27: // ESC
                        _termstate = 1;
                        _escNumber = [];
                        _escNumberPtr = 0;
                        _escNumberMode = 0;
                        break;
                    default:
                        // Process a single char
                        _ProcessVt100Char(b);
                        break;
                }
                break;
            case 1:
                switch (b) {
                    case '[':
                        _termstate = 2;
                        break;
                    case '(':
                        _termstate = 4;
                        break;
                    case ')':
                        _termstate = 5;
                        break;
                    case ']':
                        _termstate = 6; // xterm strings
                        break;
                    case '=':
                        // Set alternate keypad mode
                        _altKeypadMode = true;
                        _termstate = 0;
                        break;
                    case '>':
                        // Set numeric keypad mode 
                        _altKeypadMode = false;
                        _termstate = 0;
                        break;
                    case '7':
                        // Save Cursor
                        _termsavex = _termx;
                        _termsavey = _termy;
                        _termstate = 0;
                        break;
                    case '8':
                        // Restore Cursor
                        _termx = _termsavex;
                        _termy = _termsavey;
                        _termstate = 0;
                        break;
                    case 'M':
                        // Scroll down one
                        var x = 1;
                        for (var y = _scrollRegion[1]; y >= _scrollRegion[0] + x; y--) {
                            for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = _tscreen[y - x][z]; _scratt[y][z] = _scratt[y - x][z]; }
                        }
                        for (var y = _scrollRegion[0] + x - 1; y > _scrollRegion[0] - 1; y--) {
                            for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = ' '; _scratt[y][z] = (7 << 6); }
                        }
                        _termstate = 0;
                        break;
                    default:
                        console.log('unknown terminal short code', b);
                        _termstate = 0;
                        break;
                }
                break;
            case 2:
                if (b >= '0' && b <= '9') {
                    // This is a number
                    if (!_escNumber[_escNumberPtr]) { _escNumber[_escNumberPtr] = (b - '0'); }
                    else { _escNumber[_escNumberPtr] = ((_escNumber[_escNumberPtr] * 10) + (b - '0')); }
                    break;
                } else if (b == ';') {
                    // New number
                    _escNumberPtr++;
                    break;
                } else if (b == '?') {
                    _escNumberMode = 1;
                    break;
                } else {
                    // Process Escape Sequence
                    if (!_escNumber[0]) _escNumber[0] = 0;
                    _ProcessEscapeHandler(b, _escNumber, _escNumberPtr + 1, _escNumberMode);
                    _termstate = 0;
                }
                break;
            case 4: // '(' Code
                _termstate = 0;
                break;
            case 5: // ')' Code
                _termstate = 0;
                break;
            case 6: // ']' Code, xterm
                const bx = b.charCodeAt(0);
                if (b == ';') {
                    _escNumberPtr++;
                } else if (bx == 7) {
                    _ProcessXTermHandler(_escNumber);
                    _termstate = 0;
                } else {
                    if (!_escNumber[_escNumberPtr]) { _escNumber[_escNumberPtr] = b; }
                    else { _escNumber[_escNumberPtr] += b; }
                }
                break;
        }
    }

    function _ProcessXTermHandler(_escNumber) {
        if (_escNumber.length == 0) return;
        var cmd = parseInt(_escNumber[0]);
        if ((cmd == 0 || cmd == 2) && (_escNumber.length > 1) && (_escNumber[1] != '?')) {
            if (obj.onTitleChange) { obj.onTitleChange(obj, obj.title = _escNumber[1]); }
        }
    }

    function _ProcessEscapeHandler(code, args, argslen, mode) {
        //console.log('process', code, args, mode);
        if (mode == 1) {
            switch (code) {
                case 'l': // Hide the cursor
                    if (args[0] == 25) { _cursorVisible = false; }
                    break;
                case 'h': // Show the cursor
                    if (args[0] == 25) { _cursorVisible = true; }
                    break;
            }
        } else if (mode == 0) {
            var i;
            switch (code) {
                case 'c': // ResetDevice
                    // Reset
                    obj.TermResetScreen();
                    break;
                case 'A': // Move cursor up n lines
                    if (argslen == 1) {
                        if (args[0] == 0) { _termy--; } else { _termy -= args[0]; }
                        if (_termy < 0) _termy = 0;
                    }
                    break;
                case 'B': // Move cursor down n lines
                    if (argslen == 1) {
                        if (args[0] == 0) { _termy++; } else { _termy += args[0]; }
                        if (_termy > obj.height) _termy = obj.height;
                    }
                    break;
                case 'C': // Move cursor right n lines
                    if (argslen == 1) {
                        if (args[0] == 0) { _termx++; } else { _termx += args[0]; }
                        if (_termx > obj.width) _termx = obj.width;
                    }
                    break;
                case 'D': // Move cursor left n lines
                    if (argslen == 1) {
                        if (args[0] == 0) { _termx--; } else { _termx -= args[0]; }
                        if (_termx < 0) _termx = 0;
                    }
                    break;
                case 'd': // Set cursor to line n
                    if (argslen == 1) {
                        _termy = args[0] - 1;
                        if (_termy > obj.height) _termy = obj.height;
                        if (_termy < 0) _termy = 0;
                    }
                    break;
                case 'G': // Set cursor to col n
                    if (argslen == 1) {
                        _termx = args[0] - 1;
                        if (_termx < 0) _termx = 0;
                        if (_termx > (obj.width - 1)) _termx = (obj.width - 1);
                    }
                    break;
                case 'P': // Delete X Character(s), default 1 char
                    var x = 1;
                    if (argslen == 1) { x = args[0]; }
                    for (i = _termx; i < obj.width - x; i++) { _tscreen[_termy][i] = _tscreen[_termy][i + x]; _scratt[_termy][i] = _scratt[_termy][i + x]; }
                    for (i = (obj.width - x); i < obj.width; i++) { _tscreen[_termy][i] = ' '; _scratt[_termy][i] = (7 << 6); }
                    break;
                case 'L': // Insert X Line(s), default 1 char
                    var linecount = 1;
                    if (argslen == 1) { linecount = args[0]; }
                    if (linecount == 0) { linecount = 1; }
                    for (y = _scrollRegion[1]; y >= _termy + linecount; y--) {
                        _tscreen[y] = _tscreen[y - linecount];
                        _scratt[y] = _scratt[y - linecount];
                    }
                    for (y = _termy; y < _termy + linecount; y++) {
                        _tscreen[y] = [];
                        _scratt[y] = [];
                        for (x = 0; x < obj.width; x++) { _tscreen[y][x] = ' '; _scratt[y][x] = (7 << 6); }
                    }
                    break;
                case 'J': // ClearScreen:
                    if (argslen == 1 && args[0] == 2) {
                        obj.TermClear((_TermCurrentBColor << 12) + (_TermCurrentFColor << 6)); // Erase entire screen
                        _termx = 0;
                        _termy = 0;
                        scrollBackBuffer = [];
                    }
                    else if (argslen == 0 || argslen == 1 && args[0] == 0) // Erase cursor down
                    {
                        _EraseCursorToEol();
                        for (i = _termy + 1; i < obj.height; i++) _EraseLine(i);
                    }
                    else if (argslen == 1 && args[0] == 1) // Erase cursor up
                    {
                        _EraseCursorToEol();
                        for (i = 0; i < _termy - 1; i++) _EraseLine(i);
                    }
                    break;
                case 'H': // MoveCursor:
                    if (argslen == 2) {
                        if (args[0] < 1) args[0] = 1;
                        if (args[1] < 1) args[1] = 1;
                        if (args[0] > obj.height) args[0] = obj.height;
                        if (args[1] > obj.width) args[1] = obj.width;
                        _termy = args[0] - 1;
                        _termx = args[1] - 1;
                    } else {
                        _termy = 0;
                        _termx = 0;
                    }
                    break;
                case 'm': // ScreenAttribs:
                    // Change attributes
                    for (i = 0; i < argslen; i++) {
                        if (!args[i] || args[i] == 0) {
                            // Reset Attributes
                            _TermCurrentBColor = 0;
                            _TermCurrentFColor = 7;
                            _TermCurrentReverse = 0;
                        }
                        else if (args[i] == 1) {
                            // Bright
                            if (_TermCurrentFColor < 8) _TermCurrentFColor += 8;
                        }
                        else if (args[i] == 2 || args[i] == 22) {
                            // Dim
                            if (_TermCurrentFColor >= 8) _TermCurrentFColor -= 8;
                        }
                        else if (args[i] == 7) {
                            // Set Reverse attribute true
                            _TermCurrentReverse = 2;
                        }
                        else if (args[i] == 27) {
                            // Set Reverse attribute false
                            _TermCurrentReverse = 0;
                        }
                        else if (args[i] >= 30 && args[i] <= 37) {
                            // Set Foreground Color
                            var bright = (_TermCurrentFColor >= 8);
                            _TermCurrentFColor = (args[i] - 30);
                            if (bright && _TermCurrentFColor <= 8) _TermCurrentFColor += 8;
                        }
                        else if (args[i] >= 40 && args[i] <= 47) {
                            // Set Background Color
                            _TermCurrentBColor = (args[i] - 40);
                        }
                        else if (args[i] >= 90 && args[i] <= 99) {
                            // Set Bright Foreground Color
                            _TermCurrentFColor = (args[i] - 82);
                        }
                        else if (args[i] >= 100 && args[i] <= 109) {
                            // Set Bright Background Color
                            _TermCurrentBColor = (args[i] - 92);
                        }
                    }
                    break;
                case 'K': // EraseLine:
                    if (argslen == 0 || (argslen == 1 && (!args[0] || args[0] == 0))) {
                        _EraseCursorToEol(); // Erase from the cursor to the end of the line
                    } else if (argslen == 1) {
                        if (args[0] == 1) { // Erase from the beginning of the line to the cursor
                            _EraseBolToCursor();
                        } else if (args[0] == 2) { // Erase the line with the cursor
                            _EraseLine(_termy);
                        }
                    }
                    break;
                case 'h': // EnableLineWrap:
                    _TermLineWrap = true;
                    break;
                case 'l': // DisableLineWrap:
                    _TermLineWrap = false;
                    break;
                case 'r': // Set the scroll region
                    if (argslen == 2) { _scrollRegion = [args[0] - 1, args[1] - 1]; }
                    if (_scrollRegion[0] < 0) { _scrollRegion[0] = 0; }
                    if (_scrollRegion[0] > (obj.height - 1)) { _scrollRegion[0] = (obj.height - 1); }
                    if (_scrollRegion[1] < 0) { _scrollRegion[1] = 0; }
                    if (_scrollRegion[1] > (obj.height - 1)) { _scrollRegion[1] = (obj.height - 1); }
                    if (_scrollRegion[0] > _scrollRegion[1]) { _scrollRegion[0] = _scrollRegion[1]; }
                    break;
                case 'S': // Scroll up the scroll region X lines, default 1
                    var x = 1;
                    if (argslen == 1) { x = args[0] }
                    for (var y = _scrollRegion[0]; y <= _scrollRegion[1] - x; y++) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = _tscreen[y + x][z]; _scratt[y][z] = _scratt[y + x][z]; }
                    }
                    for (var y = _scrollRegion[1] - x + 1; y < _scrollRegion[1]; y++) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = ' '; _scratt[y][z] = (7 << 6); }
                    }
                    break;
                case 'M': // Delete X lines, default 1
                    var x = 1;
                    if (argslen == 1) { x = args[0] }
                    for (var y = _termy; y <= _scrollRegion[1] - x; y++) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = _tscreen[y + x][z]; _scratt[y][z] = _scratt[y + x][z]; }
                    }
                    for (var y = _scrollRegion[1] - x + 1; y < _scrollRegion[1]; y++) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = ' '; _scratt[y][z] = (7 << 6); }
                    }
                    break;
                case 'T': // Scroll down the scroll region X lines, default 1
                    var x = 1;
                    if (argslen == 1) { x = args[0] }
                    for (var y = _scrollRegion[1]; y > _scrollRegion[0] + x; y--) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = _tscreen[y - x][z]; _scratt[y][z] = _scratt[y - x][z]; }
                    }
                    for (var y = _scrollRegion[0] + x; y > _scrollRegion[0]; y--) {
                        for (var z = 0; z < obj.width; z++) { _tscreen[y][z] = ' '; _scratt[y][z] = (7 << 6); }
                    }
                    break;
                case 'X': // Erase X characters, default 1 (untested)
                    var x = 1;
                    if (argslen == 1) { x = args[0] }
                    while ((x > 0) && (_termx > 0)) { _tscreen[_termy][_termx] = ' '; _termx--; x--; }
                    break;
                default:
                    //if (code != '@') alert(code);
                    console.log('unknown terminal code', code, args, mode);
                    break;
            }
        }
    }

    obj.ProcessVt100String = function (str) {
        for (var i = 0; i < str.length; i++) _ProcessVt100Char(String.fromCharCode(str.charCodeAt(i)));
    }

    // ###BEGIN###{Terminal-Enumation-All}
    var AsciiToUnicode = [
        0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
        0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
        0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
        0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
        0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00da,
        0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
        0x2593, 0x2592, 0x2591, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
        0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
        0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2568, 0x2558, 0x2552, 0x2553, 0x256b,
        0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258b, 0x2590, 0x2580,
        0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
        0x03c6, 0x03b8, 0x2126, 0x03b4, 0x221e, 0x00f8, 0x03b5, 0x220f,
        0x2261, 0x00b1, 0x2265, 0x2266, 0x2320, 0x2321, 0x00f7, 0x2248,
        0x00b0, 0x2022, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x220e, 0x00a0
    ];

    var AsciiToUnicodeIntel = [
        0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
        0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
        0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
        0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
        0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00da,
        0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ae, 0x00bb,
        0x2593, 0x2592, 0x2591, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
        0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
        0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2568, 0x2558, 0x2552, 0x2553, 0x256b,
        0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258b, 0x2590, 0x2580,
        0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
        0x03c6, 0x03b8, 0x2126, 0x03b4, 0x221e, 0x00f8, 0x03b5, 0x220f,
        0x2261, 0x00b1, 0x2265, 0x2266, 0x2320, 0x2321, 0x00f7, 0x2248,
        0x00b0, 0x2022, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x220e, 0x00a0
    ];
    // ###END###{Terminal-Enumation-All}

    // ###BEGIN###{Terminal-Enumation-ASCII}
    var AsciiToUnicode = [
        0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
        0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
        0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
        0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
        0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00da,
        0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
        0x2593, 0x2592, 0x2591, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
        0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
        0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2568, 0x2558, 0x2552, 0x2553, 0x256b,
        0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258b, 0x2590, 0x2580,
        0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
        0x03c6, 0x03b8, 0x2126, 0x03b4, 0x221e, 0x00f8, 0x03b5, 0x220f,
        0x2261, 0x00b1, 0x2265, 0x2266, 0x2320, 0x2321, 0x00f7, 0x2248,
        0x00b0, 0x2022, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x220e, 0x00a0
    ];
    // ###END###{Terminal-Enumation-ASCII}

    // ###BEGIN###{Terminal-Enumation-Intel}
    var AsciiToUnicodeIntel = [
        0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
        0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
        0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
        0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
        0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00da,
        0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ae, 0x00bb,
        0x2593, 0x2592, 0x2591, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
        0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
        0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2568, 0x2558, 0x2552, 0x2553, 0x256b,
        0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258b, 0x2590, 0x2580,
        0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
        0x03c6, 0x03b8, 0x2126, 0x03b4, 0x221e, 0x00f8, 0x03b5, 0x220f,
        0x2261, 0x00b1, 0x2265, 0x2266, 0x2320, 0x2321, 0x00f7, 0x2248,
        0x00b0, 0x2022, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x220e, 0x00a0
    ];
    // ###END###{Terminal-Enumation-Intel}

    function _ProcessVt100Char(c) {
        if (c == '\0' || c.charCodeAt() == 7) return; // Ignore null & bell
        var ch = c.charCodeAt();
        //console.log('_ProcessVt100Char', ch, c);

        // ###BEGIN###{Terminal-Enumation-All}
        // UTF8 Terminal
        if (obj.terminalEmulation == 1) {
            // ANSI - Extended ASCII emulation.
            if ((ch & 0x80) != 0) { c = String.fromCharCode(AsciiToUnicode[ch & 0x7F]); }
        } else if (obj.terminalEmulation == 2) {
            // ANSI - Intel Extended ASCII emulation.
            if ((ch & 0x80) != 0) { c = String.fromCharCode(AsciiToUnicodeIntel[ch & 0x7F]); }
        }
        // ###END###{Terminal-Enumation-All}

        // ###BEGIN###{Terminal-Enumation-ASCII}
        // ANSI - Extended ASCII emulation.
        //if ((ch & 0x80) != 0) { c = String.fromCharCode(AsciiToUnicode[ch & 0x7F]); }
        // ###END###{Terminal-Enumation-ASCII}

        // ###BEGIN###{Terminal-Enumation-Intel}
        // ANSI - Intel Extended ASCII emulation.
        //if ((ch & 0x80) != 0) { c = String.fromCharCode(AsciiToUnicodeIntel[ch & 0x7F]); }
        // ###END###{Terminal-Enumation-Intel}

        //if (ch < 32 && ch != 10 && ch != 13) alert(ch);
        switch (ch) {
            case 16: { c = ' '; break; } // This is an odd char that show up on Intel BIOS's.
            case 24: { c = '↑'; break; }
            case 25: { c = '↓'; break; }
        }

        if (_termx > obj.width) _termx = obj.width;
        if (_termy > (obj.height - 1)) _termy = (obj.height - 1);

        switch (c) {
            case '\b': // Backspace
                if (_termx > 0) {
                    _termx--;
                    if (_backSpaceErase) { _TermDrawChar(' '); }
                }
                break;
            case '\t': // tab
                var tab = 8 - (_termx % 8)
                for (var x = 0; x < tab; x++) _ProcessVt100Char(" ");
                break;
            case '\n': // Linefeed
                _termy++;
                if (_termy > _scrollRegion[1]) {
                    // Move everything up one line
                    obj.recordLineTobackBuffer(0);
                    _TermMoveUp(1);
                    _termy = _scrollRegion[1];
                }
                if (obj.lineFeed = '\r') { _termx = 0; } // *** If we are in Linux mode, \n will also return the cursor to the first col
                break;
            case '\r': // Carriage Return
                _termx = 0;
                break;
            default:
                if (_termx >= obj.width) {
                    _termx = 0;
                    if (_TermLineWrap) { _termy++; }
                    if (_termy >= (obj.height - 1)) { _TermMoveUp(1); _termy = (obj.height - 1); }
                }
                _TermDrawChar(c);
                _termx++;
                break;
        }
    }

    function _TermDrawChar(c) {
        _tscreen[_termy][_termx] = c;
        _scratt[_termy][_termx] = (_TermCurrentFColor << 6) + (_TermCurrentBColor << 12) + _TermCurrentReverse;
    }

    obj.TermClear = function(TermColor) {
        for (var y = 0; y < obj.height; y++) {
            for (var x = 0; x < obj.width; x++) {
                _tscreen[y][x] = ' ';
                _scratt[y][x] = TermColor;
            }
        }
        scrollBackBuffer = [];
    }

    obj.TermResetScreen = function () {
        _TermCurrentReverse = 0;
        _TermCurrentFColor = 7;
        _TermCurrentBColor = 0;
        _TermLineWrap = _cursorVisible = true;
        _termx = _termy = 0;
        _backSpaceErase = false;
        _scrollRegion = [0, (obj.height - 1)];
        _altKeypadMode = false;
        obj.TermClear(7 << 6);
    }

    function _EraseCursorToEol() {
        var t = (_TermCurrentFColor << 6) + (_TermCurrentBColor << 12) + _TermCurrentReverse;
        for (var x = _termx; x < obj.width; x++) {
            _tscreen[_termy][x] = ' ';
            _scratt[_termy][x] = t;
        }
    }

    function _EraseBolToCursor() {
        var t = (_TermCurrentFColor << 6) + (_TermCurrentBColor << 12) + _TermCurrentReverse;
        for (var x = 0; x < _termx; x++) {
            _tscreen[_termy][x] = ' ';
            _scratt[_termy][x] = t;
        }
    }

    function _EraseLine(line) {
        var t = (_TermCurrentFColor << 6) + (_TermCurrentBColor << 12) + _TermCurrentReverse;
        for (var x = 0; x < obj.width; x++) {
            _tscreen[line][x] = ' ';
            _scratt[line][x] = t;
        }
    }

    obj.TermSendKeys = function (keys) { if (obj.debugmode == 2) { console.log("TSend(" + keys.length + "): " + rstr2hex(keys), keys); } obj.parent.send(keys); }
    obj.TermSendKey = function (key) { if (obj.debugmode == 2) { console.log("TSend(1): " + rstr2hex(String.fromCharCode(key)), key); } obj.parent.send(String.fromCharCode(key)); }

    function _TermMoveUp(linecount) {
        var x, y;
        for (y = _scrollRegion[0]; y <= _scrollRegion[1] - linecount; y++) {
            _tscreen[y] = _tscreen[y + linecount];
            _scratt[y] = _scratt[y + linecount];
        }
        for (y = _scrollRegion[1] - linecount + 1; y <= _scrollRegion[1]; y++) {
            _tscreen[y] = [];
            _scratt[y] = [];
            for (x = 0; x < obj.width; x++) {
                _tscreen[y][x] = ' ';
                _scratt[y][x] = (7 << 6);
            }
        }
    }

    obj.TermHandleKeys = function (e) {
        if (!e.ctrlKey) {
            if (e.which == 127) obj.TermSendKey(8);
            else if (e.which == 13) { obj.TermSendKeys(obj.lineFeed); }
            else if (e.which != 0) obj.TermSendKey(e.which);
            return false;
        }
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
    }

    obj.TermHandleKeyUp = function (e) {
        if ((e.which != 8) && (e.which != 32) && (e.which != 9)) return true;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        return false;
    }

    obj.TermHandleKeyDown = function (e) {
        if ((e.which >= 65) && (e.which <= 90) && (e.ctrlKey == true)) {
            obj.TermSendKey(e.which - 64);
            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            return;
        }
        if (e.which == 27) { obj.TermSendKeys(String.fromCharCode(27)); return true; }; // ESC

        if (_altKeypadMode == true) {
            if (e.which == 37) { obj.TermSendKeys(String.fromCharCode(27, 79, 68)); return true; }; // Left
            if (e.which == 38) { obj.TermSendKeys(String.fromCharCode(27, 79, 65)); return true; }; // Up
            if (e.which == 39) { obj.TermSendKeys(String.fromCharCode(27, 79, 67)); return true; }; // Right
            if (e.which == 40) { obj.TermSendKeys(String.fromCharCode(27, 79, 66)); return true; }; // Down
        } else {
            if (e.which == 37) { obj.TermSendKeys(String.fromCharCode(27, 91, 68)); return true; }; // Left
            if (e.which == 38) { obj.TermSendKeys(String.fromCharCode(27, 91, 65)); return true; }; // Up
            if (e.which == 39) { obj.TermSendKeys(String.fromCharCode(27, 91, 67)); return true; }; // Right
            if (e.which == 40) { obj.TermSendKeys(String.fromCharCode(27, 91, 66)); return true; }; // Down
        }

        if (e.which == 33) { obj.TermSendKeys(String.fromCharCode(27, 91, 53, 126)); return true; }; // PageUp
        if (e.which == 34) { obj.TermSendKeys(String.fromCharCode(27, 91, 54, 126)); return true; }; // PageDown
        if (e.which == 35) { obj.TermSendKeys(String.fromCharCode(27, 91, 70)); return true; }; // End
        if (e.which == 36) { obj.TermSendKeys(String.fromCharCode(27, 91, 72)); return true; }; // Home
        if (e.which == 45) { obj.TermSendKeys(String.fromCharCode(27, 91, 50, 126)); return true; }; // Insert
        if (e.which == 46) { obj.TermSendKeys(String.fromCharCode(27, 91, 51, 126)); return true; }; // Delete

        if (e.which == 9) { obj.TermSendKeys("\t"); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return true; }; // TAB

        // F1 to F12 keys
        // ###BEGIN###{Terminal-FxEnumation-All}
        var fx0 = [80, 81, 119, 120, 116, 117, 113, 114, 112, 77];
        var fx1 = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 33, 64];
        var fx2 = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91];
        if (e.which > 111 & e.which < 124 && e.repeat == false) { // F1 to F12 keys
            if (obj.fxEmulation == 0 && e.which < 122) { obj.TermSendKeys(String.fromCharCode(27, 91, 79, fx0[e.which - 112])); return true; } // 'Intel (F10 = ESC+[OM)'
            if (obj.fxEmulation == 1) { obj.TermSendKeys(String.fromCharCode(27, fx1[e.which - 112])); return true; } // 'Alternate (F10 = ESC+0)'
            if (obj.fxEmulation == 2) { obj.TermSendKeys(String.fromCharCode(27, 79, fx2[e.which - 112])); return true; } // 'VT100+ (F10 = ESC+[OY)'
        }
        // ###END###{Terminal-FxEnumation-All}
        // ###BEGIN###{Terminal-FxEnumation-Intel}
        var fx0 = [80, 81, 119, 120, 116, 117, 113, 114, 112, 77];
        if (e.which > 111 & e.which < 122 && e.repeat == false) { obj.TermSendKeys(String.fromCharCode(27, 91, 79, fx0[e.which - 112])); return true; } // 'Intel (F10 = ESC+[OM)'
        // ###END###{Terminal-FxEnumation-Intel}
        // ###BEGIN###{Terminal-FxEnumation-Alternate}
        var fx1 = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 33, 64];
        if (e.which > 111 & e.which < 124 && e.repeat == false) { obj.TermSendKeys(String.fromCharCode(27, fx1[e.which - 112])); return true; } // 'Alternate (F10 = ESC+0)'
        // ###END###{Terminal-FxEnumation-Alternate}
        // ###BEGIN###{Terminal-FxEnumation-VT100Plus}
        var fx2 = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91];
        if (e.which > 111 & e.which < 124 && e.repeat == false) { obj.TermSendKeys(String.fromCharCode(27, 79, fx2[e.which - 112])); return true; } // 'VT100+ (F10 = ESC+[OY)'
        // ###END###{Terminal-FxEnumation-VT100Plus}

        if (e.which != 8 && e.which != 32 && e.which != 9) return true;
        obj.TermSendKey(e.which);
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        return false;
    }

    obj.recordLineTobackBuffer = function(y) {
        var closetag = '', buf = '';
        var r = obj.TermDrawLine(buf, y, closetag);
        buf = r[0];
        closetag = r[1];
        scrollBackBuffer.push(buf + closetag + '<br>');
    }

    obj.TermDrawLine = function (buf, y, closetag) {
        var newat, c, oldat = 1, x1, x2;
        for (var x = 0; x < obj.width; ++x) {
            newat = _scratt[y][x];
            if (_termx == x && _termy == y && _cursorVisible) { newat |= _VTREVERSE; } // If this is the cursor location, reverse the color.
            if (newat != oldat) {
                buf += closetag;
                closetag = '';
                x1 = 6; x2 = 12;
                if (newat & _VTREVERSE) { x1 = 12; x2 = 6; }
                buf += '<span style="color:#' + _TermColors[(newat >> x1) & 0x3F] + ';background-color:#' + _TermColors[(newat >> x2) & 0x3F];
                if (newat & _VTUNDERLINE) buf += ';text-decoration:underline';
                buf += ';">';
                closetag = "</span>" + closetag;
                oldat = newat;
            }

            c = _tscreen[y][x];
            switch (c) {
                case '&': buf += '&amp;'; break;
                case '<': buf += '&lt;'; break;
                case '>': buf += '&gt;'; break;
                case ' ': buf += '&nbsp;'; break;
                default: buf += c; break;
            }
        }
        return [buf, closetag];
    }

    obj.TermDraw = function() {
        var closetag = '', buf = '';
        for (var y = 0; y < obj.height; ++y) {
            var r = obj.TermDrawLine(buf, y, closetag);
            buf = r[0];
            closetag = r[1];
            if (y != (obj.height - 1)) buf += '<br>';
        }

        if (scrollBackBuffer.length > 800) { scrollBackBuffer = scrollBackBuffer.slice(scrollBackBuffer.length - 800); }
        var backbuffer = scrollBackBuffer.join('');
        obj.DivElement.innerHTML = "<font size='4'><b>" + backbuffer + buf + closetag + "</b></font>";
        obj.DivElement.scrollTop = obj.DivElement.scrollHeight;
        if (obj.heightLock == 0) { setTimeout(obj.TermLockHeight, 10); }
    }

    obj.TermLockHeight = function () {
        obj.heightLock = obj.DivElement.clientHeight;
        obj.DivElement.style['height'] = obj.DivElement.parentNode.style['height'] = obj.heightLock + 'px';
        obj.DivElement.style['overflow-y'] = 'scroll';
    }

    obj.TermInit = function () { obj.TermResetScreen(); }

    obj.heightLock = 0;
    obj.DivElement.style['height'] = '';
    if ((options != null) && (options.width != null) && (options.height != null)) { obj.Init(options.width, options.height); } else { obj.Init(); }
    return obj;
}