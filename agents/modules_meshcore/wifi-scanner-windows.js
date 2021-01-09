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

function _Scan()
{
    var wlanInterfaces = this.Marshal.CreatePointer();
    this.Native.WlanEnumInterfaces(this.Handle, 0, wlanInterfaces);

    var count = wlanInterfaces.Deref().Deref(0, 4).toBuffer().readUInt32LE(0);

    var info = wlanInterfaces.Deref().Deref(8, 532);
    var iname = info.Deref(16, 512).AnsiString;

    var istate;
    switch (info.Deref(528, 4).toBuffer().readUInt32LE(0))
    {
        case 0:
            istate = "NOT READY";
            break;
        case 1:
            istate = "CONNECTED";
            break;
        case 2:
            istate = "AD-HOC";
            break;
        case 3:
            istate = "DISCONNECTING";
            break;
        case 4:
            istate = "DISCONNECTED";
            break;
        case 5:
            istate = "ASSOCIATING";
            break;
        case 6:
            istate = "DISCOVERING";
            break;
        case 7:
            istate = "AUTHENTICATING";
            break;
        default:
            istate = "UNKNOWN";
            break;
    }

    var iguid = info.Deref(0, 16);
    if (this.Native.WlanScan(this.Handle, iguid, 0, 0, 0).Val == 0)
    {
        return (true);
    }
    else
    {
        return (false);
    }
}

function AccessPoint(_ssid, _bssid, _rssi, _lq)
{
    this.ssid = _ssid;
    this.bssid = _bssid;
    this.rssi = _rssi;
    this.lq = _lq;
}
AccessPoint.prototype.toString = function()
{
    return (this.ssid + " [" + this.bssid + "]: " + this.lq);
}

function OnNotify(NotificationData)
{
    var NotificationSource = NotificationData.Deref(0, 4).toBuffer().readUInt32LE(0);
    var NotificationCode = NotificationData.Deref(4, 4).toBuffer().readUInt32LE(0);
    var dataGuid = NotificationData.Deref(8, 16);

    if ((NotificationSource & 0X00000008) && (NotificationCode == 7))
    {
        var bss = this.Parent.Marshal.CreatePointer();
        var result = this.Parent.Native.GetBSSList(this.Parent.Handle, dataGuid, 0, 3, 0, 0, bss).Val;
        if (result == 0)
        {
            var totalSize = bss.Deref().Deref(0, 4).toBuffer().readUInt32LE(0);
            var numItems = bss.Deref().Deref(4, 4).toBuffer().readUInt32LE(0);
            for (i = 0; i < numItems; ++i)
            {
                var item = bss.Deref().Deref(8 + (360 * i), 360);
                var ssid = item.Deref(4, 32).String.trim();
                var bssid = item.Deref(40, 6).HexString2;
                var rssi = item.Deref(56, 4).toBuffer().readUInt32LE(0);
                var lq = item.Deref(60, 4).toBuffer().readUInt32LE(0);

                this.Parent.emit('Scan', new AccessPoint(ssid, bssid, rssi, lq));
            }
        }

    }
}

function Wireless()
{
    var emitterUtils = require('events').inherits(this);

    this.Marshal = require('_GenericMarshal');
    this.Native = this.Marshal.CreateNativeProxy("wlanapi.dll");
    this.Native.CreateMethod("WlanOpenHandle");
    this.Native.CreateMethod("WlanGetNetworkBssList", "GetBSSList");
    this.Native.CreateMethod("WlanRegisterNotification");
    this.Native.CreateMethod("WlanEnumInterfaces");
    this.Native.CreateMethod("WlanScan");
    this.Native.CreateMethod("WlanQueryInterface");

    var negotiated = this.Marshal.CreatePointer();
    var h = this.Marshal.CreatePointer();

    this.Native.WlanOpenHandle(2, 0, negotiated, h);
    this.Handle = h.Deref();

    this._NOTIFY_PROXY_OBJECT = this.Marshal.CreateCallbackProxy(OnNotify, 2);
    this._NOTIFY_PROXY_OBJECT.Parent = this;
    var PrevSource = this.Marshal.CreatePointer();
    var result = this.Native.WlanRegisterNotification(this.Handle, 0X0000FFFF, 0, this._NOTIFY_PROXY_OBJECT.Callback, this._NOTIFY_PROXY_OBJECT.State, 0, PrevSource);

    emitterUtils.createEvent('Scan');
    emitterUtils.addMethod('Scan', _Scan);

    this.GetConnectedNetwork = function ()
    {
        var interfaces = this.Marshal.CreatePointer();

        console.log('Success = ' + this.Native.WlanEnumInterfaces(this.Handle, 0, interfaces).Val);
        var count = interfaces.Deref().Deref(0, 4).toBuffer().readUInt32LE(0);
        var info = interfaces.Deref().Deref(8, 532);
        var iname = info.Deref(16, 512).AnsiString;
        var istate = info.Deref(528, 4).toBuffer().readUInt32LE(0);
        if(info.Deref(528, 4).toBuffer().readUInt32LE(0) == 1) // CONNECTED
        {
            var dataSize = this.Marshal.CreatePointer();
            var pData = this.Marshal.CreatePointer();
            var valueType = this.Marshal.CreatePointer();
            var iguid = info.Deref(0, 16);
            var retVal = this.Native.WlanQueryInterface(this.Handle, iguid, 7, 0, dataSize, pData, valueType).Val;
            if (retVal == 0)
            {
                var associatedSSID = pData.Deref().Deref(524, 32).String;
                var bssid = pData.Deref().Deref(560, 6).HexString;
                var lq = pData.Deref().Deref(576, 4).toBuffer().readUInt32LE(0);

                return (new AccessPoint(associatedSSID, bssid, 0, lq));
            }
        }
        throw ("GetConnectedNetworks: FAILED (not associated to a network)");
    };


    return (this);
}

module.exports = new Wireless();
