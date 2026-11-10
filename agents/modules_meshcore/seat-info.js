/*
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

// seat0's active session as logind itself records it, read from its state files without starting a process.
// loginctl list-sessions cannot be parsed reliably, a logged-out user's session stays listed while it is closing.

var SEAT0_PATH = '/run/systemd/seats/seat0';
var SESSIONS_PATH = '/run/systemd/sessions/';
var CACHE_MS = 1000;    // Automatic Clipboard asks several times a second
var _cache = null, _cacheAt = 0;

// KEY=VALUE lines of a logind state file as an object, null when the file cannot be read
function readState(path)
{
    var s, ret = {};
    // toString() of an empty buffer gives null on these agents
    try { var b = require('fs').readFileSync(path); s = (b != null && b.length > 0) ? b.toString() : ''; } catch (e) { return (null); }
    var lines = s.split('\n');
    for (var i = 0; i < lines.length; ++i)
    {
        var k = lines[i].indexOf('=');
        if ((k > 0) && (lines[i][0] != '#')) { ret[lines[i].substring(0, k)] = lines[i].substring(k + 1); }
    }
    return (ret);
}

// { session, uid, class, type, desktop, leader } of seat0's active session. null without logind, or without an active session on seat0
function active()
{
    var now = Date.now();
    if ((now - _cacheAt) < CACHE_MS) { return (_cache); }
    _cacheAt = now; _cache = null;
    if (process.platform != 'linux') { return (null); }
    var seat = readState(SEAT0_PATH);
    if ((seat == null) || !seat.ACTIVE || !/^[0-9]+$/.test(seat.ACTIVE_UID || '')) { return (null); }
    var ses = readState(SESSIONS_PATH + seat.ACTIVE) || {};
    _cache = { session: seat.ACTIVE, uid: parseInt(seat.ACTIVE_UID), class: ses.CLASS || null, type: ses.TYPE || null, desktop: ses.DESKTOP || null, leader: ses.LEADER || null };
    return (_cache);
}

// true when logind runs here, so a null from active() means nobody is at seat0
function hasLogind() { return ((process.platform == 'linux') && require('fs').existsSync(SEAT0_PATH)); }

// true while a display manager's login screen is the active session, the uid check covers a session file that cannot be read
function isGreeter() { var a = active(); return ((a != null) && ((a.class == 'greeter') || (a.uid < 1000))); }

// Makes the agent's user-sessions.consoleUid() answer from seat0, for callers the server cannot change (agentcore.c at the KVM start, message-box, toaster).
// The agent's own version parses loginctl list-sessions and names a logged-out user while that session is closing.
// Does nothing once the agent has the fix: its own marker, or desktopSessions() from the session picker.
function patchUserSessions()
{
    if (process.platform != 'linux') { return (false); }
    var us = require('user-sessions');
    if (us.consoleUidUsesSeat0 || (typeof us.desktopSessions == 'function') || (typeof us.consoleUid != 'function')) { return (false); }
    var orig = us.consoleUid;
    us.consoleUid = function consoleUid(options)
    {
        var a = active();
        // The greeter's uid is returned as it is, agentcore.c compares it with gdmUid and then captures the login screen as root
        if (a != null) { return ((options && options.active == true) ? [a.uid] : a.uid); }
        return (orig.apply(us, arguments));     // Without logind, or with nobody at seat0
    };
    us.consoleUidUsesSeat0 = true;
    return (true);
}

// Resolves true while the console session's screen is locked, false when the tools are missing or give no answer in LOCK_CHECK_MS.
// Linux: logind's LockedHint, which GNOME's and KDE's lockers set, then the desktop's own locker over D-Bus (xfce4-screensaver).
// macOS: CGSSessionScreenIsLocked of the console user in the I/O registry, which root can read.
var LOCK_CHECK_MS = 2000;
var LOCKED_KEEP_MS = 2000;  // A locked answer is kept this long, a page polling a locked session asks every second
var _lockedAt = 0, _lockedSession = null;
function isLocked()
{
    var promise = require('promise');
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var key = (process.platform == 'darwin') ? 'console' : null, a = null;
    if (process.platform == 'linux') { a = active(); if (a != null) { key = a.session; } }
    if (key == null) { ret._res(false); return (ret); }
    if ((_lockedSession == key) && ((Date.now() - _lockedAt) < LOCKED_KEEP_MS)) { ret._res(true); return (ret); }
    var finish = function (locked) { if (locked) { _lockedSession = key; _lockedAt = Date.now(); } else { _lockedSession = null; } ret._res(locked); };
    if (process.platform == 'darwin')
    {
        runTool('/usr/sbin/ioreg', ['ioreg', '-n', 'Root', '-d1', '-a'], null).then(function (out) { finish((out != null) && macConsoleLocked(out)); });
        return (ret);
    }
    runTool(findTool('loginctl'), ['loginctl', 'show-session', a.session, '-p', 'LockedHint', '--value'], null).then(function (out)
    {
        if ((out != null) && (out.trim() == 'yes')) { finish(true); return; }
        var name = lockerBusName(a);
        if (name == null) { finish(false); return; }
        // As the user on the user's own session bus, root has no access to it
        var opts = { uid: a.uid, env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/' + a.uid + '/bus', PATH: process.env['PATH'] || '/usr/bin:/bin' } };
        runTool(findTool('dbus-send'), ['dbus-send', '--session', '--print-reply', '--dest=' + name, '/' + name.split('.').join('/'), name + '.GetActive'], opts).then(function (o)
        {
            finish((o != null) && /boolean\s+true/.test(o));
        });
    });
    return (ret);
}

function findTool(name) { try { return (require('lib-finderV2').findBinary(name)); } catch (e) { return (null); } }

// Resolves the stdout of one program started directly, null when it cannot start or gives no answer in LOCK_CHECK_MS
function runTool(bin, argv, opts)
{
    var promise = require('promise');
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if ((bin == null) || !require('fs').existsSync(bin)) { ret._res(null); return (ret); }
    var child = null, out = [], done = false, timer = null;
    var finish = function (v) { if (done) { return; } done = true; try { clearTimeout(timer); } catch (e) { } ret._res(v); };   // clearTimeout() throws for a timer that already fired
    try { child = (opts != null) ? require('child_process').execFile(bin, argv, opts) : require('child_process').execFile(bin, argv); } catch (e) { ret._res(null); return (ret); }
    // The agent only sees a child's exit through a pipe it reads, so both pipes get a listener. Chunks are copied, the agent reuses their memory
    child.stdout.on('data', function (c) { out.push(Buffer.concat([c])); });
    child.stderr.on('data', function (c) { });
    child.on('exit', function () { var b = Buffer.concat(out); finish((b.length > 0) ? b.toString() : ''); });
    timer = setTimeout(function () { try { child.kill(); } catch (e) { } finish(null); }, LOCK_CHECK_MS);
    return (ret);
}

// The D-Bus name of the desktop's own locker. null for GNOME and KDE, which set LockedHint, and for unknown desktops
var LOCKER_BUS_NAMES = { xfce: 'org.xfce.ScreenSaver', mate: 'org.mate.ScreenSaver', cinnamon: 'org.cinnamon.ScreenSaver', 'x-cinnamon': 'org.cinnamon.ScreenSaver' };
var _desktopOf = { session: null, name: null };
function lockerBusName(a)
{
    var name = LOCKER_BUS_NAMES[sessionDesktop(a)];
    return ((name != null) ? name : null);
}

// logind's DESKTOP for the session, which LightDM sets and GDM leaves out for X11, else XDG_CURRENT_DESKTOP of the session leader's children (gdm-x-session).
// Read from /proc without a process, once per session
function sessionDesktop(a)
{
    if (_desktopOf.session == a.session) { return (_desktopOf.name); }
    var name = a.desktop;
    if (!name && a.leader)
    {
        var fs = require('fs'), pids = [];
        try { pids = fs.readdirSync('/proc'); } catch (e) { }
        for (var i = 0; (i < pids.length) && !name; ++i)
        {
            if (!/^[0-9]+$/.test(pids[i])) { continue; }
            var st = readText('/proc/' + pids[i] + '/stat');
            var m = (st != null) ? /\)\s+\S+\s+([0-9]+)/.exec(st) : null;     // ppid follows the state, after the name in parentheses
            if ((pids[i] != a.leader) && ((m == null) || (m[1] != a.leader))) { continue; }
            var env = nulFields('/proc/' + pids[i] + '/environ');
            for (var k = 0; k < env.length; ++k) { if (env[k].substring(0, 20) == 'XDG_CURRENT_DESKTOP=') { name = env[k].substring(20).split(':')[0]; break; } }
        }
    }
    _desktopOf = { session: a.session, name: name ? name.toLowerCase() : null };
    return (_desktopOf.name);
}

// toString() of an empty buffer gives null on these agents
function readText(path) { try { var b = require('fs').readFileSync(path); return ((b != null && b.length > 0) ? b.toString() : ''); } catch (e) { return (null); } }

// The NUL-separated fields of a file such as /proc/<pid>/environ, split by byte because the agent's toString() stops at the first NUL
function nulFields(path)
{
    var b = null, ret = [], start = 0;
    try { b = require('fs').readFileSync(path); } catch (e) { return (ret); }
    for (var i = 0; (b != null) && (i < b.length); ++i) { if (b[i] == 0) { if (i > start) { ret.push(b.slice(start, i).toString()); } start = i + 1; } }
    if ((b != null) && (start < b.length)) { ret.push(b.slice(start).toString()); }
    return (ret);
}

// true when the IOConsoleUsers entry that is on the console has CGSSessionScreenIsLocked set, in ioreg's XML. The key is missing while unlocked
function macConsoleLocked(xml)
{
    var i = xml.indexOf('<key>IOConsoleUsers</key>');
    if (i < 0) { return (false); }
    var users = xml.substring(i).split('<dict>');
    for (var u = 1; u < users.length; ++u)
    {
        if (/<key>kCGSSessionOnConsoleKey<\/key>\s*<true\/>/.test(users[u]) && /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(users[u])) { return (true); }
    }
    return (false);
}

module.exports = { active: active, hasLogind: hasLogind, isGreeter: isGreeter, isLocked: isLocked, patchUserSessions: patchUserSessions };
