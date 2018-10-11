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

try { Object.defineProperty(Array.prototype, "peek", { value: function () { return (this.length > 0 ? this[this.length - 1] : undefined); } }); } catch (e) { }



function dbus(address, uid)
{
    this._ObjectID = 'linux-dbus';
    require('events').EventEmitter.call(this, true)
        .createEvent('signal');
    Object.defineProperty(this, "uid", { value: uid });
    this._child = require('child_process').execFile("/bin/sh", ["sh"], { type: require('child_process').SpawnTypes.TERM, uid: uid == null ? -1 : uid });
    this._child.stdin.write('dbus-monitor --session "type=\'signal\', interface=\'' + address + '\'" | ( while read X; do echo "$X"; done )\n');
    this._child.stdout.dbus = this;
    this._child.stdout.on('data', function (chunk)
    {
        // Parse DBUS Data
        if (!this.ready) { this.ready = true; return; }

        var lines = [];
        var tokens = chunk.toString().split('\r\n');
        for (var i in tokens)
        {
            if (tokens[i] == '')
            {
                // End of record
                this.dbus.preParseRecords(lines);
                lines = [];
            }
            else
            {
                lines.push(tokens[i]);
            }
        }
    });
    this.preParseRecords = function (lines)
    {
        var record = [];
        for (var i in lines)
        {
            if(lines[i].startsWith('signal '))
            {
                if(record.length>0)
                {
                    this.parseRecords(record);
                }
                record = [];
            }
            record.push(lines[i]);
        }
        if (record.length > 0)
        {
            this.parseRecords(record);
        }
    }
    this.parseRecords = function (lines)
    {
        if (lines[0].startsWith('signal '))
        {
            var signal = {};
            var sigtokens = lines[0].split(' ');
            sigtokens.shift();

            for (var i in sigtokens) {
                var sigitems = sigtokens[i].split('=');
                if (sigitems.length == 2) {
                    signal[sigitems[0]] = sigitems[1];
                }
            }

            lines.shift();
            signal.data = lines;

            this.parseSignal(signal);
        }
    }
    this.parseSignal = function(signal)
    {
        var data = signal.data;
        signal.data = [];

        for(var i=0; i<data.length; ++i)
        {
            if (data[i].startsWith('array '))
            {
                signal.data.push([]);
                for(i=i+1; i<data.length; ++i)
                {
                    this.parseSignal2(data[i], signal.data.peek());
                }
            }
            else
            {
                this.parseSignal2(data[i], signal.data);
            }
        }

        this.emit('signal', signal);
    }
    this.parseSignal2 = function (inputStr, outArray)
    {
        if(inputStr.startsWith('string '))
        {
            outArray.push(JSON.parse(inputStr.slice(7)));
        }
        else if(inputStr.startsWith('boolean '))
        {
            outArray.push(JSON.parse(inputStr.slice(8)));
        }
    }
}

module.exports = dbus;
