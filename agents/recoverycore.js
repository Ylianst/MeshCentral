
var http = require('http');
var childProcess = require('child_process');
var meshCoreObj = { "action": "coreinfo", "value": "MeshCore Recovery", "caps": 10 }; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
var nextTunnelIndex = 1;
var tunnels = {};

function sendConsoleText(msg)
{
    require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": msg });
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
                                        //sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
                                        delete tunnels[this.httprequest.index];

                                        // Clean up WebSocket
                                        this.removeAllListeners('data');
                                    });
                                    s.on('data', function (data)
                                    {
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
                response = 'Unknown command \"' + cmd + '\", type \"help\" for list of avaialble commands.';
                break;
            }
        }
    } catch (e) { response = 'Command returned an exception error: ' + e; console.log(e); }
    if (response != null) { sendConsoleText(response, sessionid); }
}
