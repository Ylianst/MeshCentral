/**
* @description MeshCentral IP KVM Management Module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2021
* @license Apache-2.0
* @version v0.0.1
*/

function CreateIPKVMManager(parent) {
    const obj = {};
    obj.managedGroups = {} // meshid --> Manager
    obj.managedPorts = {} // nodeid --> PortInfo
    
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
            const manager = CreateRaritanKX3Manager(host, port, mesh.kvm.user, mesh.kvm.pass);
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
                            obj.managedPorts[nodeid] = { name: port.Name, meshid: sender.meshid, portid: port.PortId };
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

    return obj;
}

function CreateRaritanKX3Manager(hostname, port, username, password) {
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
        var data = '';
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
            res.on('data', function (d) { data += d; });
            res.on('end', function () { func(obj, tag, data, res); });
        });
        req.on('error', function (error) { console.log(error); setState(0); })
        req.end();
    }

    return obj;
}

module.exports.CreateIPKVMManager = CreateIPKVMManager;