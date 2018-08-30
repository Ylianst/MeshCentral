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

function UserSessions()
{
    this._ObjectID = 'UserSessions';

    if (process.platform == 'win32') {
        this._marshal = require('_GenericMarshal');
        this._kernel32 = this._marshal.CreateNativeProxy('Kernel32.dll');
        this._kernel32.CreateMethod('GetLastError');
        this._wts = this._marshal.CreateNativeProxy('Wtsapi32.dll');
        this._wts.CreateMethod('WTSEnumerateSessionsA');
        this._wts.CreateMethod('WTSQuerySessionInformationA');
        this._wts.CreateMethod('WTSFreeMemory');
        this.SessionStates = ['Active', 'Connected', 'ConnectQuery', 'Shadow', 'Disconnected', 'Idle', 'Listening', 'Reset', 'Down', 'Init'];
        this.InfoClass =
            {
                'WTSInitialProgram': 0,
                'WTSApplicationName': 1,
                'WTSWorkingDirectory': 2,
                'WTSOEMId': 3,
                'WTSSessionId': 4,
                'WTSUserName': 5,
                'WTSWinStationName': 6,
                'WTSDomainName': 7,
                'WTSConnectState': 8,
                'WTSClientBuildNumber': 9,
                'WTSClientName': 10,
                'WTSClientDirectory': 11,
                'WTSClientProductId': 12,
                'WTSClientHardwareId': 13,
                'WTSClientAddress': 14,
                'WTSClientDisplay': 15,
                'WTSClientProtocolType': 16,
                'WTSIdleTime': 17,
                'WTSLogonTime': 18,
                'WTSIncomingBytes': 19,
                'WTSOutgoingBytes': 20,
                'WTSIncomingFrames': 21,
                'WTSOutgoingFrames': 22,
                'WTSClientInfo': 23,
                'WTSSessionInfo': 24,
                'WTSSessionInfoEx': 25,
                'WTSConfigInfo': 26,
                'WTSValidationInfo': 27,
                'WTSSessionAddressV4': 28,
                'WTSIsRemoteSession': 29
            };

        this.getSessionAttribute = function getSessionAttribute(sessionId, attr)
        {
            var buffer = this._marshal.CreatePointer();
            var bytesReturned = this._marshal.CreateVariable(4);

            if (this._wts.WTSQuerySessionInformationA(0, sessionId, attr, buffer, bytesReturned).Val == 0)
            {
                throw ('Error calling WTSQuerySessionInformation: ' + this._kernel32.GetLastError.Val);
            }

            var retVal = buffer.Deref().String;

            this._wts.WTSFreeMemory(buffer.Deref());
            return (retVal);
        };

        this.Current = function Current()
        {
            var retVal = {};
            var pinfo = this._marshal.CreatePointer();
            var count = this._marshal.CreateVariable(4);
            if (this._wts.WTSEnumerateSessionsA(0, 0, 1, pinfo, count).Val == 0)
            {
                throw ('Error calling WTSEnumerateSessionsA: ' + this._kernel32.GetLastError().Val);
            }

            for (var i = 0; i < count.toBuffer().readUInt32LE() ; ++i)
            {
                var info = pinfo.Deref().Deref(i * (this._marshal.PointerSize == 4 ? 12 : 24), this._marshal.PointerSize == 4 ? 12 : 24);
                var j = { SessionId: info.toBuffer().readUInt32LE() };
                j.StationName = info.Deref(this._marshal.PointerSize == 4 ? 4 : 8, this._marshal.PointerSize).Deref().String;
                j.State = this.SessionStates[info.Deref(this._marshal.PointerSize == 4 ? 8 : 16, 4).toBuffer().readUInt32LE()];
                if (j.State == 'Active') {
                    j.Username = this.getSessionAttribute(j.SessionId, this.InfoClass.WTSUserName);
                    j.Domain = this.getSessionAttribute(j.SessionId, this.InfoClass.WTSDomainName);
                }
                retVal[j.SessionId] = j;
            }

            this._wts.WTSFreeMemory(pinfo.Deref());

            Object.defineProperty(retVal, 'connected', { value: showActiveOnly(retVal) });
            return (retVal);
        };
    }
    else
    {
        this.Current = function Current()
        {
            var retVal = {};
            var emitterUtils = require('events').inherits(retVal);
            emitterUtils.createEvent('logon');

            retVal._child = require('child_process').execFile('/usr/bin/last', ['last', '-f', '/var/run/utmp']);
            retVal._child.Parent = retVal;
            retVal._child._txt = '';
            retVal._child.on('exit', function (code)
            {
                var lines = this._txt.split('\n');
                var sessions = [];
                for(var i in lines)
                {
                    if (lines[i])
                    {
                        console.log(getTokens(lines[i]));
                        var user = lines[i].substring(0, lines[i].indexOf(' '));
                        sessions.push(user);
                    }
                }
                sessions.pop();
                console.log(sessions);
            });
            retVal._child.stdout.Parent = retVal._child;
            retVal._child.stdout.on('data', function (chunk) { this.Parent._txt += chunk.toString(); });

            return (retVal);
        }
    }
}
function showActiveOnly(source)
{
    var retVal = [];
    for (var i in source)
    {
        if (source[i].State == 'Active' || source[i].State == 'Connected')
        {
            retVal.push(source[i]);
        }
    }
    return (retVal);
}
function getTokens(str)
{
    var columns = [];
    var i;

    columns.push(str.substring(0, (i=str.indexOf(' '))));
    while (str[++i] == ' ');
    columns.push(str.substring(i, str.substring(i).indexOf(' ') + i));
    
    return (columns);
}

module.exports = new UserSessions();