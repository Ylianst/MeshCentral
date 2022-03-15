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

    v = require('win-wmi').query('ROOT\\CIMV2\\Security\\MicrosoftVolumeEncryption', 'SELECT * FROM Win32_EncryptableVolume');
    for (i in v)
    {
        var tmp = trimObject(v[i]);
        for (var k in tmp)
        {
            ret[tmp.DeviceID][k] = tmp[k];
        }
    }
    return (ret);
}

module.exports = { getVolumes: function () { try { return (getVolumes()); } catch (x) { return ({}); } } };