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
var meshAgent = require('MeshAgent');

var CF_TEXT = 1;
var CF_UNICODETEXT = 13;

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
// The session a read or write goes to: the caller's, else the console session (Windows session id, uid elsewhere), 0 when nobody is logged in
function targetUserId(sid)
{
    if (sid != null) { return (sid); }
    if (process.platform != 'win32') { return (resolveConsoleUid()); }
    var active = require('user-sessions').Current().Active;
    return ((active.length > 0) ? parseInt(active[0].SessionId) : 0);
}
function dispatchRead(sid)
{
    var id = targetUserId(sid);

    if (process.platform == 'win32')
    {
        // Session 0 is the service's own, nobody's clipboard
        if (id == 0) { return (rejectedPromise('Nobody is logged in')); }
        // No one-shot read child when the watcher failed, it's the same kind of child in the same session
        return (watchedRead('win:' + id, function () { return (watchStartWindows(id)); }, function () { return (rejectedPromise(ERR_WIN_WATCH_FAILED)); }));
    }
    if (process.platform == 'darwin' && id != 0)
    {
        return (watchedRead('mac:' + id, function () { return (watchStartMac(id)); }, function () { return (module.exports.read()); }));
    }
    return (module.exports.read());     // On Linux it picks Wayland or X11 and refuses without either (ERR_NEED_XCLIP)
}

function newPromise() { return (new promise(function (res, rej) { this._res = res; this._rej = rej; })); }

function resolvedPromise(value)
{
    var p = newPromise();
    p._res(value);
    return (p);
}

function rejectedPromise(reason)
{
    var p = newPromise();
    p._rej(reason);
    return (p);
}

// Read or write through the watcher child, waits for its first report and times out when it never answers
function watchRequest(w, msg)
{
    var n = ++w.reqSeq;
    var p = newPromise();
    msg.n = n;
    p.msg = msg;
    p.sent = false;
    w.reqs[n] = p;
    w.lastUse = Date.now();
    p.timer = setTimeout(function () { watchSettleRequest(w, n, null, 'The clipboard watcher did not answer'); }, HELPER_READ_TIMEOUT_MS);
    if (w.ready) { watchSendRequest(w, n); }
    return (p);
}

function watchSendRequest(w, n)
{
    var p = w.reqs[n];
    if (p == null || p.sent) { return; }
    p.sent = true;
    try { w.child.send(p.msg); } catch (e) { watchSettleRequest(w, n, null, 'The clipboard watcher ended'); }
}

// The child's first report, a text or a refused open, makes it ready and sends the queued requests
function watchMarkReady(w)
{
    if (w.ready) { return; }
    w.ready = true;
    for (var n in w.reqs) { watchSendRequest(w, n); }
}

// Locked: cache dropped so reads get the child's refusal, refilled by watchOnText() after the unlock
function watchOnLocked(w)
{
    w.gen++;
    w.valid = false;
    w.text = null;
    w.tooLarge = false;
    watchMarkReady(w);
}

// Over MAX_TEXT_BYTES: reads get ERR_TOO_LARGE until the next text
function watchOnTooLarge(w)
{
    watchOnLocked(w);
    w.tooLarge = true;
}

// Settles a request once: on its answer, on the timeout, or when the watcher stops
function watchSettleRequest(w, n, value, err)
{
    var p = w.reqs[n];
    if (p == null) { return; }
    delete w.reqs[n];
    try { clearTimeout(p.timer); } catch (e) { }   // clearTimeout() throws when the firing timer itself calls this
    if (err != null) { p._rej(err); } else { p._res(value); }
}

function dispatchWrite(data, sid)
{
    if (process.platform == 'win32')
    {
        // Writes go through the watcher, which says whether the text landed
        var id = targetUserId(sid);
        if (id == 0) { return (rejectedPromise('Nobody is logged in')); }
        var w = watchGetOrStart('win:' + id, function () { return (watchStartWindows(id)); });
        return ((w == null) ? rejectedPromise(ERR_WIN_WATCH_FAILED) : watchRequest(w, { w: data }));
    }
    return (module.exports(data));      // On Linux it picks Wayland or X11 and refuses without either (ERR_NEED_XCLIP)
}

// Wayland, unless it has no data-control and Xwayland is there, then X11 reads the synced CLIPBOARD without focus (GNOME)
function lin_use_wayland(uid)
{
    if (lin_wayland_socket(uid) == null) { return (false); }
    if (!_failures.noDataControl[uid]) { return (true); }
    var xUnusable = (_failures.xUnusable[uid] > (Date.now() - WATCH_RETRY_MAX_MS));     // Tried again after the longest wait of a failed watcher
    return (!(require('clipboard').xclip && !xUnusable && (cachedXInfo(uid) != null)));
}

// The console uid and X display are kept for LOOKUP_TTL_MS or while a ready watcher runs, the user name until reset.
// All are cleared by a login, a logout, a seat0 switch or HELPER_MAX_FAILS failed reads.
var LOOKUP_TTL_MS = 60000;
var _lookups = { uid: null, uidAt: 0, name: null, nameUid: null, xinfo: null, xinfoUid: null, xinfoAt: 0 };
var _seat0Active = null;    // seat0's active session id at the last look, '' without one

// Children close descriptors from 3 up, else one outliving an agent restart keeps meshagent.db's flock.
// dash takes only single digits ("exec 12>&-" ends the shell), so 10 and up only where a subshell shows it works.
var SHELL_PATH = require('fs').existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
var SH_CLOSE_FDS = 'cfd=; if (eval "exec 13>&-") 2>/dev/null; then cfd=1; fi; if [ -d /proc/$$/fd ]; then for f in /proc/$$/fd/*; do n=${f##*/}; case $n in [3-9]) eval "exec $n>&-";; 255) ;; [1-9][0-9]*) if [ -n "$cfd" ]; then eval "exec $n>&-"; fi;; esac; done; else i=3; while [ $i -lt 1024 ]; do if [ $i -lt 10 ] || [ -n "$cfd" ]; then eval "exec $i>&-"; fi; i=$((i+1)); done; fi; ';

// The helper and watcher stop too, a new login of the same user can bring a new XAUTHORITY or compositor
function resetSession()
{
    resetLookups();
    helperStop(_helper);
    watchStop(_watcher);
    _failures = emptyFailures();
}

function isUidStillActive(uid)
{
    var w = _watcher;
    return (w != null && !w.stopped && w.ready && w.uid == uid);
}

// The cached console uid, on Linux seat0's active uid
function resolveConsoleUid()
{
    var now = Date.now();
    // A user switch fires no 'changed', and without systemd only LOOKUP_TTL_MS expires the lookups
    var seat = require('seat-info'), a = seat.active(), key = (a != null) ? a.session : '';
    if ((_seat0Active != null) && (key != _seat0Active)) { resetSession(); }
    _seat0Active = key;
    if (_lookups.uid != null && (((now - _lookups.uidAt) < LOOKUP_TTL_MS) || isUidStillActive(_lookups.uid))) { return (_lookups.uid); }
    // seat0's user wins, on systemd 257 consoleUid() can pick another user's manager session.
    // A greeter or another system user on seat0 is nobody.
    if (seat.isGreeter()) { throw ('Nobody is logged in'); }
    var id = (a != null) ? a.uid : require('user-sessions').consoleUid();     // Can throw, the callers already handle that
    _lookups.uid = id;
    _lookups.uidAt = now;
    return (id);
}

// Asked once, user-sessions.isRoot() starts /usr/bin/id on every call.
// On Linux from the Uid line of /proc/self/status, the agent has no process.getuid()
var _isRoot = null;
function cachedIsRoot()
{
    if (_isRoot != null) { return (_isRoot); }
    if (process.platform == 'linux')
    {
        try { var m = /^Uid:\s+[0-9]+\s+([0-9]+)/m.exec(require('fs').readFileSync('/proc/self/status').toString()); if (m != null) { _isRoot = (m[1] == '0'); return (_isRoot); } } catch (e) { }
    }
    try { _isRoot = require('user-sessions').isRoot(); } catch (e) { _isRoot = false; }
    return (_isRoot);
}

function passwdName(uid)
{
    try
    {
        var lines = require('fs').readFileSync('/etc/passwd').toString().split('\n');
        for (var i = 0; i < lines.length; ++i) { var f = lines[i].split(':'); if ((f.length > 2) && (f[2] == String(uid)) && f[0]) { return (f[0]); } }
    }
    catch (e) { }
    return (null);
}

// Kept until the lookups are reset, on macOS user-sessions runs a dscl shell for it
function cachedUsername(uid)
{
    if (_lookups.name != null && _lookups.nameUid == uid) { return (_lookups.name); }
    // /etc/passwd first, user-sessions runs getent in a shell. That stays for a user the file lacks (LDAP, SSSD) and for macOS
    var name = (process.platform == 'darwin') ? null : passwdName(uid);
    if (!name) { name = require('user-sessions').getUsername(uid); }     // Can throw, the callers already handle that
    if (name) { _lookups.name = name; _lookups.nameUid = uid; }
    return (name);
}

// Misses are cached too. A found display is also kept past the TTL while its watcher runs
function cachedXInfo(id)
{
    var now = Date.now();
    if ((_lookups.xinfoUid != null) && (_lookups.xinfoUid == id) && (((now - _lookups.xinfoAt) < LOOKUP_TTL_MS) || ((_lookups.xinfo != null) && isUidStillActive(id)))) { return (_lookups.xinfo); }
    var xinfo = null;
    try { xinfo = require('monitor-info').getXInfo(id); } catch (e) { }
    _lookups.xinfo = xinfo;
    _lookups.xinfoUid = id;
    _lookups.xinfoAt = now;
    return (xinfo);
}

function resetLookups()
{
    _lookups.uid = null;
    _lookups.name = null;
    _lookups.xinfo = null;
    _lookups.xinfoUid = null;
}

// One shell per console user runs xclip or wl-paste per read, each answer ends with a marker line and exit code.
// Stops when idle, on a slow read, after HELPER_MAX_FAILS failures in a row, or on a user change.
var HELPER_IDLE_MS = 30000;
var HELPER_READ_TIMEOUT_MS = 5000;
var HELPER_MAX_FAILS = 3;
var HELPER_PAUSE_MS = 10000;   // No new helper for this long after HELPER_MAX_FAILS failed reads in a row
var _helper = null;

// Longer clipboard texts are refused
var MAX_TEXT_BYTES = 1048576;
var ERR_TOO_LARGE = 'Clipboard text is larger than ' + MAX_TEXT_BYTES + ' bytes';
// Cheap length check first, the UTF-8 encode only when 3 bytes per character could cross the limit
function isTooLarge(t) { return ((t.length > MAX_TEXT_BYTES) || ((t.length * 3 > MAX_TEXT_BYTES) && (Buffer.from(t).length > MAX_TEXT_BYTES))); }

// err only when the pending read fails with a reason. The timers and the exit handler leave it out and the read resolves empty
function helperStop(h, err)
{
    if (h == null || h.stopped) { return; }
    h.stopped = true;
    if (_helper == h) { _helper = null; }
    try { clearTimeout(h.idleTimer); } catch (e) { }    // clearTimeout() throws when the firing timer itself calls this
    try { clearTimeout(h.readTimer); } catch (e) { }
    // Killed by its pid, killing the shell leaves a hung xclip running with the agent's stdout pipe open
    if (h.pending != null && h.toolPid > 0 && isOwnedByUid('/proc/' + h.toolPid, h.uid)) { try { process.kill(h.toolPid, 'SIGKILL'); } catch (e) { } }
    try { h.child.kill(); } catch (e) { }
    // The agent removes the mktemp file, the helper inherits SIGTERM blocked so a shell trap never runs. unlink doesn't follow a symlink
    if (h.tmpFile != null && isOwnedByUid(h.tmpFile, h.uid)) { try { require('fs').unlinkSync(h.tmpFile); } catch (e) { } }
    if (h.pending != null) { var p = h.pending; h.pending = null; if (err != null) { p._rej(err); } else { p._res(''); } }
}

// Only kills or deletes what the console user owns, who can forge pid and tmp lines, no uid from statSync() means no match
function isOwnedByUid(path, uid)
{
    try { var st = require('fs').statSync(path); return (typeof st.uid == 'number' && st.uid == uid); } catch (e) { return (false); }
}

var ERR_NEED_WLCLIP = 'wl-clipboard (wl-copy, wl-paste) is not installed on the device';
var ERR_KDE_NO_QDBUS = 'qdbus6 or qdbus is not installed on the device, KDE on Wayland without data-control reads the clipboard from Klipper through it';

// mode is 'wl' (wl-paste), 'kde' (Klipper through qdbus) or 'x11' (xclip)
function helperStart(id, mode)
{
    var env, tool;
    if (mode == 'wl')
    {
        var wl = require('clipboard').wlclipboard;
        if (!wl) { throw (ERR_NEED_WLCLIP); }
        env = lin_wayland_env(id);
        tool = '"' + wl.paste + '" --no-newline --type text';     // Without --type an image comes back as raw bytes
    }
    else if (mode == 'kde')
    {
        var kt = lin_klipperTools();
        if (kt == null) { throw (ERR_KDE_NO_QDBUS); }
        env = lin_klipper_env(id);
        tool = '"' + kt.qdbus + '" org.kde.klipper /klipper getClipboardContents';
    }
    else
    {
        var xinfo = cachedXInfo(id);
        if (xinfo == null) { throw ('No X display found for uid ' + id); }
        env = xinfo.exportEnv();
        tool = '"' + require('clipboard').xclip + '" -selection c -o';
    }
    withPath(env);     // The shell needs it to find mktemp

    var h = { uid: id, mode: mode, tool: tool, err: '', seq: 0, toolPid: 0, tmpFile: null, pending: null, fails: 0, idleTimer: null, readTimer: null, stopped: false };
    h.framer = newFramer();

    h.child = require('child_process').execFile(SHELL_PATH, ['sh'], { uid: id, env: env });
    h.child.helper = h;
    h.child.stdout.helper = h;
    // Stopping the helper kills the tool, so the rest of an oversized clipboard is never read
    h.child.stdout.on('data', function (c) { var hp = this.helper; if (!framerFeed(hp.framer, c, function (text, code) { helperOnResult(hp, text, code); })) { helperStop(hp, ERR_TOO_LARGE); } });
    h.child.stderr.helper = h;
    h.child.stderr.on('data', function (c) { helperOnStderr(this.helper, c); });
    h.child.on('exit', function () { helperStop(this.helper); });

    // Tool stderr to a file, no subshell per read, fd 4 keeps the shell's stderr, fixed name in private /run/user/<uid>, else mktemp
    var errFile = require('fs').existsSync('/run/user/' + id) ? ('/run/user/' + id + '/.meshclip.err') : null;
    h.child.stdin.write(SH_CLOSE_FDS + 'exec 3>&1 4>&2; ' + (errFile != null ? ('F="' + errFile + '"') : 'F=$(mktemp) || exit 1; echo "tmp:$F" >&4') + '\n');
    _helper = h;
    return (h);
}

// Splits a child's output into messages that each end with the line "\n<marker>:<code>\n", for the read helper and the Wayland watcher
function newFramer()
{
    var marker = '__meshclip_' + Date.now().toString(16) + Math.random().toString(16).substring(2) + '__';
    return ({ marker: marker, end: '\n' + marker + ':', chunks: [], bytes: 0, probe: '', over: false });
}

// Adds a chunk of the child's output to the framer. For every complete message it calls done(text, code), with code from the marker line and text null when the message was over MAX_TEXT_BYTES
// Returns false once the output has passed the limit without a marker, so the caller stops the producer, true otherwise
function framerFeed(f, chunk, done)
{
    var cs = chunk.toString();                          // null for an empty chunk
    if (!f.over)
    {
        // Copied at once, the agent reuses the chunk's memory for the next read
        f.chunks.push(Buffer.concat([chunk]));
        f.bytes += chunk.length;
    }

    // Only the end of the output is searched per chunk, the marker line ends a message
    f.probe += (cs == null ? '' : cs);
    while (true)
    {
        var k = f.probe.indexOf(f.end);
        var j = (k < 0) ? -1 : f.probe.indexOf('\n', k + f.end.length);
        if (j < 0)
        {
            f.probe = f.probe.substring(f.probe.length - (f.end.length + 8));
            if (!f.over && f.bytes > MAX_TEXT_BYTES + f.end.length + 8) { f.over = true; f.chunks = []; f.bytes = 0; return (false); }
            return (true);
        }

        var code = parseInt(f.probe.substring(k + f.end.length, j));
        var text = null;
        var rest = f.probe.substring(j + 1);
        if (!f.over)
        {
            var s = Buffer.concat(f.chunks).toString(); // Decoded as a whole, so a character split across two chunks stays intact
            var i = s.indexOf(f.end);
            rest = s.substring(s.indexOf('\n', i + f.end.length) + 1);
            if ((f.bytes - Buffer.from(s.substring(i)).length) <= MAX_TEXT_BYTES) { text = s.substring(0, i); }    // The tail is measured in bytes
        }
        f.over = false;
        f.chunks = (rest.length > 0) ? [Buffer.from(rest)] : [];
        f.bytes = (rest.length > 0) ? f.chunks[0].length : 0;
        f.probe = rest;
        done(text, code);
    }
}

function helperOnResult(h, text, code)
{
    try { clearTimeout(h.readTimer); } catch (e) { }
    h.readTimer = null;
    h.toolPid = 0;                                      // The tool has exited, so its pid may already belong to another process

    var p = h.pending;
    h.pending = null;
    if (code == 0)
    {
        h.fails = 0;
    }
    else if (forgetToolIfGone(code, _toolPaths[h.mode]))
    {
        helperStop(h);                             // Its command line holds the old path
    }
    else if (++h.fails >= HELPER_MAX_FAILS)
    {
        // The display or its authorization changed under the helper, so the next read looks everything up again and starts a new helper
        resetLookups();
        helperStop(h);
        _failures.helperPausedUntil = Date.now() + HELPER_PAUSE_MS;
    }
    if ((h.mode == 'kde') && (code == 0) && (text != null) && (text.substring(text.length - 1) == '\n')) { text = text.substring(0, text.length - 1); }    // qdbus ends the string with a line break of its own
    if (p != null) { if (text == null) { p._rej(ERR_TOO_LARGE); } else { p._res(code == 0 ? text : ''); } }
}

// One watcher per console user or Windows session, reads answered from its copy, 'text' watchers send the text, 'notify' ones (X11) only a change.
// One that can't run here ends early, and reads go the old way until it is tried again, after WATCH_RETRY_FIRST_MS, doubled per early end up to WATCH_RETRY_MAX_MS.
var WATCH_IDLE_MS = 30000;
var WATCH_RETRY_FIRST_MS = 30000;
var WATCH_RETRY_MAX_MS = 600000;
var _watcher = null;
var _watchListener = null;      // pushToPollers() once the first automatic poll came in, called with the new text when a watcher sees a change

// What doesn't work right now, in one object so resetSession() forgets it at once
var _failures = emptyFailures();
function emptyFailures()
{
    return ({
        // Keys of watchers that ended early, with the count n and the time until which reads go the old way
        watch: {},
        // No data-control (Mutter), said by wl-paste --watch itself: a read needs focus and flashes the dock, so Xwayland until the next login
        noDataControl: {},
        // No data-control and the X display failed XOpenDisplay (GNOME without Xwayland still reports :0): Wayland for WATCH_RETRY_MAX_MS
        xUnusable: {},
        // No new helper until this time, after HELPER_MAX_FAILS failed reads in a row
        helperPausedUntil: 0
    });
}

function watchNotifyListener(w, text)
{
    if ((_watchListener == null) || w.stopped || !text) { return; }
    try { _watchListener(text, w); } catch (e) { }
}

// The shell needs PATH to find mktemp and the tools
function withPath(env) { if (process.env['PATH']) { env.PATH = process.env['PATH']; } return (env); }

// The watcher's child: its handlers reach the watcher through this.watch, and its end ends the watcher
function watchAttach(w, child)
{
    w.child = child;
    child.watch = w;
    if (child.stdout) { child.stdout.watch = w; }
    if (child.stderr) { child.stderr.watch = w; }
    child.on('exit', function () { watchOnExit(this.watch); });
}

function watchCreate(key, uid)
{
    var w = { key: key, uid: uid, gen: 0, valid: false, text: null, ready: false, stopped: false, startedAt: Date.now(), lastUse: Date.now(), child: null, line: '', takesRequests: false, tooLarge: false, reqs: {}, reqSeq: 0 };
    // Automatic Clipboard reads once per second, so a watcher without reads for WATCH_IDLE_MS has no viewer left
    w.idleTimer = setInterval(function () { if ((Date.now() - w.lastUse) > WATCH_IDLE_MS) { watchStop(w); } }, WATCH_IDLE_MS / 3);
    _watcher = w;
    return (w);
}

function watchStop(w)
{
    if (w == null || w.stopped) { return; }
    w.stopped = true;
    if (_watcher == w) { _watcher = null; }
    // One that ran past the early-end time starts its retry wait from WATCH_RETRY_FIRST_MS again
    if (w.ready && (Date.now() - w.startedAt) >= 10000) { delete _failures.watch[w.key]; }
    try { clearInterval(w.idleTimer); } catch (e) { }   // clearInterval() throws when the firing timer itself calls this
    if (w.pushTimer) { try { clearTimeout(w.pushTimer); } catch (e) { } w.pushTimer = null; }
    if (w.child != null) { try { if (w.child.exit2) { w.child.exit2(); } else { w.child.kill(); } } catch (e) { } }
    for (var n in w.reqs) { watchSettleRequest(w, n, null, 'The clipboard watcher ended'); }
}

function watchOnExit(w)
{
    if (w.stopped) { return; }
    if (!w.ready || (Date.now() - w.startedAt) < 10000) { watchMarkFailed(w.key); }
    // Only wl-paste's own complaint means no data-control, any other early end is retried after the normal wait
    if ((w.key.substring(0, 3) == 'wl:') && !w.ready && (typeof w.err == 'string') && (w.err.indexOf('data-control') >= 0)) { _failures.noDataControl[w.uid] = true; }
    // e:XOpenDisplay means the Xwayland display this user was sent to doesn't open. Any other early death keeps the helper and xclip on it
    if ((w.key.substring(0, 4) == 'x11:') && w.noDisplay && _failures.noDataControl[w.uid]) { _failures.xUnusable[w.uid] = Date.now(); }
    watchStop(w);
}

// Text watchers (Wayland, Windows, macOS) push only a changed text. The first one isn't pushed, the poll that started the watcher reads it
function watchOnText(w, text)
{
    var changed = w.valid && (w.text !== text);     // Duktape interns every string, so !== is a pointer compare even for a large text
    w.gen++;
    w.text = text;
    w.valid = true;
    w.tooLarge = false;
    watchMarkReady(w);
    if (changed) { watchNotifyListener(w, text); }
}

// The notify-only watcher (X11) reports owner changes, which come in bursts. One read 100 ms after the last of them fills the cache and pushes the text
function watchOnChange(w)
{
    w.gen++;
    w.valid = false;
    w.tooLarge = false;
    if ((_watchListener == null) || (w.freshRead == null)) { return; }
    if (w.pushTimer) { clearTimeout(w.pushTimer); }
    w.pushTimer = setTimeout(function ()
    {
        w.pushTimer = null;
        if (w.stopped) { return; }
        var gen = w.gen;
        w.freshRead().then(function (t) { if (!w.stopped && (w.gen == gen) && t) { w.text = t; w.valid = true; watchNotifyListener(w, t); } }, function () { });
    }, 100);
}

// Each early end doubles the wait before the next try, so a passing failure recovers quickly and a lasting one costs few starts.
// Windows has no fallback, so a failed watcher is always tried again after WIN_WATCH_RETRY_MS.
var WIN_WATCH_RETRY_MS = 30000;
function watchMarkFailed(key)
{
    var prev = _failures.watch[key], n = (prev != null) ? (prev.n + 1) : 0;
    var wait = (key.substring(0, 4) == 'win:') ? WIN_WATCH_RETRY_MS : Math.min(WATCH_RETRY_MAX_MS, WATCH_RETRY_FIRST_MS * Math.pow(2, n));
    _failures.watch[key] = { n: n, until: Date.now() + wait };
}

// The running watcher for key, else a new one. null when it cannot start or its retry wait hasn't passed
function watchGetOrStart(key, start)
{
    var w = _watcher;
    if (w != null && w.key != key) { watchStop(w); w = null; }
    var failed = _failures.watch[key];
    if (w == null && !((failed != null) && (Date.now() < failed.until)))
    {
        try { w = start(); }
        catch (e)
        {
            if (_watcher != null && _watcher.key == key) { watchStop(_watcher); }
            watchMarkFailed(key);
            w = null;
        }
    }
    return (w);
}

// From the watcher's copy when current, else the child (Windows) or freshRead() reads, kept when nothing changed meanwhile
function watchedRead(key, start, freshRead)
{
    var w = watchGetOrStart(key, start);
    if (w == null) { return (freshRead()); }

    w.lastUse = Date.now();
    w.freshRead = freshRead;    // Used by watchOnChange() to read the text it pushes
    if (w.valid) { return (resolvedPromise(w.text)); }
    if (w.tooLarge) { return (rejectedPromise(ERR_TOO_LARGE)); }
    var gen = w.gen, ready = w.takesRequests || w.ready;   // The child reads after its first report, so its answer is always current
    var p = w.takesRequests ? watchRequest(w, { r: 1 }) : freshRead();
    // An empty answer is also what a failed read gives, so it is not kept
    p.then(function (t) { if (!w.stopped && ready && w.gen == gen && t) { w.text = t; w.valid = true; } },
           function (e) { if (!w.stopped && ready && w.gen == gen && (e == ERR_TOO_LARGE)) { w.tooLarge = true; } });    // The notify watchers (X11, Klipper) learn it from the helper's refusal
    return (p);
}

// Feeds a watcher's line based output to onLine(), one call per complete line
function watchSplitLines(w, chunk, onLine)
{
    var cs = chunk.toString();
    w.line += (cs == null ? '' : cs);
    var lines = w.line.split('\n');
    w.line = lines.pop();
    for (var i = 0; i < lines.length; ++i) { onLine(lines[i]); }
}

// Wayland: wl-paste runs the command below per change with the copy on stdin, and gets its own path as $1 for --list-types.
// A copy without a text type (an image) and a CLIPBOARD_STATE=sensitive one (password managers) are cached as '', like on Windows.
// Without data-control (Mutter) wl-paste --watch ends at once and reads go through the helper.
function watchStartWayland(uid)
{
    var wl = require('clipboard').wlclipboard;
    if (!wl) { throw (ERR_NEED_WLCLIP); }
    var env = withPath(lin_wayland_env(uid));

    var w = watchCreate('wl:' + uid, uid);
    w.framer = newFramer();
    // Not --type text, wl-paste runs nothing for a non-text copy then. 2.2.1 sets no CLIPBOARD_TYPE, so the command asks --list-types
    var cmd = 'case "$CLIPBOARD_STATE" in nil) c=0;; sensitive) cat >/dev/null; c=2;; *) if "$1" --list-types 2>/dev/null | grep -q -e \'^text/\' -e \'^UTF8_STRING$\' -e \'^STRING$\' -e \'^TEXT$\'; then cat; c=0; else cat >/dev/null; c=3; fi;; esac; printf \'\\n%s:%d\\n\' ' + w.framer.marker + ' $c';
    watchAttach(w, require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + 'exec "$0" --watch /bin/sh -c "$1" sh "$0"', wl.paste, cmd], { uid: uid, env: env }));
    w.child.stdout.on('data', function (c) { var w = this.watch; framerFeed(w.framer, c, function (text, code) { if (text == null) { watchOnTooLarge(w); } else { watchOnText(w, (code == 0) ? text : ''); } }); });
    w.child.stderr.on('data', function (c) { var w = this.watch; if (w.err == null) { w.err = ''; } if (w.err.length < 4096) { w.err += c.toString(); } });
    return (w);
}

// X11 and FreeBSD: a second agent as the console user prints XFixes owner changes, apart because Xlib exits on a broken connection
var X11_WATCH_JS = [
    "var GM = require('_GenericMarshal');",
    "var X = GM.CreateNativeProxy($LIBX);",
    "X.CreateMethod('XOpenDisplay'); X.CreateMethod('XDefaultScreen'); X.CreateMethod('XRootWindow'); X.CreateMethod('XInternAtom');",
    "X.CreateMethod('XConnectionNumber'); X.CreateMethod('XPending'); X.CreateMethod('XNextEvent'); X.CreateMethod('XFlush');",
    "var F = GM.CreateNativeProxy($LIBF);",
    "F.CreateMethod('XFixesQueryExtension'); F.CreateMethod('XFixesSelectSelectionInput');",
    "var dpy = X.XOpenDisplay(GM.CreateVariable(process.env.DISPLAY));",
    "if (dpy.Val == 0) { console.log('e:XOpenDisplay'); process.exit(1); }",
    "var evBase = GM.CreateVariable(4), errBase = GM.CreateVariable(4);",
    "if (F.XFixesQueryExtension(dpy, evBase, errBase).Val == 0) { console.log('e:XFixes'); process.exit(1); }",
    "var root = X.XRootWindow(dpy, X.XDefaultScreen(dpy).Val);",
    "F.XFixesSelectSelectionInput(dpy, root, X.XInternAtom(dpy, GM.CreateVariable('CLIPBOARD'), 0), 7);",
    "X.XFlush(dpy);",
    "var ev = GM.CreateVariable(256);",
    "var xe = require('DescriptorEvents').addDescriptor(X.XConnectionNumber(dpy).Val, { readset: true });",
    "xe.on('readset', function () { var n = 0; while (X.XPending(dpy).Val > 0) { X.XNextEvent(dpy, ev); ++n; } if (n > 0) { console.log('c'); } });",
    "var pe = require('DescriptorEvents').addDescriptor(0, { readset: true });",
    "pe.on('readset', function () { process.exit(0); });",
    "console.log('r');"
].join('\n');

function watchStartX11(uid, xinfo, key)
{
    var mi = require('monitor-info');
    // Only the X11 KVM looks up monitor-info's library paths, so without one they are unset
    if ((!mi.Location_X11LIB || !mi.Location_X11FIXES) && (typeof mi._check == 'function')) { try { mi._check(); } catch (e) { } }
    if (!mi.Location_X11LIB || !mi.Location_X11FIXES) { throw ('libX11 or libXfixes not found'); }
    var js = X11_WATCH_JS.split('$LIBX').join(JSON.stringify(mi.Location_X11LIB)).split('$LIBF').join(JSON.stringify(mi.Location_X11FIXES));
    var env = withPath(xinfo.exportEnv());

    var w = watchCreate(key, uid);
    watchAttach(w, require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + 'exec "$0" -b64exec "$1"', process.execPath, Buffer.from(js).toString('base64')], { uid: uid, env: env }));
    w.child.stdout.on('data', function (c)
    {
        var w = this.watch;
        watchSplitLines(w, c, function (l) { if (l == 'r') { w.ready = true; } else if (l == 'c') { watchOnChange(w); } else if (l == 'e:XOpenDisplay') { w.noDisplay = true; } });
    });
    w.child.stderr.on('data', function (c) { });
    return (w);
}

function lin_x11WatchedRead(uid, freshRead)
{
    var xinfo = cachedXInfo(uid);
    if (xinfo == null) { return (freshRead()); }
    var key = 'x11:' + uid + ':' + xinfo.display;
    return (watchedRead(key, function () { return (watchStartX11(uid, xinfo, key)); }, freshRead));
}

// Windows: a child in the user's session, session 0 can't see its clipboard, sends the text when GetClipboardSequenceNumber() moves.
// It looks when Windows reports a change (WM_CLIPBOARDUPDATE) and once per second.
// Also answers read and write requests, ends with the agent's pipe.
var WIN_WATCH_JS = [
    "var parent = require('ScriptContainer');",
    "var GM = require('_GenericMarshal');",
    "var u = GM.CreateNativeProxy('user32.dll');",
    "u.CreateMethod('GetClipboardSequenceNumber'); u.CreateMethod('OpenClipboard'); u.CreateMethod('CloseClipboard'); u.CreateMethod('IsClipboardFormatAvailable');",
    "u.CreateMethod('GetClipboardData'); u.CreateMethod('EmptyClipboard'); u.CreateMethod('SetClipboardData');",
    "var k = GM.CreateNativeProxy('kernel32.dll');",
    "k.CreateMethod('GlobalAlloc'); k.CreateMethod('GlobalFree'); k.CreateMethod('GlobalLock'); k.CreateMethod('GlobalUnlock'); k.CreateMethod('Sleep');",
    // Retried, clipboard managers and Office hold the clipboard for a few ms
    "function openClipboard()",
    "{",
    "    for (var i = 0; i < 10; ++i) { if (u.OpenClipboard(0).Val != 0) { return (true); } k.Sleep(20); }",
    "    return (false);",
    "}",
    "function readText()",
    "{",
    "    if (!openClipboard()) { return (null); }",
    "    var t = '';",
    "    try",
    "    {",
    "        if (u.IsClipboardFormatAvailable(13).Val != 0)",
    "        {",
    "            var h = u.GetClipboardData(13);",
    "            if (h.Val != 0) { var b = k.GlobalLock(h); b._size = -1; t = b.Wide2UTF8; k.GlobalUnlock(h); }",
    "        }",
    "    }",
    "    finally { u.CloseClipboard(); }",
    "    return (t);",
    "}",
    // Allocated after the open, so a refused open frees nothing, the clipboard owns it only after SetClipboardData()
    "function writeText(txt)",
    "{",
    "    if (!openClipboard()) { return (false); }",
    "    try",
    "    {",
    "        var m = GM.CreateVariable(txt, { wide: true });",
    "        var h = k.GlobalAlloc(2, m._size);",
    "        if (h.Val == 0) { return (false); }",
    "        h.autoFree(false);",
    "        var b = k.GlobalLock(h);",
    "        b.autoFree(false);",
    "        m.toBuffer().copy(b.Deref(0, m._size).toBuffer());",
    "        k.GlobalUnlock(h);",
    "        u.EmptyClipboard();",
    "        if (u.SetClipboardData(13, h).Val != 0) { return (true); }",
    "        k.GlobalFree(h);",
    "        return (false);",
    "    }",
    "    finally { u.CloseClipboard(); }",
    "}",
    // Over the limit the text is replaced by big, so the agent rejects with ERR_TOO_LARGE instead of an empty answer
    "function cap(m, t) { var n = " + MAX_TEXT_BYTES + "; if ((t.length > n) || ((t.length * 3 > n) && (Buffer.from(t).length > n))) { m.big = 1; } else { m.t = t; } return (m); }",
    // Locked: OpenClipboard fails with 5 (ERROR_ACCESS_DENIED), reported once, last reset so the unlock is read
    "var last = -1, told = false;",
    "function check()",
    "{",
    "    var n = u.GetClipboardSequenceNumber().Val;",
    "    if (n == last) { return; }",
    "    var t = readText();",
    "    if (t == null) { if (!told) { told = true; parent.send({ x: 1 }); } last = -1; return; }",
    "    told = false;",
    "    last = n;",
    "    parent.send(cap({}, t));",
    "}",
    "parent.on('data', function (d)",
    "{",
    "    if (d == null) { return; }",
    "    if (typeof d.w == 'string') { var ok = false; try { ok = writeText(d.w); } catch (e) { } parent.send({ n: d.n, ok: ok }); check(); }",
    "    else if (d.r) { var t = readText(); parent.send((t == null) ? { n: d.n, e: 1 } : cap({ n: d.n }, t)); }",
    "});",
    // Not 500 ms, agents before Ylianst/MeshAgent#425 make that SleepEx(0), which costs 3 s CPU per 10 s
    "var timer = setInterval(check, 1000);",
    "check();",
    // A hidden window registered for WM_CLIPBOARDUPDATE (0x031D), so a copy doesn't wait for the timer. The timer stays for a child where this fails.
    // Registered and read outside the pump's callbacks, its thread waits for them. Handles kept, agents up to 1.2.6 drop an unreferenced one
    "var pump = null, regLater = null, checkLater = null;",
    "try",
    "{",
    "    u.CreateMethod('AddClipboardFormatListener');",
    "    pump = new (require('win-message-pump'))({});",
    "    pump.on('error', function () { });",
    "    pump.on('hwnd', function (h) { regLater = setImmediate(function () { try { u.AddClipboardFormatListener(h); } catch (e) { } }); });",
    "    pump.on('message', function (m) { if (m.message == 0x031D) { checkLater = setImmediate(check); } });",
    "}",
    "catch (e) { }"
].join('\n');

function watchStartWindows(id)
{
    var w = watchCreate('win:' + id, id);
    watchAttach(w, require('ScriptContainer').Create({ sessionId: id }));
    w.takesRequests = true;     // Reads and writes go to the child through watchRequest()
    w.child.on('data', function (d)
    {
        if (d == null) { return; }
        if (d.n != null) { watchSettleRequest(this.watch, d.n, d.t, d.big ? ERR_TOO_LARGE : ((d.e || (d.ok === false)) ? ERR_WIN_OPEN_FAILED : null)); }
        else if (d.big) { watchOnTooLarge(this.watch); }
        else if (typeof d.t == 'string') { watchOnText(this.watch, d.t); }
        else if (d.x) { watchOnLocked(this.watch); }
    });
    w.child.ExecuteString(WIN_WATCH_JS);
    return (w);
}

// macOS: osascript as the console user checks NSPasteboard.changeCount twice a second, prints changed text as JSON between RS.
// A 10 s heartbeat ends it through SIGPIPE when the agent is gone.
var MAC_WATCH_JXA = [
    "ObjC.import('AppKit'); ObjC.import('stdlib');",
    "ObjC.bindFunction('getppid', ['int', []]); ObjC.bindFunction('getpgid', ['int', ['int']]);",
    "var pb = $.NSPasteboard.generalPasteboard, last = -1, beat = 0, RS = String.fromCharCode(30);",
    "function esc(s) { return s.replace(/[\\u007f-\\uffff]/g, function (c) { return '\\\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); }",
    "while (true)",
    "{",
    "    if (($.getppid() == 1) || ($.getpgid($AGENTPID) < 0)) { $.exit(0); }",
    "    var n = pb.changeCount;",
    "    if (n != last)",
    "    {",
    "        last = n;",
    "        var s = pb.stringForType($.NSPasteboardTypeString);",
    "        var big = !s.isNil() && (s.lengthOfBytesUsingEncoding($.NSUTF8StringEncoding) > " + MAX_TEXT_BYTES + ");",
    "        console.log(RS + esc(JSON.stringify(big ? { big: 1 } : { t: (s.isNil() ? '' : s.js) })) + RS);",
    "    }",
    "    else if (++beat >= 20) { beat = 0; console.log(RS + '{}' + RS); }",
    "    delay(0.5);",
    "}"
].join('\n');

function watchStartMac(uid)
{
    var js = MAC_WATCH_JXA.split('$AGENTPID').join(String(process.pid));
    // launchctl asuser needs root, an agent started by the user is already in that session and starts osascript itself
    var run = cachedIsRoot() ? ['exec /bin/launchctl asuser "$0" /usr/bin/sudo -u "$1" /usr/bin/osascript -l JavaScript -e "$2"', String(uid), cachedUsername(uid), js] : ['exec /usr/bin/osascript -l JavaScript -e "$0"', js];
    var w = watchCreate('mac:' + uid, uid);
    watchAttach(w, require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + run[0]].concat(run.slice(1))));
    w.child.stderr.on('data', function (c)
    {
        var w = this.watch;
        var cs = c.toString();
        w.line += (cs == null ? '' : cs);
        var parts = w.line.split('\x1e');
        // parts alternate between noise and messages, the last part is still incomplete
        for (var i = 1; i < parts.length - 1; i += 2)
        {
            try { var m = JSON.parse(parts[i]); if (typeof m.t == 'string') { watchOnText(w, m.t); } else if (m.big) { watchOnTooLarge(w); } } catch (e) { }
        }
        w.line = ((parts.length % 2) == 0) ? ('\x1e' + parts[parts.length - 1]) : parts[parts.length - 1];
    });
    w.child.stdout.on('data', function (c) { });
    return (w);
}

function helperOnStderr(h, chunk)
{
    // Shell stderr has only "pid:<seq>:<pid>" and "tmp:<path>" lines, a late line from a finished read is ignored by its sequence number
    h.err += chunk.toString();
    var lines = h.err.split('\n');
    h.err = lines.pop();
    for (var i = 0; i < lines.length; ++i)
    {
        var f = lines[i].split(':');
        if (f.length == 3 && f[0] == 'pid' && parseInt(f[1]) == h.seq && h.pending != null) { h.toolPid = parseInt(f[2]); }
        else if (/^tmp:\/tmp\/tmp\.[A-Za-z0-9]+$/.test(lines[i])) { h.tmpFile = lines[i].substring(4); }    // Only a plain mktemp name, since the agent deletes it as root
    }
}

// A new promise per call, the watcher's push read calls this closure again after the poll's promise settled
function lin_helper_readtext(mode)
{
    var id;
    try { id = resolveConsoleUid(); } catch (e) { return (rejectedPromise(e)); }

    var h = _helper;
    if (h != null && (h.uid != id || h.mode != mode)) { helperStop(h); h = null; }
    if (h == null)
    {
        if (Date.now() < _failures.helperPausedUntil) { return (rejectedPromise('Clipboard reads failed ' + HELPER_MAX_FAILS + ' times in a row, next try in a few seconds')); }
        try { h = helperStart(id, mode); } catch (e) { return (rejectedPromise(e)); }
    }
    if (h.pending != null) { return (h.pending); }      // One read in flight, a second caller gets the same promise

    // Made only here, where it's settled, the agent never frees an unsettled promise
    var ret = newPromise();
    h.pending = ret;
    h.seq++;
    h.toolPid = 0;

    // Foreground, because the agent's blocked SIGCHLD is inherited and dash's wait then sleeps forever. sh -c reports its pid on fd 4 and execs the tool.
    // stdin is /dev/null, stdout is fd 3 and stderr goes to $F. The first line of $F with "not available" or "Nothing is copied" (a non-text clipboard) counts as an empty read, not a failure.
    var cmd = '/bin/sh -c \'echo "pid:' + h.seq + ':$$" >&4; exec "$0" "$@"\' ' + h.tool + ' </dev/null 2>"$F" >&3; c=$?; e=; read -r e <"$F"; case "$e" in *"not available"*|*"Nothing is copied"*) c=0;; esac; printf \'\\n%s:%d\\n\' ' + h.framer.marker + ' $c\n';

    try { clearTimeout(h.idleTimer); } catch (e) { }
    h.idleTimer = setTimeout(helperStop, HELPER_IDLE_MS, h);
    h.readTimer = setTimeout(helperStop, HELPER_READ_TIMEOUT_MS, h);
    try { h.child.stdin.write(cmd); } catch (e) { helperStop(h); }    // The shell died before its exit event ran, stopping resolves this read empty
    return (ret);
}

// The tools' paths by name, from lib-finderV2's folder walk
function lin_findTools(names)
{
    var ret = {}, findBinary = require('lib-finderV2').findBinary;
    for (var i = 0; i < names.length; ++i) { var p = findBinary(names[i]); if (p != null) { ret[names[i]] = p; } }
    return (ret);
}

// A found path is kept until the tool can't run (forgetToolIfGone), a miss for LOOKUP_TTL_MS
var _toolPaths = { x11: { value: null, at: 0 }, wl: { value: null, at: 0 }, kde: { value: null, at: 0 } };

function cachedToolPath(entry, lookup)
{
    if (entry.value != null) { return (entry.value); }
    if ((entry.at != 0) && ((Date.now() - entry.at) < LOOKUP_TTL_MS)) { return (null); }
    entry.at = Date.now();
    entry.value = lookup();
    return (entry.value);
}

function lin_xclip()
{
    return (cachedToolPath(_toolPaths.x11, function () { return (lin_findTools(['xclip']).xclip || null); }));
}

// qdbus reads Klipper's clipboard, dbus-monitor reports its changes. Without dbus-monitor every read asks Klipper
function lin_klipperTools()
{
    return (cachedToolPath(_toolPaths.kde, function ()
    {
        var t = lin_findTools(['qdbus6', 'qdbus', 'dbus-monitor']);
        var q = t['qdbus6'] || t['qdbus'];
        return (q ? { qdbus: q, monitor: t['dbus-monitor'] || null } : null);
    }));
}

// The user's session bus. LANG because qdbus warns about the C locale on stderr
function lin_klipper_env(uid)
{
    return ({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/' + uid + '/bus', XDG_RUNTIME_DIR: '/run/user/' + uid, LANG: 'C.UTF-8' });
}

function lin_wlclipboard()
{
    return (cachedToolPath(_toolPaths.wl, function ()
    {
        var t = lin_findTools(['wl-copy', 'wl-paste']);
        return ((t['wl-copy'] && t['wl-paste']) ? { copy: t['wl-copy'], paste: t['wl-paste'] } : null);
    }));
}

// Exit 126 or 127 means the tool was removed or replaced, so its path is looked up again
function forgetToolIfGone(code, entry)
{
    if ((code != 126) && (code != 127)) { return (false); }
    entry.value = null;
    entry.at = 0;
    return (true);
}

// From the compositor socket, three file checks at most
function lin_wayland_socket(uid)
{
    var fs = require('fs');
    var runtimeDir = '/run/user/' + uid;
    var disp = process.env['WAYLAND_DISPLAY'];
    if (disp && fs.existsSync(runtimeDir + '/' + disp)) { return (disp); }
    if (fs.existsSync(runtimeDir + '/wayland-1')) { return ('wayland-1'); }
    if (fs.existsSync(runtimeDir + '/wayland-0')) { return ('wayland-0'); }
    return (null);
}

function lin_wayland_env(uid)
{
    return ({ WAYLAND_DISPLAY: lin_wayland_socket(uid) || 'wayland-0', XDG_RUNTIME_DIR: '/run/user/' + uid });
}

// \r\n from Windows browsers shows as ^M here, the page compares normalized (deskClipboardEq), so the read back isn't a new copy
function toUnixNewlines(txt)
{
    return ((typeof txt == 'string') ? txt.split('\r\n').join('\n') : txt);
}

// wl-copy or xclip as the console user, the forked owner keeps the selection, a hung foreground child is killed after HELPER_READ_TIMEOUT_MS.
// Success or Failed from the exit code.
function lin_toolCopy(name, argv, uid, env, tools, txt)
{
    var ret = newPromise();
    // The tool writes to /dev/null because its forked owner would keep the pipe open. The empty listeners stay, the agent only sees the exit through a pipe it reads
    ret.child = require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + 'exec "$0" "$@" >/dev/null 2>&1'].concat(argv), { uid: uid, env: env });
    ret.child.promise = ret;
    ret.child.stdout.on('data', function (c) { });
    ret.child.stderr.on('data', function (c) { });
    var copyChild = ret.child;
    ret.child.timeoutHandle = setTimeout(function () { copyChild.timedout = true; try { copyChild.kill(); } catch (e) { } }, HELPER_READ_TIMEOUT_MS);
    ret.child.on('exit', function (code)
    {
        try { clearTimeout(this.timeoutHandle); } catch (e) { }    // clearTimeout() throws when the firing timer itself ended the child
        if (this.timedout) { this.promise._rej(name + ' timed out, the display did not answer'); return; }
        if (forgetToolIfGone(code, tools)) { this.promise._rej(name + ' cannot be run (exit code ' + code + ')'); return; }
        if (code != 0) { this.promise._rej(name + ' failed with exit code ' + code); return; }     // xclip exits 1 when it cannot open the display
        this.promise._res();
    });
    ret.child.stdin.write(toUnixNewlines(txt), function () { this.end(); });
    return (ret);
}

// Collects a child's stdout up to MAX_TEXT_BYTES and kills it after HELPER_READ_TIMEOUT_MS.
// Chunks are copied at once because the agent reuses their memory for the next read, and decoded as a whole so a split character stays intact.
// done(text, code, fail) at exit, fail is ERR_TOO_LARGE or the timeout, text is '' without output.
function collectLimited(child, name, done)
{
    var out = [], bytes = 0, fail = null;
    var stop = function (reason) { if (fail == null) { fail = reason; out = []; try { child.kill(); } catch (e) { } } };
    child.stdout.on('data', function (c) { if (fail != null) { return; } bytes += c.length; if (bytes > MAX_TEXT_BYTES) { stop(ERR_TOO_LARGE); } else { out.push(Buffer.concat([c])); } });
    var timer = setTimeout(function () { stop(name + ' timed out'); }, HELPER_READ_TIMEOUT_MS);
    child.on('exit', function (code)
    {
        try { clearTimeout(timer); } catch (e) { }
        var b = Buffer.concat(out);
        done((b.length > 0) ? b.toString() : '', code, fail);
    });
}

function bsd_xclip_readtext()
{
    var uid;
    try { uid = resolveConsoleUid(); } catch (e) { return (rejectedPromise(e)); }
    return (lin_x11WatchedRead(uid, function ()
    {
        var xinfo = cachedXInfo(uid);
        if (xinfo == null) { return (rejectedPromise('No X display found for uid ' + uid)); }
        var ret = newPromise();
        ret.child = require('child_process').execFile(require('clipboard').xclip, ['xclip', '-selection', 'c', '-o'], { uid: uid, env: xinfo.exportEnv() });
        ret.child.stderr.str = ''; ret.child.stderr.on('data', function (c) { this.str += c.toString(); });
        collectLimited(ret.child, 'xclip', function (text, code, fail)
        {
            if (fail != null) { ret._rej(fail); return; }
            var err = ret.child.stderr.str.trim();
            // An empty clipboard is no error, xclip prints "target STRING not available" and exits 1
            if (err.indexOf('not available') >= 0) { ret._res(''); return; }
            if (err != '') { resetLookups(); ret._rej(err); return; }
            ret._res(text);
        });
        return (ret);
    }));
}

// No fallback without xclip
var ERR_NEED_XCLIP = 'xclip is not installed on the device';
// Without data-control (GNOME) only the focused window may use the clipboard, so reads and writes go through Xwayland instead
var ERR_NO_DATACONTROL_XCLIP = 'xclip is not installed on the device, this Wayland desktop only gives the clipboard through Xwayland';
var ERR_NO_DATACONTROL_X11 = 'No Xwayland display found, this Wayland desktop only gives the clipboard through Xwayland';

function lin_readtext()
{
    var uid;
    try { uid = resolveConsoleUid(); } catch (e) { return (rejectedPromise(e)); }

    if (lin_use_wayland(uid))
    {
        // Refused without data-control and Xwayland, an automatic read would steal focus every second
        if (_failures.noDataControl[uid]) { return (rejectedPromise(require('clipboard').xclip ? ERR_NO_DATACONTROL_X11 : ERR_NO_DATACONTROL_XCLIP)); }
        return (watchedRead('wl:' + uid, function () { return (watchStartWayland(uid)); }, function () { return (lin_helper_readtext('wl')); }));
    }

    if (require('clipboard').xclip)
    {
        // KDE, told by KWin's Xwayland key xauth_* (mutter's is .mutter-Xwaylandauth.*): Klipper answers on the session bus without focus
        var xinfo = _failures.noDataControl[uid] ? cachedXInfo(uid) : null;
        if ((xinfo != null) && (typeof xinfo.xauthority == 'string') && (xinfo.xauthority.indexOf('/xauth_') >= 0))
        {
            return (watchedRead('kde:' + uid, function () { return (watchStartKlipper(uid)); }, function () { return (lin_helper_readtext('kde')); }));
        }
        return (lin_x11WatchedRead(uid, function () { return (lin_helper_readtext('x11')); }));
    }
    return (rejectedPromise(ERR_NEED_XCLIP));
}

// KWin syncs to X11 only while an X11 window has focus and wl-clipboard 2.2.1 lacks ext-data-control, so read from Klipper over D-Bus
// dbus-monitor prints Klipper's clipboardHistoryUpdated, the next read asks Klipper once, ready at NameAcquired
function watchStartKlipper(uid)
{
    var kt = lin_klipperTools();
    if ((kt == null) || !kt.monitor) { throw ('dbus-monitor is not installed on the device, KDE on Wayland without data-control follows the clipboard through it'); }
    var env = withPath(lin_klipper_env(uid));

    var w = watchCreate('kde:' + uid, uid);
    watchAttach(w, require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + 'exec "$0" --session "$1"', kt.monitor, "type='signal',interface='org.kde.klipper.klipper',member='clipboardHistoryUpdated'"], { uid: uid, env: env }));
    w.child.stdout.on('data', function (c)
    {
        var w = this.watch;
        watchSplitLines(w, c, function (l) { if (l.indexOf('member=clipboardHistoryUpdated') >= 0) { watchOnChange(w); } else if (l.indexOf('member=NameAcquired') >= 0) { w.ready = true; } });
    });
    w.child.stderr.on('data', function (c) { });
    return (w);
}

// Also reached directly on FreeBSD, where it is module.exports
function xclip_copy(txt)
{
    var id;
    try { id = resolveConsoleUid(); } catch (e) { return (rejectedPromise(e)); }
    var xinfo = cachedXInfo(id);
    if (xinfo == null) { return (rejectedPromise('No X display found for uid ' + id)); }
    return (lin_toolCopy('xclip', [require('clipboard').xclip, '-selection', 'c'], id, xinfo.exportEnv(), _toolPaths.x11, txt));
}

function lin_copytext(txt)
{
    var uid = null;
    try { uid = resolveConsoleUid(); } catch (e) { }
    if ((uid != null) && lin_use_wayland(uid))
    {
        // Refused like the reads, without data-control wl-copy waits for focus until the timeout kills it
        if (_failures.noDataControl[uid]) { return (rejectedPromise(require('clipboard').xclip ? ERR_NO_DATACONTROL_X11 : ERR_NO_DATACONTROL_XCLIP)); }
        var wl = require('clipboard').wlclipboard;
        if (!wl) { return (rejectedPromise(ERR_NEED_WLCLIP)); }
        return (lin_toolCopy('wl-copy', [wl.copy], uid, lin_wayland_env(uid), _toolPaths.wl, txt));
    }
    // A compositor without data-control is written through Xwayland, lin_use_wayland() is false for it when Xwayland is there
    if (require('clipboard').xclip)
    {
        return (xclip_copy(txt));
    }
    return (rejectedPromise(ERR_NEED_XCLIP));
}

// A locked session and a program holding the clipboard both fail the open. Telling them apart needs GetLastError() through _GenericMarshal
var ERR_WIN_OPEN_FAILED = 'The clipboard could not be opened, the session is locked or another program holds it';
// The watcher ended early in this session less than WIN_WATCH_RETRY_MS ago, or could not start. A login or logout tries it again
var ERR_WIN_WATCH_FAILED = 'The clipboard watcher could not run in the user session';

// The user32 and kernel32 proxies are created once, an agent without a service reads in-process every second with Automatic Clipboard
var _winApi = null;
function win_api()
{
    if (_winApi != null) { return (_winApi); }
    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    var u = ['OpenClipboard', 'CloseClipboard', 'EmptyClipboard', 'IsClipboardFormatAvailable', 'GetClipboardData', 'SetClipboardData'];
    var k = ['GlobalAlloc', 'GlobalFree', 'GlobalLock', 'GlobalUnlock'];
    for (var i = 0; i < u.length; ++i) { user32.CreateMethod(u[i]); }
    for (var j = 0; j < k.length; ++j) { kernel32.CreateMethod(k[j]); }
    _winApi = { GM: GM, user32: user32, kernel32: kernel32 };
    return (_winApi);
}

// Retried from a timer, 10 times 20 ms, since clipboard managers hold it briefly and Sleep() stops the agent. fn() runs with it open.
// Handle kept, agents up to 1.2.6 drop an unreferenced setTimeout.
function win_withClipboard(fn)
{
    var user32 = win_api().user32;
    var ret = newPromise();
    var tries = 0;
    var attempt = function ()
    {
        if (user32.OpenClipboard(0).Val == 0)
        {
            if (++tries < 10) { ret.timer = setTimeout(attempt, 20); return; }
            ret._rej(ERR_WIN_OPEN_FAILED);
            return;
        }
        var value, err = null;
        try { value = fn(); } catch (e) { err = e; }
        user32.CloseClipboard();
        if (err != null) { ret._rej(err); } else { ret._res(value); }
    };
    attempt();
    return (ret);
}

function win_readtext()
{
    var api = win_api();

    // Empty without text (an image, files), like the watcher
    return (win_withClipboard(function ()
    {
        var ret = '';
        if (api.user32.IsClipboardFormatAvailable(CF_UNICODETEXT).Val != 0)
        {
            var h = api.user32.GetClipboardData(CF_UNICODETEXT);
            if (h.Val != 0)
            {
                var hbuffer = api.kernel32.GlobalLock(h);
                hbuffer._size = -1;
                ret = hbuffer.Wide2UTF8;
                api.kernel32.GlobalUnlock(h);
            }
        }
        return (ret);
    }));
}

function win_copytext(txt)
{
    var GMEM_MOVEABLE = 0x0002;
    var api = win_api();

    // Allocated after the open, so a refused open frees nothing, the clipboard owns it only after SetClipboardData()
    return (win_withClipboard(function ()
    {
        var mtxt = api.GM.CreateVariable(txt, { wide: true });
        var h = api.kernel32.GlobalAlloc(GMEM_MOVEABLE, mtxt._size);
        if (h.Val == 0) { throw ('GlobalAlloc failed'); }      // Out of memory, GlobalLock() and Deref() on it would crash the agent
        h.autoFree(false);
        var hbuffer = api.kernel32.GlobalLock(h);
        hbuffer.autoFree(false);
        mtxt.toBuffer().copy(hbuffer.Deref(0, mtxt._size).toBuffer());
        api.kernel32.GlobalUnlock(h);
        api.user32.EmptyClipboard();
        if (api.user32.SetClipboardData(CF_UNICODETEXT, h).Val == 0) { api.kernel32.GlobalFree(h); throw ('SetClipboardData failed'); }
    }));
}
// pbcopy or pbpaste as the console user, as root through launchctl asuser and sudo, LANG for UTF-8, killed after HELPER_READ_TIMEOUT_MS
function mac_runTool(tool, input)
{
    var ret = newPromise();
    var cmd = 'exec /usr/bin/' + tool, args = [];
    if (cachedIsRoot())
    {
        var uid, name;
        try { uid = resolveConsoleUid(); name = cachedUsername(uid); } catch (e) { ret._rej('No users logged in'); return (ret); }
        cmd = 'exec /bin/launchctl asuser "$0" /usr/bin/sudo -u "$1" /usr/bin/' + tool;
        args = [String(uid), name];
    }
    var child = require('child_process').execFile(SHELL_PATH, ['sh', '-c', SH_CLOSE_FDS + 'LANG=en_US.UTF-8; export LANG; ' + cmd].concat(args));
    ret.child = child;
    child.stderr.on('data', function (c) { });
    collectLimited(child, tool, function (text, code, fail)
    {
        if (fail != null) { ret._rej(fail); }
        else if (code != 0) { ret._rej(tool + ' failed with exit code ' + code); }
        else { ret._res(text); }
    });
    if (input != null) { child.stdin.write(input); }
    child.stdin.end();
    return (ret);
}

function macos_copytext(clipText)
{
    return (mac_runTool('pbcopy', toUnixNewlines(clipText)));
}

function macos_readtext()
{
    return (mac_runTool('pbpaste', null));
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
        Object.defineProperty(module.exports, "xclip", { get: lin_xclip });
        Object.defineProperty(module.exports, "wlclipboard", { get: lin_wlclipboard });
        break;
    case 'freebsd':
        if (require('fs').existsSync('/usr/local/bin/xclip'))
        {
            module.exports = xclip_copy;
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
// 'changed' fires on a login or logout (on Linux when /var/run/utmp changes), so the cached console user, X display, helper and watcher go at once
try { require('user-sessions').on('changed', resetSession); } catch (e) { }
// A lock does not move GetClipboardSequenceNumber(), so the watcher's copy is dropped at the lock
try { require('user-sessions').on('locked', function () { var w = _watcher; if ((w != null) && w.takesRequests) { w.gen++; w.valid = false; w.text = null; } }); } catch (e) { }

var POLLER_EXPIRY_MS = 5000;    // A session without a poll for this long stops getting pushes
var GC_INTERVAL_MS = 10000;     // garbage collection interval when automatic clipboard is on
var clipState = { lastLogged: null,
    lastFp: { text: null, fp: null },
    pollers: {},            // Desktop sessions that polled recently, by sessionid: { at, data }
    hooked: false,
    host: null,             // { log: MeshServerLogEx, console: sendConsoleText }
    setLast: { text: null, sessionid: null },
    gcAt: Date.now(),
    lastError: {} };        // Per session the last failed automatic read, { msg, at }

// Sent with each getclip reply and sent back by the next poll, an unchanged text then isn't resent
function fingerprint(str)
{
    if (clipState.lastFp.text === str) { return (clipState.lastFp.fp); }
    var fp;
    try { fp = require('SHA384Stream').create().syncHash(Buffer.from(str)).toString('hex').substring(0, 24); } catch (ex) { fp = null; }
    clipState.lastFp.text = str;
    clipState.lastFp.fp = fp;
    return (fp);
}

function prunePollers(now)
{
    var sid;
    for (sid in clipState.pollers) { if ((now - clipState.pollers[sid].at) > POLLER_EXPIRY_MS) { delete clipState.pollers[sid]; } }
    for (sid in clipState.lastError) { if ((now - clipState.lastError[sid].at) > POLLER_EXPIRY_MS) { delete clipState.lastError[sid]; } }
}

// When using polling, memory usage rises because duktape's own GC doesn't get to it. GC it ourselves. See also Ylianst/MeshAgent#415
function checkGC()
{
    var now = Date.now();
    if ((now - clipState.gcAt) < GC_INTERVAL_MS) { return; }
    clipState.gcAt = now;
    try { Duktape.gc(); } catch (ex) { }
}

// CRLF-normalized string compare to prevent cross OS mismatch
function matchesSetLast(str) { return ((clipState.setLast.text != null) && (toUnixNewlines(str) === toUnixNewlines(clipState.setLast.text))); }

// A watcher's new text goes to every page polling that watcher's session at once, so a copy on the device doesn't wait for the next poll
function pushToPollers(str, w)
{
    if (!str || isTooLarge(str)) { return; }
    var now = Date.now(), fp = fingerprint(str), logData = null, logAt = 0;
    var echo = matchesSetLast(str);
    prunePollers(now);
    for (var sid in clipState.pollers)
    {
        var t = clipState.pollers[sid];
        if ((w != null) && (t.key != null) && (t.key != w.key)) { continue; }    // A page that picked another session
        if (echo && (sid == clipState.setLast.sessionid)) { continue; }
        meshAgent.SendCommand({ action: 'msg', type: 'getclip', sessionid: sid, data: str, tag: 3, fp: fp });
        if ((logData == null) || (t.at < logAt)) { logData = t.data; logAt = t.at; } // The event names the earliest poll, not the session the loop visited last
    }
    if (echo) { clipState.setLast.text = null; clipState.lastLogged = str; }    // Cleared by the echo only, a copy on the device arriving first doesn't make the echo a new copy
    else if ((logData != null) && (str !== clipState.lastLogged))
    {
        clipState.host.log(21, [str.length], "Getting clipboard content, " + str.length + " byte(s)", logData);
        clipState.lastLogged = str;
    }
}

// Read also routes darwin through dispatch, so a hand-started Mac agent reuses the watcher instead of pbpaste
function clipRead(sid) { return ((meshAgent.isService || (process.platform == 'darwin')) ? dispatchRead(sid) : module.exports.read()); }
function clipWrite(txt, sid) { return (meshAgent.isService ? dispatchWrite(txt, sid) : module.exports(txt)); }
// The session the page picked for its desktop, null for the console. Windows only, Linux takes seat0's user
function pickedSession(data) { return (((process.platform == 'win32') && (typeof data.tsid == 'number') && (data.tsid > 0)) ? data.tsid : null); }

function getclip(data, allowed, host)
{
    // Failed automatic reads (tag 3) go to the session's console when the reason changes. Dialog reads (tag 1) show it in the dialog and the console, the tag 2 button in the console
    var failed = function (e)
    {
        var msg = 'getclip: ' + e;
        if (data.tag == 1) { meshAgent.SendCommand({ action: 'msg', type: 'getclip', sessionid: data.sessionid, tag: 1, error: String(e) }); }
        if (data.tag != 3) { host.console(msg, data.sessionid); }
        else
        {
            var last = clipState.lastError[data.sessionid];
            clipState.lastError[data.sessionid] = { msg: msg, at: Date.now() };
            if ((last == null) || (last.msg != msg)) { host.console(msg, data.sessionid); }
        }
    };
    // Checked before the session becomes a push target, so a view-only page gets no pushes either
    if (!allowed) { failed('not allowed with view-only desktop rights'); return; }
    // An automatic read is logged only when the text changed, otherwise every Desktop session adds one event per second
    var send = function (str)
    {
        delete clipState.lastError[data.sessionid];
        // After an empty clipboard, the same text copied again counts as a new copy
        if (!str) { if (data.tag == 3) { clipState.lastLogged = null; } return; }
        if (isTooLarge(str)) { failed(ERR_TOO_LARGE); return; }
        var fp = fingerprint(str);
        if ((data.tag == 3) && (fp != null) && (data.known === fp)) { return; } // The page already has this text
        if ((data.tag == 3) && matchesSetLast(str)) { clipState.lastLogged = str; } // A setclip read back isn't a new copy and isn't logged
        if ((data.tag != 3) || (str !== clipState.lastLogged))
        {
            host.log(21, [str.length], "Getting clipboard content, " + str.length + " byte(s)", data);
            if (data.tag == 3) { clipState.lastLogged = str; }
        }
        meshAgent.SendCommand({ action: 'msg', type: 'getclip', sessionid: data.sessionid, data: str, tag: data.tag, fp: fp });
    };
    if ((data.tag == 3) && (typeof data.sessionid == 'string'))
    {
        // Pruned here too, an agent without a watcher never pushes and would keep one entry per desktop session
        var now = Date.now();
        prunePollers(now);
        checkGC();
        clipState.pollers[data.sessionid] = { at: now, data: data };
        if (!clipState.hooked) { clipState.hooked = true; clipState.host = host; _watchListener = pushToPollers; }
    }
    try
    {
        var p = clipRead(pickedSession(data));
        // The watcher this read used, pushes from another session's watcher are not for this page
        if ((data.tag == 3) && (clipState.pollers[data.sessionid] != null)) { clipState.pollers[data.sessionid].key = (_watcher != null) ? _watcher.key : null; }
        p.then(send, failed);
    }
    catch (ex) { failed(ex); }     // dispatchRead() throws before it has a promise when the console user lookup fails
}

function setclip(data, allowed, host)
{
    // The clipboard dialog shows Success, or Failed with the reason, which also goes to the console. A write that returns a promise answers with its outcome, others with Success
    var answer = function (err)
    {
        var m = { action: 'msg', type: 'setclip', sessionid: data.sessionid, success: (err == null) };
        if (err != null) { m.error = String(err); host.console('setclip: ' + err, data.sessionid); }
        meshAgent.SendCommand(m);
    };
    if (!allowed) { answer('not allowed with view-only desktop rights'); return; }
    if (typeof data.data != 'string') { return; }
    host.log(22, [data.data.length], "Setting clipboard content, " + data.data.length + " byte(s)", data);
    clipState.setLast.text = data.data; clipState.setLast.sessionid = data.sessionid;
    try
    {
        checkGC();
        var p = clipWrite(data.data, pickedSession(data));
        if ((p != null) && (typeof p.then == 'function')) { p.then(function () { answer(); }, answer); } else { answer(); }
    }
    catch (ex) { answer(ex); }
}

function consoleGetclip(sessionid, host)
{
    var err = function (e) { host.console('getclip: ' + e, sessionid); };
    try { clipRead().then(function (str) { host.console(str, sessionid); }, err); } catch (ex) { err(ex); }
}

function consoleSetclip(txt, sessionid, host)
{
    var err = function (e) { host.console('setclip: ' + e, sessionid); };
    try
    {
        checkGC();
        var p = clipWrite(txt);
        if ((p != null) && (typeof p.then == 'function')) { p.then(function () { }, err); }
    }
    catch (ex) { err(ex); }
}

module.exports.nativeAddModule = nativeAddModule;
module.exports.nativeAddCompressedModule = nativeAddCompressedModule;
module.exports.nativeBase64 = nativeBase64;
module.exports.dispatchWrite = dispatchWrite;
module.exports.dispatchRead = dispatchRead;
module.exports.getclip = getclip;
module.exports.setclip = setclip;
module.exports.consoleGetclip = consoleGetclip;
module.exports.consoleSetclip = consoleSetclip;
