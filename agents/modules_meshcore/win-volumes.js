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
    var promise = require('promise');
    var p1 = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var ret = {};
    var values = require('win-wmi-fixed').query('ROOT\\CIMV2', 'SELECT * FROM Win32_LogicalDisk', ['DeviceID', 'VolumeName', 'FileSystem', 'Size', 'FreeSpace', 'DriveType']);
    if(values[0]){
        for (var i = 0; i < values.length; ++i) {
            if (!values[i]['DeviceID']) { continue; }   //always check for null to be sure
            var drive = values[i]['DeviceID'].slice(0,-1);
            ret[drive] = {
                name: (values[i]['VolumeName'] ? values[i]['VolumeName'] : ""),
                type: (values[i]['FileSystem'] ? values[i]['FileSystem'] : "Unknown"),
                size: (values[i]['Size'] ? values[i]['Size'] : 0),
                sizeremaining: (values[i]['FreeSpace'] ? values[i]['FreeSpace'] : 0),
                removable: (values[i]['DriveType'] == 2),
                cdrom: (values[i]['DriveType'] == 5)
            };
        }
    }
    try {
        values = require('win-wmi-fixed').query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume', ['DriveLetter','ConversionStatus','ProtectionStatus']);
        if(values[0]){
            // RegExps for the specific patterns in the manage-bde output, case-insensitive multiline
            var reID = new RegExp("{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}}", "mi");
            var rePass = new RegExp("[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}-[0-9]{6}", "mi");
            var id, rp;
            for (var i = 0; i < values.length; ++i) {
                if (!values[i]['DriveLetter']) { continue; }   //There can be volumes withouth a DriveLetter(=null), which errors the slice. Skip for now, fix later
                var drive = values[i]['DriveLetter'].slice(0,-1);
                var statuses = {
                    0: 'FullyDecrypted',
                    1: 'FullyEncrypted',
                    2: 'EncryptionInProgress',
                    3: 'DecryptionInProgress',
                    4: 'EncryptionPaused',
                    5: 'DecryptionPaused'
                };
                ret[drive].volumeStatus = statuses.hasOwnProperty(values[i].ConversionStatus) ? statuses[values[i].ConversionStatus] : 'FullyDecrypted';
                ret[drive].protectionStatus = (values[i].ProtectionStatus == 0 ? 'Off' : (values[i].ProtectionStatus == 1 ? 'On' : 'Unknown'));
                try {
                    var keychild = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'manage-bde -protectors -get ' + drive + ': -Type recoverypassword'], {});
                    keychild.stdout.str = ''; keychild.stdout.on('data', function (c) { this.str += c.toString(); });
                    keychild.waitExit();
                    // find position of pattern, or null if not found
                    id = keychild.stdout.str.match(reID);
                    rp = keychild.stdout.str.match(rePass);
                    // recoveryPW can be empty if volume is locked
                    if (id) { ret[drive].identifier = id[0]; }
                    if (rp) { ret[drive].recoveryPassword = rp[0]; }
                } catch(ex) { } // just carry on as we cant get bitlocker key
            }
        }
        p1._res(ret);
    } catch (ex) { p1._res(ret); } // just return volumes as cant get encryption/bitlocker
    return (p1);
}

module.exports = { 
    getVolumes: function () { try { return (getVolumes()); } catch (x) { return ({}); } },
    volumes_promise: windows_volumes
};