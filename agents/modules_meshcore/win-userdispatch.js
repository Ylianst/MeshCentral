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

//
// win-userdispatch
//
// Runs a JavaScript module in a child agent process that runs as the user logged into a Windows session.
// Same API and IPC protocol as the built-in 'win-dispatcher' module, but instead of using the Windows Task Scheduler,
// the child agent is started directly with the user's own logon token (WTSQueryUserToken + CreateProcessAsUserW),
// and without a console window, so nothing flashes on the user's screen.
//
// The agent must be running as LocalSystem to do this. If it is not (for example in connect mode, as an elevated user),
// dispatch() falls back to the built-in win-dispatcher, which uses the Task Scheduler like MeshCentral did before.
//
// dispatch(options)
//    options.sessionId   Windows session id to run in (optional)
//    options.user        "DOMAIN\Username" to run as (optional, used if sessionId is not set). Defaults to the console user, or any active user.
//    options.console     true when the launched module needs a real console window: the child then starts with no console and
//                        the module creates one with AllocConsole() (shown minimized, the module must hide it). Needed by the
//                        legacy win-terminal module used on Windows 7/8. Otherwise the child gets a console with no window.
//    options.noConsole   true to start the child with no console at all, for modules that do not need one. Use this on
//                        Windows 7/8, where having the system create the child's console at startup fails.
//    options.modules     [{ name, script }] modules to load in the child
//    options.launch      { module, method, args, split } method to launch in the child, it must return a stream (or { in, out } when split is true)
//
// Returns an EventEmitter with:
//    'connection' event  Emitted with the stream to the launched method once the child is connected
//    invoke(method, args) Invoke a method on the launched stream object in the child
//    close()             Close the IPC, the child will exit
//    status()            Text describing if the child is still running or its exit code, for error reporting
//    sessionId, user     The session and user the child runs as
//

var CREATE_UNICODE_ENVIRONMENT = 0x00000400;
var CREATE_NO_WINDOW = 0x08000000;
var DETACHED_PROCESS = 0x00000008;
var ERROR_PRIVILEGE_NOT_HELD = 1314;
var STARTF_USESHOWWINDOW = 0x00000001;
var SW_SHOWMINNOACTIVE = 7;

var GM = null;
var k32 = null, wts = null, adv = null, uenv = null;

function loadNative() {
    if (GM != null) return;
    GM = require('_GenericMarshal');
    k32 = GM.CreateNativeProxy('kernel32.dll');
    k32.CreateMethod('CloseHandle');
    k32.CreateMethod('GetExitCodeProcess');
    k32.CreateMethod('GetLastError');
    wts = GM.CreateNativeProxy('Wtsapi32.dll');
    wts.CreateMethod('WTSQueryUserToken');                  // https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken
    adv = GM.CreateNativeProxy('Advapi32.dll');
    adv.CreateMethod('CreateProcessAsUserW');               // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw
    uenv = GM.CreateNativeProxy('Userenv.dll');
    uenv.CreateMethod('CreateEnvironmentBlock');            // https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createenvironmentblock
    uenv.CreateMethod('DestroyEnvironmentBlock');
}

function empty_func() { }

//
// Find the active session to run in. Returns the session object from user-sessions.Current()
//
function findSession(options) {
    var us = require('user-sessions');
    var sessions = us.Current();
    var i, s;

    if (options.sessionId != null) {
        s = sessions[options.sessionId];
        if ((s == null) || (s.State != 'Active') || !s.Username) { throw ('No user logged into session ' + options.sessionId); }
        return (s);
    }

    var consoleId = null;
    try { consoleId = us.consoleUid(); } catch (ex) { }
    var active = sessions.Active || [];

    if (options.user) {
        var want = options.user;
        if (want[0] == '"') { want = want.substring(1, want.length - 1); }
        want = want.toLowerCase();
        var matches = [];
        for (i = 0; i < active.length; ++i) {
            var full = ((active[i].Domain ? (active[i].Domain + '\\') : '') + active[i].Username).toLowerCase();
            if ((full == want) || (active[i].Username.toLowerCase() == want)) { matches.push(active[i]); }
        }
        for (i = 0; i < matches.length; ++i) { if (matches[i].SessionId == consoleId) { return (matches[i]); } }
        if (matches.length > 0) { return (matches[0]); }
        throw ('User ' + options.user + ' is not logged in');
    }

    s = sessions[consoleId];
    if ((s != null) && (s.State == 'Active') && s.Username) { return (s); }
    if (active.length > 0) { return (active[0]); }
    throw ('No user logged in');
}

//
// Start "<agent> -b64exec <script>" as the user logged into the given session
//
function launchAsUser(sessionId, b64script, withConsole, noConsole) {
    loadNative();

    var token = GM.CreatePointer();
    if (wts.WTSQueryUserToken(sessionId, token).Val == 0) {
        var qerr = k32.GetLastError().Val;
        // ERROR_PRIVILEGE_NOT_HELD: the agent is not running as LocalSystem (for example in connect mode, as an elevated user)
        if (qerr == ERROR_PRIVILEGE_NOT_HELD) { throw ({ notSystem: true, toString: function () { return ('WTSQueryUserToken failed, the agent is not running as LocalSystem'); } }); }
        throw ('WTSQueryUserToken failed, error ' + qerr);
    }

    // Use the user's own environment (USERPROFILE, TEMP, APPDATA...) instead of the agent's
    var envBlock = GM.CreatePointer();
    var hasEnv = (uenv.CreateEnvironmentBlock(envBlock, token.Deref(), 0).Val != 0);

    // STARTUPINFOW, 104 bytes on 64 bit, 68 bytes on 32 bit
    var si = GM.CreateVariable(GM.PointerSize == 8 ? 104 : 68);
    si.toBuffer().writeUInt32LE(GM.PointerSize == 8 ? 104 : 68, 0);                                        // si.cb
    var desktop = GM.CreateVariable('winsta0\\default', { wide: true });                                   // Must be set, the default is the agent's service desktop
    desktop.pointerBuffer().copy(si.Deref(GM.PointerSize == 8 ? 16 : 8, GM.PointerSize).toBuffer());       // si.lpDesktop
    var flags = hasEnv ? CREATE_UNICODE_ENVIRONMENT : 0;
    if (withConsole) {
        // The child starts with no console at all, the launched module creates its own with AllocConsole() once running.
        // On Windows 7, having the system create the console while the process starts (from our service) fails, and the
        // process dies with STATUS_DLL_INIT_FAILED (0xC0000142) before running any code.
        // The show state below applies to the console window AllocConsole() creates: minimized, without taking focus.
        flags |= DETACHED_PROCESS;
        si.Deref(GM.PointerSize == 8 ? 60 : 44, 4).toBuffer().writeUInt32LE(STARTF_USESHOWWINDOW);        // si.dwFlags
        si.Deref(GM.PointerSize == 8 ? 64 : 48, 2).toBuffer().writeUInt16LE(SW_SHOWMINNOACTIVE);           // si.wShowWindow
    } else if (noConsole) {
        // The child starts with no console at all and does not need one (see above for why this matters on Windows 7)
        flags |= DETACHED_PROCESS;
    } else {
        // The child gets a console with no window at all
        flags |= CREATE_NO_WINDOW;
    }

    var pi = GM.CreateVariable(GM.PointerSize == 4 ? 16 : 24);                                             // PROCESS_INFORMATION
    var appName = GM.CreateVariable(process.execPath, { wide: true });
    var cmdLine = GM.CreateVariable('"' + process.execPath + '" -b64exec ' + b64script, { wide: true });

    var ok = adv.CreateProcessAsUserW(token.Deref(), appName, cmdLine, 0, 0, 0, flags, hasEnv ? envBlock.Deref() : 0, 0, si, pi).Val;
    var err = (ok == 0) ? k32.GetLastError().Val : 0;
    if (hasEnv) { uenv.DestroyEnvironmentBlock(envBlock.Deref()); }
    k32.CloseHandle(token.Deref());
    if (ok == 0) { throw ('CreateProcessAsUserW failed, error ' + err); }

    var pid = pi.Deref(GM.PointerSize == 4 ? 8 : 16, 4).toBuffer().readUInt32LE();                       // pi.dwProcessId
    k32.CloseHandle(pi.Deref(GM.PointerSize, GM.PointerSize).Deref());                                     // pi.hThread
    // Keep pi.hProcess open so status() can tell if the child exited and with what code, it is closed by close()
    return ({ pid: pid, pi: pi, hProcess: pi.Deref(0, GM.PointerSize).Deref() });
}

// Returns a string describing the state of the child process: running, or exited with its exit code
function dispatcher_status() {
    if (this._child == null) { return ('not started'); }
    if (this._child.hProcess == null) { return ('pid ' + this.pid + ', handle closed'); }
    var code = GM.CreateVariable(4);
    if (k32.GetExitCodeProcess(this._child.hProcess, code).Val == 0) { return ('pid ' + this.pid + ', unable to get status, error ' + k32.GetLastError().Val); }
    var c = code.toBuffer().readUInt32LE();
    if (c == 259) { return ('pid ' + this.pid + ' is still running'); } // STILL_ACTIVE
    return ('pid ' + this.pid + ' exited with code 0x' + c.toString(16).toUpperCase());
}

//
// IPC handling, same protocol as win-dispatcher so the child side can use require('win-dispatcher').connect()
//
function writeMessage(s, obj) {
    var d = Buffer.from(JSON.stringify(obj)), h = Buffer.alloc(4);
    h.writeUInt32LE(d.length + 4);
    s.write(h);
    s.write(d);
}

function ipc_invoke(method, args) {
    writeMessage(this._control, { command: 'invoke', value: { method: method, args: args } });
}

// Control channel connection
function ipc2_connection(s) {
    this.parent._control = s;
    this.parent._control._parent = this;
    this.close();
    this.parent.invoke = ipc_invoke;
    s.on('end', empty_func);                // Do not remove, keeps the control channel flowing
    s.on('error', empty_func);
}

// Primary connection, used to load the modules, launch the method and then as the stream to it
function ipc_connection(s) {
    var parent = this.parent;
    parent._client = s;
    parent._client._parent = this;
    this.close();
    s.descriptorMetadata = 'win-userdispatch, ' + parent.options.launch.module + '.' + parent.options.launch.method + '()';
    for (var m in parent.options.modules) {
        writeMessage(s, { command: 'addModule', value: { name: parent.options.modules[m].name, js: parent.options.modules[m].script } });
    }
    writeMessage(s, { command: 'launch', value: { split: parent.options.launch.split ? true : false, module: parent.options.launch.module, method: parent.options.launch.method, args: parent.options.launch.args } });
    // The child is connected, its process handle is no longer needed for error reporting
    if ((parent._child != null) && (parent._child.hProcess != null)) {
        try { k32.CloseHandle(parent._child.hProcess); } catch (ex) { }
        parent._child.hProcess = null;
    }
    parent.emit('connection', s);
}

function dispatcher_shutdown() {
    try { if (this._ipc != null) { this._ipc.close(); } } catch (ex) { }
    try { if (this._ipc2 != null) { this._ipc2.close(); } } catch (ex) { }
    this._ipc = null;
    this._ipc2 = null;
    if ((this._child != null) && (this._child.hProcess != null)) {
        try { k32.CloseHandle(this._child.hProcess); } catch (ex) { }
        this._child.hProcess = null;
    }
}

// Script run by the child agent, it connects back to us using the built-in win-dispatcher client
function childScript(ipcInteger) {
    return ("require('win-dispatcher').connect('" + ipcInteger + "');");
}

function dispatch(options) {
    if (!options || !options.modules || !options.launch || !options.launch.module || !options.launch.method || !options.launch.args) { throw ('Invalid Parameters'); }

    var session = findSession(options);
    var ret = { options: options, sessionId: parseInt(session.SessionId), user: (session.Domain ? (session.Domain + '\\') : '') + session.Username };
    require('events').EventEmitter.call(ret, true).createEvent('connection');
    ret.close = dispatcher_shutdown;
    ret.status = dispatcher_status;

    // Two named pipes, the first is the stream to the launched method, the second is the control channel.
    // The pipe names must match what require('win-dispatcher').connect() expects in the child.
    var ipcInteger = null;
    for (var i = 0; i < 20; ++i) {
        ipcInteger = require('tls').generateRandomInteger('1000', '9999');
        ret._ipcPath = '\\\\.\\pipe\\taskRedirection-' + ipcInteger;
        ret._ipc = require('net').createServer(); ret._ipc.parent = ret;
        ret._ipc2 = require('net').createServer(); ret._ipc2.parent = ret;
        try {
            ret._ipc.listen({ path: ret._ipcPath, writableAll: true });
            ret._ipc2.listen({ path: ret._ipcPath + 'C', writableAll: true });
            break;
        } catch (ex) {
            ret.close();
            ipcInteger = null;
        }
    }
    if (ipcInteger == null) { throw ('Unable to create IPC'); }
    ret._ipc.on('close', empty_func);
    ret._ipc2.on('close', empty_func);
    ret._ipc2.once('connection', ipc2_connection);
    ret._ipc.once('connection', ipc_connection);

    try {
        var str = Buffer.from(childScript(ipcInteger)).toString('base64');
        ret._child = launchAsUser(ret.sessionId, str, options.console ? true : false, options.noConsole ? true : false);
        ret.pid = ret._child.pid;
    } catch (ex) {
        ret.close();
        if ((ex != null) && ex.notSystem) { return (fallbackDispatch(options, ret.sessionId, ret.user)); }
        throw (ex);
    }
    return (ret);
}

//
// When the agent is not running as LocalSystem (for example started in connect mode as an elevated user), it is not allowed
// to take the user's token, so use the built-in win-dispatcher instead, which runs the child as the user through the Task
// Scheduler. This is how user shells worked before this module, including the brief console window it can show.
//
function fallbackDispatch(options, sessionId, user) {
    var o = {};
    for (var k in options) { if ((k != 'sessionId') && (k != 'console') && (k != 'noConsole')) { o[k] = options[k]; } }
    o.user = (user.indexOf('\\') >= 0) ? user : (process.env['COMPUTERNAME'] + '\\' + user);
    var d = require('win-dispatcher').dispatch(o);
    d.sessionId = sessionId;
    d.user = o.user;
    d.viaTaskScheduler = true;
    d.status = function () { return ('started through the Task Scheduler, the agent is not running as LocalSystem'); };
    return (d);
}

module.exports = { dispatch: dispatch, findSession: findSession };
