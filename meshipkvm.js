/**
* @description MeshCentral IP KVM Management Module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2021
* @license Apache-2.0
* @version v0.0.1
*/

function CreateIPKVMManager(parent) {
    const obj = {};
    obj.parent = parent;
    obj.managedGroups = {} // meshid --> Manager
    obj.managedPorts = {} // nodeid --> PortInfo

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 0x00000001; // 1
    const MESHRIGHT_MANAGEUSERS = 0x00000002; // 2
    const MESHRIGHT_MANAGECOMPUTERS = 0x00000004; // 4
    const MESHRIGHT_REMOTECONTROL = 0x00000008; // 8
    const MESHRIGHT_AGENTCONSOLE = 0x00000010; // 16
    const MESHRIGHT_SERVERFILES = 0x00000020; // 32
    const MESHRIGHT_WAKEDEVICE = 0x00000040; // 64
    const MESHRIGHT_SETNOTES = 0x00000080; // 128
    const MESHRIGHT_REMOTEVIEWONLY = 0x00000100; // 256
    const MESHRIGHT_NOTERMINAL = 0x00000200; // 512
    const MESHRIGHT_NOFILES = 0x00000400; // 1024
    const MESHRIGHT_NOAMT = 0x00000800; // 2048
    const MESHRIGHT_DESKLIMITEDINPUT = 0x00001000; // 4096
    const MESHRIGHT_LIMITEVENTS = 0x00002000; // 8192
    const MESHRIGHT_CHATNOTIFY = 0x00004000; // 16384
    const MESHRIGHT_UNINSTALL = 0x00008000; // 32768
    const MESHRIGHT_NODESKTOP = 0x00010000; // 65536
    const MESHRIGHT_REMOTECOMMAND = 0x00020000; // 131072
    const MESHRIGHT_RESETOFF = 0x00040000; // 262144
    const MESHRIGHT_GUESTSHARING = 0x00080000; // 524288
    const MESHRIGHT_DEVICEDETAILS = 0x00100000; // ?1048576?
    const MESHRIGHT_ADMIN = 0xFFFFFFFF;

    // Subscribe for mesh creation events
    parent.AddEventDispatch(['server-createmesh', 'server-deletemesh'], obj);
    obj.HandleEvent = function (source, event, ids, id) {
        if ((event != null) && (event.action == 'createmesh') && (event.mtype == 4)) {
            // Start managing this new device group
            startManagement(parent.webserver.meshes[event.meshid]);
        } else if ((event != null) && (event.action == 'deletemesh') && (event.mtype == 4)) {
            // Stop managing this device group
            stopManagement(event.meshid);
        }
    }
    
    // Run thru the list of device groups that require 
    for (var i in parent.webserver.meshes) {
        const mesh = parent.webserver.meshes[i];
        if ((mesh.mtype == 4) && (mesh.deleted == null)) { startManagement(mesh); }
    }
    
    // Start managing a IP KVM device
    function startManagement(mesh) {
        if ((mesh == null) || (mesh.mtype != 4) || (mesh.kvm == null) || (mesh.deleted != null) || (obj.managedGroups[mesh._id] != null)) return;
        var port = 443, hostSplit = mesh.kvm.host.split(':'), host = hostSplit[0];
        if (hostSplit.length == 2) { port = parseInt(hostSplit[1]); }
        if (mesh.kvm.model == 1) { // Raritan KX III
            const manager = CreateRaritanKX3Manager(obj, host, port, mesh.kvm.user, mesh.kvm.pass);
            manager.meshid = mesh._id;
            manager.domainid = mesh._id.split('/')[1];
            obj.managedGroups[mesh._id] = manager;
            manager.onStateChanged = onStateChanged;
            manager.onPortsChanged = onPortsChanged;
            manager.start();
        }
    }
    
    // Stop managing a IP KVM device
    function stopManagement(meshid) {
        const manager = obj.managedGroups[meshid];
        if (manager != null) {
            // Remove all managed ports
            for (var i = 0; i < manager.ports.length; i++) {
                const port = manager.ports[i];
                const nodeid = generateIpKvmNodeId(manager.meshid, port.PortId, manager.domainid);
                delete obj.managedPorts[nodeid]; // Remove the managed port
            }

            // Remove the manager
            delete obj.managedGroups[meshid];
            manager.stop();
        }
    }
    
    // Called when a KVM device changes state
    function onStateChanged(sender, state) {
        /*
        console.log('State: ' + ['Disconnected', 'Connecting', 'Connected'][state]);
        if (state == 2) {
            console.log('DeviceModel:', sender.deviceModel);
            console.log('FirmwareVersion:', sender.firmwareVersion);
        }
        */
    }
    
    // Called when a KVM device changes state
    function onPortsChanged(sender, updatedPorts) {
        for (var i = 0; i < updatedPorts.length; i++) {
            const port = sender.ports[updatedPorts[i]];
            const nodeid = generateIpKvmNodeId(sender.meshid, port.PortId, sender.domainid);
            if ((port.Status == 1) && (port.Class == 'KVM')) {
                //console.log(port.PortNumber + ', ' + port.PortId + ', ' + port.Name + ', ' + port.Type + ', ' + ((port.StatAvailable == 0) ? 'Idle' : 'Connected'));
                if ((obj.managedPorts[nodeid] == null) || (obj.managedPorts[nodeid].name != port.Name)) {
                    parent.db.Get(nodeid, function (err, nodes) {
                        if ((err != null) || (nodes == null)) return;
                        const mesh = parent.webserver.meshes[sender.meshid];
                        if (nodes.length == 0) {
                            // The device does not exist, create it
                            const device = { type: 'node', mtype: 4, _id: nodeid, icon: 1, meshid: sender.meshid, name: port.Name, rname: port.Name, domain: sender.domainid, porttype: port.Type, portid: port.PortId, portnum: port.PortNumber };
                            parent.db.Set(device);

                            // Event the new node
                            parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(sender.meshid, [nodeid]), obj, { etype: 'node', action: 'addnode', nodeid: nodeid, node: device, msgid: 57, msgArgs: [port.Name, mesh.name], msg: ('Added device ' + port.Name + ' to device group ' + mesh.name), domain: sender.domainid });
                        } else {
                            // The device exists, update it
                            var changed = false;
                            const device = nodes[0];
                            if (device.rname != port.Name) { device.rname = port.Name; changed = true; } // Update the device port name
                            if ((mesh.flags) && (mesh.flags & 2) && (device.name != port.Name)) { device.name = port.Name; changed = true; } // Sync device name to port name
                            if (changed) {
                                // Update the database and event the node change
                                parent.db.Set(device);
                                parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(sender.meshid, [nodeid]), obj, { etype: 'node', action: 'changenode', nodeid: nodeid, node: device, domain: sender.domainid, nolog: 1 });
                            }
                        }

                        // Set the connectivity state if needed
                        if (obj.managedPorts[nodeid] == null) {
                            parent.SetConnectivityState(sender.meshid, nodeid, Date.now(), 1, 1, null, null);
                            obj.managedPorts[nodeid] = { name: port.Name, meshid: sender.meshid, portid: port.PortId, portType: port.PortType, portNo: port.PortIndex };
                        }

                        // Update busy state
                        const portInfo = obj.managedPorts[nodeid];
                        if ((portInfo.sessions != null) != (port.StatAvailable != 0)) {
                            if (port.StatAvailable != 0) { portInfo.sessions = { kvm: { 'busy': 1 } } } else { delete portInfo.sessions; }

                            // Event the new sessions, this will notify everyone that agent sessions have changed
                            var event = { etype: 'node', action: 'devicesessions', nodeid: nodeid, domain: sender.domainid, sessions: portInfo.sessions, nolog: 1 };
                            parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(sender.meshid, [nodeid]), obj, event);
                        }
                    });
                } else {
                    // Update busy state
                    const portInfo = obj.managedPorts[nodeid];
                    if ((portInfo.sessions != null) != (port.StatAvailable != 0)) {
                        if (port.StatAvailable != 0) { portInfo.sessions = { kvm: { 'busy': 1 } } } else { delete portInfo.sessions; }

                        // Event the new sessions, this will notify everyone that agent sessions have changed
                        var event = { etype: 'node', action: 'devicesessions', nodeid: nodeid, domain: sender.domainid, sessions: portInfo.sessions, nolog: 1 };
                        parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(sender.meshid, [nodeid]), obj, event);
                    }
                }
            } else {
                if (obj.managedPorts[nodeid] != null) {
                    // This port is no longer connected
                    parent.ClearConnectivityState(sender.meshid, nodeid, 1, null, null);

                    // If the device group policy is set to auto-remove devices, remove it now
                    if ((mesh.flags) && (mesh.flags & 1)) {                       // Auto-remove devices
                        parent.db.Remove(nodeid);                                 // Remove node with that id
                        parent.db.Remove('nt' + nodeid);                          // Remove notes
                        parent.db.Remove('lc' + nodeid);                          // Remove last connect time
                        parent.db.Remove('al' + nodeid);                          // Remove error log last time
                        parent.db.RemoveAllNodeEvents(nodeid);                    // Remove all events for this node
                        parent.db.removeAllPowerEventsForNode(nodeid);            // Remove all power events for this node

                        // Event node deletion
                        parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(sender.meshid, [nodeid]), obj, { etype: 'node', action: 'removenode', nodeid: nodeid, domain: domain.id, nolog: 1 });
                    }

                    // Remove the managed port
                    delete obj.managedPorts[nodeid];
                }
            }
        }
    }

    // Generate the nodeid from the device group and device identifier
    function generateIpKvmNodeId(meshid, portid, domainid) {
        return 'node/' + domainid + '/' + parent.crypto.createHash('sha384').update(Buffer.from(meshid + '/' + portid)).digest().toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    }

    // Parse an incoming HTTP request URL
    function parseIpKvmUrl(domain, url) {
        const q = require('url').parse(url, true);
        const i = q.path.indexOf('/ipkvm.ashx/');
        if (i == -1) return null;
        const urlargs = q.path.substring(i + 12).split('/');
        if (urlargs[0].length != 64) return null;
        const nodeid = 'node/' + domain.id + '/' + urlargs[0];
        const nid = urlargs[0];
        const kvmport = obj.managedPorts[nodeid];
        if (kvmport == null) return null;
        const kvmmanager = obj.managedGroups[kvmport.meshid];
        if (kvmmanager == null) return null;
        urlargs.shift();
        var relurl = '/' + urlargs.join('/')
        if (relurl.endsWith('/.websocket')) { relurl = relurl.substring(0, relurl.length - 11); }
        return { relurl: relurl, preurl: q.path.substring(0, i + 76), nodeid: nodeid, nid: nid, kvmmanager: kvmmanager, kvmport: kvmport };
    }

    // Handle a IP-KVM HTTP get request
    obj.handleIpKvmGet = function (domain, req, res, next) {
        // Parse the URL and get information about this KVM port
        const reqinfo = parseIpKvmUrl(domain, req.url);
        if (reqinfo == null) { next(); return; }

        // Check node rights
        if ((req.session == null) || (req.session.userid == null)) { next(); return; }
        const user = parent.webserver.users[req.session.userid];
        if (user == null) { next(); return; }
        const rights = parent.webserver.GetNodeRights(user, reqinfo.kvmmanager.meshid, reqinfo.nodeid);
        if ((rights & MESHRIGHT_REMOTECONTROL) == 0) { next(); return; }

        // Process the request
        reqinfo.kvmmanager.handleIpKvmGet(domain, reqinfo, req, res, next);
    }

    // Handle a IP-KVM HTTP websocket request
    obj.handleIpKvmWebSocket = function (domain, ws, req) {
        // Parse the URL and get information about this KVM port
        const reqinfo = parseIpKvmUrl(domain, req.url);
        if (reqinfo == null) { try { ws.close(); } catch (ex) { } return; }

        // Check node rights
        if ((req.session == null) || (req.session.userid == null)) { try { ws.close(); } catch (ex) { } return; }
        const user = parent.webserver.users[req.session.userid];
        if (user == null) { try { ws.close(); } catch (ex) { } return; }
        const rights = parent.webserver.GetNodeRights(user, reqinfo.kvmmanager.meshid, reqinfo.nodeid);
        if ((rights & MESHRIGHT_REMOTECONTROL) == 0) { try { ws.close(); } catch (ex) { } return; }

        // Process the request
        reqinfo.kvmmanager.handleIpKvmWebSocket(domain, reqinfo, ws, req);
    }

    return obj;
}

function CreateRaritanKX3Manager(parent, hostname, port, username, password) {
    const https = require('https');
    const obj = {};
    var updateTimer = null;
    var retryTimer = null;

    obj.authCookie = null;
    obj.state = 0; // 0 = Disconnected, 1 = Connecting, 2 = Connected
    obj.ports = [];
    obj.portCount = 0;
    obj.portHash = null;
    obj.deviceCount = 0;
    obj.deviceHash = null;
    obj.started = false;

    // Events
    obj.onStateChanged = null;
    obj.onPortsChanged = null;

    function onCheckServerIdentity(cert) {
        console.log('TODO: Certificate Check');
    }

    obj.start = function () {
        if (obj.started) return;
        obj.started = true;
        if (obj.state == 0) connect();
    }

    obj.stop = function () {
        if (!obj.started) return;
        obj.started = false;
        if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
        setState(0);
    }

    function setState(newState) {
        if (obj.state == newState) return;
        obj.state = newState;
        if (obj.onStateChanged != null) { obj.onStateChanged(obj, newState); }
        if ((newState == 2) && (updateTimer == null)) { updateTimer = setInterval(obj.update, 10000); }
        if ((newState != 2) && (updateTimer != null)) { clearInterval(updateTimer); updateTimer = null; }
        if ((newState == 0) && (obj.started == true) && (retryTimer == null)) { retryTimer = setTimeout(connect, 20000); }
    }

    function connect() {
        if (obj.state != 0) return;
        setState(1); // 1 = Connecting
        obj.authCookie = null;
        if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
        const data = new TextEncoder().encode('is_dotnet=0&is_javafree=0&is_standalone_client=0&is_javascript_kvm_client=1&is_javascript_rsc_client=1&login=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + '&action_login=Login');
        const options = {
            hostname: hostname,
            port: port,
            rejectUnauthorized: false,
            checkServerIdentity: onCheckServerIdentity,
            path: '/auth.asp?client=javascript', // ?client=standalone
            method: 'POST',
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Content-Length': data.length
            }
        }
        const req = https.request(options, function (res) {
            if (obj.state == 0) return;
            if ((res.statusCode != 302) || (res.headers['set-cookie'] == null) || (res.headers['location'] == null)) { setState(0); return; }
            for (var i in res.headers['set-cookie']) { if (res.headers['set-cookie'][i].startsWith('pp_session_id=')) { obj.authCookie = res.headers['set-cookie'][i].substring(14).split(';')[0]; } }
            if (obj.authCookie == null) { setState(0); return; }
            res.on('data', function (d) { })
            fetchInitialInformation();
        })
        req.on('error', function (error) { setState(0); })
        req.write(data);
        req.end();
    }

    function checkCookie() {
        if (obj.state != 2) return;
        const options = {
            hostname: hostname,
            port: port,
            rejectUnauthorized: false,
            checkServerIdentity: onCheckServerIdentity,
            path: '/cookiecheck.asp',
            method: 'GET',
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cookie': 'pp_session_id=' + obj.authCookie
            }
        }
        const req = https.request(options, function (res) {
            if (obj.state == 0) return;
            if (res.statusCode != 302) { setState(0); return; }
            if (res.headers['set-cookie'] != null) { for (var i in res.headers['set-cookie']) { if (res.headers['set-cookie'][i].startsWith('pp_session_id=')) { obj.authCookie = res.headers['set-cookie'][i].substring(14).split(';')[0]; } } }
            res.on('data', function (d) { })
        });
        req.on('error', function (error) { setState(0); })
        req.end();
    }

    function fetchInitialInformation() {
        obj.fetch('/webs_cron.asp?_portsstatushash=&_devicesstatushash=&webs_job=sidebarupdates', null, null, function (server, tag, data) {
            const parsed = parseJsScript(data);
            for (var i in parsed['updateSidebarPanel']) {
                if (parsed['updateSidebarPanel'][i][0] == "cron_device") {
                    obj.firmwareVersion = getSubString(parsed['updateSidebarPanel'][i][1], "Firmware:  ", "<");
                    obj.deviceModel = getSubString(parsed['updateSidebarPanel'][i][1], "<div class=\"device-model\">", "<");
                }
            }
            obj.fetch('/sidebar.asp', null, null, function (server, tag, data) {
                data = data.toString();
                var dataBlock = getSubString(data, "updateKVMLinkHintOnContainer();", "devices.resetDevicesNew(1);");
                if (dataBlock == null) { setState(0); return; }
                const parsed = parseJsScript(dataBlock);
                obj.portCount = parseInt(parsed['updatePortStatus'][0][0]) - 2;
                obj.portHash = parsed['updatePortStatus'][0][1];
                obj.deviceCount = parseInt(parsed['updateDeviceStatus'][0][0]);
                obj.deviceHash = parsed['updateDeviceStatus'][0][1];
                var updatedPorts = [];
                for (var i = 0; i < parsed['addPortNew'].length; i++) {
                    const portInfo = parsePortInfo(parsed['addPortNew'][i]);
                    obj.ports[portInfo.hIndex] = portInfo;
                    updatedPorts.push(portInfo.hIndex);
                }
                setState(2);
                if (obj.onPortsChanged != null) { obj.onPortsChanged(obj, updatedPorts); }
            });
        });
    }

    obj.update = function () {
        obj.fetch('/webs_cron.asp?_portsstatushash=' + obj.portHash + '&_devicesstatushash=' + obj.deviceHash, null, null, function (server, tag, data) {
            data = data.toString();
            const parsed = parseJsScript(data);
            if (parsed['updatePortStatus']) {
                obj.portCount = parseInt(parsed['updatePortStatus'][0][0]) - 2;
                obj.portHash = parsed['updatePortStatus'][0][1];
            }
            if (parsed['updateDeviceStatus']) {
                obj.deviceCount = parseInt(parsed['updateDeviceStatus'][0][0]);
                obj.deviceHash = parsed['updateDeviceStatus'][0][1];
            }
            if (parsed['updatePort']) {
                var updatedPorts = [];
                for (var i = 0; i < parsed['updatePort'].length; i++) {
                    const portInfo = parsePortInfo(parsed['updatePort'][i]);
                    obj.ports[portInfo.hIndex] = portInfo;
                    updatedPorts.push(portInfo.hIndex);
                }
                if ((updatedPorts.length > 0) && (obj.onPortsChanged != null)) { obj.onPortsChanged(obj, updatedPorts); }
            }
        });
    }

    function parsePortInfo(args) {
        var out = {};
        for (var i = 0; i < args.length; i++) {
            var parsed = parseJsScript(args[i]);
            var v = parsed.J[0][1], vv = parseInt(v);
            out[parsed.J[0][0]] = (v == vv)?vv:v;
        }
        return out;
    }

    function getSubString(str, start, end) {
        var i = str.indexOf(start);
        if (i < 0) return null;
        str = str.substring(i + start.length);
        i = str.indexOf(end);
        if (i >= 0) { str = str.substring(0, i); }
        return str;
    }

    // Parse JavaScript code calls
    function parseJsScript(str) {
        const out = {};
        var functionName = '';
        var args = [];
        var arg = null;
        var stack = [];
        for (var i = 0; i < str.length; i++) {
            if (stack.length == 0) {
                if (str[i] != '(') {
                    if (isAlphaNumeric(str[i])) { functionName += str[i]; } else { functionName = ''; }
                } else {
                    stack.push(')');
                }
            } else {
                if (str[i] == stack[stack.length - 1]) {
                    if (stack.length > 1) { if (arg == null) { arg = str[i]; } else { arg += str[i]; } }
                    if (stack.length == 2) {
                        if (arg != null) { args.push(trimQuotes(arg)); }
                        arg = null;
                    } else if (stack.length == 1) {
                        if (arg != null) { args.push(trimQuotes(arg)); arg = null; }
                        if (args.length > 0) {
                            if (out[functionName] == null) {
                                out[functionName] = [args];
                            } else {
                                out[functionName].push(args);
                            }
                        }
                        args = [];
                    }
                    stack.pop();
                } else if ((str[i] == '\'') || (str[i] == '"') || (str[i] == '(')) {
                    if (str[i] == '(') { stack.push(')'); } else { stack.push(str[i]); }
                    if (stack.length > 0) {
                        if (arg == null) { arg = str[i]; } else { arg += str[i]; }
                    }
                } else {
                    if ((stack.length == 1) && (str[i] == ',')) {
                        if (arg != null) { args.push(trimQuotes(arg)); arg = null; }
                    } else {
                        if (stack.length > 0) { if (arg == null) { arg = str[i]; } else { arg += str[i]; } }
                    }
                }
            }
        }
        return out;
    }

    function trimQuotes(str) {
        if ((str == null) || (str.length < 2)) return str;
        str = str.trim();
        if ((str[0] == '\'') && (str[str.length - 1] == '\'')) { return str.substring(1, str.length - 1); }
        if ((str[0] == '"') && (str[str.length - 1] == '"')) { return str.substring(1, str.length - 1); }
        return str;
    }

    function isAlphaNumeric(char) {
        return ((char >= 'A') && (char <= 'Z')) || ((char >= 'a') && (char <= 'z')) || ((char >= '0') && (char <= '9'));
    }

    obj.fetch = function(url, postdata, tag, func) {
        if (obj.state == 0) return;

        var data = [];
        const options = {
            hostname: hostname,
            port: port,
            rejectUnauthorized: false,
            checkServerIdentity: onCheckServerIdentity,
            path: url,
            method: (postdata != null)?'POST':'GET',
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cookie': 'pp_session_id=' + obj.authCookie
            }
        }
        const req = https.request(options, function (res) {
            if (obj.state == 0) return;
            if (res.statusCode != 200) { setState(0); return; }
            if (res.headers['set-cookie'] != null) { for (var i in res.headers['set-cookie']) { if (res.headers['set-cookie'][i].startsWith('pp_session_id=')) { obj.authCookie = res.headers['set-cookie'][i].substring(14).split(';')[0]; } } }
            res.on('data', function (d) { data.push(d); });
            res.on('end', function () {
                // This line is used for debugging only, used to swap a file.
                //if (url.endsWith('js_kvm_client.1604062083669.min.js')) { data = [ parent.parent.fs.readFileSync('c:\\tmp\\js_kvm_client.1604062083669.min.js') ] ; }
                func(obj, tag, Buffer.concat(data), res);
            });
        });
        req.on('error', function (error) { console.log(error); setState(0); })
        req.end();
    }

    // Handle a IP-KVM HTTP get request
    obj.handleIpKvmGet = function (domain, reqinfo, req, res, next) {
        if (reqinfo.relurl == '/') { res.redirect(reqinfo.preurl + '/jsclient/Client.asp'); return; }

        // Example: /jsclient/Client.asp#portId=P_000d5d20f64c_1
        obj.fetch(reqinfo.relurl, null, [res, reqinfo], function (server, args, data, rres) {
            const resx = args[0], xreqinfo = args[1];
            if (rres.headers['content-type']) { resx.set('content-type', rres.headers['content-type']); }
            if (xreqinfo.relurl.startsWith('/js/js_kvm_client.')) {
                data = data.toString();
                // Since our cookies can't be read from the html page for security, we embed the cookie right into the page.
                data = data.replace('module$js$helper$Extensions.Utils.getCookieValue("pp_session_id")', '"' + obj.authCookie + '"');
                // Add the connection information directly into the file.
                data = data.replace('\'use strict\';', '\'use strict\';sessionStorage.setItem("portPermission","CCC");sessionStorage.setItem("appId","1638838693725_3965868704642470");sessionStorage.setItem("portId","' + xreqinfo.kvmport.portid + '");sessionStorage.setItem("channelName","' + xreqinfo.kvmport.name + '");sessionStorage.setItem("portType","' + xreqinfo.kvmport.portType + '");sessionStorage.setItem("portNo","' + xreqinfo.kvmport.portNo + '");');
                // Replace the WebSocket code in one of the files to make it work with our server.
                data = data.replace('b=new WebSocket(e+"//"+c+"/"+g);', 'b=new WebSocket(e+"//"+c+"/ipkvm.ashx/' + xreqinfo.nid + '/"+g);');
            }
            resx.end(data);
        });
    }

    // Handle a IP-KVM HTTP websocket request
    obj.handleIpKvmWebSocket = function (domain, reqinfo, ws, req) {
        ws._socket.pause();
        //console.log('handleIpKvmWebSocket', reqinfo.preurl);

        if (reqinfo.kvmport.wsClient != null) {
            // Relay already open
            console.log('IPKVM Relay already present');
            try { ws.close(); } catch (ex) { }
        } else {
            // Setup a websocket-to-websocket relay
            try {
                const options = {
                    rejectUnauthorized: false,
                    servername: 'raritan', // We set this to remove the IP address warning from NodeJS.
                    headers: { Cookie: 'pp_session_id=' + obj.authCookie + '; view_length=32' }
                };
                parent.parent.debug('relay', 'IPKVM: Relay connecting to: wss://' + hostname + ':' + port + '/rfb');
                const WebSocket = require('ws');
                reqinfo.kvmport.wsClient = new WebSocket('wss://' + hostname + ':' + port + '/rfb', options);
                reqinfo.kvmport.wsClient.wsBrowser = ws;
                ws.wsClient = reqinfo.kvmport.wsClient;
                reqinfo.kvmport.wsClient.kvmport = reqinfo.kvmport;

                reqinfo.kvmport.wsClient.on('open', function () {
                    parent.parent.debug('relay', 'IPKVM: Relay websocket open');
                    this.wsBrowser.on('message', function (data) {
                        //console.log('KVM browser data', data, data.toString());
                        this._socket.pause();
                        this.wsClient.send(data);
                        this._socket.resume();
                    });
                    this.wsBrowser.on('close', function () {
                        parent.parent.debug('relay', 'IPKVM: Relay browser websocket closed');

                        // Clean up
                        if (this.wsClient) {
                            try { this.wsClient.close(); } catch (ex) { }
                            if (this.wsClient.kvmport) { delete this.wsClient.kvmport.wsClient; delete this.wsClient.kvmport; }
                            delete this.wsClient.wsBrowser; delete this.wsClient;
                        }
                    });
                    this.wsBrowser.on('error', function (err) {
                        parent.parent.debug('relay', 'IPKVM: Relay browser websocket error: ' + err);
                    });
                    this.wsBrowser._socket.resume();
                });
                reqinfo.kvmport.wsClient.on('message', function (data) { // Make sure to handle flow control.
                    //console.log('KVM switch data', data, data.toString());
                    this._socket.pause();
                    this.wsBrowser.send(data);
                    this._socket.resume();
                });
                reqinfo.kvmport.wsClient.on('close', function () {
                    parent.parent.debug('relay', 'IPKVM: Relay websocket closed');

                    // Clean up
                    if (this.wsBrowser) {
                        try { this.wsBrowser.close(); } catch (ex) { }
                        delete this.wsBrowser.wsClient; delete this.wsBrowser;
                    }
                    if (this.kvmport) { delete this.kvmport.wsClient; delete this.kvmport; }
                });
                reqinfo.kvmport.wsClient.on('error', function (err) {
                    parent.parent.debug('relay', 'IPKVM: Relay websocket error: ' + err);
                    
                });
            } catch (ex) { console.log(ex); }
        }
    }

    return obj;
}

module.exports.CreateIPKVMManager = CreateIPKVMManager;