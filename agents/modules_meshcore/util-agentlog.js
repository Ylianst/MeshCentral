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


function parseLine(entry)
{
    var test = entry.match(/^\[\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2}(?: [AP]M)?\s*\]/); // match on timestamp in AM/PM or 24h notation
    if (test == null)
    {
        test = entry.match(/\[.+ => .+:[0-9]+\]/);  // Windows crash entry: [func => file:line]
        if (test != null)
        {
            // Windows Crash Entry
            var file = test[0].substring(1).match(/(?!.+ ).+(?=:)/);
            var line = test[0].match(/(?!:)[0-9]+(?=\]$)/);
            var fn = test[0].match(/(?!\[).+(?= =>)/);

            var wEntry = this.results.peek();
            if (wEntry != null)
            {
                if (file != null) { wEntry.f = file[0].trim(); }
                if (line != null) { wEntry.l = line[0]; }
                if (fn != null) { wEntry.fn = fn[0]; }
            }
        }
        else
        {
            test = entry.match(/^[\.\/].+\(\) \[0x[0-9a-fA-F]+\]$/);
            if (test != null)
            {
                // Linux Crash Stack with no symbols
                test = test[0].match(/(?!\[)0x[0-9a-fA-F]+(?=\]$)/);
                if (test != null)
                {
                    var lEntry = this.results.peek();
                    if (lEntry != null)
                    {
                        if (lEntry.sx == null) { lEntry.sx = []; }
                        lEntry.sx.unshift(test[0]);
                    }
                }
            }
            else
            {
                test = entry.match(/^\[.+_[0-9a-fA-F]{16}\]$/); // f.e. [core_dump_fedcba9876543210]
                if(test!=null)
                {
                    // Linux Crash ID
                    test = test[0].match(/(?!_)[0-9a-fA-F]{16}(?=\]$)/);    // extract hex id
                    var idEntry = this.results.peek();
                    if (idEntry != null) { idEntry.h = test[0]; }
                }
            }

            test = entry.match(/(?!^=>)\/+.+:[0-9]+$/); // f.e. /path/to/file.c:42
            if(test!=null)
            {
                // Linux Crash Entry
                var srcEntry = this.results.peek();
                if (srcEntry != null)
                {
                    if (srcEntry.s == null) { srcEntry.s = []; }
                    srcEntry.s.unshift(test[0]);
                }
            }
            
        }
        return;
    }
    test = test[0];

    var dd = test.substring(1, test.length -1);
    var c = dd.split(' ');
    var t = c[1].split(':');
    var hour = parseInt(t[0]);
    if (c[2] == 'AM' && hour == 12) { hour = 0; } else if (c[2] == 'PM' && hour != 12) { hour += 12; }
    t[0] = (hour < 10 ? '0' : '') + hour;

    var d = Date.parse(c[0] + 'T' + t.join(':'));
    var msg = entry.substring(test.length).trim();
    var hash = msg.match(/^\[[0-9a-fA-F]{16}\]/);
    if (hash != null)
    {
        hash = hash[0].substring(1, hash[0].length - 1);
        msg = msg.substring(hash.length + 2).trim();
    }
    else
    {
        hash = msg.match(/^\[\]/);
        if(hash!=null)
        {
            msg = msg.substring(2).trim();
            hash = null;
        }
    }

    var log = { t: Math.floor(d / 1000), m: msg };
    if (hash != null) { log.h = hash; }

    // Check for File/Line in generic log entry
    test = msg.match(/^.+:[0-9]+ \([0-9]+,[0-9]+\)/);
    if (test != null)
    {
        log.m = log.m.substring(test[0].length).trim();
        log.f = test[0].match(/^.+(?=:[0-9]+)/)[0];
        log.l = test[0].match(/(?!:)[0-9]+(?= \([0-9]+,[0-9]+\)$)/)[0];
    }

    this.results.push(log);
}

function readLog_data(buffer)
{
    var lines = buffer.toString();
    if (this.buffered != null) { lines = this.buffered + lines; }
    lines = lines.split('\n');
    var i;

    for (i = 0; i < (lines.length - 1) ; ++i)
    {
        parseLine.call(this, lines[i]);
    }

    if (lines.length == 1)
    {
        parseLine.call(this, lines[0]);
        this.buffered = null;
    }
    else
    {
        this.buffered = lines[lines.length - 1];
    }
}

function readLogEx(path)
{
    var ret = [];
    try
    {
        var s = require('fs').createReadStream(path);
        s.buffered = null;
        s.results = ret;
        s.on('data', readLog_data);
        s.resume();
        if (s.buffered != null) { readLog_data.call(s, s.buffered); s.buffered = null; }
        s.removeAllListeners('data');
        s = null;
    }
    catch(z)
    {
    }

    return (ret);
}

function readLog(criteria, path)
{
    var objects = readLogEx(path == null ? (process.execPath.split('.exe').join('') + '.log') : path);
    var ret = [];

    if (typeof (criteria) == 'string')
    {
        try
        {
            var dstring = Date.parse(criteria);
            criteria = Math.floor(dstring / 1000);
        }
        catch(z)
        {
        }
    }

    if (typeof (criteria) == 'number')
    {
        if(criteria < 1000)
        {
            // Return the last xxx entries
            ret = objects.slice(objects.length - ((criteria > objects.length) ? objects.length : criteria));
        }
        else
        {
            // Return entries that are newer than xxx
            var i;
            for (i = 0; i < objects.length && objects[i].t <= criteria; ++i) { }
            ret = objects.slice(i);
        }
    }
    else
    {
        ret = objects;
    }

    return (ret);
}

module.exports = { read: readLog, readEx: readLogEx }

