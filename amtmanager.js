/**
* @description MeshCentral remote desktop multiplexor
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
            var c = parent.args.amtmanager.amtadminaccount[i], c2 = { user: "admin" };
            if (typeof c.user == 'string') { c2.user = c.user; }
            if (typeof c.pass == 'string') { c2.pass = c.pass; obj.amtAdminAccounts.push(c2); }
        }
    }

    // Subscribe to server events
    parent.AddEventDispatch(['*'], obj);

    // Handle server events
    obj.HandleEvent = function (source, event, ids, id) {
        if (event.action != 'nodeconnect') return;
        if ((event.conn & 14) != 0) { // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 4 = Intel AMT local, 8 = Intel AMT Relay, 16 = MQTT
            // We have an OOB connection to Intel AMT, update our information
            var dev = obj.amtDevices[event.nodeid];
            if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: event.conn }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = event.conn; }
        } else if (((event.conn & 1) != 0) && (parent.webserver != null)) {
            // We have an agent connection without OOB, check if this agent supports Intel AMT
            var agent = parent.webserver.wsagents[event.nodeid];
            if ((agent == null) || (agent.agentInfo == null) || (parent.meshAgentsArchitectureNumbers[agent.agentInfo.agentId].amt == false)) { removeDevice(event.nodeid); return; }
            var dev = obj.amtDevices[event.nodeid];
            if (dev == null) { obj.amtDevices[event.nodeid] = dev = { conn: event.conn }; fetchIntelAmtInformation(event.nodeid); } else { dev.conn = event.conn; }
        } else {
            removeDevice(event.nodeid);
        }
    }

    // Remove a device
    function removeDevice(nodeid) {
        const dev = obj.amtDevices[nodeid];
        if (dev == null) return;
        if (dev.amtstack != null) { dev.amtstack.wsman.comm.FailAllError = 999; delete dev.amtstack; } // Disconnect any active connections.
        delete obj.amtDevices[nodeid];
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

        //if (dev.host != '192.168.2.136') return;

        if ((dev.acctry == null) && ((typeof dev.intelamt.user != 'string') || (typeof dev.intelamt.pass != 'string'))) {
            if (obj.amtAdminAccounts.length > 0) { dev.acctry = 0; } else { return; }
        }

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
                //console.log('Connect', dev.name, dev.host, user, pass);
                var comm;
                if (dev.tlsfail !== true) {
                    comm = CreateWsmanComm(dev.host, 16993, user, pass, 1); // Always try with TLS first
                    comm.xtlsFingerprint = 0; // Perform no certificate checking
                } else {
                    comm = CreateWsmanComm(dev.host, 16992, user, pass, 0); // Try without TLS
                }
                var wsstack = WsmanStackCreateService(comm);
                dev.amtstack = AmtStackCreateService(wsstack);
                dev.amtstack.dev = dev;
                obj.activeLocalConnections[dev.host] = dev;
                dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConectResponse);
            }
        }
    }

    function attemptLocalConectResponse(stack, name, responses, status) {
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
            if (verSplit.length >= 3) { dev.aquired.version = verSplit[0] + '.' + verSplit[1] + '.' + verSplit[2]; }
            dev.aquired.realm = stack.wsman.comm.digestRealm;
            dev.aquired.user = stack.wsman.comm.user;
            dev.aquired.pass = stack.wsman.comm.pass;
            dev.aquired.lastContact = Date.now();
            dev.aquired.tls = stack.wsman.comm.xtls;
            if (stack.wsman.comm.xtls == 1) { dev.aquired.tlshash = stack.wsman.comm.xtlsCertificate.fingerprint.split(':').join('').toLowerCase(); } else { delete dev.aquired.tlshash; }
            //console.log(dev.nodeid, dev.name, dev.host, dev.aquired);
            UpdateDevice(dev);
            //attemptFetchHardwareInventory(dev); // See if we need to get hardware inventory
        } else {
            // We got a bad response
            if ((dev.tlsfail !== true) && (status == 408)) {
                // TLS error, try again without TLS
                dev.tlsfail = true; attemptInitialContact(dev.nodeid, dev); return;
            } else if (status == 401) {
                // Authentication error, see if we can use alternative credentials
                if ((dev.acctry == null) && (obj.amtAdminAccounts.length > 0)) { dev.acctry = 0; attemptInitialContact(dev.nodeid, dev); return; }
                if ((dev.acctry != null) && (obj.amtAdminAccounts.length > (dev.acctry + 1))) { dev.acctry++; attemptInitialContact(dev.nodeid, dev); return; }
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

    function attemptFetchHardwareInventory(dev) {
        if (obj.amtDevices[dev.nodeid] == null) return false; // Device no longer exists, ignore this request.
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeDevice(dev.nodeid); return false; }
        if (mesh.mtype == 1) { // If this is a Intel AMT only device group, pull the hardware inventory for this device
            dev.amtstack.BatchEnum('', ['*CIM_ComputerSystemPackage', 'CIM_SystemPackaging', '*CIM_Chassis', 'CIM_Chip', '*CIM_Card', '*CIM_BIOSElement', 'CIM_Processor', 'CIM_PhysicalMemory', 'CIM_MediaAccessDevice', 'CIM_PhysicalPackage'], attemptFetchHardwareInventoryResponse);
            return true;
        }
        return false;
    }

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

    function attemptFetchHardwareInventoryResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.

        //console.log(JSON.stringify(responses, null, 2));

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
        console.log(JSON.stringify(hw, null, 2));
    }

    return obj;
};
