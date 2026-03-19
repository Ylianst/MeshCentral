/*
Copyright 2022 Intel Corporation
@author Bryan Roe

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

//
// win-deskutils is a utility module that exposes various desktop related features for Windows
// such as MouseTrails Accessability and Windows Desktop Background
//

//
// MSDN documention for the system call this module relies on can be found at:
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfoa
//

var SPI_GETDESKWALLPAPER = 0x0073;
var SPI_SETDESKWALLPAPER = 0x0014;
var SPI_GETMOUSETRAILS = 0x005E;
var SPI_SETMOUSETRAILS = 0x005D;

var GM = require('_GenericMarshal');
var user32 = GM.CreateNativeProxy('user32.dll');
user32.CreateMethod('SystemParametersInfoA');
user32.CreateMethod('GetLastInputInfo');
var kernel32 = GM.CreateNativeProxy('kernel32.dll');
kernel32.CreateMethod('GetTickCount');

//
// This function is a helper method to dispatch method calls to different user sessions
//
function sessionDispatch(tsid, parent, method, args)
{
    //
    // Check to see if the process owner of the current processor is root
    //
    var sid = undefined;
    var stype = require('user-sessions').getProcessOwnerName(process.pid).tsid == 0 ? 1 : 0;
    /*
        The following is the list of possible values for stype.
        If the current process owner is root, we set the stype to user,
        because we cannot set/get any properties from this user, we
        must switch to a user session.. Default behavior for stype(1)
        is that it will context switch to the logged in user. If
        this is not intended, then an actual user TSID must be specified, using
        ILibProcessPipe_SpawnTypes_SPECIFIED_USER and the actual TSID
        ------------------------------------------------------------------------
        ILibProcessPipe_SpawnTypes_DEFAULT = 0,
        ILibProcessPipe_SpawnTypes_USER = 1,
        ILibProcessPipe_SpawnTypes_WINLOGON = 2,
        ILibProcessPipe_SpawnTypes_TERM = 3,
        ILibProcessPipe_SpawnTypes_DETACHED = 4,
        ILibProcessPipe_SpawnTypes_SPECIFIED_USER = 5,
        ILibProcessPipe_SpawnTypes_POSIX_DETACHED = 0x8000
        ------------------------------------------------------------------------
    */
    console.log('stype: ' + stype);
    if (stype == 1)
    {
        if (tsid == null && require('MeshAgent')._tsid != null)
        {
            stype = 5;                          // ILibProcessPipe_SpawnTypes_SPECIFIED_USER
            sid = require('MeshAgent')._tsid;   // If this is set, it was set via user selection UI
        }
        else
        {
            sid = tsid;                         // Set the SID to be whatever was passed in
        }
    }

    // Spawn a child process in the appropriate user session, and relay the response back via stdout
    var mod = Buffer.from(getJSModule('win-deskutils')).toString('base64');
    var prog = "try { addModule('win-deskutils', process.env['win_deskutils']);} catch (x) { } var x;try{x=require('win-deskutils').dispatch('" + parent + "', '" + method + "', " + JSON.stringify(args) + ");console.log(x);}catch(z){console.log(z);process.exit(1);}process.exit(0);";
    var child = require('child_process').execFile(process.execPath, [process.execPath.split('\\').pop(), '-b64exec', Buffer.from(prog).toString('base64')], { type: stype, uid: sid, env: { win_deskutils: getJSModule('win-deskutils') } });

    child.stdout.str = '';
    child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.on('data', function (c) { });
    child.on('exit', function (c) { this.exitCode = c; });
    child.waitExit();
    if (child.exitCode == 0)
    {
        return (child.stdout.str.trim()); // If the return code was 0, then relay the response from stdout
    }
    else
    {
        throw (child.stdout.str.trim()); // If the return code was nonzero, then the stdout response is the exception that should be bubbled
    }
}

//
// This function gets the path of the windows desktop background of the specified user desktop session
//
function background_get(tsid)
{
    if (tsid != null || tsid === null) // TSID is not undefined or is explicitly null
    {
        // Need to disatch to different session first
        return (sessionDispatch(tsid, 'background', 'get', []));
    }
    var v = GM.CreateVariable(1024);
    var ret = user32.SystemParametersInfoA(SPI_GETDESKWALLPAPER, v._size, v, 0);
    if (ret.Val == 0)
    {
        throw ('Error occured trying to fetch wallpaper');
    }
    return (v.String);
}

//
// This function sets the path for the windows desktop background of the specified user desktop session
//
function background_set(path, tsid)
{
    if (tsid != null || tsid === null) // TSID is not undefined or is explicitly null
    {
        // Need to disatch to different session first
        return (sessionDispatch(tsid, 'background', 'set', [path]));
    }
    var nb = GM.CreateVariable(path);
    var ret = user32.SystemParametersInfoA(SPI_SETDESKWALLPAPER, nb._size, nb, 0);
    if (ret.Val == 0)
    {
        throw ('Error occured trying to set wallpaper');
    }
    return;
}

//
// This is a helper function that is called by the child process from sessionDispatch()
//
function dispatch(parent, method, args)
{
    try
    {
        return (this[parent][method].apply(this, args));
    }
    catch (e)
    {
        console.log('ERROR: ' + e);
        throw ('Error occured trying to dispatch: ' + method);
    }
}

//
// This function sets the mousetrail accessibility feature, for the specified user desktop session.
// Setting value 0 or one disables this feature
// Otherwise, value is the number of cursors to render for this feature
//
function mousetrails_set(value, tsid)
{
    if (tsid != null || tsid === null) // TSID is not undefined or is explicitly null
    {
        // Need to disatch to different session first
        return (sessionDispatch(tsid, 'mouse', 'setTrails', [value]));
    }
    var ret = user32.SystemParametersInfoA(SPI_SETMOUSETRAILS, value, 0, 0);
    if (ret.Val == 0)
    {
        throw ('Error occured trying to fetch wallpaper');
    }
}

//
// This function returns the number of cursors the mousetrail accessibility feature will render
// A value of 0 or 1 means the feature is disabled, otherwise it is the number of cursors that will be rendered
//
function mousetrails_get(tsid)
{
    if (tsid != null || tsid === null) // TSID is not undefined or is explicitly null
    {
        // Need to disatch to different session first
        return (sessionDispatch(tsid, 'mouse', 'getTrails', []));
    }
    var v = GM.CreateVariable(4);
    var ret = user32.SystemParametersInfoA(SPI_GETMOUSETRAILS, v._size, v, 0);
    if (ret.Val == 0)
    {
        throw ('Error occured trying to fetch wallpaper');
    }
    return (v.toBuffer().readUInt32LE());
}

//
// This function returns the number of seconds since the last keyboard or mouse input from the user.
// It uses GetLastInputInfo from user32.dll to retrieve the last input tick count,
// then compares it against the current tick count from GetTickCount.
//
// Both GetTickCount and the dwTime field from GetLastInputInfo are 32-bit values that wrap
// around after approximately 49.7 days. This function handles the wraparound case correctly.
//
// MSDN documentation:
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
//
function idle_getSeconds(tsid)
{
    if (tsid != null || tsid === null) // TSID is not undefined or is explicitly null
    {
        // Need to dispatch to different session first
        return (sessionDispatch(tsid, 'idle', 'getSeconds', []));
    }
    
    // Allocate 8 bytes for the LASTINPUTINFO struct:
    //   UINT  cbSize  (offset 0, 4 bytes) - must be set to 8 before calling
    //   DWORD dwTime  (offset 4, 4 bytes) - tick count of last input event
    var lii = GM.CreateVariable(8);

    // cbSize must be set to the size of the struct (8) before calling
    lii.toBuffer().writeUInt32LE(8, 0);

    var ret = user32.GetLastInputInfo(lii);
    if (ret.Val == 0)
    {
        throw ('Error occured trying to get last input info');
    }

    // Read dwTime from byte offset 4
    var dwTime = lii.toBuffer().readUInt32LE(4);

    // GetTickCount returns the number of milliseconds since system boot (32-bit, wraps after ~49.7 days)
    var tickNow = kernel32.GetTickCount().Val;

    // Handle 32-bit wraparound case
    var idleMs;
    if (tickNow >= dwTime)
    {
        // Normal case: no wraparound
        idleMs = tickNow - dwTime;
    }
    else
    {
        // Wraparound occurred: tickNow wrapped to 0 while dwTime is still large
        // Calculate the time from dwTime to the wrap point (0xFFFFFFFF) plus time since wrap
        idleMs = (0xFFFFFFFF - dwTime) + tickNow + 1;
    }

    return Math.floor(idleMs / 1000);
}

//
// This function returns the minimum idle time across all active/connected user sessions.
// This is useful for detecting if ANY user (console or RDP) is actively using the machine.
// Returns a promise that resolves to the minimum idle seconds, or -1 if no users are logged in.
//
function idle_getSecondsAllSessions()
{
    var promise = require('promise');
    return new promise(function (resolve, reject)
    {
        require('user-sessions').enumerateUsers().then(function (sessions)
        {
            var minIdleSeconds = Infinity;
            for (var sessionId in sessions)
            {
                var session = sessions[sessionId];
                
                // Only check Active sessions with a logged-in user (Username is present)
                // Skip "Connected" sessions (console when disconnected) and "Listening" sessions
                if (session.State === 'Active' && session.Username && session.Username !== '')
                {
                    try
                    {
                        var idleSeconds = parseFloat(sessionDispatch(session.SessionId, 'idle', 'getSeconds', []));
                        if (idleSeconds < minIdleSeconds)
                        {
                            minIdleSeconds = idleSeconds;
                        }
                    }
                    catch (e)
                    {
                        // Session might not support GetLastInputInfo, skip it
                    }
                }
            }
            
            // If no active user sessions found, return -1 to indicate "no users logged in"
            resolve(minIdleSeconds === Infinity ? -1 : Math.floor(minIdleSeconds));
        }).catch(function (err)
        {
            reject(err);
        });
    });
}

module.exports = { background: { get: background_get, set: background_set } };
module.exports.mouse = { getTrails: mousetrails_get, setTrails: mousetrails_set };
module.exports.idle = { getSeconds: idle_getSeconds, getSecondsAllSessions: idle_getSecondsAllSessions };
module.exports.dispatch = dispatch;