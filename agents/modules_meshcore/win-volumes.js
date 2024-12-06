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
    var v = require('win-wmi').query('ROOT\\CIMV2', 'SELECT * FROM Win32_Volume');
    var i;

    var ret = {};

    for (i in v)
    {
        ret[v[i].DeviceID] = trimObject(v[i]);
    }
    try {
        v = require('win-wmi').query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume');
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
    var values = require('win-wmi').query('ROOT\\CIMV2', 'SELECT * FROM Win32_LogicalDisk', ['DeviceID', 'VolumeName', 'FileSystem', 'Size', 'FreeSpace', 'DriveType']);
    if(values[0]){
        for (var i = 0; i < values.length; ++i) {
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
        values = require('win-wmi').query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume', ['DriveLetter','ConversionStatus','ProtectionStatus']);
        if(values[0]){
            for (var i = 0; i < values.length; ++i) {
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
                    var foundIDMarkedLine = false, foundMarkedLine = false, identifier = '', password = '';
                    var keychild = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'manage-bde -protectors -get ' + drive + ': -Type recoverypassword'], {});
                    keychild.stdout.str = ''; keychild.stdout.on('data', function (c) { this.str += c.toString(); });
                    keychild.waitExit();
                    var lines = keychild.stdout.str.trim().split('\r\n');
                    for (var x = 0; x < lines.length; x++) { // Loop each line
                        var abc = lines[x].trim();
                        var englishidpass = (abc !== '' && abc.includes('Numerical Password:')); // English ID
                        var germanidpass = (abc !== '' && abc.includes('Numerisches Kennwort:')); // German ID
                        var frenchidpass = (abc !== '' && abc.includes('Mot de passe num')); // French ID
                        var englishpass = (abc !== '' && abc.includes('Password:') && !abc.includes('Numerical Password:')); // English Password
                        var germanpass = (abc !== '' && abc.includes('Kennwort:') && !abc.includes('Numerisches Kennwort:')); // German Password
                        var frenchpass = (abc !== '' && abc.includes('Mot de passe :') && !abc.includes('Mot de passe num')); // French Password
                        if (englishidpass || germanidpass || frenchidpass|| englishpass || germanpass || frenchpass) {
                            var nextline = lines[x + 1].trim();
                            if (x + 1 < lines.length && (nextline !== '' && (nextline.startsWith('ID:') || nextline.startsWith('ID :')) )) {
                                identifier = nextline.replace('ID:','').replace('ID :', '').trim();
                                foundIDMarkedLine = true;
                            }else if (x + 1 < lines.length && nextline !== '') {
                                password = nextline;
                                foundMarkedLine = true;
                            }
                        }
                    }
                    ret[drive].identifier = (foundIDMarkedLine ? identifier : ''); // Set Bitlocker Identifier
                    ret[drive].recoveryPassword = (foundMarkedLine ? password : ''); // Set Bitlocker Password
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