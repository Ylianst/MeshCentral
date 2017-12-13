var Q = require('queue');

function amt_heci() {
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('connect');

    var heci = require('heci');

    this._amt = heci.create();
    this._amt.BiosVersionLen = 65;
    this._amt.UnicodeStringLen = 20;

    this._amt.rq = new Q();
    this._amt.Parent = this;
    this._amt.on('error', function (e) { this.Parent.emit('error', e); });
    this._amt.on('connect', function () {
        this.Parent.emit('connect');
        this.on('data', function (chunk) {
            //console.log("Received: " + chunk.length + " bytes");
            var header = this.Parent.getCommand(chunk);
            //console.log("CMD = " + header.Command + " (Status: " + header.Status + ") Response = " + header.IsResponse);

            var user = this.rq.deQueue();
            var params = user.optional;
            var callback = user.func;

            params.unshift(header);
            callback.apply(this.Parent, params);
        });
    });
    this._amt.connect(heci.GUIDS.AMT, { noPipeline: 1 });

    this.getCommand = function (chunk) {
        var command = chunk.length == 0 ? (this._amt.rq.peekQueue().cmd | 0x800000) : chunk.readUInt32LE(4);
        var ret = { IsResponse: (command & 0x800000) == 0x800000 ? true : false, Command: (command & 0x7FFFFF), Status: chunk.length != 0 ? chunk.readUInt32LE(12) : -1, Data: chunk.length != 0 ? chunk.slice(16) : null };
        return (ret);
    };

    this.sendCommand = function () {
        if (arguments.length < 3 || typeof (arguments[0]) != 'number' || typeof (arguments[1]) != 'object' || typeof (arguments[2]) != 'function') { throw ('invalid parameters'); }
        var args = [];
        for (var i = 3; i < arguments.length; ++i) { args.push(arguments[i]); }

        this._amt.rq.enQueue({ cmd: arguments[0], func: arguments[2], optional: args });

        var header = Buffer.from('010100000000000000000000', 'hex');
        header.writeUInt32LE(arguments[0] | 0x04000000, 4);
        header.writeUInt32LE(arguments[1] == null ? 0 : arguments[1].length, 8);

        this._amt.write(arguments[1] == null ? header : Buffer.concat([header, arguments[1]]));
    }

    this.getVersion = function (callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(26, null, function (header, fn, opt) {
            if (header.Status == 0) {
                var i, CodeVersion = header.Data, val = { BiosVersion: CodeVersion.slice(0, this._amt.BiosVersionLen), Versions: [] }, v = CodeVersion.slice(this._amt.BiosVersionLen + 4);
                for (i = 0; i < CodeVersion.readUInt32LE(this._amt.BiosVersionLen) ; ++i) {
                    val.Versions[i] = { Description: v.slice(2, v.readUInt16LE(0) + 2).toString(), Version: v.slice(4 + this._amt.UnicodeStringLen, 4 + this._amt.UnicodeStringLen + v.readUInt16LE(2 + this._amt.UnicodeStringLen)).toString() };
                    v = v.slice(4 + (2 * this._amt.UnicodeStringLen));
                }
                opt.unshift(val);
            } else {
                opt.unshift(null);
            }
            fn.apply(this, opt);
        }, callback, optional);
    };

    this.getProvisioningState = function (callback) {
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
    this.getProvisioningMode = function (callback) {
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
    this.getEHBCState = function (callback) {
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
    this.getControlMode = function (callback) {
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
    this.getMACAddresses = function (callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(37, null, function (header, fn, opt) {
            if (header.Status == 0) {
                opt.unshift({ DedicatedMAC: header.Data.slice(0, 6).toString('hex:'), HostMAC: header.Data.slice(6, 12).toString('hex:') });
            } else { opt.unshift({ DedicatedMAC: null, HostMAC: null }); }
            fn.apply(this, opt);
        }, callback, optional);
    };
    this.getDnsSuffix = function (callback) {
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
    this.getHashHandles = function (callback) {
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
    this.getCertHashEntry = function (handle, callback) {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }

        var data = new Buffer(4);
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
    this.getCertHashEntries = function (callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }

        this.getHashHandles(function (handles, fn, opt) {
            var entries = [];
            this.getCertHashEntry(handles.shift(), this._getHashEntrySink, fn, opt, entries, handles);
        }, callback, optional);
    };
    this._getHashEntrySink = function (result, fn, opt, entries, handles) {
        entries.push(result);
        if (handles.length > 0) {
            this.getCertHashEntry(handles.shift(), this._getHashEntrySink, fn, opt, entries, handles);
        } else {
            opt.unshift(entries);
            fn.apply(this, opt);
        }
    }
    this.getLocalSystemAccount = function (callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(103, Buffer.alloc(40), function (header, fn, opt) {
            if (header.Data.length == 68) { opt.unshift({ user: header.Data.slice(0, 34).toString(), pass: header.Data.slice(34, 67).toString(), raw: header.Data }); } else { opt.unshift(null); }
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.unprovision = function (mode, callback) {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        var data = new Buffer(4);
        data.writeUInt32LE(mode, 0);
        this.sendCommand(16, data, function (header, fn, opt) {
            opt.unshift(header.Status);
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.startConfiguration = function () {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x29, data, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.stopConfiguration = function () {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x5E, data, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.openUserInitiatedConnection = function () {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x44, data, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.closeUserInitiatedConnection = function () {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x45, data, function (header, fn, opt) { opt.unshift(header.Status); fn.apply(this, opt); }, callback, optional);
    }
    this.getRemoteAccessConnectionStatus = function () {
        var optional = [];
        for (var i = 2; i < arguments.length; ++i) { optional.push(arguments[i]); }
        this.sendCommand(0x46, data, function (header, fn, opt) {
            if (header.Status == 0) {
                var hostname = v.slice(14, header.Data.readUInt16LE(12) + 14).toString()
                opt.unshift({ status: header.Status, networkStatus: header.Data.readUInt32LE(0), remoteAccessStatus: header.Data.readUInt32LE(4), remoteAccessTrigger: header.Data.readUInt32LE(8), mpsHostname: hostname, raw: header.Data });
            } else {
                opt.unshift({ status: header.Status });
            }
            fn.apply(this, opt);
        }, callback, optional);
    }
    this.getProtocolVersion = function (callback) {
        var optional = [];
        for (var i = 1; i < arguments.length; ++i) { opt.push(arguments[i]); }

        heci.doIoctl(heci.IOCTL.HECI_VERSION, Buffer.alloc(5), Buffer.alloc(5), function (status, buffer, self, fn, opt) {
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
}

module.exports = amt_heci;