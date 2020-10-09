/**
* @description MeshCentral Intel AMT manager
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2020
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";


module.exports.CreateAmtManager = function(parent) {
    var obj = {};
    obj.parent = parent;
    obj.amtDevices = {};             // Nodeid --> dev
    obj.activeLocalConnections = {}; // Host --> dev
    obj.amtAdminAccounts = [];

    // WSMAN stack
    const CreateWsmanComm = require('./amt/amt-wsman-comm');
    const WsmanStackCreateService = require('./amt/amt-wsman');
    const AmtStackCreateService = require('./amt/amt');

    // Load the Intel AMT admin accounts
    if ((typeof parent.args.amtmanager == 'object') && (Array.isArray(parent.args.amtmanager.amtadminaccount) == true)) {
        for (var i in parent.args.amtmanager.amtadminaccount) {
            var c = parent.args.amtmanager.amtadminaccount[i], c2 = { user: 'admin' };
            if (typeof c.user == 'string') { c2.user = c.user; }
            if (typeof c.pass == 'string') { c2.pass = c.pass; obj.amtAdminAccounts.push(c2); }
        }
    }

    // Subscribe to server events
    parent.AddEventDispatch(['*'], obj);

    // Handle server events
    // TODO: Only manage devices with connections to this server. In a multi-server setup, we don't want multiple managers talking to the same device.
    obj.HandleEvent = function (source, event, ids, id) {
        // React to nodes connecting and disconnecting
        if (event.action == 'nodeconnect') {
            if ((event.conn & 14) != 0) { // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 4 = Intel AMT local, 8 = Intel AMT Relay, 16 = MQTT
                //if ((event.conn & 2) == 0) return // Debug: Only look at CIRA connections

                // We have an OOB connection to Intel AMT, update our information
                var dev = obj.amtDevices[event.nodeid];
                if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: event.conn }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = event.conn; }
            /*
            } else if (((event.conn & 1) != 0) && (parent.webserver != null)) {
                // We have an agent connection without OOB, check if this agent supports Intel AMT
                var agent = parent.webserver.wsagents[event.nodeid];
                if ((agent == null) || (agent.agentInfo == null) || (parent.meshAgentsArchitectureNumbers[agent.agentInfo.agentId].amt == false)) { removeDevice(event.nodeid); return; }
                var dev = obj.amtDevices[event.nodeid];
                if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: event.conn }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = event.conn; }
            */
            } else {
                removeDevice(event.nodeid);
            }
        }

        // React to node being removed
        if (event.action == 'removenode') { removeDevice(event.nodeid); }

        // React to node wakeup command, perform Intel AMT wake if possible
        if ((event.action == 'wakedevices') && (Array.isArray(event.nodeids))) {
            for (var i in event.nodeids) { performPowerAction(event.nodeids[i], 2); }
        }

        // React to changes in a node
        if (event.action == 'changenode') {
            if (event.amtchange === 1) {
                // A change occured in the Intel AMT credentials, we need to reset the connection
                removeDevice(event.nodeid);

                // Check if the agent is connected
                var constate = parent.GetConnectivityState(event.nodeid);
                if (constate == null) return; // No OOB connectivity, exit now.

                if ((constate & 14) != 0) { // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 4 = Intel AMT local, 8 = Intel AMT Relay, 16 = MQTT
                    // We have an OOB connection to Intel AMT, update our information
                    var dev = obj.amtDevices[event.nodeid];
                    if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: constate }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = constate; }
                } else if (((event.conn & 1) != 0) && (parent.webserver != null)) {
                    // We have an agent connection without OOB, check if this agent supports Intel AMT
                    var agent = parent.webserver.wsagents[event.nodeid];
                    if ((agent == null) || (agent.agentInfo == null) || (parent.meshAgentsArchitectureNumbers[agent.agentInfo.agentId].amt == false)) { removeDevice(event.nodeid); return; }
                    var dev = obj.amtDevices[event.nodeid];
                    if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: constate }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = constate; }
                }
            } else {
                var dev = obj.amtDevices[event.nodeid];
                if (dev != null) {
                    var amtchange = 0;
                    if (dev.name != event.node.name) { dev.name = event.node.name; }
                    if (dev.host != event.node.host) {
                        dev.host = event.node.host;
                        // The host has changed, if we are connected to this device locally, we need to reset.
                        if ((dev.conn & 4) != 0) { removeDevice(dev.nodeid); return; } // We are going to wait for the AMT scanned to find this device again.
                    }
                }
            }
        }
    }

    // Remove a device
    function removeDevice(nodeid) {
        const dev = obj.amtDevices[nodeid];
        if (dev == null) return;
        if (dev.amtstack != null) { dev.amtstack.wsman.comm.FailAllError = 999; delete dev.amtstack; } // Disconnect any active connections.
        if (dev.polltimer != null) { clearInterval(dev.polltimer); delete dev.polltimer; }
        delete obj.amtDevices[nodeid];
    }

    // Get the current power state of a device
    function fetchPowerState(dev) {
        dev = obj.amtDevices[dev.nodeid];
        if ((dev == null) || (dev.amtstack == null)) return;

        // Check if the agent is connected
        var constate = parent.GetConnectivityState(dev.nodeid);
        if ((constate == null) || (constate.connectivity & 1)) return; // If there is no connectivity or the agent is connected, skip trying to poll power state.

        // Fetch the power state
        dev.amtstack.BatchEnum(null, ['CIM_ServiceAvailableToElement'], function (stack, name, responses, status) {
            const dev = stack.dev;
            if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.

            if ((status != 200) || (responses['CIM_ServiceAvailableToElement'] == null) || (responses['CIM_ServiceAvailableToElement'].responses == null) || (responses['CIM_ServiceAvailableToElement'].responses.length < 1)) return; // If the polling fails, just skip it.
            var powerstate = responses['CIM_ServiceAvailableToElement'].responses[0].PowerState;
            if ((powerstate == 2) && (dev.aquired.majorver > 9)) {
                // Device is powered on and Intel AMT 10+, poll the OS power state.
                dev.amtstack.Get('IPS_PowerManagementService', function (stack, name, response, status) {
                    const dev = stack.dev;
                    if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.
                    if (status != 200) return;

                    // Convert the OS power state
                    var meshPowerState = -1;
                    if (response.Body.OSPowerSavingState == 2) { meshPowerState = 1; } // Fully powered (S0);
                    else if (response.Body.OSPowerSavingState == 3) { meshPowerState = 2; } // Modern standby (We are going to call this S1);

                    // Set OS power state
                    if (meshPowerState >= 0) { parent.SetConnectivityState(dev.meshid, dev.nodeid, Date.now(), 4, meshPowerState); }
                });
            } else {
                // Convert the power state
                // AMT power: 1 = Other, 2 = On, 3 = Sleep-Light, 4 = Sleep-Deep, 5 = Power Cycle (Off-Soft), 6 = Off-Hard, 7 = Hibernate (Off-Soft), 8 = Off-Soft, 9 = Power Cycle (Off-Hard), 10 = Master Bus Reset, 11 = Diagnostic Interrupt (NMI), 12 = Off-Soft Graceful, 13 = Off-Hard Graceful, 14 = Master Bus Reset Graceful, 15 = Power Cycle (Off- oft Graceful), 16 = Power Cycle (Off - Hard Graceful), 17 = Diagnostic Interrupt (INIT)
                // Mesh power: 0 = Unknown, 1 = S0 power on, 2 = S1 Sleep, 3 = S2 Sleep, 4 = S3 Sleep, 5 = S4 Hibernate, 6 = S5 Soft-Off, 7 = Present
                var meshPowerState = -1, powerConversionTable = [-1, -1, 1, 2, 3, 6, 6, 5, 6];
                if (powerstate < powerConversionTable.length) { meshPowerState = powerConversionTable[powerstate]; } else { powerstate = 6; }

                // Set power state
                if (meshPowerState >= 0) { parent.SetConnectivityState(dev.meshid, dev.nodeid, Date.now(), 4, meshPowerState); }
            }
        });
    }

    // Perform a power action: 2 = Power up, 5 = Power cycle, 8 = Power down, 10 = Reset
    function performPowerAction(nodeid, action) {
        var dev = obj.amtDevices[nodeid];
        if ((dev == null) || (dev.amtstack == null)) return;
        try { dev.amtstack.RequestPowerStateChange(action, performPowerActionResponse); } catch (ex) { }
    }

    // Response to Intel AMT power action
    function performPowerActionResponse(stack, name, responses, status) {
        //console.log('performPowerActionResponse', status);
    }

    // Update information about a device
    function fetchIntelAmtInformation(nodeid) {
        parent.db.Get(nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { removeDevice(nodeid); return; }
            const node = nodes[0];
            if ((node.intelamt == null) || (node.meshid == null)) { removeDevice(nodeid); return; }
            const mesh = parent.webserver.meshes[node.meshid];
            if (mesh == null) { removeDevice(nodeid); return; }
            const dev = obj.amtDevices[nodeid];
            if (dev == null) { return; }
            dev.name = node.name;
            dev.nodeid = node._id;
            if (node.host) { dev.host = node.host.toLowerCase(); }
            dev.meshid = node.meshid;
            dev.intelamt = node.intelamt;
            attemptInitialContact(nodeid, dev);
        });
    }

    // Attempt to perform initial contact with Intel AMT
    function attemptInitialContact(nodeid, dev) {
        if (dev == null) { dev = obj.amtDevices[nodeid]; }
        if (dev == null) return;

        if ((dev.acctry == null) && ((typeof dev.intelamt.user != 'string') || (typeof dev.intelamt.pass != 'string'))) {
            if (obj.amtAdminAccounts.length > 0) { dev.acctry = 0; } else { return; }
        }

        // Handle the case where the Intel AMT CIRA is connected (conn & 2)
        if ((dev.conn & 2) != 0) {
            // Check to see if CIRA is connected on this server.
            var ciraconn = parent.mpsserver.ciraConnections[dev.nodeid];
            if ((ciraconn == null) || (ciraconn.tag == null) || (ciraconn.tag.boundPorts == null)) { removeDevice(dev.nodeid); return; } // CIRA connection is not on this server, no need to deal with this device anymore.

            // See what user/pass to try.
            var user = null, pass = null;
            if (dev.acctry == null) { user = dev.intelamt.user; pass = dev.intelamt.pass; } else { user = obj.amtAdminAccounts[dev.acctry].user; pass = obj.amtAdminAccounts[dev.acctry].pass; }

            // See if we need to perform TLS or not. We prefer not to do TLS within CIRA.
            var dotls = -1;
            if (ciraconn.tag.boundPorts.indexOf('16992')) { dotls = 0; }
            else if (ciraconn.tag.boundPorts.indexOf('16993')) { dotls = 1; }
            if (dotls == -1) { removeDevice(dev.nodeid); return; } // The Intel AMT ports are not open, not a device we can deal with.

            // Connect now
            //console.log('CIRA-Connect', (dotls == 1)?"TLS":"NoTLS", dev.name, dev.host, user, pass);
            var comm;
            if (dotls == 1) {
                comm = CreateWsmanComm(dev.nodeid, 16993, user, pass, 1, null, parent.mpsserver); // Perform TLS
                comm.xtlsFingerprint = 0; // Perform no certificate checking
            } else {
                comm = CreateWsmanComm(dev.nodeid, 16992, user, pass, 0, null, parent.mpsserver); // No TLS
            }
            var wsstack = WsmanStackCreateService(comm);
            dev.amtstack = AmtStackCreateService(wsstack);
            dev.amtstack.dev = dev;
            obj.activeLocalConnections[dev.host] = dev;
            dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
            dev.conntype = 2; // CIRA

            return; // If CIRA is connected, don't try any other methods.
        }

        // Handle the case where the Intel AMT local scanner found the device (conn & 4)
        if (((dev.conn & 4) != 0) && (typeof dev.host == 'string')) {
            // Since we don't allow two or more connections to the same host, check if a pending connection is active.
            if (obj.activeLocalConnections[dev.host] != null) {
                // Active connection, hold and try later.
                setTimeout(function () { attemptInitialContact(nodeid); }, 5000);
            } else {
                // No active connections, see what user/pass to try.
                var user = null, pass = null;
                if (dev.acctry == null) { user = dev.intelamt.user; pass = dev.intelamt.pass; } else { user = obj.amtAdminAccounts[dev.acctry].user; pass = obj.amtAdminAccounts[dev.acctry].pass; }

                // Connect now
                var comm;
                if (dev.tlsfail !== true) {
                    //console.log('Connect', "TLS", dev.name, dev.host, user, pass);
                    comm = CreateWsmanComm(dev.host, 16993, user, pass, 1); // Always try with TLS first
                    comm.xtlsFingerprint = 0; // Perform no certificate checking
                } else {
                    //console.log('Connect', "NoTLS", dev.name, dev.host, user, pass);
                    comm = CreateWsmanComm(dev.host, 16992, user, pass, 0); // Try without TLS
                }
                var wsstack = WsmanStackCreateService(comm);
                dev.amtstack = AmtStackCreateService(wsstack);
                dev.amtstack.dev = dev;
                obj.activeLocalConnections[dev.host] = dev;
                dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
                dev.conntype = 1; // LOCAL
            }
        }
    }

    function attemptLocalConnectResponse(stack, name, responses, status) {
        //console.log('attemptLocalConnectResponse', status, stack.dev.name);

        // Release active connection to this host.
        delete obj.activeLocalConnections[stack.wsman.comm.host];

        // Check if the device still exists
        const dev = stack.dev;
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.

        // Check the response
        if ((status == 200) && (responses['AMT_GeneralSettings'] != null) && (responses['IPS_HostBasedSetupService'] != null) && (responses['IPS_HostBasedSetupService'].response != null) && (responses['IPS_HostBasedSetupService'].response != null) && (stack.wsman.comm.digestRealm == responses['AMT_GeneralSettings'].response.DigestRealm)) {
            // Everything looks good
            if (dev.aquired == null) { dev.aquired = {}; }
            dev.aquired.controlMode = responses['IPS_HostBasedSetupService'].response.CurrentControlMode; // 1 = CCM, 2 = ACM
            var verSplit = stack.wsman.comm.amtVersion.split('.');
            if (verSplit.length >= 3) { dev.aquired.version = verSplit[0] + '.' + verSplit[1] + '.' + verSplit[2]; dev.aquired.majorver = parseInt(verSplit[0]); }
            dev.aquired.realm = stack.wsman.comm.digestRealm;
            dev.aquired.user = stack.wsman.comm.user;
            dev.aquired.pass = stack.wsman.comm.pass;
            dev.aquired.lastContact = Date.now();
            if (dev.conntype == 1) { dev.aquired.tls = stack.wsman.comm.xtls; } // Only set the TLS state if on local mode. When using CIRA, this is auto-detected.
            if (stack.wsman.comm.xtls == 1) { dev.aquired.hash = stack.wsman.comm.xtlsCertificate.fingerprint.split(':').join('').toLowerCase(); } else { delete dev.aquired.hash; }
            //console.log(dev.nodeid, dev.name, dev.host, dev.aquired);
            UpdateDevice(dev);
            attemptFetchHardwareInventory(dev); // See if we need to get hardware inventory

            // Start power polling
            var ppfunc = function powerPoleFunction() { fetchPowerState(powerPoleFunction.dev); }
            ppfunc.dev = dev;
            dev.polltimer = new setTimeout(ppfunc, 290000); // Poll for power state every 4 minutes 50 seconds.
            fetchPowerState(dev);
        } else {
            // We got a bad response
            if ((dev.conntype == 1) && (dev.tlsfail !== true) && (status == 408)) {
                // TLS error on a local connection, try again without TLS
                dev.tlsfail = true; attemptInitialContact(dev.nodeid, dev); return;
            } else if (status == 401) {
                // Authentication error, see if we can use alternative credentials
                if ((dev.acctry == null) && (obj.amtAdminAccounts.length > 0)) { dev.acctry = 0; attemptInitialContact(dev.nodeid, dev); return; }
                if ((dev.acctry != null) && (obj.amtAdminAccounts.length > (dev.acctry + 1))) { dev.acctry++; attemptInitialContact(dev.nodeid, dev); return; }

                // We are unable to authenticate to this device, clear Intel AMT credentials.
                ClearDeviceCredentials(dev);
            }
            //console.log(dev.nodeid, dev.name, dev.host, status, 'Bad response');
            removeDevice(dev.nodeid);
        }
    }

    // Change the current core information string and event it
    function UpdateDevice(dev) {
        if (obj.amtDevices[dev.nodeid] == null) return false; // Device no longer exists, ignore this request.

        // Check that the mesh exists
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeDevice(dev.nodeid); return false; }

        // Get the node and change it if needed
        parent.db.Get(dev.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { return false; }
            const device = nodes[0];
            var changes = [], change = 0, log = 0;
            var domain = parent.config.domains[device.domain];
            if (domain == null) { return false; }

            // Check if anything changes
            if (device.intelamt == null) { device.intelamt = {}; }
            if (dev.aquired.version && (typeof dev.aquired.version == 'string') && (dev.aquired.version != device.intelamt.ver)) { change = 1; log = 1; device.intelamt.ver = dev.aquired.version; changes.push('AMT version'); }
            if (dev.aquired.user && (typeof dev.aquired.user == 'string') && (dev.aquired.user != device.intelamt.user)) { change = 1; log = 1; device.intelamt.user = dev.aquired.user; changes.push('AMT user'); }
            if (dev.aquired.pass && (typeof dev.aquired.pass == 'string') && (dev.aquired.pass != device.intelamt.pass)) { change = 1; log = 1; device.intelamt.pass = dev.aquired.pass; changes.push('AMT pass'); }
            if (dev.aquired.realm && (typeof dev.aquired.realm == 'string') && (dev.aquired.realm != device.intelamt.realm)) { change = 1; log = 1; device.intelamt.realm = dev.aquired.realm; changes.push('AMT realm'); }
            if (dev.aquired.hash && (typeof dev.aquired.hash == 'string') && (dev.aquired.hash != device.intelamt.hash)) { change = 1; log = 1; device.intelamt.hash = dev.aquired.hash; changes.push('AMT hash'); }
            if (device.intelamt.state != 2) { change = 1; log = 1; device.intelamt.state = 2; changes.push('AMT state'); }

            // Update Intel AMT flags if needed
            // dev.aquired.controlMode // 1 = CCM, 2 = ACM
            // (node.intelamt.flags & 2) == CCM, (node.intelamt.flags & 4) == ACM
            var flags = 0;
            if (typeof device.intelamt.flags == 'number') { flags = device.intelamt.flags; }
            if (dev.aquired.controlMode == 1) { if ((flags & 4) != 0) { flags -= 4; } if ((flags & 2) == 0) { flags += 2; } } // CCM
            if (dev.aquired.controlMode == 2) { if ((flags & 4) == 0) { flags += 4; } if ((flags & 2) != 0) { flags -= 2; } } // ACM
            if (device.intelamt.flags != flags) { change = 1; log = 1; device.intelamt.flags = flags; changes.push('AMT flags'); }

            // If there are changes, event the new device
            if (change == 1) {
                // Save to the database
                parent.db.Set(device);

                // Event the node change
                var event = { etype: 'node', action: 'changenode', nodeid: device._id, domain: domain.id, node: parent.webserver.CloneSafeNode(device) };
                if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                if ((log == 0) || ((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(device.meshid, [device._id]), obj, event);
            }

        });
    }

    // Change the current core information string and event it
    function ClearDeviceCredentials(dev) {
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this request.

        // Check that the mesh exists
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeDevice(dev.nodeid); return; }

        // Get the node and change it if needed
        parent.db.Get(dev.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) return;
            const device = nodes[0];
            var changes = [], change = 0, log = 0;
            var domain = parent.config.domains[device.domain];
            if (domain == null) return;

            // Check if anything changes
            if (device.intelamt == null) return;
            if (device.intelamt.user != null) { change = 1; log = 1; delete device.intelamt.user; changes.push('AMT user'); }
            if (device.intelamt.pass != null) { change = 1; log = 1; delete device.intelamt.pass; changes.push('AMT pass'); }

            // If there are changes, event the new device
            if (change == 1) {
                // Save to the database
                parent.db.Set(device);

                // Event the node change
                var event = { etype: 'node', action: 'changenode', nodeid: device._id, domain: domain.id, node: parent.webserver.CloneSafeNode(device) };
                if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                if ((log == 0) || ((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(device.meshid, [device._id]), obj, event);
            }
        });
    }

    function attemptFetchHardwareInventory(dev) {
        if (obj.amtDevices[dev.nodeid] == null) return false; // Device no longer exists, ignore this request.
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeDevice(dev.nodeid); return false; }
        if (mesh.mtype == 1) { // If this is a Intel AMT only device group, pull the hardware inventory and network information for this device
            dev.amtstack.BatchEnum('', ['*CIM_ComputerSystemPackage', 'CIM_SystemPackaging', '*CIM_Chassis', 'CIM_Chip', '*CIM_Card', '*CIM_BIOSElement', 'CIM_Processor', 'CIM_PhysicalMemory', 'CIM_MediaAccessDevice', 'CIM_PhysicalPackage'], attemptFetchHardwareInventoryResponse);
            dev.amtstack.BatchEnum('', ['AMT_EthernetPortSettings'], attemptFetchNetworkResponse);
            return true;
        }
        return false;
    }

    function attemptFetchNetworkResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.
        if (status != 200) return;

        //console.log(JSON.stringify(responses, null, 2));
        if ((responses['AMT_EthernetPortSettings'] == null) || (responses['AMT_EthernetPortSettings'].responses == null)) return;

        // Find the wired and wireless interfaces
        var wired = null, wireless = null;
        for (var i in responses['AMT_EthernetPortSettings'].responses) {
            var netif = responses['AMT_EthernetPortSettings'].responses[i];
            if ((netif.MACAddress != null) && (netif.MACAddress != '00-00-00-00-00-00')) {
                if (netif.WLANLinkProtectionLevel != null) { wireless = netif; } else { wired = netif; }
            }
        }
        if ((wired == null) && (wireless == null)) return;

        // Sent by the agent to update agent network interface information
        var net = { netif2: {} };

        if (wired != null) {
            var x = {};
            x.family = 'IPv4';
            x.type = 'ethernet';
            x.address = wired.IPAddress;
            x.netmask = wired.SubnetMask;
            x.mac = wired.MACAddress.split('-').join(':').toUpperCase();
            x.gateway = wired.DefaultGateway;
            net.netif2['Ethernet'] = [ x ];
        }

        if (wireless != null) {
            var x = {};
            x.family = 'IPv4';
            x.type = 'wireless';
            x.address = wireless.IPAddress;
            x.netmask = wireless.SubnetMask;
            x.mac = wireless.MACAddress.split('-').join(':').toUpperCase();
            x.gateway = wireless.DefaultGateway;
            net.netif2['Wireless'] = [ x ];
        }

        net.updateTime = Date.now();
        net._id = 'if' + dev.nodeid;
        net.type = 'ifinfo';
        parent.db.Set(net);

        // Event the node interface information change
        parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, { action: 'ifchange', nodeid: dev.nodeid, domain: dev.nodeid.split('/')[1], nolog: 1 });
    }


    /*
    // http://www.dmtf.org/sites/default/files/standards/documents/DSP0134_2.7.1.pdf
    const DMTFCPUStatus = ["Unknown", "Enabled", "Disabled by User", "Disabled By BIOS (POST Error)", "Idle", "Other"];
    const DMTFMemType = ["Unknown", "Other", "DRAM", "Synchronous DRAM", "Cache DRAM", "EDO", "EDRAM", "VRAM", "SRAM", "RAM", "ROM", "Flash", "EEPROM", "FEPROM", "EPROM", "CDRAM", "3DRAM", "SDRAM", "SGRAM", "RDRAM", "DDR", "DDR-2", "BRAM", "FB-DIMM", "DDR3", "FBD2", "DDR4", "LPDDR", "LPDDR2", "LPDDR3", "LPDDR4"];
    const DMTFMemFormFactor = ['', "Other", "Unknown", "SIMM", "SIP", "Chip", "DIP", "ZIP", "Proprietary Card", "DIMM", "TSOP", "Row of chips", "RIMM", "SODIMM", "SRIMM", "FB-DIM"];
    const DMTFProcFamilly = { // Page 46 of DMTF document
        191: "Intel&reg; Core&trade; 2 Duo Processor",
        192: "Intel&reg; Core&trade; 2 Solo processor",
        193: "Intel&reg; Core&trade; 2 Extreme processor",
        194: "Intel&reg; Core&trade; 2 Quad processor",
        195: "Intel&reg; Core&trade; 2 Extreme mobile processor",
        196: "Intel&reg; Core&trade; 2 Duo mobile processor",
        197: "Intel&reg; Core&trade; 2 Solo mobile processor",
        198: "Intel&reg; Core&trade; i7 processor",
        199: "Dual-Core Intel&reg; Celeron&reg; processor"
    };
    */

    function attemptFetchHardwareInventoryResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.
        if (status != 200) return;

        // Extract basic data
        var hw = {}
        hw.PlatformGUID = responses['CIM_ComputerSystemPackage'].response.PlatformGUID;
        hw.Chassis = responses['CIM_Chassis'].response;
        hw.Chips = responses['CIM_Chip'].responses;
        hw.Card = responses['CIM_Card'].response;
        hw.Bios = responses['CIM_BIOSElement'].response;
        hw.Processors = responses['CIM_Processor'].responses;
        hw.PhysicalMemory = responses['CIM_PhysicalMemory'].responses;
        hw.MediaAccessDevice = responses['CIM_MediaAccessDevice'].responses;
        hw.PhysicalPackage = responses['CIM_PhysicalPackage'].responses;

        // Convert the hardware data into the same structure as we get from Windows
        var hw2 = { hardware: { windows: {}, identifiers: {} } };
        hw2.hardware.identifiers.product_uuid = guidToStr(hw.PlatformGUID);
        if ((hw.PhysicalMemory != null) && (hw.PhysicalMemory.length > 0)) {
            var memory = [];
            for (var i in hw.PhysicalMemory) {
                var m2 = {}, m = hw.PhysicalMemory[i];
                m2.BankLabel = m.BankLabel;
                m2.Capacity = m.Capacity;
                m2.PartNumber = m.PartNumber.trim();
                m2.SerialNumber = m.SerialNumber.trim();
                m2.Manufacturer = m.Manufacturer.trim();
                memory.push(m2);
            }
            hw2.hardware.windows.memory = memory;
        }
        if ((hw.MediaAccessDevice != null) && (hw.MediaAccessDevice.length > 0)) {
            var drives = [];
            for (var i in hw.MediaAccessDevice) {
                var m2 = {}, m = hw.MediaAccessDevice[i];
                m2.Caption = m.DeviceID;
                m2.Size = (m.MaxMediaSize * 1000);
                drives.push(m2);
            }
            hw2.hardware.identifiers.storage_devices = drives;
        }
        if (hw.Bios != null) {
            hw2.hardware.identifiers.bios_vendor = hw.Bios.Manufacturer.trim();
            hw2.hardware.identifiers.bios_version = hw.Bios.Version;
            if (hw.Bios.ReleaseDate && hw.Bios.ReleaseDate.Datetime) { hw2.hardware.identifiers.bios_date = hw.Bios.ReleaseDate.Datetime; }
        }
        if (hw.PhysicalPackage != null) {
            hw2.hardware.identifiers.board_name = hw.Card.Model.trim();
            hw2.hardware.identifiers.board_vendor = hw.Card.Manufacturer.trim();
            hw2.hardware.identifiers.board_version = hw.Card.Version.trim();
            hw2.hardware.identifiers.board_serial = hw.Card.SerialNumber.trim();
        }
        if ((hw.Chips != null) && (hw.Chips.length > 0)) {
            for (var i in hw.Chips) {
                if ((hw.Chips[i].ElementName == 'Managed System Processor Chip') && (hw.Chips[i].Version)) {
                    hw2.hardware.identifiers.cpu_name = hw.Chips[i].Version;
                }
            }
        }

        // Compute the hash of the document
        hw2.hash = parent.crypto.createHash('sha384').update(JSON.stringify(hw2)).digest().toString('hex');

        // Fetch system information
        parent.db.GetHash('si' + dev.nodeid, function (err, results) {
            var sysinfohash = null;
            if ((results != null) && (results.length == 1)) { sysinfohash = results[0].hash; }
            if (sysinfohash != hw2.hash) {
                // Hardware information has changed, update the database
                hw2._id = 'si' + dev.nodeid;
                hw2.domain = dev.nodeid.split('/')[1];
                hw2.time = Date.now();
                hw2.type = 'sysinfo';
                parent.db.Set(hw2);

                // Event the new sysinfo hash, this will notify everyone that the sysinfo document was changed
                var event = { etype: 'node', action: 'sysinfohash', nodeid: dev.nodeid, domain: hw2.domain, hash: hw2.hash, nolog: 1 };
                parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, event);
            }
        });
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + '-' + g.substring(10, 12) + g.substring(8, 10) + '-' + g.substring(14, 16) + g.substring(12, 14) + '-' + g.substring(16, 20) + '-' + g.substring(20); }

    return obj;
};
