/*
Copyright 2022 Intel Corporation
@author Bryan Roe

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

function trimObject(j)
{
    var i;
    for(i in j)
    {
        if (j[i] == null || (typeof(j[i])=='string' && j[i]=='') || i.startsWith('__')) { delete j[i];}
    }
    if (j['SerialNumber'] < 0) { var tmp = Buffer.alloc(4); tmp.writeInt32LE(j['SerialNumber']); j['SerialNumber'] = tmp.readUInt32LE(); }
    return (j);
}


function getVolumes()
{
    var v = require('win-wmi-fixed').query('ROOT\\CIMV2', 'SELECT * FROM Win32_Volume');
    var i;

    var ret = {};

    for (i in v)
    {
        ret[v[i].DeviceID] = trimObject(v[i]);
    }
    try {
        v = require('win-wmi-fixed').query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume');
        for (i in v)
        {
            var tmp = trimObject(v[i]);
            for (var k in tmp)
            {
                ret[tmp.DeviceID][k] = tmp[k];
            }
        }
    } catch (ex) { }
    return (ret);
}

function windows_volumes()
{
    var drives = {};
    var error = null;
    var promise = require('promise');
    var p1 = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    // RegExps for the specific patterns in the manage-bde output, case-insensitive multiline
    var reID = new RegExp("{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}}", "mi");
    var rePass = new RegExp("[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}", "mi");
    try {
        var wmi = require('win-wmi-fixed');

        wmi.query('ROOT\\CIMV2', 'SELECT * FROM Win32_LogicalDisk', ['DeviceID', 'VolumeName', 'FileSystem', 'Size', 'FreeSpace', 'DriveType'])
            .forEach(function (disk) {
                if (!disk || !disk['DeviceID']) { return; }   // skip rows without a DeviceID. Shouldn't be possible, but could in case of wmi funkyness
                var drive = disk['DeviceID'].slice(0, -1);
                drives[drive] = {
                    name: disk['VolumeName'] || '',
                    type: disk['FileSystem'] || 'Unknown',
                    size: parseInt(disk['Size']) || 0,
                    sizeremaining: parseInt(disk['FreeSpace']) || 0,
                    dType: disk['DriveType'] || 0
                };
            });

        // The MicrosoftVolumeEncryption namespace is admin-only and manage-bde needs elevation; skip both entirely when not elevated, saves waiting unneccessary on time-out of wmi-query if run as user
        if (require('user-sessions').isRoot()) {
            var child_process = require('child_process');
            wmi.query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume', ['DriveLetter', 'ConversionStatus', 'ProtectionStatus', 'EncryptionMethod'])
                .forEach(function (vol) {
                    if (!vol || !vol['DriveLetter']) { return; }   // there can be volumes without a DriveLetter(=null), which errors the slice
                    var drive = vol['DriveLetter'].slice(0, -1);
                    if (!drives[drive]) { return; }                // no matching logical disk, skip for now.
                    drives[drive].volumeStatus = vol['ConversionStatus'];
                    drives[drive].encryptionMethod = vol['EncryptionMethod'];
                    drives[drive].protectionStatus = vol['ProtectionStatus'];
                    // Only run manage-bde on encrypted drives (ConversionStatus/volumeStatus 0 = FullyDecrypted, otherwise some sort of encryption)
                    if (drives[drive].volumeStatus != 0) {
                        var keychild = child_process.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'manage-bde -protectors -get ' + drive + ': -Type recoverypassword'], {});
                        keychild.stdout.str = '';
                        keychild.stdout.on('data', function (c) { this.str += c.toString(); });
                        keychild.waitExit();
                        var id = keychild.stdout.str.match(reID);
                        var rp = keychild.stdout.str.match(rePass);
                        // a recovery password protector should always have an identifier
                        if (id) { drives[drive].identifier = id[0]; }
                        // recoveryPW can be empty if volume is locked
                        if (rp) { drives[drive].recoveryPassword = rp[0]; }
                    }
                });
        }
    } catch (e) {
        console.log('windows_volumes error: ' + (e && e.message ? e.message : e));
        error = e;    // add error, fall through to resolve below
    }
    p1._res({ error: error, drives: drives });    // always resolve; error is null on success, partial drives kept on failure.
    return (p1);
}

module.exports = { 
    getVolumes: function () { try { return (getVolumes()); } catch (x) { return ({}); } },
    volumes_promise: windows_volumes
};