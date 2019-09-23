/*
Copyright 2018 Intel Corporation

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

try { Object.defineProperty(Array.prototype, "peek", { value: function () { return (this.length > 0 ? this[this.length - 1] : undefined); } }); } catch (e) { }
try { Object.defineProperty(String.prototype, "replaceAll", { value: function replaceAll(oldVal, newVal) { return (this.split(oldVal).join(newVal)); } }); } catch (e) { }

var RSMB = 1381190978;
var memoryLocation = { 0x1: 'Other', 0x2: 'Unknown', 0x3: 'System Board', 0x4: 'ISA', 0x5: 'EISA', 0x6: 'PCI', 0x7: 'MCA', 0x8: 'PCMCIA', 0x9: 'Proprietary', 0xA: 'NuBus', 0xA0: 'PC-98/C20', 0xA1: 'PC-98/C24', 0xA2: 'PC-98/E', 0xA3: 'PC-98/LB' };
var wakeReason = ['Reserved', 'Other', 'Unknown', 'APM Timer', 'Modem Ring', 'LAN', 'Power Switch', 'PCI', 'AC Power'];

// Fill the left with zeros until the string is of a given length
function zeroLeftPad(str, len)
{
    if ((len == null) && (typeof (len) != 'number')) { return null; }
    if (str == null) str = ''; // If null, this is to generate zero leftpad string
    var zlp = '';
    for (var i = 0; i < len - str.length; i++) { zlp += '0'; }
    return zlp + str;
}

function SMBiosTables()
{
    this._ObjectID = 'SMBiosTable';
    if (process.platform == 'win32') {
        this._marshal = require('_GenericMarshal');
        this._native = this._marshal.CreateNativeProxy("Kernel32.dll");

        this._native.CreateMethod('EnumSystemFirmwareTables');
        this._native.CreateMethod('GetSystemFirmwareTable');
    }
    if (process.platform == 'linux') {
        this._canonicalizeData = function _canonicalizeData(data) {
            var lines = data.toString().split('Header and Data:\x0A');
            var MemoryStream = require('MemoryStream');
            var ms = new MemoryStream();

            for (var i = 1; i < lines.length; ++i) {
                var tokens = lines[i].split('Strings:\x0A');
                var header = tokens[0].split('\x0A\x0A')[0].replaceAll('\x0A', '').trim().replaceAll(' ', '').replaceAll('\x09', '');
                ms.write(Buffer.from(header, 'hex'));
                if (tokens.length > 1) {
                    var strings = tokens[1].split('\x0A\x0A')[0].split('\x0A');
                    var stringsFinal = [];
                    for (var strx in strings) {
                        var tmp = strings[strx].trim().replaceAll(' ', '').replaceAll('\x09', '');
                        if (!(tmp[0] == '"')) { stringsFinal.push(tmp); }
                    }
                    ms.write(Buffer.from(stringsFinal.join(''), 'hex'));
                    ms.write(Buffer.from('00', 'hex'));
                }
                else {
                    ms.write(Buffer.from('0000', 'hex'));
                }
            }
            var retVal = ms.buffer;
            retVal.ms = ms;
            return (retVal);
        };
    }
    this._parse = function _parse(SMData) {
        var ret = {};
        var pbyte;
        var i = 0
        var SMData;
        var structcount = 0;

        while (SMData && i < SMData.length)
        {
            var SMtype = SMData[i];
            var SMlength = SMData[i + 1];

            if (!ret[SMtype]) { ret[SMtype] = []; }
            ret[SMtype].push(SMData.slice(i + 4, i + SMlength));
            if (process.platform == 'win32') { ret[SMtype].peek()._ext = pbyte; }
            i += SMlength;

            ret[SMtype].peek()._strings = [];

            while (SMData[i] != 0 && i <= SMData.length)
            {
                var strstart = i;

                // Start of String, find end of string
                while (SMData[i++] != 0 && i <= SMData.length);
                try
                {
                    ret[SMtype].peek()._strings.push(SMData.slice(strstart, i).toString().trim());
                }
                catch (ee)
                {
                    console.log('oops');
                }
            }
            i += (ret[SMtype].peek()._strings.length == 0) ? 2 : 1;
            ++structcount;
            //console.log('End of Table[' + SMtype + ']: ' + i);
        }
        //console.log('Struct Count = ' + structcount);
        return (ret);
    };
    this.get = function get(callback) {
        if (process.platform == 'win32') {
            var size = this._native.GetSystemFirmwareTable(RSMB, 0, 0, 0).Val;
            //console.log('Table Size: ' + size);

            var PtrSize = this._marshal.CreatePointer()._size;
            var buffer = this._marshal.CreateVariable(size);
            var written = this._native.GetSystemFirmwareTable(RSMB, 0, buffer, size).Val;
            //console.log('Written Size: ' + written);

            var rawBuffer = buffer.toBuffer();
            var length = buffer.Deref(4, 4).toBuffer().readUInt32LE(0);

            pbyte = buffer.Deref(8, length);
            SMData = pbyte.toBuffer();

            if (callback) { callback.apply(this, [this._parse(SMData)]); return; } else { return (this._parse(SMData)); }
        }
        if (process.platform == 'linux') {
            var MemoryStream = require('MemoryStream');
            this.child = require('child_process').execFile('/usr/sbin/dmidecode', ['dmidecode', '-u']);
            this.child.SMBiosTable = this;
            this.child.ms = new MemoryStream();
            this.child.ms.callback = callback;
            this.child.ms.child = this.child;
            this.child.stdout.on('data', function (buffer) { this.parent.ms.write(buffer); });
            this.child.on('exit', function () { this.ms.end(); });
            this.child.ms.on('end', function () {
                //console.log('read ' + this.buffer.length + ' bytes');
                if (this.buffer.length < 300) {
                    //console.log('Not enough permission to read SMBiosTable');
                    if (this.callback) { this.callback.apply(this.child.SMBiosTable, []); }
                }
                else {
                    var SMData = this.child.SMBiosTable._canonicalizeData(this.buffer);
                    var j = this.child.SMBiosTable._parse(SMData);
                    if (this.callback) { this.callback.apply(this.child.SMBiosTable, [j]); }
                }
            });
            return;
        }
        if (callback) { callback.apply(this, [null]); return; } else { return (null); }
    };
    this.parse = function parse(data) {
        var r = {};
        try
        {
            r.processorInfo = this.processorInfo(data);
        }
        catch(e)
        {
        }
        try
        {
            r.memoryInfo = this.memoryInfo(data);
        }
        catch(e)
        {
        }
        try
        {
            r.systemInfo = this.systemInfo(data);
        }
        catch(e)
        {
        }
        try
        {
            r.systemSlots = this.systemInfo(data);
        }
        catch(e)
        {
        }
        try
        {
            r.amtInfo = this.amtInfo(data);
        }
        catch(e)
        {
        }
        return r;
    }
    this.processorInfo = function processorInfo(data) {
        if (!data) { throw ('no data'); }
        var ret = [];
        var ptype = ['ERROR', 'Other', 'Unknown', 'CPU', 'ALU', 'DSP', 'GPU'];
        var statusString = ['Unknown', 'Enabled', 'Disabled by user', 'Disabled by BIOS', 'Idle', 'Reserved', 'Reserved', 'Other'];
        var cpuid = 0;
        while (data[4] && data[4].length > 0) {
            var p = data[4].pop();
            var populated = p[20] & 0x40;
            var status = p[20] & 0x07
            if (populated) {
                var j = { _ObjectID: 'SMBiosTables.processorInfo' };
                j.Processor = ptype[p[1]];
                j.MaxSpeed = p.readUInt16LE(16) + ' Mhz';
                if (p[31]) { j.Cores = p[31]; }
                if (p[33]) { j.Threads = p[33]; }
                j.Populated = 1;
                j.Status = statusString[status];
                j.Socket = p._strings[p[0] - 1];
                j.Manufacturer = p._strings[p[3] - 1];
                j.Version = p._strings[p[12] - 1];
                ret.push(j);
            }
        }
        return (ret);
    };
    this.memoryInfo = function memoryInfo(data) {
        if (!data) { throw ('no data'); }
        var retVal = { _ObjectID: 'SMBiosTables.memoryInfo' };
        if (data[16]) {
            var m = data[16].peek();
            retVal.location = memoryLocation[m[0]];
            if ((retVal.maxCapacityKb = m.readUInt32LE(3)) == 0x80000000) {
                retVal.maxCapacityKb = 'A really big number';
            }
        }
        return (retVal);
    };
    this.systemInfo = function systemInfo(data)
    {
        if (!data) { throw ('no data'); }
        var retVal = { _ObjectID: 'SMBiosTables.systemInfo' };
        if (data[1])
        {
            var si = data[1].peek();
            var uuid = si.slice(4, 20);

            retVal.uuid = [zeroLeftPad(uuid.readUInt32LE(0).toString(16), 8),
            zeroLeftPad(uuid.readUInt16LE(4).toString(16), 4),
            zeroLeftPad(uuid.readUInt16LE(6).toString(16), 4),
            zeroLeftPad(uuid.readUInt16BE(8).toString(16), 4),
            zeroLeftPad(uuid.slice(10).toString('hex').toLowerCase(), 12)].join('-');

            retVal.wakeReason = wakeReason[si[20]];
        }
        return (retVal);
    };
    this.systemSlots = function systemSlots(data) {
        if (!data) { throw ('no data'); }
        var retVal = [];
        if (data[9]) {
            while (data[9].length > 0) {
                var ss = data[9].pop();
                retVal.push({ name: ss._strings[ss[0] - 1] });
            }
        }
        return (retVal);
    };
    this.amtInfo = function amtInfo(data) {
        if (!data) { throw ('no data'); }
        var retVal = { AMT: false };
        if (data[130] && data[130].peek().slice(0, 4).toString() == '$AMT') {
            var amt = data[130].peek();
            retVal.AMT = amt[4] ? true : false;
            if (retVal.AMT) {
                retVal.enabled = amt[5] ? true : false;
                retVal.storageRedirection = amt[6] ? true : false;
                retVal.serialOverLan = amt[7] ? true : false;
                retVal.kvm = amt[14] ? true : false;
                if (data[131].peek() && data[131].peek().slice(52, 56).toString() == 'vPro') {
                    var settings = data[131].peek();
                    if (settings[0] & 0x04) { retVal.TXT = (settings[0] & 0x08) ? true : false; }
                    if (settings[0] & 0x10) { retVal.VMX = (settings[0] & 0x20) ? true : false; }
                    retVal.MEBX = settings.readUInt16LE(4).toString() + '.' + settings.readUInt16LE(6).toString() + '.' + settings.readUInt16LE(8).toString() + '.' + settings.readUInt16LE(10).toString();

                    var mecap = settings.slice(20, 32);
                    retVal.ManagementEngine = mecap.readUInt16LE(6).toString() + '.' + mecap.readUInt16LE(4).toString() + '.' + mecap.readUInt16LE(10).toString() + '.' + mecap.readUInt16LE(8).toString();

                    //var lan = settings.slice(36, 48);
                    //console.log(lan.toString('hex'));
                    //retVal.LAN = (lan.readUInt16LE(10) & 0x03).toString() + '/' + ((lan.readUInt16LE(10) & 0xF8) >> 3).toString();

                    //console.log(lan.readUInt16LE(3));
                    //retVal.WLAN = (lan.readUInt16LE(3) & 0x07).toString() + '/' + ((lan.readUInt16LE(3) & 0xF8) >> 3).toString() + '/' + (lan.readUInt16LE(3) >> 8).toString();
                }
            }
        }
        return (retVal);
    };
    this.smTableTypes = {
        0: 'BIOS information',
        1: 'System information',
        2: 'Baseboard (or Module) information',
        4: 'Processor information',
        5: 'memory controller information',
        6: 'Memory module information',
        7: 'Cache information',
        8: 'Port connector information',
        9: 'System slots',
        10: 'On board devices information',
        11: 'OEM strings',
        12: 'System configuration options',
        13: 'BIOS language information',
        14: 'Group associations',
        15: 'System event log',
        16: 'Physical memory array',
        17: 'Memory device',
        18: '32bit memory error information',
        19: 'Memory array mapped address',
        20: 'Memory device mapped address',
        21: 'Built-in pointing device',
        22: 'Portable battery',
        23: 'System reset',
        24: 'Hardware security',
        25: 'System power controls',
        26: 'Voltage probe',
        27: 'Cooling device',
        28: 'Temperature probe',
        29: 'Electrical current probe',
        30: 'Out-of-band remote access',
        31: 'Boot integrity services (BIS) entry point',
        32: 'System boot information',
        33: '64bit memory error information',
        34: 'Management device',
        35: 'Management device component',
        36: 'Management device threshold data',
        37: 'Memory channel',
        38: 'IPMI device information',
        39: 'System power supply',
        40: 'Additional information',
        41: 'Onboard devices extended information',
        42: 'Management controller host interface',
        126: 'Inactive',
        127: 'End-of-table'
    }
}

module.exports = new SMBiosTables();