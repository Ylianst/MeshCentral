/*
Copyright 2026

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

// Runs the auto-tag collectors the server sends (the "collect" section of a domain's autoTags config) and reports their
// values back with { action: 'autotagdata', data: { name: value } }. The server turns those values into device tags.
//
// Collector types:
//   ini      - value of "key" in "path", optionally only inside [section]
//   regex    - first capture group (or the whole match) of "pattern" in the file at "path"
//   dir      - an entry of the folder at "path" whose name matches "match": pick first/last (by name), newest/oldest (by date) or count
//   fileinfo - "exists", "size" or "mtime" of "path"
//   registry - Windows registry value "key" under "path", such as HKLM\SOFTWARE\Vendor\App
//   env      - environment variable "name"
// "path" can also be a list, tried in order until one gives a value. Each collector runs every "interval" minutes.

var MAX_FILE_SIZE = 4 * 1024 * 1024;
var MAX_VALUE = 1024;
var TICK = 60000;

function readText(path) {
    var fs = require('fs');
    var st = fs.statSync(path);
    if (st.size > MAX_FILE_SIZE) { throw ('file is larger than ' + MAX_FILE_SIZE + ' bytes'); }
    var buf = fs.readFileSync(path);
    if ((buf.length > 1) && (buf[0] == 0xFF) && (buf[1] == 0xFE)) {
        // UTF-16LE with a BOM, the agent has no decoder for it
        var parts = [], chunk = [];
        for (var i = 2; (i + 1) < buf.length; i += 2) {
            chunk.push(buf[i] + (buf[i + 1] * 256));
            if (chunk.length == 8192) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
        }
        if (chunk.length > 0) { parts.push(String.fromCharCode.apply(null, chunk)); }
        return parts.join('');
    }
    var s = buf.toString();
    if (s.charCodeAt(0) == 0xFEFF) { s = s.substring(1); } // UTF-8 BOM
    return s;
}

function readIni(c) {
    var lines = readText(c.path).split(/\r\n|\r|\n/);
    var want = (c.section != null) ? c.section.toLowerCase() : null, key = c.key.toLowerCase(), current = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if ((line.length == 0) || (line[0] == ';') || (line[0] == '#')) continue;
        if ((line[0] == '[') && (line[line.length - 1] == ']')) { current = line.substring(1, line.length - 1).trim().toLowerCase(); continue; }
        if ((want != null) && (current != want)) continue;
        var eq = line.indexOf('=');
        if ((eq > 0) && (line.substring(0, eq).trim().toLowerCase() == key)) {
            var v = line.substring(eq + 1).trim();
            if ((v.length > 1) && (v[0] == '"') && (v[v.length - 1] == '"')) { v = v.substring(1, v.length - 1); }
            return v;
        }
    }
    return null;
}

function readRegex(c) {
    var m = new RegExp(c.pattern, 'im').exec(readText(c.path));
    if (m == null) return null;
    return (m.length > 1) ? m[1] : m[0];
}

function mtimeOf(st) { var t = new Date(st.mtime).getTime(); return isNaN(t) ? 0 : t; }

function readDir(c) {
    var fs = require('fs'), path = require('path');
    var names = fs.readdirSync(path.join(c.path, '*')); // The agent's readdirSync takes a wildcard
    var re = (c.match != null) ? new RegExp(c.match, 'i') : null;
    var list = [];
    for (var i = 0; i < names.length; i++) {
        if ((names[i] == '.') || (names[i] == '..')) continue;
        if ((re != null) && !re.test(names[i])) continue;
        list.push(names[i]);
    }
    if (c.pick == 'count') return String(list.length);
    if (list.length == 0) return null;
    if ((c.pick == 'newest') || (c.pick == 'oldest')) {
        var best = null, bestTime = 0;
        for (var j = 0; j < list.length; j++) {
            var t = 0;
            try { t = mtimeOf(fs.statSync(path.join(c.path, list[j]))); } catch (ex) { continue; }
            if ((best == null) || ((c.pick == 'newest') ? (t > bestTime) : (t < bestTime))) { best = list[j]; bestTime = t; }
        }
        return best;
    }
    list.sort();
    return (c.pick == 'first') ? list[0] : list[list.length - 1];
}

function readFileInfo(c) {
    var fs = require('fs'), st = null;
    try { st = fs.statSync(c.path); } catch (ex) { }
    if (c.property == 'exists') return (st != null) ? 'true' : 'false';
    if (st == null) return null;
    if (c.property == 'size') return String(st.size);
    var t = mtimeOf(st);
    return (t == 0) ? null : new Date(t).toISOString();
}

function readRegistry(c) {
    if (process.platform != 'win32') { throw ('registry is only on Windows'); }
    var reg = require('win-registry');
    var i = c.path.indexOf('\\');
    var hiveName = ((i > 0) ? c.path.substring(0, i) : c.path).toUpperCase(), subPath = (i > 0) ? c.path.substring(i + 1) : '';
    var hive = null;
    if ((hiveName == 'HKLM') || (hiveName == 'HKEY_LOCAL_MACHINE')) { hive = reg.HKEY.LocalMachine; }
    else if ((hiveName == 'HKU') || (hiveName == 'HKEY_USERS')) { hive = reg.HKEY.Users; }
    else { throw ('registry path must start with HKLM\\ or HKU\\'); }
    var v = reg.QueryKey(hive, subPath, c.key);
    if (v == null) return null;
    if (Array.isArray(v)) return v.join(' ');
    if (Buffer.isBuffer(v)) return v.toString('hex');
    return String(v);
}

// "path" can be a list of places to look: the first one that gives a value wins. When none does, the last error is reported,
// or no value when the files were read but held nothing that matched.
function runOne(c) {
    if (Array.isArray(c.path)) {
        var lastError = null, read = false;
        for (var i = 0; i < c.path.length; i++) {
            var one = {}; for (var k in c) { one[k] = c[k]; } one.path = c.path[i];
            try { var v = runPath(one); read = true; if (v != null) return v; } catch (ex) { lastError = ex; }
        }
        if ((read == false) && (lastError != null)) { throw lastError; }
        return null;
    }
    return runPath(c);
}

function runPath(c) {
    switch (c.type) {
        case 'ini': return readIni(c);
        case 'regex': return readRegex(c);
        case 'dir': return readDir(c);
        case 'fileinfo': return readFileInfo(c);
        case 'registry': return readRegistry(c);
        case 'env': return (process.env[c.name] != null) ? String(process.env[c.name]) : null;
    }
    throw ('unknown collector type ' + c.type);
}

// send(data) is called with all current values whenever one of them changes.
function createCollector(send) {
    var obj = { collectors: {}, values: {}, errors: {}, lastRun: {}, timer: null, lastSent: null };

    obj.setCollectors = function (collectors) {
        obj.collectors = ((collectors != null) && (typeof collectors == 'object')) ? collectors : {};
        obj.values = {}; obj.errors = {}; obj.lastRun = {}; obj.lastSent = null;
        if (obj.timer != null) { clearInterval(obj.timer); obj.timer = null; }
        if (Object.keys(obj.collectors).length == 0) return;
        obj.timer = setInterval(function () { obj.run(false); }, TICK);
        obj.run(true);
    };

    // Run the collectors that are due, or all of them with force.
    obj.run = function (force) {
        var now = Date.now();
        for (var name in obj.collectors) {
            var c = obj.collectors[name], every = ((typeof c.interval == 'number') && (c.interval >= 1)) ? (c.interval * 60000) : 3600000;
            if (!force && (obj.lastRun[name] != null) && ((now - obj.lastRun[name]) < (every - 5000))) continue;
            obj.lastRun[name] = now;
            try {
                var v = runOne(c);
                if (v == null) { delete obj.values[name]; } else { obj.values[name] = String(v).substring(0, MAX_VALUE); }
                delete obj.errors[name];
            } catch (ex) {
                delete obj.values[name];
                obj.errors[name] = String(ex);
            }
        }
        var x = JSON.stringify(obj.values);
        if (x != obj.lastSent) { obj.lastSent = x; send(obj.values); }
    };

    // Text for the agent console "autotags" command
    obj.status = function () {
        var names = Object.keys(obj.collectors);
        if (names.length == 0) return 'No auto tag collectors.';
        var r = [];
        for (var i = 0; i < names.length; i++) {
            var n = names[i], c = obj.collectors[n];
            var line = n + ' (' + c.type + ', every ' + c.interval + ' min): ';
            if (obj.errors[n] != null) { line += 'ERROR ' + obj.errors[n]; }
            else if (obj.values[n] != null) { line += JSON.stringify(obj.values[n]); }
            else { line += '(no value)'; }
            r.push(line);
        }
        return r.join('\r\n');
    };

    return obj;
}

module.exports = { create: createCollector, run: runOne };
