/*
Copyright 2017 Intel Corporation

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

    // MeshAgent JavaScript Core Module. This code is sent to and running on the mesh agent.
    obj.meshCoreInfo = "MeshCore v3k";
    obj.meshCoreCapabilities = 14; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript
    var meshServerConnectionState = 0;
    var tunnels = {};
    var lastSelfInfo = null;
    var lastNetworkInfo = null;
    var lastPublicLocationInfo = null;
    var selfInfoUpdateTimer = null;
    obj.useNativePipes = true; //(process.platform == 'win32');

    var http = require('http');
    var fs = require('fs');

    // If we are running in Duktape, agent will be null
    if (agent == null) {
        // Running in native agent, Import libraries
        var db = require('SimpleDataStore').Shared();
        var sha = require('SHA256Stream');
        var mesh = require('MeshAgent');
        var processManager = require('ILibProcessPipe');
        if (mesh.hasKVM == 1) { obj.meshCoreCapabilities |= 1; }
    } else {
        // Running in nodejs
        obj.meshCoreInfo += '-NodeJS';
        obj.meshCoreCapabilities = 8;
        var mesh = agent.getMeshApi();
    }

    // Get our location (lat/long) using our public IP address
    var getIpLocationDataExInProgress = false;
    var getIpLocationDataExCounts = [ 0, 0 ];
    function getIpLocationDataEx(func) {
        if (getIpLocationDataExInProgress == true) { return false; }
        try {
            getIpLocationDataExInProgress = true;
            getIpLocationDataExCounts[0]++;
            http.request({
                host: 'ipinfo.io', // TODO: Use a HTTP proxy if needed!!!!
                port: 80,
                path: 'http://ipinfo.io/json', // Use this service to get our geolocation
                headers: { Host: "ipinfo.io" }
            },
                function (resp) {
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
                    while (w.startsWith('/') || w.startsWith('\\')) { w = w.substring(1); }
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
    function objToString(x, p, ret) {
        if (ret == undefined) ret = '';
        if (p == undefined) p = 0;
        if (x == null) { return '[null]'; }
        if (p > 8) { return '[...]'; }
        if (x == undefined) { return '[undefined]'; }
        if (typeof x == 'string') { if (p == 0) return x; return '"' + x + '"'; }
        if (typeof x == 'buffer') { return '[buffer]'; }
        if (typeof x != 'object') { return x; }
        var r = '{' + (ret ? '\r\n' : ' ');
        for (var i in x) { r += (addPad(p + 2, ret) + i + ': ' + objToString(x[i], p + 2, ret) + (ret ? '\r\n' : ' ')); }
        return r + addPad(p, ret) + '}';
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
                    if (data.type == 'console') { // Process a console command
                        if (data.value && data.sessionid) {
                            var args = splitArgs(data.value);
                            processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid);
                        }
                    }
                    else if (data.type == 'tunnel') { // Process a new tunnel connection request
                        if (data.value && data.sessionid) {
                            // Create a new tunnel object
                            //sendConsoleText(data.value);
                            var xurl = getServerTargetUrlEx(data.value);
                            //sendConsoleText(xurl);
                            if (xurl != null) {
                                var tunnel = http.request(http.parseUri(xurl));
                                tunnel.upgrade = onTunnelUpgrade;
                                tunnel.sessionid = data.sessionid;
                                tunnel.rights = data.rights;
                                tunnel.state = 0;
                                tunnel.url = xurl;
                                tunnel.protocol = 0;

                                // Put the tunnel in the tunnels list
                                var index = 1;
                                while (tunnels[index]) { index++; }
                                tunnel.index = index;
                                tunnels[index] = tunnel;

                                sendConsoleText('New tunnel connection #' + index + ': ' + tunnel.url + ', rights: ' + tunnel.rights, data.sessionid);
                            }
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
            }
        }
    }

    // Called when a file changed in the file system
    function onFileWatcher(a, b) {
        //console.log('onFileWatcher', a, b, this.path);
        var response = getDirectoryInfo(this.path);
        if ((response != undefined) && (response != null)) { this.tunnel.s.write(JSON.stringify(response)); }
    }

    // Get a formated response for a given directory path
    function getDirectoryInfo(reqpath) {
        var response = { path: reqpath, dir: [] };
        if (((reqpath == undefined) || (reqpath == '')) && (process.platform == 'win32')) {
            // List all the drives in the root, or the root itself
            var results = null;
            try { results = fs.readDrivesSync(); } catch (e) { } // TODO: Anyway to get drive total size and free space? Could draw a progress bar.
            //console.log('a', objToString(results, 0, '.'));
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
            var xpath = obj.path.join(reqpath, '*');
            var results = null;
            try { results = fs.readdirSync(xpath); } catch (e) { }
            if (results != null) {
                for (var i = 0; i < results.length; ++i) {
                    if ((results[i] != '.') && (results[i] != '..')) {
                        var stat = null, p = obj.path.join(reqpath, results[i]);
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
    function onTunnelUpgrade(response, s, head) { this.s = s; s.httprequest = this; s.end = onTunnelClosed; s.data = onTunnelData; }
    function onTunnelClosed() {
        sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
        if (this.httprequest.protocol == 1) { this.httprequest.process.end(); delete this.httprequest.process; }
        delete tunnels[this.httprequest.index];

        // Close the watcher if required
        if (this.httprequest.watcher != undefined) {
            //console.log('Closing watcher: ' + this.httprequest.watcher.path);
            //this.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
            delete this.httprequest.watcher; 
        }

        // If there is a upload or download active on this connection, close the file
        if (this.httprequest.uploadFile) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
        if (this.httprequest.downloadFile) { fs.closeSync(this.httprequest.downloadFile); this.httprequest.downloadFile = undefined; }
    }
    function onTunnelSendOk() { sendConsoleText("Tunnel #" + this.index + " SendOK.", this.sessionid); }
    function onTunnelData(data) {
        // If this is upload data, save it to file
        if (this.httprequest.uploadFile) {
            try { fs.writeSync(this.httprequest.uploadFile, data); } catch (e) { this.write(JSON.stringify({ action: 'uploaderror' })); return; } // Write to the file, if there is a problem, error out.
            this.write(JSON.stringify({ action: 'uploadack', reqid: this.httprequest.uploadFileid })); // Ask for more data
            return;
        }
        // If this is a download, send more of the file
        if (this.httprequest.downloadFile) {
            var buf = new Buffer(4096);
            var len = fs.readSync(this.httprequest.downloadFile, buf, 0, 4096, null);
            this.httprequest.downloadFilePtr += len;
            if (len > 0) { this.write(buf.slice(0, len)); } else { fs.closeSync(this.httprequest.downloadFile); this.httprequest.downloadFile = undefined; this.end(); }
            return;
        }
        // Setup remote desktop & terminal without using native pipes
        if ((this.httprequest.desktop) && (obj.useNativePipes == false)) { this.httprequest.desktop.kvm.write(data); return; }
        if ((this.httprequest.terminal) && (obj.useNativePipes == false)) { this.httprequest.terminal.write(data); return; }

        if (this.httprequest.state == 0) {
            // Check if this is a relay connection
            if (data == 'c') { this.httprequest.state = 1; sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid); }
        } else {
            // Handle tunnel data
            if (this.httprequest.protocol == 0) { // 1 = SOL, 2 = KVM, 3 = IDER, 4 = Files, 5 = FileTransfer
                // Take a look at the protocolab
                this.httprequest.protocol = parseInt(data);
                if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                if (this.httprequest.protocol == 1) {
                    if (obj.useNativePipes == false) {
                        // Remote Terminal without using native pipes
                        if (process.platform == "win32") {
                            this.httprequest.terminal = processManager.CreateProcess("%windir%\\system32\\cmd.exe");
                        } else {
                            this.httprequest.terminal = processManager.CreateProcess("/bin/sh", "sh", ILibProcessPipe_SpawnTypes.TERM);
                        }
                        this.httprequest.terminal.tunnel = this;
                        this.httprequest.terminal.on('data', function (chunk) { this.tunnel.write(chunk); });
                        this.httprequest.terminal.error.data = function (chunk) { this.parent.tunnel.write(chunk); }
                    } else {
                        // Remote terminal using native pipes
                        if (process.platform == "win32") {
                            this.httprequest.process = processManager.CreateProcess("%windir%\\system32\\cmd.exe");
                        } else {
                            this.httprequest.process = processManager.CreateProcess("/bin/sh", "sh", ILibProcessPipe_SpawnTypes.TERM);
                        }
                        this.httprequest.process.tunnel = this;
                        this.httprequest.process.error.data = function (chunk) { this.parent.tunnel.write(chunk); }
                        this.httprequest.process.pipe(this);
                        this.pipe(this.httprequest.process);
                    }
                }
                if (this.httprequest.protocol == 2) {
                    if (obj.useNativePipes == false) {
                        // Remote Desktop without using native pipes
                        this.httprequest.desktop = { state: 0, kvm: mesh.getRemoteDesktopStream(), tunnel: this };
                        this.httprequest.desktop.kvm.tunnel = this;
                        this.httprequest.desktop.kvm.on('data', function (data) { this.tunnel.write(data); });
                        this.desktop = this.httprequest.desktop;
                        this.end = function () { if (--this.desktop.kvm.connectionCount == 0) { this.httprequest.desktop.kvm.end(); } };
                        if (this.httprequest.desktop.kvm.hasOwnProperty("connectionCount")) { this.httprequest.desktop.kvm.connectionCount++; } else { this.httprequest.desktop.kvm.connectionCount = 1; }
                    } else {
                        // Remote desktop using native pipes
                        this.httprequest.desktop = { state: 0, kvm: mesh.getRemoteDesktopStream(), tunnel: this };
                        this.httprequest.desktop.kvm.parent = this.httprequest.desktop;
                        this.desktop = this.httprequest.desktop;
                        this.end = function () {
                            --this.desktop.kvm.connectionCount;
                            this.unpipe(this.httprequest.desktop.kvm);
                            this.httprequest.desktop.kvm.unpipe(this);
                            if (this.desktop.kvm.connectionCount == 0) { this.httprequest.desktop.kvm.end(); }
                        };
                        if (this.httprequest.desktop.kvm.hasOwnProperty("connectionCount")) { this.httprequest.desktop.kvm.connectionCount++; } else { this.httprequest.desktop.kvm.connectionCount = 1; }
                        this.pipe(this.httprequest.desktop.kvm);
                        this.httprequest.desktop.kvm.pipe(this);
                    }
                }
                else if (this.httprequest.protocol == 5) {
                    // Setup files
                    // NOP
                }
            } else if (this.httprequest.protocol == 1) {
                // Send data into terminal stdin
                //this.write(data); // Echo back the keys (Does not seem to be a good idea)
                this.httprequest.process.write(data);
            } else if (this.httprequest.protocol == 2) {
                // Send data into remote desktop
                // TODO ADD REMOTE DESKTOP (This is test code)
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
                if ((cmd == null) || (cmd.action == undefined)) { return; }
                //console.log(objToString(cmd, 0, '.'));
                switch (cmd.action) {
                    case 'ls': {
                        // Close the watcher if required
                        var samepath = ((this.httprequest.watcher != undefined) && (cmd.path == this.httprequest.watcher.path));
                        if ((this.httprequest.watcher != undefined) && (samepath == false)) {
                            //console.log('Closing watcher: ' + this.httprequest.watcher.path);
                            //this.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
                            delete this.httprequest.watcher;
                        }

                        // Send the folder content to the browser
                        var response = getDirectoryInfo(cmd.path);
                        if (cmd.reqid != undefined) { response.reqid = cmd.reqid; }
                        this.write(JSON.stringify(response));

                        // Start the directory watcher
                        if ((cmd.path != '') && (samepath == false)) {
                            var watcher = fs.watch(cmd.path, onFileWatcher);
                            watcher.tunnel = this.httprequest;
                            watcher.path = cmd.path;
                            this.httprequest.watcher = watcher;
                            //console.log('Starting watcher: ' + this.httprequest.watcher.path);
                        }
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
                        // Packet download of a file, agent to browser
                        if (cmd.path == undefined) break;
                        var filepath = cmd.name ? obj.path.join(cmd.path, cmd.name) : cmd.path;
                        //console.log('Download: ' + filepath);
                        try { this.httprequest.downloadFile = fs.openSync(filepath, 'rbN'); } catch (e) { this.write(JSON.stringify({ action: 'downloaderror', reqid: cmd.reqid })); break; }
                        this.httprequest.downloadFileId = cmd.reqid;
                        this.httprequest.downloadFilePtr = 0;
                        if (this.httprequest.downloadFile) { this.write(JSON.stringify({ action: 'downloadstart', reqid: this.httprequest.downloadFileId })); }
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
                    case 'upload': {
                        // Upload a file, browser to agent
                        if (this.httprequest.uploadFile != undefined) { fs.closeSync(this.httprequest.uploadFile); this.httprequest.uploadFile = undefined; }
                        if (cmd.path == undefined) break;
                        var filepath = cmd.name ? obj.path.join(cmd.path, cmd.name) : cmd.path;
                        try { this.httprequest.uploadFile = fs.openSync(filepath, 'wbN'); } catch (e) { this.write(JSON.stringify({ action: 'uploaderror', reqid: cmd.reqid })); break; }
                        this.httprequest.uploadFileid = cmd.reqid;
                        if (this.httprequest.uploadFile) { this.write(JSON.stringify({ action: 'uploadstart', reqid: this.httprequest.uploadFileid })); }
                        break;
                    }
                }
            }
            //sendConsoleText("Got tunnel #" + this.httprequest.index + " data: " + data, this.httprequest.sessionid);
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
                    response = 'Available commands: help, info, args, print, type, dbget, dbset, dbcompact, parseuri, httpget, wslist, wsconnect, wssend, wsclose, notify, ls, amt, netinfo, location, power, wakeonlan.';
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
                    response = 'Current Core: ' + obj.meshCoreInfo + '.\r\nAgent Time: ' + Date() + '.\r\nUser Rights: 0x' + rights.toString(16) + '.\r\nPlatform Info: ' + process.platform + '.\r\nCapabilities: ' + obj.meshCoreCapabilities + '.\r\nNative Pipes: ' + obj.useNativePipes + '.\r\nServer URL: ' + mesh.ServerUrl + '.';
                    break;
                }
                case 'selfinfo': { // Return self information block
                    response = JSON.stringify(buildSelfInfo());
                    break;
                }
                case 'args': { // Displays parsed command arguments
                    response = 'args ' + objToString(args, 0, '.');
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
                            httprequest = http.request(http.parseUri(args['_'][0]));
                        } catch (e) { response = 'Invalid HTTP websocket request'; }
                        if (httprequest != null) {
                            httprequest.upgrade = onWebSocketUpgrade;

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
                case 'amt': { // Show Intel AMT status
                    //response = 'KVM: ' + mesh.hasKVM + ', HECI: ' + mesh.hasHECI + ', MicroLMS: ' + mesh.activeMicroLMS + '\r\n';
                    //response += JSON.stringify(mesh.MEInfo);
                    if (mesh.hasHECI == 1) {
                        var meinfo = mesh.MEInfo;
                        delete meinfo.TrustedHashes;
                        response = objToString(meinfo, 0, '.');
                    } else {
                        response = 'This mesh agent does not support Intel AMT.';
                    }
                    break;
                }
                case 'netinfo': { // Show network interface information
                    //response = objToString(mesh.NetInfo, 0, '.');
                    var interfaces = require('os').networkInterfaces();
                    response = objToString(interfaces, 0, '.');
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
                        sendConsoleText(objToString({ "action": "iplocation", "type": "publicip", "value": location }, 0, '.'));
                    });
                    break;
                }
                case 'parseuri': {
                    response = JSON.stringify(http.parseUri(args['_'][0]));
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
            sendPeriodicServerUpdate(true);
            if (selfInfoUpdateTimer == null) { selfInfoUpdateTimer = setInterval(sendPeriodicServerUpdate, 60000); } // Should be a long time, like 20 minutes. For now, 1 minute.
        }
    }

    // Build a bunch a self information data that will be sent to the server
    // We need to do this periodically and if anything changes, send the update to the server.
    function buildSelfInfo() {
        var r = { "action": "coreinfo", "value": obj.meshCoreInfo, "caps": obj.meshCoreCapabilities };
        if (mesh.hasHECI == 1) {
            var meinfo = mesh.MEInfo;
            var amtPresent = false, intelamt = {};
            if (meinfo.Versions && meinfo.Versions.AMT) { intelamt.ver = meinfo.Versions.AMT; amtPresent = true; }
            if (meinfo.ProvisioningState) { intelamt.state = meinfo.ProvisioningState; amtPresent = true; }
            if (meinfo.flags) { intelamt.flags = meinfo.Flags; amtPresent = true; }
            if (meinfo.OsHostname) { intelamt.host = meinfo.OsHostname; amtPresent = true; }
            if (amtPresent == true) { r.intelamt = intelamt }
        }
        return JSON.stringify(r);
    }

    // Called periodically to check if we need to send updates to the server
    function sendPeriodicServerUpdate(force) {
        // Update the self information data
        var selfInfo = buildSelfInfo();
        var selfInfoStr = JSON.stringify(selfInfo);
        if ((force == true) || (selfInfoStr != lastSelfInfo)) { mesh.SendCommand(selfInfo); lastSelfInfo = selfInfoStr; }

        // Update the network interfaces information data
        var netInfo = mesh.NetInfo;
        netInfo.action = 'netinfo';
        var netInfoStr = JSON.stringify(netInfo);
        if ((force == true) || (clearGatewayMac(netInfoStr) != clearGatewayMac(lastNetworkInfo))) { mesh.SendCommand(netInfo); lastNetworkInfo = netInfoStr; }
    }

    // Called on MicroLMS Intel AMT user notification
    function handleAmtNotification(notification) {
        var amtMessage = notification.messageId;
        var amtMessageArg = notification.messageArguments;
        var notify = null;

        switch (amtMessage) {
            case 'iAMT0050': {
                // Serial over lan
                if (amtMessageArg == '48') {
                    // Connected
                    notify = 'Intel&reg; AMT Serial-over-LAN connected';
                }
                else if (amtMessageArg == '49') {
                    // Disconnected
                    notify = 'Intel&reg; AMT Serial-over-LAN disconnected';
                }
            }
            case 'iAMT0052': {
                // HWKVM
                if (amtMessageArg == '1') {
                    // Connected
                    notify = 'Intel&reg; AMT KVM connected';
                }
                else if (amtMessageArg == '2') {
                    // Disconnected
                    notify = 'Intel&reg; AMT KVM disconnected';
                }
                break;
            }
        }

        if (notify != null) {
            var notification = { "action": "msg", "type": "notify", "value": notify, "tag": "general" };
            //mesh.SendCommand(notification); // no sessionid or userid specified, notification will go to the entire mesh
            //console.log("handleAmtNotification", JSON.stringify(notification));
        }
    }

    // Starting function
    obj.start = function () {
        // Setup the mesh agent event handlers
        mesh.AddCommandHandler(handleServerCommand);
        mesh.AddConnectHandler(handleServerConnection);
        mesh.lmsNotification = handleAmtNotification;
        sendPeriodicServerUpdate(); // TODO: Check if connected before sending

        // Parse input arguments
        //var args = parseArgs(process.argv);
        //console.log(args);

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

    return obj;
}

var xexports = null;
try { xexports = module.exports; } catch (e) { }

if (xexports != null) {
    // If we are running within NodeJS, export the core
    module.exports.createMeshCore = createMeshCore;
} else {
    // If we are not running in NodeJS, launch the core
    createMeshCore().start(null);
}
