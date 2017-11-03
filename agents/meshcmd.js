var fs = require('fs');
var os = require('os');
var net = require('net');
var http = require('http');
var dgram = require('dgram');
var httpHeaders = require('http-headers');
var tcpserver = null;
var broadcastSockets = {};
var multicastSockets = {};
var discoveryInterval = null;
var membershipIPv4 = '239.255.255.235';
var membershipIPv6 = 'FF02:0:0:0:0:0:0:FE';

/*
// Route Settings
var settings = {
    action: 'route',
    localPort: 1234,
    remoteName: 'AmtMachine7',
    remoteNodeId: 'node//nmiPnDhT3vHKu$zg296YC5RjK53Trgh3Cimx3K8GVrFh$xch0UAAett2rbJpeddc',
    remotePort: 3389,
    username: 'a',
    password: 'a',
    serverUrl: 'wss://devbox.mesh.meshcentral.com:443/meshrelay.ashx',
    serverId: 'D99362D5ED8BAEA8BF9E743B34B242256370C460FD66CB62373C6CFCB204D6D707403E396CF0EF6DC2B3A42F735135FD', // SHA384 of server HTTPS public key
    serverHttpsHash: 'D9DE9E27A229B5355708A3672FB23237CC994A680B3570D242A91E36B4AE5BC9', // SHA256 of server HTTPS certificate
    debugLevel: 0
}
*/

// Check the server certificate fingerprint
function onVerifyServer(clientName, certs) {
    try { for (var i in certs) { if (certs[i].fingerprint.replace(/:/g, '') == settings.serverHttpsHash) { return; } } } catch (e) { }
    if (serverhash != null) { console.log('Error: Failed to verify server certificate.'); return false; }
}

// Print a debug message
function debug(level, message) { if ((settings.debugLevel != null) && (settings.debugLevel >= level)) { console.log(message); } }

// Parse the input arguments into an object
function parceArguments(argv) {
    var r = {};
    for (var i in argv) {
        i = parseInt(i);
        if (argv[i].startsWith('--') == true) {
            var key = argv[i].substring(2).toLowerCase(), val = true;
            if (((i + 1) < argv.length) && (argv[i + 1].startsWith('--') == false)) { val = argv[i + 1]; }
            r[key] = val;
        }
    }
    return r;
}

// Start the router, start by listening to the local port
function run(argv) {
    var args = parceArguments(argv);
    console.log('MeshCentral Command v1.0b');
    var actionpath = 'meshaction.txt';
    if (args.actionfile != null) { actionpath = args.actionfile; }
    // Load the action file
    var actionfile = null;
    try { actionfile = fs.readFileSync(actionpath); } catch (e) { }
    if (actionfile == null) { console.log('Unable to load \"' + actionpath + '\". Create this file or specify the location using --actionfile [filename].'); process.exit(1); }
    try { settings = JSON.parse(actionfile); } catch (e) { console.log(actionpath, e); process.exit(1); }

    // Set the arguments
    if ((typeof args.localport) == 'string') { settings.localport = parseInt(args.localport); }
    if ((typeof args.remotenodeid) == 'string') { settings.remoteNodeId = args.remotenodeid; }
    if ((typeof args.username) == 'string') { settings.username = args.username; }
    if ((typeof args.password) == 'string') { settings.password = args.password; }
    if ((typeof args.user) == 'string') { settings.username = args.user; }
    if ((typeof args.pass) == 'string') { settings.password = args.pass; }
    if ((typeof args.serverid) == 'string') { settings.serverId = args.serverid; }
    if ((typeof args.serverhttpshash) == 'string') { settings.serverHttpsHash = args.serverhttpshash; }
    if ((typeof args.remoteport) == 'string') { settings.remotePort = parseInt(args.remoteport); }

    // Validate meshaction.txt
    if (settings.action == null) { console.log('No \"action\" specified.'); process.exit(1); }
    settings.action = settings.action.toLowerCase();
    if (settings.action == 'route') {
        if ((settings.localPort == null) || (typeof settings.localPort != 'number') || (settings.localPort < 0) || (settings.localPort > 65535)) { console.log('No or invalid \"localPort\" specified, use --localport [localport].'); process.exit(1); }
        if ((settings.remoteNodeId == null) || (typeof settings.remoteNodeId != 'string')) { console.log('No or invalid \"remoteNodeId\" specified.'); process.exit(1); }
        if ((settings.username == null) || (typeof settings.username != 'string') || (settings.username == '')) { console.log('No or invalid \"username\" specified, use --username [username].'); process.exit(1); }
        if ((settings.password == null) || (typeof settings.password != 'string') || (settings.password == '')) { console.log('No or invalid \"password\" specified, use --password [password].'); process.exit(1); }
        if ((settings.serverId == null) || (typeof settings.serverId != 'string') || (settings.serverId.length != 96)) { console.log('No or invalid \"serverId\" specified.'); process.exit(1); }
        if ((settings.serverHttpsHash == null) || (typeof settings.serverHttpsHash != 'string') || (settings.serverHttpsHash.length != 96)) { console.log('No or invalid \"serverHttpsHash\" specified.'); process.exit(1); }
        if ((settings.remotePort == null) || (typeof settings.remotePort != 'number') || (settings.remotePort < 0) || (settings.remotePort > 65535)) { console.log('No or invalid \"remotePort\" specified, use --remoteport [remoteport].'); process.exit(1); }
    } else {
        console.log('Invalid \"action\" specified.'); process.exit(1);
    }

    debug(1, "Settings: " + JSON.stringify(settings));
    if (settings.serverUrl != null) { startRouter(); } else { discoverMeshServer(); }
}

// Starts the router
function startRouter() {
    tcpserver = net.createServer(OnTcpClientConnected);
    tcpserver.on('error', function (err) { console.log(err); process.exit(0); });
    tcpserver.listen(settings.localPort, function () {
        // We started listening.
        if (settings.remoteName == null) {
            console.log('Redirecting local port ' + settings.localPort + ' to remote port ' + settings.remotePort + '.');
        } else {
            console.log('Redirecting local port ' + settings.localPort + ' to ' + settings.remoteName + ':' + settings.remotePort + '.');
        }
        console.log('Press ctrl-c to terminal.');

        // If settings has a "cmd", run it now.
        //process.exec("notepad.exe");
    });
}

// Called when a TCP connect is received on the local port. Launch a tunnel.
function OnTcpClientConnected(c) {
    try {
        // 'connection' listener
        debug(1, 'Client connected');
        c.on('end', function () { disconnectTunnel(this, this.websocket, 'Client closed'); });
        c.pause();

        try {
            options = http.parseUri(settings.serverUrl + '?user=' + settings.username + '&pass=' + settings.password + '&nodeid=' + settings.remoteNodeId + '&tcpport=' + settings.remotePort);
        } catch (e) { console.log('Unable to parse \"serverUrl\".'); process.exit(1); }
        options.checkServerIdentity = onVerifyServer;
        c.websocket = http.request(options);
        c.websocket.tcp = c;
        c.websocket.tunneling = false;
        c.websocket.upgrade = OnWebSocket;
        c.websocket.on('error', function (msg) { console.log(msg); });
        c.websocket.end();
    } catch (e) { debug(2, e); }
}

// Disconnect both TCP & WebSocket connections and display a message.
function disconnectTunnel(tcp, ws, msg) {
    if (ws != null) { try { ws.end(); } catch (e) { debug(2, e); } }
    if (tcp != null) { try { tcp.end(); } catch (e) { debug(2, e); } }
    debug(1, 'Tunnel disconnected: ' + msg);
}

// Called when the web socket gets connected
function OnWebSocket(msg, s, head) {
    debug(1, 'Websocket connected');
    s.on('data', function (msg) {
        if (this.parent.tunneling == false) {
            msg = msg.toString();
            if (msg == 'c') {
                this.parent.tunneling = true; this.pipe(this.parent.tcp); this.parent.tcp.pipe(this); debug(1, 'Tunnel active');
            } else if ((msg.length > 6) && (msg.substring(0, 6) == 'error:')) {
                console.log(msg.substring(6));
                disconnectTunnel(this.tcp, this, msg.substring(6));
            }
        }
    });
    s.on('error', function (msg) { disconnectTunnel(this.tcp, this, 'Websocket error'); });
    s.on('close', function (msg) { disconnectTunnel(this.tcp, this, 'Websocket closed'); });
    s.parent = this;
}

// Try to discover the location of the mesh server
function discoverMeshServer() { console.log('Looking for server...'); discoveryInterval = setInterval(discoverMeshServerOnce, 5000); discoverMeshServerOnce(); }

// Try to discover the location of the mesh server only once
function discoverMeshServerOnce() {
    var interfaces = os.networkInterfaces();
    for (var adapter in interfaces) {
        if (interfaces.hasOwnProperty(adapter)) {
            for (var i = 0 ; i < interfaces[adapter].length; ++i) {
                var addr = interfaces[adapter][i];
                multicastSockets[i] = dgram.createSocket({ type: (addr.family == "IPv4" ? "udp4" : "udp6") });
                multicastSockets[i].bind({ address: addr.address, exclusive: false });
                if (addr.family == "IPv4") {
                    multicastSockets[i].addMembership(membershipIPv4);
                    //multicastSockets[i].setMulticastLoopback(true);
                    multicastSockets[i].once('message', OnMulticastMessage);
                    multicastSockets[i].send(settings.serverId, 16989, membershipIPv4);
                }
            }
        }
    }
}

// Called when a multicast packet is received
function OnMulticastMessage(msg, rinfo) {
    var m = msg.toString().split('|');
    if ((m.length == 3) && (m[0] == 'MeshCentral2') && (m[1] == settings.serverId)) {
        settings.serverUrl = m[2].replace('%s', rinfo.address).replace('/agent.ashx', '/meshrelay.ashx');
        console.log('Found server at ' + settings.serverUrl + '.');
        if (discoveryInterval != null) { clearInterval(discoveryInterval); discoveryInterval = null; }
        startRouter();
    }
}

try { run(process.argv); } catch (e) { console.log(e); }
