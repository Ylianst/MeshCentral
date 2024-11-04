/*
Copyright 2019-2021 Intel Corporation

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

var PDH_FMT_LONG = 0x00000100;
var PDH_FMT_DOUBLE = 0x00000200;

var promise = require('promise');
if (process.platform == 'win32')
{
    var GM = require('_GenericMarshal');
    GM.kernel32 = GM.CreateNativeProxy('kernel32.dll');
    GM.kernel32.CreateMethod('GlobalMemoryStatusEx');

    GM.pdh = GM.CreateNativeProxy('pdh.dll');
    GM.pdh.CreateMethod('PdhAddEnglishCounterA');
    GM.pdh.CreateMethod('PdhCloseQuery');
    GM.pdh.CreateMethod('PdhCollectQueryData');
    GM.pdh.CreateMethod('PdhGetFormattedCounterValue');
    GM.pdh.CreateMethod('PdhGetFormattedCounterArrayA');
    GM.pdh.CreateMethod('PdhOpenQueryA');
    GM.pdh.CreateMethod('PdhRemoveCounter');
}

function windows_cpuUtilization()
{
    var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    p.counter = GM.CreateVariable(16);
    p.cpu = GM.CreatePointer();
    p.cpuTotal = GM.CreatePointer();
    var err = 0;
    if ((err = GM.pdh.PdhOpenQueryA(0, 0, p.cpu).Val) != 0) { p._rej(err); return; }

    // This gets the CPU Utilization for each proc
    if ((err = GM.pdh.PdhAddEnglishCounterA(p.cpu.Deref(), GM.CreateVariable('\\Processor(*)\\% Processor Time'), 0, p.cpuTotal).Val) != 0) { p._rej(err); return; }

    if ((err = GM.pdh.PdhCollectQueryData(p.cpu.Deref()).Val != 0)) { p._rej(err); return; }
    p._timeout = setTimeout(function (po)
    {
        var u = { cpus: [] };
        var bufSize = GM.CreateVariable(4);
        var itemCount = GM.CreateVariable(4);
        var buffer, szName, item;
        var e;
        if ((e = GM.pdh.PdhCollectQueryData(po.cpu.Deref()).Val != 0)) { po._rej(e); return; }

        if ((e = GM.pdh.PdhGetFormattedCounterArrayA(po.cpuTotal.Deref(), PDH_FMT_DOUBLE, bufSize, itemCount, 0).Val) == -2147481646)
        {
            buffer = GM.CreateVariable(bufSize.toBuffer().readUInt32LE());
        }
        else
        {
            po._rej(e);
            return;
        }
        if ((e = GM.pdh.PdhGetFormattedCounterArrayA(po.cpuTotal.Deref(), PDH_FMT_DOUBLE, bufSize, itemCount, buffer).Val) != 0) { po._rej(e); return; }
        for(var i=0;i<itemCount.toBuffer().readUInt32LE();++i)
        {
            item = buffer.Deref(i * 24, 24);
            szName = item.Deref(0, GM.PointerSize).Deref();
            if (szName.String == '_Total')
            {
                u.total = item.Deref(16, 8).toBuffer().readDoubleLE();
            }
            else
            {
                u.cpus[parseInt(szName.String)] = item.Deref(16, 8).toBuffer().readDoubleLE();
            }
        }

        GM.pdh.PdhRemoveCounter(po.cpuTotal.Deref());
        GM.pdh.PdhCloseQuery(po.cpu.Deref());
        p._res(u);
    }, 100, p);

    return (p);
}
function windows_memUtilization()
{
    var info = GM.CreateVariable(64);
    info.Deref(0, 4).toBuffer().writeUInt32LE(64);
    GM.kernel32.GlobalMemoryStatusEx(info);

    var ret =
        {
            MemTotal: require('bignum').fromBuffer(info.Deref(8, 8).toBuffer(), { endian: 'little' }),
            MemFree: require('bignum').fromBuffer(info.Deref(16, 8).toBuffer(), { endian: 'little' })
        };

    ret.percentFree = ((ret.MemFree.div(require('bignum')('1048576')).toNumber() / ret.MemTotal.div(require('bignum')('1048576')).toNumber()) * 100);//.toFixed(2);
    ret.percentConsumed = ((ret.MemTotal.sub(ret.MemFree).div(require('bignum')('1048576')).toNumber() / ret.MemTotal.div(require('bignum')('1048576')).toNumber()) * 100);//.toFixed(2);
    ret.MemTotal = ret.MemTotal.toString();
    ret.MemFree = ret.MemFree.toString();
    return (ret);
}

var cpuLastIdle = [];
var cpuLastSum = [];
function linux_cpuUtilization() {
    var ret = { cpus: [] };
    var info = require('fs').readFileSync('/proc/stat');
    var lines = info.toString().split('\n');
    var columns;
    var x, y;
    var cpuNo = 0;
    var currSum, currIdle, utilization;
    for (var i in lines) {
        columns = lines[i].split(' ');
        if (!columns[0].startsWith('cpu')) { break; }

        x = 0, currSum = 0;
        while (columns[++x] == '');
        for (y = x; y < columns.length; ++y) { currSum += parseInt(columns[y]); }
        currIdle = parseInt(columns[3 + x]);

        var diffIdle = currIdle - cpuLastIdle[cpuNo];
        var diffSum = currSum - cpuLastSum[cpuNo];

        utilization = (100 - ((diffIdle / diffSum) * 100));

        cpuLastSum[cpuNo] = currSum;
        cpuLastIdle[cpuNo] = currIdle;

        if (!ret.total) {
            ret.total = utilization;
        } else {
            ret.cpus.push(utilization);
        }
        ++cpuNo;
    }

    var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    p._res(ret);
    return (p);
}
function linux_memUtilization()
{
    var ret = {};

    var info = require('fs').readFileSync('/proc/meminfo').toString().split('\n');
    var tokens;
    for(var i in info)
    {
        tokens = info[i].split(' ');
        switch(tokens[0])
        {
            case 'MemTotal:':
                ret.total = parseInt(tokens[tokens.length - 2]);
                break;
            case 'MemAvailable:':
                ret.free = parseInt(tokens[tokens.length - 2]);
                break;
        }
    }
    ret.percentFree = ((ret.free / ret.total) * 100);//.toFixed(2);
    ret.percentConsumed = (((ret.total - ret.free) / ret.total) * 100);//.toFixed(2);
    return (ret);
}

function macos_cpuUtilization()
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = '';
    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
    child.stdin.write('top -l 1 | grep -E "^CPU"\nexit\n');
    child.waitExit();

    var lines = child.stdout.str.split('\n');
    if (lines[0].length > 0)
    {
        var usage = lines[0].split(':')[1];
        var bdown = usage.split(',');

        var tot = parseFloat(bdown[0].split('%')[0].trim()) + parseFloat(bdown[1].split('%')[0].trim());
        ret._res({total: tot, cpus: []});
    }
    else
    {
        ret._rej('parse error');
    }

    return (ret);
}
function macos_memUtilization()
{
    var mem = { };
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = '';
    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
    child.stdin.write('top -l 1 | grep -E "^Phys"\nexit\n');
    child.waitExit();

    var lines = child.stdout.str.split('\n');
    if (lines[0].length > 0)
    {
        var usage = lines[0].split(':')[1];
        var bdown = usage.split(',');
        if (bdown.length > 2){ // new style - PhysMem: 5750M used (1130M wired, 634M compressor), 1918M unused.
            mem.MemFree = parseInt(bdown[2].trim().split(' ')[0]);
        } else { // old style - PhysMem: 6683M used (1606M wired), 9699M unused.
            mem.MemFree = parseInt(bdown[1].trim().split(' ')[0]);
        }
        mem.MemUsed = parseInt(bdown[0].trim().split(' ')[0]);
        mem.MemTotal = (mem.MemFree + mem.MemUsed);
        mem.percentFree = ((mem.MemFree / mem.MemTotal) * 100);//.toFixed(2);
        mem.percentConsumed = (((mem.MemTotal - mem.MemFree) / mem.MemTotal) * 100);//.toFixed(2);
        return (mem);
    }
    else
    {
        throw ('Parse Error');
    }
}

function windows_thermals()
{
    var ret = [];
    try {
        ret = require('win-wmi').query('ROOT\\WMI', 'SELECT CurrentTemperature,InstanceName FROM MSAcpi_ThermalZoneTemperature',['CurrentTemperature','InstanceName']);
        if (ret[0]) {
            for (var i = 0; i < ret.length; ++i) {
                ret[i]['CurrentTemperature'] = ((parseFloat(ret[i]['CurrentTemperature']) / 10) - 273.15).toFixed(2);
            }
        }
    } catch (ex) { }
    return (ret);
}

function linux_thermals()
{
    var ret = [];
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write("for folder in /sys/class/thermal/thermal_zone*/; do [ -e \"$folder/temp\" ] && echo \"$(cat \"$folder/temp\"),$(cat \"$folder/type\")\"; done\nexit\n");
    child.waitExit();
    if(child.stdout.str.trim()!='')
    {
        var lines = child.stdout.str.trim().split('\n');
        for (var i = 0; i < lines.length; ++i)
        {
            var line = lines[i].trim().split(',');
            ret.push({CurrentTemperature: (parseFloat(line[0])/1000), InstanceName: line[1]});
        }
    }
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write("for mon in /sys/class/hwmon/hwmon*; do for label in \"$mon\"/temp*_label; do if [ -f $label ]; then echo $(cat \"$label\")___$(cat \"${label%_*}_input\"); fi; done; done;\nexit\n");
    child.waitExit();
    if(child.stdout.str.trim()!='')
    {
        var lines = child.stdout.str.trim().split('\n');
        for (var i = 0; i < lines.length; ++i)
        {
            var line = lines[i].trim().split('___');
            ret.push({ CurrentTemperature: (parseFloat(line[1])/1000), InstanceName: line[0] });
        }
    }
    return (ret);
}

function macos_thermals()
{
    var ret = [];
    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.on('data', function () { });
    child.stdin.write('powermetrics --help | grep SMC\nexit\n');
    child.waitExit();
    if (child.stdout.str.trim() != '')
    {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', function (c)
        {
            this.str += c.toString();
            var tokens = this.str.trim().split('\n');
            for (var i in tokens)
            {
                if (tokens[i].split(' die temperature: ').length > 1)
                {
                    ret.push({CurrentTemperature: tokens[i].split(' ')[3], InstanceName: tokens[i].split(' ')[0]});
                    this.parent.kill();
                }
            }
        });
        child.stderr.on('data', function (c) {
            if (c.toString().split('unable to get smc values').length > 1) { // error getting sensors so just kill
                this.parent.kill();
                return;
            }
        });
        child.stdin.write('powermetrics -s smc -i 500 -n 1\n');
        child.waitExit(2000);
    }
    return (ret);
}

switch(process.platform)
{
    case 'linux':
        module.exports = { cpuUtilization: linux_cpuUtilization, memUtilization: linux_memUtilization, thermals: linux_thermals };
        break;
    case 'win32':
        module.exports = { cpuUtilization: windows_cpuUtilization, memUtilization: windows_memUtilization, thermals: windows_thermals };
        break;
    case 'darwin':
        module.exports = { cpuUtilization: macos_cpuUtilization, memUtilization: macos_memUtilization, thermals: macos_thermals };
        break;
}

