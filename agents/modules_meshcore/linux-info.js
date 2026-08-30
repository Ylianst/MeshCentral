
var promise = require('promise');

function dataHandler(data) { this.str += data.toString(); }

// Shell preamble that sets $TO to a 'timeout N' prefix when the 'timeout' utility
// is present (busybox/coreutils), or empty otherwise. Killing /bin/sh does not
// stop a reparented grandchild (e.g. a hung clamscan); 'timeout' does.
function shellTimeout(seconds) { return 'TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout ' + seconds + '"; '; }

// Run a short shell script WITHOUT blocking the event loop: cb(trimmedStdout) is
// called when the child exits or the timeout elapses. This never calls waitExit()
// (whose nested event loop can re-enter from another timer as 'waitExit() already
// in progress' when a command hangs). The child is killed on overrun, and
// shellTimeout()'s 'timeout' prefix stops a hung grandchild.
function runShellAsync(script, timeout, cb) {
    var done = false;
    function finish(child, out) {
        if (done) { return; }
        done = true;
        if (child) {
            if (child._to) { try { clearTimeout(child._to); } catch (ex) { } }
            try { child.kill(); } catch (ex) { }
        }
        cb((out || '').trim());
    }
    try {
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stderr.on('data', function () { });
        child.on('exit', function () { finish(this, this.stdout.str); });
        child._to = setTimeout(function () { finish(child, child.stdout.str); }, timeout);
        child.stdin.write(script + '\nexit\n');
    } catch (ex) { finish(null, ''); }
}

// Asynchronous so it never blocks the caller with a waitExit() nested loop. Calls
// callback(arrayOrEmpty).
function av(callback)
{
    var fs = require('fs');

    // Find the clamscan binary and use its absolute path (don't depend on PATH,
    // the agent environment may not include the binary's directory).
    var clamBinaries = ['/usr/bin/clamscan', '/usr/local/bin/clamscan', '/bin/clamscan'];
    var clamPath = null;
    for (var i = 0; i < clamBinaries.length; ++i) {
        try { if (fs.existsSync(clamBinaries[i])) { clamPath = clamBinaries[i]; break; } } catch (ex) { }
    }
    if (clamPath == null) { callback([]); return; }

    var status = { product: 'ClamAV', enabled: false, updated: false };

    // Virus database date: newest mtime of the ClamAV signature files. Pure JS, so
    // it needs no subprocess and can't hang on busybox-vs-coreutils tool differences.
    try {
        var newest = 0;
        var dbFiles = ['/var/lib/clamav/main.cvd', '/var/lib/clamav/main.cld'];
        for (var k = 0; k < dbFiles.length; ++k) {
            try { var st = fs.statSync(dbFiles[k]); var t = (st && st.mtime) ? st.mtime.getTime() : 0; if (t > newest) { newest = t; } } catch (ex) { }
        }
        if (newest > 0) {
            var d = new Date(newest);
            status.definitionDate = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            status.updated = true;
        }
    } catch (ex) { }

    // Get the ClamAV version, then whether clamd is running, then return. Both run as
    // non-blocking children, so a hung command can't stall the agent or nest waitExit().
    runShellAsync(shellTimeout(4) + '$TO "' + clamPath + '" --version 2>/dev/null', 4000, function (verOut) {
        var v = verOut.split('\n')[0].trim();
        if (v) { status.product = v; }
        // systemd via 'is-active'; otherwise a direct process check (pgrep). The old
        // 'rc-service clamd status' path could block for seconds on Alpine/OpenRC.
        runShellAsync(
            shellTimeout(4) +
            'if command -v systemctl >/dev/null 2>&1; then ' +
                'if $TO systemctl is-active --quiet clamav-daemon 2>/dev/null || $TO systemctl is-active --quiet clamd 2>/dev/null; then echo active; else echo inactive; fi; ' +
            'else ' +
                'pgrep -x clamd >/dev/null 2>&1 && echo active || echo inactive; ' +
            'fi', 4000, function (svcOut) {
                status.enabled = (svcOut.split('\n')[0].trim() === 'active');
                callback([status]);
            });
    });
}

// Asynchronous so it never blocks the caller with a waitExit() nested loop. Calls
// callback(objectOrNull).
function firewall(callback)
{
    var fs = require('fs');

    // Find the ufw binary and use its absolute path (don't depend on PATH).
    var ufwBinaries = ['/usr/sbin/ufw', '/sbin/ufw', '/usr/bin/ufw'];
    var ufwPath = null;
    for (var i = 0; i < ufwBinaries.length; ++i) {
        try { if (fs.existsSync(ufwBinaries[i])) { ufwPath = ufwBinaries[i]; break; } } catch (ex) { }
    }
    if (ufwPath == null) { callback(null); return; }

    runShellAsync(shellTimeout(4) + '$TO "' + ufwPath + '" status 2>/dev/null', 4000, function (out) {
        callback({
            product: 'UFW',
            installed: true,
            enabled: /^status:\s+active$/i.test(out.split('\n')[0])
        });
    });
}

function packages() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var fs = require('fs');

    // Run a shell script without blocking the event loop, capped at 30s; cb(stdout).
    function runSh(script, cb) { runShellAsync(shellTimeout(25) + '$TO ' + script, 30000, cb); }

    function dirExists(path) {
        try { return fs.existsSync(path); } catch (ex) { return false; }
    }

    function binExists(paths) {
        for (var i = 0; i < paths.length; ++i) {
            try { if (fs.existsSync(paths[i])) return true; } catch (ex) { }
        }
        return false;
    }

    // ---------- dpkg (Debian/Ubuntu) ----------
    function collectDpkg(cb) {
        if (!binExists(['/usr/bin/dpkg-query', '/bin/dpkg-query']) || !dirExists('/var/lib/dpkg/info')) { cb([]); return; }

        runSh('dpkg-query -W -f=\'${binary:Package}\\t${Version}\\t${Architecture}\\t${db:Status-Abbrev}\\t${Maintainer}\\n\' 2>/dev/null', function (out) {
            if (!out) { cb([]); return; }
            runSh('find /var/lib/dpkg/info -name \'*.list\' -printf \'%f\\t%TY-%Tm-%Td\\n\' 2>/dev/null', function (dateOut) {
                var dateMap = {};
                if (dateOut) {
                    dateOut.split('\n').forEach(function (line) {
                        var p = line.split('\t');
                        if (p.length >= 2) { dateMap[p[0].replace(/\.list$/, '')] = p[1]; }
                    });
                }

                var results = [];
                out.split('\n').forEach(function (line) {
                    var p = line.split('\t');
                    if (p.length < 4) return;
                    if (p[3].indexOf('ii') !== 0) return;
                    results.push({ name: p[0], version: p[1], arch: p[2], publisher: p[4] || '', date: dateMap[p[0]] || '', location: 'dpkg' });
                });
                cb(results);
            });
        });
    }

    // ---------- rpm (RHEL/Fedora/CentOS/SUSE) ----------
    function collectRpm(cb) {
        if (!binExists(['/usr/bin/rpm', '/bin/rpm']) || (!dirExists('/var/lib/rpm') && !dirExists('/usr/lib/sysimage/rpm'))) { cb([]); return; }

        runSh('rpm -qa --qf \'%{NAME}\\t%{VERSION}\\t%{RELEASE}\\t%{ARCH}\\t%{VENDOR}\\t%{INSTALLTIME:date}\\n\' 2>/dev/null', function (out) {
            if (!out) { cb([]); return; }
            var results = [];
            out.split('\n').forEach(function (line) {
                var p = line.split('\t');
                if (p.length < 5 || !p[0]) return;
                results.push({ name: p[0], version: p[1] + (p[2] ? '-' + p[2] : ''), arch: p[3], publisher: p[4] || '', date: p[5] || '', location: 'rpm' });
            });
            cb(results);
        });
    }

    // ---------- pacman (Arch/Manjaro) ----------
    function collectPacman(cb) {
        if (!binExists(['/usr/bin/pacman', '/bin/pacman']) || !dirExists('/var/lib/pacman/local')) { cb([]); return; }

        runSh('pacman -Qi 2>/dev/null', function (out) {
            if (!out) { cb([]); return; }
            var results = [];
            var current = {};
            out.split('\n').forEach(function (line) {
                var m = line.match(/^([A-Za-z ]+?)\s*:\s(.+)$/);
                if (m) {
                    current[m[1].trim()] = m[2].trim();
                } else if (!line.trim() && current['Name']) {
                    results.push({ name: current['Name'], version: current['Version'] || '', arch: current['Architecture'] || '', publisher: current['Packager'] || '', date: current['Install Date'] || '', location: 'pacman' });
                    current = {};
                }
            });
            if (current['Name']) {
                results.push({ name: current['Name'], version: current['Version'] || '', arch: current['Architecture'] || '', publisher: current['Packager'] || '', date: current['Install Date'] || '', location: 'pacman' });
            }
            cb(results);
        });
    }

    // ---------- apk (Alpine) ----------
    function collectApk(cb) {
        if (!binExists(['/sbin/apk', '/usr/bin/apk']) || (!dirExists('/lib/apk/db') && !dirExists('/var/lib/apk/db'))) { cb([]); return; }

        runSh('apk info -v 2>/dev/null', function (out) {
            if (!out) { cb([]); return; }
            var results = [];
            out.split('\n').forEach(function (line) {
                line = line.trim();
                if (!line) return;
                var match = line.match(/^(.+)-(\d[^-]*)(-r\d+)?$/);
                if (match) {
                    results.push({ name: match[1], version: match[2] + (match[3] || ''), arch: '', publisher: '', location: 'apk' });
                } else {
                    results.push({ name: line, version: '', arch: '', publisher: '', location: 'apk' });
                }
            });
            cb(results);
        });
    }

    // ---------- flatpak ----------
    function collectFlatpak(cb) {
        if (!binExists(['/usr/bin/flatpak', '/bin/flatpak']) || !dirExists('/var/lib/flatpak')) { cb([]); return; }

        var results = [];

        runSh('flatpak list --system --columns=application,version,origin 2>/dev/null', function (sys) {
            sys.split('\n').forEach(function (line) {
                var p = line.split('\t');
                if (!p[0] || !p[0].trim()) return;
                results.push({ name: p[0].trim(), version: (p[1] || '').trim(), arch: '', publisher: (p[2] || '').trim(), location: 'flatpak', scope: 'system' });
            });

            runSh('flatpak list --user --columns=application,version,origin 2>/dev/null', function (usr) {
                usr.split('\n').forEach(function (line) {
                    var p = line.split('\t');
                    if (!p[0] || !p[0].trim()) return;
                    results.push({ name: p[0].trim(), version: (p[1] || '').trim(), arch: '', publisher: (p[2] || '').trim(), location: 'flatpak', scope: 'user' });
                });

                cb(results);
            });
        });
    }

    // ---------- snap ----------
    function collectSnap(cb) {
        if (!binExists(['/usr/bin/snap', '/bin/snap']) || !dirExists('/var/lib/snapd/snaps')) { cb([]); return; }

        runSh('snap list --all 2>/dev/null', function (out) {
            if (!out) { cb([]); return; }
            var results = [];
            out.split('\n').forEach(function (line) {
                if (!line || line.indexOf('Name') === 0) return;
                var p = line.trim().split(/\s+/);
                if (p.length < 5 || !p[0]) return;
                results.push({ name: p[0], version: p[1], arch: '', publisher: p[4] || '', location: 'snap' });
            });
            cb(results);
        });
    }

    // Run every collector concurrently (non-blocking), keep results in source order,
    // and resolve once all have reported. Each collector calls its callback exactly
    // once; the bucket guard makes a stray double-callback harmless.
    var collectors = [collectDpkg, collectRpm, collectPacman, collectApk, collectFlatpak, collectSnap];
    var buckets = new Array(collectors.length);
    var pending = collectors.length;
    function onCollected(i, r) {
        if (buckets[i] !== undefined) { return; }
        buckets[i] = (r && r.length) ? r : [];
        if (--pending === 0) {
            try { ret._res([].concat.apply([], buckets)); } catch (e) { ret._rej(e); }
        }
    }
    collectors.forEach(function (collector, i) {
        try { collector(function (r) { onCollected(i, r); }); }
        catch (e) { onCollected(i, []); }
    });

    return (ret);
}

if (process.platform == 'linux') {
    module.exports = { av: av, firewall: firewall, packages: packages };
}
else
{
    var not_supported = function () { throw (process.platform + ' not supported'); };
    module.exports = { av: not_supported, firewall: not_supported, packages: not_supported };
}