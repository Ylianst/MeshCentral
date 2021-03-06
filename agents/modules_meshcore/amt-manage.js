/*
Copyright 2018-2021 Intel Corporation

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
    var sendConsole = function (msg) { agent.SendCommand({ 'action': 'msg', 'type': 'console', 'value': msg }); }
    var debug = function (msg) { if (isdebug) { sendConsole('amt-manager: ' + msg + '<br />'); } }
    var amtMei = null, amtMeiState = 0;
    var amtLms = null, amtLmsState = 0;
    var amtGetVersionResult = null;
    var obj = this;
    var mestate;
    var trustedHashes = null;;

    require('events').EventEmitter.call(obj, true)
        .createEvent('stateChange_LMS')
        .createEvent('portBinding_LMS');
    obj._lmsstate = 0;
    obj._mapping = [];

    obj.on('newListener', function (name, callback) {
        if (name == 'portBinding_LMS') { callback.call(this, this._mapping); }
    });

    Object.defineProperty(obj, 'lmsstate',
        {
            get: function () { return (this._lmsstate); },
            set: function (value) { if (this._lmsstate != value) { this._lmsstate = value; this.emit('stateChange_LMS', value); } }
        });

    obj.state = 0;
    obj.onStateChange = null;
    obj.setDebug = function (x) { isdebug = x; }

    // Try to load up the MEI module
    var rebindToMeiRetrys = 0;
    obj.reset = function () {
        ++rebindToMeiRetrys;
        obj.amtMei = null, amtMei = null, amtMeiState = 0, amtLms = null, amtLmsState = 0, obj.state = 0, obj.lmsstate = 0;
        //debug('Binding to MEI');
        try {
            var amtMeiLib = require('amt-mei');
            obj.amtMei = amtMei = new amtMeiLib();
            amtMei.on('error', function (e) { debug('MEI error'); amtMei = null; amtMeiState = -1; obj.state = -1; if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); } });
            amtMei.getVersion(function (result) {
                if (result == null) {
                    obj.state = amtMeiState = -1;
                    if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); }
                    if (rebindToMeiRetrys < 10) { setTimeout(obj.reset, 10000); }
                } else {
                    amtGetVersionResult = result;
                    obj.state = amtMeiState = 2;
                    rebindToMeiRetrys = 0;
                    if (obj.onStateChange != null) { obj.onStateChange(amtMeiState); }
                    //debug('MEI binded');
                    obj.lmsreset();
                }
            });
        } catch (ex) { debug("MEI exception: " + ex); amtMei = null; amtMeiState = -1; obj.state = -1; }
    }

    // Get Intel MEI State in a flexible way
    // Flags: 1 = Versions, 2 = OsAdmin, 4 = Hashes, 8 = Network
    var getMeiStateCache = {}; // Some MEI calls will only be made once and cached here.
    obj.getMeiState = function(flags, func) {
        if ((amtMei == null) || (amtMeiState < 2)) { if (func != null) { func(null); } return; }
        try {
            var amtMeiTmpState = { 'core-ver': 1, OsHostname: require('os').hostname(), Flags: 0 }; // Flags: 1=EHBC, 2=CCM, 4=ACM
            if (getMeiStateCache.MeiVersion != null) { amtMeiTmpState.MeiVersion = getMeiStateCache.MeiVersion; } else { amtMei.getProtocolVersion(function (result) { if (result != null) { getMeiStateCache.MeiVersion = amtMeiTmpState.MeiVersion = result; } }); }
            if ((flags & 1) != 0) {
                if (getMeiStateCache.Versions != null) {
                    amtMeiTmpState.Versions = getMeiStateCache.Versions;
                } else {
                    amtMei.getVersion(function (result) { if (result) { getMeiStateCache.Versions = amtMeiTmpState.Versions = {}; for (var version in result.Versions) { amtMeiTmpState.Versions[result.Versions[version].Description] = result.Versions[version].Version; } } });
                }
            }
            amtMei.getProvisioningMode(function (result) { if (result) { amtMeiTmpState.ProvisioningMode = result.mode; } });
            amtMei.getProvisioningState(function (result) { if (result) { amtMeiTmpState.ProvisioningState = result.state; if (result.state != 2) { amtMei.stopConfiguration(function () { }); } } }); // 0: "Not Activated (Pre)", 1: "Not Activated (In)", 2: "Activated". Make sure to stop remote configuration if needed.
            amtMei.getEHBCState(function (result) { if ((result != null) && (result.EHBC == true)) { amtMeiTmpState.Flags += 1; } });
            amtMei.getControlMode(function (result) { if (result != null) { if (result.controlMode == 1) { amtMeiTmpState.Flags += 2; } if (result.controlMode == 2) { amtMeiTmpState.Flags += 4; } } }); // Flag 2 = CCM, 4 = ACM
            //amtMei.getMACAddresses(function (result) { if (result) { amtMeiTmpState.mac = result; } });
            if ((flags & 8) != 0) {
                amtMei.getLanInterfaceSettings(0, function (result) {
                    if (result) {
                        amtMeiTmpState.net0 = result;
                        var fqdn = null, interfaces = require('os').networkInterfaces(); // Look for the DNS suffix for the Intel AMT Ethernet interface
                        for (var i in interfaces) { for (var j in interfaces[i]) { if ((interfaces[i][j].mac == result.mac) && (interfaces[i][j].fqdn != null) && (interfaces[i][j].fqdn != '')) { amtMeiTmpState.OsDnsSuffix = interfaces[i][j].fqdn; } } }
                    }
                });
                amtMei.getLanInterfaceSettings(1, function (result) { if (result) { amtMeiTmpState.net1 = result; } });
            }
            if (getMeiStateCache.UUID != null) { amtMeiTmpState.UUID = getMeiStateCache.UUID; } else { amtMei.getUuid(function (result) { if ((result != null) && (result.uuid != null)) { getMeiStateCache.UUID = amtMeiTmpState.UUID = result.uuid; } }); }
            if ((flags & 2) != 0) { amtMei.getLocalSystemAccount(function (x) { if ((x != null) && x.user && x.pass) { amtMeiTmpState.OsAdmin = { user: x.user, pass: x.pass }; } }); }
            amtMei.getDnsSuffix(function (result) { if (result != null) { amtMeiTmpState.DnsSuffix = result; } if ((flags & 4) == 0) { if (func != null) { func(amtMeiTmpState); } } });
            if ((flags & 4) != 0) {
                amtMei.getHashHandles(function (handles) {
                    if ((handles != null) && (handles.length > 0)) { amtMeiTmpState.Hashes = []; } else { func(amtMeiTmpState); }
                    var exitOnCount = handles.length;
                    for (var i = 0; i < handles.length; ++i) { this.getCertHashEntry(handles[i], function (hashresult) { amtMeiTmpState.Hashes.push(hashresult); if (--exitOnCount == 0) { if (func != null) { func(amtMeiTmpState); } } }); }
                });
            }
        } catch (e) { if (func != null) { func(null); } return; }
    }

    // Called on MicroLMS Intel AMT user notification
    var handleAmtNotification = function (notifyMsg) {
        if ((notifyMsg == null) || (notifyMsg.Body == null) || (notifyMsg.Body.MessageID == null) || (notifyMsg.Body.MessageArguments == null)) return null;
        var amtMessage = notifyMsg.Body.MessageID, amtMessageArg = notifyMsg.Body.MessageArguments[0], notify = null;

        switch (amtMessage) {
            case 'iAMT0050': { if (amtMessageArg == '48') { notify = "Intel&reg; AMT Serial-over-LAN connected"; } else if (amtMessageArg == '49') { notify = "Intel&reg; AMT Serial-over-LAN disconnected"; } break; } // SOL
            case 'iAMT0052': { if (amtMessageArg == '1') { notify = "Intel&reg; AMT KVM connected"; } else if (amtMessageArg == '2') { notify = "Intel&reg; AMT KVM disconnected"; } break; } // KVM
            default: { break; }
        }

        // Sent to the entire group, no sessionid or userid specified.
        if (notify != null) { agent.SendCommand({ 'action': 'msg', 'type': 'notify', 'value': notify, 'tag': 'general', 'amtMessage': amtMessage }); }
    }

    // Launch LMS
    obj.lmsreset = function () {
        //debug('Binding to LMS');
        obj.lmsstate = 0;
        try {
            var lme_heci = require('amt-lme');
            obj.lmsstate = amtLmsState = 1;
            amtLms = new lme_heci();
            amtLms.on('error', function (e) { amtLmsState = 0; obj.lmsstate = 0; amtLms = null; debug("LMS error: " + e); });
            amtLms.on('connect', function () { amtLmsState = 2; obj.lmsstate = 2; debug("LMS connected"); });
            amtLms.on('bind', function (map) { obj._mapping = map; obj.emit('portBinding_LMS', map); });
            amtLms.on('notify', function (data, options, code) { handleAmtNotification(data); });
        } catch (ex) {
            require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: "ex: " + ex });
            amtLmsState = -1; obj.lmsstate = -1; amtLms = null;
        }
    }

    // Start host based ACM activation with TLS
    obj.startConfigurationHBased = function startConfigurationHBased(certHash, hostVpn, dnsSuffixList, func) {
        if ((amtMei == null) || (amtMeiState < 2)) { if (func != null) { func({ status: -100 }); } return; }
        amtMei.startConfigurationHBased(certHash, hostVpn, dnsSuffixList, func);
    }

}

module.exports = AmtManager;
