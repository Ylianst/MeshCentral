/*
Copyright 2018-2019 Intel Corporation

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

process.on('uncaughtException', function (ex) {
    require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": "uncaughtException1: " + ex });
});

// NOTE: This seems to cause big problems, don't enable the debugger in the server's meshcore. 
//attachDebugger({ webport: 9999, wait: 1 }).then(function (prt) { console.log('Point Browser for Debug to port: ' + prt); });

// Mesh Rights
var MNG_ERROR = 65;
var MESHRIGHT_EDITMESH = 1;
var MESHRIGHT_MANAGEUSERS = 2;
var MESHRIGHT_MANAGECOMPUTERS = 4;
var MESHRIGHT_REMOTECONTROL = 8;
var MESHRIGHT_AGENTCONSOLE = 16;
var MESHRIGHT_SERVERFILES = 32;
var MESHRIGHT_WAKEDEVICE = 64;
var MESHRIGHT_SETNOTES = 128;
var MESHRIGHT_REMOTEVIEW = 256;
var MESHRIGHT_NOTERMINAL = 512;
var MESHRIGHT_NOFILES = 1024;
var MESHRIGHT_NOAMT = 2048;
var MESHRIGHT_LIMITEDINPUT = 4096;

function createMeshCore(agent)
{
    var obj = {};

    if (process.platform == 'darwin' && !process.versions)
    {
        // This is an older MacOS Agent, so we'll need to check the service definition so that Auto-Update will function correctly
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        child.stdin.write("cat /Library/LaunchDaemons/meshagent_osx64_LaunchDaemon.plist | tr '\n' '\.' | awk '{split($0, a, \"<key>KeepAlive</key>\"); split(a[2], b, \"<\"); split(b[2], c, \">\"); ");
        child.stdin.write(" if(c[1]==\"dict\"){ split(a[2], d, \"</dict>\"); if(split(d[1], truval, \"<true/>\")>1) { split(truval[1], kn1, \"<key>\"); split(kn1[2], kn2, \"</key>\"); print kn2[1]; } }");
        child.stdin.write(" else { split(c[1], ka, \"/\"); if(ka[1]==\"true\") {print \"ALWAYS\";} } }'\nexit\n");
        child.waitExit();
        if (child.stdout.str.trim() == 'Crashed')
        {
            child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("launchctl list | grep 'meshagent' | awk '{ if($3==\"meshagent\"){print $1;}}'\nexit\n");
            child.waitExit();

            if (parseInt(child.stdout.str.trim()) == process.pid)
            {
                // The currently running MeshAgent is us, so we can continue with the update
                var plist = require('fs').readFileSync('/Library/LaunchDaemons/meshagent_osx64_LaunchDaemon.plist').toString();
                var tokens = plist.split('<key>KeepAlive</key>');
                if (tokens[1].split('>')[0].split('<')[1] == 'dict')
                {
                    var tmp = tokens[1].split('</dict>');
                    tmp.shift();
                    tokens[1] = '\n    <true/>' + tmp.join('</dict>');
                    tokens = tokens.join('<key>KeepAlive</key>');

                    require('fs').writeFileSync('/Library/LaunchDaemons/meshagent_osx64_LaunchDaemon.plist', tokens);

                    var fix = '';
                    fix += ("function macosRepair()\n");
                    fix += ("{\n");
                    fix += ("    var child = require('child_process').execFile('/bin/sh', ['sh']);\n");
                    fix += ("    child.stdout.str = '';\n");
                    fix += ("    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });\n");
                    fix += ("    child.stderr.on('data', function (chunk) { });\n");
                    fix += ("    child.stdin.write('launchctl unload /Library/LaunchDaemons/meshagent_osx64_LaunchDaemon.plist\\n');\n");
                    fix += ("    child.stdin.write('launchctl load /Library/LaunchDaemons/meshagent_osx64_LaunchDaemon.plist\\n');\n");
                    fix += ("    child.stdin.write('rm /Library/LaunchDaemons/meshagentRepair.plist\\n');\n");
                    fix += ("    child.stdin.write('rm " + process.cwd() + "/macosRepair.js\\n');\n");
                    fix += ("    child.stdin.write('launchctl stop meshagentRepair\\nexit\\n');\n");
                    fix += ("    child.waitExit();\n");
                    fix += ("}\n");
                    fix += ("macosRepair();\n");
                    fix += ("process.exit();\n");
                    require('fs').writeFileSync(process.cwd() + '/macosRepair.js', fix);

                    var plist = '<?xml version="1.0" encoding="UTF-8"?>\n';
                    plist += '<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';
                    plist += '<plist version="1.0">\n';
                    plist += '  <dict>\n';
                    plist += '      <key>Label</key>\n';
                    plist += ('     <string>meshagentRepair</string>\n');
                    plist += '      <key>ProgramArguments</key>\n';
                    plist += '      <array>\n';
                    plist += ('        <string>' + process.execPath + '</string>\n');
                    plist += '        <string>macosRepair.js</string>\n';
                    plist += '      </array>\n';
                    plist += '      <key>WorkingDirectory</key>\n';
                    plist += ('     <string>' + process.cwd() + '</string>\n');
                    plist += '      <key>RunAtLoad</key>\n';
                    plist += '      <true/>\n';
                    plist += '  </dict>\n';
                    plist += '</plist>';
                    require('fs').writeFileSync('/Library/LaunchDaemons/meshagentRepair.plist', plist);

                    child = require('child_process').execFile('/bin/sh', ['sh']);
                    child.stdout.str = '';
                    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                    child.stdin.write("launchctl load /Library/LaunchDaemons/meshagentRepair.plist\nexit\n");
                    child.waitExit();
                }
            }
        }
    }

    // Create Secure IPC for Diagnostic Agent Communications
    obj.DAIPC = require('net').createServer();
    if (process.platform != 'win32') { try { require('fs').unlinkSync(process.cwd() + '/DAIPC'); } catch (ee) { } }
    obj.DAIPC.IPCPATH = process.platform == 'win32' ? ('\\\\.\\pipe\\' + require('_agentNodeId')() + '-DAIPC') : (process.cwd() + '/DAIPC');
    try { obj.DAIPC.listen({ path: obj.DAIPC.IPCPATH }); } catch (e) { }
    obj.DAIPC.on('connection', function (c)
    {
        c._send = function (j)
        {
            var data = JSON.stringify(j);
            var packet = Buffer.alloc(data.length + 4);
            packet.writeUInt32LE(data.length + 4, 0);
            Buffer.from(data).copy(packet, 4);
            this.end(packet);
        };
        this._daipc = c;
        c.parent = this;
        c.on('end', function () { console.log('Connection Closed'); this.parent._daipc = null; });
        c.on('data', function (chunk)
        {
            if (chunk.length < 4) { this.unshift(chunk); return; }
            var len = chunk.readUInt32LE(0);
            if (len > 8192) { this.parent._daipc = null; this.end(); return; }
            if (chunk.length < len) { this.unshift(chunk); return; }
            
            var data = chunk.slice(4, len);
            try
            {
                data = JSON.parse(data.toString());
            }
            catch(de)
            {
                this.parent._daipc = null; this.end(); return;
            }
            
            if (!data.cmd) { this.parent._daipc = null; this.end(); return; }

            try
            {
                switch(data.cmd)
                {
                    case 'query':
                        switch(data.value)
                        {
                            case 'connection':
                                data.result = require('MeshAgent').ConnectedServer;
                                this._send(data);
                                break;
                        }
                        break;
                    default:
                        this.parent._daipc = null; this.end(); return;
                        break;
                }
            }
            catch(xe)
            {
                this.parent._daipc = null; this.end(); return;
            }
        });
    });
    function diagnosticAgent_uninstall()
    {
        require('service-manager').manager.uninstallService('meshagentDiagnostic');
        require('task-scheduler').delete('meshagentDiagnostic/periodicStart');
    };
    function diagnosticAgent_installCheck(install)
    {
        try
        {
            var diag = require('service-manager').manager.getService('meshagentDiagnostic');
            return (diag);
        }
        catch (e)
        {
        }
        if (!install) { return (null); }

        var svc = null;
        try
        {
            require('service-manager').manager.installService(
                {
                    name: 'meshagentDiagnostic',
                    displayName: 'Mesh Agent Diagnostic Service',
                    description: 'Mesh Agent Diagnostic Service',
                    servicePath: process.execPath,
                    parameters: ['-recovery']
                    //files: [{ newName: 'diagnostic.js', _buffer: Buffer.from('LyoNCkNvcHlyaWdodCAyMDE5IEludGVsIENvcnBvcmF0aW9uDQoNCkxpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSAiTGljZW5zZSIpOw0KeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLg0KWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0DQoNCiAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjANCg0KVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZQ0KZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gIkFTIElTIiBCQVNJUywNCldJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLg0KU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZA0KbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuDQoqLw0KDQp2YXIgaG9zdCA9IHJlcXVpcmUoJ3NlcnZpY2UtaG9zdCcpLmNyZWF0ZSgnbWVzaGFnZW50RGlhZ25vc3RpYycpOw0KdmFyIFJlY292ZXJ5QWdlbnQgPSByZXF1aXJlKCdNZXNoQWdlbnQnKTsNCg0KaG9zdC5vbignc2VydmljZVN0YXJ0JywgZnVuY3Rpb24gKCkNCnsNCiAgICBjb25zb2xlLnNldERlc3RpbmF0aW9uKGNvbnNvbGUuRGVzdGluYXRpb25zLkxPR0ZJTEUpOw0KICAgIGhvc3Quc3RvcCA9IGZ1bmN0aW9uKCkNCiAgICB7DQogICAgICAgIHJlcXVpcmUoJ3NlcnZpY2UtbWFuYWdlcicpLm1hbmFnZXIuZ2V0U2VydmljZSgnbWVzaGFnZW50RGlhZ25vc3RpYycpLnN0b3AoKTsNCiAgICB9DQogICAgUmVjb3ZlcnlBZ2VudC5vbignQ29ubmVjdGVkJywgZnVuY3Rpb24gKHN0YXR1cykNCiAgICB7DQogICAgICAgIGlmIChzdGF0dXMgPT0gMCkNCiAgICAgICAgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ0RpYWdub3N0aWMgQWdlbnQ6IFNlcnZlciBjb25uZWN0aW9uIGxvc3QuLi4nKTsNCiAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgfQ0KICAgICAgICBjb25zb2xlLmxvZygnRGlhZ25vc3RpYyBBZ2VudDogQ29ubmVjdGlvbiBFc3RhYmxpc2hlZCB3aXRoIFNlcnZlcicpOw0KICAgICAgICBzdGFydCgpOw0KICAgIH0pOw0KfSk7DQpob3N0Lm9uKCdub3JtYWxTdGFydCcsIGZ1bmN0aW9uICgpDQp7DQogICAgaG9zdC5zdG9wID0gZnVuY3Rpb24gKCkNCiAgICB7DQogICAgICAgIHByb2Nlc3MuZXhpdCgpOw0KICAgIH0NCiAgICBjb25zb2xlLmxvZygnTm9uIFNlcnZpY2UgTW9kZScpOw0KICAgIFJlY292ZXJ5QWdlbnQub24oJ0Nvbm5lY3RlZCcsIGZ1bmN0aW9uIChzdGF0dXMpDQogICAgew0KICAgICAgICBpZiAoc3RhdHVzID09IDApDQogICAgICAgIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdEaWFnbm9zdGljIEFnZW50OiBTZXJ2ZXIgY29ubmVjdGlvbiBsb3N0Li4uJyk7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCiAgICAgICAgY29uc29sZS5sb2coJ0RpYWdub3N0aWMgQWdlbnQ6IENvbm5lY3Rpb24gRXN0YWJsaXNoZWQgd2l0aCBTZXJ2ZXInKTsNCiAgICAgICAgc3RhcnQoKTsNCiAgICB9KTsNCn0pOw0KaG9zdC5vbignc2VydmljZVN0b3AnLCBmdW5jdGlvbiAoKSB7IHByb2Nlc3MuZXhpdCgpOyB9KTsNCmhvc3QucnVuKCk7DQoNCg0KZnVuY3Rpb24gc3RhcnQoKQ0Kew0KDQp9Ow0K', 'base64') }]
                });
            svc = require('service-manager').manager.getService('meshagentDiagnostic');
        }
        catch (e)
        {
            return (null);
        }
        var proxyConfig = require('global-tunnel').proxyConfig;
        var cert = require('MeshAgent').GenerateAgentCertificate('CN=MeshNodeDiagnosticCertificate');
        var nodeid = require('tls').loadCertificate(cert.root).getKeyHash().toString('base64');
        ddb = require('SimpleDataStore').Create(svc.appWorkingDirectory().replace('\\', '/') + '/meshagentDiagnostic.db');
        ddb.Put('disableUpdate', '1');
        ddb.Put('MeshID', Buffer.from(require('MeshAgent').ServerInfo.MeshID, 'hex'));
        ddb.Put('ServerID', require('MeshAgent').ServerInfo.ServerID);
        ddb.Put('MeshServer', require('MeshAgent').ServerInfo.ServerUri);
        if (cert.root.pfx) { ddb.Put('SelfNodeCert', cert.root.pfx); }
        if (cert.tls) { ddb.Put('SelfNodeTlsCert', cert.tls.pfx); }
        if (proxyConfig)
        {
            ddb.Put('WebProxy', proxyConfig.host + ':' + proxyConfig.port);
        }
        else
        {
            ddb.Put('ignoreProxyFile', '1');
        }

        require('MeshAgent').SendCommand({ action: 'diagnostic', value: { command: 'register', value: nodeid } });
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: 'Diagnostic Agent Registered [' + nodeid.length + '/' + nodeid + ']' });

        delete ddb;

        // Set a recurrent task, to run the Diagnostic Agent every 2 days
        require('task-scheduler').create({name: 'meshagentDiagnostic/periodicStart', daily: 2, time: require('tls').generateRandomInteger('0', '23') + ':' + require('tls').generateRandomInteger('0', '59').padStart(2, '0'), service: 'meshagentDiagnostic'});
        //require('task-scheduler').create({ name: 'meshagentDiagnostic/periodicStart', daily: '1', time: '17:16', service: 'meshagentDiagnostic' });

        return (svc);
    }

    /*
    function borderController() {
        this.container = null;
        this.Start = function Start(user) {
            if (this.container == null) {
                if (process.platform == 'win32') {
                    try {
                        this.container = require('ScriptContainer').Create({ processIsolation: 1, sessionId: user.SessionId });
                    } catch (ex) {
                        this.container = require('ScriptContainer').Create({ processIsolation: 1 });
                    }
                } else {
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
    obj.borderManager = new borderController();
    */
    
    // MeshAgent JavaScript Core Module. This code is sent to and running on the mesh agent.
    var meshCoreObj = { "action": "coreinfo", "value": "MeshCore v6", "caps": 14 }; // Capability bitmask: 1 = Desktop, 2 = Terminal, 4 = Files, 8 = Console, 16 = JavaScript, 32 = Temporary Agent, 64 = Recovery Agent

    // Get the operating system description string
    try { require('os').name().then(function (v) { meshCoreObj.osdesc = v; }); } catch (ex) { }

    var meshServerConnectionState = 0;
    var tunnels = {};
    var lastMeInfo = null;
    var lastNetworkInfo = null;
    var lastPublicLocationInfo = null;
    var selfInfoUpdateTimer = null;
    var http = require('http');
    var net = require('net');
    var fs = require('fs');
    var rtc = require('ILibWebRTC');
    var amt = null;
    var processManager = require('process-manager');
    var wifiScannerLib = null;
    var wifiScanner = null;
    var networkMonitor = null;
    var amtscanner = null;
    var nextTunnelIndex = 1;
    var amtPolicy = null;

    // If we are running in Duktape, agent will be null
    if (agent == null) {
        // Running in native agent, Import libraries
        db = require('SimpleDataStore').Shared();
        sha = require('SHA256Stream');
        mesh = require('MeshAgent');
        childProcess = require('child_process');
        if (mesh.hasKVM == 1) { // if the agent is compiled with KVM support
            // Check if this computer supports a desktop
            try { if ((process.platform == 'win32') || (process.platform == 'darwin') || (require('monitor-info').kvm_x11_support)) { meshCoreObj.caps |= 1; } } catch (ex) { }
        }
    } else {
        // Running in nodejs
        meshCoreObj.value += '-NodeJS';
        meshCoreObj.caps = 8;
        mesh = agent.getMeshApi();
    }

    mesh.DAIPC = obj.DAIPC;

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
    } catch (ex) { amtscanner = null; }

    // Fetch the SMBios Tables
    var SMBiosTables = null;
    var SMBiosTablesRaw = null;
    try {
        var SMBiosModule = null;
        try { SMBiosModule = require('smbios'); } catch (ex) { }
        if (SMBiosModule != null) {
            SMBiosModule.get(function (data) {
                if (data != null) {
                    SMBiosTablesRaw = data;
                    SMBiosTables = require('smbios').parse(data)
                    if (mesh.isControlChannelConnected) { mesh.SendCommand({ "action": "smbios", "value": SMBiosTablesRaw }); }

                    // If SMBios tables say that AMT is present, try to connect MEI
                    if (SMBiosTables.amtInfo && (SMBiosTables.amtInfo.AMT == true)) {
                        var amtmodule = require('amt-manage');
                        amt = new amtmodule(mesh, db, true);
                        amt.onStateChange = function (state) { if (state == 2) { sendPeriodicServerUpdate(1); } }
                        if (amtPolicy != null) { amt.setPolicy(amtPolicy); }
                        amt.start();
                    }
                }
            });
        }
    } catch (ex) { sendConsoleText("ex1: " + ex); }
    
    // Try to load up the WIFI scanner
    try {
        var wifiScannerLib = require('wifi-scanner');
        wifiScanner = new wifiScannerLib();
        wifiScanner.on('accessPoint', function (data) { sendConsoleText("wifiScanner: " + data); });
    } catch (ex) { wifiScannerLib = null; wifiScanner = null; }

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
                                    //sendConsoleText('TUNNEL: ' + JSON.stringify(data));
                                    var tunnel = http.request(woptions);
                                    tunnel.upgrade = onTunnelUpgrade;
                                    tunnel.on('error', function (e) { sendConsoleText('ERROR: ' + JSON.stringify(e)); });
                                    tunnel.sessionid = data.sessionid;
                                    tunnel.rights = data.rights;
                                    tunnel.consent = data.consent;
                                    tunnel.username = data.username;
                                    tunnel.state = 0;
                                    tunnel.url = xurl;
                                    tunnel.protocol = 0;
                                    tunnel.tcpaddr = data.tcpaddr;
                                    tunnel.tcpport = data.tcpport;
                                    tunnel.udpaddr = data.udpaddr;
                                    tunnel.udpport = data.udpport;
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
                        case 'ps': {
                            // Return the list of running processes
                            if (data.sessionid) {
                                processManager.getProcesses(function (plist) { mesh.SendCommand({ "action": "msg", "type": "ps", "value": JSON.stringify(plist), "sessionid": data.sessionid }); });
                            }
                            break;
                        }
                        case 'pskill': {
                            // Kill a process
                            if (data.value) {
                                try { process.kill(data.value); } catch (e) { sendConsoleText("pskill: " + JSON.stringify(e)); }
                            }
                            break;
                        }
                        case 'openUrl': {
                            // Open a local web browser and return success/fail
                            sendConsoleText('OpenURL: ' + data.url);
                            if (data.url) { mesh.SendCommand({ "action": "msg", "type":"openUrl", "url": data.url, "sessionid": data.sessionid, "success": (openUserDesktopUrl(data.url) != null) }); }
                            break;
                        }
                        case 'getclip': {
                            // Send the load clipboard back to the user
                            //sendConsoleText('getClip: ' + JSON.stringify(data));
                            if (require('MeshAgent').isService)
                            {
                                require('clipboard').dispatchRead().then(function (str) { mesh.SendCommand({ "action": "msg", "type": "getclip", "sessionid": data.sessionid, "data": str }); });
                            }
                            else
                            {
                                require("clipboard").read().then(function (str) { mesh.SendCommand({ "action": "msg", "type": "getclip", "sessionid": data.sessionid, "data": str }); });
                            }
                            break;
                        }
                        case 'setclip': {
                            // Set the load clipboard to a user value
                            //sendConsoleText('setClip: ' + JSON.stringify(data));
                            if (typeof data.data == 'string')
                            {
                                if (require('MeshAgent').isService)
                                {
                                    require('clipboard').dispatchWrite(data.data);
                                }
                                else
                                {
                                    require("clipboard")(data.data); // Set the clipboard
                                }
                                mesh.SendCommand({ "action": "msg", "type": "setclip", "sessionid": data.sessionid, "success": true });
                            } 
                            break;
                        }
                        default:
                            // Unknown action, ignore it.
                            break;
                    }
                    break;
                }
                case 'acmactivate': {
                    if (amt != null) { amt.setAcmResponse(data); }
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
                    if (data.title && data.msg) {
                        try { require('toaster').Toast(data.title, data.msg); } catch (ex) { }
                    }
                    break;
                }
                case 'openUrl': {
                    // Open a local web browser and return success/fail
                    sendConsoleText('OpenURL: ' + data.url);
                    if (data.url) { mesh.SendCommand({ "action": "openUrl", "url": data.url, "sessionid": data.sessionid, "success": (openUserDesktopUrl(data.url) != null) }); }
                    break;
                }
                case 'amtPolicy': {
                    // Store the latest Intel AMT policy
                    amtPolicy = data.amtPolicy;
                    if (data.amtPolicy != null) { db.Put('amtPolicy', JSON.stringify(data.amtPolicy)); } else { db.Put('amtPolicy', null); }
                    if (amt != null) { amt.setPolicy(amtPolicy, true); }
                    break;
                }
                case 'getScript': {
                    // Received a configuration script from the server
                    sendConsoleText('getScript: ' + JSON.stringify(data));
                    break;
                }
                case 'ping': { mesh.SendCommand('{"action":"pong"}'); break; }
                case 'pong': { break; }
                default:
                    // Unknown action, ignore it.
                    break;
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

        //sendConsoleText('onTunnelUpgrade - ' + this.tcpport + ' - ' + this.udpport);

        if (this.tcpport != null) {
            // This is a TCP relay connection, pause now and try to connect to the target.
            s.pause();
            s.data = onTcpRelayServerTunnelData;
            var connectionOptions = { port: parseInt(this.tcpport) };
            if (this.tcpaddr != null) { connectionOptions.host = this.tcpaddr; } else { connectionOptions.host = '127.0.0.1'; }
            s.tcprelay = net.createConnection(connectionOptions, onTcpRelayTargetTunnelConnect);
            s.tcprelay.peerindex = this.index;
        } if (this.udpport != null) {
            // This is a UDP relay connection, get the UDP socket setup. // TODO: ***************
            s.data = onUdpRelayServerTunnelData;
            s.udprelay = require('dgram').createSocket({ type: 'udp4' });
            s.udprelay.bind({ port: 0 });
            s.udprelay.peerindex = this.index;
            s.udprelay.on('message', onUdpRelayTargetTunnelConnect);
            s.udprelay.udpport = this.udpport;
            s.udprelay.udpaddr = this.udpaddr;
            s.udprelay.first = true;
        } else {
            // This is a normal connect for KVM/Terminal/Files
            s.data = onTunnelData;
        }
    }

    // Called when UDP relay data is received // TODO****
    function onUdpRelayTargetTunnelConnect(data) {
        var peerTunnel = tunnels[this.peerindex];
        peerTunnel.s.write(data);
    }

    // Called when we get data from the server for a TCP relay (We have to skip the first received 'c' and pipe the rest)
    function onUdpRelayServerTunnelData(data) {
        if (this.udprelay.first === true) {
            delete this.udprelay.first; // Skip the first 'c' that is received.
        } else {
            this.udprelay.send(data, parseInt(this.udprelay.udpport), this.udprelay.udpaddr ? this.udprelay.udpaddr : '127.0.0.1');
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
        //sendConsoleText("Tunnel #" + this.httprequest.index + " closed.", this.httprequest.sessionid);
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
    function onTunnelSendOk() { /*sendConsoleText("Tunnel #" + this.index + " SendOK.", this.sessionid);*/ }
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
            if (data == 'c') { this.httprequest.state = 1; /*sendConsoleText("Tunnel #" + this.httprequest.index + " now active", this.httprequest.sessionid);*/ }
        } else {
            // Handle tunnel data
            if (this.httprequest.protocol == 0) { // 1 = Terminal, 2 = Desktop, 5 = Files
                // Take a look at the protocol
                this.httprequest.protocol = parseInt(data);
                if (typeof this.httprequest.protocol != 'number') { this.httprequest.protocol = 0; }
                if (this.httprequest.protocol == 1) {
                    // Check user access rights for terminal
                    if (((this.httprequest.rights & MESHRIGHT_REMOTECONTROL) == 0) || ((this.httprequest.rights != 0xFFFFFFFF) && ((this.httprequest.rights & MESHRIGHT_NOTERMINAL) != 0))) {
                        // Disengage this tunnel, user does not have the rights to do this!!
                        this.httprequest.protocol = 999999;
                        this.httprequest.s.end();
                        sendConsoleText('Error: No Terminal Control Rights.');
                        return;
                    }

                   
                    this.end = function () {
                        if (process.platform == "win32") {
                            // Unpipe the web socket
                            this.unpipe(this.httprequest._term);
                            this.httprequest._term.unpipe(this);

                            // Unpipe the WebRTC channel if needed (This will also be done when the WebRTC channel ends).
                            if (this.rtcchannel) {
                                this.rtcchannel.unpipe(this.httprequest._term);
                                this.httprequest._term.unpipe(this.rtcchannel);
                            }

                            // Clean up
                            this.httprequest._term.end();
                            this.httprequest._term = null;
                        } else {
                            // TODO!!
                        }
                    };

                    // Remote terminal using native pipes
                    if (process.platform == "win32") {
                        this.httprequest._term = require('win-terminal').Start(80, 25);
                        this.httprequest._term.pipe(this, { dataTypeSkip: 1 });
                        this.pipe(this.httprequest._term, { dataTypeSkip: 1, end: false });
                        this.prependListener('end', function () { this.httprequest._term.end(function () { console.log('Terminal was closed'); }); });
                    } else {
                        if (fs.existsSync("/bin/bash")) {
                            this.httprequest.process = childProcess.execFile("/bin/bash", ["bash", "-i"], { type: childProcess.SpawnTypes.TERM });
                            if (process.platform == 'linux') { this.httprequest.process.stdin.write("alias ls='ls --color=auto'\nclear\n"); }
                        } else {
                            this.httprequest.process = childProcess.execFile("/bin/sh", ["sh"], { type: childProcess.SpawnTypes.TERM });
                            if (process.platform == 'linux') { this.httprequest.process.stdin.write("stty erase ^H\nalias ls='ls --color=auto'\nPS1='\\u@\\h:\\w\\$ '\nclear\n"); }
                        }
                        this.httprequest.process.tunnel = this;
                        this.httprequest.process.on('exit', function (ecode, sig) { this.tunnel.end(); });
                        this.httprequest.process.stderr.on('data', function (chunk) { this.parent.tunnel.write(chunk); });
                        this.httprequest.process.stdout.pipe(this, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                        this.pipe(this.httprequest.process.stdin, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                        this.prependListener('end', function () { this.httprequest.process.kill(); });
                        this.httprequest.process.stdin.write("stty erase ^H\nalias ls='ls --color=auto'\nclear\n");
                    }

                    // Perform notification if needed. Toast messages may not be supported on all platforms.
                    if (this.httprequest.consent && (this.httprequest.consent & 16)) {
                        // User Consent Prompt is required

                        // Send a console message back using the console channel, "\n" is supported.
                        this.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: 'Waiting for user to grant access...' }));

                        var pr = require('message-box').create('MeshCentral', this.httprequest.username + ' requesting Terminal Access. Grant access?', 10);
                        pr.ws = this;
                        this.pause();

                        pr.then(
                            function () {
                                // Success!
                                this.ws.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: null }));
                                if (this.ws.httprequest.consent && (this.ws.httprequest.consent & 2)) {
                                    // User Notifications is required
                                    try { require('toaster').Toast('MeshCentral', this.ws.httprequest.username + ' started a remote terminal session.'); } catch (ex) { }
                                }

                                this.ws.resume();
                            },
                            function (e) {
                                // User Consent Denied/Failed!
                                this.ws.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: e.toString() }));
                                this.ws.end();
                            });
                    }
                    else {
                        // User Consent Prompt is not required
                        if (this.httprequest.consent && (this.httprequest.consent & 2)) {
                            // User Notifications is required
                            try { require('toaster').Toast('MeshCentral', this.httprequest.username + ' started a remote terminal session.'); } catch (ex) { }
                        }
                        this.resume();
                    }





                    this.removeAllListeners('data');
                    this.on('data', onTunnelControlData);
                    //this.write('MeshCore Terminal Hello');
                } else if (this.httprequest.protocol == 2)
                {
                    // Check user access rights for desktop
                    if (((this.httprequest.rights & MESHRIGHT_REMOTECONTROL) == 0) && ((this.httprequest.rights & MESHRIGHT_REMOTEVIEW) == 0)) {
                        // Disengage this tunnel, user does not have the rights to do this!!
                        this.httprequest.protocol = 999999;
                        this.httprequest.s.end();
                        sendConsoleText('Error: No Desktop Control Rights.');
                        return;
                    }


                    // Remote desktop using native pipes
                    this.httprequest.desktop = { state: 0, kvm: mesh.getRemoteDesktopStream(), tunnel: this };
                    this.httprequest.desktop.kvm.parent = this.httprequest.desktop;
                    this.desktop = this.httprequest.desktop;

                    this.end = function () {
                        --this.desktop.kvm.connectionCount;

                        // Unpipe the web socket
                        this.unpipe(this.httprequest.desktop.kvm);
                        this.httprequest.desktop.kvm.unpipe(this);

                        // Unpipe the WebRTC channel if needed (This will also be done when the WebRTC channel ends).
                        if (this.rtcchannel) {
                            this.rtcchannel.unpipe(this.httprequest.desktop.kvm);
                            this.httprequest.desktop.kvm.unpipe(this.rtcchannel);
                        }

                        if (this.desktop.kvm.connectionCount == 0) {
                            // Display a toast message. This may not be supported on all platforms.
                            // try { require('toaster').Toast('MeshCentral', 'Remote Desktop Control Ended.'); } catch (ex) { }
                            
                            this.httprequest.desktop.kvm.end();
                        }
                    };
                    if (this.httprequest.desktop.kvm.hasOwnProperty("connectionCount")) { this.httprequest.desktop.kvm.connectionCount++; } else { this.httprequest.desktop.kvm.connectionCount = 1; }

                    if ((this.httprequest.rights == 0xFFFFFFFF) || (((this.httprequest.rights & MESHRIGHT_REMOTECONTROL) != 0) && ((this.httprequest.rights & MESHRIGHT_REMOTEVIEW) == 0))) {
                        // If we have remote control rights, pipe the KVM input
                        this.pipe(this.httprequest.desktop.kvm, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text. Pipe the Browser --> KVM input.
                    } else {
                        // We need to only pipe non-mouse & non-keyboard inputs.
                        //sendConsoleText('Warning: No Remote Desktop Input Rights.');
                        // TODO!!!
                    }

                    // Perform notification if needed. Toast messages may not be supported on all platforms.
                    if (this.httprequest.consent && (this.httprequest.consent & 8))
                    {
                        // User Consent Prompt is required

                        // Send a console message back using the console channel, "\n" is supported.
                        this.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: 'Waiting for user to grant access...' }));

                        var pr = require('message-box').create('MeshCentral', this.httprequest.username + ' requesting KVM Access. Grant access?', 10);
                        pr.ws = this;
                        this.pause();

                        pr.then(
                            function ()
                            {
                                // Success!
                                this.ws.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: null }));
                                if (this.ws.httprequest.consent && (this.ws.httprequest.consent & 1))
                                {
                                    // User Notifications is required
                                    try { require('toaster').Toast('MeshCentral', this.ws.httprequest.username + ' started a remote desktop session.'); } catch (ex) { }
                                }

                                this.ws.httprequest.desktop.kvm.pipe(this.ws, { dataTypeSkip: 1 });
                                this.ws.resume();
                            },
                            function (e)
                            {
                                // User Consent Denied/Failed!
                                this.ws.end(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: e.toString() }));

                                //var err = 'User consent: ' + e.toString();
                                //var b = Buffer.alloc(5 + err.length);
                                //b.writeUInt16BE(MNG_ERROR, 0);
                                //b.writeUInt16BE(err.length + 4, 2);
                                //Buffer.from(err).copy(b, 4);
                                //this.ws.end(b);
                            });
                    }
                    else
                    {
                        // User Consent Prompt is not required
                        if (this.httprequest.consent && (this.httprequest.consent & 1))
                        {
                            // User Notifications is required
                            try { require('toaster').Toast('MeshCentral', this.httprequest.username + ' started a remote desktop session.'); } catch (ex) { }
                        }
                        this.httprequest.desktop.kvm.pipe(this, { dataTypeSkip: 1 });
                    }

                    this.removeAllListeners('data');
                    this.on('data', onTunnelControlData);
                    //this.write('MeshCore KVM Hello!1');

                } else if (this.httprequest.protocol == 5) {

                    // Check user access rights for files
                    if (((this.httprequest.rights & MESHRIGHT_REMOTECONTROL) == 0) || ((this.httprequest.rights != 0xFFFFFFFF) && ((this.httprequest.rights & MESHRIGHT_NOFILES) != 0))) {
                        // Disengage this tunnel, user does not have the rights to do this!!
                        this.httprequest.protocol = 999999;
                        this.httprequest.s.end();
                        sendConsoleText('Error: No files control rights.');
                        return;
                    }

                    // Perform notification if needed. Toast messages may not be supported on all platforms.
                    if (this.httprequest.consent && (this.httprequest.consent & 32))
                    {
                        // User Consent Prompt is required

                        // Send a console message back using the console channel, "\n" is supported.
                        this.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: 'Waiting for user to grant access...' }));

                        var pr = require('message-box').create('MeshCentral', this.httprequest.username + ' requesting remote file access. Grant access?', 10);
                        pr.ws = this;
                        this.pause();

                        pr.then(
                            function () {
                                // Success!
                                this.ws.write(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: null }));
                                if (this.ws.httprequest.consent && (this.ws.httprequest.consent & 4))
                                {
                                    // User Notifications is required
                                    try { require('toaster').Toast('MeshCentral', this.ws.httprequest.username + ' started a remote file session.'); } catch (ex) { }
                                }
                                this.ws.resume();
                            },
                            function (e) {
                                // User Consent Denied/Failed!
                                this.ws.end(JSON.stringify({ ctrlChannel: '102938', type: 'console', msg: e.toString() }));
                            });
                    }
                    else {
                        // User Consent Prompt is not required
                        if (this.httprequest.consent && (this.httprequest.consent & 4)) {
                            // User Notifications is required
                            try { require('toaster').Toast('MeshCentral', this.httprequest.username + ' started a remote file session.'); } catch (ex) { }
                        }
                        this.resume();
                    }

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
                        // Delete, possibly recursive delete
                        for (var i in cmd.delfiles) {
                            try { deleteFolderRecursive(obj.path.join(cmd.path, cmd.delfiles[i]), cmd.rec); } catch (e) { }
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
                    default:
                        // Unknown action, ignore it.
                        break;
                }
            }
            //sendConsoleText("Got tunnel #" + this.httprequest.index + " data: " + data, this.httprequest.sessionid);
        }
    }

    // Delete a directory with a files and directories within it
    function deleteFolderRecursive(path, rec) {
        if (fs.existsSync(path)) {
            if (rec == true) {
                fs.readdirSync(obj.path.join(path, '*')).forEach(function (file, index) {
                    var curPath = obj.path.join(path, file);
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
                default:
                    // Unknown action, ignore it.
                    break;
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
                if (process.platform == 'win32')
                {
                    ws.httprequest._term.unpipe(ws);
                }
                else
                {
                    ws.httprequest.process.stdout.unpipe(ws);
                    ws.httprequest.process.stderr.unpipe(ws);
                }
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
                if (process.platform == 'win32')
                {
                    ws.unpipe(ws.httprequest._term);
                    ws.rtcchannel.pipe(ws.httprequest._term, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                }
                else
                {
                    ws.unpipe(ws.httprequest.process.stdin);
                    ws.rtcchannel.pipe(ws.httprequest.process.stdin, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
                }
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
                if (process.platform == 'win32')
                {
                    ws.httprequest._term.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                }
                else
                {
                    ws.httprequest.process.stdout.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                    ws.httprequest.process.stderr.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1, end: false }); // 0 = Binary, 1 = Text.
                }
            } else if (ws.httprequest.protocol == 2) { // Desktop
                ws.httprequest.desktop.kvm.pipe(ws.webrtc.rtcchannel, { dataTypeSkip: 1 }); // 0 = Binary, 1 = Text.
            }
        } else if (obj.type == 'offer') {
            // This is a WebRTC offer.
            if (ws.httprequest.protocol == 1) return; // TODO: Terminal is currently broken with WebRTC. Reject WebRTC upgrade for now.
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
                this.websocket.rtcchannel.on('end', function () {
                    // The WebRTC channel closed, unpipe the KVM now. This is also done when the web socket closes.
                    //sendConsoleText('Tunnel #' + this.websocket.tunnel.index + ' WebRTC data channel closed');
                    if (this.websocket.desktop && this.websocket.desktop.kvm) {
                        this.unpipe(this.websocket.desktop.kvm);
                        this.websocket.httprequest.desktop.kvm.unpipe(this);
                    }
                });
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

    // Open a web browser to a specified URL on current user's desktop
    function openUserDesktopUrl(url) {
        var child = null;
        try {
            switch (process.platform) {
                case 'win32':
                    //child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ["/c", "start", url], { type: childProcess.SpawnTypes.USER, uid: require('user-sessions').Current().Active[0].SessionId });
                    child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ["/c", "start", url], { type: childProcess.SpawnTypes.USER });
                    break;
                case 'linux':
                    child = require('child_process').execFile('/usr/bin/xdg-open', ['xdg-open', url], { uid: require('user-sessions').consoleUid() });
                    break;
                case 'darwin':
                    child = require('child_process').execFile('/usr/bin/open', ['open', url], { uid: require('user-sessions').consoleUid() });
                    break;
                default:
                    // Unknown platform, ignore this command.
                    break;
            }
        } catch (ex) { }
        return child;
    }

    // Process a mesh agent console command
    function processConsoleCommand(cmd, args, rights, sessionid) {
        try {
            var response = null;
            switch (cmd) {
                case 'help': { // Displays available commands
                    response = 'Available commands: help, info, osinfo, args, print, type, dbget, dbset, dbcompact, eval, parseuri, httpget,\r\nwslist, wsconnect, wssend, wsclose, notify, ls, ps, kill, amt, netinfo, location, power, wakeonlan, scanwifi,\r\nscanamt, setdebug, smbios, rawsmbios, toast, lock, users, sendcaps, openurl, amtreset, amtccm, amtacm,\r\namtdeactivate, amtpolicy, getscript, getclip, setclip.';
                    break;
                }
                    /*
                case 'border':
                    {
                        if ((args['_'].length == 1) && (args['_'][0] == 'on')) {
                            if (meshCoreObj.users.length > 0) {
                                obj.borderManager.Start(meshCoreObj.users[0]);
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
                case 'getclip':
                    if (require('MeshAgent').isService) {
                        require('clipboard').dispatchRead().then(function (str) { sendConsoleText(str, sessionid); });
                    } else {
                        require("clipboard").read().then(function (str) { sendConsoleText(str, sessionid); });
                    }
                    break;
                case 'setclip': {
                    if (args['_'].length != 1) {
                        response = 'Proper usage: setclip "sample text"';
                    } else {
                        if (require('MeshAgent').isService) {
                            require('clipboard').dispatchWrite(args['_'][0]);
                            response = 'Setting clipboard to: "' + args['_'][0] + '"';
                        }
                        else {
                            require("clipboard")(args['_'][0]); response = 'Setting clipboard to: "' + args['_'][0] + '"';
                        }
                    }
                    break;
                }
                case 'amtreset': {
                    if (amt != null) { amt.reset(); response = 'Done.'; }
                    break;
                }
                case 'amtlmsreset': {
                    if (amt != null) { amt.lmsreset(); response = 'Done.'; }
                    break;
                }
                case 'amtccm': {
                    if (amt == null) { response = 'Intel AMT not supported.'; } else {
                        if (args['_'].length != 1) { response = 'Proper usage: amtccm (adminPassword)'; } // Display usage
                        else { amt.setPolicy({ type: 0 }); amt.activeToCCM(args['_'][0]); }
                    }
                    break;
                }
                case 'amtacm': {
                    if (amt == null) { response = 'Intel AMT not supported.'; } else {
                        amt.setPolicy({ type: 0 });
                        amt.getAmtInfo(function (meinfo) { amt.activeToACM(meinfo); });
                    }
                    break;
                }
                case 'amtdeactivate': {
                    if (amt == null) { response = 'Intel AMT not supported.'; } else { amt.setPolicy({ type: 0 }); amt.deactivateCCM(); }
                    break;
                }
                case 'amtpolicy': {
                    if (amtPolicy == null) {
                        response = 'No Intel(R) AMT policy.';
                    } else {
                        response = JSON.stringify(amtPolicy);
                    }
                    break;
                }
                case 'openurl': {
                    if (args['_'].length != 1) { response = 'Proper usage: openurl (url)'; } // Display usage
                    else { if (openUserDesktopUrl(args['_'][0]) == null) { response = 'Failed.'; } else { response = 'Success.'; } }
                    break;
                }
                case 'users': {
                    if (meshCoreObj.users == null) { response = 'Active users are unknown.'; } else { response = 'Active Users: ' + meshCoreObj.users.join(', ') + '.'; }
                    require('user-sessions').enumerateUsers().then(function (u) { for (var i in u) { sendConsoleText(u[i]); } });
                    break;
                }
                case 'toast': {
                    if (args['_'].length < 1) { response = 'Proper usage: toast "message"'; } else
                    {
                        require('toaster').Toast('MeshCentral', args['_'][0]).then(sendConsoleText, sendConsoleText);
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
                    if (SMBiosTables == null) { response = 'SMBios tables not available.'; } else { response = objToString(SMBiosTables, 0, ' ', true); }
                    break;
                }
                case 'rawsmbios': {
                    if (SMBiosTablesRaw == null) { response = 'SMBios tables not available.'; } else {
                        response = '';
                        for (var i in SMBiosTablesRaw) {
                            var header = false;
                            for (var j in SMBiosTablesRaw[i]) {
                                if (SMBiosTablesRaw[i][j].length > 0) {
                                    if (header == false) { response += ('Table type #' + i + ((require('smbios').smTableTypes[i] == null) ? '' : (', ' + require('smbios').smTableTypes[i]))) + '\r\n'; header = true; }
                                    response += ('  ' + SMBiosTablesRaw[i][j].toString('hex')) + '\r\n';
                                }
                            }
                        }
                    }
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
                    response = 'Current Core: ' + meshCoreObj.value + '.\r\nAgent Time: ' + Date() + '.\r\nUser Rights: 0x' + rights.toString(16) + '.\r\nPlatform: ' + process.platform + '.\r\nCapabilities: ' + meshCoreObj.caps + '.\r\nServer URL: ' + mesh.ServerUrl + '.';
                    if (amt != null) { response += '\r\nBuilt-in LMS: ' + ['Disabled', 'Connecting..', 'Connected'][amt.lmsstate] + '.'; }
                    if (meshCoreObj.osdesc) { response += '\r\nOS: ' + meshCoreObj.osdesc + '.'; }
                    response += '\r\nModules: ' + addedModules.join(', ') + '.';
                    response += '\r\nServer Connection: ' + mesh.isControlChannelConnected + ', State: ' + meshServerConnectionState + '.';
                    response += '\r\lastMeInfo: ' + lastMeInfo + '.';
                    var oldNodeId = db.Get('OldNodeId');
                    if (oldNodeId != null) { response += '\r\nOldNodeID: ' + oldNodeId + '.'; }
                    if (process.platform == 'linux' || process.platform == 'freebsd') { response += '\r\nX11 support: ' + require('monitor-info').kvm_x11_support + '.'; }
                    break;
                }
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
                case 'sendcaps': { // Send capability flags to the server
                    if (args['_'].length == 0) {
                        response = 'Proper usage: sendcaps (number)'; // Display correct command usage
                    } else {
                        meshCoreObj.caps = parseInt(args['_'][0]);
                        mesh.SendCommand(meshCoreObj);
                        response = JSON.stringify(meshCoreObj);
                    }
                    break;
                }
                case 'sendosdesc': { // Send OS description
                    if (args['_'].length > 0) {
                        meshCoreObj.osdesc = args['_'][0];
                        mesh.SendCommand(meshCoreObj);
                        response = JSON.stringify(meshCoreObj);
                    } else {
                        response = 'Proper usage: sendosdesc [os description]'; // Display correct command usage
                    }
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
                        var buf = Buffer.alloc(max), fd = fs.openSync(args['_'][0], "r"), r = fs.readSync(fd, buf, 0, max); // Read the file content
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
                            httprequest.on('error', function (e) { sendConsoleText('ERROR: ' + JSON.stringify(e)); });
                            
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
                    if (amt != null) {
                        amt.getAmtInfo(function (state) {
                            var resp = 'Intel AMT not detected.';
                            if (state != null) { resp = objToString(state, 0, ' ', true); }
                            sendConsoleText(resp, sessionid);
                        });
                    } else {
                        response = 'Intel AMT not detected.';
                    }
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
                case 'getscript': {
                    if (args['_'].length != 1) {
                        response = 'Proper usage: getscript [scriptNumber].';
                    } else {
                        mesh.SendCommand({ "action": "getScript", "type": args['_'][0] });
                    }
                    break;
                }
                case 'diagnostic':
                    {
                        if (!mesh.DAIPC.listening)
                        {
                            response = 'Unable to bind to Diagnostic IPC, most likely because the path (' + process.cwd() + ') is not on a local file system';
                            break;
                        }
                        var diag = diagnosticAgent_installCheck();
                        if (diag)
                        {
                            if (args['_'].length == 1 && args['_'][0] == 'uninstall')
                            {
                                diagnosticAgent_uninstall();
                                response = 'Diagnostic Agent uninstalled';
                            }
                            else
                            {
                                response = 'Diagnostic Agent installed at: ' + diag.appLocation();
                            }
                        }
                        else
                        {
                            if (args['_'].length == 1 && args['_'][0] == 'install')
                            {
                                diag = diagnosticAgent_installCheck(true);
                                if (diag)
                                {
                                    response = 'Diagnostic agent was installed at: ' + diag.appLocation();
                                }
                                else
                                {
                                    response = 'Diagnostic agent installation failed';
                                }
                            }
                            else
                            {
                                response = 'Diagnostic Agent Not installed. To install: diagnostic install';
                            }
                        }
                        if (diag) { diag.close(); diag = null; }
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

            // Update the server with basic info, logged in users and more.
            mesh.SendCommand(meshCoreObj);

            // Send SMBios tables if present
            if (SMBiosTablesRaw != null) { mesh.SendCommand({ "action": "smbios", "value": SMBiosTablesRaw }); }

            // Update the server on more advanced stuff, like Intel ME and Network Settings
            meInfoStr = null;
            sendPeriodicServerUpdate();
            //if (selfInfoUpdateTimer == null) { selfInfoUpdateTimer = setInterval(sendPeriodicServerUpdate, 1200000); } // 20 minutes
        }
    }
        
    // Update the server with the latest network interface information
    var sendNetworkUpdateNagleTimer = null;
    function sendNetworkUpdateNagle() { if (sendNetworkUpdateNagleTimer != null) { clearTimeout(sendNetworkUpdateNagleTimer); sendNetworkUpdateNagleTimer = null; } sendNetworkUpdateNagleTimer = setTimeout(sendNetworkUpdate, 5000); }
    function sendNetworkUpdate(force) {
        sendNetworkUpdateNagleTimer = null;
        
        // Update the network interfaces information data
        var netInfo = mesh.NetInfo;
        if (netInfo) {
            netInfo.action = 'netinfo';
            var netInfoStr = JSON.stringify(netInfo);
            if ((force == true) || (clearGatewayMac(netInfoStr) != clearGatewayMac(lastNetworkInfo))) { mesh.SendCommand(netInfo); lastNetworkInfo = netInfoStr; }
        }
    }
    
    // Called periodically to check if we need to send updates to the server
    function sendPeriodicServerUpdate(flags) {
        if (meshServerConnectionState == 0) return; // Not connected to server, do nothing.
        if (!flags) { flags = 0xFFFFFFFF; }

        if ((flags & 1) && (amt != null)) {
            // If we have a connected MEI, get Intel ME information
            amt.getAmtInfo(function (meinfo) {
                try {
                    if (meinfo == null) return;
                    var intelamt = {}, p = false;
                    if ((meinfo.Versions != null) && (meinfo.Versions.AMT != null)) { intelamt.ver = meinfo.Versions.AMT; p = true; }
                    if (meinfo.ProvisioningState != null) { intelamt.state = meinfo.ProvisioningState; p = true; }
                    if (meinfo.Flags != null) { intelamt.flags = meinfo.Flags; p = true; }
                    if (meinfo.OsHostname != null) { intelamt.host = meinfo.OsHostname; p = true; }
                    if (meinfo.UUID != null) { intelamt.uuid = meinfo.UUID; p = true; }
                    if ((meinfo.ProvisioningState == 0) && (meinfo.net0 != null) && (meinfo.net0.enabled == 1)) { // If not activated, look to see if we have wired net working.
                        // Not activated and we have wired ethernet, look for the trusted DNS
                        var dns = meinfo.DNS;
                        if (dns == null) {
                            // Trusted DNS not set, let's look for the OS network DNS suffix
                            var interfaces = require('os').networkInterfaces();
                            for (var i in interfaces) {
                                for (var j in interfaces[i]) {
                                    if ((interfaces[i][j].mac == mestate.net0.mac) && (interfaces[i][j].fqdn != null) && (interfaces[i][j].fqdn != '')) { dns = interfaces[i][j].fqdn; }
                                }
                            }
                        }
                        if (intelamt.dns != dns) { intelamt.dns = dns; p = true; }
                    } else { if (intelamt.dns != null) { delete intelamt.dns; p = true; } }
                    if (p == true) {
                        var meInfoStr = JSON.stringify(intelamt);
                        if (meInfoStr != lastMeInfo) {
                            meshCoreObj.intelamt = intelamt;
                            mesh.SendCommand(meshCoreObj);
                            lastMeInfo = meInfoStr;
                        }
                    }
                } catch (ex) { }
            });
        }

        if (flags & 2) {
            // Update network information
            sendNetworkUpdateNagle(false);
        }
    }
    

    // Starting function
    obj.start = function () {
        // Setup the mesh agent event handlers
        mesh.AddCommandHandler(handleServerCommand);
        mesh.AddConnectHandler(handleServerConnection);

        // Parse input arguments
        //var args = parseArgs(process.argv);
        //console.log(args);

        //resetMicroLms();

        // Setup logged in user monitoring (THIS IS BROKEN IN WIN7)
        try {
            var userSession = require('user-sessions');
            userSession.on('changed', function onUserSessionChanged() {
                userSession.enumerateUsers().then(function (users) {
                    var u = [], a = users.Active;
                    for (var i = 0; i < a.length; i++) {
                        var un = a[i].Domain ? (a[i].Domain + '\\' + a[i].Username) : (a[i].Username);
                        if (u.indexOf(un) == -1) { u.push(un); } // Only push users in the list once.
                    }
                    meshCoreObj.users = u;
                    mesh.SendCommand(meshCoreObj);
                });
            });
            userSession.emit('changed');
            //userSession.on('locked', function (user) { sendConsoleText('[' + (user.Domain ? user.Domain + '\\' : '') + user.Username + '] has LOCKED the desktop'); });
            //userSession.on('unlocked', function (user) { sendConsoleText('[' + (user.Domain ? user.Domain + '\\' : '') + user.Username + '] has UNLOCKED the desktop'); });
        } catch (ex) { }
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

//
// Module startup
//

try {
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
} catch (ex) {
    require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": "uncaughtException2: " + ex });
}