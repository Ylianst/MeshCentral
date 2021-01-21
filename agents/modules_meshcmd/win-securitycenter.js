/*
Copyright 2021 Intel Corporation

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

var seccenter = null;
var WSC_SECURITY_PROVIDER_FIREWALL = 0x1;
var WSC_SECURITY_PROVIDER_AUTOUPDATE_SETTINGS = 0x2;
var WSC_SECURITY_PROVIDER_ANTIVIRUS = 0x4;
var WSC_SECURITY_PROVIDER_ANTISPYWARE = 0x8;

var WSC_SECURITY_PROVIDER_HEALTH_GOOD = 0;          // Green pillar in English locales
var WSC_SECURITY_PROVIDER_HEALTH_NOTMONITORED = 1;  // Yellow pillar in English locales
var WSC_SECURITY_PROVIDER_HEALTH_POOR = 2;          // Red pillar in English locales
var WSC_SECURITY_PROVIDER_HEALTH_SNOOZE = 3;        // Yellow pillar in English locales

try
{
    seccenter = require('_GenericMarshal').CreateNativeProxy('Wscapi.dll');
    seccenter.CreateMethod('WscGetSecurityProviderHealth');
    seccenter.CreateMethod('WscRegisterForChanges');
    seccenter.CreateMethod('WscUnRegisterChanges'); 
}
catch(e)
{
}

function statusString(val)
{
    var ret = 'UNKNOWN';

    switch (val)
    {
        case 0:
            ret = 'OK';
            break;
        case 1:
        case 3:
            ret = 'WARNING';
            break;
        case 2:
            ret = 'PROBLEM';
            break;
        default:
            ret = 'UNKNOWN';
            break;
    }
    return (ret);
}
function getStatus()
{
    var ret = { firewall: 'UNKNOWN', antiVirus: 'UNKNOWN', autoUpdate: 'UNKNOWN' };
    if (seccenter != null)
    {
        var status = require('_GenericMarshal').CreateVariable(4);
        if (seccenter.WscGetSecurityProviderHealth(WSC_SECURITY_PROVIDER_FIREWALL, status).Val == 0) { ret.firewall = statusString(status.toBuffer().readUInt32LE()); }
        if (seccenter.WscGetSecurityProviderHealth(WSC_SECURITY_PROVIDER_ANTIVIRUS, status).Val == 0) { ret.antiVirus = statusString(status.toBuffer().readUInt32LE()); }
        if (seccenter.WscGetSecurityProviderHealth(WSC_SECURITY_PROVIDER_AUTOUPDATE_SETTINGS, status).Val == 0) { ret.autoUpdate = statusString(status.toBuffer().readUInt32LE()); }
    }
    return (ret);
}

if (process.platform == 'win32' && seccenter != null)
{
    var j = { status: getStatus };
    require('events').EventEmitter.call(j, true)
        .createEvent('changed');
    j._H = require('_GenericMarshal').CreatePointer();
    j._EV = require('_GenericMarshal').GetGenericGlobalCallback(1);
    j._EV.parent = j;
    j._EV.on('GlobalCallback', function (p)
    {
        if (!this.ObjectToPtr_Verify(this.parent, p)) { return; } // This event is not for us
        this.parent.emit('changed');
    });
    j.on('~', function ()
    {
        if (seccenter.WscUnRegisterChanges(this._H).Val == 0) { }
    });

    if (seccenter.WscRegisterForChanges(0, j._H, j._EV, require('_GenericMarshal').ObjectToPtr(j)).Val == 0)
    {
        j._H = j._H.Deref();
    }
    module.exports = j;
}
else
{
    throw ('win-securitycenter not supported on this platform');
}