/*
Copyright 2019 Intel Corporation

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

var promise = require('promise');

function qfe()
{
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'qfe', 'list', 'full', '/FORMAT:CSV']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    var lines = child.stdout.str.trim().split('\r\n');
    var keys = lines[0].split(',');
    var i, key;
    var tokens;
    var result = [];

    for (i = 1; i < lines.length; ++i)
    {
        var obj = {};
        tokens = lines[i].split(',');
        for (key = 0; key < keys.length; ++key)
        {
            if (tokens[key]) { obj[keys[key]] = tokens[key]; }
        }
        result.push(obj);
    }
    return (result);
}
function av()
{
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', '/Namespace:\\\\root\\SecurityCenter2', 'Path', 'AntiVirusProduct', 'get', '/FORMAT:CSV']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); })
    child.waitExit();

    var lines = child.stdout.str.trim().split('\r\n');
    var keys = lines[0].split(',');
    var i, key;
    var tokens;
    var result = [];

    for (i = 1; i < lines.length; ++i)
    {
        var obj = {};
        var status = {};
        tokens = lines[i].split(',');
        for (key = 0; key < keys.length; ++key)
        {
            if (tokens[key] != undefined) { obj[keys[key].trim()] = tokens[key]; }
        }
        status.product = obj.displayName;
        status.updated = (parseInt(obj.productState) & 0x10) == 0;
        status.enabled = (parseInt(obj.productState) & 0x1000) == 0x1000;
        result.push(status);
    }
    return (result);
}
function defrag(options)
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var path = '';

    switch(require('os').arch())
    {
        case 'x64':
            if (require('_GenericMarshal').PointerSize == 4)
            {
                // 32 Bit App on 64 Bit Windows
                ret._rej('Cannot defrag volume on 64 bit Windows from 32 bit application');
                return (ret);
            }
            else
            {
                // 64 Bit App
                path = process.env['windir'] + '\\System32\\defrag.exe';
            }
            break;
        case 'ia32':
            // 32 Bit App on 32 Bit Windows
            path = process.env['windir'] + '\\System32\\defrag.exe';
            break;
        default:
            ret._rej(require('os').arch() + ' not supported');
            return (ret);
            break;
    }

    ret.child = require('child_process').execFile(process.env['windir'] + '\\System32\\defrag.exe', ['defrag', options.volume + ' /A']);
    ret.child.promise = ret;
    ret.child.promise.options = options;
    ret.child.stdout.str = ''; ret.child.stdout.on('data', function (c) { this.str += c.toString(); });
    ret.child.stderr.str = ''; ret.child.stderr.on('data', function (c) { this.str += c.toString(); });
    ret.child.on('exit', function (code)
    {
        var lines = this.stdout.str.trim().split('\r\n');
        var obj = { volume: this.promise.options.volume };
        for (var i in lines)
        {
            var token = lines[i].split('=');
            if(token.length == 2)
            {
                switch(token[0].trim().toLowerCase())
                {
                    case 'volume size':
                        obj['size'] = token[1];
                        break;
                    case 'free space':
                        obj['free'] = token[1];
                        break;
                    case 'total fragmented space':
                        obj['fragmented'] = token[1];
                        break;
                    case 'largest free space size':
                        obj['largestFragment'] = token[1];
                        break;
                }               
            }
        }
        this.promise._res(obj);
    });
    return (ret);
}
function regQuery(H, Path, Key)
{
    try
    {
        return(require('win-registry').QueryKey(H, Path, Key));
    }
    catch(e)
    {
        return (null);
    }
}
function pendingReboot()
{
    var tmp = null;
    var ret = null;
    var HKEY = require('win-registry').HKEY;
    if(regQuery(HKEY.LocalMachine, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing', 'RebootPending') !=null)
    {
        ret = 'Component Based Servicing';
    }
    else if(regQuery(HKEY.LocalMachine, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate', 'RebootRequired'))
    {
        ret = 'Windows Update';
    }
    else if ((tmp=regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager', 'PendingFileRenameOperations'))!=null && tmp != 0 && tmp != '')
    {
        ret = 'File Rename';
    }
    else if (regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ActiveComputerName', 'ComputerName') != regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ComputerName', 'ComputerName'))
    {
        ret = 'System Rename';
    }
    return (ret);
}

function installedApps()
{
    var promise = require('promise');
    var ret = new promise(function (a, r) { this._resolve = a; this._reject = r; });
    
    var code = "\
    var reg = require('win-registry');\
    var result = [];\
    var val, tmp;\
    var items = reg.QueryKey(reg.HKEY.LocalMachine, 'SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall');\
    for (var key in items.subkeys)\
    {\
        val = {};\
        try\
        {\
            val.name = reg.QueryKey(reg.HKEY.LocalMachine, 'SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\' + items.subkeys[key], 'DisplayName');\
        }\
        catch(e)\
        {\
            continue;\
        }\
        try\
        {\
            val.version = reg.QueryKey(reg.HKEY.LocalMachine, 'SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\' + items.subkeys[key], 'DisplayVersion');\
            if (val.version == '') { delete val.version; }\
        }\
        catch(e)\
        {\
        }\
        try\
        {\
            val.location = reg.QueryKey(reg.HKEY.LocalMachine, 'SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\' + items.subkeys[key], 'InstallLocation');\
            if (val.location == '') { delete val.location; }\
        }\
        catch(e)\
        {\
        }\
        result.push(val);\
    }\
    console.log(JSON.stringify(result,'', 1));process.exit();";

    ret.child = require('child_process').execFile(process.execPath, [process.execPath.split('\\').pop().split('.exe')[0], '-exec "' + code + '"']);
    ret.child.promise = ret;
    ret.child.stdout.str = ''; ret.child.stdout.on('data', function (c) { this.str += c.toString(); });
    ret.child.on('exit', function (c) { this.promise._resolve(JSON.parse(this.stdout.str.trim())); });
    return (ret);
}

if (process.platform == 'win32')
{
    module.exports = { qfe: qfe, av: av, defrag: defrag, pendingReboot: pendingReboot, installedApps: installedApps };
}
else
{
    var not_supported = function () { throw (process.platform + ' not supported'); };
    module.exports = { qfe: not_supported, av: not_supported, defrag: not_supported, pendingReboot: not_supported, installedApps: not_supported };
}