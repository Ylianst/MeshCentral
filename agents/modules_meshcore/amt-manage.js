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

/**
* @fileoverview Intel(r) AMT Management
* @author Ylian Saint-Hilaire
* @version v0.1.0
*/

/**
 * Construct a AmtStackCreateService object, this ia the main Intel AMT communication stack.
 * @constructor
 */
function AmtManager(agent, db, isdebug) {
    var sendConsole = function (msg) { agent.SendCommand({ "action": "msg", "type": "console", "value": msg }); }
    var debug = function (msg) { if (isdebug) { sendConsole('amt-manager: ' + msg + '<br />'); } }
    var amtMei = null, amtMeiState = 0;
    var amtLms = null, amtLmsState = 0;
    var amtGetVersionResult = null;
    var oswsstack = null;
    var osamtstack = null;
    var amtpolicy = null;
    var obj = this;
    var mestate;
    var trustedHashes = null;;
    obj.state = 0;
    obj.lmsstate = 0;
    obj.onStateChange = null;
    obj.setDebug = function (x) { isdebug = x; }
    
    // Set current Intel AMT activation policy
    obj.setPolicy = function (policy, forceApply) {
        if (forceApply || (JSON.stringify(amtpolicy) != JSON.stringify(policy))) {
            amtpolicy = policy;
            if (applyPolicyTimer == null) { applyPolicyTimer = setTimeout(obj.applyPolicy, 8000); }
        }
    }

    // Try to load up the MEI module
    var rebindToMeiRetrys = 0;
    obj.reset = function () {
        ++rebindToMeiRetrys;
        amtMei = null, amtMeiState = 0, amtLms = null, amtLmsState = 0, obj.state = 0, obj.lmsstate = 0;
        //debug('Binding to MEI');
        try {
            var amtMeiLib = require('amt-mei');
            amtMei = new amtMeiLib();
            amtMei.on('error', function (e) { debug('MEI error'); amtMei = null; amtMeiState = -1; obj.state = -1; if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); } });
            amtMei.getVersion(function (result) {
                if (result == null) {
                    amtMeiState = -1;
                    obj.state = -1;
                    if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); }
                    if (rebindToMeiRetrys < 10) { setTimeout(obj.reset, 10000); }
                } else {
                    amtGetVersionResult = result;
                    amtMeiState = 2;
                    obj.state = 2;
                    rebindToMeiRetrys = 0;
                    if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); }
                    //debug('MEI binded');
                    obj.lmsreset();
                }
            });
        } catch (ex) { debug('MEI exception: ' + ex); amtMei = null; amtMeiState = -1; obj.state = -1; }
    }

    // Get Intel AMT information using MEI
    var amtMeiTmpState = null;
    obj.getAmtInfo = function(func) {
        if ((amtMei == null) || (amtMeiState < 2)) { if (func != null) { func(null); } return; }
        try {
            amtMeiTmpState = { Flags: 0 }; // Flags: 1=EHBC, 2=CCM, 4=ACM
            amtMei.getProtocolVersion(function (result) { if (result != null) { amtMeiTmpState.MeiVersion = result; } });
            amtMei.getVersion(function (result) { if (result) { amtMeiTmpState.Versions = {}; for (var version in result.Versions) { amtMeiTmpState.Versions[result.Versions[version].Description] = result.Versions[version].Version; } } });
            amtMei.getProvisioningMode(function (result) { if (result) { amtMeiTmpState.ProvisioningMode = result.mode; } });
            amtMei.getProvisioningState(function (result) { if (result) { amtMeiTmpState.ProvisioningState = result.state; } });
            amtMei.getEHBCState(function (result) { if ((result != null) && (result.EHBC == true)) { amtMeiTmpState.Flags += 1; } });
            amtMei.getControlMode(function (result) { if (result != null) { if (result.controlMode == 1) { amtMeiTmpState.Flags += 2; } if (result.controlMode == 2) { amtMeiTmpState.Flags += 4; } } }); // Flag 2 = CCM, 4 = ACM
            //amtMei.getMACAddresses(function (result) { if (result) { amtMeiTmpState.mac = result; } });
            amtMei.getLanInterfaceSettings(0, function (result) { if (result) { amtMeiTmpState.net0 = result; } });
            amtMei.getLanInterfaceSettings(1, function (result) { if (result) { amtMeiTmpState.net1 = result; } });
            amtMei.getUuid(function (result) { if ((result != null) && (result.uuid != null)) { amtMeiTmpState.UUID = result.uuid; } });
            amtMei.getDnsSuffix(function (result) { if (result != null) { amtMeiTmpState.DNS = result; } if (func != null) { func(amtMeiTmpState); } });
        } catch (e) { if (func != null) { func(null); } return; }
    }

    // Called on MicroLMS Intel AMT user notification
    var handleAmtNotification = function(notifyMsg) {
        if ((notifyMsg == null) || (notifyMsg.Body == null) || (notifyMsg.Body.MessageID == null) || (notifyMsg.Body.MessageArguments == null)) return null;
        var amtMessage = notifyMsg.Body.MessageID, amtMessageArg = notifyMsg.Body.MessageArguments[0], notify = null;

        switch (amtMessage) {
            case 'iAMT0050': { if (amtMessageArg == '48') { notify = 'Intel&reg; AMT Serial-over-LAN connected'; } else if (amtMessageArg == '49') { notify = 'Intel&reg; AMT Serial-over-LAN disconnected'; } break; } // SOL
            case 'iAMT0052': { if (amtMessageArg == '1') { notify = 'Intel&reg; AMT KVM connected'; } else if (amtMessageArg == '2') { notify = 'Intel&reg; AMT KVM disconnected'; } break; } // KVM
            default: { break; }
        }

        // Sent to the entire group, no sessionid or userid specified.
        if (notify != null) { agent.SendCommand({ "action": "msg", "type": "notify", "value": notify, "tag": "general" }); }
    }

    // Launch LMS
    obj.lmsreset = function () {
        //debug('Binding to LMS');
        var amtLms = null, amtLmsState = 0;
        obj.lmsstate = 0;
        try {
            var lme_heci = require('amt-lme');
            amtLmsState = 1;
            obj.lmsstate = 1;
            amtLms = new lme_heci();
            amtLms.on('error', function (e) { amtLmsState = 0; obj.lmsstate = 0; amtLms = null; debug('LMS error'); setupMeiOsAdmin(1); });
            amtLms.on('connect', function () { amtLmsState = 2; obj.lmsstate = 2; debug('LMS connected'); setupMeiOsAdmin(2); });
            //amtLms.on('bind', function (map) { });
            amtLms.on('notify', function (data, options, str, code) {
                //debug('LMS notify');
                if (code == 'iAMT0052-3') {
                    kvmGetData();
                } else {
                    //if (str != null) { debug('Intel AMT LMS: ' + str); }
                    handleAmtNotification(data);
                }
            });
        } catch (e) { amtLmsState = -1; obj.lmsstate = -1; amtLms = null; }
    }


    //
    // KVM Data Channel
    //

    var setupMeiOsAdmin = function (state) {
        //debug('Setup MEI OS Admin');
        if ((amtMei == null) || (amtMeiState < 2) || (amtGetVersionResult == null)) { return; } // If there is no MEI, don't bother with obj.
        amtMei.getLocalSystemAccount(function (x) {
            if (x == null) return;
            //debug('getLocalSystemAccount ' + JSON.stringify(x));
            var transport = require('amt-wsman-duk');
            var wsman = require('amt-wsman');
            var amt = require('amt');
            oswsstack = new wsman(transport, '127.0.0.1', 16992, x.user, x.pass, false);
            osamtstack = new amt(oswsstack);
            //if (func) { func(state); }

            // We got the $$OsAdmin account setup.
            amtMeiState = 3;
            obj.state = 3;
            if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); }
            if (applyPolicyTimer == null) { obj.applyPolicy(); }

            //var AllWsman = "CIM_SoftwareIdentity,IPS_SecIOService,IPS_ScreenSettingData,IPS_ProvisioningRecordLog,IPS_HostBasedSetupService,IPS_HostIPSettings,IPS_IPv6PortSettings".split(',');
            //osamtstack.BatchEnum(null, AllWsman, startLmsWsmanResponse, null, true);
            //*************************************
            // Setup KVM data channel if this is Intel AMT 12 or above
            var amtver = null;
            try { for (var i in amtGetVersionResult.Versions) { if (amtGetVersionResult.Versions[i].Description == 'AMT') amtver = parseInt(amtGetVersionResult.Versions[i].Version.split('.')[0]); } } catch (e) { }
            if ((amtver != null) && (amtver >= 12)) {
                //debug('KVM data channel setup');
                kvmGetData('skip'); // Clear any previous data, this is a dummy read to about handling old data.
                obj.kvmTempTimer = setInterval(function () { kvmGetData(); }, 2000); // Start polling for KVM data.
                kvmSetData(JSON.stringify({ action: 'restart', ver: 1 })); // Send a restart command to advise the console if present that MicroLMS just started.
            }
        });
    }

    var kvmGetData = function (tag) {
        osamtstack.IPS_KVMRedirectionSettingData_DataChannelRead(obj.kvmDataGetResponse, tag);
    }

    var kvmDataGetResponse = function (stack, name, response, status, tag) {
        if ((tag != 'skip') && (status == 200) && (response.Body.ReturnValue == 0)) {
            var val = null;
            try { val = Buffer.from(response.Body.DataMessage, 'base64').toString(); } catch (e) { return }
            if (val != null) { obj.kvmProcessData(response.Body.RealmsBitmap, response.Body.MessageId, val); }
        }
    }

    var webRtcDesktop = null;
    var kvmProcessData = function (realms, messageId, val) {
        var data = null;
        try { data = JSON.parse(val) } catch (e) { }
        if ((data != null) && (data.action)) {
            if (data.action == 'present') { kvmSetData(JSON.stringify({ action: 'present', ver: 1, platform: process.platform })); }
            if (data.action == 'offer') {
                webRtcDesktop = {};
                var rtc = require('ILibWebRTC');
                webRtcDesktop.webrtc = rtc.createConnection();
                webRtcDesktop.webrtc.on('connected', function () { });
                webRtcDesktop.webrtc.on('disconnected', function () { obj.webRtcCleanUp(); });
                webRtcDesktop.webrtc.on('dataChannel', function (rtcchannel) {
                    webRtcDesktop.rtcchannel = rtcchannel;
                    webRtcDesktop.kvm = mesh.getRemoteDesktopStream();
                    webRtcDesktop.kvm.pipe(webRtcDesktop.rtcchannel, { dataTypeSkip: 1, end: false });
                    webRtcDesktop.rtcchannel.on('end', function () { obj.webRtcCleanUp(); });
                    webRtcDesktop.rtcchannel.on('data', function (x) { obj.kvmCtrlData(this, x); });
                    webRtcDesktop.rtcchannel.pipe(webRtcDesktop.kvm, { dataTypeSkip: 1, end: false });
                    //webRtcDesktop.kvm.on('end', function () { debug('WebRTC DataChannel closed2'); obj.webRtcCleanUp(); });
                    //webRtcDesktop.rtcchannel.on('data', function (data) { debug('WebRTC data: ' + data); });
                });
                kvmSetData(JSON.stringify({ action: 'answer', ver: 1, sdp: webRtcDesktop.webrtc.setOffer(data.sdp) }));
            }
        }
    }

    // Process KVM control channel data
    var kvmCtrlData = function (channel, cmd) {
        if (cmd.length > 0 && cmd.charCodeAt(0) != 123) {
            // This is upload data
            if (obj.fileupload != null) {
                cmd = Buffer.from(cmd, 'base64');
                var header = cmd.readUInt32BE(0);
                if ((header == 0x01000000) || (header == 0x01000001)) {
                    fs.writeSync(obj.fileupload.fp, cmd.slice(4));
                    channel.write({ action: 'upload', sub: 'ack', reqid: obj.fileupload.reqid });
                    if (header == 0x01000001) { fs.closeSync(obj.fileupload.fp); obj.fileupload = null; } // Close the file
                }
            }
            return;
        }
        debug('KVM Ctrl Data: ' + cmd);
        //sendConsoleText('KVM Ctrl Data: ' + cmd);

        try { cmd = JSON.parse(cmd); } catch (ex) { debug('Invalid JSON: ' + cmd); return; }
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
                var samepath = ((obj.httprequest.watcher != undefined) && (cmd.path == obj.httprequest.watcher.path));
                if ((obj.httprequest.watcher != undefined) && (samepath == false)) {
                    //console.log('Closing watcher: ' + obj.httprequest.watcher.path);
                    //obj.httprequest.watcher.close(); // TODO: This line causes the agent to crash!!!!
                    delete obj.httprequest.watcher;
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
                    watcher.tunnel = obj.httprequest;
                    watcher.path = cmd.path;
                    obj.httprequest.watcher = watcher;
                    //console.log('Starting watcher: ' + obj.httprequest.watcher.path);
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
                    try { fs.unlinkSync(fullpath); } catch (e) { debug(e); }
                }
                break;
            }
            case 'rename': {
                // Rename a file or folder
                try { fs.renameSync(path.join(cmd.path, cmd.oldname), path.join(cmd.path, cmd.newname)); } catch (e) { debug(e); }
                break;
            }
            case 'download': {
                // Download a file, to browser
                var sendNextBlock = 0;
                if (cmd.sub == 'start') { // Setup the download
                    if (obj.filedownload != null) { channel.write({ action: 'download', sub: 'cancel', id: obj.filedownload.id }); delete obj.filedownload; }
                    obj.filedownload = { id: cmd.id, path: cmd.path, ptr: 0 }
                    try { obj.filedownload.f = fs.openSync(obj.filedownload.path, 'rbN'); } catch (e) { channel.write({ action: 'download', sub: 'cancel', id: obj.filedownload.id }); delete obj.filedownload; }
                    if (obj.filedownload) { channel.write({ action: 'download', sub: 'start', id: cmd.id }); }
                } else if ((obj.filedownload != null) && (cmd.id == obj.filedownload.id)) { // Download commands
                    if (cmd.sub == 'startack') { sendNextBlock = 8; } else if (cmd.sub == 'stop') { delete obj.filedownload; } else if (cmd.sub == 'ack') { sendNextBlock = 1; }
                }
                // Send the next download block(s)
                while (sendNextBlock > 0) {
                    sendNextBlock--;
                    var buf = Buffer.alloc(4096);
                    var len = fs.readSync(obj.filedownload.f, buf, 4, 4092, null);
                    obj.filedownload.ptr += len;
                    if (len < 4092) { buf.writeInt32BE(0x01000001, 0); fs.closeSync(obj.filedownload.f); delete obj.filedownload; sendNextBlock = 0; } else { buf.writeInt32BE(0x01000000, 0); }
                    channel.write(buf.slice(0, len + 4).toString('base64')); // Write as Base64
                }
                break;
            }
            case 'upload': {
                // Upload a file, from browser
                if (cmd.sub == 'start') { // Start the upload
                    if (obj.fileupload != null) { fs.closeSync(obj.fileupload.fp); }
                    if (!cmd.path || !cmd.name) break;
                    obj.fileupload = { reqid: cmd.reqid };
                    var filepath = path.join(cmd.path, cmd.name);
                    try { obj.fileupload.fp = fs.openSync(filepath, 'wbN'); } catch (e) { }
                    if (obj.fileupload.fp) { channel.write({ action: 'upload', sub: 'start', reqid: obj.fileupload.reqid }); } else { obj.fileupload = null; channel.write({ action: 'upload', sub: 'error', reqid: obj.fileupload.reqid }); }
                }
                else if (cmd.sub == 'cancel') { // Stop the upload
                    if (obj.fileupload != null) { fs.closeSync(obj.fileupload.fp); obj.fileupload = null; }
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
            default: {
                debug('Invalid KVM command: ' + cmd);
                break;
            }
        }
    }

    var webRtcCleanUp = function () {
        debug('webRtcCleanUp');
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

    var kvmSetData = function (x) {
        osamtstack.IPS_KVMRedirectionSettingData_DataChannelWrite(Buffer.from(x).toString('base64'), function () { });
    }

    // Delete a directory with a files and directories within it
    var deleteFolderRecursive = function(path, rec) {
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

    function md5hex(str) { return require('MD5Stream').create().syncHash(str).toString('hex'); }

    //
    // Deactivate Intel AMT CCM
    //

    // When called, this will use MEI to deactivate Intel AMT when it's in CCM mode. Simply calls "unprovision" on MEI and checks the return code.
    obj.deactivateCCM = function() {
        amtMei.unprovision(1, function (status) {
            if (status == 0) {
                debug('Success deactivating Intel AMT CCM.');
                agent.SendCommand({ "action": "coreinfo", "intelamt": { "state": 0, "flags": 0 } });
                applyPolicyTimer = setTimeout(obj.applyPolicy, 8000);
            } else {
                debug('Intel AMT CCM deactivation error: ' + status);
            }
        });
    }

    //
    // Get Intel AMT activation hashes
    //
    obj.getTrustedHashes = function (func, tag) {
        if (trustedHashes != null) { func(tag); }
        trustedHashes = [];
        amtMei.getHashHandles(function (handles) {
            var exitOnCount = handles.length;
            for (var i = 0; i < handles.length; ++i) {
                this.getCertHashEntry(handles[i], function (result) {
                    if (result.isActive == 1) { trustedHashes.push(result.certificateHash.toLowerCase()); }
                    if (--exitOnCount == 0) { func(tag); }
                });
            }
        });
    }

    //
    // Activate Intel AMT to ACM
    //

    obj.activeToACM = function (mestate) {
        if ((mestate.ProvisioningState != 0) || (amtpolicy == null) || (amtpolicy.match == null)) return; // Can't activate unless in "PRE" activation mode & policy is present.
        var trustedFqdn = null;
        if ((mestate.net0 == null) && (mestate.net0.enabled != 0)) return; // Can't activate unless wired interface is active
        if (mestate.DNS) { trustedFqdn = mestate.DNS; } // If Intel AMT has a trusted DNS suffix set, use that one.
        else {
            // Look for the DNS suffix for the Intel AMT Ethernet interface
            var interfaces = require('os').networkInterfaces();
            for (var i in interfaces) {
                for (var j in interfaces[i]) {
                    if ((interfaces[i][j].mac == mestate.net0.mac) && (interfaces[i][j].fqdn != null) && (interfaces[i][j].fqdn != '')) { trustedFqdn = interfaces[i][j].fqdn.toLowerCase(); }
                }
            }
        }
        if (trustedFqdn == null) return; // No trusted DNS suffix.

        // Check if we have a ACM policy match
        var hashMatch = null;
        for (var i in amtpolicy.match) { var m = amtpolicy.match[i]; if (m.cn == trustedFqdn) { for (var j in trustedHashes) { if ((trustedHashes[j] == m.sha256) || (trustedHashes[j] == m.sha1)) { hashMatch = trustedHashes[j]; } } } }
        if (hashMatch == null) return; // No certificate / FQDN match

        // Fetch Intel AMT realm and activation nonce and get ready to ACM activation...
        if (osamtstack != null) {
            osamtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activeToACM2, { fqdn: trustedFqdn, hash: hashMatch, uuid: mestate.UUID });
        } else {
            amtMei.getLocalSystemAccount(function (x) {
                if ((x != null) && x.user && x.pass) {
                    var transport = require('amt-wsman-duk');
                    var wsman = require('amt-wsman');
                    var amt = require('amt');
                    oswsstack = new wsman(transport, '127.0.0.1', 16992, x.user, x.pass, false);
                    osamtstack = new amt(oswsstack);
                    osamtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activeToACM2, { fqdn: trustedFqdn, hash: hashMatch, uuid: mestate.UUID });
                }
            });
        }
    }

    function activeToACM2(stack, name, responses, status, tag) {
        if (status != 200) return;
        var fwNonce = responses['IPS_HostBasedSetupService'].response['ConfigurationNonce'];
        var digestRealm = responses['AMT_GeneralSettings'].response['DigestRealm'];
        agent.SendCommand({ "action": "acmactivate", "nonce": fwNonce, "realm": digestRealm, "fqdn": tag.fqdn, "hash": tag.hash, "uuid": tag.uuid });
    }

    // Called when the server responds with a ACM activation signature.
    obj.setAcmResponse = function (acmdata) { acmdata.index = 0; performAcmActivation(acmdata); }

    // Recursive function to inject the provisioning certificates into AMT in the proper order and completes ACM activation
    function performAcmActivation(acmdata) {
        var leaf = (acmdata.index == 0), root = (acmdata.index == (acmdata.certs.length - 1));
        if ((acmdata.index < acmdata.certs.length) && (acmdata.certs[acmdata.index] != null)) {
            osamtstack.IPS_HostBasedSetupService_AddNextCertInChain(acmdata.certs[acmdata.index], leaf, root, function (stack, name, responses, status) {
                if (status !== 200) { debug('AddNextCertInChain status=' + status); return; }
                else if (responses['Body']['ReturnValue'] !== 0) { debug('AddNextCertInChain error=' + responses['Body']['ReturnValue']); return; }
                else { acmdata.index++; performAcmActivation(acmdata); }
            });
        } else {
            osamtstack.IPS_HostBasedSetupService_AdminSetup(2, acmdata.password, acmdata.nonce, 2, acmdata.signature,
                function (stack, name, responses, status) {
                    if ((status == 200) && (responses['Body']['ReturnValue'] == 0)) {
                        // ACM activation success, force an update to the server so it can get our new state.
                        if (obj.onStateChange != null) { obj.onStateChange(2); }
                    }
                }
            );
        }
    }

    //
    // Activate Intel AMT to CCM
    //

    function makePass(length) {
        var text = "", possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (var i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
        return text;
    }

    obj.activeToCCM = function (adminpass) {
        if ((adminpass == null) || (adminpass == '')) { adminpass = 'P@0s' + makePass(23); }
        intelAmtAdminPass = adminpass;
        if (osamtstack != null) {
            osamtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activeToCCMEx2, adminpass);
        } else {
            //debug('Trying to get local account info...');
            amtMei.getLocalSystemAccount(function (x) {
                if ((x != null) && x.user && x.pass) {
                    //debug('Intel AMT local account info: User=' + x.user + ', Pass=' + x.pass + '.');
                    var transport = require('amt-wsman-duk');
                    var wsman = require('amt-wsman');
                    var amt = require('amt');
                    oswsstack = new wsman(transport, '127.0.0.1', 16992, x.user, x.pass, false);
                    osamtstack = new amt(oswsstack);
                    //debug('Trying to get Intel AMT activation information...');
                    osamtstack.BatchEnum(null, ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService'], activeToCCMEx2, adminpass);
                } else {
                    //debug('Unable to get $$OsAdmin password.');
                }
            });
        }
    }

    var activeToCCMEx2 = function(stack, name, responses, status, adminpass) {
        if (status != 200) { debug('Failed to fetch activation information, status ' + status); }
        else if (responses['IPS_HostBasedSetupService'].response['AllowedControlModes'].length != 2) { debug('Client control mode activation not allowed'); }
        else { stack.IPS_HostBasedSetupService_Setup(2, md5hex('admin:' + responses['AMT_GeneralSettings'].response['DigestRealm'] + ':' + adminpass).substring(0, 32), null, null, null, null, activeToCCMEx3); }
    }

    var activeToCCMEx3 = function(stack, name, responses, status) {
        if (status != 200) { debug('Failed to activate, status ' + status); }
        else if (responses.Body.ReturnValue != 0) { debug('Client control mode activation failed: ' + responses.Body.ReturnValueStr); }
        else {
            debug('Intel AMT CCM activation success.');
            db.Put('amtCCMPass', intelAmtAdminPass);
            agent.SendCommand({ "action": "coreinfo", "intelamt": { "state": 2, "flags": 2, "user": "admin", "pass": intelAmtAdminPass } });
        }
        applyPolicyTimer = setTimeout(obj.applyPolicy, 8000);
    }

    obj.start = function () {
        // Try to load Intel AMT policy
        var amtPolicy = null;
        try { amtPolicy = JSON.parse(db.Get('amtPolicy')); } catch (ex) { debug('Exception loading amtPolicy'); }
        //if (amtPolicy == null) { debug('no amtPolicy'); } else { debug('Loaded amtPolicy: ' + JSON.stringify(amtPolicy)); }
        try { intelAmtAdminPass = db.Get('amtCCMPass'); } catch (ex) { }
        if (typeof intelAmtAdminPass != 'string') { intelAmtAdminPass = null; }
        obj.reset();
    }

    // Apply Intel AMT policy
    var intelAmtAdminPass, wsstack, amtstack, applyPolicyTimer, policyWsmanRetry = 0;
    obj.applyPolicy = function () {
        applyPolicyTimer = null;
        if ((amtMeiState != 3) || (amtpolicy == null) || (typeof amtpolicy != 'object') || (typeof amtpolicy.type != 'number') || (amtpolicy.type == 0)) return;
        if ((amtpolicy.password != null) && (amtpolicy.password != '')) { intelAmtAdminPass = amtpolicy.password; }
        obj.getAmtInfo(function (meinfo) {
            if ((amtpolicy.type == 1) && (meinfo.ProvisioningState == 2) && ((meinfo.Flags & 2) != 0)) {
                // CCM Deactivation Policy.
                wsstack = amtstack = null;
                obj.deactivateCCM();
            } else if ((amtpolicy.type == 2) && (meinfo.ProvisioningState == 0)) {
                // CCM Activation Policy
                wsstack = amtstack = null;
                if ((amtpolicy.password == null) || (amtpolicy.password == '')) { intelAmtAdminPass = null; }
                obj.activeToCCM(intelAmtAdminPass);
            } else if ((amtpolicy.type == 2) && (meinfo.ProvisioningState == 2) && (intelAmtAdminPass != null) && ((meinfo.Flags & 2) != 0)) {
                // Perform password test
                var transport = require('amt-wsman-duk');
                var wsman = require('amt-wsman');
                var amt = require('amt');
                wsstack = new wsman(transport, '127.0.0.1', 16992, 'admin', intelAmtAdminPass, false);
                amtstack = new amt(wsstack);
                var wsmanQuery = ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService', '*AMT_RedirectionService', '*CIM_KVMRedirectionSAP', 'AMT_PublicKeyCertificate', '*AMT_EnvironmentDetectionSettingData'];
                if (amtpolicy.cirasetup == 2) { wsmanQuery.push("AMT_ManagementPresenceRemoteSAP", "AMT_RemoteAccessCredentialContext", "AMT_RemoteAccessPolicyAppliesToMPS", "AMT_RemoteAccessPolicyRule", "*AMT_UserInitiatedConnectionService", "AMT_MPSUsernamePassword"); }
                try { amtstack.BatchEnum(null, wsmanQuery, wsmanPassTestResponse); } catch (ex) { debug(ex); }
            } else if ((amtpolicy.type == 3) && (meinfo.ProvisioningState == 0) && (agent.isControlChannelConnected)) {
                // ACM Activation Policy
                obj.getTrustedHashes(obj.activeToACM, meinfo);
            } else {
                // Other possible cases...
            }
        });
    }

    function wsmanPassTestResponse(stack, name, responses, status) {
        if (status != 200) {
            if (status == 401) {
                if (amtpolicy.badpass == 1) { obj.deactivateCCM(); } // Incorrect password, reactivate
            } else {
                if (++policyWsmanRetry < 20) {
                    if (policyWsmanRetry == 10) { debug('WSMAN fault, MEI Reset'); obj.reset(); }
                    var wsmanQuery = ['*AMT_GeneralSettings', '*IPS_HostBasedSetupService', '*AMT_RedirectionService', '*CIM_KVMRedirectionSAP', 'AMT_PublicKeyCertificate', '*AMT_EnvironmentDetectionSettingData'];
                    if (amtpolicy.cirasetup == 2) { wsmanQuery.push("AMT_ManagementPresenceRemoteSAP", "AMT_RemoteAccessCredentialContext", "AMT_RemoteAccessPolicyAppliesToMPS", "AMT_RemoteAccessPolicyRule", "*AMT_UserInitiatedConnectionService", "AMT_MPSUsernamePassword"); }
                    try { amtstack.BatchEnum(null, wsmanQuery, wsmanPassTestResponse); } catch (ex) { debug(ex); }
                } else {
                    debug('WSMAN fault, status=' + status);
                    policyWsmanRetry = 0;
                }
            }
        } else {
            policyWsmanRetry = 0;
            var s = {};
            s.redir = (responses['AMT_RedirectionService'].response["ListenerEnabled"] == true);
            s.sol = ((responses['AMT_RedirectionService'].response["EnabledState"] & 2) != 0);
            s.ider = ((responses['AMT_RedirectionService'].response["EnabledState"] & 1) != 0);
            s.kvm = (responses['CIM_KVMRedirectionSAP'] != null) && ((responses['CIM_KVMRedirectionSAP'].response["EnabledState"] == 6 && responses['CIM_KVMRedirectionSAP'].response["RequestedState"] == 2) || responses['CIM_KVMRedirectionSAP'].response["EnabledState"] == 2 || responses['CIM_KVMRedirectionSAP'].response["EnabledState"] == 6);
            
            // Enable Ping and RMCP if disabled
            if ((responses['AMT_GeneralSettings'].response['PingResponseEnabled'] != true) || (responses['AMT_GeneralSettings'].response['RmcpPingResponseEnabled'] != true)) {
                responses['AMT_GeneralSettings'].response['PingResponseEnabled'] = true;
                responses['AMT_GeneralSettings'].response['RmcpPingResponseEnabled'] = true;
                amtstack.Put('AMT_GeneralSettings', responses['AMT_GeneralSettings'].response, function (stack, name, response, status) { if (status != 200) { debug("Enable PING PUT Error " + status); } }, 0, 1)
            }

            // Enable redirection port, SOL and IDER if needed
            if ((s.redir == false) || (s.sol == false) || (s.ider == false)) {
                var r = responses['AMT_RedirectionService'].response;
                r["ListenerEnabled"] = true; // Turn on the redirection port
                r["EnabledState"] = 32768 + 1 + 2; // Turn on IDER (1) and SOL (2)
                amtstack.AMT_RedirectionService_RequestStateChange(r["EnabledState"], function (stack, name, response, status) { if (status != 200) { debug("Enable Redirection EXEC Error " + status); } });
            }
            
            // Enable KVM if needed
            if ((responses['CIM_KVMRedirectionSAP'] != null) && (s.kvm == false)) {
                amtstack.CIM_KVMRedirectionSAP_RequestStateChange(2, 0,
                    function (stack, name, response, status) {
                        if (status != 200) { messagebox("Error", "KVMRedirectionSAP, RequestStateChange Error " + status); return; }
                        amtstack.Put("AMT_RedirectionService", r, function (stack, name, response, status) { if (status != 200) { debug("Enable KVM PUT Error " + status); } }, 0, 1)
                    }
                );
            }
            
            // Check if the MeshCentral root certificate is present
            if (typeof amtpolicy.rootcert == 'string') {
                var rootFound = false, xxCertificates = responses["AMT_PublicKeyCertificate"].responses;
                for (var i in xxCertificates) { if ((xxCertificates[i]["X509Certificate"] == amtpolicy.rootcert) && (xxCertificates[i]["TrustedRootCertficate"] == true)) { rootFound = true; } }
                if (rootFound == false) { amtstack.AMT_PublicKeyManagementService_AddTrustedRootCertificate(amtpolicy.rootcert, function (stack, name, response, status) { if (status != 200) { debug("Add root cert EXEC Error " + status); } }); }
            }
            
            // If CIRA needs to be setup
            if ((amtpolicy.cirasetup == 2) && (amtpolicy.ciraserver != null)) {
                var serverFound = false, xxCiraServers = responses["AMT_ManagementPresenceRemoteSAP"].responses;
                for (var i in xxCiraServers) { if ((xxCiraServers[i].AccessInfo == amtpolicy.ciraserver.name) && (xxCiraServers[i].Port == amtpolicy.ciraserver.port)) { serverFound = xxCiraServers[i].Name; } }
                if (serverFound == false) {
                    // TODO: Remove all CIRA activation policies.
                    // amtstack.Delete('AMT_RemoteAccessPolicyRule', { 'PolicyRuleName': name }, editMpsPolicyOk2);
                    // TODO: Remove all other MPS servers.

                    // Add our MPS server
                    amtstack.AMT_RemoteAccessService_AddMpServer(amtpolicy.ciraserver.name, 201, amtpolicy.ciraserver.port, 2, null, amtpolicy.ciraserver.user, amtpolicy.ciraserver.pass, null, function (stack, name, response, status) {
                        if (status != 200) {
                            debug("Add MPS server EXEC Error " + status);
                        } else {
                            serverFound = false;
                            var x = response.Body.MpServer.ReferenceParameters.SelectorSet.Selector;
                            for (var i in x) { if (x[i]['@Name'] == 'Name') { serverFound = x[i]['Value']; } }
                            if (serverFound != false) { checkCiraTriggerPolicy(responses, serverFound); }
                        }
                    });
                } else {
                    checkCiraTriggerPolicy(responses, serverFound);
                }
            } else if (amtpolicy.cirasetup == 1) {
                // This call will clear environement detection if needed.
                checkEnvironmentDetection(responses);
            }
        }
    }

    function checkCiraTriggerPolicy(responses, serverInstanceName) {
        // Check CIRA activation policy
        var server1 = '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://intel.com/wbem/wscim/1/amt-schema/1/AMT_ManagementPresenceRemoteSAP</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="Name">' + serverInstanceName + '</Selector></SelectorSet></ReferenceParameters>';
        amtstack.AMT_RemoteAccessService_AddRemoteAccessPolicyRule(2, 0, 'AAAAAAAAAAo=', [server1], null, function (stack, name, response, status) {
            if (status != 200) {
                debug("Add AddRemoteAccessPolicyRule Error " + status);
            } else {
                //debug('AMT_RemoteAccessService_AddRemoteAccessPolicyRule Response:' + JSON.stringify(response));
                checkEnvironmentDetection(responses);
            }
        });
    }

    // Check environement detection. This will set or clear the environement detection strings as needed.
    function checkEnvironmentDetection(responses) {
        var t2 = [];
        if ((amtpolicy.ciraserver != null) && (amtpolicy.ciraserver.home != null)) { t2 = amtpolicy.ciraserver.home; }
        var t = responses["AMT_EnvironmentDetectionSettingData"].response;
        t['DetectionStrings'] = MakeToArray(t['DetectionStrings']);
        if (CompareStrArrays(t['DetectionStrings'], t2) == false) {
            t['DetectionStrings'] = t2;
            amtstack.Put('AMT_EnvironmentDetectionSettingData', t, function (stack, name, response, status) { if (status != 200) { debug("Put AMT_EnvironmentDetectionSettingData Error " + status); } }, 0, 1);
        }
    }
    
    // Imperfect compare of two string arrays.
    function CompareStrArrays(arr1, arr2) {
        if (arr1 == arr2) return true;
        if (arr1 == null) { arr1 = []; }
        if (arr2 == null) { arr2 = []; }
        if (arr1.length != arr2.length) return false;
        for (var i in arr1) { if (arr2.indexOf(arr1[i]) == -1) return false; }
        return true;
    }

    function MakeToArray(v) { if (!v || v == null || typeof v == "object") return v; return [v]; };

}

module.exports = AmtManager;
