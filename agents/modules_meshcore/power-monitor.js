/*
Copyright 2018-2020 Intel Corporation

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

var WM_SYSCOMMAND = 0x0112;
var SC_MONITORPOWER = 0xF170;
var HWND_BROADCAST = 0xffff;
var ES_DISPLAY_REQUIRED = 0x00000002;

function powerMonitor()
{
    this._ObjectID = 'power-monitor';
    require('events').EventEmitter.call(this, true)
        .createEvent('changed')
        .createEvent('sx')
        .createEvent('batteryLevel')
        .createEvent('acdc')
        .createEvent('display');

    this._ACState = 1;
    this._BatteryLevel = -1;

    if (process.platform == 'win32')
    {
        // These must be registered BEFORE newListener is hooked up
        this.on('batteryLevel', function (level) { this._BatteryLevel = level; });
        this.on('acdc', function (m) { this._ACState = (m == 'AC' ? 1 : 0); });
    }

    this.on('newListener', function (name, callback)
    {
        if (name == 'acdc') { callback.call(this, this._ACState == 1 ? 'AC' : 'BATTERY'); }
        if (name == 'batteryLevel') { if (this._BatteryLevel >= 0) { callback.call(this, this._BatteryLevel); } }
    });

    this._i = setImmediate(function (self)
    {
        require('user-sessions'); // This is needed because this is where the Windows Messages are processed for these events
        delete self._i;
    }, this);

    if (process.platform == 'linux')
    {
        this._ACPath = null;
        this._BatteryPath = [];

        var devices = require('fs').readdirSync('/sys/class/power_supply');
        for (var i in devices)
        {
            if (require('fs').readFileSync('/sys/class/power_supply/' + devices[i] + '/type').toString().trim() == 'Mains')
            {
                this._ACPath = '/sys/class/power_supply/' + devices[i] + '/';
                break;
            }
        }
        for (var i in devices)
        {
            if (require('fs').readFileSync('/sys/class/power_supply/' + devices[i] + '/type').toString().trim() == 'Battery')
            {
                this._BatteryPath.push('/sys/class/power_supply/' + devices[i] + '/');
            }
        }
        if (this._ACPath != null)
        {
            this._ACState = parseInt(require('fs').readFileSync(this._ACPath + 'online').toString().trim());
        }
        if (this._BatteryPath.length > 0)
        {
            this._getBatteryLevel = function _getBatteryLevel()
            {
                var sum = 0;
                var i;
                for (i in this._BatteryPath)
                {
                    sum += parseInt(require('fs').readFileSync(this._BatteryPath[i] + 'capacity').toString().trim());
                }
                sum = Math.floor(sum / this._BatteryPath.length);
                return (sum);
            }
            this._BatteryLevel = this._getBatteryLevel();

            // Since Battery Levels are not propagated with ACPI, we need to periodically check the battery level
            this._BatteryLevelCheck = function _BatteryLevelCheck()
            {
                var val = this._getBatteryLevel();
                if (val != this._BatteryLevel)
                {
                    this._BatteryLevel = val;
                    this.emit('batteryLevel', val);
                }
            };
            this._BattCheckInterval = setInterval(function (self)
            {
                self._BatteryLevelCheck.call(self);
            }, 300000, this);
        }
        this._acpiSink = function _acpiSink(acpiEvent)
        {
            if (acpiEvent.name == 'ac_adapter')
            {
                _acpiSink.self._ACState = acpiEvent.value;
                _acpiSink.self.emit('acdc', acpiEvent.value == 1 ? 'AC' : 'BATTERY');
                _acpiSink.self._BatteryLevelCheck();
            }
        };
        this._acpiSink.self = this;
        require('linux-acpi').on('acpi', this._acpiSink);
    }
    if (process.platform == 'darwin')
    {
        Object.defineProperty(this, "_caffeinate", {
            value: (function ()
            {
                var child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
                child.stdin.write('whereis caffeinate\nexit\n');
                child.waitExit();
                return (child.stdout.str.trim());
            })()
        });
        this._getBatteryLevel = function _getBatteryLevel()
        {
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
            child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
            child.stdin.write("pmset -g batt | tr '\\n' '`' | awk -F'`' '");
            child.stdin.write('{');
            child.stdin.write('   power=split($1,pwr,"AC")>1?"1":"0";');
            child.stdin.write('   split($2, batt, " ");');
            child.stdin.write('   split(batt[2],chg,"%");');
            child.stdin.write('   printf "{\\"ac\\": %s,\\"level\\": %s}",power, chg[1]; ');
            child.stdin.write("}'\nexit\n");
            child.waitExit();
            try {
                var info = JSON.parse(child.stdout.str.trim());
                return (info);
            } catch (e) {
                child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
                child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
                child.stdin.write("pmset -g batt | tr '\\n' '`' | awk -F'`' '");
                child.stdin.write('{');
                child.stdin.write('   power=split($1,pwr,"AC")>1?"1":"0";');
                child.stdin.write('   split($2, batt, " ");');
                child.stdin.write('   split(batt[3],chg,"%");');
                child.stdin.write('   printf "{\\"ac\\": %s,\\"level\\": %s}",power, chg[1]; ');
                child.stdin.write("}'\nexit\n");
                child.waitExit();
                try {
                    var info = JSON.parse(child.stdout.str.trim());
                    return (info);
                } catch (e) {
                    return ({ ac: 1, level: -1 });
                }
            }
        };
        this._batteryLevelCheck = function _batteryLevelCheck()
        {
            var newLevel = this._getBatteryLevel();
            if (newLevel.ac != this._ACState)
            {
                this._ACState = newLevel.ac;
                this.emit('acdc', this._ACState == 1 ? 'AC' : 'BATTERY');
            }
            if (newLevel.level != this._BatteryLevel)
            {
                this._BatteryLevel = newLevel.level;
                this.emit('batteryLevel', this._BatteryLevel);
            }
        };
        var tmp = this._getBatteryLevel();
        this._ACState = tmp.ac;
        this._BatteryLevel = tmp.level;

        if (this._BatteryLevel >= 0)
        {
            this._BattCheckInterval = setInterval(function (self)
            {
                self._batteryLevelCheck.call(self);
            }, 300000, this);
        }
    }
    this.sleepDisplay = function sleepDispay(force)
    {
        var promise = require('promise');
        p = new promise(function (res, rej) { this._res = res; this._rej = rej; });

        switch (process.platform)
        {
            case 'win32':
                if (require('user-sessions').getProcessOwnerName(process.pid).tsid == 0)
                {
                    // We are running as LocalSystem, so we have to find a user session for this to work
                    var options = { launch: { module: 'power-monitor', method: 'sleepDisplay', args: [] } };
                    try
                    {
                        options.user = require('user-sessions').getUsername(require('user-sessions').consoleUid());
                    }
                    catch (ee)
                    {
                        p._rej('No users logged in');
                        return (p);
                    }
                    p.child = require('child-container').create(options);
                    p.child.promise = p;
                    p.child.on('exit', function () { this.promise._res(); });
                }
                else
                {
                    if (require('child-container').child) { require('win-console').hide(); }
                    var GM = require('_GenericMarshal');
                    var user32 = GM.CreateNativeProxy('User32.dll');
                    user32.CreateMethod('SendMessageA');
                    user32.SendMessageA(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2);
                    p._res();
                    if (require('child-container').child) { process._exit(); }
                }
                break;
            case 'darwin':
                p.child = require('child_process').execFile('/bin/sh', ['sh']);
                p.child.promise = p;
                p.child.stderr.on('data', function () { });
                p.child.stdout.on('data', function () { });
                p.child.on('exit', function () { this.promise._res(); });
                p.child.stdin.write('pmset displaysleepnow\nexit\n');
                break;
            default:
                p._rej('Not Supported');
                break;
        }
        return (p);
    };
    this.wakeDisplay = function wakeDisplay()
    {
        var promise = require('promise');
        p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        switch(process.platform)
        {
            case 'darwin':
                if (this._caffeinate)
                {
                    p.child = require('child_process').execFile(this._caffeinate, ['caffeinate', '-u', '-t 2']);
                    p.child.stdout.on('data', function () { });
                    p.child.stderr.on('data', function () { });
                    p.child.on('exit', function (code) { this.promise._res(); });
                    p.child.promise = p;
                }
                break;
            case 'win32':
                if (require('user-sessions').getProcessOwnerName(process.pid).tsid == 0)
                {
                    // We are running as LocalSystem, so we have to find a user session for this to work
                    var options = { launch: { module: 'power-monitor', method: 'wakeDisplay', args: [] } };
                    try
                    {
                        options.user = require('user-sessions').getUsername(require('user-sessions').consoleUid());
                    }
                    catch (ee)
                    {
                        p._rej('No users logged in');
                        return (p);
                    }
                    p.child = require('child-container').create(options);
                    p.child.promise = p;
                    p.child.on('exit', function () { this.promise._res(); });
                }
                else
                {
                    if (require('child-container').child) { require('win-console').hide(); }
                    var GM = require('_GenericMarshal');
                    var kernel32 = GM.CreateNativeProxy('Kernel32.dll');
                    kernel32.CreateMethod('SetThreadExecutionState');
                    kernel32.SetThreadExecutionState(ES_DISPLAY_REQUIRED);
                    p._res();
                    if (require('child-container').child) { process._exit(); }
                }
                break;
            default:
                p._res();
                break;
        }
        return (p);
    };
}

module.exports = new powerMonitor();
