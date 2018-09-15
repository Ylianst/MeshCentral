/*
Copyright 2018 Intel Corporation

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

function createMeshCore(agent) {
    var obj = {};

    /*
    function borderController() {
        this.container = null;
        this.Start = function Start(user) {
            if (this.container == null) {
                if (process.platform == 'win32') {
                    this.container = require('ScriptContainer').Create({ processIsolation: 1, sessionId: user.SessionId });
                }
                else {
                    this.container = require('ScriptContainer').Create({ processIsolation: 1, sessionId: user.uid });
                }
                this.container.parent = this;
                this.container.addModule('monitor-info', getJSModule('monitor-info'));
                this.container.addModule('monitor-border', getJSModule('monitor-border'));
                this.container.addModule('promise', getJSModule('promise'));
                this.container.once('exit', function (code) { sendConsoleText('Border Process Exited with code: ' + code); this.parent.container = this.parent._container = null; });
                this.container.ExecuteString("var border = require('monitor-border'); border.Start();");
            }
        }
        this.Stop = function Stop() {
            if (this.container != null) {
                this._container = this.container;
                this._container.parent = this;
                this.container = null;

                this._container.exit();
            }
        }
    }
    */

    require('events').EventEmitter.call(obj, true).createEvent('loggedInUsers_Updated');
    obj.on('loggedInUsers_Updated', function ()
    {
        var users = []
        for(var i = 0; i < obj.loggedInUsers.length; ++i)
        {
            users.push((obj.loggedInUsers[i].Domain ? (obj.loggedInUsers[i].Domain + '\\') : '') + obj.loggedInUsers[i].Username);
        }
        sendConsoleText('LogOn Status Changed. Active Users => [' + users.join(', ') + ']');
    });
    //obj.borderManager = new borderController();
    
    // MeshAgent JavaScript Core Module. This code is sent to and running on the mesh agent.
    obj.meshCoreInfo = "MeshCore v5";
    obj.meshCoreCapabilities = 14; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
    obj.loggedInUsers = [];

    var meshServerConnectionState = 0;
    var tunnels = {};
    var lastSelfInfo = null;
    var lastNetworkInfo = null;
    var lastPublicLocationInfo = null;
    var selfInfoUpdateTimer = null;
    var http = require('http');
    var net = require('net');
    var fs = require('fs');
    var rtc = require('ILibWebRTC');
    var processManager = require('process-manager');
    var SMBiosTables = require('smbios');
    var amtMei = null, amtLms = null, amtLmsState = 0;
    var amtMeiConnected = 0, amtMeiTmpState = null;
    var wifiScannerLib = null;
    var wifiScanner = null;
    var networkMonitor = null;
    var amtscanner = null;
    var nextTunnelIndex = 1;

    /*
    var AMTScanner = require("AMTScanner");
    var scan = new AMTScanner();

    scan.on("found", function (data) {
        if (typeof data === 'string') {
            console.log(data);
        } else {
            console.log(JSON.stringify(data, null, " "));
        }
    });
    scan.scan("10.2.55.140", 1000);
    scan.scan("10.2.55.139-10.2.55.145", 1000);
    scan.scan("10.2.55.128/25", 2000);
    */

    /*
    // Try to load up the network monitor
    try {
        networkMonitor = require('NetworkMonitor');
        networkMonitor.on('change', function () { sendNetworkUpdateNagle(); });
        networkMonitor.on('add', function (addr) { sendNetworkUpdateNagle(); });
        networkMonitor.on('remove', function (addr) { sendNetworkUpdateNagle(); });
    } catch (e) { networkMonitor = null; }
    */

    // Try to load up the Intel AMT scanner
    try {
        var AMTScannerModule = require('amt-scanner');
        amtscanner = new AMTScannerModule();
        //amtscanner.on('found', function (data) { if (typeof data != 'string') { data = JSON.stringify(data, null, " "); } sendConsoleText(data); });
    } catch (e) { amtscanner = null; }
    
    // Try to load up the MEI module
    try {
        var amtMeiLib = require('amt-mei');
        amtMei = new amtMeiLib();
        amtMei.on('error', function (e) { amtMeiLib = null; amtMei = null; sendPeriodicServerUpdate(); });
        amtMeiConnected = 2;
        //amtMei.on('connect', function () { amtMeiConnected = 2; sendPeriodicServerUpdate(); });
    } catch (e) { amtMeiLib = null; amtMei = null; amtMeiConnected = -1; }
    
    // Try to load up the WIFI scanner
    try {
        var wifiScannerLib = require('wifi-scanner');
        wifiScanner = new wifiScannerLib();
        wifiScanner.on('accessPoint', function (data) { sendConsoleText(JSON.stringify(data)); });
    } catch (e) { wifiScannerLib = null; wifiScanner = null; }
    
    // If we are running in Duktape, agent will be null
    if (agent == null) {
        // Running in native agent, Import libraries
        db = require('SimpleDataStore').Shared();
        sha = require('SHA256Stream');
        mesh = require('MeshAgent');
        childProcess = require('child_process');
        if (mesh.hasKVM == 1) { obj.meshCoreCapabilities |= 1; }
    } else {
        // Running in nodejs
        obj.meshCoreInfo += '-NodeJS';
        obj.meshCoreCapabilities = 8;
        mesh = agent.getMeshApi();
    }
    
    // Get our location (lat/long) using our public IP address
    var getIpLocationDataExInProgress = false;
    var getIpLocationDataExCounts = [0, 0];
    function getIpLocationDataEx(func) {
        if (getIpLocationDataExInProgress == true) { return false; }
        try {
            getIpLocationDataExInProgress = true;
            getIpLocationDataExCounts[0]++;
            var options = http.parseUri("http://ipinfo.io/json");
            options.method = 'GET';
            http.request(options, function (resp) {
                if (resp.statusCode == 200) {
                    var geoData = '';
                    resp.data = function (geoipdata) { geoData += geoipdata; };
                    resp.end = function () {
                        var location = null;
                        try {
                            if (typeof geoData == 'string') {
                                var result = JSON.parse(geoData);
                                if (result.ip && result.loc) { location = result; }
                            }
                        } catch (e) { }
                        if (func) { getIpLocationDataExCounts[1]++; func(location); }
                    }
                } else { func(null); }
                getIpLocationDataExInProgress = false;
            }).end();
            return true;
        }
        catch (e) { return false; }
    }
    
    // Remove all Gateway MAC addresses for interface list. This is useful because the gateway MAC is not always populated reliably.
    function clearGatewayMac(str) {
        if (str == null) return null;
        var x = JSON.parse(str);
        for (var i in x.netif) { if (x.netif[i].gatewaymac) { delete x.netif[i].gatewaymac } }
        return JSON.stringify(x);
    }
    
    function getIpLocationData(func) {
        // Get the location information for the cache if possible
        var publicLocationInfo = db.Get('publicLocationInfo');
        if (publicLocationInfo != null) { publicLocationInfo = JSON.parse(publicLocationInfo); }
        if (publicLocationInfo == null) {
            // Nothing in the cache, fetch the data
            getIpLocationDataEx(function (locationData) {
                if (locationData != null) {
                    publicLocationInfo = {};
                    publicLocationInfo.netInfoStr = lastNetworkInfo;
                    publicLocationInfo.locationData = locationData;
                    var x = db.Put('publicLocationInfo', JSON.stringify(publicLocationInfo)); // Save to database
                    if (func) func(locationData); // Report the new location
                } else {
                    if (func) func(null); // Report no location
                }
            });
        } else {
            // Check the cache
            if (clearGatewayMac(publicLocationInfo.netInfoStr) == clearGatewayMac(lastNetworkInfo)) {
                // Cache match
                if (func) func(publicLocationInfo.locationData);
            } else {
                // Cache mismatch
                getIpLocationDataEx(function (locationData) {
                    if (locationData != null) {
                        publicLocationInfo = {};
                        publicLocationInfo.netInfoStr = lastNetworkInfo;
                        publicLocationInfo.locationData = locationData;
                        var x = db.Put('publicLocationInfo', JSON.stringify(publicLocationInfo)); // Save to database
                        if (func) func(locationData); // Report the new location
                    } else {
                        if (func) func(publicLocationInfo.locationData); // Can't get new location, report the old location
                    }
                });
            }
        }
    }
    
    // Polyfill String.endsWith
    if (!String.prototype.endsWith) {
        String.prototype.endsWith = function (searchString, position) {
            var subjectString = this.toString();
            if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; }
            position -= searchString.length;
            var lastIndex = subjectString.lastIndexOf(searchString, position);
            return lastIndex !== -1 && lastIndex === position;
        };
    }
    
    // Polyfill path.join
    obj.path = {
        join: function () {
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
    };
    
    // Replace a string with a number if the string is an exact number
    function toNumberIfNumber(x) { if ((typeof x == 'string') && (+parseInt(x) === x)) { x = parseInt(x); } return x; }
    
    // Convert decimal to hex
    function char2hex(i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); }
    
    // Convert a raw string to a hex string
    function rstr2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += char2hex(input.charCodeAt(i)); } return r; }
    
    // Convert a buffer into a string
    function buf2rstr(buf) { var r = ''; for (var i = 0; i < buf.length; i++) { r += String.fromCharCode(buf[i]); } return r; }
    
    // Convert a hex string to a raw string // TODO: Do this using Buffer(), will be MUCH faster
    function hex2rstr(d) {
        if (typeof d != "string" || d.length == 0) return '';
        var r = '', m = ('' + d).match(/../g), t;
        while (t = m.shift()) r += String.fromCharCode('0x' + t);
        return r
    }
    
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
    
    // Return p number of spaces 
    function addPad(p, ret) { var r = ''; for (var i = 0; i < p; i++) { r += ret; } return r; }
    
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
        var x = mesh.ServerUrl;
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
    
    // Send a wake-on-lan packet
    function sendWakeOnLan(hexMac) {
        var count = 0;
        try {
            var interfaces = require('os').networkInterfaces();
            var magic = 'FFFFFFFFFFFF';
            for (var x = 1; x <= 16; ++x) { magic += hexMac; }
            var magicbin = Buffer.from(magic, 'hex');
            
            for (var adapter in interfaces) {
                if (interfaces.hasOwnProperty(adapter)) {
                    for (var i = 0; i < interfaces[adapter].length; ++i) {
                        var addr = interfaces[adapter][i];
                        if ((addr.family == 'IPv4') && (addr.mac != '00:00:00:00:00:00')) {
                            var socket = require('dgram').createSocket({ type: "udp4" });
                            socket.bind({ address: addr.address });
                            socket.setBroadcast(true);
                            socket.send(magicbin, 7, "255.255.255.255");
                            count++;
                        }
                    }
                }
            }
        } catch (e) { }
        return count;
    }
    
    // Handle a mesh agent command
    function handleServerCommand(data) {
        if (typeof data == 'object') {
            // If this is a console command, parse it and call the console handler
            switch (data.action) {
                case 'msg': {
                    switch (data.type) {
                        case 'console': { // Process a console command
                            if (data.value && data.sessionid) {
                                var args = splitArgs(data.value);
                                processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid);
                            }
                            break;
                        }
                        case 'tunnel': {
                            if (data.value != null) { // Process a new tunnel connection request
                                // Create a new tunnel object
                                var xurl = getServerTargetUrlEx(data.value);
                                if (xurl != null) {
                                    var woptions = http.parseUri(xurl);
                                    woptions.rejectUnauthorized = 0;
                                    //sendConsoleText(JSON.stringify(woptions));
                                    var tunnel = http.request(woptions);
                                    tunnel.upgrade = onTunnelUpgrade;
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
                                    var index = nextTunnelIndex++;;
                                    tunnel.index = index;
                                    tunnels[index] = tunnel;

                                    sendConsoleText('New tunnel connection #' + index + ': ' + tunnel.url + ', rights: ' + tunnel.rights, data.sessionid);
                                }
                            }
                            break;
                        }
                        case 'ps': {
                            if (data.sessionid) {
                                processManager.getProcesses(function (plist) { mesh.SendCommand({ "action": "msg", "type": "ps", "value": JSON.stringify(plist), "sessionid": data.sessionid }); });
                            }
                            break;
                        }
                        case 'pskill': {
                            //sendConsoleText(JSON.stringify(data));
                            try { process.kill(data.value); } catch (e) { sendConsoleText(JSON.stringify(e)); }
                            break;
                        }
                    }
                    break;
                }
                case 'wakeonlan': {
                    // Send wake-on-lan on all interfaces for all MAC addresses in data.macs array. The array is a list of HEX MAC addresses.
                    sendConsoleText('Server requesting wake-on-lan for: ' + data.macs.join(', '));
                    for (var i in data.macs) { sendWakeOnLan(data.macs[i]); }
                    break;
                }
                case 'poweraction': {
                    // Server telling us to execute a power action
                    if ((mesh.ExecPowerState != undefined) && (data.actiontype)) {
                        var forced = 0;
                        if (data.forced == 1) { forced = 1; }
                        data.actiontype = parseInt(data.actiontype);
                        sendConsoleText('Performing power action=' + data.actiontype + ', forced=' + forced + '.');
                        var r = mesh.ExecPowerState(data.actiontype, forced);
                        sendConsoleText('ExecPowerState returned code: ' + r);
                    }
                    break;
                }
                case 'iplocation': {
                    // Update the IP location information of this node. Only do this when requested by the server since we have a limited amount of time we can call this per day
                    getIpLocationData(function (location) { mesh.SendCommand({ "action": "iplocation", "type": "publicip", "value": location }); });
                    break;
                }
                case 'toast': {
                    // Display a toast message
                    if (data.title && data.msg) { require('toaster').Toast(data.title, data.msg); }
                    break;
                }
            }
        }
    }
    
    // Called when a file changed in the file system
    /*
    function onFileWatcher(a, b) {
        console.log('onFileWatcher', a, b, this.path);
        var response = getDirectoryInfo(this.path);
        if ((response != undefined) && (response != null)) { this.tunnel.s.write(JSON.stringify(response)); }
    }
    */

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
            var results = null, xpath = obj.path.join(reqpath, '*');
            //if (process.platform == "win32") { xpath = xpath.split('/').join('\\'); }
            try { results = fs.readdirSync(xpath); } catch (e) { }
            if (results != null) {
                for (var i = 0; i < results.length; ++i) {
                    if ((results[i] != '.') && (results[i] != '..')) {
                        var stat = null, p = obj.path.join(reqpath, results[i]);
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
    
    // Tunnel callback operations
    function onTunnelUpgrade(response, s, head) {
        this.s = s;
        s.httprequest = this;
        s.end = onTunnelClosed;
        s.tunnel = this;
        
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
    
    // Called when the TCP relay target is connected
    function onTcpRelayTargetTunnelConnect() {
        var peerTunnel = tunnels[this.peerindex];
        this.pipe(peerTunnel.s); // Pipe Target --> Server
        peerTunnel.s.first = true;
        peerTunnel.s.resume();
    }
    
    // Called when we get data from the server for a TCP relay (We have to skip the first received 'c' and pipe the rest)
    function onTcpRelayServerTunnelData(data) {
        if (this.first == true) { this.first = false; this.pipe(this.tcprelay); } // Pipe Server --> Target
    }
    
    function onTunnelClosed() {
        if (tunnels[this.httprequest.index] == null) return; // Stop duplicate calls.
        sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
        delete tunnels[this.httprequest.index];
        
        /*
        // Close the watcher if required
        if (this.httprequest.watcher != undefined) {
            //console.log('Closing watcher: ' + this.httprequest.watcher.path);
            //this.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
            delete this.httprequest.watcher;
        }
        */

        // If there is a upload or download active on this connection, close the file
        if (this.httprequest.uploadFile) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
        if (this.httprequest.downloadFile) { fs.closeSync(this.httprequest.downloadFile); this.httprequest.downloadFile = undefined; }

        // Clean up WebRTC
        if (this.webrtc != null) {
            if (this.webrtc.rtcchannel) { try { this.webrtc.rtcchannel.close(); } catch (e) { } this.webrtc.rtcchannel.removeAllListeners('data'); this.webrtc.rtcchannel.removeAllListeners('end'); delete this.webrtc.rtcchannel; }
            if (this.webrtc.websocket) { delete this.webrtc.websocket; }
            try { this.webrtc.close(); } catch (e) { }
            this.webrtc.removeAllListeners('connected');
            this.webrtc.removeAllListeners('disconnected');
            this.webrtc.removeAllListeners('dataChannel');
            delete this.webrtc;
        }

        // Clean up WebSocket
        this.removeAllListeners('data');
    }
    function onTunnelSendOk() { sendConsoleText("Tunnel #" + this.index + " SendOK.", this.sessionid); }
    function onTunnelData(data) {
        //console.log("OnTunnelData");
        //sendConsoleText('OnTunnelData, ' + data.length + ', ' + typeof data + ', ' + data);
        
        // If this is upload data, save it to file
        if (this.httprequest.uploadFile) {
            try { fs.writeSync(this.httprequest.uploadFile, data); } catch (e) { this.write(new Buffer(JSON.stringify({ action: 'uploaderror' }))); return; } // Write to the file, if there is a problem, error out.
            this.write(new Buffer(JSON.stringify({ action: 'uploadack', reqid: this.httprequest.uploadFileid }))); // Ask for more data
            return;
        }
        /*
        // If this is a download, send more of the file
        if (this.httprequest.downloadFile) {
            var buf = new Buffer(4096);
            var len = fs.readSync(this.httprequest.downloadFile, buf, 0, 4096, null);
            this.httprequest.downloadFilePtr += len;
            if (len > 0) { this.write(buf.slice(0, len)); } else { fs.closeSync(this.httprequest.downloadFile); this.httprequest.downloadFile = undefined; this.end(); }
            return;
        }
        */

        if (this.httprequest.state == 0) {
            // Check if this is a relay connection
            if (data == 'c') { this.httprequest.state = 1; sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid); }
        } else {
            // Handle tunnel data
            if (this.httprequest.protocol == 0) { // 1 = SOL, 2 = KVM, 3 = IDER, 4 = Files, 5 = FileTransfer
                // Take a look at the protocol
                this.httprequest.protocol = parseInt(data);
                if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                if (this.httprequest.protocol == 1) {
                    // Remote terminal using native pipes
                    if (process.platform == "win32") {
                        this.httprequest.process = childProcess.execFile("%windir%\\system32\\cmd.exe");
                    } else {
                        this.httprequest.process = childProcess.execFile("/bin/sh", ["sh"], { type: childProcess.SpawnTypes.TERM });
                    }
                    this.httprequest.process.tunnel = this;
                    this.httprequest.process.on('exit', function (ecode, sig) { this.tunnel.end(); });
                    this.httprequest.process.stderr.on('data', function (chunk) { this.parent.tunnel.write(chunk); });
                    this.httprequest.process.stdout.pipe(this, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                    this.pipe(this.httprequest.process.stdin, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                    this.prependListener('end', function () { this.httprequest.process.kill(); });
                    this.removeAllListeners('data');
                    this.on('data', onTunnelControlData);
                    //this.write('MeshCore Terminal Hello');
                    if (process.platform != 'win32') { this.httprequest.process.stdin.write("stty erase ^H\nalias ls='ls --color=auto'\nclear\n"); }
                } else if (this.httprequest.protocol == 2)
                {
                    // Remote desktop using native pipes
                    this.httprequest.desktop = { state: 0, kvm: mesh.getRemoteDesktopStream(), tunnel: this };
                    this.httprequest.desktop.kvm.parent = this.httprequest.desktop;
                    this.desktop = this.httprequest.desktop;

                    // Display a toast message
                    //require('toaster').Toast('MeshCentral', 'Remote Desktop Control Started.');

                    this.end = function () {
                        --this.desktop.kvm.connectionCount;
                        this.unpipe(this.httprequest.desktop.kvm);
                        this.httprequest.desktop.kvm.unpipe(this);
                        if (this.desktop.kvm.connectionCount == 0) {
                            // Display a toast message
                            //require('toaster').Toast('MeshCentral', 'Remote Desktop Control Ended.');
                            this.httprequest.desktop.kvm.end();
                        }
                    };
                    if (this.httprequest.desktop.kvm.hasOwnProperty("connectionCount")) { this.httprequest.desktop.kvm.connectionCount++; } else { this.httprequest.desktop.kvm.connectionCount = 1; }
                    this.pipe(this.httprequest.desktop.kvm, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                    this.httprequest.desktop.kvm.pipe(this, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                    this.removeAllListeners('data');
                    this.on('data', onTunnelControlData);
                    //this.write('MeshCore KVM Hello!1');
                } else if (this.httprequest.protocol == 5) {
                    // Setup files
                    // NOP
                }
            } else if (this.httprequest.protocol == 1) {
                // Send data into terminal stdin
                //this.write(data); // Echo back the keys (Does not seem to be a good idea)
                this.httprequest.process.write(data);
            } else if (this.httprequest.protocol == 2) {
                // Send data into remote desktop
                if (this.httprequest.desktop.state == 0) {
                    this.write(new Buffer(String.fromCharCode(0x11, 0xFE, 0x00, 0x00, 0x4D, 0x45, 0x53, 0x48, 0x00, 0x00, 0x00, 0x00, 0x02)));
                    this.httprequest.desktop.state = 1;
                } else {
                    this.httprequest.desktop.write(data);
                }
            } else if (this.httprequest.protocol == 5) {
                // Process files commands
                var cmd = null;
                try { cmd = JSON.parse(data); } catch (e) { };
                if (cmd == null) { return; }
                if ((cmd.ctrlChannel == '102938') || ((cmd.type == 'offer') && (cmd.sdp != null))) { onTunnelControlData(cmd, this); return; } // If this is control data, handle it now.
                if (cmd.action == undefined) { return; }
                //sendConsoleText('CMD: ' + JSON.stringify(cmd));

                if ((cmd.path != null) && (process.platform != 'win32') && (cmd.path[0] != '/')) { cmd.path = '/' + cmd.path; } // Add '/' to paths on non-windows
                //console.log(objToString(cmd, 0, ' '));
                switch (cmd.action) {
                    case 'ls': {
                        /*
                        // Close the watcher if required
                        var samepath = ((this.httprequest.watcher != undefined) && (cmd.path == this.httprequest.watcher.path));
                        if ((this.httprequest.watcher != undefined) && (samepath == false)) {
                            //console.log('Closing watcher: ' + this.httprequest.watcher.path);
                            //this.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
                            delete this.httprequest.watcher;
                        }
                        */

                        // Send the folder content to the browser
                        var response = getDirectoryInfo(cmd.path);
                        if (cmd.reqid != undefined) { response.reqid = cmd.reqid; }
                        this.write(new Buffer(JSON.stringify(response)));
                        
                        /*
                        // Start the directory watcher
                        if ((cmd.path != '') && (samepath == false)) {
                            var watcher = fs.watch(cmd.path, onFileWatcher);
                            watcher.tunnel = this.httprequest;
                            watcher.path = cmd.path;
                            this.httprequest.watcher = watcher;
                            //console.log('Starting watcher: ' + this.httprequest.watcher.path);
                        }
                        */
                        break;
                    }
                    case 'mkdir': {
                        // Create a new empty folder
                        fs.mkdirSync(cmd.path);
                        break;
                    }
                    case 'rm': {
                        // Remove many files or folders
                        for (var i in cmd.delfiles) {
                            var fullpath = obj.path.join(cmd.path, cmd.delfiles[i]);
                            try { fs.unlinkSync(fullpath); } catch (e) { console.log(e); }
                        }
                        break;
                    }
                    case 'rename': {
                        // Rename a file or folder
                        var oldfullpath = obj.path.join(cmd.path, cmd.oldname);
                        var newfullpath = obj.path.join(cmd.path, cmd.newname);
                        try { fs.renameSync(oldfullpath, newfullpath); } catch (e) { console.log(e); }
                        break;
                    }
                    case 'download': {
                        // Download a file
                        var sendNextBlock = 0;
                        if (cmd.sub == 'start') { // Setup the download
                            if (this.filedownload != null) { this.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                            this.filedownload = { id: cmd.id, path: cmd.path, ptr: 0 }
                            try { this.filedownload.f = fs.openSync(this.filedownload.path, 'rbN'); } catch (e) { this.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                            if (this.filedownload) { this.write({ action: 'download', sub: 'start', id: cmd.id }); }
                        } else if ((this.filedownload != null) && (cmd.id == this.filedownload.id)) { // Download commands
                            if (cmd.sub == 'startack') { sendNextBlock = 8; } else if (cmd.sub == 'stop') { delete this.filedownload; } else if (cmd.sub == 'ack') { sendNextBlock = 1; }
                        }
                        // Send the next download block(s)
                        while (sendNextBlock > 0) {
                            sendNextBlock--;
                            var buf = new Buffer(4096);
                            var len = fs.readSync(this.filedownload.f, buf, 4, 4092, null);
                            this.filedownload.ptr += len;
                            if (len < 4092) { buf.writeInt32BE(0x01000001, 0); fs.closeSync(this.filedownload.f); delete this.filedownload; sendNextBlock = 0; } else { buf.writeInt32BE(0x01000000, 0); }
                            this.write(buf.slice(0, len + 4)); // Write as binary
                        }
                        break;
                    }
                    /*
                    case 'download': {
                        // Packet download of a file, agent to browser
                        if (cmd.path == undefined) break;
                        var filepath = cmd.name ? obj.path.join(cmd.path, cmd.name) : cmd.path;
                        //console.log('Download: ' + filepath);
                        try { this.httprequest.downloadFile = fs.openSync(filepath, 'rbN'); } catch (e) { this.write(new Buffer(JSON.stringify({ action: 'downloaderror', reqid: cmd.reqid }))); break; }
                        this.httprequest.downloadFileId = cmd.reqid;
                        this.httprequest.downloadFilePtr = 0;
                        if (this.httprequest.downloadFile) { this.write(new Buffer(JSON.stringify({ action: 'downloadstart', reqid: this.httprequest.downloadFileId }))); }
                        break;
                    }
                    case 'download2': {
                        // Stream download of a file, agent to browser
                        if (cmd.path == undefined) break;
                        var filepath = cmd.name ? obj.path.join(cmd.path, cmd.name) : cmd.path;
                        try { this.httprequest.downloadFile = fs.createReadStream(filepath, { flags: 'rbN' }); } catch (e) { console.log(e); }
                        this.httprequest.downloadFile.pipe(this);
                        this.httprequest.downloadFile.end = function () { }
                        break;
                    }
                    */
                    case 'upload': {
                        // Upload a file, browser to agent
                        if (this.httprequest.uploadFile != undefined) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
                        if (cmd.path == undefined) break;
                        var filepath = cmd.name ? obj.path.join(cmd.path, cmd.name) : cmd.path;
                        try { this.httprequest.uploadFile = fs.openSync(filepath, 'wbN'); } catch (e) { this.write(new Buffer(JSON.stringify({ action: 'uploaderror', reqid: cmd.reqid }))); break; }
                        this.httprequest.uploadFileid = cmd.reqid;
                        if (this.httprequest.uploadFile) { this.write(new Buffer(JSON.stringify({ action: 'uploadstart', reqid: this.httprequest.uploadFileid }))); }
                        break;
                    }
                    case 'copy': {
                        // Copy a bunch of files from scpath to dspath
                        for (var i in cmd.names) {
                            var sc = obj.path.join(cmd.scpath, cmd.names[i]), ds = obj.path.join(cmd.dspath, cmd.names[i]);
                            if (sc != ds) { try { fs.copyFileSync(sc, ds); } catch (e) { } }
                        }
                        break;
                    }
                    case 'move': {
                        // Move a bunch of files from scpath to dspath
                        for (var i in cmd.names) {
                            var sc = obj.path.join(cmd.scpath, cmd.names[i]), ds = obj.path.join(cmd.dspath, cmd.names[i]);
                            if (sc != ds) { try { fs.copyFileSync(sc, ds); fs.unlinkSync(sc); } catch (e) { } }
                        }
                        break;
                    }
                }
            }
            //sendConsoleText("Got tunnel #" + this.httprequest.index + " data: " + data, this.httprequest.sessionid);
        }
    }

    // Called when receiving control data on WebRTC
    function onTunnelWebRTCControlData(data) {
        if (typeof data != 'string') return;
        var obj;
        try { obj = JSON.parse(data); } catch (e) { sendConsoleText('Invalid control JSON on WebRTC: ' + data); return; }
        if (obj.type == 'close') {
            //sendConsoleText('Tunnel #' + this.xrtc.websocket.tunnel.index + ' WebRTC control close');
            try { this.close(); } catch (e) { }
            try { this.xrtc.close(); } catch (e) { }
        }
    }

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
                            var child = require('child_process');
                            child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 });
                        }
                    } catch (e) { }
                    break;
                }
            }
            return;
        }

        if (obj.type == 'close') {
            // We received the close on the websocket
            //sendConsoleText('Tunnel #' + ws.tunnel.index + ' WebSocket control close');
            try { ws.close(); } catch (e) { }
        } else if (obj.type == 'webrtc0') { // Browser indicates we can start WebRTC switch-over.
            if (ws.httprequest.protocol == 1) { // Terminal
                // This is a terminal data stream, unpipe the terminal now and indicate to the other side that terminal data will no longer be received over WebSocket
                ws.httprequest.process.stdout.unpipe(ws);
                ws.httprequest.process.stderr.unpipe(ws);
            } else if (ws.httprequest.protocol == 2) { // Desktop
                // This is a KVM data stream, unpipe the KVM now and indicate to the other side that KVM data will no longer be received over WebSocket
                ws.httprequest.desktop.kvm.unpipe(ws);
            } else {
                // Switch things around so all WebRTC data goes to onTunnelData().
                ws.rtcchannel.httprequest = ws.httprequest;
                ws.rtcchannel.removeAllListeners('data');
                ws.rtcchannel.on('data', onTunnelData);
            }
            ws.write("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc1\"}"); // End of data marker
        } else if (obj.type == 'webrtc1') {
            if (ws.httprequest.protocol == 1) { // Terminal
                // Switch the user input from websocket to webrtc at this point.
                ws.unpipe(ws.httprequest.process.stdin);
                ws.rtcchannel.pipe(ws.httprequest.process.stdin, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                ws.resume(); // Resume the websocket to keep receiving control data
            } else if (ws.httprequest.protocol == 2) { // Desktop
                // Switch the user input from websocket to webrtc at this point.
                ws.unpipe(ws.httprequest.desktop.kvm);
                try { ws.webrtc.rtcchannel.pipe(ws.httprequest.desktop.kvm, { dataTypeSkip: 1, end: false }); } catch (e) { sendConsoleText('EX2'); } // 0 = Binary, 1 = Text.
                ws.resume(); // Resume the websocket to keep receiving control data
            }
            ws.write("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc2\"}"); // Indicates we will no longer get any data on websocket, switching to WebRTC at this point.
        } else if (obj.type == 'webrtc2') {
            // Other side received websocket end of data marker, start sending data on WebRTC channel
            if (ws.httprequest.protocol == 1) { // Terminal
                ws.httprequest.process.stdout.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                ws.httprequest.process.stderr.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
            } else if (ws.httprequest.protocol == 2) { // Desktop
                ws.httprequest.desktop.kvm.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
            }
        } else if (obj.type == 'offer') {
            // This is a WebRTC offer.
            ws.webrtc = rtc.createConnection();
            ws.webrtc.websocket = ws;
            ws.webrtc.on('connected', function () { /*sendConsoleText('Tunnel #' + this.websocket.tunnel.index + ' WebRTC connected');*/ });
            ws.webrtc.on('disconnected', function () { /*sendConsoleText('Tunnel #' + this.websocket.tunnel.index + ' WebRTC disconnected');*/ });
            ws.webrtc.on('dataChannel', function (rtcchannel) {
                //sendConsoleText('WebRTC Datachannel open, protocol: ' + this.websocket.httprequest.protocol);
                rtcchannel.xrtc = this;
                rtcchannel.websocket = this.websocket;
                this.rtcchannel = rtcchannel;
                this.websocket.rtcchannel = rtcchannel;
                this.websocket.rtcchannel.on('data', onTunnelWebRTCControlData);
                this.websocket.rtcchannel.on('end', function () { /*sendConsoleText('Tunnel #' + this.websocket.tunnel.index + ' WebRTC data channel closed');*/ });
                this.websocket.write("{\"ctrlChannel\":\"102938\",\"type\":\"webrtc0\"}"); // Indicate we are ready for WebRTC switch-over.
            });
            var sdp = null;
            try { sdp = ws.webrtc.setOffer(obj.sdp); } catch (ex) { }
            if (sdp != null) { ws.write({ type: 'answer', ctrlChannel: '102938', sdp: sdp }); }
        }
    }

    // Console state
    var consoleWebSockets = {};
    var consoleHttpRequest = null;
    
    // Console HTTP response
    function consoleHttpResponse(response) {
        response.data = function (data) { sendConsoleText(rstr2hex(buf2rstr(data)), this.sessionid); consoleHttpRequest = null; }
        response.close = function () { sendConsoleText('httprequest.response.close', this.sessionid); consoleHttpRequest = null; }
    };

    // Process a mesh agent console command
    function processConsoleCommand(cmd, args, rights, sessionid) {
        try {
            var response = null;
            switch (cmd) {
                case 'help': { // Displays available commands
                    response = 'Available commands: help, info, args, print, type, dbget, dbset, dbcompact, eval, parseuri, httpget,\r\nwslist, wsconnect, wssend, wsclose, notify, ls, ps, kill, amt, netinfo, location, power, wakeonlan, scanwifi,\r\nscanamt, setdebug, smbios, rawsmbios, toast, lock, users, border.';
                    break;
                }
                    /*
                case 'border':
                    {
                        if ((args['_'].length == 1) && (args['_'][0] == 'on')) {
                            if (obj.loggedInUsers.length > 0) {
                                obj.borderManager.Start(obj.loggedInUsers[0]);
                                response = 'Border blinking is on.';
                            } else {
                                response = 'Cannot turn on border blinking, no logged in users.';
                            }
                        } else if ((args['_'].length == 1) && (args['_'][0] == 'off')) {
                            obj.borderManager.Stop();
                            response = 'Border blinking is off.';
                        } else {
                            response = 'Proper usage: border "on|off"'; // Display correct command usage
                        }
                    }
                    break;
                    */
                case 'users':
                    {
                        var retList = [];
                        for(var i = 0; i < obj.loggedInUsers.length; ++i)
                        {
                            retList.push((obj.loggedInUsers[i].Domain ? (obj.loggedInUsers[i].Domain + '\\') : '') + obj.loggedInUsers[i].Username);
                        }
                        response = 'Active Users => [' + retList.join(', ') + ']';
                    }
                    break;
                case 'toast': {
                    if (process.platform == 'win32') {
                        if (args['_'].length < 1) { response = 'Proper usage: toast "message"'; } else {
                            require('toaster').Toast('MeshCentral', args['_'][0]);
                            response = 'ok';
                        }
                    } else {
                        response = 'Only supported on Windows.';
                    }
                    break;
                }
                case 'setdebug': {
                    if (args['_'].length < 1) { response = 'Proper usage: setdebug (target), 0 = Disabled, 1 = StdOut, 2 = This Console, * = All Consoles, 4 = WebLog, 8 = Logfile'; } // Display usage
                    else { if (args['_'][0] == '*') { console.setDestination(2); } else { console.setDestination(parseInt(args['_'][0]), sessionid); } }
                    break;
                }
                case 'ps': {
                    processManager.getProcesses(function (plist) {
                        var x = '';
                        for (var i in plist) { x += i + ', ' + plist[i].cmd + ((plist[i].user) ? (', ' + plist[i].user):'') + '\r\n'; }
                        sendConsoleText(x, sessionid);
                    });
                    break;
                }
                case 'kill': {
                    if ((args['_'].length < 1)) {
                        response = 'Proper usage: kill [pid]'; // Display correct command usage
                    } else {
                        process.kill(parseInt(args['_'][0]));
                        response = 'Killed process ' + args['_'][0] + '.';
                    }
                    break;
                }
                case 'smbios': {
                    if (SMBiosTables != null) {
                        SMBiosTables.get(function (data) {
                            if (data == null) { sendConsoleText('Unable to get SM BIOS data.', sessionid); return; }
                            sendConsoleText(objToString(SMBiosTables.parse(data), 0, ' ', true), sessionid);
                        });
                    } else { response = 'SM BIOS module not available.'; }
                    break;
                }
                case 'rawsmbios': {
                    if (SMBiosTables != null) {
                        SMBiosTables.get(function (data) {
                            if (data == null) { sendConsoleText('Unable to get SM BIOS data.', sessionid); return; }
                            var out = '';
                            for (var i in data) {
                                var header = false;
                                for (var j in data[i]) {
                                    if (data[i][j].length > 0) {
                                        if (header == false) { out += ('Table type #' + i + ((SMBiosTables.smTableTypes[i] == null) ? '' : (', ' + SMBiosTables.smTableTypes[i]))) + '\r\n'; header = true; }
                                        out += ('  ' + data[i][j].toString('hex')) + '\r\n';
                                    }
                                }
                            }
                            sendConsoleText(out, sessionid);
                        });
                    } else { response = 'SM BIOS module not available.'; }
                    break;
                }
                case 'eval': { // Eval JavaScript
                    if (args['_'].length < 1) {
                        response = 'Proper usage: eval "JavaScript code"'; // Display correct command usage
                    } else {
                        response = JSON.stringify(mesh.eval(args['_'][0]));
                    }
                    break;
                }
                case 'notify': { // Send a notification message to the mesh
                    if (args['_'].length != 1) {
                        response = 'Proper usage: notify "message" [--session]'; // Display correct command usage
                    } else {
                        var notification = { "action": "msg", "type": "notify", "value": args['_'][0], "tag": "console" };
                        if (args.session) { notification.sessionid = sessionid; } // If "--session" is specified, notify only this session, if not, the server will notify the mesh
                        mesh.SendCommand(notification); // no sessionid or userid specified, notification will go to the entire mesh
                        response = 'ok';
                    }
                    break;
                }
                case 'info': { // Return information about the agent and agent core module
                    response = 'Current Core: ' + obj.meshCoreInfo + '.\r\nAgent Time: ' + Date() + '.\r\nUser Rights: 0x' + rights.toString(16) + '.\r\nPlatform Info: ' + process.platform + '.\r\nCapabilities: ' + obj.meshCoreCapabilities + '.\r\nServer URL: ' + mesh.ServerUrl + '.';
                    if (amtLmsState >= 0) { response += '\r\nBuilt-in LMS: ' + ['Disabled', 'Connecting..', 'Connected'][amtLmsState] + '.'; }
                    response += '\r\nModules: ' + addedModules.join(', ');
                    response += '\r\nServerConnected: ' + mesh.isControlChannelConnected;
                    var oldNodeId = db.Get('OldNodeId');
                    if (oldNodeId != null) { response += '\r\nOldNodeID: ' + oldNodeId + '.'; }
                    response += '\r\ServerState: ' + meshServerConnectionState + '.';
                    break;
                }
                case 'selfinfo': { // Return self information block
                    buildSelfInfo(function (info) { sendConsoleText(objToString(info, 0, ' ', true), sessionid); });
                    break;
                }
                case 'args': { // Displays parsed command arguments
                    response = 'args ' + objToString(args, 0, ' ', true);
                    break;
                }
                case 'print': { // Print a message on the mesh agent console, does nothing when running in the background
                    var r = [];
                    for (var i in args['_']) { r.push(args['_'][i]); }
                    console.log(r.join(' '));
                    response = 'Message printed on agent console.';
                    break;
                }
                case 'type': { // Returns the content of a file
                    if (args['_'].length == 0) {
                        response = 'Proper usage: type (filepath) [maxlength]'; // Display correct command usage
                    } else {
                        var max = 4096;
                        if ((args['_'].length > 1) && (typeof args['_'][1] == 'number')) { max = args['_'][1]; }
                        if (max > 4096) max = 4096;
                        var buf = new Buffer(max), fd = fs.openSync(args['_'][0], "r"), r = fs.readSync(fd, buf, 0, max); // Read the file content
                        response = buf.toString();
                        var i = response.indexOf('\n');
                        if ((i > 0) && (response[i - 1] != '\r')) { response = response.split('\n').join('\r\n'); }
                        if (r == max) response += '...';
                        fs.closeSync(fd);
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
                case 'httpget': {
                    if (consoleHttpRequest != null) {
                        response = 'HTTP operation already in progress.';
                    } else {
                        if (args['_'].length != 1) {
                            response = 'Proper usage: httpget (url)';
                        } else {
                            var options = http.parseUri(args['_'][0]);
                            options.method = 'GET';
                            if (options == null) {
                                response = 'Invalid url.';
                            } else {
                                try { consoleHttpRequest = http.request(options, consoleHttpResponse); } catch (e) { response = 'Invalid HTTP GET request'; }
                                consoleHttpRequest.sessionid = sessionid;
                                if (consoleHttpRequest != null) {
                                    consoleHttpRequest.end();
                                    response = 'HTTPGET ' + options.protocol + '//' + options.host + ':' + options.port + options.path;
                                }
                            }
                        }
                    }
                    break;
                }
                case 'wslist': { // List all web sockets
                    response = '';
                    for (var i in consoleWebSockets) {
                        var httprequest = consoleWebSockets[i];
                        response += 'Websocket #' + i + ', ' + httprequest.url + '\r\n';
                    }
                    if (response == '') { response = 'no websocket sessions.'; }
                    break;
                }
                case 'wsconnect': { // Setup a web socket
                    if (args['_'].length == 0) {
                        response = 'Proper usage: wsconnect (url)\r\nFor example: wsconnect wss://localhost:443/meshrelay.ashx?id=abc'; // Display correct command usage
                    } else {
                        var httprequest = null;
                        try {
                            var options = http.parseUri(args['_'][0]);
                            options.rejectUnauthorized = 0;
                            httprequest = http.request(options);
                        } catch (e) { response = 'Invalid HTTP websocket request'; }
                        if (httprequest != null) {
                            httprequest.upgrade = onWebSocketUpgrade;
                            httprequest.onerror = function (e) { sendConsoleText('ERROR: ' + JSON.stringify(e)); }
                            
                            var index = 1;
                            while (consoleWebSockets[index]) { index++; }
                            httprequest.sessionid = sessionid;
                            httprequest.index = index;
                            httprequest.url = args['_'][0];
                            consoleWebSockets[index] = httprequest;
                            response = 'New websocket session #' + index;
                        }
                    }
                    break;
                }
                case 'wssend': { // Send data on a web socket
                    if (args['_'].length == 0) {
                        response = 'Proper usage: wssend (socketnumber)\r\n'; // Display correct command usage
                        for (var i in consoleWebSockets) {
                            var httprequest = consoleWebSockets[i];
                            response += 'Websocket #' + i + ', ' + httprequest.url + '\r\n';
                        }
                    } else {
                        var i = parseInt(args['_'][0]);
                        var httprequest = consoleWebSockets[i];
                        if (httprequest != undefined) {
                            httprequest.s.write(args['_'][1]);
                            response = 'ok';
                        } else {
                            response = 'Invalid web socket number';
                        }
                    }
                    break;
                }
                case 'wsclose': { // Close a websocket
                    if (args['_'].length == 0) {
                        response = 'Proper usage: wsclose (socketnumber)'; // Display correct command usage
                    } else {
                        var i = parseInt(args['_'][0]);
                        var httprequest = consoleWebSockets[i];
                        if (httprequest != undefined) {
                            if (httprequest.s != null) { httprequest.s.end(); } else { httprequest.end(); }
                            response = 'ok';
                        } else {
                            response = 'Invalid web socket number';
                        }
                    }
                    break;
                }
                case 'tunnels': { // Show the list of current tunnels
                    response = '';
                    for (var i in tunnels) { response += 'Tunnel #' + i + ', ' + tunnels[i].url + '\r\n'; }
                    if (response == '') { response = 'No websocket sessions.'; }
                    break;
                }
                case 'ls': { // Show list of files and folders
                    response = '';
                    var xpath = '*';
                    if (args['_'].length > 0) { xpath = obj.path.join(args['_'][0], '*'); }
                    response = 'List of ' + xpath + '\r\n';
                    var results = fs.readdirSync(xpath);
                    for (var i = 0; i < results.length; ++i) {
                        var stat = null, p = obj.path.join(args['_'][0], results[i]);
                        try { stat = fs.statSync(p); } catch (e) { }
                        if ((stat == null) || (stat == undefined)) {
                            response += (results[i] + "\r\n");
                        } else {
                            response += (results[i] + " " + ((stat.isDirectory()) ? "(Folder)" : "(File)") + "\r\n");
                        }
                    }
                    break;
                }
                case 'lsx': { // Show list of files and folders
                    response = objToString(getDirectoryInfo(args['_'][0]), 0, ' ', true);
                    break;
                }
                case 'lock': { // Lock the current user out of the desktop
                    if (process.platform == 'win32') { var child = require('child_process'); child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 }); response = 'Ok'; }
                    else { response = 'Not supported on the platform'; }
                    break;
                }
                case 'amt': { // Show Intel AMT status
                    getAmtInfo(function (state) {
                        var resp = 'Intel AMT not detected.';
                        if (state != null) { resp = objToString(state, 0, ' ', true); }
                        sendConsoleText(resp, sessionid);
                    });
                    break;
                }
                case 'netinfo': { // Show network interface information
                    //response = objToString(mesh.NetInfo, 0, ' ');
                    var interfaces = require('os').networkInterfaces();
                    response = objToString(interfaces, 0, ' ', true);
                    break;
                }
                case 'netinfo2': { // Show network interface information
                    response = objToString(mesh.NetInfo, 0, ' ', true);
                    break;
                }
                case 'wakeonlan': { // Send wake-on-lan
                    if ((args['_'].length != 1) || (args['_'][0].length != 12)) {
                        response = 'Proper usage: wakeonlan [mac], for example "wakeonlan 010203040506".';
                    } else {
                        var count = sendWakeOnLan(args['_'][0]);
                        response = 'Sent wake-on-lan on ' + count + ' interface(s).';
                    }
                    break;
                }
                case 'sendall': { // Send a message to all consoles on this mesh
                    sendConsoleText(args['_'].join(' '));
                    break;
                }
                case 'power': { // Execute a power action on this computer
                    if (mesh.ExecPowerState == undefined) {
                        response = 'Power command not supported on this agent.';
                    } else {
                        if ((args['_'].length == 0) || (typeof args['_'][0] != 'number')) {
                            response = 'Proper usage: power (actionNumber), where actionNumber is:\r\n  LOGOFF = 1\r\n  SHUTDOWN = 2\r\n  REBOOT = 3\r\n  SLEEP = 4\r\n  HIBERNATE = 5\r\n  DISPLAYON = 6\r\n  KEEPAWAKE = 7\r\n  BEEP = 8\r\n  CTRLALTDEL = 9\r\n  VIBRATE = 13\r\n  FLASH = 14'; // Display correct command usage
                        } else {
                            var r = mesh.ExecPowerState(args['_'][0], args['_'][1]);
                            response = 'Power action executed with return code: ' + r + '.';
                        }
                    }
                    break;
                }
                case 'location': {
                    getIpLocationData(function (location) {
                        sendConsoleText(objToString({ "action": "iplocation", "type": "publicip", "value": location }, 0, ' '));
                    });
                    break;
                }
                case 'parseuri': {
                    response = JSON.stringify(http.parseUri(args['_'][0]));
                    break;
                }
                case 'scanwifi': {
                    if (wifiScanner != null) {
                        var wifiPresent = wifiScanner.hasWireless;
                        if (wifiPresent) { response = "Perfoming Wifi scan..."; wifiScanner.Scan(); } else { response = "Wifi absent."; }
                    } else { response = "Wifi module not present."; }
                    break;
                }
                case 'scanamt': {
                    if (amtscanner != null) {
                        if (args['_'].length != 1) {
                            response = 'Usage examples:\r\n  scanamt 1.2.3.4\r\n  scanamt 1.2.3.0-1.2.3.255\r\n  scanamt 1.2.3.0/24\r\n'; // Display correct command usage
                        } else {
                            response = 'Scanning: ' + args['_'][0] + '...';
                            amtscanner.scan(args['_'][0], 2000, function (data) {
                                if (data.length > 0) {
                                    var r = '', pstates = ['NotActivated', 'InActivation', 'Activated'];
                                    for (var i in data) {
                                        var x = data[i];
                                        if (r != '') { r += '\r\n'; }
                                        r += x.address + ' - Intel AMT v' + x.majorVersion + '.' + x.minorVersion;
                                        if (x.provisioningState < 3) { r += (', ' + pstates[x.provisioningState]); }
                                        if (x.provisioningState == 2) { r += (', ' + x.openPorts.join(', ')); }
                                        r += '.';
                                    }
                                } else {
                                    r = 'No Intel AMT found.';
                                }
                                sendConsoleText(r);
                            });
                        }
                    } else { response = "Intel AMT scanner module not present."; }
                    break;
                }
                case 'modules': {
                    response = JSON.stringify(addedModules);
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
    
    // Send a mesh agent console command
    function sendConsoleText(text, sessionid) {
        if (typeof text == 'object') { text = JSON.stringify(text); }
        mesh.SendCommand({ "action": "msg", "type": "console", "value": text, "sessionid": sessionid });
    }
    
    // Called before the process exits
    //process.exit = function (code) { console.log("Exit with code: " + code.toString()); }
    
    // Called when the server connection state changes
    function handleServerConnection(state) {
        meshServerConnectionState = state;
        if (meshServerConnectionState == 0) {
            // Server disconnected
            if (selfInfoUpdateTimer != null) { clearInterval(selfInfoUpdateTimer); selfInfoUpdateTimer = null; }
            lastSelfInfo = null;
        } else {
            // Server connected, send mesh core information
            var oldNodeId = db.Get('OldNodeId');
            if (oldNodeId != null) { mesh.SendCommand({ action: 'mc1migration', oldnodeid: oldNodeId }); }
            sendPeriodicServerUpdate(true);
            //if (selfInfoUpdateTimer == null) { selfInfoUpdateTimer = setInterval(sendPeriodicServerUpdate, 60000); } // Should be a long time, like 20 minutes. For now, 1 minute.
        }
    }
    
    // Build a bunch a self information data that will be sent to the server
    // We need to do this periodically and if anything changes, send the update to the server.
    function buildSelfInfo(func) {
        getAmtInfo(function (meinfo) {
            var r = { "action": "coreinfo", "value": obj.meshCoreInfo, "caps": obj.meshCoreCapabilities };
            if (meinfo != null) {
                var intelamt = {}, p = false;
                if (meinfo.Versions && meinfo.Versions.AMT) { intelamt.ver = meinfo.Versions.AMT; p = true; }
                if (meinfo.ProvisioningState) { intelamt.state = meinfo.ProvisioningState; p = true; }
                if (meinfo.Flags) { intelamt.flags = meinfo.Flags; p = true; }
                if (meinfo.OsHostname) { intelamt.host = meinfo.OsHostname; p = true; }
                if (meinfo.UUID) { intelamt.uuid = meinfo.UUID; p = true; }
                if (p == true) { r.intelamt = intelamt }
            }
            func(r);
        });
    }
    
    // Update the server with the latest network interface information
    var sendNetworkUpdateNagleTimer = null;
    function sendNetworkUpdateNagle() { if (sendNetworkUpdateNagleTimer != null) { clearTimeout(sendNetworkUpdateNagleTimer); sendNetworkUpdateNagleTimer = null; } sendNetworkUpdateNagleTimer = setTimeout(sendNetworkUpdate, 5000); }
    function sendNetworkUpdate(force) {
        sendNetworkUpdateNagleTimer = null;
        
        // Update the network interfaces information data
        var netInfo = mesh.NetInfo;
        netInfo.action = 'netinfo';
        var netInfoStr = JSON.stringify(netInfo);
        if ((force == true) || (clearGatewayMac(netInfoStr) != clearGatewayMac(lastNetworkInfo))) { mesh.SendCommand(netInfo); lastNetworkInfo = netInfoStr; }
    }
    
    // Called periodically to check if we need to send updates to the server
    function sendPeriodicServerUpdate(force) {
        if ((amtMeiConnected != 1) || (force == true)) { // If we are pending MEI connection, hold off on updating the server on self-info
            // Update the self information data
            buildSelfInfo(function (selfInfo) {
                selfInfoStr = JSON.stringify(selfInfo);
                if ((force == true) || (selfInfoStr != lastSelfInfo)) { mesh.SendCommand(selfInfo); lastSelfInfo = selfInfoStr; }
            });
        }
        
        // Update network information
        sendNetworkUpdateNagle(force);
    }
    
    // Get Intel AMT information using MEI
    function getAmtInfo(func) {
        if (amtMei == null || amtMeiConnected != 2) { if (func != null) { func(null); } return; }
        try {
            amtMeiTmpState = { Flags: 0 }; // Flags: 1=EHBC, 2=CCM, 4=ACM
            amtMei.getProtocolVersion(function (result) { if (result != null) { amtMeiTmpState.MeiVersion = result; } });
            amtMei.getVersion(function (val) { amtMeiTmpState.Versions = {}; for (var version in val.Versions) { amtMeiTmpState.Versions[val.Versions[version].Description] = val.Versions[version].Version; } });
            amtMei.getProvisioningMode(function (result) { amtMeiTmpState.ProvisioningMode = result.mode; });
            amtMei.getProvisioningState(function (result) { amtMeiTmpState.ProvisioningState = result.state; });
            amtMei.getEHBCState(function (result) { if ((result != null) && (result.EHBC == true)) { amtMeiTmpState.Flags += 1; } });
            amtMei.getControlMode(function (result) { if (result != null) { if (result.controlMode == 1) { amtMeiTmpState.Flags += 2; } if (result.controlMode == 2) { amtMeiTmpState.Flags += 4; } } });
            amtMei.getUuid(function (result) { if ((result != null) && (result.uuid != null)) { amtMeiTmpState.UUID = result.uuid; } });
            //amtMei.getMACAddresses(function (result) { amtMeiTmpState.mac = result; });
            amtMei.getDnsSuffix(function (result) { if (result != null) { amtMeiTmpState.dns = result; } if (func != null) { func(amtMeiTmpState); } });
        } catch (e) { if (func != null) { func(null); } return; }
    }
    
    // Called on MicroLMS Intel AMT user notification
    function handleAmtNotification(notifyMsg) {
        if ((notifyMsg == null) || (notifyMsg.Body == null) || (notifyMsg.Body.MessageID == null) || (notifyMsg.Body.MessageArguments == null)) return null;
        var amtMessage = notifyMsg.Body.MessageID, amtMessageArg = notifyMsg.Body.MessageArguments[0], notify = null;

        switch (amtMessage) {
            case 'iAMT0050': { if (amtMessageArg == '48') { notify = 'Intel&reg; AMT Serial-over-LAN connected'; } else if (amtMessageArg == '49') { notify = 'Intel&reg; AMT Serial-over-LAN disconnected'; } break; } // SOL
            case 'iAMT0052': { if (amtMessageArg == '1') { notify = 'Intel&reg; AMT KVM connected'; } else if (amtMessageArg == '2') { notify = 'Intel&reg; AMT KVM disconnected'; } break; } // KVM
        }

        // Send to the entire mesh, no sessionid or userid specified.
        if (notify != null) { mesh.SendCommand({ "action": "msg", "type": "notify", "value": notify, "tag": "general" });  }
    }
    
    // Starting function
    obj.start = function () {
        // Setup the mesh agent event handlers
        mesh.AddCommandHandler(handleServerCommand);
        mesh.AddConnectHandler(handleServerConnection);

        // Parse input arguments
        //var args = parseArgs(process.argv);
        //console.log(args);
        
        // Launch LMS
        try {
            var lme_heci = require('amt-lme');
            amtLmsState = 1;
            amtLms = new lme_heci();
            amtLms.on('error', function (e) { amtLmsState = 0; amtLms = null; obj.setupMeiOsAdmin(null, 1); });
            amtLms.on('connect', function () { amtLmsState = 2; obj.setupMeiOsAdmin(null, 2); });
            //amtLms.on('bind', function (map) { });
            amtLms.on('notify', function (data, options, str, code) {
                if (code == 'iAMT0052-3') {
                    kvmGetData();
                } else {
                    //if (str != null) { sendConsoleText('Intel AMT LMS: ' + str); }
                    handleAmtNotification(data);
                }
            });
        } catch (e) { amtLmsState = -1; amtLms = null; }

        // Check if the control channel is connected
        if (mesh.isControlChannelConnected) {
            sendPeriodicServerUpdate(true); // Send the server update
        }

        require('user-sessions').on('changed', function onUserSessionChanged()
        {
            require('user-sessions').enumerateUsers().then(function (users)
            {
                obj.loggedInUsers = users.Active;
                obj.emit('loggedInUsers_Updated');
            });
        });

        require('user-sessions').emit('changed');
        require('user-sessions').on('locked', function (user) { sendConsoleText('[' + (user.Domain ? user.Domain + '\\' : '') + user.Username + '] has LOCKED the desktop'); });
        require('user-sessions').on('unlocked', function (user) { sendConsoleText('[' + (user.Domain ? user.Domain + '\\' : '') + user.Username + '] has UNLOCKED the desktop'); });
        //console.log('Stopping.');
        //process.exit();
    }
    
    obj.stop = function () {
        mesh.AddCommandHandler(null);
        mesh.AddConnectHandler(null);
    }
    
    function onWebSocketClosed() { sendConsoleText("WebSocket #" + this.httprequest.index + " closed.", this.httprequest.sessionid); delete consoleWebSockets[this.httprequest.index]; }
    function onWebSocketData(data) { sendConsoleText("Got WebSocket #" + this.httprequest.index + " data: " + data, this.httprequest.sessionid); }
    function onWebSocketSendOk() { sendConsoleText("WebSocket #" + this.index + " SendOK.", this.sessionid); }
    
    function onWebSocketUpgrade(response, s, head) {
        sendConsoleText("WebSocket #" + this.index + " connected.", this.sessionid);
        this.s = s;
        s.httprequest = this;
        s.end = onWebSocketClosed;
        s.data = onWebSocketData;
    }


    //
    // KVM Data Channel
    //

    obj.setupMeiOsAdmin = function(func, state) {
        amtMei.getLocalSystemAccount(function (x) {
            var transport = require('amt-wsman-duk');
            var wsman = require('amt-wsman');
            var amt = require('amt');
            oswsstack = new wsman(transport, '127.0.0.1', 16992, x.user, x.pass, false);
            obj.osamtstack = new amt(oswsstack);
            if (func) { func(state); }
            //var AllWsman = "CIM_SoftwareIdentity,IPS_SecIOService,IPS_ScreenSettingData,IPS_ProvisioningRecordLog,IPS_HostBasedSetupService,IPS_HostIPSettings,IPS_IPv6PortSettings".split(',');
            //obj.osamtstack.BatchEnum(null, AllWsman, startLmsWsmanResponse, null, true);
            //*************************************
            // Setup KVM data channel if this is Intel AMT 12 or above
            amtMei.getVersion(function (x) {
                var amtver = null;
                try { for (var i in x.Versions) { if (x.Versions[i].Description == 'AMT') amtver = parseInt(x.Versions[i].Version.split('.')[0]); } } catch (e) { }
                if ((amtver != null) && (amtver >= 12)) {
                    obj.kvmGetData('skip'); // Clear any previous data, this is a dummy read to about handling old data.
                    obj.kvmTempTimer = setInterval(function () { obj.kvmGetData(); }, 2000); // Start polling for KVM data.
                    obj.kvmSetData(JSON.stringify({ action: 'restart', ver: 1 })); // Send a restart command to advise the console if present that MicroLMS just started.
                }
            });
        });
    }

    obj.kvmGetData = function(tag) {
        obj.osamtstack.IPS_KVMRedirectionSettingData_DataChannelRead(obj.kvmDataGetResponse, tag);
    }

    obj.kvmDataGetResponse = function (stack, name, response, status, tag) {
        if ((tag != 'skip') && (status == 200) && (response.Body.ReturnValue == 0)) {
            var val = null;
            try { val = Buffer.from(response.Body.DataMessage, 'base64').toString(); } catch (e) { return }
            if (val != null) { obj.kvmProcessData(response.Body.RealmsBitmap, response.Body.MessageId, val); }
        }
    }

    var webRtcDesktop = null;
    obj.kvmProcessData = function (realms, messageId, val) {
        var data = null;
        try { data = JSON.parse(val) } catch (e) { }
        if ((data != null) && (data.action)) {
            if (data.action == 'present') { obj.kvmSetData(JSON.stringify({ action: 'present', ver: 1, platform: process.platform })); }
            if (data.action == 'offer') {
                webRtcDesktop = {};
                var rtc = require('ILibWebRTC');
                webRtcDesktop.webrtc = rtc.createConnection();
                webRtcDesktop.webrtc.on('connected', function () { });
                webRtcDesktop.webrtc.on('disconnected', function () { webRtcCleanUp(); });
                webRtcDesktop.webrtc.on('dataChannel', function (rtcchannel) {
                    webRtcDesktop.rtcchannel = rtcchannel;
                    webRtcDesktop.kvm = mesh.getRemoteDesktopStream();
                    webRtcDesktop.kvm.pipe(webRtcDesktop.rtcchannel, { dataTypeSkip: 1, end: false });
                    webRtcDesktop.rtcchannel.on('end', function () { obj.webRtcCleanUp(); });
                    webRtcDesktop.rtcchannel.on('data', function (x) { obj.kvmCtrlData(this, x); });
                    webRtcDesktop.rtcchannel.pipe(webRtcDesktop.kvm, { dataTypeSkip: 1, end: false });
                    //webRtcDesktop.kvm.on('end', function () { console.log('WebRTC DataChannel closed2'); webRtcCleanUp(); });
                    //webRtcDesktop.rtcchannel.on('data', function (data) { console.log('WebRTC data: ' + data); });
                });
                obj.kvmSetData(JSON.stringify({ action: 'answer', ver: 1, sdp: webRtcDesktop.webrtc.setOffer(data.sdp) }));
            }
        }
    }

    // Polyfill path.join
    var path = {
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

    // Process KVM control channel data
    obj.kvmCtrlData = function(channel, cmd) {
        if (cmd.length > 0 && cmd.charCodeAt(0) != 123) {
            // This is upload data
            if (this.fileupload != null) {
                cmd = Buffer.from(cmd, 'base64');
                var header = cmd.readUInt32BE(0);
                if ((header == 0x01000000) || (header == 0x01000001)) {
                    fs.writeSync(this.fileupload.fp, cmd.slice(4));
                    channel.write({ action: 'upload', sub: 'ack', reqid: this.fileupload.reqid });
                    if (header == 0x01000001) { fs.closeSync(this.fileupload.fp); this.fileupload = null; } // Close the file
                }
            }
            return;
        }
        //console.log('KVM Ctrl Data', cmd);
        //sendConsoleText('KVM Ctrl Data: ' + cmd);

        try { cmd = JSON.parse(cmd); } catch (ex) { console.error('Invalid JSON: ' + cmd); return; }
        if ((cmd.path != null) && (process.platform != 'win32') && (cmd.path[0] != '/')) { cmd.path = '/' + cmd.path; } // Add '/' to paths on non-windows
        switch (cmd.action) {
            case 'ping': {
                // This is a keep alive
                channel.write({ action: 'pong' });
                break;
            }
            case 'lock': {
                // Lock the current user out of the desktop
                if (process.platform == 'win32') { var child = require('child_process'); child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 }); }
                break;
            }
            case 'ls': {
                /*
                // Close the watcher if required
                var samepath = ((this.httprequest.watcher != undefined) && (cmd.path == this.httprequest.watcher.path));
                if ((this.httprequest.watcher != undefined) && (samepath == false)) {
                    //console.log('Closing watcher: ' + this.httprequest.watcher.path);
                    //this.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
                    delete this.httprequest.watcher;
                }
                */

                // Send the folder content to the browser
                var response = getDirectoryInfo(cmd.path);
                if (cmd.reqid != undefined) { response.reqid = cmd.reqid; }
                channel.write(response);

                /*
                // Start the directory watcher
                if ((cmd.path != '') && (samepath == false)) {
                    var watcher = fs.watch(cmd.path, onFileWatcher);
                    watcher.tunnel = this.httprequest;
                    watcher.path = cmd.path;
                    this.httprequest.watcher = watcher;
                    //console.log('Starting watcher: ' + this.httprequest.watcher.path);
                }
                */
                break;
            }
            case 'mkdir': {
                // Create a new empty folder
                fs.mkdirSync(cmd.path);
                break;
            }
            case 'rm': {
                // Remove many files or folders
                for (var i in cmd.delfiles) {
                    var fullpath = path.join(cmd.path, cmd.delfiles[i]);
                    try { fs.unlinkSync(fullpath); } catch (e) { console.log(e); }
                }
                break;
            }
            case 'rename': {
                // Rename a file or folder
                try { fs.renameSync(path.join(cmd.path, cmd.oldname), path.join(cmd.path, cmd.newname)); } catch (e) { console.log(e); }
                break;
            }
            case 'download': {
                // Download a file, to browser
                var sendNextBlock = 0;
                if (cmd.sub == 'start') { // Setup the download
                    if (this.filedownload != null) { channel.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                    this.filedownload = { id: cmd.id, path: cmd.path, ptr: 0 }
                    try { this.filedownload.f = fs.openSync(this.filedownload.path, 'rbN'); } catch (e) { channel.write({ action: 'download', sub: 'cancel', id: this.filedownload.id }); delete this.filedownload; }
                    if (this.filedownload) { channel.write({ action: 'download', sub: 'start', id: cmd.id }); }
                } else if ((this.filedownload != null) && (cmd.id == this.filedownload.id)) { // Download commands
                    if (cmd.sub == 'startack') { sendNextBlock = 8; } else if (cmd.sub == 'stop') { delete this.filedownload; } else if (cmd.sub == 'ack') { sendNextBlock = 1; }
                }
                // Send the next download block(s)
                while (sendNextBlock > 0) {
                    sendNextBlock--;
                    var buf = new Buffer(4096);
                    var len = fs.readSync(this.filedownload.f, buf, 4, 4092, null);
                    this.filedownload.ptr += len;
                    if (len < 4092) { buf.writeInt32BE(0x01000001, 0); fs.closeSync(this.filedownload.f); delete this.filedownload; sendNextBlock = 0; } else { buf.writeInt32BE(0x01000000, 0); }
                    channel.write(buf.slice(0, len + 4).toString('base64')); // Write as Base64
                }
                break;
            }
            case 'upload': {
                // Upload a file, from browser
                if (cmd.sub == 'start') { // Start the upload
                    if (this.fileupload != null) { fs.closeSync(this.fileupload.fp); }
                    if (!cmd.path || !cmd.name) break;
                    this.fileupload = { reqid: cmd.reqid };
                    var filepath = path.join(cmd.path, cmd.name);
                    try { this.fileupload.fp = fs.openSync(filepath, 'wbN'); } catch (e) { }
                    if (this.fileupload.fp) { channel.write({ action: 'upload', sub: 'start', reqid: this.fileupload.reqid }); } else { this.fileupload = null; channel.write({ action: 'upload', sub: 'error', reqid: this.fileupload.reqid }); }
                }
                else if (cmd.sub == 'cancel') { // Stop the upload
                    if (this.fileupload != null) { fs.closeSync(this.fileupload.fp); this.fileupload = null; }
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

    obj.webRtcCleanUp = function() {
        if (webRtcDesktop == null) return;
        if (webRtcDesktop.rtcchannel) {
            try { webRtcDesktop.rtcchannel.close(); } catch (e) { }
            try { webRtcDesktop.rtcchannel.removeAllListeners('data'); } catch (e) { }
            try { webRtcDesktop.rtcchannel.removeAllListeners('end'); } catch (e) { }
            delete webRtcDesktop.rtcchannel;
        }
        if (webRtcDesktop.webrtc) {
            try { webRtcDesktop.webrtc.close(); } catch (e) { }
            try { webRtcDesktop.webrtc.removeAllListeners('connected'); } catch (e) { }
            try { webRtcDesktop.webrtc.removeAllListeners('disconnected'); } catch (e) { }
            try { webRtcDesktop.webrtc.removeAllListeners('dataChannel'); } catch (e) { }
            delete webRtcDesktop.webrtc;
        }
        if (webRtcDesktop.kvm) {
            try { webRtcDesktop.kvm.end(); } catch (e) { }
            delete webRtcDesktop.kvm;
        }
        webRtcDesktop = null;
    }

    obj.kvmSetData = function(x) {
        obj.osamtstack.IPS_KVMRedirectionSettingData_DataChannelWrite(Buffer.from(x).toString('base64'), function () { });
    }

    return obj;
}

//
// Module startup
//

var xexports = null, mainMeshCore = null;
try { xexports = module.exports; } catch (e) { }

if (xexports != null) {
    // If we are running within NodeJS, export the core
    module.exports.createMeshCore = createMeshCore;
} else {
    // If we are not running in NodeJS, launch the core
    mainMeshCore = createMeshCore();
    mainMeshCore.start(null);
}
