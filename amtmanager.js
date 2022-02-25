/**
* @description MeshCentral Intel AMT manager
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
'use strict';

module.exports.CreateAmtManager = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.amtDevices = {};             // Nodeid --> [ dev ]
    obj.activeLocalConnections = {}; // Host --> dev
    obj.amtAdminAccounts = {};       // DomainId -> [ { user, pass } ]
    obj.rootCertBase64 = obj.parent.certificates.root.cert.split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('').split('\r').join('').split('\n').join('')
    obj.rootCertCN = obj.parent.certificateOperations.forge.pki.certificateFromPem(obj.parent.certificates.root.cert).subject.getField('CN').value;

    // WSMAN stack
    const CreateWsmanComm = require('./amt/amt-wsman-comm');
    const WsmanStackCreateService = require('./amt/amt-wsman');
    const AmtStackCreateService = require('./amt/amt');
    const ConnectionTypeStrings = { 0: "CIRA", 1: "Relay", 2: "LMS", 3: "Local" };

    // Check that each domain configuration is correct because we are not going to be checking this later.
    if (parent.config == null) parent.config = {};
    if (parent.config.domains == null) parent.config.domains = {};
    for (var domainid in parent.config.domains) {
        var domain = parent.config.domains[domainid];
        if (typeof domain.amtmanager != 'object') { domain.amtmanager = {}; }

        // Load administrator accounts
        if (Array.isArray(domain.amtmanager.adminaccounts) == true) {
            for (var i = 0; i < domain.amtmanager.adminaccounts.length; i++) {
                var c = domain.amtmanager.adminaccounts[i], c2 = {};
                if (typeof c.user == 'string') { c2.user = c.user; } else { c2.user = 'admin'; }
                if (typeof c.pass == 'string') {
                    c2.pass = c.pass;
                    if (obj.amtAdminAccounts[domainid] == null) { obj.amtAdminAccounts[domainid] = []; }
                    obj.amtAdminAccounts[domainid].push(c2);
                }
            }
        } else {
            delete domain.amtmanager.adminaccounts;
        }

        // Check environment detection
        if (Array.isArray(domain.amtmanager.environmentdetection) == true) {
            var envDetect = [];
            for (var i = 0; i < domain.amtmanager.environmentdetection.length; i++) {
                var x = domain.amtmanager.environmentdetection[i].toLowerCase();
                if ((typeof x == 'string') && (x != '') && (x.length < 64) && (envDetect.indexOf(x) == -1)) { envDetect.push(x); }
                if (envDetect.length >= 4) break; // Maximum of 4 DNS suffix
            }
            if (envDetect.length > 0) { domain.amtmanager.environmentdetection = envDetect; } else { delete domain.amtmanager.environmentdetection; }
        } else {
            delete domain.amtmanager.environmentdetection;
        }

        // Check WIFI profiles
        //var wifiAuthMethod = { 1: "Other", 2: "Open", 3: "Shared Key", 4: "WPA PSK", 5: "WPA 802.1x", 6: "WPA2 PSK", 7: "WPA2 802.1x", 32768: "WPA3 802.1x" };
        //var wifiEncMethod = { 1: "Other", 2: "WEP", 3: "TKIP", 4: "CCMP", 5: "None" }
        if (Array.isArray(domain.amtmanager.wifiprofiles) == true) {
            var goodWifiProfiles = [];
            for (var i = 0; i < domain.amtmanager.wifiprofiles.length; i++) {
                var wifiProfile = domain.amtmanager.wifiprofiles[i];
                if ((typeof wifiProfile.ssid == 'string') && (wifiProfile.ssid != '') && (typeof wifiProfile.password == 'string') && (wifiProfile.password != '')) {
                    if ((wifiProfile.name == null) || (wifiProfile.name == '')) { wifiProfile.name = wifiProfile.ssid; }
                    if (typeof wifiProfile.authentication == 'string') {
                        // Authentication
                        if (typeof wifiProfile.authentication == 'string') { wifiProfile.authentication = wifiProfile.authentication.toLowerCase(); }
                        if (wifiProfile.authentication == 'wpa-psk') { wifiProfile.authentication = 4; }
                        if (wifiProfile.authentication == 'wpa2-psk') { wifiProfile.authentication = 6; }
                        if (typeof wifiProfile.authentication != 'number') { wifiProfile.authentication = 6; } // Default to WPA2-PSK

                        // Encyption
                        if (typeof wifiProfile.encryption == 'string') { wifiProfile.encryption = wifiProfile.encryption.toLowerCase(); }
                        if ((wifiProfile.encryption == 'ccmp-aes') || (wifiProfile.encryption == 'ccmp')) { wifiProfile.encryption = 4; }
                        if ((wifiProfile.encryption == 'tkip-rc4') || (wifiProfile.encryption == 'tkip')) { wifiProfile.encryption = 3; }
                        if (typeof wifiProfile.encryption != 'number') { wifiProfile.encryption = 4; } // Default to CCMP-AES

                        // Type
                        wifiProfile.type = 3; // Infrastructure
                    }
                    goodWifiProfiles.push(wifiProfile);
                }
            }
            domain.amtmanager.wifiprofiles = goodWifiProfiles;
        } else {
            delete domain.amtmanager.wifiprofiles;
        }
    }

    // Check if an Intel AMT device is being managed
    function isAmtDeviceValid(dev) {
        var devices = obj.amtDevices[dev.nodeid];
        if (devices == null) return false;
        return (devices.indexOf(dev) >= 0)
    }

    // Add an Intel AMT managed device
    function addAmtDevice(dev) {
        var devices = obj.amtDevices[dev.nodeid];
        if (devices == null) { obj.amtDevices[dev.nodeid] = [dev]; return true; }
        if (devices.indexOf(dev) >= 0) return false; // This device is already in the list
        devices.push(dev); // Add the device to the list
        return true;
    }

    // Remove an Intel AMT managed device
    function removeAmtDevice(dev, tag) {
        parent.debug('amt', dev.name, "Remove device", dev.nodeid, dev.connType, tag);

        // Find the device in the list
        var devices = obj.amtDevices[dev.nodeid];
        if (devices == null) return false;
        var i = devices.indexOf(dev);
        if (i == -1) return false;

        // Remove from task limiter if needed
        if (dev.taskid != null) { obj.parent.taskLimiter.completed(dev.taskid); delete dev.taskLimiter; }

        // Clean up this device
        if (dev.amtstack != null) { dev.amtstack.CancelAllQueries(999); if (dev.amtstack != null) { delete dev.amtstack.dev; delete dev.amtstack; } }
        if (dev.polltimer != null) { clearInterval(dev.polltimer); delete dev.polltimer; }

        // Remove the device from the list
        devices.splice(i, 1);
        if (devices.length == 0) { delete obj.amtDevices[dev.nodeid]; } else { obj.amtDevices[dev.nodeid] = devices; }

        // Notify connection closure if this is a LMS connection
        if (dev.connType == 2) { dev.controlMsg({ action: 'close' }); }
        return true;
    }

    // Remove all Intel AMT devices for a given nodeid
    function removeDevice(nodeid) {
        parent.debug('amt', "Remove nodeid", nodeid);

        // Find the devices in the list
        var devices = obj.amtDevices[nodeid];
        if (devices == null) return false;

        for (var i in devices) {
            var dev = devices[i];

            // Remove from task limiter if needed
            if (dev.taskid != null) { obj.parent.taskLimiter.completed(dev.taskid); delete dev.taskLimiter; }

            // Clean up this device
            if (dev.amtstack != null) { dev.amtstack.wsman.comm.FailAllError = 999; delete dev.amtstack; } // Disconnect any active connections.
            if (dev.polltimer != null) { clearInterval(dev.polltimer); delete dev.polltimer; }

            // Notify connection closure if this is a LMS connection
            if (dev.connType == 2) { dev.controlMsg({ action: 'close' }); }
        }

        // Remove all Intel AMT management sessions for this nodeid
        delete obj.amtDevices[nodeid];
        return true;
    }

    // Start Intel AMT management
    // connType: 0 = CIRA, 1 = CIRA-Relay, 2 = CIRA-LMS, 3 = LAN
    obj.startAmtManagement = function (nodeid, connType, connection) {
        //if (connType == 3) return; // DEBUG
        var devices = obj.amtDevices[nodeid], dev = null;
        if (devices != null) { for (var i in devices) { if ((devices[i].mpsConnection == connection) || (devices[i].host == connection)) { dev = devices[i]; } } }
        if (dev != null) return false; // We are already managing this device on this connection
        dev = { nodeid: nodeid, connType: connType, domainid: nodeid.split('/')[1] };
        if (typeof connection == 'string') { dev.host = connection; }
        if (typeof connection == 'object') { dev.mpsConnection = connection; }
        dev.consoleMsg = function deviceConsoleMsg(msg) { parent.debug('amt', deviceConsoleMsg.dev.name, msg); if (typeof deviceConsoleMsg.conn == 'object') { deviceConsoleMsg.conn.ControlMsg({ action: 'console', msg: msg }); } }
        dev.consoleMsg.conn = connection;
        dev.consoleMsg.dev = dev;
        dev.controlMsg = function deviceControlMsg(msg) { if (typeof deviceControlMsg.conn == 'object') { deviceControlMsg.conn.ControlMsg(msg); } }
        dev.controlMsg.conn = connection;
        parent.debug('amt', "Start Management", nodeid, connType);
        addAmtDevice(dev);

        // Start the device manager in the task limiter so not to flood the server. Low priority task
        obj.parent.taskLimiter.launch(function (dev, taskid, taskLimiterQueue) {
            if (isAmtDeviceValid(dev)) {
                // Start managing this device
                dev.taskid = taskid;
                fetchIntelAmtInformation(dev);
            } else {
                // Device is not valid anymore, do nothing
                obj.parent.taskLimiter.completed(taskid);
            }
        }, dev, 2);
    }

    // Stop Intel AMT management
    obj.stopAmtManagement = function (nodeid, connType, connection) {
        var devices = obj.amtDevices[nodeid], dev = null;
        if (devices != null) { for (var i in devices) { if ((devices[i].mpsConnection == connection) || (devices[i].host == connection)) { dev = devices[i]; } } }
        if (dev == null) return false; // We are not managing this device on this connection
        parent.debug('amt', dev.name, "Stop Management", nodeid, connType);
        return removeAmtDevice(dev, 1);
    }

    // Get a string status of the managed devices
    obj.getStatusString = function () {
        var r = '';
        for (var nodeid in obj.amtDevices) {
            var devices = obj.amtDevices[nodeid];
            r += devices[0].nodeid + ', ' + devices[0].name + '\r\n';
            for (var i in devices) {
                var dev = devices[i];
                var items = [];
                if (dev.state == 1) { items.push('Connected'); } else { items.push('Trying'); }
                items.push(ConnectionTypeStrings[dev.connType]);
                if (dev.connType == 3) { items.push(dev.host); }
                if (dev.polltimer != null) { items.push('Polling Power'); }
                r += '  ' + items.join(', ') + '\r\n';
            }
        }
        if (r == '') { r = "No managed Intel AMT devices"; }
        return r;
    }

    // Receive a JSON control message from the MPS server
    obj.mpsControlMessage = function (nodeid, conn, connType, jsondata) {
        // Find the devices in the list
        var dev = null;
        var devices = obj.amtDevices[nodeid];
        if (devices == null) return;
        for (var i in devices) { if (devices[i].mpsConnection === conn) { dev = devices[i]; } }
        if (dev == null) return;

        // Process the message
        switch (jsondata.action) {
            case 'deactivate':
                if ((dev.connType != 2) || (dev.deactivateCcmPending != 1)) break; // Only accept MEI state on CIRA-LMS connection
                delete dev.deactivateCcmPending;
                deactivateIntelAmtCCMEx(dev, jsondata.value);
                break;
            case 'meiState':
                if (dev.acmactivate == 1) {
                    // Continue ACM activation
                    dev.consoleMsg("Got new Intel AMT MEI state. Holding 40 seconds prior to ACM activation...");
                    delete dev.acmactivate;
                    var continueAcmFunc = function continueAcm() { if (isAmtDeviceValid(continueAcm.dev)) { activateIntelAmtAcmEx0(continueAcm.dev); } }
                    continueAcmFunc.dev = dev;
                    setTimeout(continueAcmFunc, 40000);
                } else {
                    if (dev.pendingUpdatedMeiState != 1) break;
                    delete dev.pendingUpdatedMeiState;
                    attemptInitialContact(dev);
                }
                break;
            case 'startTlsHostConfig':
                if (dev.acmTlsInfo == null) break;
                if ((typeof jsondata.value != 'object') || (typeof jsondata.value.status != 'number')) {
                    removeAmtDevice(dev, 2); // Invalid startTlsHostConfig response
                } else {
                    activateIntelAmtTlsAcmEx(dev, jsondata.value); // Start TLS activation.
                }
                break;
            case 'stopConfiguration':
                if (dev.acmactivate != 1) break;
                if (jsondata.value == 3) { delete dev.acmactivate; activateIntelAmtAcmEx0(dev); } // Intel AMT was already not in in-provisioning state, keep going right away.
                else if (jsondata.value == 0) {
                    dev.consoleMsg("Cleared in-provisioning state. Holding 30 seconds prior to getting Intel AMT MEI state...");
                    var askStateFunc = function askState() { if (isAmtDeviceValid(askState.dev)) { askState.dev.controlMsg({ action: 'mestate' }); } }
                    askStateFunc.dev = dev;
                    setTimeout(askStateFunc, 30000);
                }
                else { dev.consoleMsg("Unknown stopConfiguration() state of " + jsondata.value + ". Continuing with ACM activation..."); delete dev.acmactivate; activateIntelAmtAcmEx0(dev); }
                break;
        }
    }

    // Subscribe to server events
    parent.AddEventDispatch(['*'], obj);

    // Handle server events
    // Make sure to only manage devices with connections to this server. In a multi-server setup, we don't want multiple managers talking to the same device.
    obj.HandleEvent = function (source, event, ids, id) {
        switch (event.action) {
            case 'removenode': { // React to node being removed
                if (event.noact == 1) return; // Take no action on these events. We are likely in peering mode and need to only act when the database signals the change in state.
                removeDevice(event.nodeid);
                break;
            }
            case 'wakedevices': { // React to node wakeup command, perform Intel AMT wake if possible
                if (event.noact == 1) return; // Take no action on these events. We are likely in peering mode and need to only act when the database signals the change in state.
                if (Array.isArray(event.nodeids)) { for (var i in event.nodeids) { performPowerAction(event.nodeids[i], 2); } }
                break;
            }
            case 'oneclickrecovery': { // React to Intel AMT One Click Recovery command
                if (event.noact == 1) return; // Take no action on these events. We are likely in peering mode and need to only act when the database signals the change in state.
                if (Array.isArray(event.nodeids)) { for (var i in event.nodeids) { performOneClickRecoveryAction(event.nodeids[i], event.file); } }
                break;
            }
            case 'amtpoweraction': {
                if (event.noact == 1) return; // Take no action on these events. We are likely in peering mode and need to only act when the database signals the change in state.
                if (Array.isArray(event.nodeids)) { for (var i in event.nodeids) { performPowerAction(event.nodeids[i], event.actiontype); } }
                break;
            }
            case 'changenode': { // React to changes in a device
                var devices = obj.amtDevices[event.nodeid], rescan = false;
                if (devices != null) {
                    for (var i in devices) {
                        var dev = devices[i];
                        dev.name = event.node.name;

                        // If there are any changes, apply them.
                        if (event.node.intelamt != null) {
                            if (dev.intelamt == null) { dev.intelamt = {}; }
                            if ((typeof event.node.intelamt.version == 'string') && (event.node.intelamt.version != dev.intelamt.ver)) { dev.intelamt.ver = event.node.intelamt.version; }
                            if ((typeof event.node.intelamt.user == 'string') && (event.node.intelamt.user != dev.intelamt.user)) { dev.intelamt.user = event.node.intelamt.user; }
                            if ((typeof event.node.intelamt.pass == 'string') && (event.node.intelamt.pass != dev.intelamt.pass)) { dev.intelamt.pass = event.node.intelamt.pass; }
                            if ((typeof event.node.intelamt.mpspass == 'string') && (event.node.intelamt.mpspass != dev.intelamt.mpspass)) { dev.intelamt.mpspass = event.node.intelamt.mpspass; }
                            if ((typeof event.node.intelamt.host == 'string') && (event.node.intelamt.host != dev.intelamt.host)) { dev.intelamt.host = event.node.intelamt.host; }
                            if ((typeof event.node.intelamt.realm == 'string') && (event.node.intelamt.realm != dev.intelamt.realm)) { dev.intelamt.realm = event.node.intelamt.realm; }
                            if ((typeof event.node.intelamt.hash == 'string') && (event.node.intelamt.hash != dev.intelamt.hash)) { dev.intelamt.hash = event.node.intelamt.hash; }
                            if ((typeof event.node.intelamt.tls == 'number') && (event.node.intelamt.tls != dev.intelamt.tls)) { dev.intelamt.tls = event.node.intelamt.tls; }
                            if ((typeof event.node.intelamt.state == 'number') && (event.node.intelamt.state != dev.intelamt.state)) { dev.intelamt.state = event.node.intelamt.state; }
                        }

                        if ((dev.connType == 3) && (dev.host != event.node.host)) {
                            dev.host = event.node.host; // The host has changed, if we are connected to this device locally, we need to reset.
                            removeAmtDevice(dev, 3); // We are going to wait for the AMT scanned to find this device again.
                            rescan = true;
                        }
                    }
                } else {
                    // If this event provides a hint that something changed with AMT and we are not managing this device, let's rescan the local network now.
                    if (event.amtchange == 1) { rescan = true; }
                }

                // If there is a significant change to the device AMT settings and this server manages local devices, perform a re-scan of the device now.
                if (rescan && (parent.amtScanner != null)) { parent.amtScanner.performSpecificScan(event.node); }
                break;
            }
            case 'meshchange': {
                // TODO
                break;
            }
        }
    }


    //
    // Intel AMT Connection Setup
    //

    // Update information about a device
    function fetchIntelAmtInformation(dev) {
        parent.db.Get(dev.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { removeAmtDevice(dev, 4); return; }
            const node = nodes[0];
            if ((node.intelamt == null) || (node.meshid == null)) { removeAmtDevice(dev, 5); return; }
            const mesh = parent.webserver.meshes[node.meshid];
            if (mesh == null) { removeAmtDevice(dev, 6); return; }
            if (dev == null) { return; }

            // Fetch Intel AMT setup policy
            // mesh.amt.type: 0 = No Policy, 1 = Deactivate CCM, 2 = Manage in CCM, 3 = Manage in ACM
            // mesh.amt.cirasetup: 0 = No Change, 1 = Remove CIRA, 2 = Setup CIRA
            var amtPolicy = 0, ciraPolicy = 0, badPass = 0, password = null;
            if (mesh.amt != null) {
                if (mesh.amt.type) { amtPolicy = mesh.amt.type; }
                if (mesh.amt.type == 4) {
                    // Fully automatic policy
                    ciraPolicy = 2; // CIRA will be setup
                    badPass = 1; // Automatically re-active CCM
                    password = null; // Randomize the password.
                } else {
                    if (mesh.amt.cirasetup) { ciraPolicy = mesh.amt.cirasetup; }
                    if (mesh.amt.badpass) { badPass = mesh.amt.badpass; }
                    if ((typeof mesh.amt.password == 'string') && (mesh.amt.password != '')) { password = mesh.amt.password; }
                }
            }
            if (amtPolicy == 0) { ciraPolicy = 0; } // If no policy, don't change CIRA state.
            if (amtPolicy == 1) { ciraPolicy = 1; } // If deactivation policy, clear CIRA.
            dev.policy = { amtPolicy: amtPolicy, ciraPolicy: ciraPolicy, badPass: badPass, password: password };

            // Setup the monitored device
            dev.name = node.name;
            dev.meshid = node.meshid;
            dev.intelamt = node.intelamt;

            // Check if the status of Intel AMT sent by the agents matched what we have in the database
            if ((dev.connType == 2) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null)) {
                dev.aquired = {};
                if ((typeof dev.mpsConnection.tag.meiState.OsHostname == 'string') && (typeof dev.mpsConnection.tag.meiState.OsDnsSuffix == 'string')) {
                    dev.host = dev.aquired.host = dev.mpsConnection.tag.meiState.OsHostname + '.' + dev.mpsConnection.tag.meiState.OsDnsSuffix;
                }
                if (typeof dev.mpsConnection.tag.meiState['ProvisioningState'] == 'number') {
                    dev.intelamt.state = dev.aquired.state = dev.mpsConnection.tag.meiState['ProvisioningState'];
                }
                if ((typeof dev.mpsConnection.tag.meiState['Versions'] == 'object') && (typeof dev.mpsConnection.tag.meiState['Versions']['AMT'] == 'string')) {
                    dev.intelamt.ver = dev.aquired.version = dev.mpsConnection.tag.meiState['Versions']['AMT'];
                }
                if (typeof dev.mpsConnection.tag.meiState['Flags'] == 'number') {
                    const flags = dev.intelamt.flags = dev.mpsConnection.tag.meiState['Flags'];
                    if (flags & 2) { dev.aquired.controlMode = 1; } // CCM
                    if (flags & 4) { dev.aquired.controlMode = 2; } // ACM
                }
                UpdateDevice(dev);
            }

            // If there is no Intel AMT policy for this device, stop here.
            //if (amtPolicy == 0) { dev.consoleMsg("Done."); removeAmtDevice(dev, 7); return; }

            // Initiate the communication to Intel AMT
            dev.consoleMsg("Checking Intel AMT state...");
            attemptInitialContact(dev);
        });
    }

    // Attempt to perform initial contact with Intel AMT
    function attemptInitialContact(dev) {
        // If there is a WSMAN stack setup, clean it up now.
        if (dev.amtstack != null) {
            dev.amtstack.CancelAllQueries(999);
            delete dev.amtstack.dev;
            delete dev.amtstack;
        }

        delete dev.amtstack; 
        parent.debug('amt', dev.name, "Attempt Initial Contact", ["CIRA", "CIRA-Relay", "CIRA-LMS", "Local"][dev.connType]);

        // Check Intel AMT policy when CIRA-LMS connection is in use.
        if ((dev.connType == 2) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null)) {
            // Intel AMT activation policy
            if ((dev.policy.amtPolicy > 1) && (dev.mpsConnection.tag.meiState.ProvisioningState !== 2)) {
                // This Intel AMT device is not activated, we need to work on activating it.
                activateIntelAmt(dev);
                return;
            }
            // Check if we have an ACM activation policy, but the device is in CCM
            if (((dev.policy.amtPolicy == 3) || (dev.policy.amtPolicy == 4)) && (dev.mpsConnection.tag.meiState.ProvisioningState == 2) && ((dev.mpsConnection.tag.meiState.Flags & 2) != 0)) {
                // This device in is CCM, check if we can upgrade to ACM
                if (activateIntelAmt(dev) == false) return; // If this return true, the platform is in CCM and can't go to ACM, keep going with management.
            }
            // Intel AMT CCM deactivation policy
            if (dev.policy.amtPolicy == 1) {
                if ((dev.mpsConnection.tag.meiState.ProvisioningState == 2) && ((dev.mpsConnection.tag.meiState.Flags & 2) != 0)) {
                    // Deactivate CCM.
                    deactivateIntelAmtCCM(dev);
                    return;
                }
            }
        }

        // See what username/password we need to try
        // We create an efficient strategy for trying different Intel AMT passwords.
        if (dev.acctry == null) {
            dev.acctry = [];

            // Add Intel AMT username and password provided by MeshCMD if available
            if ((dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (typeof dev.mpsConnection.tag.meiState.amtuser == 'string') && (typeof dev.mpsConnection.tag.meiState.amtpass == 'string') && (dev.mpsConnection.tag.meiState.amtuser != '') && (dev.mpsConnection.tag.meiState.amtpass != '')) {
                dev.acctry.push([dev.mpsConnection.tag.meiState.amtuser, dev.mpsConnection.tag.meiState.amtpass]);
            }

            // Add the know Intel AMT password for this device if available
            if ((typeof dev.intelamt.user == 'string') && (typeof dev.intelamt.pass == 'string') && (dev.intelamt.user != '') && (dev.intelamt.pass != '')) { dev.acctry.push([dev.intelamt.user, dev.intelamt.pass]); }

            // Add the policy password as an alternative
            if ((typeof dev.policy.password == 'string') && (dev.policy.password != '')) { dev.acctry.push(['admin', dev.policy.password]); }

            // Add any configured admin account as alternatives
            if (obj.amtAdminAccounts[dev.domainid] != null) { for (var i in obj.amtAdminAccounts[dev.domainid]) { dev.acctry.push([obj.amtAdminAccounts[dev.domainid][i].user, obj.amtAdminAccounts[dev.domainid][i].pass]); } }

            // Add any previous passwords for the device UUID as alternative
            if ((parent.amtPasswords != null) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (dev.mpsConnection.tag.meiState.UUID != null) && (parent.amtPasswords[dev.mpsConnection.tag.meiState.UUID] != null)) {
                for (var i in parent.amtPasswords[dev.mpsConnection.tag.meiState.UUID]) {
                    dev.acctry.push(['admin', parent.amtPasswords[dev.mpsConnection.tag.meiState.UUID][i]]);
                }
            }

            // Remove any duplicates user/passwords
            var acctry2 = [];
            for (var i = 0; i < dev.acctry.length; i++) {
                var found = false;
                for (var j = 0; j < acctry2.length; j++) { if ((dev.acctry[i][0] == acctry2[j][0]) && (dev.acctry[i][1] == acctry2[j][1])) { found = true; } }
                if (found == false) { acctry2.push(dev.acctry[i]); }
            }
            dev.acctry = acctry2;

            // If we have passwords to try, try the first one now.
            if (dev.acctry.length == 0) {
                dev.consoleMsg("No admin login passwords to try, stopping now.");
                removeAmtDevice(dev, 8);
                return;
            }
        }

        if ((dev.acctry == null) || (dev.acctry.length == 0)) { removeAmtDevice(dev, 9); return; } // No Intel AMT credentials to try
        var user = dev.acctry[0][0], pass = dev.acctry[0][1]; // Try the first user/pass in the list

        switch (dev.connType) {
            case 0: // CIRA
                // Handle the case where the Intel AMT CIRA is connected (connType 0)
                // In this connection type, we look at the port bindings to see if we need to do TLS or not.

                // Check to see if CIRA is connected on this server.
                var ciraconn = dev.mpsConnection;
                if ((ciraconn == null) || (ciraconn.tag == null) || (ciraconn.tag.boundPorts == null)) { removeAmtDevice(dev, 9); return; } // CIRA connection is not on this server, no need to deal with this device anymore.

                // See if we need to perform TLS or not. We prefer not to do TLS within CIRA.
                var dotls = -1;
                if (ciraconn.tag.boundPorts.indexOf('16992')) { dotls = 0; }
                else if (ciraconn.tag.boundPorts.indexOf('16993')) { dotls = 1; }
                if (dotls == -1) { removeAmtDevice(dev, 10); return; } // The Intel AMT ports are not open, not a device we can deal with.

                // Connect now
                parent.debug('amt', dev.name, 'CIRA-Connect', (dotls == 1) ? "TLS" : "NoTLS", user, pass);
                var comm;
                if (dotls == 1) {
                    comm = CreateWsmanComm(dev.nodeid, 16993, user, pass, 1, null, ciraconn); // Perform TLS
                    comm.xtlsFingerprint = 0; // Perform no certificate checking
                } else {
                    comm = CreateWsmanComm(dev.nodeid, 16992, user, pass, 0, null, ciraconn); // No TLS
                }
                var wsstack = WsmanStackCreateService(comm);
                dev.amtstack = AmtStackCreateService(wsstack);
                dev.amtstack.dev = dev;
                dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
                break;
            case 1: // CIRA-Relay
            case 2: // CIRA-LMS
                // Handle the case where the Intel AMT relay or LMS is connected (connType 1 or 2)
                // Check to see if CIRA is connected on this server.
                var ciraconn = dev.mpsConnection;
                if ((ciraconn == null) || (ciraconn.tag == null) || (ciraconn.tag.boundPorts == null)) { removeAmtDevice(dev, 11); return; } // Relay connection not valid

                // Connect now
                var comm;
                if ((dev.tlsfail !== true) && (parent.config.domains[dev.domainid].amtmanager.tlsconnections !== false)) {
                    parent.debug('amt', dev.name, (dev.connType == 1) ? 'Relay-Connect' : 'LMS-Connect', "TLS", user);
                    comm = CreateWsmanComm(dev.nodeid, 16993, user, pass, 1, null, ciraconn); // Perform TLS
                    comm.xtlsFingerprint = 0; // Perform no certificate checking
                } else {
                    parent.debug('amt', dev.name, (dev.connType == 1) ? 'Relay-Connect' : 'LMS-Connect', "NoTLS", user);
                    comm = CreateWsmanComm(dev.nodeid, 16992, user, pass, 0, null, ciraconn); // No TLS
                }
                var wsstack = WsmanStackCreateService(comm);
                dev.amtstack = AmtStackCreateService(wsstack);
                dev.amtstack.dev = dev;
                dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
                break;
            case 3: // Local LAN
                // Check if Intel AMT is activated. If not, stop here.
                if ((dev.intelamt == null) || ((dev.intelamt.state != null) && (dev.intelamt.state != 2))) { removeAmtDevice(dev, 12); return; }

                // Handle the case where the Intel AMT local scanner found the device (connType 3)
                parent.debug('amt', dev.name, "Attempt Initial Local Contact", dev.connType, dev.host);
                if (typeof dev.host != 'string') { removeAmtDevice(dev, 13); return; } // Local connection not valid

                // Since we don't allow two or more connections to the same host, check if a pending connection is active.
                if (obj.activeLocalConnections[dev.host] != null) {
                    // Active connection, hold and try later.
                    var tryAgainFunc = function tryAgainFunc() { if (obj.amtDevices[tryAgainFunc.dev.nodeid] != null) { attemptInitialContact(tryAgainFunc.dev); } }
                    tryAgainFunc.dev = dev;
                    setTimeout(tryAgainFunc, 5000);
                } else {
                    // No active connections

                    // Connect now
                    var comm;
                    if ((dev.tlsfail !== true) && (parent.config.domains[dev.domainid].amtmanager.tlsconnections !== false)) {
                        parent.debug('amt', dev.name, 'Direct-Connect', "TLS", dev.host, user);
                        comm = CreateWsmanComm(dev.host, 16993, user, pass, 1); // Always try with TLS first
                        comm.xtlsFingerprint = 0; // Perform no certificate checking
                    } else {
                        parent.debug('amt', dev.name, 'Direct-Connect', "NoTLS", dev.host, user);
                        comm = CreateWsmanComm(dev.host, 16992, user, pass, 0); // Try without TLS
                    }
                    var wsstack = WsmanStackCreateService(comm);
                    dev.amtstack = AmtStackCreateService(wsstack);
                    dev.amtstack.dev = dev;
                    obj.activeLocalConnections[dev.host] = dev;
                    dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
                }
                break;
        }
    }

    function attemptLocalConnectResponse(stack, name, responses, status) {
        const dev = stack.dev;
        parent.debug('amt', dev.name, "Initial Contact Response", status);

        // If this is a local connection device, release active connection to this host.
        if (dev.connType == 3) { delete obj.activeLocalConnections[dev.host]; }

        // Check if the device still exists
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.

        // Check the response
        if ((status == 200) && (responses['AMT_GeneralSettings'] != null) && (responses['IPS_HostBasedSetupService'] != null) && (responses['IPS_HostBasedSetupService'].response != null) && (responses['IPS_HostBasedSetupService'].response != null) && (stack.wsman.comm.digestRealm == responses['AMT_GeneralSettings'].response.DigestRealm)) {
            // Everything looks good
            dev.consoleMsg(stack.wsman.comm.xtls ? "Intel AMT connected with TLS." : "Intel AMT connected.");
            dev.state = 1;
            if (dev.aquired == null) { dev.aquired = {}; }
            dev.aquired.controlMode = responses['IPS_HostBasedSetupService'].response.CurrentControlMode; // 1 = CCM, 2 = ACM
            if (typeof stack.wsman.comm.amtVersion == 'string') { // Set the Intel AMT version using the HTTP header if present
                var verSplit = stack.wsman.comm.amtVersion.split('.');
                if (verSplit.length >= 3) { dev.aquired.version = verSplit[0] + '.' + verSplit[1] + '.' + verSplit[2]; dev.aquired.majorver = parseInt(verSplit[0]); dev.aquired.minorver = parseInt(verSplit[1]); }
            }
            dev.aquired.realm = stack.wsman.comm.digestRealm;
            dev.aquired.user = dev.intelamt.user = stack.wsman.comm.user;
            dev.aquired.pass = dev.intelamt.pass = stack.wsman.comm.pass;
            dev.aquired.lastContact = Date.now();
            dev.aquired.warn = 0; // Clear all warnings (TODO: Check Realm and TLS cert pinning)
            if ((dev.connType == 1) || (dev.connType == 3)) { dev.aquired.tls = stack.wsman.comm.xtls; } // Only set the TLS state if in relay or local mode. When using CIRA, this is auto-detected.
            if (stack.wsman.comm.xtls == 1) { dev.aquired.hash = stack.wsman.comm.xtlsCertificate.fingerprint.split(':').join('').toLowerCase(); } else { delete dev.aquired.hash; }
            UpdateDevice(dev);

            // If this is the new first user/pass for the device UUID, update the activation log now.
            if ((parent.amtPasswords != null) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (dev.mpsConnection.tag.meiState.UUID != null) && (parent.amtPasswords[dev.mpsConnection.tag.meiState.UUID] != null) && (parent.amtPasswords[dev.mpsConnection.tag.meiState.UUID][0] != dev.aquired.pass)) {
                parent.certificateOperations.logAmtActivation(parent.config.domains[dev.domainid], { time: new Date(), action: 'amtpassword', domain: dev.domainid, amtUuid: dev.mpsConnection.tag.meiState.UUID, amtRealm: dev.aquired.realm, user: dev.aquired.user, password: dev.aquired.pass, computerName: dev.name });
            }

            // Perform Intel AMT clock sync
            attemptSyncClock(dev, function (dev) {
                // Check Intel AMT TLS state
                attemptTlsSync(dev, function (dev) {
                    // If we need to switch to TLS, do it now.
                    if (dev.switchToTls == 1) { delete dev.switchToTls; attemptInitialContact(dev); return; }
                    // Check Intel AMT WIFI state
                    attemptWifiSync(dev, function (dev) {
                        // Check Intel AMT root certificate state
                        attemptRootCertSync(dev, function (dev) {
                            // Check Intel AMT CIRA settings
                            attemptCiraSync(dev, function (dev) {
                                // Check Intel AMT settings
                                attemptSettingsSync(dev, function (dev) {
                                    // See if we need to get hardware inventory
                                    attemptFetchHardwareInventory(dev, function (dev) {
                                        dev.consoleMsg('Done.');

                                        // Remove from task limiter if needed
                                        if (dev.taskid != null) { obj.parent.taskLimiter.completed(dev.taskid); delete dev.taskLimiter; }

                                        if (dev.connType != 2) {
                                            // Start power polling if not connected to LMS
                                            var ppfunc = function powerPoleFunction() { fetchPowerState(powerPoleFunction.dev); }
                                            ppfunc.dev = dev;
                                            dev.polltimer = new setTimeout(ppfunc, 290000); // Poll for power state every 4 minutes 50 seconds.
                                            fetchPowerState(dev);
                                        } else {
                                            // For LMS connections, close now.
                                            dev.controlMsg({ action: 'close' });
                                        }
                                    });
                                });
                            });
                        });
                    });
                });
            });
        } else {
            // We got a bad response
            if ((dev.conntype != 0) && (dev.tlsfail !== true) && (status == 408)) { // If not using CIRA and we get a 408 error while using TLS, try non-TLS.
                // TLS error on a local connection, try again without TLS
                dev.tlsfail = true; attemptInitialContact(dev); return;
            } else if (status == 401) {
                // Authentication error, see if we can use alternative credentials
                if (dev.acctry != null) {
                    // Remove the first password from the trial list since it did not work.
                    if (dev.acctry.length > 0) { dev.acctry.shift(); }

                    // We have another password to try, hold 20 second and try the next user/password.
                    if (dev.acctry.length > 0) {
                        dev.consoleMsg("Holding 20 seconds and trying again with different credentials...");
                        setTimeout(function () { if (isAmtDeviceValid(dev)) { attemptInitialContact(dev); } }, 20000); return;
                    }
                }

                // If this device is in CCM mode and we have a bad password reset policy, do it now.
                if ((dev.connType == 2) && (dev.policy.badPass == 1) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (dev.mpsConnection.tag.meiState.Flags != null) && ((dev.mpsConnection.tag.meiState.Flags & 2) != 0)) {
                    deactivateIntelAmtCCM(dev);
                    return;
                }

                // We are unable to authenticate to this device
                dev.consoleMsg("Unable to connect.");

                // Set an error that we can't login to this device
                if (dev.aquired == null) { dev.aquired = {}; }
                dev.aquired.warn = 1; // Intel AMT Warning Flags: 1 = Unknown credentials, 2 = Realm Mismatch, 4 = TLS Cert Mismatch, 8 = Trying credentials
                UpdateDevice(dev);
            }
            //console.log(dev.nodeid, dev.name, dev.host, status, 'Bad response');
            removeAmtDevice(dev, 14);
        }
    }


    //
    // Intel AMT Database Update
    //

    // Change the current core information string and event it
    function UpdateDevice(dev) {
        // Check that the mesh exists
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeAmtDevice(dev, 15); return false; }

        // Get the node and change it if needed
        parent.db.Get(dev.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) return false;
            const device = nodes[0];
            var changes = [], change = 0, log = 0;
            var domain = parent.config.domains[device.domain];
            if (domain == null) return false;

            // Check if anything changes
            if (device.intelamt == null) { device.intelamt = {}; }
            if ((typeof dev.aquired.version == 'string') && (dev.aquired.version != device.intelamt.ver)) { change = 1; log = 1; device.intelamt.ver = dev.aquired.version; changes.push('AMT version'); }
            if ((typeof dev.aquired.user == 'string') && (dev.aquired.user != device.intelamt.user)) { change = 1; log = 1; device.intelamt.user = dev.aquired.user; changes.push('AMT user'); }
            if ((typeof dev.aquired.pass == 'string') && (dev.aquired.pass != device.intelamt.pass)) { change = 1; log = 1; device.intelamt.pass = dev.aquired.pass; changes.push('AMT pass'); }
            if ((typeof dev.aquired.mpspass == 'string') && (dev.aquired.mpspass != device.intelamt.mpspass)) { change = 1; log = 1; device.intelamt.mpspass = dev.aquired.mpspass; changes.push('AMT MPS pass'); }
            if ((typeof dev.aquired.host == 'string') && (dev.aquired.host != device.intelamt.host)) { change = 1; log = 1; device.intelamt.host = dev.aquired.host; changes.push('AMT host'); }
            if ((typeof dev.aquired.realm == 'string') && (dev.aquired.realm != device.intelamt.realm)) { change = 1; log = 1; device.intelamt.realm = dev.aquired.realm; changes.push('AMT realm'); }
            if ((typeof dev.aquired.hash == 'string') && (dev.aquired.hash != device.intelamt.hash)) { change = 1; log = 1; device.intelamt.hash = dev.aquired.hash; changes.push('AMT hash'); }
            if ((typeof dev.aquired.tls == 'number') && (dev.aquired.tls != device.intelamt.tls)) { change = 1; log = 1; device.intelamt.tls = dev.aquired.tls; /*changes.push('AMT TLS');*/ }
            if ((typeof dev.aquired.state == 'number') && (dev.aquired.state != device.intelamt.state)) { change = 1; log = 1; device.intelamt.state = dev.aquired.state; changes.push('AMT state'); }

            // Intel AMT Warning Flags: 1 = Unknown credentials, 2 = Realm Mismatch, 4 = TLS Cert Mismatch, 8 = Trying credentials
            if ((typeof dev.aquired.warn == 'number')) {
                if ((dev.aquired.warn == 0) && (device.intelamt.warn != null)) { delete device.intelamt.warn; change = 1; }
                else if ((dev.aquired.warn != 0) && (dev.aquired.warn != device.intelamt.warn)) { device.intelamt.warn = dev.aquired.warn; change = 1; }
            }

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
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.

        // Check that the mesh exists
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeAmtDevice(dev, 16); return; }

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


    //
    // Intel AMT Power State
    //

    // Get the current power state of a device
    function fetchPowerState(dev) {
        if (isAmtDeviceValid(dev) == false) return;

        // Check if the agent is connected
        var constate = parent.GetConnectivityState(dev.nodeid);
        if ((constate == null) || (constate.connectivity & 1)) return; // If there is no connectivity or the agent is connected, skip trying to poll power state.

        // Fetch the power state
        dev.amtstack.BatchEnum(null, ['CIM_ServiceAvailableToElement'], function (stack, name, responses, status) {
            const dev = stack.dev;
            if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.

            if ((status != 200) || (responses['CIM_ServiceAvailableToElement'] == null) || (responses['CIM_ServiceAvailableToElement'].responses == null) || (responses['CIM_ServiceAvailableToElement'].responses.length < 1)) return; // If the polling fails, just skip it.
            var powerstate = responses['CIM_ServiceAvailableToElement'].responses[0].PowerState;
            if ((powerstate == 2) && (dev.aquired.majorver != null) && (dev.aquired.majorver > 9)) {
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
                    if (meshPowerState >= 0) { parent.SetConnectivityState(dev.meshid, dev.nodeid, Date.now(), 4, meshPowerState, null, { name: dev.name }); }
                });
            } else {
                // Convert the power state
                // AMT power: 1 = Other, 2 = On, 3 = Sleep-Light, 4 = Sleep-Deep, 5 = Power Cycle (Off-Soft), 6 = Off-Hard, 7 = Hibernate (Off-Soft), 8 = Off-Soft, 9 = Power Cycle (Off-Hard), 10 = Master Bus Reset, 11 = Diagnostic Interrupt (NMI), 12 = Off-Soft Graceful, 13 = Off-Hard Graceful, 14 = Master Bus Reset Graceful, 15 = Power Cycle (Off- oft Graceful), 16 = Power Cycle (Off - Hard Graceful), 17 = Diagnostic Interrupt (INIT)
                // Mesh power: 0 = Unknown, 1 = S0 power on, 2 = S1 Sleep, 3 = S2 Sleep, 4 = S3 Sleep, 5 = S4 Hibernate, 6 = S5 Soft-Off, 7 = Present
                var meshPowerState = -1, powerConversionTable = [-1, -1, 1, 2, 3, 6, 6, 5, 6];
                if (powerstate < powerConversionTable.length) { meshPowerState = powerConversionTable[powerstate]; } else { powerstate = 6; }

                // Set power state
                if (meshPowerState >= 0) { parent.SetConnectivityState(dev.meshid, dev.nodeid, Date.now(), 4, meshPowerState, null, { name: dev.name }); }
            }
        });
    }

    // Perform a power action: 2 = Power up, 5 = Power cycle, 8 = Power down, 10 = Reset
    function performPowerAction(nodeid, action) {
        var devices = obj.amtDevices[nodeid];
        if (devices == null) return;
        for (var i in devices) {
            var dev = devices[i];
            // If not LMS, has a AMT stack present and is in connected state, perform power operation.
            if ((dev.connType != 2) && (dev.state == 1) && (dev.amtstack != null)) {
                // Action: 2 = Power on, 8 = Power down, 10 = reset
                dev.powerAction = action;
                try { dev.amtstack.RequestPowerStateChange(action, performPowerActionResponse); } catch (ex) { }
            }
        }
    }

    // Response to Intel AMT power action
    function performPowerActionResponse(stack, name, responses, status) {
        const dev = stack.dev;
        const action = dev.powerAction;
        delete dev.powerAction;
        if (obj.amtDevices[dev.nodeid] == null) return; // Device no longer exists, ignore this response.
        if (status != 200) return;

        // If this is Intel AMT 10 or higher and we are trying to wake the device, send an OS wake.
        // This will wake the device from "Modern Standby".
        if ((action == 2) && (dev.aquired.majorver > 9)) {
            try { dev.amtstack.RequestOSPowerStateChange(2, function (stack, name, response, status) { }); } catch (ex) { }
        }
    }


    //
    // Intel AMT One Click Recovery
    //

    // Perform Intel AMT One Click Recovery on a device
    function performOneClickRecoveryAction(nodeid, file) {
        var devices = obj.amtDevices[nodeid];
        if (devices == null) return;
        for (var i in devices) {
            var dev = devices[i];
            // If not LMS, has a AMT stack present and is in connected state, perform operation.
            if ((dev.connType != 2) && (dev.state == 1) && (dev.amtstack != null)) {
                // Make sure the MPS server root certificate is present.
                // Start by looking at existing certificates.
                dev.ocrfile = file;
                dev.amtstack.BatchEnum(null, ['AMT_PublicKeyCertificate', '*AMT_BootCapabilities'], performOneClickRecoveryActionEx);
            }
        }
    }

    // Response with list of certificates in Intel AMT
    function performOneClickRecoveryActionEx(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get security information (" + status + ")."); delete dev.ocrfile; return; }

        // Check if this Intel AMT device supports OCR
        if (responses['AMT_PublicKeyCertificate'].responses['ForceUEFIHTTPSBoot'] !== true) {
            dev.consoleMsg("This Intel AMT device does not support UEFI HTTPS boot  (" + status + ")."); delete dev.ocrfile; return;
        }

        // Organize the certificates and add the MPS root cert if missing
        var xxCertificates = responses['AMT_PublicKeyCertificate'].responses;
        for (var i in xxCertificates) {
            xxCertificates[i].TrustedRootCertficate = (xxCertificates[i]['TrustedRootCertficate'] == true);
            xxCertificates[i].X509CertificateBin = Buffer.from(xxCertificates[i]['X509Certificate'], 'base64').toString('binary');
            xxCertificates[i].XIssuer = parseCertName(xxCertificates[i]['Issuer']);
            xxCertificates[i].XSubject = parseCertName(xxCertificates[i]['Subject']);
        }
        dev.policy.certificates = xxCertificates;
        attemptRootCertSync(dev, performOneClickRecoveryActionEx2, true);
    }

    // MPS root certificate was added
    function performOneClickRecoveryActionEx2(dev) {
        // Ask for Boot Settings Data
        dev.amtstack.Get('AMT_BootSettingData', performOneClickRecoveryActionEx3, 0, 1);
    }

    // Getting Intel AMT Boot Settings Data
    function performOneClickRecoveryActionEx3(stack, name, response, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get boot settings data (" + status + ")."); delete dev.ocrfile; return; }

        // Generate the one-time URL.
        var cookie = obj.parent.encodeCookie({ a: 'f', f: dev.ocrfile }, obj.parent.loginCookieEncryptionKey)
        var url = 'https://' + parent.webserver.certificates.AmtMpsName + ':' + ((parent.args.mpsaliasport != null) ? parent.args.mpsaliasport : parent.args.mpsport) + '/c/' + cookie + '.iso';
        delete dev.ocrfile;

        // Generate the boot data for OCR with URL
        var r = response.Body;
        r['UefiBootParametersArray'] = Buffer.from(makeUefiBootParam(1, url) + makeUefiBootParam(20, 1, 1) + makeUefiBootParam(30, 0, 2), 'binary').toString('base64');
        r['UefiBootNumberOfParams'] = 3;
        r['BootMediaIndex'] = 0; // Do not use boot media index for One Click Recovery (OCR)

        // Set the boot order to null, this is needed for some Intel AMT versions that don't clear this automatically.
        dev.amtstack.CIM_BootConfigSetting_ChangeBootOrder(null, function (stack, name, response, status) {
            if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
            if (status != 200) { dev.consoleMsg("Failed to set boot order (" + status + ")."); return; }
            dev.amtstack.Put('AMT_BootSettingData', r, performOneClickRecoveryActionEx4, 0, 1);
        }, 0, 1);
    }

    // Intel AMT Put Boot Settings
    function performOneClickRecoveryActionEx4(stack, name, response, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to set boot settings data (" + status + ")."); return; }
        dev.amtstack.SetBootConfigRole(1, function (stack, name, response, status) {
            if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
            if (status != 200) { dev.consoleMsg("Failed to set boot config role (" + status + ")."); return; }
            var bootSource = 'Force OCR UEFI HTTPS Boot';
            dev.amtstack.CIM_BootConfigSetting_ChangeBootOrder((bootSource == null) ? bootSource : '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_BootSourceSetting</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="InstanceID">Intel(r) AMT: ' + bootSource + '</Selector></SelectorSet></ReferenceParameters>', function (stack, name, response, status) {
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to set boot config (" + status + ")."); return; }
                dev.amtstack.RequestPowerStateChange(10, function (stack, name, response, status) { // 10 = Reset, 2 = Power Up
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status != 200) { dev.consoleMsg("Failed to perform power action (" + status + ")."); return; }
                    console.log('One Click Recovery Completed.');
                });
            });
        }, 0, 1);
    }


    //
    // Intel AMT Clock Syncronization
    //

    // Attempt to sync the Intel AMT clock if needed, call func back when done.
    // Care should be take not to have many pending WSMAN called when performing clock sync.
    function attemptSyncClock(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (dev.policy.amtPolicy == 0) { func(dev); return; } // If there is no Intel AMT policy, skip this operation.
        dev.taskCount = 1;
        dev.taskCompleted = func;
        dev.amtstack.AMT_TimeSynchronizationService_GetLowAccuracyTimeSynch(attemptSyncClockEx);
    }

    // Intel AMT clock query response
    function attemptSyncClockEx(stack, name, response, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get clock (" + status + ")."); removeAmtDevice(dev, 17); return; }

        // Compute how much drift between Intel AMT and our clock.
        var t = new Date(), now = new Date();
        t.setTime(response.Body['Ta0'] * 1000);
        if (Math.abs(t - now) > 10000) { // If the Intel AMT clock is more than 10 seconds off, set it.
            dev.consoleMsg("Performing clock sync.");
            var Tm1 = Math.round(now.getTime() / 1000);
            dev.amtstack.AMT_TimeSynchronizationService_SetHighAccuracyTimeSynch(response.Body['Ta0'], Tm1, Tm1, attemptSyncClockSet);
        } else {
            // Clock is fine, we are done.
            devTaskCompleted(dev)
        }
    }

    // Intel AMT clock set response
    function attemptSyncClockSet(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to sync clock (" + status + ")."); removeAmtDevice(dev, 18); }
        devTaskCompleted(dev)
    }


    //
    // Intel AMT TLS setup
    //

    // Check if Intel AMT TLS state is correct
    function attemptTlsSync(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (dev.policy.amtPolicy == 0) { func(dev); return; } // If there is no Intel AMT policy, skip this operation.
        dev.taskCount = 1;
        dev.taskCompleted = func;
        // TODO: We only deal with certificates starting with Intel AMT 6 and beyond
        dev.amtstack.BatchEnum(null, ['AMT_PublicKeyCertificate', 'AMT_PublicPrivateKeyPair', 'AMT_TLSSettingData', 'AMT_TLSCredentialContext'], attemptTlsSyncEx);
    }

    // Intel AMT is not always in a good spot to generate a key pair. This will retry at 10 second interval.
    function generateKeyPairWithRetry(dev, func) {
        if (isAmtDeviceValid(dev) == false) return;
        if (dev.keyPairAttempts == null) { dev.keyPairAttempts = 1; } else { dev.keyPairAttempts++; }
        dev.amtstack.AMT_PublicKeyManagementService_GenerateKeyPair(0, 2048, function (stack, name, responses, status) {
            if (isAmtDeviceValid(dev) == false) { delete dev.keyPairAttempts; return; }
            if ((status == 200) || (dev.keyPairAttempts > 19)) {
                delete dev.keyPairAttempts;
                func(stack, name, responses, status);
            } else {
                if ((responses.Body != null) && (responses.Body.ReturnValue != null) && (responses.Body.ReturnValueStr != null)) {
                    dev.consoleMsg("Failed to generate a key pair (" + status + ", " + responses.Body.ReturnValue + ", \"" + responses.Body.ReturnValueStr + "\"), attempt " + dev.keyPairAttempts + ", trying again in 10 seconds...");
                } else {
                    dev.consoleMsg("Failed to generate a key pair (" + status + "), attempt " + dev.keyPairAttempts + ", trying again in 10 seconds...");
                }

                // Wait 10 seconds before attempting again
                var f = function doManage() { generateKeyPairWithRetry(doManage.dev, doManage.func); }
                f.dev = dev;
                f.func = func;
                setTimeout(f, 10000);
            }
        });
    }

    function attemptTlsSyncEx(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get security information (" + status + ")."); removeAmtDevice(dev, 19); return; }

        // Setup the certificates
        dev.policy.certPrivateKeys = responses['AMT_PublicPrivateKeyPair'].responses;
        dev.policy.tlsSettings = responses['AMT_TLSSettingData'].responses;
        dev.policy.tlsCredentialContext = responses['AMT_TLSCredentialContext'].responses;
        var xxCertificates = responses['AMT_PublicKeyCertificate'].responses;
        for (var i in xxCertificates) {
            xxCertificates[i].TrustedRootCertficate = (xxCertificates[i]['TrustedRootCertficate'] == true);
            xxCertificates[i].X509CertificateBin = Buffer.from(xxCertificates[i]['X509Certificate'], 'base64').toString('binary');
            xxCertificates[i].XIssuer = parseCertName(xxCertificates[i]['Issuer']);
            xxCertificates[i].XSubject = parseCertName(xxCertificates[i]['Subject']);
        }
        amtcert_linkCertPrivateKey(xxCertificates, dev.policy.certPrivateKeys);
        dev.policy.certificates = xxCertificates;

        // Find the current TLS certificate & MeshCentral root certificate
        var xxTlsCurrentCert = null;
        if (dev.policy.tlsCredentialContext.length > 0) {
            var certInstanceId = dev.policy.tlsCredentialContext[0]['ElementInContext']['ReferenceParameters']['SelectorSet']['Selector']['Value'];
            for (var i in dev.policy.certificates) { if (dev.policy.certificates[i]['InstanceID'] == certInstanceId) { xxTlsCurrentCert = i; } }
        }

        // This is a managed device and TLS is not enabled, turn it on.
        if (xxTlsCurrentCert == null) {
            // Start by generating a key pair
            generateKeyPairWithRetry(dev, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to generate a key pair (" + status + ")."); removeAmtDevice(dev, 20); return; }

                // Check that we get a key pair reference
                var x = null;
                try { x = responses.Body['KeyPair']['ReferenceParameters']['SelectorSet']['Selector']['Value']; } catch (ex) { }
                if (x == null) { dev.consoleMsg("Unable to get key pair reference."); removeAmtDevice(dev, 21); return; }

                // Get the new key pair
                dev.amtstack.Enum('AMT_PublicPrivateKeyPair', function (stack, name, responses, status, tag) {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status != 200) { dev.consoleMsg("Failed to get a key pair list (" + status + ")."); removeAmtDevice(dev, 22); return; }

                    // Get the new DER key
                    var DERKey = null;
                    for (var i in responses) { if (responses[i]['InstanceID'] == tag) { DERKey = responses[i]['DERKey']; } }

                    // Get certificate values
                    const commonName = 'IntelAMT-' + Buffer.from(parent.crypto.randomBytes(6), 'binary').toString('hex');
                    const domain = parent.config.domains[dev.domainid];
                    var serverName = 'MeshCentral';
                    if ((domain != null) && (domain.title != null)) { serverName = domain.title; }
                    const certattributes = { 'CN': commonName, 'O': serverName, 'ST': 'MC', 'C': 'MC' };

                    // See what root certificate to use to sign the TLS cert
                    var xxCaPrivateKey = obj.parent.certificates.root.key; // Use our own root by default
                    var issuerattributes = { 'CN': obj.rootCertCN };
                    if (domain.amtmanager.tlsrootcert2 != null) {
                        xxCaPrivateKey = domain.amtmanager.tlsrootcert2.key;
                        issuerattributes = domain.amtmanager.tlsrootcert2.attributes;
                        // TODO: We should change the start and end dates of our issued certificate to at least match the root.
                        // TODO: We could do one better and auto-renew TLS certificates as needed.
                    }

                    // Set the extended key usages
                    var extKeyUsage = { name: 'extKeyUsage', serverAuth: true, clientAuth: true }

                    // Sign the key pair using the CA certifiate
                    const cert = obj.amtcert_createCertificate(certattributes, xxCaPrivateKey, DERKey, issuerattributes, extKeyUsage);
                    if (cert == null) { dev.consoleMsg("Failed to sign the TLS certificate."); removeAmtDevice(dev, 23); return; }

                    // Place the resulting signed certificate back into AMT
                    var pem = obj.parent.certificateOperations.forge.pki.certificateToPem(cert).replace(/(\r\n|\n|\r)/gm, '');

                    // Set the certificate finderprint (SHA1)
                    var md = obj.parent.certificateOperations.forge.md.sha1.create();
                    md.update(obj.parent.certificateOperations.forge.asn1.toDer(obj.parent.certificateOperations.forge.pki.certificateToAsn1(cert)).getBytes());
                    dev.aquired.xhash = md.digest().toHex();

                    dev.amtstack.AMT_PublicKeyManagementService_AddCertificate(pem.substring(27, pem.length - 25), function (stack, name, responses, status) {
                        const dev = stack.dev;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status != 200) { dev.consoleMsg("Failed to add TLS certificate (" + status + ")."); removeAmtDevice(dev, 24); return; }
                        var certInstanceId = null;
                        try { certInstanceId = responses.Body['CreatedCertificate']['ReferenceParameters']['SelectorSet']['Selector']['Value']; } catch (ex) { }
                        if (certInstanceId == null) { dev.consoleMsg("Failed to get TLS certificate identifier."); removeAmtDevice(dev, 25); return; }

                        // Set the TLS certificate
                        if (dev.hbacmtls == 1) {
                            dev.setTlsSecurityPendingCalls = 2; // Set remote port only
                        } else {
                            dev.setTlsSecurityPendingCalls = 3; // Set local and remote port
                        }
                        if (dev.policy.tlsCredentialContext.length > 0) {
                            // Modify the current context
                            var newTLSCredentialContext = Clone(dev.policy.tlsCredentialContext[0]);
                            newTLSCredentialContext['ElementInContext']['ReferenceParameters']['SelectorSet']['Selector']['Value'] = certInstanceId;
                            dev.amtstack.Put('AMT_TLSCredentialContext', newTLSCredentialContext, amtSwitchToTls, 0, 1);
                        } else {
                            // Add a new security context
                            dev.amtstack.Create('AMT_TLSCredentialContext', {
                                'ElementInContext': '<a:Address>/wsman</a:Address><a:ReferenceParameters><w:ResourceURI>' + dev.amtstack.CompleteName('AMT_PublicKeyCertificate') + '</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">' + certInstanceId + '</w:Selector></w:SelectorSet></a:ReferenceParameters>',
                                'ElementProvidingContext': '<a:Address>/wsman</a:Address><a:ReferenceParameters><w:ResourceURI>' + dev.amtstack.CompleteName('AMT_TLSProtocolEndpointCollection') + '</w:ResourceURI><w:SelectorSet><w:Selector Name="ElementName">TLSProtocolEndpointInstances Collection</w:Selector></w:SelectorSet></a:ReferenceParameters>'
                            }, amtSwitchToTls);
                        }

                        // Figure out what index is local & remote
                        var localNdx = ((dev.policy.tlsSettings[0]['InstanceID'] == 'Intel(r) AMT LMS TLS Settings')) ? 0 : 1, remoteNdx = (1 - localNdx);

                        // Remote TLS settings
                        var xxTlsSettings2 = Clone(dev.policy.tlsSettings);
                        xxTlsSettings2[remoteNdx]['Enabled'] = true;
                        xxTlsSettings2[remoteNdx]['MutualAuthentication'] = false;
                        xxTlsSettings2[remoteNdx]['AcceptNonSecureConnections'] = true;
                        delete xxTlsSettings2[remoteNdx]['TrustedCN'];

                        // Local TLS settings
                        xxTlsSettings2[localNdx]['Enabled'] = true;
                        delete xxTlsSettings2[localNdx]['TrustedCN'];

                        if (dev.hbacmtls == 1) {
                            // If we are doing Host-based TLS ACM activation, you need to only enable the remote port with TLS.
                            // If you enable on local port, the commit will succeed but be ignored.
                            dev.consoleMsg("Enabling TLS on remote port...");
                            if (remoteNdx == 0) { dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[0], amtSwitchToTls, 0, 1, xxTlsSettings2[0]); }
                            else { dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[1], amtSwitchToTls, 0, 1, xxTlsSettings2[1]); }
                            delete dev.hbacmtls; // Remove this indication
                        } else {
                            // Update TLS settings
                            dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[0], amtSwitchToTls, 0, 1, xxTlsSettings2[0]);
                            dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[1], amtSwitchToTls, 0, 1, xxTlsSettings2[1]);
                        }
                    });

                }, responses.Body['KeyPair']['ReferenceParameters']['SelectorSet']['Selector']['Value']);
            });
        } else {
            // Update device in the database
            dev.intelamt.tls = dev.aquired.tls = 1;
            UpdateDevice(dev);

            // TLS is setup
            devTaskCompleted(dev);
        }
    }

    function amtSwitchToTls(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed setup TLS (" + status + ")."); removeAmtDevice(dev, 26); return; }

        // Check if all the calls are done & perform a commit
        if ((--dev.setTlsSecurityPendingCalls) == 0) {
            dev.consoleMsg("Performing Commit...");
            dev.amtstack.AMT_SetupAndConfigurationService_CommitChanges(null, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed perform commit (" + status + ")."); removeAmtDevice(dev, 27); return; }
                dev.consoleMsg("Enabled TLS, holding 10 seconds...");

                // Update device in the database
                dev.intelamt.tls = dev.aquired.tls = 1;
                dev.intelamt.hash = dev.aquired.hash = dev.aquired.xhash;
                delete dev.aquired.xhash;
                UpdateDevice(dev);

                // Switch our communications to TLS (Restart our management of this node)
                dev.switchToTls = 1;
                delete dev.tlsfail;

                // Wait 5 seconds before attempting to manage this device some more
                var f = function doManage() { if (isAmtDeviceValid(dev)) { devTaskCompleted(doManage.dev); } }
                f.dev = dev;
                setTimeout(f, 10000);
            });
        }
    }


    //
    // Intel AMT WIFI
    //

    // This method will sync the WIFI profiles from the device and the server, but does not care about profile priority.
    // We may want to work on an alternate version that does do priority if requested.
    function attemptWifiSync(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (dev.policy.amtPolicy == 0) { func(dev); return; } // If there is no Intel AMT policy, skip this operation.
        if (dev.connType != 2) { func(dev); return; } // Only configure wireless over a CIRA-LMS link
        //if (parent.config.domains[dev.domainid].amtmanager.wifiprofiles == null) { func(dev); return; } // No server WIFI profiles set, skip this.
        if ((dev.mpsConnection.tag.meiState == null) || (dev.mpsConnection.tag.meiState.net1 == null)) { func(dev); return; } // No WIFI on this device, skip this.

        // Get the current list of WIFI profiles and wireless interface state
        dev.taskCount = 1;
        dev.taskCompleted = func;
        dev.amtstack.BatchEnum(null, ['CIM_WiFiEndpointSettings', '*CIM_WiFiPort', '*AMT_WiFiPortConfigurationService'], function (stack, name, responses, status) {
            const dev = stack.dev;
            if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
            if (status != 200) { devTaskCompleted(dev); return; } // We can't get wireless settings, ignore and carry on.

            // If we have server WIFI profiles to sync, do this now.
            if (parent.config.domains[dev.domainid].amtmanager.wifiprofiles != null) {
                // The server and device WIFI profiles, find profiles to add and remove
                const sevProfiles = parent.config.domains[dev.domainid].amtmanager.wifiprofiles;
                const devProfiles = responses['CIM_WiFiEndpointSettings'].responses;
                var profilesToAdd = [], profilesToRemove = [];

                // Look at the WIFI profiles in the device
                for (var i in sevProfiles) {
                    var sevProfile = sevProfiles[i], match = false;
                    for (var j in devProfiles) {
                        var devProfile = devProfiles[j];
                        if (
                            (devProfile.ElementName == sevProfile.name) &&
                            (devProfile.SSID == sevProfile.ssid) &&
                            (devProfile.AuthenticationMethod == sevProfile.authentication) &&
                            (devProfile.EncryptionMethod == sevProfile.encryption) &&
                            (devProfile.BSSType == sevProfile.type)
                        ) { match = true; devProfile.match = true; }
                    }
                    if (match == false) { profilesToAdd.push(sevProfile); }
                }
                for (var j in devProfiles) {
                    var devProfile = devProfiles[j];
                    if (devProfile.match !== true) { profilesToRemove.push(devProfile); }
                }

                // Compute what priorities are allowed
                var prioritiesInUse = [];
                for (var j in devProfiles) { if (devProfiles[j].match == true) { prioritiesInUse.push(devProfiles[j].Priority); } }

                // Notify of WIFI profile changes
                if ((profilesToAdd.length > 0) || (profilesToRemove.length > 0)) { dev.consoleMsg("Changing WIFI profiles, adding " + profilesToAdd.length + ", removing " + profilesToRemove.length + "."); }

                // Remove any extra WIFI profiles
                for (var i in profilesToRemove) {
                    dev.amtstack.Delete('CIM_WiFiEndpointSettings', { InstanceID: 'Intel(r) AMT:WiFi Endpoint Settings ' + profilesToRemove[i].ElementName }, function (stack, name, responses, status) { }, 0, 1);
                }

                // Add missing WIFI profiles
                var nextPriority = 0;
                for (var i in profilesToAdd) {
                    while (prioritiesInUse.indexOf(nextPriority) >= 0) { nextPriority++; } // Figure out the next available priority slot.
                    var profileToAdd = profilesToAdd[i];
                    const wifiep = {
                        __parameterType: 'reference',
                        __resourceUri: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpoint',
                        Name: 'WiFi Endpoint 0'
                    };
                    const wifiepsettinginput = {
                        __parameterType: 'instance',
                        __namespace: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpointSettings',
                        ElementName: profileToAdd.name,
                        InstanceID: 'Intel(r) AMT:WiFi Endpoint Settings ' + profileToAdd.name,
                        AuthenticationMethod: profileToAdd.authentication,
                        EncryptionMethod: profileToAdd.encryption,
                        SSID: profileToAdd.ssid,
                        Priority: nextPriority,
                        PSKPassPhrase: profileToAdd.password
                    }
                    prioritiesInUse.push(nextPriority); // Occupy the priority slot and add the WIFI profile.
                    dev.amtstack.AMT_WiFiPortConfigurationService_AddWiFiSettings(wifiep, wifiepsettinginput, null, null, null, function (stack, name, responses, status) { });
                }
            }

            // Check if local WIFI profile sync is enabled, if not, enabled it.
            if ((responses['AMT_WiFiPortConfigurationService'] != null) && (responses['AMT_WiFiPortConfigurationService'].response != null) && (responses['AMT_WiFiPortConfigurationService'].response['localProfileSynchronizationEnabled'] == 0)) {
                responses['AMT_WiFiPortConfigurationService'].response['localProfileSynchronizationEnabled'] = 1;
                dev.amtstack.Put('AMT_WiFiPortConfigurationService', responses['AMT_WiFiPortConfigurationService'].response, function (stack, name, response, status) {
                    if (status != 200) { dev.consoleMsg("Unable to enable local WIFI profile sync."); } else { dev.consoleMsg("Enabled local WIFI profile sync."); }
                });
            }

            // Change the WIFI state if needed. Right now, we always enable it.
            // WifiState = { 3: "Disabled", 32768: "Enabled in S0", 32769: "Enabled in S0, Sx/AC" };
            var wifiState = 32769; // For now, always enable WIFI
            if (responses['CIM_WiFiPort'].responses.Body.EnabledState != 32769) {
                if (wifiState == 3) {
                    dev.amtstack.CIM_WiFiPort_RequestStateChange(wifiState, null, function (stack, name, responses, status) {
                        const dev = stack.dev;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status == 200) { dev.consoleMsg("Disabled WIFI."); }
                    });
                } else {
                    dev.amtstack.CIM_WiFiPort_RequestStateChange(wifiState, null, function (stack, name, responses, status) {
                        const dev = stack.dev;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status == 200) { dev.consoleMsg("Enabled WIFI."); }
                    });
                }
            }

            // Done
            devTaskCompleted(dev);
        });
    }


    //
    // Intel AMT Server Root Certificate
    //

    // Check if Intel AMT has the server root certificate
    function attemptRootCertSync(dev, func, forced) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (dev.policy.amtPolicy == 0) { func(dev); return; } // If there is no Intel AMT policy, skip this operation.
        if (forced !== true) { if ((dev.connType != 2) || (dev.policy.ciraPolicy != 2)) { func(dev); return; } } // Server root certificate does not need to be present if CIRA is not needed and "forced" is false
        if (parent.mpsserver.server == null) { func(dev); return; } // Root cert not needed if MPS is not active.

        // Find the current TLS certificate & MeshCentral root certificate
        var xxMeshCentralRoot = null;
        if (dev.policy.tlsCredentialContext.length > 0) {
            for (var i in dev.policy.certificates) { if (dev.policy.certificates[i]['X509Certificate'] == obj.rootCertBase64) { xxMeshCentralRoot = i; } }
        }

        // If the server root certificate is not present and we need to configure CIRA, add it
        if (xxMeshCentralRoot == null) {
            dev.taskCount = 1;
            dev.taskCompleted = func;
            dev.amtstack.AMT_PublicKeyManagementService_AddTrustedRootCertificate(obj.rootCertBase64, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to add server root certificate (" + status + ")."); removeAmtDevice(dev, 28); return; }
                dev.consoleMsg("Added server root certificate.");
                devTaskCompleted(dev);
            });
        } else { func(dev); }
    }


    //
    // Intel AMT CIRA Setup
    //

    // Check if Intel AMT has the server root certificate
    // If deactivation policy is in effect, remove CIRA configuration
    function attemptCiraSync(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if ((dev.connType != 2) || ((dev.policy.ciraPolicy != 1) && (dev.policy.ciraPolicy != 2))) { func(dev); return; } // Only setup CIRA when LMS connection is used and a CIRA policy is enabled.

        // Get current CIRA settings
        // TODO: We only deal with remote access starting with Intel AMT 6 and beyond
        dev.taskCount = 1;
        dev.taskCompleted = func;
        dev.tryCount = 0;
        var requests = ['*AMT_EnvironmentDetectionSettingData', 'AMT_ManagementPresenceRemoteSAP', 'AMT_RemoteAccessCredentialContext', 'AMT_RemoteAccessPolicyAppliesToMPS', 'AMT_RemoteAccessPolicyRule', '*AMT_UserInitiatedConnectionService', 'AMT_MPSUsernamePassword'];
        if ((dev.aquired.majorver != null) && (dev.aquired.majorver > 11)) { requests.push('*IPS_HTTPProxyService', 'IPS_HTTPProxyAccessPoint'); }
        dev.amtstack.BatchEnum(null, requests, attemptCiraSyncResponse);
    }

    function attemptCiraSyncResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.

        if ((dev.aquired.majorver != null) && (dev.aquired.majorver > 11) && (status == 400)) {
            // Check if only the HTTP proxy objects failed
            status = 200;
            if (responses['IPS_HTTPProxyAccessPoint'].status == 400) { delete responses['IPS_HTTPProxyAccessPoint']; }
            if (responses['IPS_HTTPProxyService'].status == 400) { delete responses['IPS_HTTPProxyService']; }
            for (var i in responses) { if (responses[i].status != 200) { status = responses[i].status; } }
        }

        // If batch enumeration was not succesful, try again.
        if (status != 200) {
            // If we failed to get the CIRA state, try again up to 5 times.
            if (dev.tryCount <= 5) {
                dev.tryCount++;
                var requests = ['*AMT_EnvironmentDetectionSettingData', 'AMT_ManagementPresenceRemoteSAP', 'AMT_RemoteAccessCredentialContext', 'AMT_RemoteAccessPolicyAppliesToMPS', 'AMT_RemoteAccessPolicyRule', '*AMT_UserInitiatedConnectionService', 'AMT_MPSUsernamePassword'];
                if ((dev.aquired.majorver != null) && (dev.aquired.majorver > 11)) { requests.push('*IPS_HTTPProxyService', 'IPS_HTTPProxyAccessPoint'); }
                dev.amtstack.BatchEnum(null, requests, attemptCiraSyncResponse);
                return;
            }

            // We tried 5 times, give up.
            dev.consoleMsg("Failed to get CIRA state (" + status + ").");
            removeAmtDevice(dev, 29);
            return;
        }

        // Check if CIRA is supported
        if ((responses['AMT_UserInitiatedConnectionService'] == null) || (responses['AMT_UserInitiatedConnectionService'].response == null)) {
            dev.consoleMsg("This device does not support CIRA.");
            devTaskCompleted(dev);
            return;
        }

        dev.cira = {};
        dev.cira.xxRemoteAccess = responses;
        dev.cira.xxEnvironementDetection = responses['AMT_EnvironmentDetectionSettingData'].response;
        dev.cira.xxEnvironementDetection['DetectionStrings'] = MakeToArray(dev.cira.xxEnvironementDetection['DetectionStrings']);
        dev.cira.xxCiraServers = responses['AMT_ManagementPresenceRemoteSAP'].responses;
        dev.cira.xxUserInitiatedCira = responses['AMT_UserInitiatedConnectionService'].response;
        dev.cira.xxRemoteAccessCredentiaLinks = responses['AMT_RemoteAccessCredentialContext'].responses;
        dev.cira.xxMPSUserPass = responses['AMT_MPSUsernamePassword'].responses;

        // Set CIRA initiation to BIOS & OS enabled
        if (dev.cira.xxUserInitiatedCira['EnabledState'] != 32771) { // 32768: "Disabled", 32769: "BIOS enabled", 32770: "OS enable", 32771: "BIOS & OS enabled"
            dev.amtstack.AMT_UserInitiatedConnectionService_RequestStateChange(32771, null, function (stack, name, responses, status) { }); // This is not a critical call.
        }

        // Figure out policies attached to servers. Create a policy type to server table.
        dev.cira.xxPolicies = { 'User': [], 'Alert': [], 'Periodic': [] };
        for (var i in responses['AMT_RemoteAccessPolicyAppliesToMPS'].responses) {
            var policy = responses['AMT_RemoteAccessPolicyAppliesToMPS'].responses[i];
            var server = Clone(getItem(dev.cira.xxCiraServers, 'Name', getItem(policy['ManagedElement']['ReferenceParameters']['SelectorSet']['Selector'], '@Name', 'Name')['Value']));
            server.MpsType = policy['MpsType']; // MpsType was added in Intel AMT 11.6
            var ptype = (getItem(policy['PolicySet']['ReferenceParameters']['SelectorSet']['Selector'], '@Name', 'PolicyRuleName')['Value']).split(' ')[0];
            dev.cira.xxPolicies[ptype].push(server);
        }

        // Fetch the server's CIRA settings
        dev.cira.mpsPresent = null;
        dev.cira.mpsPolicy = false;
        if ((dev.policy.ciraPolicy == 2) && (parent.mpsserver.server != null)) { // parent.mpsserver.server is not null if the MPS server is listening for TCP/TLS connections
            dev.cira.meshidx = dev.meshid.split('/')[2].replace(/\@/g, 'X').replace(/\$/g, 'X').substring(0, 16);
            dev.cira.mpsName = parent.webserver.certificates.AmtMpsName;
            var serverNameSplit = dev.cira.mpsName.split('.');
            dev.cira.mpsPort = ((parent.args.mpsaliasport != null) ? parent.args.mpsaliasport : parent.args.mpsport);
            dev.cira.mpsAddressFormat = 201; // 201 = FQDN, 3 = IPv4
            dev.cira.mpsPass = getRandomAmtPassword();
            if ((serverNameSplit.length == 4) && (parseInt(serverNameSplit[0]) == serverNameSplit[0]) && (parseInt(serverNameSplit[1]) == serverNameSplit[1]) && (parseInt(serverNameSplit[2]) == serverNameSplit[2]) && (parseInt(serverNameSplit[3]) == serverNameSplit[3])) { dev.cira.mpsAddressFormat = 3; }

            // Check if our server is already present
            if ((dev.cira.xxCiraServers != null) && (dev.cira.xxCiraServers.length > 0)) {
                for (var i = 0; i < dev.cira.xxCiraServers.length; i++) {
                    var mpsServer = dev.cira.xxCiraServers[i];
                    if ((mpsServer.AccessInfo == dev.cira.mpsName) && (mpsServer.Port == dev.cira.mpsPort) && (mpsServer.InfoFormat == dev.cira.mpsAddressFormat)) { dev.cira.mpsPresent = mpsServer['Name']; }
                }
            }

            // Check if our server is already present
            if ((dev.cira.xxPolicies != null) && (dev.cira.xxPolicies['Periodic'].length > 0)) {
                var mpsServer = dev.cira.xxPolicies['Periodic'][0];
                if ((mpsServer.AccessInfo == dev.cira.mpsName) && (mpsServer.Port == dev.cira.mpsPort) && (mpsServer.InfoFormat == dev.cira.mpsAddressFormat)) { dev.cira.mpsPolicy = true; }
            }
        }

        // Remove all MPS policies that are not ours
        if (dev.cira.xxPolicies != null) {
            if ((dev.cira.xxPolicies['User'] != null) && (dev.cira.xxPolicies['User'].length > 0)) { dev.consoleMsg("Removing CIRA user trigger."); dev.amtstack.Delete('AMT_RemoteAccessPolicyRule', { 'PolicyRuleName': 'User Initiated' }, function (stack, name, responses, status) { }); }
            if ((dev.cira.xxPolicies['Alert'] != null) && (dev.cira.xxPolicies['Alert'].length > 0)) { dev.consoleMsg("Removing CIRA alert trigger."); dev.amtstack.Delete('AMT_RemoteAccessPolicyRule', { 'PolicyRuleName': 'Alert' }, function (stack, name, responses, status) { }); }
            if ((dev.cira.xxPolicies['Periodic'] != null) && (dev.cira.xxPolicies['Periodic'].length > 0) && (dev.cira.mpsPolicy == false)) { dev.consoleMsg("Removing CIRA periodic trigger."); dev.amtstack.Delete('AMT_RemoteAccessPolicyRule', { 'PolicyRuleName': 'Periodic' }, function (stack, name, responses, status) { }); }
        }

        // Remove all MPS servers that are not ours
        if ((dev.cira.xxCiraServers != null) && (dev.cira.xxCiraServers.length > 0)) {
            for (var i = 0; i < dev.cira.xxCiraServers.length; i++) {
                var mpsServer = dev.cira.xxCiraServers[i];
                if ((mpsServer.AccessInfo != dev.cira.mpsName) || (mpsServer.Port != dev.cira.mpsPort) || (mpsServer.InfoFormat != dev.cira.mpsAddressFormat)) {
                    dev.consoleMsg("Removing MPS server.");
                    dev.amtstack.Delete('AMT_ManagementPresenceRemoteSAP', { 'Name': mpsServer['Name'] }, function (stack, name, responses, status) { });
                }
            }
        }

        // If we need to setup CIRA, start by checking the MPS server
        // parent.mpsserver.server is not null if the MPS server is listening for TCP/TLS connections
        if ((dev.policy.ciraPolicy == 2) && (parent.mpsserver.server != null)) { addMpsServer(dev); } else { checkEnvironmentDetection(dev); }
    }

    function addMpsServer(dev) {
        // Add the MPS server if not present
        if (dev.cira.mpsPresent == null) {
            dev.amtstack.AMT_RemoteAccessService_AddMpServer(dev.cira.mpsName, dev.cira.mpsAddressFormat, dev.cira.mpsPort, 2, null, dev.cira.meshidx, dev.cira.mpsPass, dev.cira.mpsName, function (stack, name, response, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to create new MPS server (" + status + ")."); removeAmtDevice(dev, 31); return; }
                if ((response.Body.MpServer == null) || (response.Body.MpServer.ReferenceParameters == null) || (response.Body.MpServer.ReferenceParameters.SelectorSet == null) || (response.Body.MpServer.ReferenceParameters.SelectorSet.Selector == null)) { dev.consoleMsg("Create new MPS server invalid response."); removeAmtDevice(dev, 32); return; }
                dev.cira.mpsPresent = getItem(response.Body.MpServer.ReferenceParameters.SelectorSet.Selector, '@Name', 'Name').Value;
                dev.consoleMsg("Created new MPS server.");
                addMpsPolicy(dev);

                // Update the device with the MPS password
                dev.aquired.mpspass = dev.cira.mpsPass;
                UpdateDevice(dev);
            });
        } else {
            // MPS server is present, check MPS trigger policy
            addMpsPolicy(dev);
        }
    }

    function addMpsPolicy(dev) {
        if (dev.cira.mpsPolicy == false) {
            var cilaSupport = ((dev.aquired.majorver != null) && (dev.aquired.minorver != null)) && ((dev.aquired.majorver > 11) || ((dev.aquired.majorver == 11) && (dev.aquired.minorver >= 6)));
            var trigger = 2; // 1 = Alert, 2 = Periodic

            // Setup extended data
            var extendedData = null;
            if (trigger == 2) {
                var timertype = 0; // 0 = Periodic, 1 = Time of day
                var exdata = IntToStr(10); // Interval trigger, 10 seconds
                extendedData = Buffer.from(IntToStr(timertype) + exdata, 'binary').toString('base64');
            }

            // Create the MPS server references
            var server1 = '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://intel.com/wbem/wscim/1/amt-schema/1/AMT_ManagementPresenceRemoteSAP</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="Name">' + dev.cira.mpsPresent + '</Selector></SelectorSet></ReferenceParameters>';
            var server2 = null;

            // Put the CIRA/CILA servers in the right bins.
            var ciraServers = [], cilaServers = [];
            if (server1) { ciraServers.push(server1); if (server2) { ciraServers.push(server2); } }

            // Go ahead and create the new CIRA/CILA policy.
            dev.amtstack.AMT_RemoteAccessService_AddRemoteAccessPolicyRule(trigger, 0, extendedData, ciraServers, cilaServers, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to create new MPS policy (" + status + ")."); removeAmtDevice(dev, 33); return; }
                dev.consoleMsg("Created new MPS policy.");
                checkEnvironmentDetection(dev);
            });
        } else {
            checkEnvironmentDetection(dev);
        }
    }

    function checkEnvironmentDetection(dev) {
        var changes = false;
        var editEnvironmentDetectionTmp = [];
        var currentEnvDetect = dev.cira.xxEnvironementDetection['DetectionStrings'];
        if (currentEnvDetect == null) { currentEnvDetect = []; }

        if ((dev.policy.ciraPolicy == 2) && (parent.mpsserver.server != null)) { // ciraPolicy: 0 = Do Nothing, 1 = Clear, 2 = Set
            const newEnvDetect = parent.config.domains[dev.domainid].amtmanager.environmentdetection;
            if (newEnvDetect == null) {
                // If no environment detection is specified in the config.json, check that we have a random environment detection
                if (currentEnvDetect.length == 0) { editEnvironmentDetectionTmp = [ Buffer.from(parent.crypto.randomBytes(6), 'binary').toString('hex') ]; changes = true; }
            } else {
                // Check that we have exactly the correct environement detection suffixes
                var mismatch = false;
                if (currentEnvDetect.length != newEnvDetect.length) {
                    mismatch = true;
                } else {
                    // Check if everything matches
                    for (var i in currentEnvDetect) { if (newEnvDetect.indexOf(currentEnvDetect[i]) == -1) { mismatch = true; } }
                    for (var i in newEnvDetect) { if (currentEnvDetect.indexOf(newEnvDetect[i]) == -1) { mismatch = true; } }
                }
                // If not, we need to set the new ones
                if (mismatch == true) { editEnvironmentDetectionTmp = newEnvDetect; changes = true; }
            }
            
        } else if ((dev.policy.ciraPolicy == 1) || (parent.mpsserver.server == null)) {
            // Check environment detection is clear
            if (currentEnvDetect.length != 0) { editEnvironmentDetectionTmp = []; changes = true; }
        }

        // If we need to change the environment detection on the remote device, do it now.
        if (changes == true) {
            var t = Clone(dev.cira.xxEnvironementDetection);
            t['DetectionStrings'] = editEnvironmentDetectionTmp;
            dev.cira.envclear = (editEnvironmentDetectionTmp.length == 0);
            dev.amtstack.Put('AMT_EnvironmentDetectionSettingData', t, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to set environement detection (" + status + ")."); removeAmtDevice(dev, 34); return; }
                if (dev.cira.envclear) { dev.consoleMsg("Environment detection cleared."); } else { dev.consoleMsg("Environment detection set."); }
                devTaskCompleted(dev);
            }, 0, 1);
        } else {
            devTaskCompleted(dev);
        }
    }


    //
    // Intel AMT Settings
    //

    function attemptSettingsSync(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (dev.policy.amtPolicy == 0) { func(dev); return; } // If there is no Intel AMT policy, skip this operation.
        dev.taskCount = 1;
        dev.taskCompleted = func;

        // Query the things we are going to be checking
        var query = ['*AMT_GeneralSettings', '*AMT_RedirectionService'];
        if ((dev.aquired.majorver != null) && (dev.aquired.majorver > 5)) { query.push('*CIM_KVMRedirectionSAP', '*IPS_OptInService'); }
        dev.amtstack.BatchEnum('', query, attemptSettingsSyncResponse);
    }


    function attemptSettingsSyncResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { devTaskCompleted(dev); return; }

        // If this device does not have KVM, ignore the response. This can happen for Intel Standard Manageability (Intel(R) SM).
        if ((responses['CIM_KVMRedirectionSAP'] == null) || (responses['CIM_KVMRedirectionSAP'].status == 400)) { responses['CIM_KVMRedirectionSAP'] = null; }

        // Set user consent requirement to match device group user consent
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeAmtDevice(dev, 35); return; }
        const userConsentRequirement = ((typeof mesh.consent == 'number') && ((mesh.consent & 8) != 0)) ? 1 : 0; // Enable user consent for KVM if device group desktop "Prompt for user consent" is enabled.

        // Check user consent requirements
        if ((responses['IPS_OptInService'] != null) && (responses['IPS_OptInService'].response['OptInRequired'] != userConsentRequirement)) {
            responses['IPS_OptInService'].response['OptInRequired'] = userConsentRequirement; // 0 = Not Required, 1 = Required for KVM only, 0xFFFFFFFF = Always Required
            dev.amtstack.Put('IPS_OptInService', responses['IPS_OptInService'].response, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status == 200) {
                    if (userConsentRequirement == 0) {
                        dev.consoleMsg("Cleared user consent requirements.");
                    } else if (userConsentRequirement == 1) {
                        dev.consoleMsg("Enabled KVM user consent requirement.");
                    } else if (userConsentRequirement == 0xFFFFFFFF) {
                        dev.consoleMsg("Enabled all user consent requirement.");
                    }
                }
            }, 0, 1);
        }
        
        // Enable SOL & IDER
        if ((responses['AMT_RedirectionService'].response['EnabledState'] != 32771) || (responses['AMT_RedirectionService'].response['ListenerEnabled'] == false)) {
            dev.redirObj = responses['AMT_RedirectionService'].response;
            dev.redirObj['ListenerEnabled'] = true;
            dev.redirObj['EnabledState'] = 32771;
            dev.taskCount++;
            dev.amtstack.AMT_RedirectionService_RequestStateChange(32771,
                function (stack, name, response, status) {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    dev.amtstack.Put('AMT_RedirectionService', dev.redirObj, function (stack, name, response, status) {
                        const dev = stack.dev;
                        delete dev.redirObj;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status == 200) { dev.consoleMsg("Enabled redirection features."); }
                        devTaskCompleted(dev);
                    }, 0, 1);
                }
            );
        }

        // Check KVM state
        if ((dev.aquired.majorver != null) && (dev.aquired.majorver > 5) && (responses['CIM_KVMRedirectionSAP'] != null)) {
            var kvm = (((responses['CIM_KVMRedirectionSAP'].response['EnabledState'] == 6) && (responses['CIM_KVMRedirectionSAP'].response['RequestedState'] == 2)) || (responses['CIM_KVMRedirectionSAP'].response['EnabledState'] == 2) || (responses['CIM_KVMRedirectionSAP'].response['EnabledState'] == 6));
            if (kvm == false) {
                // Enable KVM
                dev.taskCount++;
                dev.amtstack.CIM_KVMRedirectionSAP_RequestStateChange(2, 0,
                    function (stack, name, response, status) {
                        const dev = stack.dev;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status == 200) { dev.consoleMsg("Enabled KVM."); }
                        devTaskCompleted(dev);
                    }
                );
            }
        }

        // Check device name and domain name
        if ((dev.connType == 2) && (dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (typeof dev.mpsConnection.tag.meiState.OsHostname == 'string') && (typeof dev.mpsConnection.tag.meiState.OsDnsSuffix == 'string')) {
            const generalSettings = responses['AMT_GeneralSettings'].response;
            if ((generalSettings['HostName'] != dev.mpsConnection.tag.meiState.OsHostname) || (generalSettings['DomainName'] != dev.mpsConnection.tag.meiState.OsDnsSuffix)) {
                // Change the computer and domain name
                generalSettings['HostName'] = dev.mpsConnection.tag.meiState.OsHostname;
                generalSettings['DomainName'] = dev.mpsConnection.tag.meiState.OsDnsSuffix;
                dev.taskCount++;
                dev.xname = dev.mpsConnection.tag.meiState.OsHostname + '.' + dev.mpsConnection.tag.meiState.OsDnsSuffix;
                dev.amtstack.Put('AMT_GeneralSettings', generalSettings, function () {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status == 200) { dev.consoleMsg("Changed device name: " + dev.xname); }
                    delete dev.xname;
                    devTaskCompleted(dev);
                }, 0, 1);
            }
        }

        // Done
        devTaskCompleted(dev);
    }


    //
    // Intel AMT Hardware Inventory and Networking
    //

    function attemptFetchHardwareInventory(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { removeAmtDevice(dev, 35); return; }
        if (mesh.mtype == 1) { // If this is a Intel AMT only device group, pull the hardware inventory and network information for this device
            dev.consoleMsg("Fetching hardware inventory.");
            dev.taskCount = 2;
            dev.taskCompleted = func;
            dev.amtstack.BatchEnum('', ['*CIM_ComputerSystemPackage', 'CIM_SystemPackaging', '*CIM_Chassis', 'CIM_Chip', '*CIM_Card', '*CIM_BIOSElement', 'CIM_Processor', 'CIM_PhysicalMemory', 'CIM_MediaAccessDevice', 'CIM_PhysicalPackage'], attemptFetchHardwareInventoryResponse);
            dev.amtstack.BatchEnum('', ['AMT_EthernetPortSettings'], attemptFetchNetworkResponse);
        } else {
            if (func) { func(dev); }
        }
    }

    function attemptFetchNetworkResponse(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { devTaskCompleted(dev); return; }

        //console.log(JSON.stringify(responses, null, 2));
        if ((responses['AMT_EthernetPortSettings'] == null) || (responses['AMT_EthernetPortSettings'].responses == null)) { devTaskCompleted(dev); return; }

        // Find the wired and wireless interfaces
        var wired = null, wireless = null;
        for (var i in responses['AMT_EthernetPortSettings'].responses) {
            var netif = responses['AMT_EthernetPortSettings'].responses[i];
            if ((netif.MACAddress != null) && (netif.MACAddress != '00-00-00-00-00-00')) {
                if (netif.WLANLinkProtectionLevel != null) { wireless = netif; } else { wired = netif; }
            }
        }
        if ((wired == null) && (wireless == null)) { devTaskCompleted(dev); return; }

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
            net.netif2['Ethernet'] = [x];
        }

        if (wireless != null) {
            var x = {};
            x.family = 'IPv4';
            x.type = 'wireless';
            x.address = wireless.IPAddress;
            x.netmask = wireless.SubnetMask;
            x.mac = wireless.MACAddress.split('-').join(':').toUpperCase();
            x.gateway = wireless.DefaultGateway;
            net.netif2['Wireless'] = [x];
        }

        net.updateTime = Date.now();
        net._id = 'if' + dev.nodeid;
        net.type = 'ifinfo';
        parent.db.Set(net);

        // Event the node interface information change
        parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, { action: 'ifchange', nodeid: dev.nodeid, domain: dev.nodeid.split('/')[1], nolog: 1 });

        devTaskCompleted(dev);
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
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { devTaskCompleted(dev); return; }

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
                if (typeof m.PartNumber == 'string') { m2.PartNumber = m.PartNumber.trim(); }
                if (typeof m.PartNumber == 'number') { m2.PartNumber = m.PartNumber; }
                if (typeof m.SerialNumber == 'string') { m2.SerialNumber = m.SerialNumber.trim(); }
                if (typeof m.SerialNumber == 'number') { m2.SerialNumber = m.SerialNumber; }
                if (typeof m.Manufacturer == 'string') { m2.Manufacturer = m.Manufacturer.trim(); }
                if (typeof m.Manufacturer == 'number') { m2.Manufacturer = m.Manufacturer; }
                memory.push(m2);
            }
            hw2.hardware.windows.memory = memory;
        }
        if ((hw.MediaAccessDevice != null) && (hw.MediaAccessDevice.length > 0)) {
            var drives = [];
            for (var i in hw.MediaAccessDevice) {
                var m2 = {}, m = hw.MediaAccessDevice[i];
                m2.Caption = m.DeviceID;
                if (m.MaxMediaSize) { m2.Size = (m.MaxMediaSize * 1000); }
                drives.push(m2);
            }
            hw2.hardware.identifiers.storage_devices = drives;
        }
        if (hw.Bios != null) {
            if (typeof hw.Bios.Manufacturer == 'string') { hw2.hardware.identifiers.bios_vendor = hw.Bios.Manufacturer.trim(); }
            if (typeof hw.Bios.Manufacturer == 'number') { hw2.hardware.identifiers.bios_vendor = hw.Bios.Manufacturer; }
            hw2.hardware.identifiers.bios_version = hw.Bios.Version;
            if (hw.Bios.ReleaseDate && hw.Bios.ReleaseDate.Datetime) { hw2.hardware.identifiers.bios_date = hw.Bios.ReleaseDate.Datetime; }
        }
        if (hw.PhysicalPackage != null) {
            if (typeof hw.Card.Model == 'string') { hw2.hardware.identifiers.board_name = hw.Card.Model.trim(); }
            if (typeof hw.Card.Model == 'number') { hw2.hardware.identifiers.board_name = hw.Card.Model; }
            if (typeof hw.Card.Manufacturer == 'string') { hw2.hardware.identifiers.board_vendor = hw.Card.Manufacturer.trim(); }
            if (typeof hw.Card.Manufacturer == 'number') { hw2.hardware.identifiers.board_vendor = hw.Card.Manufacturer; }
            if (typeof hw.Card.Version == 'string') { hw2.hardware.identifiers.board_version = hw.Card.Version.trim(); }
            if (typeof hw.Card.Version == 'number') { hw2.hardware.identifiers.board_version = hw.Card.Version; }
            if (typeof hw.Card.SerialNumber == 'string') { hw2.hardware.identifiers.board_serial = hw.Card.SerialNumber.trim(); }
            if (typeof hw.Card.SerialNumber == 'number') { hw2.hardware.identifiers.board_serial = hw.Card.SerialNumber; }
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

        devTaskCompleted(dev);
    }


    //
    // Intel AMT Activation
    //

    function activateIntelAmt(dev) {
        // Find the Intel AMT policy
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { dev.consoleMsg("Unable to find device group (" + dev.meshid + ")."); removeAmtDevice(dev, 36); return false; }
        var amtPolicy = 0; // 0 = Do nothing, 1 = Deactivate CCM, 2 = CCM, 3 = ACM
        var ccmPolicy = 0; // Only used when in ACM policy: 0 = Do nothing, 1 = Deactivate CCM, 2 = CCM is ACM fails
        if (mesh.amt != null) { if (typeof mesh.amt.type == 'number') { amtPolicy = mesh.amt.type; } if (typeof mesh.amt.ccm == 'number') { ccmPolicy = mesh.amt.ccm; } }
        if ((typeof dev.mpsConnection.tag.meiState.OsAdmin != 'object') || (typeof dev.mpsConnection.tag.meiState.OsAdmin.user != 'string') || (typeof dev.mpsConnection.tag.meiState.OsAdmin.pass != 'string')) { amtPolicy = 0; }
        if (amtPolicy == 0) { removeAmtDevice(dev, 37); return false; } // Do nothing, we should not have gotten this CIRA-LMS connection.
        if (amtPolicy == 2) { activateIntelAmtCcm(dev, mesh.amt.password); } // Activate to CCM policy
        if ((amtPolicy == 3) || (amtPolicy == 4)) { // Activate to ACM policy
            var acminfo = checkAcmActivation(dev);
            if ((acminfo == null) || (acminfo.err != null)) {
                // No opportunity to activate to ACM, check if we are in CCM
                if ((dev.mpsConnection.tag.meiState.Flags & 2) != 0) {
                    if ((amtPolicy == 3) && (ccmPolicy == 1)) { deactivateIntelAmtCCM(dev); } // If we are in ACM policy and CCM is not allowed, deactivate it now.
                    else { return true; } // We are in CCM, keep going
                } else {
                    // We are not in CCM, go to CCM now
                    if ((amtPolicy == 4) || ((amtPolicy == 3) && (ccmPolicy == 2))) { activateIntelAmtCcm(dev, mesh.amt.password); } // If we are in full automatic or ACM with CCM allowed, setup CCM.
                    else {
                        // Unable to find an activation match.
                        if (acminfo == null) { dev.consoleMsg("No opportunity for ACM activation."); } else { dev.consoleMsg("No opportunity for ACM activation: " + acminfo.err); }
                        removeAmtDevice(dev, 38);
                        return false; // We are not in CCM and policy restricts use of CCM, so exit now.
                    } 
                }
            } else {
                // Found a certificate to activate to ACM.
                if ((dev.mpsConnection.tag.meiState.Flags & 2) != 0) {
                    // We are in CCM, deactivate CCM first.
                    deactivateIntelAmtCCM(dev);
                } else {
                    // We are not activated now, go to ACM directly.
                    // Check if we are allowed to perform TLS ACM activation
                    var TlsAcmActivation = false;
                    var domain = parent.config.domains[dev.domainid];
                    if (domain && domain.amtmanager && (domain.amtmanager.tlsacmactivation == true)) { TlsAcmActivation = true; }

                    // Check Intel AMT version
                    if (typeof dev.intelamt.ver == 'string') { var verSplit = dev.intelamt.ver.split('.'); if (verSplit.length >= 3) { dev.aquired.majorver = parseInt(verSplit[0]); dev.aquired.minorver = parseInt(verSplit[1]); } }

                    // If this is Intel AMT 14 or better and allowed, we are going to attempt a host-based end-to-end TLS activation.
                    if (TlsAcmActivation && (dev.aquired.majorver >= 14)) {
                        // Perform host-based TLS ACM activation
                        activateIntelAmtTlsAcm(dev, mesh.amt.password, acminfo);
                    } else {
                        // Perform host-based ACM activation
                        activateIntelAmtAcm(dev, mesh.amt.password, acminfo);
                    }
                }
            }
        }
        return false;
    }

    function activateIntelAmtCcm(dev, password) {
        // Generate a random Intel AMT password if needed
        if ((password == null) || (password == '')) { password = getRandomAmtPassword(); }
        dev.temp = { pass: password };

        // Setup the WSMAN stack, no TLS
        var comm = CreateWsmanComm(dev.nodeid, 16992, dev.mpsConnection.tag.meiState.OsAdmin.user, dev.mpsConnection.tag.meiState.OsAdmin.pass, 0, null, dev.mpsConnection); // No TLS
        var wsstack = WsmanStackCreateService(comm);
        dev.amtstack = AmtStackCreateService(wsstack);
        dev.amtstack.dev = dev;
        dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activateIntelAmtCcmEx1);
    }

    function activateIntelAmtCcmEx1(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get Intel AMT state."); removeAmtDevice(dev, 39); return; }
        if (responses['IPS_HostBasedSetupService'].response['AllowedControlModes'].length != 2) { dev.consoleMsg("Client control mode activation not allowed."); removeAmtDevice(dev, 40); return; }

        // Log the activation request, logging is a required step for activation.
        var domain = parent.config.domains[dev.domainid];
        if (domain == null) { dev.consoleMsg("Invalid domain."); removeAmtDevice(dev, 41); return; }
        if (parent.certificateOperations.logAmtActivation(domain, { time: new Date(), action: 'ccmactivate', domain: dev.domainid, amtUuid: dev.mpsConnection.tag.meiState.UUID, amtRealm: responses['AMT_GeneralSettings'].response['DigestRealm'], user: 'admin', password: dev.temp.pass, ipport: dev.mpsConnection.remoteAddr + ':' + dev.mpsConnection.remotePort, nodeid: dev.nodeid, meshid: dev.meshid, computerName: dev.name }) == false) {
            dev.consoleMsg("Unable to log operation."); removeAmtDevice(dev, 42); return;
        }

        // Perform CCM activation
        dev.amtstack.IPS_HostBasedSetupService_Setup(2, hex_md5('admin:' + responses['AMT_GeneralSettings'].response['DigestRealm'] + ':' + dev.temp.pass).substring(0, 32), null, null, null, null, activateIntelAmtCcmEx2);
    }

    function activateIntelAmtCcmEx2(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to activate Intel AMT to CCM."); removeAmtDevice(dev, 43); return; }

        // Update the device
        dev.aquired = {};
        dev.aquired.controlMode = 1; // 1 = CCM, 2 = ACM
        if (typeof dev.amtstack.wsman.comm.amtVersion == 'string') {
            var verSplit = dev.amtstack.wsman.comm.amtVersion.split('.');
            if (verSplit.length >= 3) { dev.aquired.version = verSplit[0] + '.' + verSplit[1] + '.' + verSplit[2]; dev.aquired.majorver = parseInt(verSplit[0]); dev.aquired.minorver = parseInt(verSplit[1]); }
        }
        if ((typeof dev.mpsConnection.tag.meiState.OsHostname == 'string') && (typeof dev.mpsConnection.tag.meiState.OsDnsSuffix == 'string')) {
            dev.aquired.host = dev.mpsConnection.tag.meiState.OsHostname + '.' + dev.mpsConnection.tag.meiState.OsDnsSuffix;
        }
        dev.aquired.realm = dev.amtstack.wsman.comm.digestRealm;
        dev.intelamt.user = dev.aquired.user = 'admin';
        dev.intelamt.pass = dev.aquired.pass = dev.temp.pass;
        dev.intelamt.tls = dev.aquired.tls = 0;
        dev.aquired.lastContact = Date.now();
        dev.aquired.state = 2; // Activated
        dev.aquired.warn = 0; // Clear all warnings
        delete dev.acctry;
        delete dev.temp;
        UpdateDevice(dev);

        // Success, switch to managing this device
        obj.parent.mpsserver.SendJsonControl(dev.mpsConnection, { action: 'mestate' }); // Request an MEI state refresh
        dev.consoleMsg("Succesfully activated in CCM mode, holding 10 seconds...");

        // Wait 10 seconds before attempting to manage this device in CCM
        var f = function doManage() { if (isAmtDeviceValid(dev)) { attemptInitialContact(doManage.dev); } }
        f.dev = dev;
        setTimeout(f, 10000);
    }

    // Check if this device has any way to be activated in ACM using our server certificates.
    function checkAcmActivation(dev) {
        var domain = parent.config.domains[dev.domainid];
        if ((domain == null) || (domain.amtacmactivation == null) || (domain.amtacmactivation.certs == null) || (domain.amtacmactivation.certs.length == 0)) return { err: "Server does not have any ACM activation certificates." };
        const activationCerts = domain.amtacmactivation.certs;
        if ((dev.mpsConnection.tag.meiState == null) || (dev.mpsConnection.tag.meiState.Hashes == null) || (dev.mpsConnection.tag.meiState.Hashes.length == 0)) return { err: "Intel AMT did not report any trusted hashes." };
        const deviceHashes = dev.mpsConnection.tag.meiState.Hashes;
        
        // Get the trusted FQDN of the device
        var trustedFqdn = null;
        if (dev.mpsConnection.tag.meiState.OsDnsSuffix != null) { trustedFqdn = dev.mpsConnection.tag.meiState.OsDnsSuffix; }
        if (dev.mpsConnection.tag.meiState.DnsSuffix != null) { trustedFqdn = dev.mpsConnection.tag.meiState.DnsSuffix; }
        if (trustedFqdn == null) return { err: "No trusted DNS suffix reported" };

        // Find a matching certificate
        var gotSuffixMatch = false;
        var devValidHash = false;
        for (var i in activationCerts) {
            var cert = activationCerts[i];
            var certDnsMatch = checkAcmActivationCertName(cert.cn, trustedFqdn);
            if (certDnsMatch == true) { gotSuffixMatch = true; } 
            if ((cert.cn == '*') || certDnsMatch) {
                for (var j in deviceHashes) {
                    var hashInfo = deviceHashes[j];
                    if ((hashInfo != null) && (hashInfo.isActive == 1)) {
                        devValidHash = true;
                        if ((hashInfo.hashAlgorithmStr == 'SHA256') && (hashInfo.certificateHash.toLowerCase() == cert.sha256)) { return { cert: cert, fqdn: trustedFqdn, hash: cert.sha256 }; } // Found a match
                        else if ((hashInfo.hashAlgorithmStr == 'SHA1') && (hashInfo.certificateHash.toLowerCase() == cert.sha1)) { return { cert: cert, fqdn: trustedFqdn, hash: cert.sha1 }; } // Found a match
                    }
                }
            }
        }
        if (!devValidHash) { return { err: "Intel AMT has no trusted root hashes for \"" + trustedFqdn + "\"." }; } // Found no trusted root hashes
        if (gotSuffixMatch) { return { err: "Certificate root hash matching failed for \"" + trustedFqdn + "\"." }; } // Found a DNS suffix match, but root hash failed to match.
        return { err: "No matching ACM activation certificate for \"" + trustedFqdn + "\"." }; // Did not find a match
    }

    // Return true if the trusted FQDN matched the certificate common name
    function checkAcmActivationCertName(commonName, trustedFqdn) {
        commonName = commonName.toLowerCase();
        trustedFqdn = trustedFqdn.toLowerCase();
        if (commonName.startsWith('*.') && (commonName.length > 2)) { commonName = commonName.substring(2); }
        return ((commonName == trustedFqdn) || (trustedFqdn.endsWith('.' + commonName)));
    }

    // Attempt Intel AMT TLS ACM activation
    function activateIntelAmtTlsAcm(dev, password, acminfo) {
        // Check if MeshAgent/MeshCMD can support the startConfigurationhostB() call.
        if ((dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (typeof dev.mpsConnection.tag.meiState['core-ver'] == 'number') && (dev.mpsConnection.tag.meiState['core-ver'] > 0)) {
            // Generate a random Intel AMT password if needed
            if ((password == null) || (password == '')) { password = getRandomAmtPassword(); }
            dev.temp = { pass: password, acminfo: acminfo };

            // Get our ACM activation certificate chain
            var acmTlsInfo = parent.certificateOperations.getAcmCertChain(parent.config.domains[dev.domainid], dev.temp.acminfo.fqdn, dev.temp.acminfo.hash);
            if (acmTlsInfo.error == 1) { dev.consoleMsg(acmTlsInfo.errorText); removeAmtDevice(dev, 44); return; }
            dev.acmTlsInfo = acmTlsInfo;

            // Send the MEI command to enable TLS connections
            dev.consoleMsg("Performing TLS ACM activation...");
            dev.controlMsg({ action: 'startTlsHostConfig', hash: acmTlsInfo.hash256, hostVpn: false, dnsSuffixList: null }); // TODO: Use SHA384 is possible.
        } else {
            // MeshCore or MeshCMD is to old
            dev.consoleMsg("This software is to old to support ACM activation, pleasse update and try again.");
            removeAmtDevice(dev);
        }
    }

    // Attempt Intel AMT TLS ACM activation after startConfiguration() is called on remote device
    function activateIntelAmtTlsAcmEx(dev, startConfigData) {
        if ((startConfigData == null) || (startConfigData.status != 0) || (typeof startConfigData.hash != 'string')) {
            // Unable to call startTlsHostConfig on remote host.
            dev.consoleMsg("Failed to startConfigurationHBased(), status = " + startConfigData.status);
            removeAmtDevice(dev);
        } else {
            // Setup the WSMAN stack, no TLS
            dev.consoleMsg("Attempting TLS connection...");
            var comm = CreateWsmanComm(dev.nodeid, 16993, 'admin', '', 1, { cert: dev.acmTlsInfo.certs.join(''), key: dev.acmTlsInfo.signkey }, dev.mpsConnection); // TLS with client certificate chain and key.
            comm.xtlsFingerprint = startConfigData.hash.toLowerCase(); // Intel AMT leaf TLS cert need to match this hash (SHA256 or SHA384)
            var wsstack = WsmanStackCreateService(comm);
            dev.amtstack = AmtStackCreateService(wsstack);
            dev.amtstack.dev = dev;
            dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', 'CIM_SoftwareIdentity', '*AMT_SetupAndConfigurationService'], activateIntelAmtTlsAcmEx1);
        }
    }

    function activateIntelAmtTlsAcmEx1(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.

        // Check if we succesfully connected
        if (status != 200) {
            dev.consoleMsg("Failed to perform ACM TLS connection, status " + status + ".");
            //activateIntelAmtAcm(dev); // It's possible to fallback to legacy WSMAN ACM activation here if we needed to..
            removeAmtDevice(dev);
            return;
        }

        // Fetch the Intel AMT version from WSMAN
        if ((responses != null) && (responses['CIM_SoftwareIdentity'] != null) && (responses['CIM_SoftwareIdentity'].responses != null)) {
            var amtlogicalelements = [];
            amtlogicalelements = responses['CIM_SoftwareIdentity'].responses;
            if (responses['AMT_SetupAndConfigurationService'] != null && responses['AMT_SetupAndConfigurationService'].response != null) {
                amtlogicalelements.push(responses['AMT_SetupAndConfigurationService'].response);
            }
            if (amtlogicalelements.length > 0) {
                var vs = getInstance(amtlogicalelements, 'AMT')['VersionString'];
                if (vs != null) {
                    dev.aquired.version = vs;
                    dev.aquired.versionmajor = parseInt(dev.aquired.version.split('.')[0]);
                    dev.aquired.versionminor = parseInt(dev.aquired.version.split('.')[1]);
                }
            }
        }

        // Fetch the Intel AMT version from HTTP stack
        if ((dev.amtversionstr == null) && (stack.wsman.comm.amtVersion != null)) {
            var s = stack.wsman.comm.amtVersion.split('.');
            if (s.length >= 3) {
                dev.aquired.version = s[0] + '.' + s[1] + '.' + s[2];
                dev.aquired.versionmajor = parseInt(s[0]);
                dev.aquired.versionminor = parseInt(s[1]);
            }
        }

        // If we can't get the Intel AMT version, stop here.
        if (dev.aquired.version == null) { dev.consoleMsg('Could not get Intel AMT version.'); removeAmtDevice(dev); return; } // Could not get Intel AMT version, disconnect();

        // Get the digest realm
        if (responses['AMT_GeneralSettings'] && responses['AMT_GeneralSettings'].response && (typeof responses['AMT_GeneralSettings'].response['DigestRealm'] == 'string')) {
            // Set the realm in the stack since we are not doing HTTP digest and this will be checked later by different code.
            dev.aquired.realm = dev.amtstack.wsman.comm.digestRealm = responses['AMT_GeneralSettings'].response['DigestRealm'];
        } else {
            dev.consoleMsg('Could not get Intel AMT digest realm.'); removeAmtDevice(dev); return;
        }

        // Looks like we are doing well.
        dev.consoleMsg('Succesful TLS connection, Intel AMT v' + dev.aquired.version);

        // Log this activation event
        var event = { etype: 'node', action: 'amtactivate', nodeid: dev.nodeid, domain: dev.domainid, msgid: 111, msgArgs: [dev.temp.acminfo.fqdn], msg: 'Device requested Intel(R) AMT ACM TLS activation, FQDN: ' + dev.temp.acminfo.fqdn };
        if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
        parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, event);

        // Log the activation request, logging is a required step for activation.
        var domain = parent.config.domains[dev.domainid];
        if (domain == null) { dev.consoleMsg("Invalid domain."); removeAmtDevice(dev, 41); return; }
        if (parent.certificateOperations.logAmtActivation(domain, { time: new Date(), action: 'acmactivate-tls', domain: dev.domainid, amtUuid: dev.mpsConnection.tag.meiState.UUID, amtRealm: dev.aquired.realm, user: 'admin', password: dev.temp.pass, ipport: dev.mpsConnection.remoteAddr + ':' + dev.mpsConnection.remotePort, nodeid: dev.nodeid, meshid: dev.meshid, computerName: dev.name }) == false) {
            dev.consoleMsg("Unable to log operation."); removeAmtDevice(dev, 42); return;
        }

        // See what admin password to use
        dev.aquired.user = 'admin';
        dev.aquired.pass = dev.temp.password;

        // Set the account password
        if (typeof dev.temp.mebxpass == 'string') {
            // Set the new MEBx password
            dev.consoleMsg('Setting MEBx password...');
            dev.amtstack.AMT_SetupAndConfigurationService_SetMEBxPassword(dev.temp.mebxpass, activateIntelAmtTlsAcmEx2);
        } else {
            // Set the admin password
            dev.consoleMsg('Setting admin password...');
            dev.amtstack.AMT_AuthorizationService_SetAdminAclEntryEx(dev.aquired.user, hex_md5(dev.aquired.user + ':' + dev.aquired.realm + ':' + dev.aquired.pass), activateIntelAmtTlsAcmEx3);
        }
    }

    // Response from setting MEBx password
    function activateIntelAmtTlsAcmEx2(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg('Failed to set MEBx password, status=' + status + '.'); destroyDevice(dev); return; }
        dev.consoleMsg('MEBx password set. Setting admin password...');

        // Set the admin password
        dev.amtstack.AMT_AuthorizationService_SetAdminAclEntryEx(dev.aquired.user, hex_md5(dev.aquired.user + ':' + dev.aquired.realm + ':' + dev.aquired.pass), activateIntelAmtTlsAcmEx3);
    }

    // Response from setting admin password
    function activateIntelAmtTlsAcmEx3(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg('Failed to set admin password, status=' + status + '.'); removeAmtDevice(dev); return; }
        dev.consoleMsg('Admin password set.');

        // Switch the state of Intel AMT.
        if ((dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null)) { dev.mpsConnection.tag.meiState.ProvisioningState = 2; }
        dev.aquired.controlMode = 2; // 1 = CCM, 2 = ACM
        dev.aquired.state = 2; // Activated
        dev.hbacmtls = 1; // Indicate that we are doing a Host

        // Proceed to going the normal Intel AMT sync. This will trigger a commit when the TLS cert is setup.
        dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], attemptLocalConnectResponse);
    }

    // Attempt Intel AMT ACM activation
    function activateIntelAmtAcm(dev, password, acminfo) {
        // Check if MeshAgent/MeshCMD can support the stopConfiguration() call.
        if ((dev.mpsConnection != null) && (dev.mpsConnection.tag != null) && (dev.mpsConnection.tag.meiState != null) && (typeof dev.mpsConnection.tag.meiState['core-ver'] == 'number') && (dev.mpsConnection.tag.meiState['core-ver'] > 0)) {
            // Generate a random Intel AMT password if needed
            if (acminfo != null) {
                if ((password == null) || (password == '')) { password = getRandomAmtPassword(); }
                dev.temp = { pass: password, acminfo: acminfo };
            }
            dev.acmactivate = 1;

            // Send the MEI command to stop configuration.
            // If Intel AMT is "in-provisioning" mode, the WSMAN ACM activation will not work, so we need to do this first.
            dev.consoleMsg("Getting ready for ACM activation...");
            dev.controlMsg({ action: 'stopConfiguration' });
        } else {
            // MeshCore or MeshCMD is to old
            dev.consoleMsg("This software is to old to support ACM activation, pleasse update and try again.");
            removeAmtDevice(dev);
        }
    }

    function activateIntelAmtAcmEx0(dev) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.

        // Setup the WSMAN stack, no TLS
        var comm = CreateWsmanComm(dev.nodeid, 16992, dev.mpsConnection.tag.meiState.OsAdmin.user, dev.mpsConnection.tag.meiState.OsAdmin.pass, 0, null, dev.mpsConnection); // No TLS
        var wsstack = WsmanStackCreateService(comm);
        dev.amtstack = AmtStackCreateService(wsstack);
        dev.amtstack.dev = dev;
        dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activateIntelAmtAcmEx1);
    }

    function activateIntelAmtAcmEx1(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get Intel AMT state."); removeAmtDevice(dev, 46); return; }

        // Sign the Intel AMT ACM activation request
        var info = { nonce: responses['IPS_HostBasedSetupService'].response['ConfigurationNonce'], realm: responses['AMT_GeneralSettings'].response['DigestRealm'], fqdn: dev.temp.acminfo.fqdn, hash: dev.temp.acminfo.hash, uuid: dev.mpsConnection.tag.meiState.UUID };
        var acmdata = parent.certificateOperations.signAcmRequest(parent.config.domains[dev.domainid], info, 'admin', dev.temp.pass, dev.mpsConnection.remoteAddr + ':' + dev.mpsConnection.remotePort, dev.nodeid, dev.meshid, dev.name, 0);
        if (acmdata == null) { dev.consoleMsg("Failed to sign ACM nonce."); removeAmtDevice(dev, 47); return; }
        if (acmdata.error != null) { dev.consoleMsg(acmdata.errorText); removeAmtDevice(dev, 48); return; }

        // Log this activation event
        var event = { etype: 'node', action: 'amtactivate', nodeid: dev.nodeid, domain: dev.domainid, msgid: 58, msgArgs: [ dev.temp.acminfo.fqdn ], msg: 'Device requested Intel(R) AMT ACM activation, FQDN: ' + dev.temp.acminfo.fqdn };
        if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
        parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, event);

        // Start the activation process
        dev.temp.acmdata = acmdata;
        dev.temp.acmdata.index = 0;
        dev.consoleMsg("Performing ACM activation...");
        activateIntelAmtAcmEx2(dev);
    }

    // Recursive function to inject the provisioning certificates into AMT in the proper order and completes ACM activation
    function activateIntelAmtAcmEx2(dev) {
        var acmdata = dev.temp.acmdata;
        var leaf = (acmdata.index == 0), root = (acmdata.index == (acmdata.certs.length - 1));
        if ((acmdata.index < acmdata.certs.length) && (acmdata.certs[acmdata.index] != null)) {
            dev.amtstack.IPS_HostBasedSetupService_AddNextCertInChain(acmdata.certs[acmdata.index], leaf, root,
                function (stack, name, responses, status) {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status != 200) { dev.consoleMsg("Failed to set ACM certificate chain (" + status + ")."); removeAmtDevice(dev, 49); return; }
                    if (responses['Body']['ReturnValue'] != 0) { dev.consoleMsg("Failed to set ACM certificate chain (ERR/" + responses['Body']['ReturnValue'] + ")."); removeAmtDevice(dev, 50); return; }

                    // Move to the next activation operation
                    dev.temp.acmdata.index++;
                    activateIntelAmtAcmEx2(dev);
                }
            );
        } else {
            dev.amtstack.IPS_HostBasedSetupService_AdminSetup(2, acmdata.password, acmdata.nonce, 2, acmdata.signature,
                function (stack, name, responses, status) {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status != 200) { dev.consoleMsg("Failed to complete ACM activation (" + status + ")."); removeAmtDevice(dev, 51); return; }
                    if (responses['Body']['ReturnValue'] != 0) { dev.consoleMsg("Failed to complete ACM activation (ERR/" + responses['Body']['ReturnValue'] + ")."); removeAmtDevice(dev, 52); return; }

                    // Success, switch to managing this device
                    obj.parent.mpsserver.SendJsonControl(dev.mpsConnection, { action: 'mestate' }); // Request an MEI state refresh
                    dev.consoleMsg("Succesfully activated in ACM mode, holding 10 seconds...");

                    // Update the device
                    dev.aquired = {};
                    dev.aquired.controlMode = 2; // 1 = CCM, 2 = ACM
                    if (typeof dev.amtstack.wsman.comm.amtVersion == 'string') {
                        var verSplit = dev.amtstack.wsman.comm.amtVersion.split('.');
                        if (verSplit.length >= 3) { dev.aquired.version = verSplit[0] + '.' + verSplit[1] + '.' + verSplit[2]; dev.aquired.majorver = parseInt(verSplit[0]); dev.aquired.minorver = parseInt(verSplit[1]); }
                    }
                    if ((typeof dev.mpsConnection.tag.meiState.OsHostname == 'string') && (typeof dev.mpsConnection.tag.meiState.OsDnsSuffix == 'string')) {
                        dev.aquired.host = dev.mpsConnection.tag.meiState.OsHostname + '.' + dev.mpsConnection.tag.meiState.OsDnsSuffix;
                    }
                    dev.aquired.realm = dev.amtstack.wsman.comm.digestRealm;
                    dev.intelamt.user = dev.aquired.user = 'admin';
                    dev.intelamt.pass = dev.aquired.pass = dev.temp.pass;
                    dev.intelamt.tls = dev.aquired.tls = 0;
                    dev.aquired.lastContact = Date.now();
                    dev.aquired.state = 2; // Activated
                    delete dev.acctry;
                    delete dev.temp;
                    UpdateDevice(dev);

                    // Wait 10 seconds before attempting to manage this device in ACM
                    var f = function doManage() { if (isAmtDeviceValid(dev)) { attemptInitialContact(doManage.dev); } }
                    f.dev = dev;
                    setTimeout(f, 10000);
                }
            );
        }
    }


    //
    // Intel AMT CCM deactivation
    //

    function deactivateIntelAmtCCM(dev) {
        dev.consoleMsg("Deactivating CCM...");
        dev.deactivateCcmPending = 1;
        dev.controlMsg({ action: 'deactivate' });
    }

    // This is called after the deactivation call
    function deactivateIntelAmtCCMEx(dev, state) {
        if (state != 0) {
            dev.consoleMsg("Failed to deactivate Intel AMT CCM.");
            removeAmtDevice(dev, 53);
        } else {
            // Update the device
            dev.aquired = {};
            dev.aquired.controlMode = 0; // 1 = CCM, 2 = ACM
            dev.aquired.state = 0; // Not activated
            delete dev.acctry;
            delete dev.amtstack;
            UpdateDevice(dev);

            if (dev.policy.amtPolicy == 1) { // Deactivation policy, we are done.
                dev.consoleMsg("Deactivation successful.");
                dev.consoleMsg("Done.");
                removeAmtDevice(dev, 54);
            } else {
                // Wait 20 seconds before attempting any operation on this device
                dev.consoleMsg("Deactivation successful, holding for 1 minute...");
                var f = function askMeiState() {
                    askMeiState.dev.pendingUpdatedMeiState = 1;
                    askMeiState.dev.controlMsg({ action: 'mestate' });
                }
                f.dev = dev;
                setTimeout(f, 60000);
            }
        }
    }


    //
    // General Methods
    //

    // Called this when a task is completed, when all tasks are completed the call back function will be called.
    function devTaskCompleted(dev) {
        dev.taskCount--;
        if (dev.taskCount == 0) { var f = dev.taskCompleted; delete dev.taskCount; delete dev.taskCompleted; if (f != null) { f(dev); } }
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + '-' + g.substring(10, 12) + g.substring(8, 10) + '-' + g.substring(14, 16) + g.substring(12, 14) + '-' + g.substring(16, 20) + '-' + g.substring(20); }

    // Check which key pair matches the public key in the certificate
    function amtcert_linkCertPrivateKey(certs, keys) {
        for (var i in certs) {
            var cert = certs[i];
            try {
                if (keys.length == 0) return;
                var b = obj.parent.certificateOperations.forge.asn1.fromDer(cert.X509CertificateBin);
                var a = obj.parent.certificateOperations.forge.pki.certificateFromAsn1(b).publicKey;
                var publicKeyPEM = obj.parent.certificateOperations.forge.pki.publicKeyToPem(a).substring(28 + 32).replace(/(\r\n|\n|\r)/gm, "");
                for (var j = 0; j < keys.length; j++) {
                    if (publicKeyPEM === (keys[j]['DERKey'] + '-----END PUBLIC KEY-----')) {
                        keys[j].XCert = cert; // Link the key pair to the certificate
                        cert.XPrivateKey = keys[j]; // Link the certificate to the key pair
                    }
                }
            } catch (ex) { console.log(ex); }
        }
    }

    // Generate a random Intel AMT password
    function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
    function getRandomAmtPassword() { var p; do { p = Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }
    function getRandomPassword() { return Buffer.from(parent.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); }
    function getRandomLowerCase(len) { var r = '', random = parent.crypto.randomBytes(len); for (var i = 0; i < len; i++) { r += String.fromCharCode(97 + (random[i] % 26)); } return r; }
    function getInstance(x, y) { for (var i in x) { if (x[i]['InstanceID'] == y) return x[i]; } return null; }

    function hex_md5(str) { return parent.crypto.createHash('md5').update(str).digest('hex'); }
    function Clone(v) { return JSON.parse(JSON.stringify(v)); }
    function MakeToArray(v) { if (!v || v == null || typeof v == 'object') return v; return [v]; }
    function getItem(x, y, z) { for (var i in x) { if (x[i][y] == z) return x[i]; } return null; }
    function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }

    // Returns a UEFI boot parameter in binary
    function makeUefiBootParam(type, data, len) {
        if (typeof data == 'number') { if (len == 1) { data = String.fromCharCode(data & 0xFF); } if (len == 2) { data = parent.common.ShortToStrX(data); } if (len == 4) { data = parent.common.IntToStrX(data); } }
        return parent.common.ShortToStrX(0x8086) + parent.common.ShortToStrX(type) + parent.common.IntToStrX(data.length) + data;
    }

    function parseCertName(x) {
        var j, r = {}, xx = x.split(',');
        for (var i in xx) { j = xx[i].indexOf('='); r[xx[i].substring(0, j)] = xx[i].substring(j + 1); }
        return r;
    }

    /*
    function amtcert_signWithCaKey(DERKey, caPrivateKey, certAttributes, issuerAttributes, extKeyUsage) {
        return obj.amtcert_createCertificate(certAttributes, caPrivateKey, DERKey, issuerAttributes, extKeyUsage);
    }
    */

    // --- Extended Key Usage OID's ---
    // 1.3.6.1.5.5.7.3.1            = TLS Server certificate
    // 1.3.6.1.5.5.7.3.2            = TLS Client certificate
    // 2.16.840.1.113741.1.2.1      = Intel AMT Remote Console
    // 2.16.840.1.113741.1.2.2      = Intel AMT Local Console
    // 2.16.840.1.113741.1.2.3      = Intel AMT Client Setup Certificate (Zero-Touch)

    // Generate a certificate with a set of attributes signed by a rootCert. If the rootCert is obmitted, the generated certificate is self-signed.
    obj.amtcert_createCertificate = function(certAttributes, caPrivateKey, DERKey, issuerAttributes, extKeyUsage) {
        // Generate a keypair and create an X.509v3 certificate
        var keys, cert = obj.parent.certificateOperations.forge.pki.createCertificate();
        cert.publicKey = obj.parent.certificateOperations.forge.pki.publicKeyFromPem('-----BEGIN PUBLIC KEY-----' + DERKey + '-----END PUBLIC KEY-----');
        cert.serialNumber = '' + Math.floor((Math.random() * 100000) + 1);
        cert.validity.notBefore = new Date(2018, 0, 1);
        //cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 1); // Create a certificate that is valid one year before, to make sure out-of-sync clocks don't reject this cert.
        cert.validity.notAfter = new Date(2049, 11, 31);
        //cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 20);
        var attrs = [];
        if (certAttributes['CN']) attrs.push({ name: 'commonName', value: certAttributes['CN'] });
        if (certAttributes['C']) attrs.push({ name: 'countryName', value: certAttributes['C'] });
        if (certAttributes['ST']) attrs.push({ shortName: 'ST', value: certAttributes['ST'] });
        if (certAttributes['O']) attrs.push({ name: 'organizationName', value: certAttributes['O'] });
        cert.setSubject(attrs);

        // Use root attributes
        var rootattrs = [];
        if (issuerAttributes['CN']) rootattrs.push({ name: 'commonName', value: issuerAttributes['CN'] });
        if (issuerAttributes['C']) rootattrs.push({ name: 'countryName', value: issuerAttributes['C'] });
        if (issuerAttributes['ST']) rootattrs.push({ shortName: 'ST', value: issuerAttributes['ST'] });
        if (issuerAttributes['O']) rootattrs.push({ name: 'organizationName', value: issuerAttributes['O'] });
        cert.setIssuer(rootattrs);

        if (extKeyUsage == null) { extKeyUsage = { name: 'extKeyUsage', serverAuth: true, } } else { extKeyUsage.name = 'extKeyUsage'; }

        /*
        {
            name: 'extKeyUsage',
            serverAuth: true,
            clientAuth: true,
            codeSigning: true,
            emailProtection: true,
            timeStamping: true,
            '2.16.840.1.113741.1.2.1': true
        }
        */

        // Create a leaf certificate
        cert.setExtensions([{
            name: 'basicConstraints'
        }, {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            }, extKeyUsage, {
                name: 'nsCertType',
                client: true,
                server: true,
                email: true,
                objsign: true,
            }, {
                name: 'subjectKeyIdentifier'
            }]);
    
        // Self-sign certificate
        var privatekey = obj.parent.certificateOperations.forge.pki.privateKeyFromPem(caPrivateKey);
        cert.sign(privatekey, obj.parent.certificateOperations.forge.md.sha256.create());
        return cert;
    }

    return obj;
};
