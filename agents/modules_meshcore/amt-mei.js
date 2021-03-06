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

var Q = require('queue');
function amt_heci() {
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('error');

    var heci = require('heci');
    var sendConsole = function (msg) { try { require('MeshAgent').SendCommand({ "action": "msg", "type": "console", "value": msg }); } catch (ex) { } }

    this._ObjectID = "pthi";
    this._rq = new Q();
    this._setupPTHI = function _setupPTHI() {
        this._amt = heci.create();
        this._amt.descriptorMetadata = "amt-pthi";
        this._amt.BiosVersionLen = 65;
        this._amt.UnicodeStringLen = 20;

        this._amt.Parent = this;
        this._amt.on('error', function _amtOnError(e) {
            if (this.Parent._rq.isEmpty()) {
                this.Parent.emit('error', e); // No pending requests, so propagate the error up
            }
            else {
                // There is a pending request, so fail the pending request
                var user = this.Parent._rq.deQueue();
                var params = user.optional;
                var callback = user.func;
                params.unshift({ Status: -1 }); // Relay an error
                callback.apply(this.Parent, params);

                if (!this.Parent._rq.isEmpty()) {
                    // There are still more pending requests, so try to re-helpconnect MEI
                    this.connect(heci.GUIDS.AMT, { noPipeline: 1 });
                }
            }
        });
        this._amt.on('connect', function _amtOnConnect() {
            this.on('data', function _amtOnData(chunk) {
                //console.log("Received: " + chunk.length + " bytes");
                var header = this.Parent.getCommand(chunk);
                //console.log("CMD = " + header.Command + " (Status: " + header.Status + ") Response = " + header.IsResponse);

                var user = this.Parent._rq.deQueue();
                var params = user.optional;
                var callback = user.func;

                params.unshift(header);
                callback.apply(this.Parent, params);

                if (this.Parent._rq.isEmpty()) {
                    // No More Requests, we can close PTHI
                    this.Parent._amt.disconnect();
                    this.Parent._amt = null;
                }
                else {
                    // Send the next request
                    this.write(this.Parent._rq.peekQueue().send);
                }
            });

            // Start sending requests
            this.write(this.Parent._rq.peekQueue().send);
        });
    };
    function trim(x) { var y = x.indexOf('\0'); if (y >= 0) { return x.substring(0, y); } else { return x; } }
    this.getCommand = function getCommand(chunk) {
        var command = chunk.length == 0 ? (this._rq.peekQueue().cmd | 0x800000) : chunk.readUInt32LE(4);
        var ret = { IsResponse: (command & 0x800000) == 0x800000 ? true : false, Command: (command & 0x7FFFFF), Status: chunk.length != 0 ? chunk.readUInt32LE(12) : -1, Data: chunk.length != 0 ? chunk.slice(16) : null };
        return (ret);
    };

    this.sendCommand = function sendCommand() {
        if (arguments.length < 3 || typeof (arguments[0]) != 'number' || typeof (arguments[1]) != 'object' || typeof (arguments[2]) != 'function') { throw ('invalid parameters'); }
        var args = [];
        for (var i = 3; i < arguments.length; ++i) { args.push(arguments[i]); }

        var header = Buffer.from('010100000000000000000000', 'hex');
        header.writeUInt32LE(arguments[0] | 0x04000000, 4);
        header.writeUInt32LE(arguments[1] == null ? 0 : arguments[1].length, 8);
        this._rq.enQueue({ cmd: arguments[0], func: arguments[2], optional: args, send: (arguments[1] == null ? header : Buffer.concat([header, arguments[1]])) });

        if (!this._amt) {
            this._setupPTHI();
            this._amt.connect(heci.GUIDS.AMT, { noPipeline: 1 });
        }
    }

    this.getVersion = function getVersion(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(26, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var i, CodeVersion = header.Data, val = { BiosVersion: CodeVersion.slice(0, this._amt.BiosVersionLen).toString(), Versions: [] }, v = CodeVersion.slice(this._amt.BiosVersionLen + 4);
                for (i = 0; i < CodeVersion.readUInt32LE(this._amt.BiosVersionLen); ++i) {
                    val.Versions[i] = { Description: v.slice(2, v.readUInt16LE(0) + 2).toString(), Version: v.slice(4 + this._amt.UnicodeStringLen, 4 + this._amt.UnicodeStringLen + v.readUInt16LE(2 + this._amt.UnicodeStringLen)).toString() };
                    v = v.slice(4 + (2 * this._amt.UnicodeStringLen));
                }
                if (val.BiosVersion.indexOf('\0') > 0) { val.BiosVersion = val.BiosVersion.substring(0, val.BiosVersion.indexOf('\0')); }
                opt.unshift(val);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };

    // Fill the left with zeros until the string is of a given length
    function zeroLeftPad(str, len) {
        if ((len == null) && (typeof (len) != 'number')) { return null; }
        if (str == null) str = ''; // If null, this is to generate zero leftpad string
        var zlp = '';
        for (var i = 0; i < len - str.length; i++) { zlp += '0'; }
        return zlp + str;
    }

    this.getUuid = function getUuid(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x5c, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var result = {};
                result.uuid = [zeroLeftPad(header.Data.readUInt32LE(0).toString(16), 8),
                    zeroLeftPad(header.Data.readUInt16LE(4).toString(16), 4),
                    zeroLeftPad(header.Data.readUInt16LE(6).toString(16), 4),
                    zeroLeftPad(header.Data.readUInt16BE(8).toString(16), 4),
                    zeroLeftPad(header.Data.slice(10).toString('hex').toLowerCase(), 12)].join('-');
                opt.unshift(result);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };

    this.getProvisioningState = function getProvisioningState(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(17, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var result = {};
                result.state = header.Data.readUInt32LE(0);
                if (result.state < 3) { result.stateStr = ["PRE", "IN", "POST"][result.state]; }
                opt.unshift(result);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getProvisioningMode = function getProvisioningMode(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(8, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var result = {};
                result.mode = header.Data.readUInt32LE(0);
                if (result.mode < 4) { result.modeStr = ["NONE", "ENTERPRISE", "SMALL_BUSINESS", "REMOTE_ASSISTANCE"][result.mode]; }
                result.legacy = header.Data.readUInt32LE(4) == 0 ? false : true;
                opt.unshift(result);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getEHBCState = function getEHBCState(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(132, null, function (header, fn, opt) {
            if (header.Status == 0) {
                opt.unshift({ EHBC: header.Data.readUInt32LE(0) != 0 });
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getControlMode = function getControlMode(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(107, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var result = {};
                result.controlMode = header.Data.readUInt32LE(0);
                if (result.controlMode < 3) { result.controlModeStr = ["NONE_RPAT", "CLIENT", "ADMIN", "REMOTE_ASSISTANCE"][result.controlMode]; }
                opt.unshift(result);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getMACAddresses = function getMACAddresses(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(37, null, function (header, fn, opt) {
            if (header.Status == 0) {
                opt.unshift({ DedicatedMAC: header.Data.slice(0, 6).toString('hex:'), HostMAC: header.Data.slice(6, 12).toString('hex:') });
            } else { opt.unshift({ DedicatedMAC: null, HostMAC: null }); }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getDnsSuffix = function getDnsSuffix(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(54, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var resultLen = header.Data.readUInt16LE(0);
                if (resultLen > 0) { opt.unshift(header.Data.slice(2, 2 + resultLen).toString()); } else { opt.unshift(null); }
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getHashHandles = function getHashHandles(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x2C, null, function (header, fn, opt) {
            var result = [];
            if (header.Status == 0) {
                var resultLen = header.Data.readUInt32LE(0);
                for (var i = 0; i < resultLen; ++i) {
                    result.push(header.Data.readUInt32LE(4 + (4 * i)));
                }
            }
            opt.unshift(result);
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getCertHashEntry = function getCertHashEntry(handle, callback) {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }

        var data = Buffer.alloc(4);
        data.writeUInt32LE(handle, 0);

        this.sendCommand(0x2D, data, function (header, fn, opt) {
            if (header.Status == 0) {
                var result = {};
                result.isDefault = header.Data.readUInt32LE(0);
                result.isActive = header.Data.readUInt32LE(4);
                result.hashAlgorithm = header.Data.readUInt8(72);
                if (result.hashAlgorithm < 4) {
                    result.hashAlgorithmStr = ["MD5", "SHA1", "SHA256", "SHA512"][result.hashAlgorithm];
                    result.hashAlgorithmSize = [16, 20, 32, 64][result.hashAlgorithm];
                    result.certificateHash = header.Data.slice(8, 8 + result.hashAlgorithmSize).toString('hex');
                }
                result.name = header.Data.slice(73 + 2, 73 + 2 + header.Data.readUInt16LE(73)).toString();
                opt.unshift(result);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getCertHashEntries = function getCertHashEntries(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }

        this.getHashHandles(function (handles, fn, opt) {
            var entries = [];
            this.getCertHashEntry(handles.shift(), this._getHashEntrySink, fn, opt, entries, handles);
        }, callback, optional);
    };

    this._getHashEntrySink = function _getHashEntrySink(result, fn, opt, entries, handles) {
        entries.push(result);
        if (handles.length > 0) {
            this.getCertHashEntry(handles.shift(), this._getHashEntrySink, fn, opt, entries, handles);
        } else {
            opt.unshift(entries);
            fn.apply(this, opt);
        }
    }
    this.getLocalSystemAccount = function getLocalSystemAccount(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(103, Buffer.alloc(40), function (header, fn, opt) {
            if (header.Status == 0 && header.Data.length == 68) {
                opt.unshift({ user: trim(header.Data.slice(0, 33).toString()), pass: trim(header.Data.slice(33, 67).toString()), raw: header.Data });
            }
            else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.getLanInterfaceSettings = function getLanInterfaceSettings(index, callback) {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        var ifx = Buffer.alloc(4);
        ifx.writeUInt32LE(index);
        this.sendCommand(0x48, ifx, function onGetLanInterfaceSettings(header, fn, opt) {
            if (header.Status == 0) {
                var info = {};
                info.enabled = header.Data.readUInt32LE(0);
                info.dhcpEnabled = header.Data.readUInt32LE(8);
                switch (header.Data[12]) {
                    case 1:
                        info.dhcpMode = 'ACTIVE'
                        break;
                    case 2:
                        info.dhcpMode = 'PASSIVE'
                        break;
                    default:
                        info.dhcpMode = 'UNKNOWN';
                        break;
                }
                info.mac = header.Data.slice(14).toString('hex:');

                var addr = header.Data.readUInt32LE(4);
                info.address = ((addr >> 24) & 255) + '.' + ((addr >> 16) & 255) + '.' + ((addr >> 8) & 255) + '.' + (addr & 255);
                opt.unshift(info);
                fn.apply(this, opt);
            }
            else {
                opt.unshift(null);
                fn.apply(this, opt);
            }
        }, callback, optional);

    };
    this.unprovision = function unprovision(mode, callback) {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        var data = Buffer.alloc(4);
        data.writeUInt32LE(mode, 0);
        this.sendCommand(16, data, function (header, fn, opt) {
            opt.unshift(header.Status);
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.startConfiguration = function startConfiguration(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x29, null, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.stopConfiguration = function stopConfiguration(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x5E, null, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.openUserInitiatedConnection = function openUserInitiatedConnection(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x44, null, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.closeUserInitiatedConnection = function closeUnserInitiatedConnected(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x45, null, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.getRemoteAccessConnectionStatus = function getRemoteAccessConnectionStatus(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x46, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var hostname = header.Data.slice(14, header.Data.readUInt16LE(12) + 14).toString()
                opt.unshift({ status: header.Status, networkStatus: header.Data.readUInt32LE(0), remoteAccessStatus: header.Data.readUInt32LE(4), remoteAccessTrigger: header.Data.readUInt32LE(8), mpsHostname: hostname, raw: header.Data });
            } else {
                opt.unshift({ status: header.Status });
            }
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.getProtocolVersion = function getProtocolVersion(callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { opt.push(arguments[i]); }

        if (!this._tmpSession) { this._tmpSession = heci.create(); this._tmpSession.parent = this; }
        this._tmpSession.doIoctl(heci.IOCTL.HECI_VERSION, Buffer.alloc(5), Buffer.alloc(5), function (status, buffer, self, fn, opt) {
            if (status == 0) {
                var result = buffer.readUInt8(0).toString() + '.' + buffer.readUInt8(1).toString() + '.' + buffer.readUInt8(2).toString() + '.' + buffer.readUInt16BE(3).toString();
                opt.unshift(result);
                fn.apply(self, opt);
            }
            else {
                opt.unshift(null);
                fn.apply(self, opt);
            }

        }, this, callback, optional);
    }
    this.startConfigurationHBased = function startConfigurationHBased(certHash, hostVpn, dnsSuffixList, func) {
        if ((certHash == null) || ((certHash.length != 32) && (certHash.length != 48))) { func({ status: -101 }); }
        this.stopConfiguration(function (status) {
            if (status == 0) {
                // We stopped the configuration, wait 20 seconds before starting up again.
                var f = function tf() { delete tf.parent.xtimeout; tf.parent.startConfigurationHBasedEx(certHash, hostVpn, dnsSuffixList, func); }
                f.parent = this;
                this.xtimeout = setTimeout(f, 20000);
            } else {
                // We are not in the connect mode, this is good, start configuration right away.
                this.startConfigurationHBasedEx(certHash, hostVpn, dnsSuffixList, func);
            }
        })
    }
    this.startConfigurationHBasedEx = function startConfigurationHBased(certHash, hostVpn, dnsSuffixList, func) {
        var optional = [];
        for (var i = 4; i < arguments.length; ++i) { optional.push(arguments[i]); }

        // Format the command
        var data = Buffer.alloc(4 + 64 + 4 + 4 + 320);
        data.writeUInt32LE((certHash.length == 48) ? 3 : 2, 0); // Write certificate hash type: SHA256 = 2, SHA384 = 3
        certHash.copy(data, 4); // Write the hash
        data.writeUInt32LE(hostVpn ? 1 : 0, 68); // Write is HostVPN is enabled
        if (dnsSuffixList != null) {
            data.writeUInt32LE(dnsSuffixList.length, 72); // Write the number of DNS Suffix, from 0 to 4
            var ptr = 76;
            for (var i = 0; i < dnsSuffixList.length; i++) { ptr += data.write(dnsSuffixList[i], ptr) + 1; } // Write up to 4 DNS Suffix with null seperation.
        }

        // Send the command
        this.sendCommand(139, data, function (header, fn, opt) {
            if (header.Status == 0) {
                var amtHash = null;
                if (header.Data[0] == 2) { amtHash = header.Data.slice(1, 33); } // SHA256
                if (header.Data[0] == 3) { amtHash = header.Data.slice(1, 49); } // SHA384
                opt.unshift({ status: header.Status, hash: amtHash.toString('hex') });
            } else {
                opt.unshift({ status: header.Status });
            }
            fn.apply(this, opt);
        }, func, optional);
    }
}

module.exports = amt_heci;


/*
AMT_STATUS_SUCCESS = 0,
AMT_STATUS_INTERNAL_ERROR = 1,
AMT_STATUS_INVALID_AMT_MODE = 3,
AMT_STATUS_INVALID_MESSAGE_LENGTH = 4,
AMT_STATUS_MAX_LIMIT_REACHED = 23,
AMT_STATUS_INVALID_PARAMETER = 36,
AMT_STATUS_RNG_GENERATION_IN_PROGRESS = 47,
AMT_STATUS_RNG_NOT_READY = 48,
AMT_STATUS_CERTIFICATE_NOT_READY = 49,
AMT_STATUS_INVALID_HANDLE = 2053
AMT_STATUS_NOT_FOUND = 2068,
*/