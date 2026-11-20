/*
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

// The folders of PATH, then the usual program folders, /usr/X11R6/bin for OpenBSD and /opt/homebrew/bin for macOS
// Services start with a minimal path, add as needed here
var BIN_DIRS = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin', '/usr/X11R6/bin', '/opt/homebrew/bin'];

// An executable regular file by name, null when there is none. whereis ran a shell, is missing on BusyBox and its second word can be a man page
function findBinary(bin)
{
    if (process.platform == 'win32') { return (null); }
    var fs = require('fs'), dirs = (process.env['PATH'] ? process.env['PATH'].split(':') : []).concat(BIN_DIRS);
    for (var i = 0; i < dirs.length; ++i)
    {
        if (dirs[i] == '') { continue; }
        var p = dirs[i] + '/' + bin;
        try { var st = fs.statSync(p); if (st.isFile() && ((st.mode & 0x49) != 0)) { return (p); } } catch (e) { }
    }
    return (null);
}
function hasBinary(bin) { return (findBinary(bin) != null); }

// SONAMEs the loader resolves by itself. libc.so.7 is FreeBSD's, and musl's dlopen() maps any libc name to musl itself
// The number is the ABI version, which only changes on a break. These have been the same on Linux and FreeBSD for decades, glibc's libc.so.6 since 1997
var SONAMES = { libc: ['libc.so.6', 'libc.so.7', 'libc.so'], libX11: ['libX11.so.6'], libXtst: ['libXtst.so.6'], libXext: ['libXext.so.6'], libXfixes: ['libXfixes.so.3'], libxkbfile: ['libxkbfile.so.1'] };

// Loading is the test, the loader checks word size, byte order, CPU and float ABI itself and every caller dlopen()s the result
function loads(lib) { try { require('_GenericMarshal').CreateNativeProxy(lib); return (true); } catch (e) { return (false); } }

// The library for name that this agent can load, null when there is none. A known SONAME first, it is the loader's own pick with its search order and libc family.
// Otherwise the files in the loader's folders in its order, the SONAME link first, for names the table lacks like OpenBSD's libX11.so.18.0
function findLibrary(name)
{
    var so = SONAMES[name] || [], fs = require('fs');
    for (var i = 0; i < so.length; ++i) { if (loads(so[i])) { return (so[i]); } }
    var dirs = libSearchDirs();
    for (var d = 0; d < dirs.length; ++d)
    {
        var files;
        try { files = fs.readdirSync(dirs[d]); } catch (e) { continue; }
        files = files.filter(function (f) { return (libNameRank(f, name) >= 0); }).sort(function (a, b) { return (libNameRank(a, name) - libNameRank(b, name)); });
        for (var j = 0; j < files.length; ++j) { if (loads(dirs[d] + '/' + files[j])) { return (dirs[d] + '/' + files[j]); } }
    }
    return (null);
}

// The SONAME link (libX11.so.6) first, because it exists without the -dev package and keeps pointing at the right library through an update.
// Then other versioned files, the bare .so and the .dylib names last, and -1 for a file that is not this library.
// Version suffixes are digits only, because a .bak or .dpkg-new copy of a library loads just as well as the library itself.
function libNameRank(f, name)
{
    if (f.indexOf(name) != 0) { return (-1); }
    var rest = f.substring(name.length);
    if (/^\.so\.[0-9]+$/.test(rest)) { return (0); }
    if (/^\.so(\.[0-9]+)+$/.test(rest)) { return (1); }
    if ((rest == '.so') || /^(\.[0-9]+)*\.dylib$/.test(rest)) { return (2); }
    return (-1);
}

// The folders the system loader searches, in its own order, so the first match is the library the loader would pick
function libSearchDirs()
{
    var fs = require('fs'), dirs = [], add = function (d) { if (dirs.indexOf(d) < 0) { dirs.push(d); } };
    if (process.platform == 'linux')
    {
        // musl's path file only on a musl system (Alpine). Debian's musl package installs one too, and its libc.so is a valid ELF that came out first
        if (fs.existsSync('/etc/ld.so.conf')) { readDirList('/etc/ld.so.conf', add); }
        else { try { fs.readdirSync('/etc').forEach(function (f) { if (/^ld-musl-.+\.path$/.test(f)) { readDirList('/etc/' + f, add); } }); } catch (e) { } }
        // Debian multiarch. A -linux-musl folder there is a cross toolchain, never the system's libc, and its libc.so is a valid ELF that would come out first
        ['/lib', '/usr/lib'].forEach(function (base) { try { fs.readdirSync(base).forEach(function (f) { if (/-linux-gnu/.test(f)) { add(base + '/' + f); } }); } catch (e) { } });
        ['/lib64', '/usr/lib64', '/lib', '/usr/lib', '/usr/local/lib', '/lib32', '/usr/lib32'].forEach(add);
    }
    else if (process.platform == 'freebsd')
    {
        try { fs.readdirSync('/usr/local/libdata/ldconfig').forEach(function (f) { readDirList('/usr/local/libdata/ldconfig/' + f, add); }); } catch (e) { }
        ['/lib', '/usr/lib', '/usr/local/lib', '/usr/X11R6/lib', '/usr/lib32'].forEach(add);	// /usr/X11R6/lib for OpenBSD
    }
    else if (process.platform == 'darwin') { ['/usr/lib', '/opt/X11/lib', '/opt/homebrew/lib', '/usr/local/lib'].forEach(add); }
    return (dirs);
}

// Adds the folders of a loader config file, one per line with # comments, and follows glibc's "include /etc/ld.so.conf.d/*.conf" lines
function readDirList(file, add)
{
    var fs = require('fs'), lines;
    try { lines = fs.readFileSync(file).toString().split('\n'); } catch (e) { return; }
    for (var i = 0; i < lines.length; ++i)
    {
        var l = lines[i].replace(/#.*$/, '').trim(), m = /^include\s+(.+)\/\*(\.conf)?$/.exec(l);
        if (m != null) { try { fs.readdirSync(m[1]).sort().forEach(function (f) { if ((m[2] == null) || /\.conf$/.test(f)) { readDirList(m[1] + '/' + f, add); } }); } catch (e) { } }
        else if (l.charAt(0) == '/') { add(l); }
    }
}

module.exports = { findLibrary: findLibrary, hasBinary: hasBinary, findBinary: findBinary };
