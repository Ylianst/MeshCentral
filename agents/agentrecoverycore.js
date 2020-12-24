
var http = require('http');
var childProcess = require('child_process');
var meshCoreObj = { "action": "coreinfo", "value": "MeshCore Recovery", "caps": 14 }; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
var nextTunnelIndex = 1;
var tunnels = {};
var fs = require('fs');

//attachDebugger({ webport: 9994, wait: 1 }).then(function (p) { console.log('Debug on port: ' + p); });

function sendConsoleText(msg)
{
    require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": msg });
}
// Return p number of spaces 
function addPad(p, ret) { var r = ''; for (var i = 0; i < p; i++) { r += ret; } return r; }

var path =
    {
        join: function ()
        {
            var x = [];
            for (var i in arguments)
            {
                var w = arguments[i];
                if (w != null)
                {
                    while (w.endsWith('/') || w.endsWith('\\')) { w = w.substring(0, w.length - 1); }
                    if (i != 0)
                    {
                        while (w.startsWith('/') || w.startsWith('\\')) { w = w.substring(1); }
                    }
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
function splitArgs(str)
{
    var myArray = [], myRegexp = /[^\s"]+|"([^"]*)"/gi;
    do { var match = myRegexp.exec(str); if (match != null) { myArray.push(match[1] ? match[1] : match[0]); } } while (match != null);
    return myArray;
}

// Parse arguments string array into an object
function parseArgs(argv)
{
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
function getServerTargetUrl(path)
{
    var x = require('MeshAgent').ServerUrl;
    //sendConsoleText("mesh.ServerUrl: " + mesh.ServerUrl);
    if (x == null) { return null; }
    if (path == null) { path = ''; }
    x = http.parseUri(x);
    if (x == null) return null;
    return x.protocol + '//' + x.host + ':' + x.port + '/' + path;
}

// Get server url. If the url starts with "*/..." change it, it not use the url as is.
function getServerTargetUrlEx(url)
{
    if (url.substring(0, 2) == '*/') { return getServerTargetUrl(url.substring(2)); }
    return url;
}

require('MeshAgent').on('Connected', function ()
{
    require('os').name().then(function (v)
    {
        sendConsoleText("Mesh Agent Receovery Console, OS: " + v);
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

require('MeshAgent').AddCommandHandler(function (data)
{
    if (typeof data == 'object')
    {
        // If this is a console command, parse it and call the console handler
        switch (data.action)
        {
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
                        if (data.value != null) { // Process a new tunnel connection request
                            // Create a new tunnel object
                            var xurl = getServerTargetUrlEx(data.value);
                            if (xurl != null) {
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
                                            try { fs.writeSync(this.httprequest.uploadFile, data); } catch (e) { this.write(new Buffer(JSON.stringify({ action: 'uploaderror' }))); return; } // Write to the file, if there is a problem, error out.
                                            this.write(new Buffer(JSON.stringify({ action: 'uploadack', reqid: this.httprequest.uploadFileid }))); // Ask for more data
                                            return;
                                        }

                                        if (this.httprequest.state == 0) {
                                            // Check if this is a relay connection
                                            if (data == 'c') { this.httprequest.state = 1; sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid); }
                                        } else {
                                            // Handle tunnel data
                                            if (this.httprequest.protocol == 0)
                                            {
                                                // Take a look at the protocol
                                                this.httprequest.protocol = parseInt(data);
                                                if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                                                if (this.httprequest.protocol == 1) 
                                                {
                                                    // Remote terminal using native pipes
                                                    if (process.platform == "win32")
                                                    {
                                                        this.httprequest._term = require('win-terminal').Start(80, 25);
                                                        this.httprequest._term.pipe(this, { dataTypeSkip: 1 });
                                                        this.pipe(this.httprequest._term, { dataTypeSkip: 1, end: false });
                                                        this.prependListener('end', function () { this.httprequest._term.end(function () { sendConsoleText('Terminal was closed'); }); });
                                                    }
                                                    else
                                                    {
                                                        this.httprequest.process = childProcess.execFile("/bin/sh", ["sh"], { type: childProcess.SpawnTypes.TERM });
                                                        this.httprequest.process.tunnel = this;
                                                        this.httprequest.process.on('exit', function (ecode, sig) { this.tunnel.end(); });
                                                        this.httprequest.process.stderr.on('data', function (chunk) { this.parent.tunnel.write(chunk); });
                                                        this.httprequest.process.stdout.pipe(this, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                                                        this.pipe(this.httprequest.process.stdin, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                                                        this.prependListener('end', function () { this.httprequest.process.kill(); });
                                                    }

                                                    this.on('end', function () {
                                                        if (process.platform == "win32")
                                                        {
                                                            // Unpipe the web socket
                                                            this.unpipe(this.httprequest._term);
                                                            this.httprequest._term.unpipe(this);

                                                            // Clean up
                                                            this.httprequest._term.end();
                                                            this.httprequest._term = null;
                                                        }
                                                    });
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
                                                        this.write(new Buffer(JSON.stringify(response)));
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
                                                        try { this.httprequest.uploadFile = fs.openSync(filepath, 'wbN'); } catch (e) { this.write(new Buffer(JSON.stringify({ action: 'uploaderror', reqid: cmd.reqid }))); break; }
                                                        this.httprequest.uploadFileid = cmd.reqid;
                                                        if (this.httprequest.uploadFile) { this.write(new Buffer(JSON.stringify({ action: 'uploadstart', reqid: this.httprequest.uploadFileid }))); }
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
                                tunnel.onerror = function (e) { sendConsoleText('ERROR: ' + JSON.stringify(e)); }
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

function processConsoleCommand(cmd, args, rights, sessionid)
{
    try
    {
        var response = null;
        switch (cmd)
        {
            case 'help':
                response = 'Available commands are: osinfo, dbkeys, dbget, dbset, dbcompact, netinfo.';
                break;
            
            case 'osinfo': { // Return the operating system information
                var i = 1;
                if (args['_'].length > 0) { i = parseInt(args['_'][0]); if (i > 8) { i = 8; } response = 'Calling ' + i + ' times.'; }
                for (var j = 0; j < i; j++) {
                    var pr = require('os').name();
                    pr.sessionid = sessionid;
                    pr.then(function (v) { sendConsoleText("OS: " + v, this.sessionid); });
                }
                break;
            }
            case 'dbkeys': { // Return all data store keys
                response = JSON.stringify(db.Keys);
                break;
            }
            case 'dbget': { // Return the data store value for a given key
                if (db == null) { response = 'Database not accessible.'; break; }
                if (args['_'].length != 1) {
                    response = 'Proper usage: dbget (key)'; // Display the value for a given database key
                } else {
                    response = db.Get(args['_'][0]);
                }
                break;
            }
            case 'dbset': { // Set a data store key and value pair
                if (db == null) { response = 'Database not accessible.'; break; }
                if (args['_'].length != 2) {
                    response = 'Proper usage: dbset (key) (value)'; // Set a database key
                } else {
                    var r = db.Put(args['_'][0], args['_'][1]);
                    response = 'Key set: ' + r;
                }
                break;
            }
            case 'dbcompact': { // Compact the data store
                if (db == null) { response = 'Database not accessible.'; break; }
                var r = db.Compact();
                response = 'Database compacted: ' + r;
                break;
            }
            case 'tunnels': { // Show the list of current tunnels
                response = '';
                for (var i in tunnels) { response += 'Tunnel #' + i + ', ' + tunnels[i].url + '\r\n'; }
                if (response == '') { response = 'No websocket sessions.'; }
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
    } catch (e) { response = 'Command returned an exception error: ' + e; console.log(e); }
    if (response != null) { sendConsoleText(response, sessionid); }
}

// Get a formated response for a given directory path
function getDirectoryInfo(reqpath)
{
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
