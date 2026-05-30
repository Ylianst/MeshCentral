
var promise = require('promise');

function dataHandler(data) { this.str += data.toString(); }

function av()
{
    var result = [];
    var child, version, dbDate, running;

    // Check if clamscan binary exists
    var clamBinaries = ['/usr/bin/clamscan', '/usr/local/bin/clamscan', '/bin/clamscan'];
    var clamFound = false;
    var fs = require('fs');
    for (var i = 0; i < clamBinaries.length; ++i) {
        try { if (fs.existsSync(clamBinaries[i])) { clamFound = true; break; } } catch (ex) { }
    }
    if (!clamFound) { return ([]); }

    // Get ClamAV version
    try {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stdin.write('clamscan --version 2>/dev/null | head -1\nexit\n');
        child.waitExit();
        version = child.stdout.str.trim();
    } catch (ex) { version = ''; }

    // Get virus database date from freshclam/clamd dat files
    try {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stdin.write('stat -c "%y" /var/lib/clamav/main.cvd /var/lib/clamav/main.cld 2>/dev/null | sort -r | head -1 | cut -d" " -f1\nexit\n');
        child.waitExit();
        dbDate = child.stdout.str.trim();
    } catch (ex) { dbDate = ''; }

    // Check if clamd service is running (systemd, OpenRC, or process scan fallback)
    try {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stdin.write(
            'if command -v systemctl >/dev/null 2>&1; then ' +
                'systemctl is-active clamav-daemon 2>/dev/null || systemctl is-active clamd 2>/dev/null || echo inactive; ' +
            'elif command -v rc-service >/dev/null 2>&1; then ' +
                'rc-service clamd status 2>/dev/null | grep -q started && echo active || echo inactive; ' +
            'else ' +
                'pgrep -x clamd >/dev/null 2>&1 && echo active || echo inactive; ' +
            'fi\nexit\n'
        );
        child.waitExit();
        running = child.stdout.str.trim() === 'active';
    } catch (ex) { running = false; }

    var status = {};
    status.product = version || 'ClamAV';
    status.enabled = running;
    status.updated = dbDate !== '';
    if (dbDate) { status.definitionDate = dbDate; }
    result.push(status);

    return (result);
}

function firewall()
{
    var child, status, output;

    // Check if ufw binary exists
    var ufwBinaries = ['/usr/sbin/ufw', '/sbin/ufw', '/usr/bin/ufw'];
    var ufwFound = false;
    var fs = require('fs');
    for (var i = 0; i < ufwBinaries.length; ++i) {
        try { if (fs.existsSync(ufwBinaries[i])) { ufwFound = true; break; } } catch (ex) { }
    }
    if (!ufwFound) { return (null); }

    // Get ufw status
    try {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stdin.write('ufw status 2>/dev/null | head -1\nexit\n');
        child.waitExit();
        output = child.stdout.str.trim();
    } catch (ex) { output = ''; }

    return ({
        product: 'UFW',
        installed: true,
        enabled: /^status:\s+active$/i.test(output)
    });
}

function packages() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var fs = require('fs');

    function runSh(script) {
        try {
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (d) { child.stdout.str += d; });
            child.stdin.write(script + '\nexit\n');
            child.waitExit();
            return child.stdout.str.trim();
        } catch (ex) { return ''; }
    }

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
    function collectDpkg() {
        if (!binExists(['/usr/bin/dpkg-query', '/bin/dpkg-query'])) return [];
        if (!dirExists('/var/lib/dpkg/info')) return [];

        var out = runSh('dpkg-query -W -f=\'${binary:Package}\\t${Version}\\t${Architecture}\\t${db:Status-Abbrev}\\t${Maintainer}\\n\' 2>/dev/null');
        if (!out) return [];

        var dateMap = {};
        var dateOut = runSh('find /var/lib/dpkg/info -name \'*.list\' -printf \'%f\\t%TY-%Tm-%Td\\n\' 2>/dev/null');
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
        return results;
    }

    // ---------- rpm (RHEL/Fedora/CentOS/SUSE) ----------
    function collectRpm() {
        if (!binExists(['/usr/bin/rpm', '/bin/rpm'])) return [];
        if (!dirExists('/var/lib/rpm') && !dirExists('/usr/lib/sysimage/rpm')) return [];

        var out = runSh('rpm -qa --qf \'%{NAME}\\t%{VERSION}\\t%{RELEASE}\\t%{ARCH}\\t%{VENDOR}\\t%{INSTALLTIME:date}\\n\' 2>/dev/null');
        if (!out) return [];

        var results = [];
        out.split('\n').forEach(function (line) {
            var p = line.split('\t');
            if (p.length < 5 || !p[0]) return;
            results.push({ name: p[0], version: p[1] + (p[2] ? '-' + p[2] : ''), arch: p[3], publisher: p[4] || '', date: p[5] || '', location: 'rpm' });
        });
        return results;
    }

    // ---------- pacman (Arch/Manjaro) ----------
    function collectPacman() {
        if (!binExists(['/usr/bin/pacman', '/bin/pacman'])) return [];
        if (!dirExists('/var/lib/pacman/local')) return [];

        var out = runSh('pacman -Qi 2>/dev/null');
        if (!out) return [];

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
        return results;
    }

    // ---------- apk (Alpine) ----------
    function collectApk() {
        if (!binExists(['/sbin/apk', '/usr/bin/apk'])) return [];
        if (!dirExists('/lib/apk/db') && !dirExists('/var/lib/apk/db')) return [];

        var out = runSh('apk info -v 2>/dev/null');
        if (!out) return [];

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
        return results;
    }

    // ---------- flatpak ----------
    function collectFlatpak() {
        if (!binExists(['/usr/bin/flatpak', '/bin/flatpak'])) return [];
        if (!dirExists('/var/lib/flatpak')) return [];

        var results = [];

        var sys = runSh('flatpak list --system --columns=application,version,origin 2>/dev/null');
        sys.split('\n').forEach(function (line) {
            var p = line.split('\t');
            if (!p[0] || !p[0].trim()) return;
            results.push({ name: p[0].trim(), version: (p[1] || '').trim(), arch: '', publisher: (p[2] || '').trim(), location: 'flatpak', scope: 'system' });
        });

        var usr = runSh('flatpak list --user --columns=application,version,origin 2>/dev/null');
        usr.split('\n').forEach(function (line) {
            var p = line.split('\t');
            if (!p[0] || !p[0].trim()) return;
            results.push({ name: p[0].trim(), version: (p[1] || '').trim(), arch: '', publisher: (p[2] || '').trim(), location: 'flatpak', scope: 'user' });
        });

        return results;
    }

    // ---------- snap ----------
    function collectSnap() {
        if (!binExists(['/usr/bin/snap', '/bin/snap'])) return [];
        if (!dirExists('/var/lib/snapd/snaps')) return [];

        var out = runSh('snap list --all 2>/dev/null');
        if (!out) return [];

        var results = [];
        out.split('\n').forEach(function (line) {
            if (!line || line.indexOf('Name') === 0) return;
            var p = line.trim().split(/\s+/);
            if (p.length < 5 || !p[0]) return;
            results.push({ name: p[0], version: p[1], arch: '', publisher: p[4] || '', location: 'snap' });
        });
        return results;
    }

    try {
        var all = [].concat(
            collectDpkg(),
            collectRpm(),
            collectPacman(),
            collectApk(),
            collectFlatpak(),
            collectSnap()
        );
        ret._res(all);
    } catch (e) {
        ret._rej(e);
    }
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