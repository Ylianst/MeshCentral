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


var GM = require('_GenericMarshal');

function processManager()
{
    this._ObjectID = 'process-manager';
    switch(process.platform)
    {
        case 'win32':
            this._kernel32 = GM.CreateNativeProxy('kernel32.dll');
            this._kernel32.CreateMethod('GetLastError');
            this._kernel32.CreateMethod('CreateToolhelp32Snapshot');
            this._kernel32.CreateMethod('Process32First');
            this._kernel32.CreateMethod('Process32Next');
            break;
        case 'linux':
            this._childProcess = require('child_process');
            break;
        default:
            throw (process.platform + ' not supported');
            break;
    }
    this.getProcesses = function getProcesses(callback)
    {
        switch(process.platform)
        {
            default:
                throw ('Enumerating processes on ' + process.platform + ' not supported');
                break;
            case 'win32':
                var retVal = [];
                var h = this._kernel32.CreateToolhelp32Snapshot(2, 0);
                var info = GM.CreateVariable(304);
                info.toBuffer().writeUInt32LE(304, 0);
                var nextProcess = this._kernel32.Process32First(h, info);
                while (nextProcess.Val) 
                {
                    retVal.push({ pid: info.Deref(8, 4).toBuffer().readUInt32LE(0), command: info.Deref(GM.PointerSize == 4 ? 36 : 44, 260).String });
                    nextProcess = this._kernel32.Process32Next(h, info);
                }
                if (callback) { callback.apply(this, [retVal]); }
                break;
            case 'linux':
                if (!this._psp) { this._psp = {}; }
                var p = this._childProcess.execFile("/bin/ps", ["ps", "-uxa"], { type: this._childProcess.SpawnTypes.TERM });
                this._psp[p.pid] = p;
                p.Parent = this;
                p.ps = '';
                p.callback = callback;
                p.args = [];
                for (var i = 1; i < arguments.length; ++i) { p.args.push(arguments[i]); }
                p.on('exit', function onGetProcesses()
                {
                    delete this.Parent._psp[this.pid]; 
                    var retVal = [];
                    var lines = this.ps.split('\x0D\x0A');
                    var key = {};
                    var keyi = 0;
                    for (var i in lines)
                    {
                        var tokens = lines[i].split(' ');
                        var tokenList = [];
                        for(var x in tokens)
                        {
                            if (i == 0 && tokens[x]) { key[tokens[x]] = keyi++; }
                            if (i > 0 && tokens[x]) { tokenList.push(tokens[x]);}
                        }
                        if(i>0)
                        {
                            if (tokenList[key.PID])
                            {
                                retVal.push({ pid: tokenList[key.PID], user: tokenList[key.USER], command: tokenList[key.COMMAND] });
                            }
                        }
                    }
                    if (this.callback)
                    {
                        this.args.unshift(retVal);
                        this.callback.apply(this.parent, this.args);
                    }
                });
                p.stdout.on('data', function (chunk) { this.parent.ps += chunk.toString(); });
                break;
        }
    };
    this.getProcessInfo = function getProcessInfo(pid)
    {
        switch(process.platform)
        {
            default:
                throw ('getProcessInfo() not supported for ' + process.platform);
                break;
            case 'linux':
                var status = require('fs').readFileSync('/proc/' + pid + '/status');
                var info = {};
                var lines = status.toString().split('\n');
                for(var i in lines)
                {
                    var tokens = lines[i].split(':');
                    if (tokens.length > 1) { tokens[1] = tokens[1].trim(); }
                    info[tokens[0]] = tokens[1];
                }
                return (info);
                break;
        }
    };
}

module.exports = new processManager();