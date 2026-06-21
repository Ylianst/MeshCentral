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

    var pending = 0, done = false;
    function resolver() { if (done && (pending === 0)) { p1._res({ error: error, drives: drives }); } }

    try {
        var wmi = require('win-wmi-fixed');

        wmi.query('ROOT\\CIMV2', 'SELECT DeviceID,VolumeName,FileSystem,Size,FreeSpace,DriveType FROM Win32_LogicalDisk', ['DeviceID', 'VolumeName', 'FileSystem', 'Size', 'FreeSpace', 'DriveType'], false, 5000)
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
            wmi.query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT DriveLetter,ConversionStatus,ProtectionStatus,EncryptionMethod FROM Win32_EncryptableVolume', ['DriveLetter', 'ConversionStatus', 'ProtectionStatus', 'EncryptionMethod'], false, 5000)
                .forEach(function (vol) {
                    if (!vol || !vol['DriveLetter']) { return; }   // there can be volumes without a DriveLetter(=null), which errors the slice
                    var drive = vol['DriveLetter'].slice(0, -1);
                    if (!drives[drive]) { return; }                // no matching logical disk, skip for now.
                    drives[drive].volumeStatus = vol['ConversionStatus'];
                    drives[drive].encryptionMethod = vol['EncryptionMethod'];
                    drives[drive].protectionStatus = vol['ProtectionStatus'];
                    // Only run manage-bde on encrypted drives (ConversionStatus/volumeStatus 0 = FullyDecrypted, otherwise some sort of encryption)
                    if (drives[drive].volumeStatus != 0) {
                        pending++;
                        var keychild = child_process.execFile(process.env['windir'] + '\\system32\\manage-bde.exe', ['manage-bde', '-protectors', '-get', drive + ':', '-Type', 'recoverypassword'], {});
                        keychild.stdout.str = '';
                        keychild.stdout.on('data', function (c) { this.str += c.toString(); });
                        keychild.target = drive;
                        // Guard against a hung manage-bde
                        keychild.timeout = setTimeout(function () { try { keychild.kill(); } catch (ex) { } }, 4000);
                        keychild.on('exit', function () {
                            clearTimeout(this.timeout);
                            var id = this.stdout.str.match(reID);
                            var rp = this.stdout.str.match(rePass);
                            // a recovery password protector should always have an identifier
                            if (id) { drives[this.target].identifier = id[0]; }
                            // recoveryPW can be empty if volume is locked
                            if (rp) { drives[this.target].recoveryPassword = rp[0]; }
                            pending--;
                            resolver();
                        });
                    }
                });
        }
    } catch (e) {
        console.log('windows_volumes error: ' + (e && e.message ? e.message : e));
        error = e;    // add error, fall through to resolve below
    }
    done = true;
    resolver();    // if not root, resolve with partial info, otherwise the last child process resolves
    return (p1);
}

// Same as windows_volumes() but get the BitLocker recovery password through wmi. And win7 added
function windows_volumes_wmi()
{
    var promise = require('promise');
    var wmi = require('win-wmi-fixed');
    const NS_VE = 'ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption';
    var p1 = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var drives = {};

    try {
        // use win32_volume, for future property expansion and link through DeviceID
        wmi.query('ROOT\\CIMV2', 'SELECT DriveLetter,Label,FileSystem,Capacity,FreeSpace,DriveType FROM Win32_Volume', ['DriveLetter', 'Label', 'FileSystem', 'Capacity', 'FreeSpace', 'DriveType'], false, 5000)
            .forEach(function (vol) {
                if (!vol || vol['DriveLetter'] == null) { return; }   // skip letterless volumes for now
                var drive = vol['DriveLetter'].slice(0, -1);
                drives[drive] = {
                    name: vol['Label'] || '',
                    type: vol['FileSystem'] || 'Unknown',
                    size: parseInt(vol['Capacity']) || 0,
                    sizeremaining: parseInt(vol['FreeSpace']) || 0,
                    dType: vol['DriveType'] || 0
                };
            });

        // The MicrosoftVolumeEncryption namespace is admin-only and manage-bde needs elevation; skip entirely when not elevated, saves waiting on the wmi-query time-out if run as user
        if (require('user-sessions').isRoot()) {
            // Check win version: Win7=7600/7601, Win8+>=9200.
            // Default to win8+ if unreadable.
            var win8plus = true;
            try {
                var reg = require('win-registry');
                var build = parseInt(reg.QueryKey(reg.HKEY.LocalMachine, 'Software\\Microsoft\\Windows NT\\CurrentVersion', 'CurrentBuildNumber'), 10);
                win8plus = !(build > 0 && build < 9200);
            } catch (ex) { }
            // Win7 lacks the ConversionStatus property, so only select it on win8+
            var q = win8plus ? 'SELECT DeviceID,DriveLetter,ConversionStatus,ProtectionStatus,EncryptionMethod FROM Win32_EncryptableVolume' : 'SELECT DeviceID,DriveLetter,ProtectionStatus,EncryptionMethod FROM Win32_EncryptableVolume';
            var fields = win8plus ? ['DeviceID', 'DriveLetter', 'ConversionStatus', 'ProtectionStatus', 'EncryptionMethod'] : ['DeviceID', 'DriveLetter', 'ProtectionStatus', 'EncryptionMethod'];
            // re-use connection instead of creating a new one every time
            var sess = wmi.connect(NS_VE);
            try {
                wmi.query(NS_VE, q, fields, false, 5000)
                    .forEach(function (vol) {
                        if (!vol || vol['DriveLetter'] == null) { return; }   // shortcut letterless volumes
                        var drive = vol['DriveLetter'].slice(0, -1);
                        if (!drives[drive]) { return; }                // no matching volume, skip for now. TODO match op DeviceID
                        try {
                            var v_id = { DeviceID: vol['DeviceID'] };   // DeviceID(=VolumeKeyProtectorID) is the key needed for the ExecMethod calls
                            drives[drive].protectionStatus = vol['ProtectionStatus'];
                            drives[drive].encryptionMethod = vol['EncryptionMethod'];
                            if (win8plus) {
                                drives[drive].volumeStatus = vol.ConversionStatus;            // property available from the query
                            } else {
                                var cs = sess.execMethod('Win32_EncryptableVolume', v_id, 'GetConversionStatus', null, 5000);   // win7: no PrecisionFactor param, so no universal get
                                drives[drive].volumeStatus = (cs && cs.ReturnValue == 0) ? cs.ConversionStatus : 0;
                            }
                            // Only retrieve the recovery key on encrypted drives (conv 0 = FullyDecrypted, otherwise some sort of encryption)
                            if (drives[drive].volumeStatus != 0) {
                                // Get protectorKey (= identifier). For now only { KeyProtectorType: 3 } (=numerical password=recoverykey). Future possibilities: get all id's and statuses (TPM , Certificate etc)
                                // https://learn.microsoft.com/en-us/windows/win32/secprov/getkeyprotectors-win32-encryptablevolume
                                var protKeys = sess.execMethod('Win32_EncryptableVolume', v_id, 'GetKeyProtectors', { KeyProtectorType: 3 }, 5000);
                                if (protKeys && protKeys.ReturnValue == 0 && Array.isArray(protKeys.VolumeKeyProtectorID) && protKeys.VolumeKeyProtectorID.length > 0) {
                                    drives[drive].identifier = protKeys.VolumeKeyProtectorID[0];
                                    // Got an id, use it to retrieve the recoverykey
                                    // https://learn.microsoft.com/en-us/windows/win32/secprov/getkeyprotectornumericalpassword-win32-encryptablevolume
                                    var numPass = sess.execMethod('Win32_EncryptableVolume', v_id, 'GetKeyProtectorNumericalPassword', { VolumeKeyProtectorID: protKeys.VolumeKeyProtectorID[0] }, 5000);
                                    // NumericalPassword is null if the volume is locked
                                    if (numPass && numPass.ReturnValue == 0 && numPass.NumericalPassword) { drives[drive].recoveryPassword = numPass.NumericalPassword; }
                                }
                            }
                        } catch (ex) { console.log('win-volumes bitlocker error for ' + drive + ': ' + (ex && ex.message ? ex.message : ex)); } // skip this volume, carry on
                    });
            } finally { sess.release(); }
        }
        p1._res({ error: null, drives: drives });
    } catch (e) { console.log('windows_volumes error: ' + (e && e.message ? e.message : e)); p1._res({ error: e, drives: drives }); } // just return what we got

    return (p1);
}

module.exports = {
    getVolumes: function () { try { return (getVolumes()); } catch (x) { return ({}); } },
    volumes_promise: windows_volumes_wmi
};