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

// { session, uid, class, type } of seat0's active session. null without logind, or without an active session on seat0
function active()
{
    var now = Date.now();
    if ((now - _cacheAt) < CACHE_MS) { return (_cache); }
    _cacheAt = now; _cache = null;
    if (process.platform != 'linux') { return (null); }
    var seat = readState(SEAT0_PATH);
    if ((seat == null) || !seat.ACTIVE || !/^[0-9]+$/.test(seat.ACTIVE_UID || '')) { return (null); }
    var ses = readState(SESSIONS_PATH + seat.ACTIVE) || {};
    _cache = { session: seat.ACTIVE, uid: parseInt(seat.ACTIVE_UID), class: ses.CLASS || null, type: ses.TYPE || null };
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

module.exports = { active: active, hasLogind: hasLogind, isGreeter: isGreeter, patchUserSessions: patchUserSessions };
