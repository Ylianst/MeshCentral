
var http = require('http');
var childProcess = require('child_process');
var meshCoreObj = { action: 'coreinfo', value: "MeshCore Recovery", caps: 14 }; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
var nextTunnelIndex = 1;
var tunnels = {};
var fs = require('fs');

var needStreamFix = (new Date(process.versions.meshAgent) < new Date('2020-01-21 13:27:45.000-08:00'));
try
{
    Object.defineProperty(Array.prototype, 'find', {
        value: function (func)
        {
            var i = 0;
            for(i=0;i<this.length;++i)
            {
                if(func(this[i]))
                {
                    return (this[i]);
                }
            }
            return (null);
        }
    });
}
catch(x)
{

}
try
{
    Object.defineProperty(Array.prototype, 'findIndex', {
        value: function (func)
        {
            var i = 0;
            for (i = 0; i < this.length; ++i)
            {
                if (func(this[i], i, this))
                {
                    return (i);
                }
            }
            return (-1);
        }
    });
}
catch (x)
{

}

if (process.platform != 'win32')
{
    var ch = require('child_process');
    ch._execFile = ch.execFile;
    ch.execFile = function execFile(path, args, options)
    {
        if (options && options.type && options.type == ch.SpawnTypes.TERM && options.env)
        {
            options.env['TERM'] = 'xterm-256color';
        }
        return (this._execFile(path, args, options));
    };
}

function _getPotentialServiceNames()
{
    var registry = require('win-registry');
    var ret = [];
    var K = registry.QueryKey(registry.HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Services');
    var service, s;
    while (K.subkeys.length > 0)
    {
        service = K.subkeys.shift();
        try
        {
            s = registry.QueryKey(registry.HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Services\\' + service, 'ImagePath');
            if (s.startsWith(process.execPath) || s.startsWith('"' + process.execPath + '"'))
            {
                ret.push(service);
            }
        }
        catch (x)
        {
        }
    }
    return (ret);
}
function _verifyServiceName(names)
{
    var i;
    var s;
    var ret = null;
    for (i = 0; i < names.length; ++i)
    {
        try
        {
            s = require('service-manager').manager.getService(names[i]);
            if (s.isMe())
            {
                ret = names[i];
                s.close();
                break;
            }
            s.close();
        }
        catch (z) { }
    }
    return (ret);
}

function windows_getCommandLine()
{
    var parms = [];
    var GM = require('_GenericMarshal');
    var k32 = GM.CreateNativeProxy('kernel32.dll');
    var s32 = GM.CreateNativeProxy('shell32.dll');
    k32.CreateMethod('GetCommandLineW');
    k32.CreateMethod('LocalFree');
    s32.CreateMethod('CommandLineToArgvW');
    var v = k32.GetCommandLineW();
    var i;
    var len = GM.CreateVariable(4);
    var val = s32.CommandLineToArgvW(v, len);
    len = len.toBuffer().readInt32LE(0);
    if (len > 0)
    {
        for (i = 0; i < len; ++i)
        {
            parms.push(val.Deref(i * GM.PointerSize, GM.PointerSize).Deref().Wide2UTF8);
        }
    }
    k32.LocalFree(val);
    return (parms);
}

if (require('MeshAgent').ARCHID == null)
{
    var id = null;
    switch (process.platform)
    {
        case 'win32':
            id = require('_GenericMarshal').PointerSize == 4 ? 3 : 4;
            break;
        case 'freebsd':
            id = require('_GenericMarshal').PointerSize == 4 ? 31 : 30;
            break;
        case 'darwin':
            try
            {
                id = require('os').arch() == 'x64' ? 16 : 29;
            }
            catch (xx)
            {
                id = 16;
            }
            break;
    }
    if (id != null) { Object.defineProperty(require('MeshAgent'), 'ARCHID', { value: id }); }
}

//attachDebugger({ webport: 9994, wait: 1 }).then(function (p) { console.log('Debug on port: ' + p); });

function sendConsoleText(msg, sessionid)
{
    if (sessionid != null)
    {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: msg, sessionid: sessionid });
    }
    else
    {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: msg });
    }
}

function sendAgentMessage(msg, icon)
{
    if (sendAgentMessage.messages == null)
    {
        sendAgentMessage.messages = {};
        sendAgentMessage.nextid = 1;
    }
    sendAgentMessage.messages[sendAgentMessage.nextid++] = { msg: msg, icon: icon };
    require('MeshAgent').SendCommand({ action: 'sessions', type: 'msg', value: sendAgentMessage.messages });
}

// Add to the server event log
function MeshServerLog(msg, state)
{
    if (typeof msg == 'string') { msg = { action: 'log', msg: msg }; } else { msg.action = 'log'; }
    if (state)
    {
        if (state.userid) { msg.userid = state.userid; }
        if (state.username) { msg.username = state.username; }
        if (state.sessionid) { msg.sessionid = state.sessionid; }
        if (state.remoteaddr) { msg.remoteaddr = state.remoteaddr; }
    }
    require('MeshAgent').SendCommand(msg);
}

// Add to the server event log, use internationalized events
function MeshServerLogEx(id, args, msg, state)
{
    var msg = { action: 'log', msgid: id, msgArgs: args, msg: msg };
    if (state)
    {
        if (state.userid) { msg.userid = state.userid; }
        if (state.username) { msg.username = state.username; }
        if (state.sessionid) { msg.sessionid = state.sessionid; }
        if (state.remoteaddr) { msg.remoteaddr = state.remoteaddr; }
    }
    require('MeshAgent').SendCommand(msg);
}

function getOpenDescriptors()
{
    switch(process.platform)
    {
        case "freebsd":
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
            child.stderr.on('data', function (c) { });

            child.stdin.write("procstat -f " + process.pid + " | tr '\\n' '`' | awk -F'`' '");
            child.stdin.write('{');
            child.stdin.write('   DEL="";');
            child.stdin.write('   printf "[";');
            child.stdin.write('   for(i=1;i<NF;++i)');
            child.stdin.write('   {');
            child.stdin.write('      A=split($i,B," ");');
            child.stdin.write('      if(B[3] ~ /^[0-9]/)');
            child.stdin.write('      {');
            child.stdin.write('         printf "%s%s", DEL, B[3];');
            child.stdin.write('         DEL=",";');
            child.stdin.write('      }');
            child.stdin.write('   }');
            child.stdin.write('   printf "]";');
            child.stdin.write("}'");

            child.stdin.write('\nexit\n');
            child.waitExit();

            try
            {
                return(JSON.parse(child.stdout.str.trim()));
            }
            catch(e)
            {
                return ([]);
            }
            break;
        case "linux":
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
            child.stderr.on('data', function (c) { });

            child.stdin.write("ls /proc/" + process.pid + "/fd | tr '\\n' '`' | awk -F'`' '");
            child.stdin.write('{');
            child.stdin.write('   printf "[";');
            child.stdin.write('   DEL="";');
            child.stdin.write('   for(i=1;i<NF;++i)');
            child.stdin.write('   {');
            child.stdin.write('      printf "%s%s",DEL,$i;');
            child.stdin.write('      DEL=",";');
            child.stdin.write('   }');
            child.stdin.write('   printf "]";');
            child.stdin.write("}'");
            child.stdin.write('\nexit\n');
            child.waitExit();

            try
            {
                return (JSON.parse(child.stdout.str.trim()));
            }
            catch (e)
            {
                return ([]);
            }
            break;
        default:
            return ([]);
    }
}


function pathjoin() {
    var x = [];
    for (var i in arguments) {
        var w = arguments[i];
        if (w != null) {
            while (w.endsWith('/') || w.endsWith('\\')) { w = w.substring(0, w.length - 1); }
            if (i != 0) {
                while (w.startsWith('/') || w.startsWith('\\')) { w = w.substring(1); }
            }
            x.push(w);
        }
    }
    if (x.length == 0) return '/';
    return x.join('/');
}
// Replace a string with a number if the string is an exact number
function toNumberIfNumber(x) { if ((typeof x == 'string') && (+parseInt(x) === x)) { x = parseInt(x); } return x; }


function closeDescriptors(libc, descriptors)
{
    var fd = null;
    while(descriptors.length>0)
    {
        fd = descriptors.pop();
        if(fd > 2)
        {
            libc.close(fd);
        }
    }
}

function linux_execv(name, agentfilename, sessionid)
{
    var libs = require('monitor-info').getLibInfo('libc');
    var libc = null;

    if ((libs.length == 0 || libs.length == null) && require('MeshAgent').ARCHID == 33)
    {
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
        child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
        child.stdin.write("ls /lib/libc.* | tr '\\n' '`' | awk -F'`' '{ " + ' printf "["; DEL=""; for(i=1;i<NF;++i) { printf "%s{\\"path\\":\\"%s\\"}",DEL,$i; DEL=""; } printf "]"; }\'\nexit\n');
        child.waitExit();

        try
        {
            libs = JSON.parse(child.stdout.str.trim());
        }
        catch(e)
        {
        }
    }

    while (libs.length > 0)
    {
        try {
            libc = require('_GenericMarshal').CreateNativeProxy(libs.pop().path);
            break;
        }
        catch (e) {
            libc = null;
            continue;
        }
    }
    if (libc != null) {
        try
        {
            libc.CreateMethod('execv');
            libc.CreateMethod('close');
        }
        catch (e) {
            libc = null;
        }
    }

    if (libc == null) {
        // Couldn't find libc.so, fallback to using service manager to restart agent
        if (sessionid != null) { sendConsoleText('Restarting service via service-manager...', sessionid) }
        try {
            // restart service
            var s = require('service-manager').manager.getService(name);
            s.restart();
        }
        catch (zz) {
            sendConsoleText('Self Update encountered an error trying to restart service', sessionid);
            sendAgentMessage('Self Update encountered an error trying to restart service', 3);
        }
        return;
    }

    if (sessionid != null) { sendConsoleText('Restarting service via execv()...', sessionid) }

    var i;
    var args;
    var argtmp = [];
    var argarr = [process.execPath];
    var path = require('_GenericMarshal').CreateVariable(process.execPath);

    if (require('MeshAgent').getStartupOptions != null) {
        var options = require('MeshAgent').getStartupOptions();
        for (i in options) {
            argarr.push('--' + i + '="' + options[i] + '"');
        }
    }

    args = require('_GenericMarshal').CreateVariable((1 + argarr.length) * require('_GenericMarshal').PointerSize);
    for (i = 0; i < argarr.length; ++i) {
        var arg = require('_GenericMarshal').CreateVariable(argarr[i]);
        argtmp.push(arg);
        arg.pointerBuffer().copy(args.toBuffer(), i * require('_GenericMarshal').PointerSize);
    }

    var descriptors = getOpenDescriptors();
    closeDescriptors(libc, descriptors);

    libc.execv(path, args);
    if (sessionid != null) { sendConsoleText('Self Update failed because execv() failed', sessionid) }
    sendAgentMessage('Self Update failed because execv() failed', 3);
}

function bsd_execv(name, agentfilename, sessionid) {
    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write("cat /usr/lib/libc.so | awk '");
    child.stdin.write('{');
    child.stdin.write(' a=split($0, tok, "(");');
    child.stdin.write(' if(a>1)');
    child.stdin.write(' {');
    child.stdin.write('     split(tok[2], b, ")");');
    child.stdin.write('     split(b[1], c, " ");');
    child.stdin.write('     print c[1];');
    child.stdin.write(' }');
    child.stdin.write("}'\nexit\n");
    child.waitExit();
    if (child.stdout.str.trim() == '') {
        if (sessionid != null) { sendConsoleText('Self Update failed because cannot find libc.so', sessionid) }
        sendAgentMessage('Self Update failed because cannot find libc.so', 3);
        return;
    }

    var libc = null;
    try
    {
        libc = require('_GenericMarshal').CreateNativeProxy(child.stdout.str.trim());
        libc.CreateMethod('execv');
        libc.CreateMethod('close');
    }
    catch (e) {
        if (sessionid != null) { sendConsoleText('Self Update failed: ' + e.toString(), sessionid) }
        sendAgentMessage('Self Update failed: ' + e.toString(), 3);
        return;
    }

    var i;
    var path = require('_GenericMarshal').CreateVariable(process.execPath);
    var argarr = [process.execPath];
    var argtmp = [];
    var args;
    var options = require('MeshAgent').getStartupOptions();
    for (i in options) {
        argarr.push('--' + i + '="' + options[i] + '"');
    }
    args = require('_GenericMarshal').CreateVariable((1 + argarr.length) * require('_GenericMarshal').PointerSize);
    for (i = 0; i < argarr.length; ++i) {
        var arg = require('_GenericMarshal').CreateVariable(argarr[i]);
        argtmp.push(arg);
        arg.pointerBuffer().copy(args.toBuffer(), i * require('_GenericMarshal').PointerSize);
    }

    if (sessionid != null) { sendConsoleText('Restarting service via execv()', sessionid) }

    var descriptors = getOpenDescriptors();
    closeDescriptors(libc, descriptors);

    libc.execv(path, args);
    if (sessionid != null) { sendConsoleText('Self Update failed because execv() failed', sessionid) }
    sendAgentMessage('Self Update failed because execv() failed', 3);
}

function windows_execve(name, agentfilename, sessionid) {
    var libc;
    try {
        libc = require('_GenericMarshal').CreateNativeProxy('msvcrt.dll');
        libc.CreateMethod('_wexecve');
    }
    catch (xx) {
        sendConsoleText('Self Update failed because msvcrt.dll is missing', sessionid);
        sendAgentMessage('Self Update failed because msvcrt.dll is missing', 3);
        return;
    }

    var cwd = process.cwd();
    if (!cwd.endsWith('\\'))
    {
        cwd += '\\';
    }
    var cmd = require('_GenericMarshal').CreateVariable(process.env['windir'] + '\\system32\\cmd.exe', { wide: true });
    var args = require('_GenericMarshal').CreateVariable(3 * require('_GenericMarshal').PointerSize);
    var arg1 = require('_GenericMarshal').CreateVariable('cmd.exe', { wide: true });
    var arg2 = require('_GenericMarshal').CreateVariable('/C wmic service "' + name + '" call stopservice & "' + cwd + agentfilename + '.update.exe" -b64exec ' + 'dHJ5CnsKICAgIHZhciBzZXJ2aWNlTG9jYXRpb24gPSBwcm9jZXNzLmFyZ3YucG9wKCkudG9Mb3dlckNhc2UoKTsKICAgIHJlcXVpcmUoJ3Byb2Nlc3MtbWFuYWdlcicpLmVudW1lcmF0ZVByb2Nlc3NlcygpLnRoZW4oZnVuY3Rpb24gKHByb2MpCiAgICB7CiAgICAgICAgZm9yICh2YXIgcCBpbiBwcm9jKQogICAgICAgIHsKICAgICAgICAgICAgaWYgKHByb2NbcF0ucGF0aCAmJiAocHJvY1twXS5wYXRoLnRvTG93ZXJDYXNlKCkgPT0gc2VydmljZUxvY2F0aW9uKSkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgcHJvY2Vzcy5raWxsKHByb2NbcF0ucGlkKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICBwcm9jZXNzLmV4aXQoKTsKICAgIH0pOwp9CmNhdGNoIChlKQp7CiAgICBwcm9jZXNzLmV4aXQoKTsKfQ==' +
        ' "' + process.execPath + '" & copy "' + cwd + agentfilename + '.update.exe" "' + process.execPath + '" & wmic service "' + name + '" call startservice & erase "' + cwd + agentfilename + '.update.exe"', { wide: true });

    if (name == null)
    {
        // We can continue with self update for Temp/Console Mode on Windows
        var db = null;
        var update = cwd + agentfilename + '.update.exe';
        var updatedb = cwd + agentfilename + '.update.db';
        var parms = windows_getCommandLine(); parms.shift();
        
        var updatesource = parms.find(function (v) { return (v.startsWith('--updateSourcePath=')); });
        if (updatesource == null)
        {
            parms.push('--updateSourcePath="' + cwd + agentfilename + '"');
            updatesource = (cwd + agentfilename).split('.exe'); updatesource.pop(); updatesource = updatesource.join('.exe');
            db = updatesource + '.db';
            updatesource = (' & move "' + updatedb + '" "' + db + '"') + (' & erase "' + updatedb + '" & move "' + update + '" "' + updatesource + '.exe"');
        }
        else
        {
            updatesource = updatesource.substring(19).split('.exe');
            updatesource.pop(); updatesource = updatesource.join('.exe');
            db = updatesource + '.db';
            updatesource = (' & move "' + update + '" "' + updatesource + '.exe" & move "' + updatedb + '" "' + db + '" & erase "' + updatedb + '"') + (' & echo move "' + update + '" "' + updatesource + '.exe" & echo move "' + updatedb + '" "' + db + '"');
        }

        var tmp = '/C echo copy "' + db + '" "' + updatedb + '" & copy "' + db + '" "' + updatedb + '"' + ' & "' + update + '" ' + parms.join(' ') + updatesource + ' & erase "' + update + '" & echo ERASE "' + update + '"';
        arg2 = require('_GenericMarshal').CreateVariable(tmp, { wide: true });
    }

    arg1.pointerBuffer().copy(args.toBuffer());
    arg2.pointerBuffer().copy(args.toBuffer(), require('_GenericMarshal').PointerSize);

    libc._wexecve(cmd, args, 0);
}

// Start a JavaScript based Agent Self-Update
function agentUpdate_Start(updateurl, updateoptions) {
    // If this value is null
    var sessionid = (updateoptions != null) ? updateoptions.sessionid : null; // If this is null, messages will be broadcast. Otherwise they will be unicasted

    // If the url starts with *, switch it to use the same protoco, host and port as the control channel.
    if (updateurl != null) {
        updateurl = getServerTargetUrlEx(updateurl);
        if (updateurl.startsWith("wss://")) { updateurl = "https://" + updateurl.substring(6); }
    }

    if (agentUpdate_Start._selfupdate != null)
    {
        // We were already called, so we will ignore this duplicate request
        if (sessionid != null) { sendConsoleText('Self update already in progress...', sessionid); }
    }
    else {
        if (agentUpdate_Start._retryCount == null) { agentUpdate_Start._retryCount = 0; }
        if (require('MeshAgent').ARCHID == null && updateurl == null) {
            // This agent doesn't have the ability to tell us which ARCHID it is, so we don't know which agent to pull
            sendConsoleText('Unable to initiate update, agent ARCHID is not defined', sessionid);
        }
        else
        {
            var agentfilename = process.execPath.split(process.platform == 'win32' ? '\\' : '/').pop(); // Local File Name, ie: MeshAgent.exe
            var name = require('MeshAgent').serviceName;
            if (name == null) { name = process.platform == 'win32' ? 'Mesh Agent' : 'meshagent'; }
            if (process.platform == 'win32')
            {
                // Special Processing for Temporary/Console Mode Agents on Windows
                var parms = windows_getCommandLine(); // This uses FFI to fetch the command line parameters that the agent was started with
                if (parms.findIndex(function (val) { return (val != null && (val.toUpperCase() == 'RUN' || val.toUpperCase() == 'CONNECT')); }) >= 0)
                {
                    // This is a Temporary/Console Mode Agent
                    sendConsoleText('This is a temporary/console agent, checking for conflicts with background services...');

                    // Check to see if our binary conflicts with an installed agent
                    var agents = _getPotentialServiceNames();
                    if (_getPotentialServiceNames().length > 0)
                    {
                        sendConsoleText('Self update cannot continue because the installed agent (' + agents[0] + ') conflicts with the currently running Temp/Console agent...', sessionid);
                        return;
                    }


                    sendConsoleText('No conflicts detected...');
                    name = null;
                }
                else
                {
                    // Not running in Temp/Console Mode... No Op here....
                }
            }
            else
            {
                // Non Windows Self Update
                try
                {
                    var s = require('service-manager').manager.getService(name);
                    if (!s.isMe())
                    {
                        if (process.platform == 'win32') { s.close(); }
                        sendConsoleText('Self Update cannot continue, this agent is not an instance of background service (' + name + ')', sessionid);
                        return;
                    }
                    if (process.platform == 'win32') { s.close(); }
                }
                catch (zz)
                {
                    sendConsoleText('Self Update Failed because this agent is not an instance of (' + name + ')', sessionid);
                    sendAgentMessage('Self Update Failed because this agent is not an instance of (' + name + ')', 3);
                    return;
                }
            }
            if ((sessionid != null) && (updateurl != null)) { sendConsoleText('Downloading update from: ' + updateurl, sessionid); }
            var options = require('http').parseUri(updateurl != null ? updateurl : require('MeshAgent').ServerUrl);
            options.protocol = 'https:';
            if (updateurl == null) { options.path = ('/meshagents?id=' + require('MeshAgent').ARCHID); sendConsoleText('Downloading update from: ' + options.path, sessionid); }
            options.rejectUnauthorized = false;
            options.checkServerIdentity = function checkServerIdentity(certs) {
                // If the tunnel certificate matches the control channel certificate, accept the connection
                try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.digest == certs[0].digest) return; } catch (ex) { }
                try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.fingerprint == certs[0].fingerprint) return; } catch (ex) { }

                // Check that the certificate is the one expected by the server, fail if not.
                if (checkServerIdentity.servertlshash == null) {
                    if (require('MeshAgent').ServerInfo == null || require('MeshAgent').ServerInfo.ControlChannelCertificate == null) { return; }
                    sendConsoleText('Self Update failed, because the url cannot be verified: ' + updateurl, sessionid);
                    sendAgentMessage('Self Update failed, because the url cannot be verified: ' + updateurl, 3);
                    throw new Error('BadCert');
                }
                if (certs[0].digest == null) { return; }
                if ((checkServerIdentity.servertlshash != null) && (checkServerIdentity.servertlshash.toLowerCase() != certs[0].digest.split(':').join('').toLowerCase())) {
                    sendConsoleText('Self Update failed, because the supplied certificate does not match', sessionid);
                    sendAgentMessage('Self Update failed, because the supplied certificate does not match', 3);
                    throw new Error('BadCert')
                }
            }
            options.checkServerIdentity.servertlshash = (updateoptions != null ? updateoptions.tlshash : null);
            agentUpdate_Start._selfupdate = require('https').get(options);
            agentUpdate_Start._selfupdate.on('error', function (e) {
                sendConsoleText('Self Update failed, because there was a problem trying to download the update from ' + updateurl, sessionid);
                sendAgentMessage('Self Update failed, because there was a problem trying to download the update from ' + updateurl, 3);
                agentUpdate_Start._selfupdate = null;
            });
            agentUpdate_Start._selfupdate.on('response', function (img)
            {
                var self = this;
                this._file = require('fs').createWriteStream(agentfilename + (process.platform=='win32'?'.update.exe':'.update'), { flags: 'wb' });
                this._filehash = require('SHA384Stream').create();
                this._filehash.on('hash', function (h)
                {
                    if (updateoptions != null && updateoptions.hash != null)
                    {
                        if (updateoptions.hash.toLowerCase() == h.toString('hex').toLowerCase())
                        {
                            if (sessionid != null) { sendConsoleText('Download complete. HASH verified.', sessionid); }
                        }
                        else
                        {
                            agentUpdate_Start._retryCount++;
                            sendConsoleText('Self Update FAILED because the downloaded agent FAILED hash check (' + agentUpdate_Start._retryCount + '), URL: ' + updateurl, sessionid);
                            sendAgentMessage('Self Update FAILED because the downloaded agent FAILED hash check (' + agentUpdate_Start._retryCount + '), URL: ' + updateurl, 3);
                            agentUpdate_Start._selfupdate = null;

                            try
                            {
                                // We are clearing these two properties, becuase some older agents may not cleanup correctly causing problems with the retry
                                require('https').globalAgent.sockets = {};  
                                require('https').globalAgent.requests = {};
                            }
                            catch(z)
                            {}
                            if (needStreamFix)
                            {
                                sendConsoleText('This is an older agent that may have an httpstream bug. On next retry will try to fetch the update differently...');
                                needStreamFix = false;
                            }

                            if (agentUpdate_Start._retryCount < 4)
                            {
                                // Retry the download again
                                sendConsoleText('Self Update will try again in 20 seconds...', sessionid);
                                agentUpdate_Start._timeout = setTimeout(agentUpdate_Start, 20000, updateurl, updateoptions);
                            }
                            else
                            {
                                sendConsoleText('Self Update giving up, too many failures...', sessionid);
                                sendAgentMessage('Self Update giving up, too many failures...', 3);
                            }
                            return;
                        }
                    }
                    else
                    {
                        sendConsoleText('Download complete. HASH=' + h.toString('hex'), sessionid);
                    }

                    // Send an indication to the server that we got the update download correctly.
                    try { require('MeshAgent').SendCommand({ action: 'agentupdatedownloaded' }); } catch (e) { }

                    if (sessionid != null) { sendConsoleText('Updating and restarting agent...', sessionid); }
                    if (process.platform == 'win32')
                    {
                        // Use _wexecve() equivalent to perform the update
                        windows_execve(name, agentfilename, sessionid);
                    }
                    else
                    {
                        var m = require('fs').statSync(process.execPath).mode;
                        require('fs').chmodSync(process.cwd() + agentfilename + '.update', m);

                        // remove binary
                        require('fs').unlinkSync(process.execPath);

                        // copy update
                        require('fs').copyFileSync(process.cwd() + agentfilename + '.update', process.execPath);
                        require('fs').chmodSync(process.execPath, m);

                        // erase update
                        require('fs').unlinkSync(process.cwd() + agentfilename + '.update');

                        switch (process.platform)
                        {
                            case 'freebsd':
                                bsd_execv(name, agentfilename, sessionid);
                                break;
                            case 'linux':
                                linux_execv(name, agentfilename, sessionid);
                                break;
                            default:
                                try
                                {
                                    // restart service
                                    var s = require('service-manager').manager.getService(name);
                                    s.restart();
                                }
                                catch (zz)
                                {
                                    if (zz.toString() != 'waitExit() aborted because thread is exiting')
                                    {
                                        sendConsoleText('Self Update encountered an error trying to restart service', sessionid);
                                        sendAgentMessage('Self Update encountered an error trying to restart service', 3);
                                    }
                                }
                                break;
                        }
                    }
                });

                if (!needStreamFix)
                {
                    img.pipe(this._file);
                    img.pipe(this._filehash);
                }
                else
                {
                    img.once('data', function (buffer)
                    {
                        if(this.immediate)
                        {
                            clearImmediate(this.immediate);
                            this.immediate = null;

                            // No need to apply fix
                            self._file.write(buffer);
                            self._filehash.write(buffer);

                            this.pipe(self._file);
                            this.pipe(self._filehash);
                        }
                        else
                        {
                            // Need to apply fix
                            this.pipe(self._file);
                            this.pipe(self._filehash);
                        }
                    });
                    this.immediate = setImmediate(function (self)
                    {
                        self.immediate = null;
                    },this);
                }
            });
        }
    }
}

// Return p number of spaces 
function addPad(p, ret) { var r = ''; for (var i = 0; i < p; i++) { r += ret; } return r; }

setInterval(function () { sendConsoleText('Timer!'); }, 2000);

var path =
    {
        join: function () {
            var x = [];
            for (var i in arguments) {
                var w = arguments[i];
                if (w != null) {
                    while (w.endsWith('/') || w.endsWith('\\')) { w = w.substring(0, w.length - 1); }
                    if (i != 0) { while (w.startsWith('/') || w.startsWith('\\')) { w = w.substring(1); } }
                    x.push(w);
                }
            }
            if (x.length == 0) return '/';
            return x.join('/');
        }
    };
// Convert an object to string with all functions
function objToString(x, p, pad, ret) {
    if (ret == undefined) ret = '';
    if (p == undefined) p = 0;
    if (x == null) { return '[null]'; }
    if (p > 8) { return '[...]'; }
    if (x == undefined) { return '[undefined]'; }
    if (typeof x == 'string') { if (p == 0) return x; return '"' + x + '"'; }
    if (typeof x == 'buffer') { return '[buffer]'; }
    if (typeof x != 'object') { return x; }
    var r = '{' + (ret ? '\r\n' : ' ');
    for (var i in x) { if (i != '_ObjectID') { r += (addPad(p + 2, pad) + i + ': ' + objToString(x[i], p + 2, pad, ret) + (ret ? '\r\n' : ' ')); } }
    return r + addPad(p, pad) + '}';
}

// Split a string taking into account the quoats. Used for command line parsing
function splitArgs(str) {
    var myArray = [], myRegexp = /[^\s"]+|"([^"]*)"/gi;
    do { var match = myRegexp.exec(str); if (match != null) { myArray.push(match[1] ? match[1] : match[0]); } } while (match != null);
    return myArray;
}

// Parse arguments string array into an object
function parseArgs(argv) {
    var results = { '_': [] }, current = null;
    for (var i = 1, len = argv.length; i < len; i++) {
        var x = argv[i];
        if (x.length > 2 && x[0] == '-' && x[1] == '-') {
            if (current != null) { results[current] = true; }
            current = x.substring(2);
        } else {
            if (current != null) { results[current] = toNumberIfNumber(x); current = null; } else { results['_'].push(toNumberIfNumber(x)); }
        }
    }
    if (current != null) { results[current] = true; }
    return results;
}

// Get server target url with a custom path
function getServerTargetUrl(path) {
    var x = require('MeshAgent').ServerUrl;
    //sendConsoleText("mesh.ServerUrl: " + mesh.ServerUrl);
    if (x == null) { return null; }
    if (path == null) { path = ''; }
    x = http.parseUri(x);
    if (x == null) return null;
    return x.protocol + '//' + x.host + ':' + x.port + '/' + path;
}

// Get server url. If the url starts with "*/..." change it, it not use the url as is.
function getServerTargetUrlEx(url) {
    if (url.substring(0, 2) == '*/') { return getServerTargetUrl(url.substring(2)); }
    return url;
}

require('MeshAgent').on('Connected', function () {
    require('os').name().then(function (v) {
        //sendConsoleText("Mesh Agent Recovery Console, OS: " + v);
        require('MeshAgent').SendCommand(meshCoreObj);
    });
});

// Called when receiving control data on websocket
function onTunnelControlData(data, ws) {
    var obj;
    if (ws == null) { ws = this; }
    if (typeof data == 'string') { try { obj = JSON.parse(data); } catch (e) { sendConsoleText('Invalid control JSON: ' + data); return; } }
    else if (typeof data == 'object') { obj = data; } else { return; }
    //sendConsoleText('onTunnelControlData(' + ws.httprequest.protocol + '): ' + JSON.stringify(data));
    //console.log('onTunnelControlData: ' + JSON.stringify(data));

    if (obj.action) {
        switch (obj.action) {
            case 'lock': {
                // Lock the current user out of the desktop
                try {
                    if (process.platform == 'win32') {
                        MeshServerLog("Locking remote user out of desktop", ws.httprequest);
                        var child = require('child_process');
                        child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 });
                    }
                } catch (e) { }
                break;
            }
            default:
                // Unknown action, ignore it.
                break;
        }
        return;
    }

    switch (obj.type) {
        case 'options': {
            // These are additional connection options passed in the control channel.
            //sendConsoleText('options: ' + JSON.stringify(obj));
            delete obj.type;
            ws.httprequest.xoptions = obj;

            // Set additional user consent options if present
            if ((obj != null) && (typeof obj.consent == 'number')) { ws.httprequest.consent |= obj.consent; }

            break;
        }
        case 'close': {
            // We received the close on the websocket
            //sendConsoleText('Tunnel #' + ws.tunnel.index + ' WebSocket control close');
            try { ws.close(); } catch (e) { }
            break;
        }
        case 'termsize': {
            // Indicates a change in terminal size
            if (process.platform == 'win32') {
                if (ws.httprequest._dispatcher == null) return;
                if (ws.httprequest._dispatcher.invoke) { ws.httprequest._dispatcher.invoke('resizeTerminal', [obj.cols, obj.rows]); }
            }
            else {
                if (ws.httprequest.process == null || ws.httprequest.process.pty == 0) return;
                if (ws.httprequest.process.tcsetsize) { ws.httprequest.process.tcsetsize(obj.rows, obj.cols); }
            }
            break;
        }
    }
}


require('MeshAgent').AddCommandHandler(function (data)
{
    if (typeof data == 'object') {
        // If this is a console command, parse it and call the console handler
        switch (data.action) {
            case 'agentupdate':
                agentUpdate_Start(data.url, { hash: data.hash, tlshash: data.servertlshash, sessionid: data.sessionid });
                break;
            case 'msg':
                {
                    switch (data.type) {
                        case 'console': { // Process a console command
                            if ((typeof data.rights != 'number') || ((data.rights & 8) == 0) || ((data.rights & 16) == 0)) break; // Check console rights (Remote Control and Console)
                            if (data.value && data.sessionid) {
                                var args = splitArgs(data.value);
                                processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid);
                            }
                            break;
                        }
                        case 'tunnel':
                            {
                                if (data.value != null) { // Process a new tunnel connection request
                                    // Create a new tunnel object
                                    if (data.rights != 4294967295) {
                                        MeshServerLog('Tunnel Error: RecoveryCore requires admin rights for tunnels');
                                        break;
                                    }

                                    var xurl = getServerTargetUrlEx(data.value);
                                    if (xurl != null)
                                    {
                                        xurl = xurl.split('$').join('%24').split('@').join('%40'); // Escape the $ and @ characters
                                        var woptions = http.parseUri(xurl);
                                        woptions.rejectUnauthorized = 0;
                                        woptions.perMessageDeflate = false;
                                        woptions.checkServerIdentity = function checkServerIdentity(certs) {
                                            // If the tunnel certificate matches the control channel certificate, accept the connection
                                            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.digest == certs[0].digest) return; } catch (ex) { }
                                            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.fingerprint == certs[0].fingerprint) return; } catch (ex) { }

                                            // Check that the certificate is the one expected by the server, fail if not.
                                            if ((checkServerIdentity.servertlshash != null) && (checkServerIdentity.servertlshash.toLowerCase() != certs[0].digest.split(':').join('').toLowerCase())) { throw new Error('BadCert') }
                                        }
                                        woptions.checkServerIdentity.servertlshash = data.servertlshash;


                                        //sendConsoleText(JSON.stringify(woptions));
                                        var tunnel = http.request(woptions);
                                        tunnel.on('upgrade', function (response, s, head) {
                                            if (require('MeshAgent').idleTimeout != null) {
                                                s.setTimeout(require('MeshAgent').idleTimeout * 1000);
                                                s.on('timeout', function () {
                                                    this.ping();
                                                    this.setTimeout(require('MeshAgent').idleTimeout * 1000);
                                                });
                                            }

                                            this.s = s;
                                            s.httprequest = this;
                                            s.tunnel = this;
                                            s.on('end', function () {
                                                if (tunnels[this.httprequest.index] == null) return; // Stop duplicate calls.

                                                // If there is a upload or download active on this connection, close the file
                                                if (this.httprequest.uploadFile) { fs.closeSync(this.httprequest.uploadFile); delete this.httprequest.uploadFile; delete this.httprequest.uploadFileid; delete this.httprequest.uploadFilePath; }
                                                if (this.httprequest.downloadFile) { delete this.httprequest.downloadFile; }

                                                //sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
                                                delete tunnels[this.httprequest.index];

                                                // Clean up WebSocket
                                                this.removeAllListeners('data');
                                            });
                                            s.on('data', function (data) {
                                                // If this is upload data, save it to file
                                                if ((this.httprequest.uploadFile) && (typeof data == 'object') && (data[0] != 123)) {
                                                    // Save the data to file being uploaded.
                                                    if (data[0] == 0) {
                                                        // If data starts with zero, skip the first byte. This is used to escape binary file data from JSON.
                                                        try { fs.writeSync(this.httprequest.uploadFile, data, 1, data.length - 1); } catch (e) { sendConsoleText('FileUpload Error'); this.write(Buffer.from(JSON.stringify({ action: 'uploaderror' }))); return; } // Write to the file, if there is a problem, error out.
                                                    } else {
                                                        // If data does not start with zero, save as-is.
                                                        try { fs.writeSync(this.httprequest.uploadFile, data); } catch (e) { sendConsoleText('FileUpload Error'); this.write(Buffer.from(JSON.stringify({ action: 'uploaderror' }))); return; } // Write to the file, if there is a problem, error out.
                                                    }
                                                    this.write(Buffer.from(JSON.stringify({ action: 'uploadack', reqid: this.httprequest.uploadFileid }))); // Ask for more data.
                                                    return;
                                                }

                                                if (this.httprequest.state == 0) {
                                                    // Check if this is a relay connection
                                                    if ((data == 'c') || (data == 'cr')) { this.httprequest.state = 1; /*sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid);*/ }
                                                }
                                                else {
                                                    // Handle tunnel data
                                                    if (this.httprequest.protocol == 0) {   // 1 = Terminal (admin), 2 = Desktop, 5 = Files, 6 = PowerShell (admin), 7 = Plugin Data Exchange, 8 = Terminal (user), 9 = PowerShell (user), 10 = FileTransfer
                                                        // Take a look at the protocol
                                                        if ((data.length > 3) && (data[0] == '{')) { onTunnelControlData(data, this); return; }
                                                        this.httprequest.protocol = parseInt(data);
                                                        if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                                                        if (this.httprequest.protocol == 10) {
                                                            //
                                                            // Basic file transfer
                                                            //
                                                            var stats = null;
                                                            if ((process.platform != 'win32') && (this.httprequest.xoptions.file.startsWith('/') == false)) { this.httprequest.xoptions.file = '/' + this.httprequest.xoptions.file; }
                                                            try { stats = require('fs').statSync(this.httprequest.xoptions.file) } catch (e) { }
                                                            try { if (stats) { this.httprequest.downloadFile = fs.createReadStream(this.httprequest.xoptions.file, { flags: 'rbN' }); } } catch (e) { }
                                                            if (this.httprequest.downloadFile) {
                                                                //sendConsoleText('BasicFileTransfer, ok, ' + this.httprequest.xoptions.file + ', ' + JSON.stringify(stats));
                                                                this.write(JSON.stringify({ op: 'ok', size: stats.size }));
                                                                this.httprequest.downloadFile.pipe(this);
                                                                this.httprequest.downloadFile.end = function () { }
                                                            } else {
                                                                //sendConsoleText('BasicFileTransfer, cancel, ' + this.httprequest.xoptions.file);
                                                                this.write(JSON.stringify({ op: 'cancel' }));
                                                            }
                                                        }
                                                        else if ((this.httprequest.protocol == 1) || (this.httprequest.protocol == 6) || (this.httprequest.protocol == 8) || (this.httprequest.protocol == 9)) {
                                                            //
                                                            // Remote Terminal
                                                            //
                                                            if (process.platform == "win32") {
                                                                var cols = 80, rows = 25;
                                                                if (this.httprequest.xoptions) {
                                                                    if (this.httprequest.xoptions.rows) { rows = this.httprequest.xoptions.rows; }
                                                                    if (this.httprequest.xoptions.cols) { cols = this.httprequest.xoptions.cols; }
                                                                }

                                                                // Admin Terminal
                                                                if (require('win-virtual-terminal').supported) {
                                                                    // ConPTY PseudoTerminal
                                                                    // this.httprequest._term = require('win-virtual-terminal')[this.httprequest.protocol == 6 ? 'StartPowerShell' : 'Start'](80, 25);

                                                                    // The above line is commented out, because there is a bug with ClosePseudoConsole() API, so this is the workaround
                                                                    this.httprequest._dispatcher = require('win-dispatcher').dispatch({ modules: [{ name: 'win-virtual-terminal', script: getJSModule('win-virtual-terminal') }], launch: { module: 'win-virtual-terminal', method: 'Start', args: [cols, rows] } });
                                                                    this.httprequest._dispatcher.ws = this;
                                                                    this.httprequest._dispatcher.on('connection', function (c) {
                                                                        this.ws._term = c;
                                                                        c.pipe(this.ws, { dataTypeSkip: 1 });
                                                                        this.ws.pipe(c, { dataTypeSkip: 1 });
                                                                    });
                                                                }
                                                                else {
                                                                    // Legacy Terminal
                                                                    this.httprequest._term = require('win-terminal').Start(80, 25);
                                                                    this.httprequest._term.pipe(this, { dataTypeSkip: 1 });
                                                                    this.pipe(this.httprequest._term, { dataTypeSkip: 1, end: false });
                                                                    this.prependListener('end', function () { this.httprequest._term.end(function () { sendConsoleText('Terminal was closed'); }); });
                                                                }
                                                            }
                                                            else {
                                                                var env = { HISTCONTROL: 'ignoreboth' };
                                                                if (process.env['LANG']) { env['LANG'] = process.env['LANG']; }
                                                                if (process.env['PATH']) { env['PATH'] = process.env['PATH']; }
                                                                if (this.httprequest.xoptions)
                                                                {
                                                                    if (this.httprequest.xoptions.rows) { env.LINES = ('' + this.httprequest.xoptions.rows); }
                                                                    if (this.httprequest.xoptions.cols) { env.COLUMNS = ('' + this.httprequest.xoptions.cols); }
                                                                }
                                                                var options = { type: childProcess.SpawnTypes.TERM, env: env };

                                                                if (require('fs').existsSync('/bin/bash')) {
                                                                    this.httprequest.process = childProcess.execFile('/bin/bash', ['bash'], options); // Start bash
                                                                }
                                                                else {
                                                                    this.httprequest.process = childProcess.execFile('/bin/sh', ['sh'], options); // Start sh
                                                                }

                                                                // Spaces at the beginning of lines are needed to hide commands from the command history
                                                                if (process.platform == 'linux') { this.httprequest.process.stdin.write(' alias ls=\'ls --color=auto\';clear\n'); }
                                                                this.httprequest.process.tunnel = this;
                                                                this.httprequest.process.on('exit', function (ecode, sig) { this.tunnel.end(); });
                                                                this.httprequest.process.stderr.on('data', function (chunk) { this.parent.tunnel.write(chunk); });
                                                                this.httprequest.process.stdout.pipe(this, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                                                                this.pipe(this.httprequest.process.stdin, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                                                                this.prependListener('end', function () { this.httprequest.process.kill(); });
                                                            }
                                                        }
                                                    }
                                                    else if (this.httprequest.protocol == 5) {
                                                        // Process files commands
                                                        var cmd = null;
                                                        try { cmd = JSON.parse(data); } catch (e) { };
                                                        if (cmd == null) { return; }
                                                        if ((cmd.ctrlChannel == '102938') || ((cmd.type == 'offer') && (cmd.sdp != null))) { return; } // If this is control data, handle it now.
                                                        if (cmd.action == undefined) { return; }
                                                        console.log('action: ', cmd.action);

                                                        //sendConsoleText('CMD: ' + JSON.stringify(cmd));

                                                        if ((cmd.path != null) && (process.platform != 'win32') && (cmd.path[0] != '/')) { cmd.path = '/' + cmd.path; } // Add '/' to paths on non-windows
                                                        //console.log(objToString(cmd, 0, ' '));
                                                        switch (cmd.action) {
                                                            case 'ls':
                                                                // Send the folder content to the browser
                                                                var response = getDirectoryInfo(cmd.path);
                                                                if (cmd.reqid != undefined) { response.reqid = cmd.reqid; }
                                                                this.write(Buffer.from(JSON.stringify(response)));
                                                                break;
                                                            case 'mkdir':
                                                                {
                                                                    // Create a new empty folder
                                                                    fs.mkdirSync(cmd.path);
                                                                    break;
                                                                }
                                                            case 'rm':
                                                                {
                                                                    // Delete, possibly recursive delete
                                                                    for (var i in cmd.delfiles) {
                                                                        try { deleteFolderRecursive(path.join(cmd.path, cmd.delfiles[i]), cmd.rec); } catch (e) { }
                                                                    }
                                                                    break;
                                                                }
                                                            case 'rename':
                                                                {
                                                                    // Rename a file or folder
                                                                    var oldfullpath = path.join(cmd.path, cmd.oldname);
                                                                    var newfullpath = path.join(cmd.path, cmd.newname);
                                                                    try { fs.renameSync(oldfullpath, newfullpath); } catch (e) { console.log(e); }
                                                                    break;
                                                                }
                                                            case 'findfile':
                                                                {
                                                                    // Search for files
                                                                    var r = require('file-search').find('"' + cmd.path + '"', cmd.filter);
                                                                    if (!r.cancel) { r.cancel = function cancel() { this.child.kill(); }; }
                                                                    this._search = r;
                                                                    r.socket = this;
                                                                    r.socket.reqid = cmd.reqid; // Search request id. This is used to send responses and cancel the request.
                                                                    r.socket.path = cmd.path;   // Search path
                                                                    r.on('result', function (str) { try { this.socket.write(Buffer.from(JSON.stringify({ action: 'findfile', r: str.substring(this.socket.path.length), reqid: this.socket.reqid }))); } catch (ex) { } });
                                                                    r.then(function () { try { this.socket.write(Buffer.from(JSON.stringify({ action: 'findfile', r: null, reqid: this.socket.reqid }))); } catch (ex) { } });
                                                                    break;
                                                                }
                                                            case 'cancelfindfile':
                                                                {
                                                                    if (this._search) { this._search.cancel(); this._search = null; }
                                                                    break;
                                                                }
                                                            case 'download':
                                                                {
                                                                    // Download a file
                                                                    var sendNextBlock = 0;
                                                                    if (cmd.sub == 'start') { // Setup the download
                                                                        if ((cmd.path == null) && (cmd.ask == 'coredump')) { // If we are asking for the coredump file, set the right path.
                                                                            if (process.platform == 'win32') {
                                                                                if (fs.existsSync(process.coreDumpLocation)) { cmd.path = process.coreDumpLocation; }
                                                                            } else {
                                                                                if ((process.cwd() != '//') && fs.existsSync(process.cwd() + 'core')) { cmd.path = process.cwd() + 'core'; }
                                                                            }
                                                                        }
                                                                        MeshServerLogEx((cmd.ask == 'coredump') ? 104 : 49, [cmd.path], 'Download: \"' + cmd.path + '\"', this.httprequest);
                                                                        if ((cmd.path == null) || (this.filedownload != null)) { this.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                                                                        this.filedownload = { id: cmd.id, path: cmd.path, ptr: 0 }
                                                                        try { this.filedownload.f = fs.openSync(this.filedownload.path, 'rbN'); } catch (e) { this.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                                                                        if (this.filedownload) { this.write({ action: 'download', sub: 'start', id: cmd.id }); }
                                                                    } else if ((this.filedownload != null) && (cmd.id == this.filedownload.id)) { // Download commands
                                                                        if (cmd.sub == 'startack') { sendNextBlock = ((typeof cmd.ack == 'number') ? cmd.ack : 8); } else if (cmd.sub == 'stop') { delete this.filedownload; } else if (cmd.sub == 'ack') { sendNextBlock = 1; }
                                                                    }
                                                                    // Send the next download block(s)
                                                                    while (sendNextBlock > 0) {
                                                                        sendNextBlock--;
                                                                        var buf = Buffer.alloc(16384);
                                                                        var len = fs.readSync(this.filedownload.f, buf, 4, 16380, null);
                                                                        this.filedownload.ptr += len;
                                                                        if (len < 16380) { buf.writeInt32BE(0x01000001, 0); fs.closeSync(this.filedownload.f); delete this.filedownload; sendNextBlock = 0; } else { buf.writeInt32BE(0x01000000, 0); }
                                                                        this.write(buf.slice(0, len + 4)); // Write as binary
                                                                    }
                                                                    break;
                                                                }
                                                            case 'upload':
                                                                {
                                                                    // Upload a file, browser to agent
                                                                    if (this.httprequest.uploadFile != null) { fs.closeSync(this.httprequest.uploadFile); delete this.httprequest.uploadFile; }
                                                                    if (cmd.path == undefined) break;
                                                                    var filepath = cmd.name ? pathjoin(cmd.path, cmd.name) : cmd.path;
                                                                    this.httprequest.uploadFilePath = filepath;
                                                                    MeshServerLogEx(50, [filepath], 'Upload: \"' + filepath + '\"', this.httprequest);
                                                                    try { this.httprequest.uploadFile = fs.openSync(filepath, 'wbN'); } catch (e) { this.write(Buffer.from(JSON.stringify({ action: 'uploaderror', reqid: cmd.reqid }))); break; }
                                                                    this.httprequest.uploadFileid = cmd.reqid;
                                                                    if (this.httprequest.uploadFile) { this.write(Buffer.from(JSON.stringify({ action: 'uploadstart', reqid: this.httprequest.uploadFileid }))); }
                                                                    break;
                                                                }
                                                            case 'uploaddone':
                                                                {
                                                                    // Indicates that an upload is done
                                                                    if (this.httprequest.uploadFile) {
                                                                        fs.closeSync(this.httprequest.uploadFile);
                                                                        this.write(Buffer.from(JSON.stringify({ action: 'uploaddone', reqid: this.httprequest.uploadFileid }))); // Indicate that we closed the file.
                                                                        delete this.httprequest.uploadFile;
                                                                        delete this.httprequest.uploadFileid;
                                                                        delete this.httprequest.uploadFilePath;
                                                                    }
                                                                    break;
                                                                }
                                                            case 'uploadcancel':
                                                                {
                                                                    // Indicates that an upload is canceled
                                                                    if (this.httprequest.uploadFile) {
                                                                        fs.closeSync(this.httprequest.uploadFile);
                                                                        fs.unlinkSync(this.httprequest.uploadFilePath);
                                                                        this.write(Buffer.from(JSON.stringify({ action: 'uploadcancel', reqid: this.httprequest.uploadFileid }))); // Indicate that we closed the file.
                                                                        delete this.httprequest.uploadFile;
                                                                        delete this.httprequest.uploadFileid;
                                                                        delete this.httprequest.uploadFilePath;
                                                                    }
                                                                    break;
                                                                }
                                                            case 'copy': {
                                                                // Copy a bunch of files from scpath to dspath
                                                                for (var i in cmd.names) {
                                                                    var sc = path.join(cmd.scpath, cmd.names[i]), ds = path.join(cmd.dspath, cmd.names[i]);
                                                                    if (sc != ds) { try { fs.copyFileSync(sc, ds); } catch (e) { } }
                                                                }
                                                                break;
                                                            }
                                                            case 'move': {
                                                                // Move a bunch of files from scpath to dspath
                                                                for (var i in cmd.names) {
                                                                    var sc = path.join(cmd.scpath, cmd.names[i]), ds = path.join(cmd.dspath, cmd.names[i]);
                                                                    if (sc != ds) { try { fs.copyFileSync(sc, ds); fs.unlinkSync(sc); } catch (e) { } }
                                                                }
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            });
                                        });
                                        tunnel.onerror = function (e) { sendConsoleText("ERROR: " + JSON.stringify(e)); }
                                        tunnel.sessionid = data.sessionid;
                                        tunnel.rights = data.rights;
                                        tunnel.state = 0;
                                        tunnel.url = xurl;
                                        tunnel.protocol = 0;
                                        tunnel.tcpaddr = data.tcpaddr;
                                        tunnel.tcpport = data.tcpport;
                                        tunnel.end();
                                        // Put the tunnel in the tunnels list
                                        var index = nextTunnelIndex++;
                                        tunnel.index = index;
                                        tunnels[index] = tunnel;

                                        //sendConsoleText('New tunnel connection #' + index + ': ' + tunnel.url + ', rights: ' + tunnel.rights, data.sessionid);
                                    }
                                }
                                break;
                            }

                        default:
                            // Unknown action, ignore it.
                            break;
                    }
                    break;
                }
            default:
                // Unknown action, ignore it.
                break;
        }
    }
});

function processConsoleCommand(cmd, args, rights, sessionid) {
    try {
        var response = null;
        switch (cmd)
        {
            default:
                { // This is an unknown command, return an error message
                    response = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.';
                    break;
                }
            case 'commandline':
                {
                    if (process.platform == 'win32')
                    {
                        response = JSON.stringify(windows_getCommandLine(), null, 1);
                    }
                    else
                    {
                        response = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.';
                    }
                }
                break;
            case 'help':
                response = "Available commands are: agentupdate, agentupdateex, dbkeys, dbget, dbset, dbcompact, eval, netinfo, osinfo, setdebug, versions.";
                break;
            case '_descriptors':
                response = 'Open Descriptors: ' + JSON.stringify(getOpenDescriptors());
                break;
            case 'versions':
                response = JSON.stringify(process.versions, null, '  ');
                break;
            case 'agentupdate':
                // Request that the server send a agent update command
                require('MeshAgent').SendCommand({ action: 'agentupdate', sessionid: sessionid });
                break;
            case 'agentupdateex':
                // Perform an direct agent update without requesting any information from the server, this should not typically be used.
                if (args['_'].length == 1) {
                    if (args['_'][0].startsWith('https://')) { agentUpdate_Start(args['_'][0], { sessionid: sessionid }); } else { response = "Usage: agentupdateex https://server/path"; }
                } else {
                    agentUpdate_Start(null, { sessionid: sessionid });
                }
                break;
            case 'eval':
                { // Eval JavaScript
                    if (args['_'].length < 1) {
                        response = 'Proper usage: eval "JavaScript code"'; // Display correct command usage
                    } else {
                        response = JSON.stringify(require('MeshAgent').eval(args['_'][0])); // This can only be run by trusted administrator.
                    }
                    break;
                }
            case 'setdebug':
                {
                    if (args['_'].length < 1) { response = 'Proper usage: setdebug (target), 0 = Disabled, 1 = StdOut, 2 = This Console, * = All Consoles, 4 = WebLog, 8 = Logfile'; } // Display usage
                    else { if (args['_'][0] == '*') { console.setDestination(2); } else { console.setDestination(parseInt(args['_'][0]), sessionid); } }
                    break;
                }
            case 'osinfo': { // Return the operating system information
                var i = 1;
                if (args['_'].length > 0) { i = parseInt(args['_'][0]); if (i > 8) { i = 8; } response = 'Calling ' + i + ' times.'; }
                for (var j = 0; j < i; j++) {
                    var pr = require('os').name();
                    pr.sessionid = sessionid;
                    pr.then(function (v) {
                        sendConsoleText("OS: " + v + (process.platform == 'win32' ? (require('win-virtual-terminal').supported ? ' [ConPTY: YES]' : ' [ConPTY: NO]') : ''), this.sessionid);
                    });
                }
                break;
            }
            case 'dbkeys': { // Return all data store keys
                response = JSON.stringify(db.Keys);
                break;
            }
            case 'dbget': { // Return the data store value for a given key
                if (db == null) { response = "Database not accessible."; break; }
                if (args['_'].length != 1) {
                    response = "Proper usage: dbget (key)"; // Display the value for a given database key
                } else {
                    response = db.Get(args['_'][0]);
                }
                break;
            }
            case 'dbset': { // Set a data store key and value pair
                if (db == null) { response = "Database not accessible."; break; }
                if (args['_'].length != 2) {
                    response = "Proper usage: dbset (key) (value)"; // Set a database key
                } else {
                    var r = db.Put(args['_'][0], args['_'][1]);
                    response = "Key set: " + r;
                }
                break;
            }
            case 'dbcompact': { // Compact the data store
                if (db == null) { response = "Database not accessible."; break; }
                var r = db.Compact();
                response = "Database compacted: " + r;
                break;
            }
            case 'tunnels': { // Show the list of current tunnels
                response = '';
                for (var i in tunnels) { response += "Tunnel #" + i + ", " + tunnels[i].url + '\r\n'; }
                if (response == '') { response = "No websocket sessions."; }
                break;
            }
            case 'netinfo': { // Show network interface information
                //response = objToString(mesh.NetInfo, 0, ' ');
                var interfaces = require('os').networkInterfaces();
                response = objToString(interfaces, 0, ' ', true);
                break;
            }
            case 'name':
                {
                    response = 'Service Name = ' + require('MeshAgent').serviceName;
                }
                break;
        }
    } catch (e) { response = "Command returned an exception error: " + e; console.log(e); }
    if (response != null) { sendConsoleText(response, sessionid); }
}

// Get a formated response for a given directory path
function getDirectoryInfo(reqpath) {
    var response = { path: reqpath, dir: [] };
    if (((reqpath == undefined) || (reqpath == '')) && (process.platform == 'win32')) {
        // List all the drives in the root, or the root itself
        var results = null;
        try { results = fs.readDrivesSync(); } catch (e) { } // TODO: Anyway to get drive total size and free space? Could draw a progress bar.
        if (results != null) {
            for (var i = 0; i < results.length; ++i) {
                var drive = { n: results[i].name, t: 1 };
                if (results[i].type == 'REMOVABLE') { drive.dt = 'removable'; } // TODO: See if this is USB/CDROM or something else, we can draw icons.
                response.dir.push(drive);
            }
        }
    } else {
        // List all the files and folders in this path
        if (reqpath == '') { reqpath = '/'; }
        var results = null, xpath = path.join(reqpath, '*');
        //if (process.platform == "win32") { xpath = xpath.split('/').join('\\'); }
        try { results = fs.readdirSync(xpath); } catch (e) { }
        if (results != null) {
            for (var i = 0; i < results.length; ++i) {
                if ((results[i] != '.') && (results[i] != '..')) {
                    var stat = null, p = path.join(reqpath, results[i]);
                    //if (process.platform == "win32") { p = p.split('/').join('\\'); }
                    try { stat = fs.statSync(p); } catch (e) { } // TODO: Get file size/date
                    if ((stat != null) && (stat != undefined)) {
                        if (stat.isDirectory() == true) {
                            response.dir.push({ n: results[i], t: 2, d: stat.mtime });
                        } else {
                            response.dir.push({ n: results[i], t: 3, s: stat.size, d: stat.mtime });
                        }
                    }
                }
            }
        }
    }
    return response;
}
// Delete a directory with a files and directories within it
function deleteFolderRecursive(path, rec) {
    if (fs.existsSync(path)) {
        if (rec == true) {
            fs.readdirSync(path.join(path, '*')).forEach(function (file, index) {
                var curPath = path.join(path, file);
                if (fs.statSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath, true);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
        }
        fs.unlinkSync(path);
    }
};
