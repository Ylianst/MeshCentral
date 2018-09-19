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

// Used on Windows and Linux to get information about running processes
function processManager() {
    this._ObjectID = 'process-manager'; // Used for debugging, allows you to get the object type at runtime.
    
    // Setup the platform specific calls.
    switch (process.platform)
    {
        case 'win32':
            this._kernel32 = GM.CreateNativeProxy('kernel32.dll');
            this._kernel32.CreateMethod('GetLastError');
            this._kernel32.CreateMethod('CreateToolhelp32Snapshot');
            this._kernel32.CreateMethod('Process32First');
            this._kernel32.CreateMethod('Process32Next');
            break;
        case 'linux':
        case 'darwin':
            this._childProcess = require('child_process');
            break;
        default:
            throw (process.platform + ' not supported');
            break;
    }
    this.enumerateProcesses = function enumerateProcesses()
    {
        var promise = require('promise');
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        this.getProcesses(function (ps, prom) { prom._res(ps); }, ret);
        return (ret);
    }
    // Return a object of: pid -> process information.
    this.getProcesses = function getProcesses(callback)
    {
        switch(process.platform)
        {
            default:
                throw ('Enumerating processes on ' + process.platform + ' not supported');
                break;
            case 'win32': // Windows processes
                var retVal = {};
                var h = this._kernel32.CreateToolhelp32Snapshot(2, 0);
                var info = GM.CreateVariable(304);
                info.toBuffer().writeUInt32LE(304, 0);
                var nextProcess = this._kernel32.Process32First(h, info);
                while (nextProcess.Val) 
                {
                    retVal[info.Deref(8, 4).toBuffer().readUInt32LE(0)] = { pid: info.Deref(8, 4).toBuffer().readUInt32LE(0), cmd: info.Deref(GM.PointerSize == 4 ? 36 : 44, 260).String };
                    nextProcess = this._kernel32.Process32Next(h, info);
                }
                if (callback) { callback.apply(this, [retVal]); }
                break;
            case 'linux': // Linux processes
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
                    var retVal = {}, lines = this.ps.split('\x0D\x0A'), key = {}, keyi = 0;
                    for (var i in lines)
                    {
                        var tokens = lines[i].split(' ');
                        var tokenList = [];
                        for(var x in tokens)
                        {
                            if (i == 0 && tokens[x]) { key[tokens[x]] = keyi++; }
                            if (i > 0 && tokens[x]) { tokenList.push(tokens[x]);}
                        }
                        if (i > 0) {
                            if (tokenList[key.PID]) { retVal[tokenList[key.PID]] = { pid: key.PID, user: tokenList[key.USER], cmd: tokenList[key.COMMAND] }; }
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
            case 'darwin':
                var promise = require('promise');
                var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
                p.pm = this;
                p.callback = callback;
                p.args = [];
                for (var i = 1; i < arguments.length; ++i) { p.args.push(arguments[i]); }
                p.child = this._childProcess.execFile("/bin/ps", ["ps", "-xa"]);
                p.child.promise = p;
                p.child.stdout.ps = '';
                p.child.stdout.on('data', function (chunk) { this.ps += chunk.toString(); });
                p.child.on('exit', function ()
                {
                    var lines = this.stdout.ps.split('\n');
                    var pidX = lines[0].split('PID')[0].length + 3;
                    var cmdX = lines[0].split('CMD')[0].length;
                    var ret = {};
                    for (var i = 1; i < lines.length; ++i)
                    {
                        if (lines[i].length > 0)
                        {
                            ret[lines[i].substring(0, pidX).trim()] = { pid: lines[i].substring(0, pidX).trim(), cmd: lines[i].substring(cmdX) };
                        }
                    }
                    this.promise._res(ret);
                });
                p.then(function (ps)
                {
                    this.args.unshift(ps);
                    this.callback.apply(this.pm, this.args);
                });
                break;
        }
    };

    // Get information about a specific process on Linux
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