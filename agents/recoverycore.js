
var http = require('http');
var childProcess = require('child_process');
var meshCoreObj = { action: 'coreinfo', value: "MeshCore Recovery", caps: 14 }; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
var nextTunnelIndex = 1;
var tunnels = {};
var fs = require('fs');

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
            id = require('os').arch() == 'x64' ? 16 : 29;
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

function agentUpdate_Start(updateurl, updateoptions)
{
    var sessionid = updateoptions != null ? updateoptions.session : null;

    if (this._selfupdate != null)
    {
        if (sessionid != null) { sendConsoleText('Self update already in progress...', sessionid); }
    }
    else
    {
        if (require('MeshAgent').ARCHID == null && updateurl == null)
        {
            if (sessionid != null) { sendConsoleText('Unable to initiate update, agent ARCHID is not defined', sessionid); }
        }
        else
        {
            var agentfilename = process.execPath.split(process.platform == 'win32' ? '\\' : '/').pop();
            var name = require('MeshAgent').serviceName;
            if (name == null) { name = process.platform == 'win32' ? 'Mesh Agent' : 'meshagent'; }
            try
            {
                var s = require('service-manager').manager.getService(name);
                if (!s.isMe())
                {
                    if (process.platform == 'win32') { s.close(); }
                    if (sessionid != null) { sendConsoleText('Service check FAILED', sessionid); }
                    return;
                }
                if (process.platform == 'win32') { s.close(); }
            }
            catch (zz)
            {
                if (sessionid != null) { sendConsoleText('Service check FAILED', sessionid); }
                else
                {
                    sendAgentMessage('Self Update Failed, because this agent is not running as a service', 3);
                }
                return;
            }

            if (sessionid != null) { sendConsoleText('Downloading update...', sessionid); }
            var options = require('http').parseUri(updateurl != null ? updateurl : require('MeshAgent').ServerUrl);
            options.protocol = 'https:';
            if (updateurl == null) { options.path = ('/meshagents?id=' + require('MeshAgent').ARCHID); }
            options.rejectUnauthorized = false;
            options.checkServerIdentity = function checkServerIdentity(certs)
            {
                // If the tunnel certificate matches the control channel certificate, accept the connection
                try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.digest == certs[0].digest) return; } catch (ex) { }
                try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.fingerprint == certs[0].fingerprint) return; } catch (ex) { }

                // Check that the certificate is the one expected by the server, fail if not.
                if (checkServerIdentity.servertlshash == null)
                {
                    if(sessionid!=null)
                    {
                        sendConsoleText('Self Update failed, because the url cannot be verified', sessionid);
                    }
                    else
                    {
                        sendAgentMessage('Self Update failed, because the url cannot be verified', 3);
                    }
                    throw new Error('BadCert');
                }
                if ((checkServerIdentity.servertlshash != null) && (checkServerIdentity.servertlshash.toLowerCase() != certs[0].digest.split(':').join('').toLowerCase()))
                {
                    if (sessionid != null)
                    {
                        sendConsoleText('Self Update failed, because the supplied certificate does not match', sessionid);
                    }
                    else
                    {
                        sendAgentMessage('Self Update failed, because the supplied certificate does not match', 3);
                    }
                    throw new Error('BadCert')
                }
            }
            options.checkServerIdentity.servertlshash = (updateoptions != null ? updateoptions.tlshash : null);
            this._selfupdate = require('https').get(options);
            this._selfupdate.on('error', function (e)
            {
                if (sessionid != null) { sendConsoleText('Error fetching update', sessionid); }
                else
                {
                    sendAgentMessage('Self Update failed, because there was a problem trying to download the update', 3);
                }
            });
            this._selfupdate.on('response', function (img)
            {
                this._file = require('fs').createWriteStream(agentfilename + '.update', { flags: 'wb' });
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
                            if (sessionid != null) { sendConsoleText('Download complete. HASH FAILED.', sessionid); }
                            else
                            {
                                sendAgentMessage('Self Update FAILED because the downloaded agent FAILED hash check', 3);
                            }
                            return;
                        }
                    }
                    else
                    {
                        if (sessionid != null) { sendConsoleText('Download complete. HASH=' + h.toString('hex'), sessionid); }
                    }

                    if (sessionid != null) { sendConsoleText('Updating and restarting agent...', sessionid); }
                    if (process.platform == 'win32')
                    {
                        this.child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe',
                            ['/C wmic service "' + name + '" call stopservice && copy "' + process.cwd() + agentfilename + '.update" "' + process.execPath + '" && wmic service "' + name + '" call startservice && erase "' + process.cwd() + agentfilename + '.update"'], { type: 4 | 0x8000 });
                    }
                    else
                    {
                        // remove binary
                        require('fs').unlinkSync(process.execPath);

                        // copy update
                        require('fs').copyFileSync(process.cwd() + agentfilename + '.update', process.execPath);

                        // erase update
                        require('fs').unlinkSync(process.cwd() + agentfilename + '.update');

                        // add execute permissions
                        var m = require('fs').statSync(process.execPath).mode;
                        m |= (require('fs').CHMOD_MODES.S_IXUSR | require('fs').CHMOD_MODES.S_IXGRP | require('fs').CHMOD_MODES.S_IXOTH);
                        require('fs').chmodSync(process.execPath, m);

                        if (sessionid != null) { sendConsoleText('Restarting service...', sessionid); }
                        try
                        {
                            // restart service
                            var s = require('service-manager').manager.getService(name);
                            s.restart();
                        }
                        catch (zz)
                        {
                            if (sessionid != null) { sendConsoleText('Error restarting service', sessionid); }
                            else
                            {
                                sendAgentMessage('Self Update encountered an error trying to restart service', 3);
                            }
                        }
                    }
                });
                img.pipe(this._file);
                img.pipe(this._filehash);
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

// Tunnel callback operations
function onTunnelUpgrade(response, s, head) {
    this.s = s;
    s.httprequest = this;
    s.end = onTunnelClosed;
    s.tunnel = this;

    //sendConsoleText('onTunnelUpgrade');

    if (this.tcpport != null) {
        // This is a TCP relay connection, pause now and try to connect to the target.
        s.pause();
        s.data = onTcpRelayServerTunnelData;
        var connectionOptions = { port: parseInt(this.tcpport) };
        if (this.tcpaddr != null) { connectionOptions.host = this.tcpaddr; } else { connectionOptions.host = '127.0.0.1'; }
        s.tcprelay = net.createConnection(connectionOptions, onTcpRelayTargetTunnelConnect);
        s.tcprelay.peerindex = this.index;
    } else {
        // This is a normal connect for KVM/Terminal/Files
        s.data = onTunnelData;
    }
}

// Called when receiving control data on websocket
function onTunnelControlData(data, ws)
{
    var obj;
    if (ws == null) { ws = this; }
    if (typeof data == 'string') { try { obj = JSON.parse(data); } catch (e) { sendConsoleText('Invalid control JSON: ' + data); return; } }
    else if (typeof data == 'object') { obj = data; } else { return; }
    //sendConsoleText('onTunnelControlData(' + ws.httprequest.protocol + '): ' + JSON.stringify(data));
    //console.log('onTunnelControlData: ' + JSON.stringify(data));

    if (obj.action)
    {
        switch (obj.action)
        {
            case 'lock': {
                // Lock the current user out of the desktop
                try
                {
                    if (process.platform == 'win32')
                    {
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

    switch (obj.type)
    {
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
            if (process.platform == 'win32')
            {
                if (ws.httprequest._dispatcher == null) return;
                if (ws.httprequest._dispatcher.invoke) { ws.httprequest._dispatcher.invoke('resizeTerminal', [obj.cols, obj.rows]); }
            }
            else
            {
                if (ws.httprequest.process == null || ws.httprequest.process.pty == 0) return;
                if (ws.httprequest.process.tcsetsize) { ws.httprequest.process.tcsetsize(obj.rows, obj.cols); }
            }
            break;
        }
    }
}


require('MeshAgent').AddCommandHandler(function (data)
{
    if (typeof data == 'object')
    {
        // If this is a console command, parse it and call the console handler
        switch (data.action)
        {
            case 'agentupdate':
                agentUpdate_Start(data.url, { hash: data.hash, tlshash: data.servertlshash });
                break;
            case 'msg':
                {
                    switch (data.type)
                    {
                        case 'console': { // Process a console command
                            if (data.value && data.sessionid)
                            {
                                var args = splitArgs(data.value);
                                processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid);
                            }
                            break;
                        }
                        case 'tunnel':
                            {
                                if (data.value != null)
                                { // Process a new tunnel connection request
                                    // Create a new tunnel object
                                    var xurl = getServerTargetUrlEx(data.value);
                                    if (xurl != null)
                                    {
                                        var woptions = http.parseUri(xurl);
                                        woptions.rejectUnauthorized = 0;
                                        //sendConsoleText(JSON.stringify(woptions));
                                        var tunnel = http.request(woptions);
                                        tunnel.on('upgrade', function (response, s, head)
                                        {
                                            this.s = s;
                                            s.httprequest = this;
                                            s.tunnel = this;
                                            s.on('end', function ()
                                            {
                                                if (tunnels[this.httprequest.index] == null) return; // Stop duplicate calls.

                                                // If there is a upload or download active on this connection, close the file
                                                if (this.httprequest.uploadFile) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
                                                if (this.httprequest.downloadFile) { fs.closeSync(this.httprequest.downloadFile); this.httprequest.downloadFile = undefined; }


                                                //sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
                                                delete tunnels[this.httprequest.index];

                                                // Clean up WebSocket
                                                this.removeAllListeners('data');
                                            });
                                            s.on('data', function (data)
                                            {
                                                // If this is upload data, save it to file
                                                if (this.httprequest.uploadFile)
                                                {
                                                    try { fs.writeSync(this.httprequest.uploadFile, data); } catch (e) { this.write(Buffer.from(JSON.stringify({ action: 'uploaderror' }))); return; } // Write to the file, if there is a problem, error out.
                                                    this.write(Buffer.from(JSON.stringify({ action: 'uploadack', reqid: this.httprequest.uploadFileid }))); // Ask for more data
                                                    return;
                                                }

                                                if (this.httprequest.state == 0)
                                                {
                                                    // Check if this is a relay connection
                                                    if ((data == 'c') || (data == 'cr')) { this.httprequest.state = 1; sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid); }
                                                } else
                                                {
                                                    // Handle tunnel data
                                                    if (this.httprequest.protocol == 0)
                                                    {
                                                        if ((data.length > 3) && (data[0] == '{')) { onTunnelControlData(data, this); return; }
                                                        // Take a look at the protocol
                                                        this.httprequest.protocol = parseInt(data);
                                                        if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                                                        if ((this.httprequest.protocol == 1) || (this.httprequest.protocol == 6) || (this.httprequest.protocol == 8) || (this.httprequest.protocol == 9))
                                                        {
                                                            // Remote terminal using native pipes
                                                            if (process.platform == "win32")
                                                            {
                                                                var cols = 80, rows = 25;
                                                                if (this.httprequest.xoptions)
                                                                {
                                                                    if (this.httprequest.xoptions.rows) { rows = this.httprequest.xoptions.rows; }
                                                                    if (this.httprequest.xoptions.cols) { cols = this.httprequest.xoptions.cols; }
                                                                }

                                                                // Admin Terminal
                                                                if (require('win-virtual-terminal').supported)
                                                                {
                                                                    // ConPTY PseudoTerminal
                                                                    // this.httprequest._term = require('win-virtual-terminal')[this.httprequest.protocol == 6 ? 'StartPowerShell' : 'Start'](80, 25);

                                                                    // The above line is commented out, because there is a bug with ClosePseudoConsole() API, so this is the workaround
                                                                    this.httprequest._dispatcher = require('win-dispatcher').dispatch({ modules: [{ name: 'win-virtual-terminal', script: getJSModule('win-virtual-terminal') }], launch: { module: 'win-virtual-terminal', method: 'Start', args: [cols, rows] } });
                                                                    this.httprequest._dispatcher.ws = this;
                                                                    this.httprequest._dispatcher.on('connection', function (c)
                                                                    {
                                                                        this.ws._term = c;
                                                                        c.pipe(this.ws, { dataTypeSkip: 1 });
                                                                        this.ws.pipe(c, { dataTypeSkip: 1 });
                                                                    });
                                                                }
                                                                else
                                                                {
                                                                    // Legacy Terminal
                                                                    this.httprequest._term = require('win-terminal').Start(80, 25);
                                                                    this.httprequest._term.pipe(this, { dataTypeSkip: 1 });
                                                                    this.pipe(this.httprequest._term, { dataTypeSkip: 1, end: false });
                                                                    this.prependListener('end', function () { this.httprequest._term.end(function () { sendConsoleText('Terminal was closed'); }); });
                                                                }
                                                            }
                                                            else
                                                            {
                                                                var env = { HISTCONTROL: 'ignoreboth' };
                                                                if (this.httprequest.xoptions)
                                                                {
                                                                    if (this.httprequest.xoptions.rows) { env.LINES = ('' + this.httprequest.xoptions.rows); }
                                                                    if (this.httprequest.xoptions.cols) { env.COLUMNS = ('' + this.httprequest.xoptions.cols); }
                                                                }
                                                                var options = { type: childProcess.SpawnTypes.TERM, env: env };

                                                                if (require('fs').existsSync('/bin/bash'))
                                                                {
                                                                    this.httprequest.process = childProcess.execFile('/bin/bash', ['bash'], options); // Start bash
                                                                }
                                                                else
                                                                {
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
                                                    else if (this.httprequest.protocol == 5)
                                                    {
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
                                                        switch (cmd.action)
                                                        {
                                                            case 'ls':
                                                                // Send the folder content to the browser
                                                                var response = getDirectoryInfo(cmd.path);
                                                                if (cmd.reqid != undefined) { response.reqid = cmd.reqid; }
                                                                this.write(Buffer.from(JSON.stringify(response)));
                                                                break;
                                                            case 'mkdir': {
                                                                // Create a new empty folder
                                                                fs.mkdirSync(cmd.path);
                                                                break;
                                                            }
                                                            case 'rm': {
                                                                // Delete, possibly recursive delete
                                                                for (var i in cmd.delfiles)
                                                                {
                                                                    try { deleteFolderRecursive(path.join(cmd.path, cmd.delfiles[i]), cmd.rec); } catch (e) { }
                                                                }
                                                                break;
                                                            }
                                                            case 'rename': {
                                                                // Rename a file or folder
                                                                var oldfullpath = path.join(cmd.path, cmd.oldname);
                                                                var newfullpath = path.join(cmd.path, cmd.newname);
                                                                try { fs.renameSync(oldfullpath, newfullpath); } catch (e) { console.log(e); }
                                                                break;
                                                            }
                                                            case 'upload': {
                                                                // Upload a file, browser to agent
                                                                if (this.httprequest.uploadFile != undefined) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
                                                                if (cmd.path == undefined) break;
                                                                var filepath = cmd.name ? path.join(cmd.path, cmd.name) : cmd.path;
                                                                try { this.httprequest.uploadFile = fs.openSync(filepath, 'wbN'); } catch (e) { this.write(Buffer.from(JSON.stringify({ action: 'uploaderror', reqid: cmd.reqid }))); break; }
                                                                this.httprequest.uploadFileid = cmd.reqid;
                                                                if (this.httprequest.uploadFile) { this.write(Buffer.from(JSON.stringify({ action: 'uploadstart', reqid: this.httprequest.uploadFileid }))); }
                                                                break;
                                                            }
                                                            case 'copy': {
                                                                // Copy a bunch of files from scpath to dspath
                                                                for (var i in cmd.names)
                                                                {
                                                                    var sc = path.join(cmd.scpath, cmd.names[i]), ds = path.join(cmd.dspath, cmd.names[i]);
                                                                    if (sc != ds) { try { fs.copyFileSync(sc, ds); } catch (e) { } }
                                                                }
                                                                break;
                                                            }
                                                            case 'move': {
                                                                // Move a bunch of files from scpath to dspath
                                                                for (var i in cmd.names)
                                                                {
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
        switch (cmd) {
            case 'help':
                response = "Available commands are: osinfo, dbkeys, dbget, dbset, dbcompact, netinfo, versions, agentupdate.";
                break;
            case 'versions':
                response = JSON.stringify(process.versions, null, '  ');
                break;
            case 'agentupdate':
                // Request that the server send a agent update command
                require('MeshAgent').SendCommand({ action: 'agentupdate' });
                break;
            case 'agentupdateex':
                // Perform an direct agent update without requesting any information from the server, this should not typically be used.
                agentUpdate_Start(null, { session: sessionid });
                break;
            case 'osinfo': { // Return the operating system information
                var i = 1;
                if (args['_'].length > 0) { i = parseInt(args['_'][0]); if (i > 8) { i = 8; } response = 'Calling ' + i + ' times.'; }
                for (var j = 0; j < i; j++)
                {
                    var pr = require('os').name();
                    pr.sessionid = sessionid;
                    pr.then(function (v)
                    {
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
            default: { // This is an unknown command, return an error message
                response = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.';
                break;
            }
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
