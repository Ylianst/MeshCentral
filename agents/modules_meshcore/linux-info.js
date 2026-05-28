
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

if (process.platform == 'linux')
{
    module.exports = { av: av, firewall: firewall };
}
else
{
    var not_supported = function () { throw (process.platform + ' not supported'); };
    module.exports = { av: not_supported, firewall: not_supported };
}