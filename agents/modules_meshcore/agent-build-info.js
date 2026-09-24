'use strict';

function elf(filename) {
    var fs = require('fs'), fd;
    try {
        fd = fs.openSync(filename, 'r');
        var data = Buffer.alloc(20);
        if ((fs.readSync(fd, data, 0, 20, 0) !== 20) || (data[0] !== 127) || (data[1] !== 69) || (data[2] !== 76) || (data[3] !== 70)) return null;
        return { bits: data[4] === 2 ? 64 : 32, machine: data[5] === 2 ? data.readUInt16BE(18) : data.readUInt16LE(18) };
    } catch (ex) { return null; }
    finally { if (fd != null) { try { fs.closeSync(fd); } catch (ex) { } } }
}

function read(filename) { try { return require('fs').readFileSync(filename).toString(); } catch (ex) { return ''; } }

function run(filename, args, callback) {
    var child, output = '', timer, finished = false;
    function done() {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        callback(output);
    }
    try {
        child = require('child_process').execFile(filename, [filename].concat(args));
        child.stdout.on('data', function (data) { if (output.length < 131072) output += data.toString(); });
        child.stderr.on('data', function () { });
        child.on('exit', done);
        child.on('error', done);
        timer = setTimeout(function () { try { child.kill(); } catch (ex) { } done(); }, 2000);
    } catch (ex) { done(); }
}

module.exports = function (request, callback) {
    var fs = require('fs'), result = { version: 1, platform: process.platform, paths: [], libraries: [] };
    result.agentVersion = { commit: process.versions.commitHash, date: String(process.versions.commitDate || ''), compiled: process.versions.compileTime };
    var paths = Array.isArray(request.paths) ? request.paths.slice(0, 16) : [];
    var libraries = Array.isArray(request.libraries) ? request.libraries.slice(0, 64) : [];
    paths = paths.filter(function (x) { return typeof x === 'string' && /^\/(?:[a-zA-Z0-9_.+-]+\/)*[a-zA-Z0-9_.+-]+$/.test(x) && x.indexOf('..') === -1; });
    libraries = libraries.filter(function (x) { return typeof x === 'string' && /^[a-zA-Z0-9_+.-]{1,100}$/.test(x); });
    for (var i = 0; i < paths.length; i++) {
        var item = { path: paths[i], status: 'unknown' };
        try { item.status = fs.existsSync(paths[i]) && fs.statSync(paths[i]).isFile() ? 'present' : 'missing'; } catch (ex) { }
        var header = elf(paths[i]);
        if (header) { item.bits = header.bits; item.machine = header.machine; }
        result.paths.push(item);
    }
    if (process.platform === 'darwin') {
        run('/usr/bin/sw_vers', ['-productVersion'], function (text) { result.macos = text.trim(); callback(result); });
        return;
    }
    if ((process.platform !== 'linux') && (process.platform !== 'freebsd')) { callback(result); return; }
    var loaded = [], dirs = ['/lib', '/lib64', '/usr/lib', '/usr/lib64', '/usr/local/lib'];
    var maps = read('/proc/self/maps').split('\n');
    for (var i = 0; i < maps.length; i++) {
        var match = maps[i].match(/\s(\/\S+)$/);
        if (match) loaded.push(match[1]);
    }
    var extra = (process.env.LD_LIBRARY_PATH || '').split(':');
    for (var i = 0; i < extra.length && i < 32; i++) { if (extra[i][0] === '/') dirs.push(extra[i]); }
    if (process.platform === 'linux') {
        try {
            // Query the libc loaded by this agent, which can differ from a 64-bit host's getconf.
            var libc = require('_GenericMarshal').CreateNativeProxy('libc.so.6');
            libc.CreateMethod('gnu_get_libc_version');
            result.glibc = libc.gnu_get_libc_version().String;
        } catch (ex) { }
        var cpuinfo = read('/proc/cpuinfo'), architecture = cpuinfo.match(/^CPU architecture\s*:\s*(\d+)/m);
        if (architecture) result.armVersion = parseInt(architecture[1]);
        var cpu = cpuinfo.match(/^(?:flags|Features)\s*:\s*(.+)$/gm);
        if (cpu && cpu.length) {
            result.features = cpu[0].split(':')[1].trim().toLowerCase().split(/\s+/);
            for (var i = 1; i < cpu.length; i++) {
                var flags = cpu[i].split(':')[1].trim().toLowerCase().split(/\s+/);
                result.features = result.features.filter(function (x) { return flags.indexOf(x) >= 0; });
            }
        }
    }
    function librariesFrom(text) {
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var match = lines[i].match(/=>\s*(\/\S+)/);
            if (match) loaded.push(match[1]);
        }
        for (var i = 0; i < libraries.length; i++) {
            var name = libraries[i], candidates = [], found = [];
            for (var j = 0; j < loaded.length; j++) { if (loaded[j].substring(loaded[j].lastIndexOf('/') + 1) === name) candidates.push(loaded[j]); }
            for (var j = 0; j < dirs.length; j++) candidates.push(dirs[j] + '/' + name);
            for (var j = 0; j < candidates.length; j++) {
                var header = elf(candidates[j]);
                if (header && !found.some(function (x) { return x.bits === header.bits && x.machine === header.machine; })) found.push(header);
            }
            result.libraries.push({ name: name, architectures: found });
        }
        callback(result);
    }
    if (process.platform === 'freebsd') {
        run('/sbin/sysctl', ['-n', 'kern.osreldate'], function (text) {
            result.freebsdAbi = parseInt(text.trim());
            run('/sbin/ldconfig', ['-r'], librariesFrom);
        });
    } else {
        var command = fs.existsSync('/sbin/ldconfig') ? '/sbin/ldconfig' : '/usr/sbin/ldconfig';
        if (fs.existsSync(command)) run(command, ['-p'], librariesFrom); else librariesFrom('');
    }
};
